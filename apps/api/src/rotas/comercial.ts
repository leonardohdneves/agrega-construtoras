// Módulo Comercial: o vendedor lança as vendas; o dono ou o gestor aprova; aprovada, a venda entra na programação da Produção.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Banco, Cliente } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { cnpjValido } from '../lib/cnpj.ts';
import { cpfValido, hojeBrasil } from '../lib/frota.ts';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';
import { empresaDo, exigir } from '../sessao.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const reais = (c: unknown) => (c === null || c === undefined ? null : Math.round(Number(c)) / 100);
const cent = (r: number) => Math.round(r * 100);
const r2 = (n: number) => Math.round(n * 100) / 100;
const texto = (max = 200) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const decimal = (msg: string) =>
  z.union([z.number(), z.string()]).transform((v, ctx) => {
    const n = typeof v === 'number' ? v : Number(String(v).replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: 'custom', message: msg });
      return z.NEVER;
    }
    return n;
  });

export const STATUS_VENDA = ['rascunho', 'aguardando_aprovacao', 'aprovada', 'reprovada', 'concluida', 'cancelada'] as const;

const esquemaVenda = z.object({
  vendedorId: z.union([z.string().uuid(), z.literal(''), z.null()]).optional().transform((v) => v || null),
  clienteId: z.string({ required_error: 'Escolha o cliente.' }).uuid('Escolha o cliente.'),
  obra: texto(200),
  endereco: texto(300),
  contato: texto(200),
  tracoId: z.string({ required_error: 'Escolha o traço.' }).uuid('Escolha o traço.'),
  volume: decimal('Volume inválido.').refine((n) => n > 0 && n <= 5000, 'Informe o volume vendido em m³.'),
  dataEntrega: z.string({ required_error: 'Informe a data da entrega.' }).regex(DATA, 'Informe a data da entrega.'),
  horaEntrega: z.union([z.string().regex(/^\d{2}:\d{2}$/, 'Hora inválida.'), z.literal(''), z.null()]).optional().transform((v) => v || null),
  bombeamento: z.boolean().optional().default(false),
  precoM3: decimal('Preço inválido.').refine((n) => n >= 0, 'Preço inválido.'),
  taxaBomba: z.union([decimal('Taxa de bombeamento inválida.'), z.null()]).optional().transform((v) => (v === undefined ? null : v)),
  condicaoPagamento: texto(200),
  observacoes: texto(1000),
  enviar: z.boolean().optional().default(false),
});

const esquemaClienteRapido = z.object({
  razaoSocial: z.string({ required_error: 'Informe o nome do cliente.' }).trim().min(2, 'Informe o nome do cliente.').max(200),
  cnpjCpf: z.union([z.string(), z.null()]).optional().transform((v) => (v ?? '').replace(/\D/g, '') || null),
  telefone: texto(40),
  cidade: texto(120),
  uf: z.string().trim().toUpperCase().length(2, 'UF com 2 letras.').optional().nullable().or(z.literal('').transform(() => null)),
});

/** Dono e gestor veem e aprovam todas as vendas; os demais, só as próprias. */
const gestaoComercial = (req: FastifyRequest) => req.usuario!.perfil === 'dono' || req.usuario!.perfil === 'gestor';

const SELECT_VENDA = `
  SELECT v.*, coalesce(cl.nome_fantasia, cl.razao_social) AS cliente_nome, cl.telefone AS cliente_telefone, t.codigo AS traco_codigo, t.descricao AS traco_descricao,
         uv.nome AS vendedor_nome, ua.nome AS aprovado_por, uc.nome AS criado_por,
         coalesce((SELECT sum(c.volume_m3) FROM cargas c WHERE c.venda_id = v.id AND c.status = 'produzida'), 0) AS entregue_m3,
         coalesce((SELECT sum(c.devolvido_m3) FROM cargas c WHERE c.venda_id = v.id AND c.status = 'produzida'), 0) AS devolvido_m3,
         (SELECT count(*) FROM cargas c WHERE c.venda_id = v.id AND c.status = 'produzida') AS cargas
    FROM vendas v JOIN clientes cl ON cl.id = v.cliente_id JOIN tracos t ON t.id = v.traco_id
    JOIN usuarios uv ON uv.id = v.vendedor_id LEFT JOIN usuarios ua ON ua.id = v.aprovado_por_id LEFT JOIN usuarios uc ON uc.id = v.criado_por_id`;

export function vendaPublica(r: Record<string, any>) {
  const volume = Number(r.volume_m3);
  const entregue = Number(r.entregue_m3 ?? 0);
  const preco = Number(r.preco_m3_centavos);
  const taxa = r.taxa_bomba_centavos === null ? 0 : Number(r.taxa_bomba_centavos);
  return {
    id: r.id as string,
    numero: r.numero as number,
    vendedorId: r.vendedor_id as string,
    vendedorNome: r.vendedor_nome as string,
    clienteId: r.cliente_id as string,
    clienteNome: r.cliente_nome as string,
    clienteTelefone: (r.cliente_telefone ?? null) as string | null,
    obra: r.obra as string | null,
    endereco: r.endereco as string | null,
    contato: r.contato as string | null,
    tracoId: r.traco_id as string,
    tracoCodigo: r.traco_codigo as string,
    tracoDescricao: (r.traco_descricao ?? null) as string | null,
    volume,
    dataEntrega: r.data_entrega instanceof Date ? r.data_entrega.toISOString().slice(0, 10) : String(r.data_entrega).slice(0, 10),
    horaEntrega: r.hora_entrega ? String(r.hora_entrega).slice(0, 5) : null,
    bombeamento: !!r.bombeamento,
    precoM3: reais(preco)!,
    taxaBomba: reais(r.taxa_bomba_centavos),
    valorTotal: reais(Math.round(volume * preco) + taxa)!,
    condicaoPagamento: r.condicao_pagamento as string | null,
    observacoes: r.observacoes as string | null,
    status: r.status as (typeof STATUS_VENDA)[number],
    motivo: r.motivo as string | null,
    enviadoEm: r.enviado_aprovacao_em,
    aprovadoPor: (r.aprovado_por ?? null) as string | null,
    aprovadoEm: r.aprovado_em,
    criadoPor: (r.criado_por ?? null) as string | null,
    criadoEm: r.criado_em,
    entregue: r2(entregue),
    devolvido: r2(Number(r.devolvido_m3 ?? 0)),
    saldo: r2(Math.max(volume - entregue, 0)),
    cargas: Number(r.cargas ?? 0),
  };
}

export async function carregarVenda(c: Cliente, empresaId: string, id: string) {
  if (!UUID.test(id)) throw naoEncontrado('Venda');
  const r = (await c.query(`${SELECT_VENDA} WHERE v.id = $1 AND v.empresa_id = $2`, [id, empresaId])).rows[0];
  if (!r) throw naoEncontrado('Venda');
  return r;
}

/** Aprovada e toda entregue → concluída; carga cancelada que deixa saldo → volta a aprovada. */
export async function atualizarSituacaoVenda(c: Cliente, vendaId: string | null | undefined): Promise<void> {
  if (!vendaId) return;
  await c.query(
    `UPDATE vendas v SET status = CASE WHEN x.entregue >= v.volume_m3 THEN 'concluida' ELSE 'aprovada' END, atualizado_em = now()
       FROM (SELECT coalesce(sum(volume_m3), 0) AS entregue FROM cargas WHERE venda_id = $1 AND status = 'produzida') x
      WHERE v.id = $1 AND v.status IN ('aprovada', 'concluida') AND v.encerrada_em IS NULL
        AND v.status <> CASE WHEN x.entregue >= v.volume_m3 THEN 'concluida' ELSE 'aprovada' END`,
    [vendaId],
  );
}

function periodo(q: Record<string, string | undefined>) {
  const hoje = hojeBrasil();
  const de = q.de && DATA.test(q.de) ? q.de : `${hoje.slice(0, 7)}-01`;
  const [a, m] = hoje.split('-').map(Number);
  const fimMes = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  const ate = q.ate && DATA.test(q.ate) ? q.ate : fimMes;
  if (ate < de) throw new ErroHttp(400, 'A data final é antes da inicial.');
  return { de, ate };
}

export function rotasComercial(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.addHook('preHandler', exigir(banco, 'dono', 'gestor', 'vendedor'));

    async function validar(c: Cliente, empresaId: string, req: FastifyRequest, d: z.infer<typeof esquemaVenda>) {
      if (!(await c.query('SELECT 1 FROM clientes WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL', [d.clienteId, empresaId])).rowCount) {
        throw new ErroHttp(400, 'Cliente não encontrado.');
      }
      if (!(await c.query('SELECT 1 FROM tracos WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL', [d.tracoId, empresaId])).rowCount) {
        throw new ErroHttp(400, 'Traço não encontrado.');
      }
      // Vendedor: quem lança. Dono e gestor podem lançar em nome de um vendedor.
      let vendedorId = req.usuario!.id;
      if (d.vendedorId && d.vendedorId !== vendedorId) {
        if (!gestaoComercial(req)) throw new ErroHttp(403, 'Você só lança vendas em seu nome.');
        const v = (await c.query('SELECT 1 FROM usuarios WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL', [d.vendedorId, empresaId])).rowCount;
        if (!v) throw new ErroHttp(400, 'Vendedor não encontrado.');
        vendedorId = d.vendedorId;
      }
      return vendedorId;
    }

    async function vendaDoUsuario(c: Cliente, req: FastifyRequest, id: string) {
      const r = await carregarVenda(c, empresaDo(req), id);
      if (!gestaoComercial(req) && r.vendedor_id !== req.usuario!.id && r.criado_por_id !== req.usuario!.id) throw naoEncontrado('Venda');
      return r;
    }

    app.get('/opcoes', async (req) => {
      const empresaId = empresaDo(req);
      const [clientes, tracos, vendedores] = await Promise.all([
        banco.query('SELECT id, coalesce(nome_fantasia, razao_social) AS nome, cidade FROM clientes WHERE empresa_id = $1 AND excluido_em IS NULL AND ativo ORDER BY 2', [empresaId]),
        banco.query('SELECT id, codigo, descricao, fck, slump FROM tracos WHERE empresa_id = $1 AND excluido_em IS NULL AND ativo ORDER BY fck NULLS LAST, codigo', [empresaId]),
        banco.query(
          `SELECT id, nome, perfil FROM usuarios WHERE empresa_id = $1 AND excluido_em IS NULL AND ativo AND (perfil = 'vendedor' OR id = $2) ORDER BY nome`,
          [empresaId, req.usuario!.id],
        ),
      ]);
      // Preço de referência: o último preço de cada traço nas vendas aprovadas.
      const precos = await banco.query(
        `SELECT DISTINCT ON (traco_id) traco_id, preco_m3_centavos FROM vendas WHERE empresa_id = $1 AND status IN ('aprovada', 'concluida')
          ORDER BY traco_id, aprovado_em DESC NULLS LAST`,
        [empresaId],
      );
      return {
        clientes: clientes.rows,
        tracos: tracos.rows.map((t) => ({ id: t.id, codigo: t.codigo, descricao: t.descricao, fck: t.fck, slump: t.slump })),
        vendedores: gestaoComercial(req) ? vendedores.rows.map((v) => ({ id: v.id, nome: v.nome })) : [],
        ultimoPreco: Object.fromEntries(precos.rows.map((p) => [p.traco_id, reais(p.preco_m3_centavos)])),
        gestao: gestaoComercial(req),
      };
    });

    app.post('/clientes', async (req, reply) => {
      const d = esquemaClienteRapido.parse(req.body);
      if (d.cnpjCpf && !(d.cnpjCpf.length === 14 ? cnpjValido(d.cnpjCpf) : d.cnpjCpf.length === 11 ? cpfValido(d.cnpjCpf) : false)) {
        throw new ErroHttp(400, 'CPF ou CNPJ inválido.');
      }
      const empresaId = empresaDo(req);
      try {
        const n = await emTransacao(banco, async (c) => {
          const novo = (
            await c.query(
              `INSERT INTO clientes (empresa_id, tipo_pessoa, cnpj_cpf, razao_social, telefone, cidade, uf) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, razao_social, cidade`,
              [empresaId, d.cnpjCpf?.length === 11 ? 'PF' : 'PJ', d.cnpjCpf, d.razaoSocial, d.telefone, d.cidade, d.uf ?? null],
            )
          ).rows[0];
          await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'clientes', entidadeId: novo.id, depois: { ...d, origem: 'comercial' } });
          return novo;
        });
        reply.code(201);
        return { cliente: { id: n.id, nome: n.razao_social, cidade: n.cidade } };
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new ErroHttp(409, 'Já existe um cliente com este CPF ou CNPJ.');
        throw e;
      }
    });

    app.get<{ Querystring: Record<string, string | undefined> }>('/vendas', async (req) => {
      const empresaId = empresaDo(req);
      const q = req.query;
      const p: unknown[] = [empresaId];
      const f: string[] = [];
      if (!gestaoComercial(req)) {
        p.push(req.usuario!.id);
        f.push(`(v.vendedor_id = $${p.length} OR v.criado_por_id = $${p.length})`);
      } else if (q.vendedorId && UUID.test(q.vendedorId)) {
        p.push(q.vendedorId);
        f.push(`v.vendedor_id = $${p.length}`);
      }
      if (q.status && (STATUS_VENDA as readonly string[]).includes(q.status)) {
        p.push(q.status);
        f.push(`v.status = $${p.length}`);
      }
      if (q.de && DATA.test(q.de)) {
        p.push(q.de);
        f.push(`v.data_entrega >= $${p.length}`);
      }
      if (q.ate && DATA.test(q.ate)) {
        p.push(q.ate);
        f.push(`v.data_entrega <= $${p.length}`);
      }
      const r = await banco.query(`${SELECT_VENDA} WHERE v.empresa_id = $1 ${f.map((x) => `AND ${x}`).join(' ')} ORDER BY v.data_entrega DESC, v.numero DESC LIMIT 500`, p);
      return { vendas: r.rows.map(vendaPublica) };
    });

    app.get<{ Params: { id: string } }>('/vendas/:id', async (req) => {
      const r = await vendaDoUsuario(banco, req, req.params.id);
      const cargas = await banco.query(
        `SELECT c.id, c.numero, c.data_hora, c.volume_m3, c.devolvido_m3, c.status, b.codigo AS betoneira, m.nome AS motorista
           FROM cargas c JOIN veiculos b ON b.id = c.betoneira_id LEFT JOIN motoristas m ON m.id = c.motorista_id
          WHERE c.venda_id = $1 ORDER BY c.data_hora`,
        [r.id],
      );
      const u = req.usuario!;
      const dono = r.vendedor_id === u.id || r.criado_por_id === u.id;
      return {
        venda: vendaPublica(r),
        cargas: cargas.rows.map((c) => ({
          id: c.id, numero: c.numero, dataHora: c.data_hora, volume: Number(c.volume_m3), devolvido: Number(c.devolvido_m3), status: c.status, betoneira: c.betoneira, motorista: c.motorista,
        })),
        pode: {
          editar: ['rascunho', 'reprovada'].includes(r.status) && (dono || gestaoComercial(req)),
          enviar: ['rascunho', 'reprovada'].includes(r.status) && (dono || gestaoComercial(req)),
          aprovar: r.status === 'aguardando_aprovacao' && gestaoComercial(req),
          cancelar: ['rascunho', 'aguardando_aprovacao', 'reprovada'].includes(r.status) ? dono || gestaoComercial(req) : r.status === 'aprovada' && gestaoComercial(req),
        },
      };
    });

    app.post('/vendas', async (req, reply) => {
      const d = esquemaVenda.parse(req.body);
      const empresaId = empresaDo(req);
      const id = await emTransacao(banco, async (c) => {
        const vendedorId = await validar(c, empresaId, req, d);
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`vendas:${empresaId}`]);
        const numero = Number((await c.query('SELECT coalesce(max(numero), 0) + 1 AS n FROM vendas WHERE empresa_id = $1', [empresaId])).rows[0].n);
        const x = (
          await c.query(
            `INSERT INTO vendas (empresa_id, numero, vendedor_id, cliente_id, obra, endereco, contato, traco_id, volume_m3, data_entrega, hora_entrega, bombeamento,
                                 preco_m3_centavos, taxa_bomba_centavos, condicao_pagamento, observacoes, status, enviado_aprovacao_em, criado_por_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
            [empresaId, numero, vendedorId, d.clienteId, d.obra, d.endereco, d.contato, d.tracoId, d.volume, d.dataEntrega, d.horaEntrega, d.bombeamento,
              cent(d.precoM3), d.bombeamento && d.taxaBomba !== null ? cent(d.taxaBomba) : null, d.condicaoPagamento, d.observacoes,
              d.enviar ? 'aguardando_aprovacao' : 'rascunho', d.enviar ? new Date().toISOString() : null, req.usuario!.id],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'vendas', entidadeId: x.id, depois: { ...d, numero } });
        return x.id as string;
      });
      reply.code(201);
      return { venda: vendaPublica(await carregarVenda(banco, empresaId, id)) };
    });

    app.put<{ Params: { id: string } }>('/vendas/:id', async (req) => {
      const d = esquemaVenda.parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const antes = await vendaDoUsuario(c, req, req.params.id);
        if (!['rascunho', 'reprovada'].includes(antes.status)) throw new ErroHttp(409, 'Só dá para alterar a venda em rascunho ou reprovada.');
        const vendedorId = await validar(c, empresaId, req, { ...d, vendedorId: d.vendedorId ?? antes.vendedor_id });
        await c.query(
          `UPDATE vendas SET vendedor_id = $3, cliente_id = $4, obra = $5, endereco = $6, contato = $7, traco_id = $8, volume_m3 = $9, data_entrega = $10, hora_entrega = $11,
                  bombeamento = $12, preco_m3_centavos = $13, taxa_bomba_centavos = $14, condicao_pagamento = $15, observacoes = $16,
                  status = $17, enviado_aprovacao_em = $18, motivo = CASE WHEN $17 = 'aguardando_aprovacao' THEN NULL ELSE motivo END, atualizado_em = now()
            WHERE id = $1 AND empresa_id = $2`,
          [antes.id, empresaId, vendedorId, d.clienteId, d.obra, d.endereco, d.contato, d.tracoId, d.volume, d.dataEntrega, d.horaEntrega, d.bombeamento,
            cent(d.precoM3), d.bombeamento && d.taxaBomba !== null ? cent(d.taxaBomba) : null, d.condicaoPagamento, d.observacoes,
            d.enviar ? 'aguardando_aprovacao' : antes.status, d.enviar ? new Date().toISOString() : antes.enviado_aprovacao_em],
        );
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'vendas', entidadeId: antes.id, antes: vendaPublica(antes), depois: d });
      });
      return { venda: vendaPublica(await carregarVenda(banco, empresaId, req.params.id)) };
    });

    app.post<{ Params: { id: string } }>('/vendas/:id/enviar', async (req) => {
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const v = await vendaDoUsuario(c, req, req.params.id);
        if (!['rascunho', 'reprovada'].includes(v.status)) throw new ErroHttp(409, 'Esta venda já foi enviada.');
        await c.query(`UPDATE vendas SET status = 'aguardando_aprovacao', enviado_aprovacao_em = now(), motivo = NULL, atualizado_em = now() WHERE id = $1`, [v.id]);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'enviar', entidade: 'vendas', entidadeId: v.id });
      });
      return { venda: vendaPublica(await carregarVenda(banco, empresaId, req.params.id)) };
    });

    app.post<{ Params: { id: string } }>('/vendas/:id/aprovar', async (req) => {
      if (!gestaoComercial(req)) throw new ErroHttp(403, 'Só o dono ou o gestor aprova vendas.');
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const v = await carregarVenda(c, empresaId, req.params.id);
        if (v.status !== 'aguardando_aprovacao') throw new ErroHttp(409, 'Esta venda não está aguardando aprovação.');
        await c.query(`UPDATE vendas SET status = 'aprovada', aprovado_por_id = $2, aprovado_em = now(), motivo = NULL, atualizado_em = now() WHERE id = $1`, [v.id, req.usuario!.id]);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'aprovar', entidade: 'vendas', entidadeId: v.id });
      });
      return { venda: vendaPublica(await carregarVenda(banco, empresaId, req.params.id)) };
    });

    app.post<{ Params: { id: string } }>('/vendas/:id/reprovar', async (req) => {
      if (!gestaoComercial(req)) throw new ErroHttp(403, 'Só o dono ou o gestor reprova vendas.');
      const { motivo } = z.object({ motivo: z.string({ required_error: 'Informe o motivo.' }).trim().min(3, 'Informe o motivo.').max(500) }).parse(req.body ?? {});
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const v = await carregarVenda(c, empresaId, req.params.id);
        if (v.status !== 'aguardando_aprovacao') throw new ErroHttp(409, 'Esta venda não está aguardando aprovação.');
        await c.query(`UPDATE vendas SET status = 'reprovada', motivo = $2, atualizado_em = now() WHERE id = $1`, [v.id, motivo]);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'reprovar', entidade: 'vendas', entidadeId: v.id, depois: { motivo } });
      });
      return { venda: vendaPublica(await carregarVenda(banco, empresaId, req.params.id)) };
    });

    app.post<{ Params: { id: string } }>('/vendas/:id/cancelar', async (req) => {
      const { motivo } = z.object({ motivo: z.string({ required_error: 'Informe o motivo.' }).trim().min(3, 'Informe o motivo do cancelamento.').max(500) }).parse(req.body ?? {});
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const v = await vendaDoUsuario(c, req, req.params.id);
        if (['cancelada', 'concluida'].includes(v.status)) throw new ErroHttp(409, 'Esta venda já foi encerrada.');
        if (v.status === 'aprovada' && !gestaoComercial(req)) throw new ErroHttp(403, 'Venda aprovada só o dono ou o gestor cancela.');
        await c.query(`UPDATE vendas SET status = 'cancelada', motivo = $2, atualizado_em = now() WHERE id = $1`, [v.id, motivo]);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'cancelar', entidade: 'vendas', entidadeId: v.id, depois: { motivo } });
      });
      return { venda: vendaPublica(await carregarVenda(banco, empresaId, req.params.id)) };
    });

    // Vendas por vendedor e por cliente (pela data de entrega). Vendido = aprovadas e concluídas; entregue = cargas da venda.
    app.get<{ Querystring: Record<string, string | undefined> }>('/relatorios', async (req) => {
      const empresaId = empresaDo(req);
      const { de, ate } = periodo(req.query);
      const p: unknown[] = [empresaId, de, ate];
      let f = '';
      if (!gestaoComercial(req)) {
        p.push(req.usuario!.id);
        f = `AND v.vendedor_id = $${p.length}`;
      }
      const r = await banco.query(`${SELECT_VENDA} WHERE v.empresa_id = $1 AND v.data_entrega BETWEEN $2 AND $3 ${f} ORDER BY v.data_entrega`, p);
      const vendas = r.rows.map(vendaPublica);
      type Linha = { id: string; nome: string; vendas: number; m3: number; valor: number; entregue: number; pendentes: number; reprovadas: number };
      const agrupar = (chave: (v: (typeof vendas)[number]) => [string, string]) => {
        const m = new Map<string, Linha>();
        for (const v of vendas) {
          const [id, nome] = chave(v);
          const x = m.get(id) ?? { id, nome, vendas: 0, m3: 0, valor: 0, entregue: 0, pendentes: 0, reprovadas: 0 };
          if (v.status === 'aprovada' || v.status === 'concluida') {
            x.vendas++;
            x.m3 = r2(x.m3 + v.volume);
            x.valor = r2(x.valor + v.valorTotal);
            x.entregue = r2(x.entregue + v.entregue);
          } else if (v.status === 'aguardando_aprovacao') x.pendentes++;
          else if (v.status === 'reprovada') x.reprovadas++;
          m.set(id, x);
        }
        return [...m.values()].sort((a, b) => b.valor - a.valor || a.nome.localeCompare(b.nome, 'pt-BR'));
      };
      const porVendedor = agrupar((v) => [v.vendedorId, v.vendedorNome]);
      const porCliente = agrupar((v) => [v.clienteId, v.clienteNome]);
      const total = porVendedor.reduce(
        (s, x) => ({ vendas: s.vendas + x.vendas, m3: r2(s.m3 + x.m3), valor: r2(s.valor + x.valor), entregue: r2(s.entregue + x.entregue), pendentes: s.pendentes + x.pendentes }),
        { vendas: 0, m3: 0, valor: 0, entregue: 0, pendentes: 0 },
      );
      return { de, ate, total, precoMedio: total.m3 ? r2(total.valor / total.m3) : null, porVendedor, porCliente };
    });
  };
}
