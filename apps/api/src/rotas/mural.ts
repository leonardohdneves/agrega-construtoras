// Mural de avisos: comunicação interna da equipe, aniversariantes do mês e ranking de produção (blocos configurados pelo dono).
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Banco, Cliente } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';
import { hojeBrasil } from '../lib/frota.ts';
import { PERFIS_EMPRESA } from '../lib/perfis.ts';
import { empresaDo, exigir } from '../sessao.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const DIA = (col: string) => `(${col} AT TIME ZONE 'America/Sao_Paulo')::date`;
const r1 = (n: number) => Math.round(n * 10) / 10;

export const RANKINGS = ['motoristas_m3', 'bomba_m3', 'vendedores_m3', 'vendedores_valor'] as const;
type Ranking = (typeof RANKINGS)[number];
const TITULO_RANKING: Record<Ranking, string> = {
  motoristas_m3: 'Motoristas · m³ entregues',
  bomba_m3: 'Operadores de bomba · m³ bombeados',
  vendedores_m3: 'Vendedores · m³ entregues',
  vendedores_valor: 'Vendedores · valor vendido',
};

export type ConfigMural = { aniversariantes: boolean; ranking: boolean; rankings: Ranking[]; posicoes: number };
const PADRAO: ConfigMural = { aniversariantes: true, ranking: true, rankings: ['motoristas_m3', 'vendedores_m3'], posicoes: 5 };

export function lerConfigMural(json: unknown): ConfigMural {
  const j = (json ?? {}) as Partial<ConfigMural>;
  return {
    aniversariantes: j.aniversariantes ?? PADRAO.aniversariantes,
    ranking: j.ranking ?? PADRAO.ranking,
    rankings: (j.rankings ?? PADRAO.rankings).filter((r): r is Ranking => (RANKINGS as readonly string[]).includes(r)),
    posicoes: Math.min(10, Math.max(3, Number(j.posicoes ?? PADRAO.posicoes) || PADRAO.posicoes)),
  };
}

const podePublicar = (req: FastifyRequest) => ['dono', 'gestor'].includes(req.usuario!.perfil) || !!req.usuario!.administrador;

const esquemaAviso = z.object({
  titulo: z.string({ required_error: 'Informe o título.' }).trim().min(3, 'Informe o título.').max(120),
  texto: z.string({ required_error: 'Escreva o aviso.' }).trim().min(3, 'Escreva o aviso.').max(3000),
  perfis: z.array(z.enum(PERFIS_EMPRESA)).max(10).optional().nullable().transform((v) => (v && v.length ? v : null)),
  fixado: z.boolean().optional().default(false),
  ate: z.union([z.string().regex(DATA, 'Data inválida.'), z.literal(''), z.null()]).optional().transform((v) => v || null),
});

function avisoPublico(r: Record<string, any>) {
  return {
    id: r.id as string,
    titulo: r.titulo as string,
    texto: r.texto as string,
    perfis: (r.perfis ?? null) as string[] | null,
    fixado: !!r.fixado,
    ate: r.ate ? String(r.ate).slice(0, 10) : null,
    autor: (r.autor ?? null) as string | null,
    criadoEm: r.criado_em instanceof Date ? r.criado_em.toISOString() : r.criado_em,
    excluidoEm: r.excluido_em ?? null,
  };
}

async function rankings(c: Cliente, empresaId: string, cfg: ConfigMural, de: string, ate: string) {
  const out: { id: Ranking; titulo: string; unidade: 'm3' | 'moeda'; linhas: { nome: string; valor: number }[] }[] = [];
  for (const id of cfg.rankings) {
    let sql = '';
    if (id === 'motoristas_m3')
      sql = `SELECT m.nome, sum(c.volume_m3 - c.devolvido_m3) AS valor FROM cargas c JOIN motoristas m ON m.id = c.motorista_id
              WHERE c.empresa_id = $1 AND c.status = 'produzida' AND ${DIA('c.data_hora')} BETWEEN $2 AND $3 GROUP BY m.nome`;
    else if (id === 'bomba_m3')
      sql = `SELECT m.nome, sum(c.volume_bombeado_m3) AS valor FROM cargas c JOIN motoristas m ON m.id = c.operador_bomba_id
              WHERE c.empresa_id = $1 AND c.status = 'produzida' AND coalesce(c.volume_bombeado_m3, 0) > 0 AND ${DIA('c.data_hora')} BETWEEN $2 AND $3 GROUP BY m.nome`;
    else if (id === 'vendedores_m3')
      sql = `SELECT u.nome, sum(c.volume_m3 - c.devolvido_m3) AS valor FROM cargas c JOIN vendas v ON v.id = c.venda_id JOIN usuarios u ON u.id = v.vendedor_id
              WHERE c.empresa_id = $1 AND c.status = 'produzida' AND ${DIA('c.data_hora')} BETWEEN $2 AND $3 GROUP BY u.nome`;
    else
      sql = `SELECT u.nome, sum(round(v.volume_m3 * v.preco_m3_centavos) + coalesce(v.taxa_bomba_centavos, 0)) / 100.0 AS valor FROM vendas v JOIN usuarios u ON u.id = v.vendedor_id
              WHERE v.empresa_id = $1 AND v.status IN ('aprovada', 'concluida') AND v.data_entrega BETWEEN $2 AND $3 GROUP BY u.nome`;
    const r = await c.query(`${sql} ORDER BY valor DESC NULLS LAST LIMIT ${cfg.posicoes}`, [empresaId, de, ate]);
    out.push({
      id,
      titulo: TITULO_RANKING[id],
      unidade: id === 'vendedores_valor' ? 'moeda' : 'm3',
      linhas: r.rows.filter((x) => Number(x.valor) > 0).map((x) => ({ nome: x.nome, valor: id === 'vendedores_valor' ? Math.round(Number(x.valor) * 100) / 100 : r1(Number(x.valor)) })),
    });
  }
  return out;
}

export function rotasMural(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.addHook('preHandler', exigir(banco));

    app.get('/painel', async (req) => {
      const empresaId = empresaDo(req);
      const hoje = hojeBrasil();
      const mes = hoje.slice(0, 7);
      const [a, m] = mes.split('-').map(Number);
      const fim = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
      const cfg = lerConfigMural((await banco.query('SELECT mural FROM empresas WHERE id = $1', [empresaId])).rows[0]?.mural);
      const avisos = (
        await banco.query(
          `SELECT a.*, u.nome AS autor FROM avisos a LEFT JOIN usuarios u ON u.id = a.criado_por_id
            WHERE a.empresa_id = $1 AND a.excluido_em IS NULL AND (a.ate IS NULL OR a.ate >= $2) AND (a.perfis IS NULL OR $3 = ANY(a.perfis) OR $4)
            ORDER BY a.fixado DESC, a.criado_em DESC LIMIT 30`,
          [empresaId, hoje, req.usuario!.perfil, podePublicar(req)],
        )
      ).rows.map(avisoPublico);
      const aniversariantes = cfg.aniversariantes
        ? (
            await banco.query(
              `SELECT nome, cargo, funcao, extract(day FROM data_nascimento)::int AS dia FROM motoristas
                WHERE empresa_id = $1 AND excluido_em IS NULL AND ativo AND data_nascimento IS NOT NULL AND extract(month FROM data_nascimento) = $2
                ORDER BY 4, nome`,
              [empresaId, m],
            )
          ).rows.map((x) => ({ nome: x.nome as string, cargo: (x.cargo ?? null) as string | null, dia: x.dia as number, hoje: x.dia === Number(hoje.slice(8, 10)) }))
        : [];
      return {
        mes,
        config: cfg,
        podePublicar: podePublicar(req),
        podeConfigurar: req.usuario!.perfil === 'dono',
        avisos,
        aniversariantes,
        rankings: cfg.ranking ? await rankings(banco, empresaId, cfg, `${mes}-01`, fim) : [],
      };
    });

    app.post('/avisos', async (req, reply) => {
      if (!podePublicar(req)) throw new ErroHttp(403, 'Só o dono, o gestor e os administradores publicam avisos.');
      const d = esquemaAviso.parse(req.body);
      const empresaId = empresaDo(req);
      const r = await emTransacao(banco, async (c) => {
        const x = (
          await c.query(
            `INSERT INTO avisos (empresa_id, titulo, texto, perfis, fixado, ate, criado_por_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [empresaId, d.titulo, d.texto, d.perfis, d.fixado, d.ate, req.usuario!.id],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'avisos', entidadeId: x.id, depois: d });
        return x;
      });
      reply.code(201);
      return { aviso: avisoPublico({ ...r, autor: req.usuario!.nome }) };
    });

    app.put<{ Params: { id: string } }>('/avisos/:id', async (req) => {
      if (!podePublicar(req)) throw new ErroHttp(403, 'Só o dono, o gestor e os administradores alteram avisos.');
      const d = esquemaAviso.parse(req.body);
      const empresaId = empresaDo(req);
      if (!UUID.test(req.params.id)) throw naoEncontrado('Aviso');
      await emTransacao(banco, async (c) => {
        const antes = (await c.query('SELECT * FROM avisos WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL', [req.params.id, empresaId])).rows[0];
        if (!antes) throw naoEncontrado('Aviso');
        await c.query('UPDATE avisos SET titulo = $2, texto = $3, perfis = $4, fixado = $5, ate = $6, atualizado_em = now() WHERE id = $1', [antes.id, d.titulo, d.texto, d.perfis, d.fixado, d.ate]);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'avisos', entidadeId: antes.id, antes, depois: d });
      });
      return { ok: true };
    });

    /** Tira do mural; o aviso continua no relatório como excluído. */
    app.delete<{ Params: { id: string } }>('/avisos/:id', async (req) => {
      if (!podePublicar(req)) throw new ErroHttp(403, 'Só o dono, o gestor e os administradores tiram avisos do mural.');
      const empresaId = empresaDo(req);
      if (!UUID.test(req.params.id)) throw naoEncontrado('Aviso');
      await emTransacao(banco, async (c) => {
        const r = (await c.query('UPDATE avisos SET excluido_em = now(), excluido_por_id = $3 WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL RETURNING id', [req.params.id, empresaId, req.usuario!.id])).rows[0];
        if (!r) throw naoEncontrado('Aviso');
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'excluir', entidade: 'avisos', entidadeId: r.id });
      });
      return { ok: true };
    });

    app.put('/config', async (req) => {
      if (req.usuario!.perfil !== 'dono') throw new ErroHttp(403, 'Só o dono configura o mural.');
      const d = z
        .object({
          aniversariantes: z.boolean(),
          ranking: z.boolean(),
          rankings: z.array(z.enum(RANKINGS)).max(RANKINGS.length),
          posicoes: z.number().int().min(3, 'De 3 a 10 posições.').max(10, 'De 3 a 10 posições.'),
        })
        .parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        await c.query('UPDATE empresas SET mural = $2, atualizado_em = now() WHERE id = $1', [empresaId, JSON.stringify(d)]);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'empresas', entidadeId: empresaId, depois: { mural: d } });
      });
      return { config: lerConfigMural(d) };
    });

    /** Relatório: todos os avisos do período, inclusive os que já saíram do mural. */
    app.get<{ Querystring: Record<string, string | undefined> }>('/relatorio', async (req) => {
      const empresaId = empresaDo(req);
      const hoje = hojeBrasil();
      const de = req.query.de && DATA.test(req.query.de) ? req.query.de : `${hoje.slice(0, 7)}-01`;
      const ate = req.query.ate && DATA.test(req.query.ate) ? req.query.ate : hoje;
      if (ate < de) throw new ErroHttp(400, 'A data final é antes da inicial.');
      const r = await banco.query(
        `SELECT a.*, u.nome AS autor, ue.nome AS excluido_por FROM avisos a LEFT JOIN usuarios u ON u.id = a.criado_por_id LEFT JOIN usuarios ue ON ue.id = a.excluido_por_id
          WHERE a.empresa_id = $1 AND ${DIA('a.criado_em')} BETWEEN $2 AND $3 AND (a.perfis IS NULL OR $4 = ANY(a.perfis) OR $5)
          ORDER BY a.criado_em DESC LIMIT 2000`,
        [empresaId, de, ate, req.usuario!.perfil, podePublicar(req)],
      );
      return { de, ate, avisos: r.rows.map((x) => ({ ...avisoPublico(x), excluidoPor: x.excluido_por ?? null })) };
    });
  };
}
