// Módulo Qualidade: corpos de prova, resultados, fck estimado, laudo, equipamentos e ensaios de insumos.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Banco, Cliente } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';
import { diasEntre, hojeBrasil } from '../lib/frota.ts';
import { somarDias } from '../lib/financeiro.ts';
import { criarCorposProva, desvioPadrao, faixaSlump, fckEstimadoTotal, lerConfig, mpaDeKn } from '../lib/qualidade.ts';
import { empresaDo, exigir } from '../sessao.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const DIA = (col: string) => `(${col} AT TIME ZONE 'America/Sao_Paulo')::date`;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const r1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
const r2 = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);
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

function periodoDias(q: Record<string, string | undefined>, padraoDias = 60) {
  const hoje = hojeBrasil();
  const de = q.de && DATA.test(q.de) ? q.de : somarDias(hoje, -padraoDias);
  const ate = q.ate && DATA.test(q.ate) ? q.ate : hoje;
  if (ate < de) throw new ErroHttp(400, 'A data final é antes da inicial.');
  if (Date.parse(ate) - Date.parse(de) > 400 * 86_400_000) throw new ErroHttp(400, 'Escolha um período de até 13 meses.');
  return { de, ate, hoje };
}

type LinhaAmostra = {
  slumpEntrega?: number | null;
  amostraId: string; cargaId: string; numero: number; dataHora: string; dia: string; tracoId: string; tracoCodigo: string; fck: number | null; slumpTraco: string | null;
  faixa: [number, number] | null; volume: number; clienteId: string | null; clienteNome: string | null; obra: string | null; betoneiraCodigo: string; documento: string | null;
  slump: number | null; slumpFora: boolean | null; temperatura: number | null; moldadoPor: string | null; observacao: string | null; status: string;
  idades: { idade: number; previsto: string; cps: { id: string; numero: number; resistencia: number | null; situacao: string; dataRuptura: string | null }[]; exemplar: number | null }[];
  resultadoControle: number | null; conforme: boolean | null;
};

/** Amostras do período com os CPs e o exemplar (maior CP) de cada idade. */
async function carregarAmostras(c: Cliente, empresaId: string, filtros: { de: string; ate: string; tracoId?: string | null; clienteId?: string | null; obra?: string | null; amostraId?: string | null }) {
  const cfg = await lerConfig(c, empresaId);
  const p: unknown[] = [empresaId, filtros.de, filtros.ate];
  const extra: string[] = [];
  if (filtros.tracoId) {
    p.push(filtros.tracoId);
    extra.push(`ca.traco_id = $${p.length}`);
  }
  if (filtros.clienteId) {
    p.push(filtros.clienteId);
    extra.push(`ca.cliente_id = $${p.length}`);
  }
  if (filtros.obra !== null && filtros.obra !== undefined) {
    p.push(filtros.obra);
    extra.push(`coalesce(ca.obra, '') = $${p.length}`);
  }
  if (filtros.amostraId) {
    p.push(filtros.amostraId);
    extra.push(`a.id = $${p.length}`);
  }
  const rows = (
    await c.query(
      `SELECT a.*, ca.id AS carga_id, ca.numero, ca.data_hora, ${DIA('ca.data_hora')} AS dia, ca.traco_id, t.codigo AS traco_codigo, t.fck, t.slump AS slump_traco,
              ca.volume_m3, ca.cliente_id, coalesce(cl.nome_fantasia, cl.razao_social) AS cliente_nome, ca.obra, b.codigo AS betoneira_codigo, ca.documento, ca.slump_entrega_cm,
              (SELECT json_agg(json_build_object('id', cp.id, 'idade', cp.idade_dias, 'numero', cp.numero, 'previsto', cp.data_prevista, 'resistencia', cp.resistencia_mpa,
                                                 'situacao', cp.situacao, 'ruptura', cp.data_ruptura) ORDER BY cp.idade_dias, cp.numero)
                 FROM corpos_prova cp WHERE cp.amostra_id = a.id) AS cps
         FROM amostras a JOIN cargas ca ON ca.id = a.carga_id JOIN tracos t ON t.id = ca.traco_id JOIN veiculos b ON b.id = ca.betoneira_id
         LEFT JOIN clientes cl ON cl.id = ca.cliente_id
        WHERE a.empresa_id = $1 AND ${DIA('ca.data_hora')} BETWEEN $2 AND $3 ${extra.map((x) => `AND ${x}`).join(' ')}
        ORDER BY ca.data_hora DESC, ca.numero DESC LIMIT 3000`,
      p,
    )
  ).rows;
  return {
    cfg,
    amostras: rows.map((r): LinhaAmostra => {
      const faixa = faixaSlump(r.slump_traco);
      const slump = num(r.slump_cm);
      const porIdade = new Map<number, LinhaAmostra['idades'][number]>();
      for (const cp of r.cps ?? []) {
        const g = porIdade.get(cp.idade) ?? { idade: cp.idade, previsto: cp.previsto, cps: [], exemplar: null };
        g.cps.push({ id: cp.id, numero: cp.numero, resistencia: num(cp.resistencia), situacao: cp.situacao, dataRuptura: cp.ruptura });
        if (cp.situacao === 'rompido' && cp.resistencia !== null) g.exemplar = Math.max(g.exemplar ?? 0, Number(cp.resistencia));
        porIdade.set(cp.idade, g);
      }
      const controle = porIdade.get(cfg.idadeControle)?.exemplar ?? null;
      return {
        amostraId: r.id,
        cargaId: r.carga_id,
        numero: r.numero,
        dataHora: r.data_hora instanceof Date ? r.data_hora.toISOString() : r.data_hora,
        dia: r.dia,
        tracoId: r.traco_id,
        tracoCodigo: r.traco_codigo,
        fck: num(r.fck),
        slumpTraco: r.slump_traco,
        faixa,
        volume: Number(r.volume_m3),
        clienteId: r.cliente_id,
        clienteNome: r.cliente_nome,
        obra: r.obra,
        betoneiraCodigo: r.betoneira_codigo,
        documento: r.documento,
        slump,
        slumpEntrega: num(r.slump_entrega_cm),
        slumpFora: slump === null || !faixa ? null : slump < faixa[0] || slump > faixa[1],
        temperatura: num(r.temperatura_c),
        moldadoPor: r.moldado_por,
        observacao: r.observacao,
        status: r.status,
        idades: [...porIdade.values()].sort((a, b) => a.idade - b.idade),
        resultadoControle: controle,
        conforme: controle === null || r.fck === null ? null : controle >= Number(r.fck),
      };
    }),
  };
}

/** Agrupa exemplares da idade de controle e calcula média, desvio e fck estimado (amostragem total). */
function resumirGrupo(lista: LinhaAmostra[]) {
  const validas = lista.filter((a) => a.status === 'ativa');
  const res = validas.map((a) => a.resultadoControle).filter((x): x is number => x !== null);
  // fck estimado só faz sentido dentro de uma mesma classe (mesmo fck).
  const fcks = new Set(validas.map((a) => a.fck).filter((x) => x !== null));
  const fck = fcks.size === 1 ? [...fcks][0] : null;
  const fckEst = fcks.size === 1 ? fckEstimadoTotal(res) : null;
  const slumps = validas.filter((a) => a.slumpFora !== null);
  return {
    cargas: validas.length,
    m3: r2(validas.reduce((s, a) => s + a.volume, 0)),
    exemplares: res.length,
    aguardando: validas.length - res.length,
    media: res.length ? r1(res.reduce((s, x) => s + x, 0) / res.length) : null,
    desvio: r2(desvioPadrao(res)),
    minimo: res.length ? Math.min(...res) : null,
    fck,
    fckEstimado: fckEst,
    abaixoFck: validas.filter((a) => a.conforme === false).length,
    conforme: fckEst === null || fck === null ? null : fckEst >= fck,
    slumpMedidos: slumps.length,
    slumpFora: slumps.filter((a) => a.slumpFora).length,
  };
}

export function rotasQualidade(banco: Banco) {
  return async function (app: FastifyInstance) {
    const qualidade = exigir(banco, 'dono', 'gestor', 'laboratorista');
    const gestao = exigir(banco, 'dono', 'gestor');

    // ======================= Configuração =======================
    app.get('/config', { preHandler: qualidade }, async (req) => ({ config: await lerConfig(banco, empresaDo(req)) }));

    app.put('/config', { preHandler: gestao }, async (req) => {
      const d = z
        .object({
          idades: z.array(z.number().int().min(1).max(120)).min(1, 'Informe pelo menos uma idade.').max(5),
          cpsPorIdade: z.number().int().min(1).max(4),
          idadeControle: z.number().int().min(1).max(120),
          diametroMm: z.number().int().min(50).max(200),
          responsavelNome: texto(120),
          responsavelRegistro: texto(60),
        })
        .parse(req.body);
      if (!d.idades.includes(d.idadeControle)) throw new ErroHttp(400, 'A idade de controle precisa estar entre as idades de rompimento.');
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        await c.query(
          `INSERT INTO qualidade_config (empresa_id, idades, cps_por_idade, idade_controle, diametro_mm, responsavel_nome, responsavel_registro) VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (empresa_id) DO UPDATE SET idades = excluded.idades, cps_por_idade = excluded.cps_por_idade, idade_controle = excluded.idade_controle,
             diametro_mm = excluded.diametro_mm, responsavel_nome = excluded.responsavel_nome, responsavel_registro = excluded.responsavel_registro, atualizado_em = now()`,
          [empresaId, [...new Set(d.idades)].sort((a, b) => a - b), d.cpsPorIdade, d.idadeControle, d.diametroMm, d.responsavelNome, d.responsavelRegistro],
        );
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'qualidade_config', entidadeId: empresaId, depois: d });
      });
      return { config: await lerConfig(banco, empresaId) };
    });

    // ======================= Painel do laboratório =======================
    app.get('/painel', { preHandler: qualidade }, async (req) => {
      const empresaId = empresaDo(req);
      const hoje = hojeBrasil();
      const cps = (
        await banco.query(
          `SELECT count(*) FILTER (WHERE data_prevista = $2)::int AS hoje, count(*) FILTER (WHERE data_prevista < $2)::int AS atrasados,
                  count(*) FILTER (WHERE data_prevista = $2::date + 1)::int AS amanha
             FROM corpos_prova WHERE empresa_id = $1 AND situacao = 'aguardando'`,
          [empresaId, hoje],
        )
      ).rows[0];
      const { amostras } = await carregarAmostras(banco, empresaId, { de: somarDias(hoje, -60), ate: hoje });
      const abaixo = amostras.filter((a) => a.conforme === false && a.status === 'ativa');
      const equip = (
        await banco.query(
          `SELECT count(*) FILTER (WHERE ultima_calibracao + validade_dias < $2)::int AS vencidos,
                  count(*) FILTER (WHERE ultima_calibracao + validade_dias BETWEEN $2 AND $2::date + 30)::int AS vencendo
             FROM equipamentos WHERE empresa_id = $1 AND excluido_em IS NULL AND ativo AND ultima_calibracao IS NOT NULL AND validade_dias IS NOT NULL`,
          [empresaId, hoje],
        )
      ).rows[0];
      const umidade = (
        await banco.query(
          `SELECT DISTINCT ON (e.insumo_id) e.insumo_id, i.nome, e.data, e.umidade_pct FROM ensaios_insumos e JOIN insumos i ON i.id = e.insumo_id
            WHERE e.empresa_id = $1 AND e.tipo = 'umidade' ORDER BY e.insumo_id, e.data DESC, e.criado_em DESC`,
          [empresaId],
        )
      ).rows.map((x) => ({ insumoId: x.insumo_id, nome: x.nome, data: x.data, umidade: num(x.umidade_pct) }));
      const pend = (await banco.query(`SELECT count(*)::int AS n FROM amostras a JOIN cargas ca ON ca.id = a.carga_id WHERE a.empresa_id = $1 AND a.status = 'pendente' AND ca.status = 'produzida'`, [empresaId])).rows[0].n;
      return {
        hoje,
        pendentes: pend,
        cps: { hoje: cps.hoje, atrasados: cps.atrasados, amanha: cps.amanha },
        abaixoFck: abaixo.slice(0, 20).map((a) => ({ amostraId: a.amostraId, numero: a.numero, dia: a.dia, tracoCodigo: a.tracoCodigo, fck: a.fck, resultado: a.resultadoControle, clienteNome: a.clienteNome, obra: a.obra })),
        equipamentos: { vencidos: equip.vencidos, vencendo: equip.vencendo },
        umidade,
      };
    });

    // ======================= Corpos de prova a romper =======================
    app.get<{ Querystring: { ate?: string } }>('/cps', { preHandler: qualidade }, async (req) => {
      const empresaId = empresaDo(req);
      const hoje = hojeBrasil();
      const ate = req.query.ate && DATA.test(req.query.ate) ? req.query.ate : hoje;
      const cfg = await lerConfig(banco, empresaId);
      const r = await banco.query(
        `SELECT cp.*, a.slump_cm, ca.numero AS carga_numero, ca.data_hora, t.codigo AS traco_codigo, t.fck, coalesce(cl.nome_fantasia, cl.razao_social) AS cliente_nome, ca.obra,
                b.codigo AS betoneira_codigo,
                (SELECT max(x.resistencia_mpa) FROM corpos_prova x WHERE x.amostra_id = a.id AND x.situacao = 'rompido' AND x.idade_dias < cp.idade_dias) AS anterior
           FROM corpos_prova cp JOIN amostras a ON a.id = cp.amostra_id JOIN cargas ca ON ca.id = a.carga_id JOIN tracos t ON t.id = ca.traco_id
           JOIN veiculos b ON b.id = ca.betoneira_id LEFT JOIN clientes cl ON cl.id = ca.cliente_id
          WHERE cp.empresa_id = $1 AND cp.situacao = 'aguardando' AND cp.data_prevista <= $2 AND a.status = 'ativa'
          ORDER BY cp.data_prevista, ca.numero, cp.idade_dias, cp.numero LIMIT 600`,
        [empresaId, ate],
      );
      return {
        hoje,
        ate,
        diametroMm: cfg.diametroMm,
        cps: r.rows.map((x) => ({
          id: x.id,
          amostraId: x.amostra_id,
          idade: x.idade_dias,
          numero: x.numero,
          previsto: x.data_prevista,
          atraso: Math.max(0, diasEntre(x.data_prevista, hoje)),
          cargaNumero: x.carga_numero,
          moldagem: x.data_hora instanceof Date ? x.data_hora.toISOString() : x.data_hora,
          tracoCodigo: x.traco_codigo,
          fck: num(x.fck),
          clienteNome: x.cliente_nome,
          obra: x.obra,
          betoneiraCodigo: x.betoneira_codigo,
          slump: num(x.slump_cm),
          anterior: num(x.anterior),
        })),
      };
    });

    app.post('/cps/resultados', { preHandler: qualidade }, async (req) => {
      const d = z
        .object({
          data: z.string().regex(DATA).optional(),
          itens: z
            .array(
              z.object({
                cpId: z.string().uuid(),
                resistencia: decimal('Resistência inválida.').nullable().optional(),
                cargaKn: decimal('Carga inválida.').nullable().optional(),
                tipoRuptura: texto(30),
                descartar: z.boolean().optional(),
                observacao: texto(200),
              }),
            )
            .min(1)
            .max(400),
        })
        .parse(req.body);
      const empresaId = empresaDo(req);
      const hoje = hojeBrasil();
      const data = d.data ?? hoje;
      if (data > hoje) throw new ErroHttp(400, 'A data do rompimento não pode ser futura.');
      const cfg = await lerConfig(banco, empresaId);
      let gravados = 0;
      await emTransacao(banco, async (c) => {
        for (const it of d.itens) {
          const cp = (await c.query('SELECT cp.*, a.data_moldagem FROM corpos_prova cp JOIN amostras a ON a.id = cp.amostra_id WHERE cp.id = $1 AND cp.empresa_id = $2', [it.cpId, empresaId])).rows[0];
          if (!cp) throw naoEncontrado('Corpo de prova');
          if (it.descartar) {
            await c.query(`UPDATE corpos_prova SET situacao = 'descartado', observacao = $2, rompido_por_id = $3, atualizado_em = now() WHERE id = $1`, [cp.id, it.observacao ?? 'Descartado', req.usuario!.id]);
            gravados++;
            continue;
          }
          const mpa = it.resistencia ?? (it.cargaKn ? mpaDeKn(it.cargaKn, cfg.diametroMm) : null);
          if (mpa === null || mpa === undefined) continue;
          if (!(mpa > 0 && mpa < 200)) throw new ErroHttp(400, 'Resistência fora do esperado. Confira o valor (em MPa).');
          await c.query(
            `UPDATE corpos_prova SET situacao = 'rompido', resistencia_mpa = $2, carga_kn = $3, tipo_ruptura = $4, observacao = $5, data_ruptura = $6, rompido_por_id = $7, atualizado_em = now()
              WHERE id = $1`,
            [cp.id, Math.round(mpa * 10) / 10, it.cargaKn ?? null, it.tipoRuptura, it.observacao, data, req.usuario!.id],
          );
          gravados++;
        }
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'corpos_prova', entidadeId: empresaId, depois: { data, itens: d.itens.length } });
      });
      return { gravados };
    });

    /** Correção de um resultado já lançado (volta a "aguardando" se vier sem resistência). */
    app.patch<{ Params: { id: string } }>('/cps/:id', { preHandler: qualidade }, async (req) => {
      const d = z.object({ resistencia: decimal('Resistência inválida.').nullable(), dataRuptura: z.string().regex(DATA).optional(), observacao: texto(200) }).parse(req.body);
      const empresaId = empresaDo(req);
      if (!UUID.test(req.params.id)) throw naoEncontrado('Corpo de prova');
      await emTransacao(banco, async (c) => {
        const antes = (await c.query('SELECT * FROM corpos_prova WHERE id = $1 AND empresa_id = $2', [req.params.id, empresaId])).rows[0];
        if (!antes) throw naoEncontrado('Corpo de prova');
        if (d.resistencia === null) {
          await c.query(`UPDATE corpos_prova SET situacao = 'aguardando', resistencia_mpa = NULL, carga_kn = NULL, data_ruptura = NULL, observacao = $2, atualizado_em = now() WHERE id = $1`, [antes.id, d.observacao]);
        } else {
          if (!(d.resistencia > 0 && d.resistencia < 200)) throw new ErroHttp(400, 'Resistência fora do esperado.');
          await c.query(
            `UPDATE corpos_prova SET situacao = 'rompido', resistencia_mpa = $2, data_ruptura = coalesce($3, data_ruptura, $4), observacao = $5, rompido_por_id = $6, atualizado_em = now() WHERE id = $1`,
            [antes.id, d.resistencia, d.dataRuptura ?? null, hojeBrasil(), d.observacao, req.usuario!.id],
          );
        }
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'corpos_prova', entidadeId: antes.id, antes, depois: d });
      });
      return { ok: true };
    });

    // ======================= Amostras e resultados =======================
    app.get<{ Querystring: Record<string, string | undefined> }>('/amostras', { preHandler: qualidade }, async (req) => {
      const empresaId = empresaDo(req);
      const { de, ate } = periodoDias(req.query, 30);
      const id = (k: string) => (req.query[k] && UUID.test(req.query[k]!) ? req.query[k]! : null);
      const { cfg, amostras } = await carregarAmostras(banco, empresaId, { de, ate, tracoId: id('tracoId'), clienteId: id('clienteId'), obra: req.query.obra ?? null });
      return { de, ate, idades: cfg.idades, idadeControle: cfg.idadeControle, amostras, resumo: resumirGrupo(amostras) };
    });

    app.patch<{ Params: { id: string } }>('/amostras/:id', { preHandler: qualidade }, async (req) => {
      const d = z
        .object({
          slump: decimal('Slump inválido.').refine((n) => n >= 0 && n <= 30, 'Slump entre 0 e 30 cm.').nullable().optional(),
          temperatura: decimal('Temperatura inválida.').nullable().optional(),
          moldadoPor: texto(80),
          observacao: texto(300),
        })
        .partial()
        .parse(req.body);
      const empresaId = empresaDo(req);
      if (!UUID.test(req.params.id)) throw naoEncontrado('Amostra');
      await emTransacao(banco, async (c) => {
        const antes = (await c.query('SELECT * FROM amostras WHERE id = $1 AND empresa_id = $2', [req.params.id, empresaId])).rows[0];
        if (!antes) throw naoEncontrado('Amostra');
        await c.query(
          `UPDATE amostras SET slump_cm = CASE WHEN $2 THEN $3 ELSE slump_cm END, temperatura_c = CASE WHEN $4 THEN $5 ELSE temperatura_c END,
                  moldado_por = CASE WHEN $6 THEN $7 ELSE moldado_por END, observacao = CASE WHEN $8 THEN $9 ELSE observacao END, atualizado_em = now()
            WHERE id = $1`,
          [antes.id, 'slump' in d, d.slump ?? null, 'temperatura' in d, d.temperatura ?? null, 'moldadoPor' in d, d.moldadoPor ?? null, 'observacao' in d, d.observacao ?? null],
        );
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'amostras', entidadeId: antes.id, antes, depois: d });
      });
      return { ok: true };
    });

    // ======================= Demandas: cargas a amostrar =======================
    /** Cada carga registrada vira uma demanda; o laboratório confirma a moldagem ou marca "não amostrada". */
    app.get<{ Querystring: Record<string, string | undefined> }>('/demandas', { preHandler: qualidade }, async (req) => {
      const empresaId = empresaDo(req);
      const { de, ate } = periodoDias(req.query, 7);
      const r = await banco.query(
        `SELECT a.id, a.status, a.slump_cm, a.temperatura_c, a.moldado_por, a.observacao, a.confirmada_em, uc.nome AS confirmada_por,
                ca.id AS carga_id, ca.numero, ca.data_hora, ca.volume_m3, ca.obra, ca.slump_entrega_cm, ca.descarga_em, t.codigo AS traco_codigo, t.fck, t.slump AS slump_traco,
                coalesce(cl.nome_fantasia, cl.razao_social) AS cliente_nome, b.codigo AS betoneira_codigo, m.nome AS motorista_nome
           FROM amostras a JOIN cargas ca ON ca.id = a.carga_id JOIN tracos t ON t.id = ca.traco_id JOIN veiculos b ON b.id = ca.betoneira_id
           LEFT JOIN clientes cl ON cl.id = ca.cliente_id LEFT JOIN motoristas m ON m.id = ca.motorista_id LEFT JOIN usuarios uc ON uc.id = a.confirmada_por_id
          WHERE a.empresa_id = $1 AND ca.status = 'produzida'
            AND (a.status = 'pendente' OR ${DIA('ca.data_hora')} BETWEEN $2 AND $3)
          ORDER BY (a.status = 'pendente') DESC, ca.data_hora DESC LIMIT 500`,
        [empresaId, de, ate],
      );
      const itens = r.rows.map((x) => ({
        amostraId: x.id, status: x.status as 'pendente' | 'ativa' | 'nao_amostrada' | 'cancelada', cargaId: x.carga_id, numero: x.numero,
        dataHora: x.data_hora instanceof Date ? x.data_hora.toISOString() : x.data_hora, volume: Number(x.volume_m3), tracoCodigo: x.traco_codigo, fck: num(x.fck),
        slumpTraco: x.slump_traco, clienteNome: x.cliente_nome, obra: x.obra, betoneiraCodigo: x.betoneira_codigo, motoristaNome: x.motorista_nome,
        slump: num(x.slump_cm), slumpEntrega: num(x.slump_entrega_cm), temperatura: num(x.temperatura_c), moldadoPor: x.moldado_por, observacao: x.observacao,
        confirmadaEm: x.confirmada_em, confirmadaPor: x.confirmada_por, entregue: !!x.descarga_em,
      }));
      return { de, ate, itens, pendentes: itens.filter((i) => i.status === 'pendente').length };
    });

    app.post<{ Params: { id: string } }>('/amostras/:id/confirmar', { preHandler: qualidade }, async (req) => {
      const d = z
        .object({
          dataMoldagem: z.string().optional().nullable(),
          slump: decimal('Slump inválido.').refine((n) => n >= 0 && n <= 30, 'Slump entre 0 e 30 cm.').nullable().optional(),
          temperatura: decimal('Temperatura inválida.').nullable().optional(),
          moldadoPor: texto(80),
          observacao: texto(300),
        })
        .parse(req.body ?? {});
      const empresaId = empresaDo(req);
      if (!UUID.test(req.params.id)) throw naoEncontrado('Amostra');
      const cps = await emTransacao(banco, async (c) => {
        const a = (await c.query('SELECT a.*, ca.data_hora FROM amostras a JOIN cargas ca ON ca.id = a.carga_id WHERE a.id = $1 AND a.empresa_id = $2 FOR UPDATE OF a', [req.params.id, empresaId])).rows[0];
        if (!a) throw naoEncontrado('Amostra');
        if (a.status !== 'pendente' && a.status !== 'nao_amostrada') throw new ErroHttp(409, 'Esta amostra já foi confirmada.');
        const quando = d.dataMoldagem ? new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(d.dataMoldagem) ? d.dataMoldagem : `${d.dataMoldagem}-03:00`) : new Date(a.data_hora);
        if (Number.isNaN(quando.getTime())) throw new ErroHttp(400, 'Data da moldagem inválida.');
        await c.query(
          `UPDATE amostras SET status = 'ativa', data_moldagem = $2, slump_cm = coalesce($3, slump_cm), temperatura_c = coalesce($4, temperatura_c),
                  moldado_por = coalesce($5, moldado_por, $7), observacao = $6, confirmada_em = now(), confirmada_por_id = $8, atualizado_em = now() WHERE id = $1`,
          [a.id, quando.toISOString(), d.slump ?? null, d.temperatura ?? null, d.moldadoPor, d.observacao, req.usuario!.nome, req.usuario!.id],
        );
        const n = await criarCorposProva(c, empresaId, a.id, quando.toISOString());
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'confirmar', entidade: 'amostras', entidadeId: a.id, depois: { ...d, cps: n } });
        return n;
      });
      return { ok: true, cps };
    });

    app.post<{ Params: { id: string } }>('/amostras/:id/nao-amostrar', { preHandler: qualidade }, async (req) => {
      const { motivo } = z.object({ motivo: z.string({ required_error: 'Informe o motivo.' }).trim().min(3, 'Informe o motivo.').max(300) }).parse(req.body ?? {});
      const empresaId = empresaDo(req);
      if (!UUID.test(req.params.id)) throw naoEncontrado('Amostra');
      await emTransacao(banco, async (c) => {
        const a = (await c.query('SELECT * FROM amostras WHERE id = $1 AND empresa_id = $2', [req.params.id, empresaId])).rows[0];
        if (!a) throw naoEncontrado('Amostra');
        if (a.status !== 'pendente') throw new ErroHttp(409, 'Só demandas pendentes podem ser marcadas como não amostradas.');
        await c.query(`UPDATE amostras SET status = 'nao_amostrada', observacao = $2, confirmada_em = now(), confirmada_por_id = $3, atualizado_em = now() WHERE id = $1`, [a.id, motivo, req.usuario!.id]);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'nao_amostrar', entidade: 'amostras', entidadeId: a.id, depois: { motivo } });
      });
      return { ok: true };
    });

    // ======================= Rastreabilidade da carga =======================
    /** Busca pela número da carga. */
    app.get<{ Querystring: { numero?: string } }>('/rastreabilidade', { preHandler: qualidade }, async (req) => {
      const empresaId = empresaDo(req);
      const n = Number(req.query.numero);
      if (!Number.isInteger(n) || n <= 0) throw new ErroHttp(400, 'Informe o número da carga.');
      const r = (await banco.query('SELECT id FROM cargas WHERE empresa_id = $1 AND numero = $2', [empresaId, n])).rows[0];
      if (!r) throw new ErroHttp(404, `Carga nº ${n} não encontrada.`);
      return montarRastreabilidade(banco, empresaId, r.id);
    });

    app.get<{ Params: { cargaId: string } }>('/rastreabilidade/:cargaId', { preHandler: qualidade }, async (req) => {
      const empresaId = empresaDo(req);
      if (!UUID.test(req.params.cargaId)) throw naoEncontrado('Carga');
      return montarRastreabilidade(banco, empresaId, req.params.cargaId);
    });

    // ======================= Resistência e fck estimado =======================
    app.get<{ Querystring: Record<string, string | undefined> }>('/resistencia', { preHandler: qualidade }, async (req) => {
      const empresaId = empresaDo(req);
      const { de, ate } = periodoDias(req.query, 90);
      const { cfg, amostras } = await carregarAmostras(banco, empresaId, { de, ate });
      const grupos = <K extends string>(chave: (a: LinhaAmostra) => K) => {
        const m = new Map<K, LinhaAmostra[]>();
        for (const a of amostras) m.set(chave(a), [...(m.get(chave(a)) ?? []), a]);
        return m;
      };
      const porTraco = [...grupos((a) => a.tracoCodigo).entries()].map(([traco, l]) => ({ traco, ...resumirGrupo(l) })).sort((a, b) => a.traco.localeCompare(b.traco));
      const porObra = [...grupos((a) => `${a.clienteNome ?? 'Sem cliente'}|${a.obra ?? ''}|${a.tracoCodigo}`).entries()]
        .map(([k, l]) => {
          const [cliente, obra, traco] = k.split('|');
          return { cliente, clienteId: l[0].clienteId, obra, traco, ...resumirGrupo(l) };
        })
        .sort((a, b) => a.cliente.localeCompare(b.cliente, 'pt-BR') || a.obra.localeCompare(b.obra) || a.traco.localeCompare(b.traco));
      // Relação 7 dias / 28 dias (ou a primeira idade sobre a de controle), por traço.
      const idadeInicial = cfg.idades[0];
      const evolucao = porTraco.map((g) => {
        const l = amostras.filter((a) => a.tracoCodigo === g.traco && a.status === 'ativa');
        const pares = l
          .map((a) => [a.idades.find((i) => i.idade === idadeInicial)?.exemplar ?? null, a.resultadoControle] as const)
          .filter((x): x is readonly [number, number] => x[0] !== null && x[1] !== null);
        return { traco: g.traco, relacao: pares.length ? r2(pares.reduce((s, [a, b]) => s + a / b, 0) / pares.length) : null, pares: pares.length };
      });
      return { de, ate, idadeControle: cfg.idadeControle, idadeInicial, geral: resumirGrupo(amostras), porTraco, porObra, evolucao };
    });

    // ======================= Laudo para o cliente =======================
    app.get<{ Querystring: Record<string, string | undefined> }>('/obras', { preHandler: qualidade }, async (req) => {
      const empresaId = empresaDo(req);
      const r = await banco.query(
        `SELECT ca.cliente_id, coalesce(cl.nome_fantasia, cl.razao_social) AS cliente, coalesce(ca.obra, '') AS obra, count(*)::int AS cargas,
                min(${DIA('ca.data_hora')}) AS primeira, max(${DIA('ca.data_hora')}) AS ultima
           FROM cargas ca JOIN amostras a ON a.carga_id = ca.id LEFT JOIN clientes cl ON cl.id = ca.cliente_id
          WHERE ca.empresa_id = $1 AND ca.status = 'produzida' AND ca.cliente_id IS NOT NULL
          GROUP BY 1, 2, 3 ORDER BY max(ca.data_hora) DESC LIMIT 300`,
        [empresaId],
      );
      return { obras: r.rows.map((x) => ({ clienteId: x.cliente_id, cliente: x.cliente, obra: x.obra, cargas: x.cargas, primeira: x.primeira, ultima: x.ultima })) };
    });

    app.get<{ Querystring: Record<string, string | undefined> }>('/laudo', { preHandler: qualidade }, async (req) => {
      const empresaId = empresaDo(req);
      const clienteId = req.query.clienteId && UUID.test(req.query.clienteId) ? req.query.clienteId : null;
      if (!clienteId) throw new ErroHttp(400, 'Escolha o cliente e a obra.');
      const { de, ate } = periodoDias(req.query, 120);
      const { cfg, amostras } = await carregarAmostras(banco, empresaId, { de, ate, clienteId, obra: req.query.obra ?? '' });
      const ativas = amostras.filter((a) => a.status === 'ativa').reverse();
      const tracos = [...new Set(ativas.map((a) => a.tracoCodigo))].map((t) => ({ traco: t, ...resumirGrupo(ativas.filter((a) => a.tracoCodigo === t)) }));
      const cliente = (await banco.query('SELECT razao_social, nome_fantasia, cnpj_cpf FROM clientes WHERE id = $1 AND empresa_id = $2', [clienteId, empresaId])).rows[0];
      if (!cliente) throw naoEncontrado('Cliente');
      return {
        de,
        ate,
        idades: cfg.idades,
        idadeControle: cfg.idadeControle,
        responsavel: { nome: cfg.responsavelNome, registro: cfg.responsavelRegistro },
        cliente: { razaoSocial: cliente.razao_social, nomeFantasia: cliente.nome_fantasia, documento: cliente.cnpj_cpf },
        obra: req.query.obra ?? '',
        amostras: ativas,
        tracos,
        pendentes: ativas.filter((a) => a.resultadoControle === null).length,
      };
    });

    // ======================= Equipamentos =======================
    const esquemaEquip = z.object({
      nome: z.string({ required_error: 'Informe o nome.' }).trim().min(2, 'Informe o nome.').max(120),
      tipo: z.enum(['balanca', 'prensa', 'cone_slump', 'termometro', 'molde', 'outro']).optional().default('outro'),
      identificacao: texto(80),
      ultimaCalibracao: z.union([z.string().regex(DATA, 'Data inválida.'), z.literal(''), z.null()]).optional().transform((v) => v || null),
      validadeDias: z.union([z.number().int().positive().max(3650), z.null()]).optional(),
      certificado: texto(80),
      laboratorio: texto(120),
      observacoes: texto(500),
      ativo: z.boolean().optional().default(true),
    });
    const equipPublico = (e: Record<string, any>, hoje: string) => {
      const proxima = e.ultima_calibracao && e.validade_dias ? somarDias(e.ultima_calibracao, Number(e.validade_dias)) : null;
      const dias = proxima ? diasEntre(hoje, proxima) : null;
      return {
        id: e.id, nome: e.nome, tipo: e.tipo, identificacao: e.identificacao, ultimaCalibracao: e.ultima_calibracao, validadeDias: num(e.validade_dias),
        proximaCalibracao: proxima, dias, situacao: dias === null ? 'sem_data' : dias < 0 ? 'vencido' : dias <= 30 ? 'vencendo' : 'em_dia',
        certificado: e.certificado, laboratorio: e.laboratorio, observacoes: e.observacoes, ativo: e.ativo,
      };
    };
    app.get('/equipamentos', { preHandler: qualidade }, async (req) => {
      const r = await banco.query('SELECT * FROM equipamentos WHERE empresa_id = $1 AND excluido_em IS NULL ORDER BY ativo DESC, tipo, nome', [empresaDo(req)]);
      const hoje = hojeBrasil();
      return { equipamentos: r.rows.map((e) => equipPublico(e, hoje)) };
    });
    app.post('/equipamentos', { preHandler: qualidade }, async (req, reply) => {
      const d = esquemaEquip.parse(req.body);
      const empresaId = empresaDo(req);
      const e = await emTransacao(banco, async (c) => {
        const x = (
          await c.query(
            `INSERT INTO equipamentos (empresa_id, nome, tipo, identificacao, ultima_calibracao, validade_dias, certificado, laboratorio, observacoes, ativo)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
            [empresaId, d.nome, d.tipo, d.identificacao, d.ultimaCalibracao, d.validadeDias ?? null, d.certificado, d.laboratorio, d.observacoes, d.ativo],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'equipamentos', entidadeId: x.id, depois: d });
        return x;
      });
      return reply.code(201).send({ equipamento: equipPublico(e, hojeBrasil()) });
    });
    app.patch<{ Params: { id: string } }>('/equipamentos/:id', { preHandler: qualidade }, async (req) => {
      const d = esquemaEquip.partial().strict().parse(req.body);
      const empresaId = empresaDo(req);
      if (!UUID.test(req.params.id)) throw naoEncontrado('Equipamento');
      const e = await emTransacao(banco, async (c) => {
        const antes = (await c.query('SELECT * FROM equipamentos WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL', [req.params.id, empresaId])).rows[0];
        if (!antes) throw naoEncontrado('Equipamento');
        const col: Record<string, string> = { nome: 'nome', tipo: 'tipo', identificacao: 'identificacao', ultimaCalibracao: 'ultima_calibracao', validadeDias: 'validade_dias', certificado: 'certificado', laboratorio: 'laboratorio', observacoes: 'observacoes', ativo: 'ativo' };
        const sets: string[] = [];
        const vals: unknown[] = [];
        for (const [k, v] of Object.entries(d)) {
          if (v === undefined || !col[k]) continue;
          vals.push(v);
          sets.push(`${col[k]} = $${vals.length + 1}`);
        }
        const x = sets.length ? (await c.query(`UPDATE equipamentos SET ${sets.join(', ')}, atualizado_em = now() WHERE id = $1 RETURNING *`, [antes.id, ...vals])).rows[0] : antes;
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'equipamentos', entidadeId: antes.id, antes, depois: d });
        return x;
      });
      return { equipamento: equipPublico(e, hojeBrasil()) };
    });

    // ======================= Ensaios de insumos =======================
    app.get<{ Querystring: Record<string, string | undefined> }>('/ensaios', { preHandler: qualidade }, async (req) => {
      const empresaId = empresaDo(req);
      const { de, ate } = periodoDias(req.query, 30);
      const r = await banco.query(
        `SELECT e.*, i.nome AS insumo_nome, i.tipo AS insumo_tipo, u.nome AS registrado_por FROM ensaios_insumos e JOIN insumos i ON i.id = e.insumo_id
           LEFT JOIN usuarios u ON u.id = e.registrado_por_id
          WHERE e.empresa_id = $1 AND e.data BETWEEN $2 AND $3 ORDER BY e.data DESC, e.criado_em DESC LIMIT 500`,
        [empresaId, de, ate],
      );
      // Correção de água e areia de cada traço pela última umidade de cada areia.
      const umid = (
        await banco.query(
          `SELECT DISTINCT ON (e.insumo_id) e.insumo_id, e.umidade_pct, e.data FROM ensaios_insumos e
            WHERE e.empresa_id = $1 AND e.tipo = 'umidade' ORDER BY e.insumo_id, e.data DESC, e.criado_em DESC`,
          [empresaId],
        )
      ).rows;
      const itens = (
        await banco.query(
          `SELECT t.codigo, t.id AS traco_id, i.id AS insumo_id, i.tipo, i.nome, i.unidade, ti.quantidade
             FROM tracos t JOIN tracos_itens ti ON ti.traco_id = t.id JOIN insumos i ON i.id = ti.insumo_id
            WHERE t.empresa_id = $1 AND t.ativo AND t.excluido_em IS NULL ORDER BY t.codigo`,
          [empresaId],
        )
      ).rows;
      const correcoes = [...new Set(itens.map((x) => x.codigo as string))].map((codigo) => {
        const l = itens.filter((x) => x.codigo === codigo);
        const agua = l.find((x) => x.tipo === 'agua');
        let aguaNaAreia = 0;
        const areias = l
          .filter((x) => x.tipo === 'areia' && x.unidade === 'kg')
          .map((x) => {
            const u = umid.find((y) => y.insumo_id === x.insumo_id);
            const pct = u ? Number(u.umidade_pct) : null;
            const seca = Number(x.quantidade);
            const agua_ = pct === null ? 0 : (seca * pct) / 100;
            aguaNaAreia += agua_;
            return { nome: x.nome, seca, umidade: pct, data: u?.data ?? null, umida: pct === null ? null : Math.round(seca + agua_) };
          });
        return {
          traco: codigo,
          areias,
          aguaTraco: agua ? Number(agua.quantidade) : null,
          aguaCorrigida: agua && areias.some((a) => a.umidade !== null) ? Math.round(Number(agua.quantidade) - aguaNaAreia) : null,
        };
      });
      return {
        de,
        ate,
        ensaios: r.rows.map((e) => ({
          id: e.id, insumoId: e.insumo_id, insumoNome: e.insumo_nome, insumoTipo: e.insumo_tipo, data: e.data, tipo: e.tipo, umidade: num(e.umidade_pct),
          moduloFinura: num(e.modulo_finura), dimensaoMaxima: num(e.dimensao_maxima_mm), pulverulento: num(e.pulverulento_pct), observacao: e.observacao, registradoPor: e.registrado_por,
        })),
        correcoes,
      };
    });
    app.post('/ensaios', { preHandler: qualidade }, async (req, reply) => {
      const d = z
        .object({
          insumoId: z.string().uuid('Escolha o insumo.'),
          data: z.string().regex(DATA, 'Informe a data.'),
          tipo: z.enum(['umidade', 'granulometria']),
          umidade: decimal('Umidade inválida.').nullable().optional(),
          moduloFinura: decimal('Módulo de finura inválido.').nullable().optional(),
          dimensaoMaxima: decimal('Dimensão máxima inválida.').nullable().optional(),
          pulverulento: decimal('Material pulverulento inválido.').nullable().optional(),
          observacao: texto(300),
        })
        .parse(req.body);
      if (d.tipo === 'umidade' && (d.umidade === null || d.umidade === undefined || d.umidade < 0 || d.umidade > 40)) throw new ErroHttp(400, 'Informe a umidade em % (0 a 40).');
      if (d.tipo === 'granulometria' && d.moduloFinura == null && d.dimensaoMaxima == null && d.pulverulento == null) throw new ErroHttp(400, 'Informe pelo menos um resultado da granulometria.');
      if (d.data > hojeBrasil()) throw new ErroHttp(400, 'A data não pode ser futura.');
      const empresaId = empresaDo(req);
      const id = await emTransacao(banco, async (c) => {
        if (!(await c.query('SELECT 1 FROM insumos WHERE id = $1 AND empresa_id = $2', [d.insumoId, empresaId])).rowCount) throw new ErroHttp(400, 'Insumo não encontrado.');
        const x = (
          await c.query(
            `INSERT INTO ensaios_insumos (empresa_id, insumo_id, data, tipo, umidade_pct, modulo_finura, dimensao_maxima_mm, pulverulento_pct, observacao, registrado_por_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
            [empresaId, d.insumoId, d.data, d.tipo, d.umidade ?? null, d.moduloFinura ?? null, d.dimensaoMaxima ?? null, d.pulverulento ?? null, d.observacao, req.usuario!.id],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'ensaios_insumos', entidadeId: x.id, depois: d });
        return x.id as string;
      });
      return reply.code(201).send({ id });
    });
    app.delete<{ Params: { id: string } }>('/ensaios/:id', { preHandler: qualidade }, async (req) => {
      const empresaId = empresaDo(req);
      if (!UUID.test(req.params.id)) throw naoEncontrado('Ensaio');
      await emTransacao(banco, async (c) => {
        const antes = (await c.query('DELETE FROM ensaios_insumos WHERE id = $1 AND empresa_id = $2 RETURNING *', [req.params.id, empresaId])).rows[0];
        if (!antes) throw naoEncontrado('Ensaio');
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'excluir', entidade: 'ensaios_insumos', entidadeId: antes.id, antes });
      });
      return { ok: true };
    });
  };
}

/** Linha do tempo da carga: venda → aprovação → carga → saída/chegada/descarga → amostra → CPs → resultados → conformidade. */
export async function montarRastreabilidade(c: Cliente, empresaId: string, cargaId: string) {
  const ca = (
    await c.query(
      `SELECT ca.*, t.codigo AS traco_codigo, t.descricao AS traco_descricao, t.fck, t.slump AS slump_traco, coalesce(cl.nome_fantasia, cl.razao_social) AS cliente_nome,
              b.codigo AS betoneira_codigo, b.placa AS betoneira_placa, m.nome AS motorista_nome, bo.codigo AS bomba_codigo, o.nome AS operador_nome, u.nome AS registrado_por
         FROM cargas ca JOIN tracos t ON t.id = ca.traco_id JOIN veiculos b ON b.id = ca.betoneira_id LEFT JOIN clientes cl ON cl.id = ca.cliente_id
         LEFT JOIN motoristas m ON m.id = ca.motorista_id LEFT JOIN veiculos bo ON bo.id = ca.bomba_id LEFT JOIN motoristas o ON o.id = ca.operador_bomba_id
         LEFT JOIN usuarios u ON u.id = ca.registrado_por_id
        WHERE ca.id = $1 AND ca.empresa_id = $2`,
      [cargaId, empresaId],
    )
  ).rows[0];
  if (!ca) throw naoEncontrado('Carga');
  const venda = ca.venda_id
    ? (
        await c.query(
          `SELECT v.numero, v.status, v.criado_em, v.enviado_aprovacao_em, v.aprovado_em, v.volume_m3, v.data_entrega, uv.nome AS vendedor, ua.nome AS aprovado_por
             FROM vendas v JOIN usuarios uv ON uv.id = v.vendedor_id LEFT JOIN usuarios ua ON ua.id = v.aprovado_por_id WHERE v.id = $1`,
          [ca.venda_id],
        )
      ).rows[0]
    : null;
  const consumo = (
    await c.query(
      `SELECT i.nome, i.unidade, cc.quantidade FROM cargas_consumo cc JOIN insumos i ON i.id = cc.insumo_id WHERE cc.carga_id = $1
        ORDER BY CASE i.tipo WHEN 'cimento' THEN 1 WHEN 'areia' THEN 2 WHEN 'brita' THEN 3 WHEN 'agua' THEN 4 ELSE 5 END, i.nome`,
      [cargaId],
    )
  ).rows.map((x) => ({ nome: x.nome, unidade: x.unidade, quantidade: Number(x.quantidade) }));
  const am = (await c.query('SELECT a.*, u.nome AS confirmada_por FROM amostras a LEFT JOIN usuarios u ON u.id = a.confirmada_por_id WHERE a.carga_id = $1', [cargaId])).rows[0] ?? null;
  const cps = am
    ? (
        await c.query(
          `SELECT cp.idade_dias, cp.numero, cp.data_prevista, cp.data_ruptura, cp.resistencia_mpa, cp.situacao, cp.observacao, u.nome AS rompido_por
             FROM corpos_prova cp LEFT JOIN usuarios u ON u.id = cp.rompido_por_id WHERE cp.amostra_id = $1 ORDER BY cp.idade_dias, cp.numero`,
          [am.id],
        )
      ).rows
    : [];
  const cfg = await lerConfig(c, empresaId);
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null));
  const porIdade = new Map<number, number | null>();
  for (const cp of cps) if (cp.situacao === 'rompido' && cp.resistencia_mpa !== null) porIdade.set(cp.idade_dias, Math.max(porIdade.get(cp.idade_dias) ?? 0, Number(cp.resistencia_mpa)));
  const controle = porIdade.get(cfg.idadeControle) ?? null;
  const fck = num(ca.fck);
  const faixa = faixaSlump(ca.slump_traco);
  const fora = (v: number | null) => (v === null || !faixa ? null : v < faixa[0] || v > faixa[1]);
  type Evento = { quando: string | null; etapa: string; titulo: string; detalhe: string | null; situacao: 'ok' | 'aviso' | 'perigo' | 'pendente' };
  const ev: Evento[] = [];
  if (venda) {
    ev.push({ quando: iso(venda.criado_em), etapa: 'venda', titulo: `Venda nº ${String(venda.numero).padStart(4, '0')} lançada`, detalhe: `por ${venda.vendedor} · ${Number(venda.volume_m3).toLocaleString('pt-BR')} m³ para ${String(venda.data_entrega).split('-').reverse().join('/')}`, situacao: 'ok' });
    if (venda.aprovado_em) ev.push({ quando: iso(venda.aprovado_em), etapa: 'venda', titulo: 'Venda aprovada', detalhe: venda.aprovado_por ? `por ${venda.aprovado_por}` : null, situacao: 'ok' });
  }
  ev.push({
    quando: iso(ca.criado_em), etapa: 'usina', titulo: `Carga nº ${ca.numero} registrada`,
    detalhe: `${Number(ca.volume_m3).toLocaleString('pt-BR')} m³ de ${ca.traco_codigo} · ${ca.betoneira_codigo}${ca.motorista_nome ? ` · ${ca.motorista_nome}` : ''}${ca.registrado_por ? ` · por ${ca.registrado_por}` : ''}${ca.carga_final ? ' · carga final da venda' : ''}`,
    situacao: ca.status === 'cancelada' ? 'perigo' : 'ok',
  });
  const s1 = num(am?.slump_cm);
  if (s1 !== null) ev.push({ quando: iso(ca.data_hora), etapa: 'usina', titulo: `Slump na usina: ${s1.toLocaleString('pt-BR')} cm`, detalhe: faixa ? `faixa do traço ${faixa[0]} a ${faixa[1]} cm` : null, situacao: fora(s1) ? 'aviso' : 'ok' });
  ev.push({ quando: iso(ca.saida_em) ?? iso(ca.data_hora), etapa: 'transporte', titulo: 'Saída da usina', detalhe: ca.saida_em ? 'confirmada pelo motorista' : 'hora da carga', situacao: 'ok' });
  ev.push({ quando: iso(ca.chegada_em), etapa: 'transporte', titulo: 'Chegada na obra', detalhe: ca.obra ?? ca.cliente_nome, situacao: ca.chegada_em ? 'ok' : 'pendente' });
  const s2 = num(ca.slump_entrega_cm);
  ev.push({
    quando: iso(ca.descarga_em), etapa: 'transporte', titulo: 'Descarga concluída',
    detalhe: [s2 !== null ? `slump na obra ${s2.toLocaleString('pt-BR')} cm` : null, Number(ca.devolvido_m3) > 0 ? `voltou ${Number(ca.devolvido_m3).toLocaleString('pt-BR')} m³` : null, ca.obs_motorista].filter(Boolean).join(' · ') || null,
    situacao: !ca.descarga_em ? 'pendente' : fora(s2) || Number(ca.devolvido_m3) > 0 ? 'aviso' : 'ok',
  });
  if (am) {
    if (am.status === 'pendente') ev.push({ quando: null, etapa: 'qualidade', titulo: 'Amostra aguardando o laboratório', detalhe: 'O laboratório confirma a moldagem dos corpos de prova.', situacao: 'pendente' });
    else if (am.status === 'nao_amostrada') ev.push({ quando: iso(am.confirmada_em), etapa: 'qualidade', titulo: 'Carga não amostrada', detalhe: [am.observacao, am.confirmada_por ? `por ${am.confirmada_por}` : null].filter(Boolean).join(' · '), situacao: 'aviso' });
    else if (am.status === 'cancelada') ev.push({ quando: iso(am.atualizado_em), etapa: 'qualidade', titulo: 'Amostra cancelada com a carga', detalhe: null, situacao: 'perigo' });
    else {
      ev.push({ quando: iso(am.data_moldagem), etapa: 'qualidade', titulo: `Moldagem de ${cps.length} corpos de prova`, detalhe: [am.moldado_por ? `por ${am.moldado_por}` : null, am.temperatura_c !== null ? `${Number(am.temperatura_c).toLocaleString('pt-BR')} °C` : null, am.confirmada_por ? `confirmada por ${am.confirmada_por}` : null].filter(Boolean).join(' · ') || null, situacao: 'ok' });
      const idades = [...new Set(cps.map((x) => x.idade_dias as number))];
      for (const idade of idades) {
        const lista = cps.filter((x) => x.idade_dias === idade);
        const rompidos = lista.filter((x) => x.situacao === 'rompido');
        const ex = porIdade.get(idade) ?? null;
        if (!rompidos.length) {
          ev.push({ quando: null, etapa: 'qualidade', titulo: `Ruptura aos ${idade} dias`, detalhe: `prevista para ${String(lista[0].data_prevista).split('-').reverse().join('/')}`, situacao: 'pendente' });
        } else {
          ev.push({
            quando: rompidos[0].data_ruptura ? `${rompidos[0].data_ruptura}T12:00:00-03:00` : null, etapa: 'qualidade', titulo: `Ruptura aos ${idade} dias: ${ex?.toLocaleString('pt-BR')} MPa`,
            detalhe: rompidos.map((x) => `CP ${x.numero}: ${Number(x.resistencia_mpa).toLocaleString('pt-BR')} MPa`).join(' · ') + (rompidos[0].rompido_por ? ` · por ${rompidos[0].rompido_por}` : ''),
            situacao: idade === cfg.idadeControle && fck !== null && ex !== null && ex < fck ? 'perigo' : 'ok',
          });
        }
      }
    }
  }
  const conformidade = controle === null || fck === null ? null : controle >= fck;
  return {
    carga: {
      id: ca.id, numero: ca.numero, dataHora: iso(ca.data_hora), status: ca.status, volume: Number(ca.volume_m3), devolvido: Number(ca.devolvido_m3), tracoCodigo: ca.traco_codigo,
      tracoDescricao: ca.traco_descricao, fck, slumpTraco: ca.slump_traco, clienteNome: ca.cliente_nome, obra: ca.obra, betoneira: ca.betoneira_codigo, placa: ca.betoneira_placa,
      motorista: ca.motorista_nome, bomba: ca.bomba_codigo, operadorBomba: ca.operador_nome, documento: ca.documento, cargaFinal: ca.carga_final, vendaId: ca.venda_id,
      vendaNumero: venda?.numero ?? null, slumpUsina: s1, slumpEntrega: s2,
    },
    consumo,
    amostra: am ? { id: am.id, status: am.status } : null,
    idadeControle: cfg.idadeControle,
    resultadoControle: controle,
    conformidade,
    eventos: ev,
  };
}
