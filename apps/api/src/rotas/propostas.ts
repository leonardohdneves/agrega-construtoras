// Comercial · Propostas: orçamento para o cliente, redigido pela IA com o histórico de preço; aceita, vira venda.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Banco, Cliente } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';
import { empresaDo, exigir } from '../sessao.ts';
import { ErroIa, iaDisponivel } from '../lib/ia-nota.ts';
import { redigirPropostaIa, textoModelo, type DadosProposta } from '../lib/ia-proposta.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reais = (c: unknown) => (c === null || c === undefined ? null : Math.round(Number(c)) / 100);
const cent = (r: number) => Math.round(r * 100);
const texto = (max = 200) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const numero = (msg: string) =>
  z.union([z.number(), z.string()]).transform((v, ctx) => {
    const n = typeof v === 'number' ? v : Number(String(v).replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: 'custom', message: msg });
      return z.NEVER;
    }
    return n;
  });

const esquema = z.object({
  clienteId: z.string().regex(UUID, 'Escolha o cliente.'),
  tracoId: z.string().regex(UUID, 'Escolha o traço.'),
  obra: texto(200),
  endereco: texto(300),
  volume: numero('Informe o volume.').pipe(z.number().positive('O volume precisa ser maior que zero.').max(5000)),
  precoM3: numero('Informe o preço por m³.').pipe(z.number().min(0, 'Preço inválido.')),
  condicoes: texto(300),
  validadeDias: numero('Informe a validade.').pipe(z.number().int().min(1).max(365)).optional().default(7),
  texto: texto(4000),
});

function publico(r: Record<string, any>) {
  return {
    id: r.id as string,
    numero: Number(r.numero),
    clienteId: r.cliente_id as string,
    clienteNome: r.cliente_nome as string,
    tracoId: r.traco_id as string,
    tracoCodigo: r.traco_codigo as string,
    tracoDescricao: (r.traco_descricao as string | null) ?? null,
    vendedorNome: r.vendedor_nome as string,
    obra: r.obra as string | null,
    endereco: r.endereco as string | null,
    volume: Number(r.volume_m3),
    precoM3: reais(r.preco_m3_centavos)!,
    total: Math.round(Number(r.volume_m3) * Number(r.preco_m3_centavos)) / 100,
    condicoes: r.condicoes as string | null,
    validadeDias: Number(r.validade_dias),
    texto: r.texto as string | null,
    textoIa: !!r.texto_ia,
    status: r.status as 'rascunho' | 'enviada' | 'aceita' | 'recusada',
    vendaId: (r.venda_id as string | null) ?? null,
    vendaNumero: r.venda_numero === null || r.venda_numero === undefined ? null : Number(r.venda_numero),
    criadoEm: r.criado_em as string,
  };
}

const SELECT = `
  SELECT p.*, coalesce(cl.nome_fantasia, cl.razao_social) AS cliente_nome, t.codigo AS traco_codigo, t.descricao AS traco_descricao,
         u.nome AS vendedor_nome, v.numero AS venda_numero
    FROM propostas p
    JOIN clientes cl ON cl.id = p.cliente_id
    JOIN tracos t ON t.id = p.traco_id
    JOIN usuarios u ON u.id = p.vendedor_id
    LEFT JOIN vendas v ON v.id = p.venda_id`;

async function carregar(c: Cliente, empresaId: string, id: string) {
  const r = (await c.query(`${SELECT} WHERE p.id = $1 AND p.empresa_id = $2`, [id, empresaId])).rows[0];
  if (!r) throw naoEncontrado('Proposta');
  return r;
}

/** Últimos preços aprovados deste cliente neste traço: a referência que a IA e o vendedor usam. */
async function historico(c: Cliente, empresaId: string, clienteId: string, tracoId: string) {
  return (
    await c.query(
      `SELECT preco_m3_centavos, data_entrega FROM vendas
        WHERE empresa_id = $1 AND cliente_id = $2 AND traco_id = $3 AND status IN ('aprovada', 'concluida')
        ORDER BY data_entrega DESC LIMIT 5`,
      [empresaId, clienteId, tracoId],
    )
  ).rows.map((h) => ({ preco: reais(h.preco_m3_centavos)!, data: new Date(h.data_entrega).toLocaleDateString('pt-BR') }));
}

export function rotasPropostas(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.addHook('preHandler', exigir(banco, 'dono', 'gestor', 'vendedor'));

    app.get('/propostas', async (req) => {
      const empresaId = empresaDo(req);
      const r = await banco.query(`${SELECT} WHERE p.empresa_id = $1 ORDER BY p.numero DESC LIMIT 300`, [empresaId]);
      return { propostas: r.rows.map(publico), ia: iaDisponivel() };
    });

    // Preço de referência para o formulário: o último preço do cliente neste traço.
    app.get<{ Querystring: Record<string, string | undefined> }>('/propostas/referencia', async (req) => {
      const empresaId = empresaDo(req);
      const { clienteId, tracoId } = req.query;
      if (!clienteId || !tracoId || !UUID.test(clienteId) || !UUID.test(tracoId)) return { historico: [] };
      return { historico: await historico(banco, empresaId, clienteId, tracoId) };
    });

    app.get<{ Params: { id: string } }>('/propostas/:id', async (req) => {
      return { proposta: publico(await carregar(banco, empresaDo(req), req.params.id)) };
    });

    app.post('/propostas', async (req, reply) => {
      const d = esquema.parse(req.body);
      const empresaId = empresaDo(req);
      const id = await emTransacao(banco, async (c) => {
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`propostas:${empresaId}`]);
        const numero = Number((await c.query('SELECT coalesce(max(numero), 0) + 1 AS n FROM propostas WHERE empresa_id = $1', [empresaId])).rows[0].n);
        const x = (
          await c.query(
            `INSERT INTO propostas (empresa_id, numero, vendedor_id, cliente_id, traco_id, obra, endereco, volume_m3, preco_m3_centavos, condicoes, validade_dias, texto)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
            [empresaId, numero, req.usuario!.id, d.clienteId, d.tracoId, d.obra, d.endereco, d.volume, cent(d.precoM3), d.condicoes, d.validadeDias, d.texto],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'propostas', entidadeId: x.id, depois: { ...d, numero } });
        return x.id as string;
      });
      reply.code(201);
      return { proposta: publico(await carregar(banco, empresaId, id)) };
    });

    app.put<{ Params: { id: string } }>('/propostas/:id', async (req) => {
      const d = esquema.parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const atual = await carregar(c, empresaId, req.params.id);
        if (!['rascunho', 'enviada'].includes(atual.status)) throw new ErroHttp(400, 'Esta proposta já foi aceita ou recusada e não pode mais ser alterada.');
        await c.query(
          `UPDATE propostas SET cliente_id = $3, traco_id = $4, obra = $5, endereco = $6, volume_m3 = $7, preco_m3_centavos = $8, condicoes = $9,
                  validade_dias = $10, texto = $11, atualizado_em = now()
            WHERE id = $1 AND empresa_id = $2`,
          [req.params.id, empresaId, d.clienteId, d.tracoId, d.obra, d.endereco, d.volume, cent(d.precoM3), d.condicoes, d.validadeDias, d.texto],
        );
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'propostas', entidadeId: req.params.id, depois: d });
      });
      return { proposta: publico(await carregar(banco, empresaId, req.params.id)) };
    });

    // A IA redige o texto com os dados da proposta e o histórico de preço do cliente. Sem IA, usa o texto-modelo.
    app.post<{ Params: { id: string } }>('/propostas/:id/redigir', async (req) => {
      const empresaId = empresaDo(req);
      const r = await carregar(banco, empresaId, req.params.id);
      if (!['rascunho', 'enviada'].includes(r.status)) throw new ErroHttp(400, 'Esta proposta já foi aceita ou recusada.');
      const emp = (await banco.query('SELECT coalesce(nome_fantasia, razao_social) AS nome FROM empresas WHERE id = $1', [empresaId])).rows[0];
      const tr = (await banco.query('SELECT fck, slump FROM tracos WHERE id = $1', [r.traco_id])).rows[0];
      const dados: DadosProposta = {
        empresa: emp?.nome ?? 'Concreteira',
        cliente: r.cliente_nome,
        obra: r.obra,
        endereco: r.endereco,
        traco: r.traco_descricao ? `${r.traco_codigo} (${r.traco_descricao})` : r.traco_codigo,
        fck: tr?.fck ?? null,
        slump: tr?.slump ?? null,
        volume: Number(r.volume_m3),
        precoM3: reais(r.preco_m3_centavos)!,
        condicoes: r.condicoes,
        validadeDias: Number(r.validade_dias),
        historico: await historico(banco, empresaId, r.cliente_id, r.traco_id),
      };
      let texto: string;
      let ia = false;
      let aviso: string | null = null;
      try {
        texto = await redigirPropostaIa(dados);
        ia = true;
      } catch (e) {
        if (!(e instanceof ErroIa) || iaDisponivel()) throw e instanceof ErroIa ? new ErroHttp(502, e.message) : e;
        // Sem a chave da IA configurada, o texto-modelo é gerado e o usuário é avisado.
        texto = textoModelo(dados);
        aviso = 'A IA não está configurada; o texto foi gerado a partir do modelo padrão.';
      }
      await banco.query('UPDATE propostas SET texto = $3, texto_ia = $4, atualizado_em = now() WHERE id = $1 AND empresa_id = $2', [req.params.id, empresaId, texto, ia]);
      return { proposta: publico(await carregar(banco, empresaId, req.params.id)), aviso };
    });

    app.post<{ Params: { id: string } }>('/propostas/:id/status', async (req) => {
      const { status } = z.object({ status: z.enum(['enviada', 'aceita', 'recusada']) }).parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const atual = await carregar(c, empresaId, req.params.id);
        const transicoes: Record<string, string[]> = { rascunho: ['enviada', 'aceita', 'recusada'], enviada: ['aceita', 'recusada'], aceita: [], recusada: [] };
        if (!transicoes[atual.status].includes(status)) throw new ErroHttp(400, `Não é possível marcar como ${status} uma proposta ${atual.status}.`);
        if (status === 'enviada' && !atual.texto) throw new ErroHttp(400, 'Redija ou escreva o texto da proposta antes de enviar.');
        await c.query('UPDATE propostas SET status = $3, atualizado_em = now() WHERE id = $1 AND empresa_id = $2', [req.params.id, empresaId, status]);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'propostas', entidadeId: req.params.id, depois: { status } });
      });
      return { proposta: publico(await carregar(banco, empresaId, req.params.id)) };
    });

    // Depois de lançar a venda a partir da proposta aceita, guarda o vínculo.
    app.post<{ Params: { id: string } }>('/propostas/:id/vincular', async (req) => {
      const { vendaId } = z.object({ vendaId: z.string().regex(UUID) }).parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const atual = await carregar(c, empresaId, req.params.id);
        if (atual.status !== 'aceita') throw new ErroHttp(400, 'Só a proposta aceita vira venda.');
        await c.query('UPDATE propostas SET venda_id = $3, atualizado_em = now() WHERE id = $1 AND empresa_id = $2', [req.params.id, empresaId, vendaId]);
      });
      return { proposta: publico(await carregar(banco, empresaId, req.params.id)) };
    });
  };
}
