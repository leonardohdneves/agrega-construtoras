// Gerencial › Produção da equipe: valor do operador de usina, do gestor de pátio e do vendedor pelas faixas de m³ do mês.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Banco } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';
import { hojeBrasil } from '../lib/frota.ts';
import { calcularFaixas, textoFaixas, validarFaixas, type Faixa, type ModoFaixas } from '../lib/producao-equipe.ts';
import { empresaDo, exigir } from '../sessao.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const DIA_LOCAL = (col: string) => `(${col} AT TIME ZONE 'America/Sao_Paulo')::date`;
const reais = (c: number) => Math.round(c) / 100;
const r2 = (n: number) => Math.round(n * 100) / 100;

export const FUNCOES_EQUIPE = ['operador_usina', 'gestor_patio', 'vendedor'] as const;
type FuncaoEquipe = (typeof FUNCOES_EQUIPE)[number];
const NOMES: Record<FuncaoEquipe, string> = { operador_usina: 'Operador de usina', gestor_patio: 'Gestor de pátio', vendedor: 'Vendedor' };

const numero = (msg: string) =>
  z.union([z.number(), z.string()]).transform((v, ctx) => {
    const n = typeof v === 'number' ? v : Number(String(v).replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: 'custom', message: msg });
      return z.NEVER;
    }
    return n;
  });

const esquemaRegra = z.object({
  funcao: z.enum(FUNCOES_EQUIPE, { errorMap: () => ({ message: 'Escolha a função.' }) }),
  base: z.enum(['usina', 'vendas']).optional().default('usina'),
  modo: z.enum(['progressiva', 'faixa']).optional().default('progressiva'),
  vigencia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data de início.'),
  faixas: z
    .array(z.object({ ate: z.union([numero('Limite inválido.'), z.null()]), valorM3: numero('Valor por m³ inválido.') }))
    .min(1, 'Informe ao menos uma faixa.')
    .max(10, 'Use até 10 faixas.'),
});

function regraPublica(r: Record<string, any>) {
  const faixas = (r.faixas as Faixa[]) ?? [];
  return {
    id: r.id as string,
    funcao: r.funcao as FuncaoEquipe,
    base: r.base as 'usina' | 'vendas',
    modo: r.modo as ModoFaixas,
    vigencia: r.vigencia instanceof Date ? r.vigencia.toISOString().slice(0, 10) : String(r.vigencia).slice(0, 10),
    faixas: faixas.map((f) => ({ ate: f.ate, valorM3: reais(f.valorM3) })),
    texto: textoFaixas(faixas),
    criadoPor: (r.criado_por ?? null) as string | null,
  };
}

function limitesMes(mes: string) {
  const [a, m] = mes.split('-').map(Number);
  const fim = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  return { de: `${mes}-01`, ate: fim };
}

export function rotasProducaoEquipe(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.addHook('preHandler', exigir(banco, 'dono', 'gestor'));

    app.get('/regras-producao', async (req) => {
      const r = await banco.query(
        `SELECT r.*, u.nome AS criado_por FROM regras_producao r LEFT JOIN usuarios u ON u.id = r.criado_por_id WHERE r.empresa_id = $1 ORDER BY r.funcao, r.vigencia DESC`,
        [empresaDo(req)],
      );
      return { regras: r.rows.map(regraPublica) };
    });

    app.post('/regras-producao', async (req, reply) => {
      const d = esquemaRegra.parse(req.body);
      if (d.base === 'vendas' && d.funcao !== 'vendedor') throw new ErroHttp(400, 'A base "vendas do vendedor" só vale para o vendedor.');
      const faixas: Faixa[] = d.faixas.map((f, i) => ({ ate: i === d.faixas.length - 1 ? null : f.ate, valorM3: Math.round(f.valorM3 * 100) }));
      const erro = validarFaixas(faixas);
      if (erro) throw new ErroHttp(400, erro);
      const empresaId = empresaDo(req);
      const x = await emTransacao(banco, async (c) => {
        const n = (
          await c.query(
            `INSERT INTO regras_producao (empresa_id, funcao, base, modo, faixas, vigencia, criado_por_id) VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (empresa_id, funcao, vigencia) DO UPDATE SET base = excluded.base, modo = excluded.modo, faixas = excluded.faixas, criado_por_id = excluded.criado_por_id, criado_em = now()
             RETURNING *`,
            [empresaId, d.funcao, d.base, d.modo, JSON.stringify(faixas), d.vigencia, req.usuario!.id],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'regras_producao', entidadeId: n.id, depois: { ...d, faixas } });
        return n;
      });
      reply.code(201);
      return { regra: regraPublica(x) };
    });

    app.delete<{ Params: { id: string } }>('/regras-producao/:id', async (req) => {
      if (!UUID.test(req.params.id)) throw naoEncontrado('Regra');
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const r = (await c.query('DELETE FROM regras_producao WHERE id = $1 AND empresa_id = $2 RETURNING *', [req.params.id, empresaId])).rows[0];
        if (!r) throw naoEncontrado('Regra');
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'excluir', entidade: 'regras_producao', entidadeId: r.id, antes: r });
      });
      return { ok: true };
    });

    /** Produção do mês por função e pessoa, com o cálculo faixa a faixa. */
    app.get<{ Querystring: { mes?: string } }>('/producao-equipe', async (req) => {
      const empresaId = empresaDo(req);
      const mes = req.query.mes && MES.test(req.query.mes) ? req.query.mes : hojeBrasil().slice(0, 7);
      const { de, ate } = limitesMes(mes);

      const usina = Number(
        (
          await banco.query(
            `SELECT coalesce(sum(volume_m3 - devolvido_m3), 0) AS m3, count(*) AS cargas FROM cargas
              WHERE empresa_id = $1 AND status = 'produzida' AND ${DIA_LOCAL('data_hora')} BETWEEN $2 AND $3`,
            [empresaId, de, ate],
          )
        ).rows[0].m3,
      );
      const regras = (
        await banco.query(
          `SELECT DISTINCT ON (funcao) * FROM regras_producao WHERE empresa_id = $1 AND vigencia <= $2 ORDER BY funcao, vigencia DESC`,
          [empresaId, ate],
        )
      ).rows;
      const colaboradores = (
        await banco.query(
          `SELECT id, nome, funcao FROM motoristas WHERE empresa_id = $1 AND excluido_em IS NULL AND ativo AND funcao IN ('operador_usina', 'gestor_patio') ORDER BY nome`,
          [empresaId],
        )
      ).rows;
      // Vendedores: os usuários com perfil Vendedor e quem teve venda entregue no mês; base = m³ entregues das vendas dele.
      const vendedores = (
        await banco.query(
          `WITH e AS (
             SELECT v.vendedor_id, sum(c.volume_m3 - c.devolvido_m3) AS m3 FROM cargas c JOIN vendas v ON v.id = c.venda_id
              WHERE c.empresa_id = $1 AND c.status = 'produzida' AND ${DIA_LOCAL('c.data_hora')} BETWEEN $2 AND $3 GROUP BY v.vendedor_id
           )
           SELECT u.id, u.nome, coalesce(e.m3, 0) AS m3 FROM usuarios u LEFT JOIN e ON e.vendedor_id = u.id
            WHERE u.empresa_id = $1 AND u.excluido_em IS NULL AND ((u.perfil = 'vendedor' AND u.ativo) OR e.m3 IS NOT NULL)
            ORDER BY u.nome`,
          [empresaId, de, ate],
        )
      ).rows;

      const funcoes = FUNCOES_EQUIPE.map((funcao) => {
        const regra = regras.find((r) => r.funcao === funcao) ?? null;
        const pessoas =
          funcao === 'vendedor'
            ? vendedores.map((v) => ({ id: v.id as string, nome: v.nome as string, vendasM3: Number(v.m3) }))
            : colaboradores.filter((c) => c.funcao === funcao).map((c) => ({ id: c.id as string, nome: c.nome as string, vendasM3: 0 }));
        const linhas = pessoas.map((p) => {
          const baseM3 = r2(regra?.base === 'vendas' ? p.vendasM3 : usina);
          const calc = regra ? calcularFaixas(baseM3, regra.faixas as Faixa[], regra.modo as ModoFaixas) : { valor: 0, partes: [] };
          return {
            id: p.id,
            nome: p.nome,
            baseM3,
            valor: reais(calc.valor),
            partes: calc.partes.map((x) => ({ ...x, valorM3: reais(x.valorM3), valor: reais(x.valor) })),
          };
        });
        return {
          funcao,
          nome: NOMES[funcao],
          regra: regra ? regraPublica(regra) : null,
          pessoas: linhas,
          total: r2(linhas.reduce((s, l) => s + l.valor, 0)),
        };
      });
      return { mes, de, ate, usinaM3: r2(usina), funcoes, total: r2(funcoes.reduce((s, f) => s + f.total, 0)) };
    });
  };
}
