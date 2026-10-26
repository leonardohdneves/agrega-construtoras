// Suprimentos · Permuta por material: o fornecedor entrega material e a construtora entrega serviços prestados a ele.
// Compensação fecha as duas partes pelo preço acordado (sem caixa); a diferença é o torna. A nota fiscal não é emitida
// aqui: fica como pendência avisada, sem bloquear a compensação.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Banco, Cliente } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';
import { hojeBrasil } from '../lib/frota.ts';
import { empresaDo, exigir } from '../sessao.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dataObrig = (msg: string) => z.string({ required_error: msg }).regex(/^\d{4}-\d{2}-\d{2}$/, msg);

const esquemaItem = z.object({
  descricao: z.string({ required_error: 'Informe a descrição.' }).trim().min(2, 'Informe a descrição.').max(200),
  unidade: z.string().trim().max(20).optional().nullable().transform((v) => v || null),
  quantidade: z.number({ required_error: 'Informe a quantidade.' }).positive('A quantidade precisa ser maior que zero.').max(1e9),
  precoUnitario: z.number({ required_error: 'Informe o preço acordado.' }).nonnegative('O preço não pode ser negativo.').max(1e9),
});
const esquemaPermuta = z
  .object({
    obraId: z.string().regex(UUID, 'Escolha a obra.'),
    fornecedorId: z.string().regex(UUID, 'Escolha o fornecedor.'),
    data: dataObrig('Informe a data.'),
    observacao: z.string().trim().max(500).optional().nullable().transform((v) => v || null),
    materiais: z.array(esquemaItem).max(200),
    servicos: z.array(esquemaItem).max(200),
  })
  .superRefine((d, ctx) => {
    if (!d.materiais.length) ctx.addIssue({ code: 'custom', path: ['materiais'], message: 'Inclua pelo menos um material recebido.' });
    if (!d.servicos.length) ctx.addIssue({ code: 'custom', path: ['servicos'], message: 'Inclua pelo menos um serviço prestado.' });
  });

type Linha = Record<string, any>;

async function carregarPermuta(c: Cliente, empresaId: string, id: string) {
  if (!UUID.test(id)) throw naoEncontrado('Permuta');
  const p = (
    await c.query(
      `SELECT p.*, o.codigo AS obra_codigo, o.nome AS obra_nome, f.razao_social, f.nome_fantasia, f.cnpj_cpf
         FROM permutas p JOIN obras o ON o.id = p.obra_id JOIN fornecedores f ON f.id = p.fornecedor_id
        WHERE p.id = $1 AND p.empresa_id = $2`,
      [id, empresaId],
    )
  ).rows[0] as Linha | undefined;
  if (!p) throw naoEncontrado('Permuta');
  const itens = (await c.query('SELECT * FROM permuta_itens WHERE permuta_id = $1 ORDER BY lado, ordem', [id])).rows as Linha[];
  return { p, itens };
}

function montarDetalhe(p: Linha, itens: Linha[]) {
  const linhaDo = (i: Linha) => {
    const precoUnitario = Number(i.preco_centavos) / 100;
    const quantidade = Number(i.quantidade);
    return { id: i.id as string, lado: i.lado as 'material' | 'servico', descricao: i.descricao as string, unidade: (i.unidade ?? null) as string | null, quantidade, precoUnitario, total: Math.round(quantidade * Number(i.preco_centavos)) / 100 };
  };
  const linhas = itens.map(linhaDo);
  const material = linhas.filter((i) => i.lado === 'material').reduce((s, i) => s + i.total, 0);
  const servico = linhas.filter((i) => i.lado === 'servico').reduce((s, i) => s + i.total, 0);
  const diferenca = Math.round((material - servico) * 100) / 100;
  return {
    id: p.id as string,
    numero: Number(p.numero),
    status: p.status as 'aberta' | 'compensada' | 'cancelada',
    data: String(p.data).slice(0, 10),
    observacao: (p.observacao ?? null) as string | null,
    obra: { id: p.obra_id as string, codigo: p.obra_codigo as string, nome: p.obra_nome as string },
    fornecedor: { id: p.fornecedor_id as string, nome: (p.nome_fantasia || p.razao_social) as string, razaoSocial: p.razao_social as string, documento: (p.cnpj_cpf ?? null) as string | null },
    nfEmitida: !!p.nf_emitida,
    compensadaEm: p.compensada_em ? String(p.compensada_em).slice(0, 10) : null,
    itens: linhas,
    totais: {
      material: Math.round(material * 100) / 100,
      servico: Math.round(servico * 100) / 100,
      diferenca,
      // Material acima do serviço: a construtora paga a diferença. Serviço acima: o fornecedor paga a diferença.
      tornaTipo: diferenca > 0 ? 'pagar' : diferenca < 0 ? 'receber' : 'nenhuma',
      torna: Math.abs(diferenca),
    },
    pendencias: p.status !== 'cancelada' && !p.nf_emitida ? ['Emitir a nota fiscal da permuta (não emitida pelo sistema).'] : [],
  };
}

export function rotasPermutas(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.addHook('preHandler', exigir(banco, 'dono', 'gestor'));

    app.get<{ Querystring: { obraId?: string } }>('/permutas', async (req) => {
      const empresaId = empresaDo(req);
      const obra = req.query.obraId && UUID.test(req.query.obraId) ? req.query.obraId : null;
      const r = await banco.query(
        `SELECT p.id, p.numero, p.data, p.status, p.nf_emitida, o.codigo AS obra_codigo, coalesce(f.nome_fantasia, f.razao_social) AS fornecedor,
                (SELECT coalesce(sum(round(quantidade * preco_centavos)), 0) FROM permuta_itens i WHERE i.permuta_id = p.id AND i.lado = 'material') AS material,
                (SELECT coalesce(sum(round(quantidade * preco_centavos)), 0) FROM permuta_itens i WHERE i.permuta_id = p.id AND i.lado = 'servico') AS servico
           FROM permutas p JOIN obras o ON o.id = p.obra_id JOIN fornecedores f ON f.id = p.fornecedor_id
          WHERE p.empresa_id = $1 AND ($2::uuid IS NULL OR p.obra_id = $2::uuid)
          ORDER BY p.numero DESC LIMIT 300`,
        [empresaId, obra],
      );
      return {
        permutas: r.rows.map((x) => ({
          id: x.id as string, numero: Number(x.numero), data: String(x.data).slice(0, 10), status: x.status as string, nfEmitida: !!x.nf_emitida,
          obraCodigo: x.obra_codigo as string, fornecedor: x.fornecedor as string,
          material: Number(x.material) / 100, servico: Number(x.servico) / 100,
        })),
      };
    });

    app.get<{ Params: { id: string } }>('/permutas/:id', async (req) => {
      const empresaId = empresaDo(req);
      const { p, itens } = await carregarPermuta(banco, empresaId, req.params.id);
      return { permuta: montarDetalhe(p, itens) };
    });

    app.post('/permutas', async (req, reply) => {
      const d = esquemaPermuta.parse(req.body);
      const empresaId = empresaDo(req);
      const u = req.usuario!;
      const id = await emTransacao(banco, async (c) => {
        const obra = (await c.query('SELECT id FROM obras WHERE id = $1 AND empresa_id = $2 AND ativo', [d.obraId, empresaId])).rows[0];
        if (!obra) throw new ErroHttp(400, 'Obra não encontrada.');
        const forn = (await c.query("SELECT id FROM fornecedores WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL AND categoria = 'fornecedor'", [d.fornecedorId, empresaId])).rows[0];
        if (!forn) throw new ErroHttp(400, 'Fornecedor não encontrado.');
        const numero = Number((await c.query('SELECT coalesce(max(numero), 0) + 1 AS n FROM permutas WHERE empresa_id = $1', [empresaId])).rows[0].n);
        const p = (
          await c.query(
            'INSERT INTO permutas (empresa_id, numero, obra_id, fornecedor_id, data, observacao) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [empresaId, numero, d.obraId, d.fornecedorId, d.data, d.observacao],
          )
        ).rows[0];
        const gravar = async (lado: 'material' | 'servico', lista: z.infer<typeof esquemaItem>[]) => {
          for (const [ordem, i] of lista.entries())
            await c.query(
              'INSERT INTO permuta_itens (permuta_id, lado, descricao, unidade, quantidade, preco_centavos, ordem) VALUES ($1, $2, $3, $4, $5, $6, $7)',
              [p.id, lado, i.descricao, i.unidade, i.quantidade, Math.round(i.precoUnitario * 100), ordem],
            );
        };
        await gravar('material', d.materiais);
        await gravar('servico', d.servicos);
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'criar', entidade: 'permutas', entidadeId: p.id, depois: { numero, materiais: d.materiais.length, servicos: d.servicos.length } });
        return p.id as string;
      });
      const { p, itens } = await carregarPermuta(banco, empresaId, id);
      reply.code(201);
      return { permuta: montarDetalhe(p, itens) };
    });

    app.put<{ Params: { id: string } }>('/permutas/:id', async (req) => {
      const d = esquemaPermuta.parse(req.body);
      const empresaId = empresaDo(req);
      const u = req.usuario!;
      await emTransacao(banco, async (c) => {
        const { p } = await carregarPermuta(c, empresaId, req.params.id);
        if (p.status !== 'aberta') throw new ErroHttp(409, 'Só dá para alterar permuta aberta.');
        await c.query('UPDATE permutas SET obra_id = $2, fornecedor_id = $3, data = $4, observacao = $5, atualizado_em = now() WHERE id = $1', [p.id, d.obraId, d.fornecedorId, d.data, d.observacao]);
        await c.query('DELETE FROM permuta_itens WHERE permuta_id = $1', [p.id]);
        const gravar = async (lado: 'material' | 'servico', lista: z.infer<typeof esquemaItem>[]) => {
          for (const [ordem, i] of lista.entries())
            await c.query(
              'INSERT INTO permuta_itens (permuta_id, lado, descricao, unidade, quantidade, preco_centavos, ordem) VALUES ($1, $2, $3, $4, $5, $6, $7)',
              [p.id, lado, i.descricao, i.unidade, i.quantidade, Math.round(i.precoUnitario * 100), ordem],
            );
        };
        await gravar('material', d.materiais);
        await gravar('servico', d.servicos);
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'alterar', entidade: 'permutas', entidadeId: p.id, depois: { materiais: d.materiais.length, servicos: d.servicos.length } });
      });
      const { p, itens } = await carregarPermuta(banco, empresaId, req.params.id);
      return { permuta: montarDetalhe(p, itens) };
    });

    /** Compensa as duas partes pelo preço acordado. A nota fiscal pendente não bloqueia a compensação. */
    app.post<{ Params: { id: string } }>('/permutas/:id/compensar', async (req) => {
      const empresaId = empresaDo(req);
      const u = req.usuario!;
      await emTransacao(banco, async (c) => {
        const { p, itens } = await carregarPermuta(c, empresaId, req.params.id);
        if (p.status !== 'aberta') throw new ErroHttp(409, 'Só dá para compensar permuta aberta.');
        if (!itens.some((i) => i.lado === 'material') || !itens.some((i) => i.lado === 'servico'))
          throw new ErroHttp(409, 'A permuta precisa ter material recebido e serviço prestado para ser compensada.');
        await c.query("UPDATE permutas SET status = 'compensada', compensada_em = $2, atualizado_em = now() WHERE id = $1", [p.id, hojeBrasil()]);
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'alterar', entidade: 'permutas', entidadeId: p.id, antes: { status: 'aberta' }, depois: { status: 'compensada' } });
      });
      const { p, itens } = await carregarPermuta(banco, empresaId, req.params.id);
      return { permuta: montarDetalhe(p, itens) };
    });

    app.post<{ Params: { id: string } }>('/permutas/:id/cancelar', async (req) => {
      const empresaId = empresaDo(req);
      const u = req.usuario!;
      await emTransacao(banco, async (c) => {
        const { p } = await carregarPermuta(c, empresaId, req.params.id);
        if (p.status !== 'aberta') throw new ErroHttp(409, 'Só dá para cancelar permuta aberta.');
        await c.query("UPDATE permutas SET status = 'cancelada', atualizado_em = now() WHERE id = $1", [p.id]);
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'alterar', entidade: 'permutas', entidadeId: p.id, depois: { status: 'cancelada' } });
      });
      const { p, itens } = await carregarPermuta(banco, empresaId, req.params.id);
      return { permuta: montarDetalhe(p, itens) };
    });

    /** Marca a nota fiscal da permuta como emitida (ou volta a pendente). Só registra; não bloqueia nada. */
    app.post<{ Params: { id: string } }>('/permutas/:id/nota-emitida', async (req) => {
      const d = z.object({ emitida: z.boolean() }).parse(req.body);
      const empresaId = empresaDo(req);
      const u = req.usuario!;
      await emTransacao(banco, async (c) => {
        const { p } = await carregarPermuta(c, empresaId, req.params.id);
        await c.query('UPDATE permutas SET nf_emitida = $2, atualizado_em = now() WHERE id = $1', [p.id, d.emitida]);
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'alterar', entidade: 'permutas', entidadeId: p.id, depois: { nfEmitida: d.emitida } });
      });
      const { p, itens } = await carregarPermuta(banco, empresaId, req.params.id);
      return { permuta: montarDetalhe(p, itens) };
    });
  };
}
