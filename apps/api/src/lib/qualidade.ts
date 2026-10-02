// Controle tecnológico do concreto: corpos de prova, faixa de slump e fck estimado (NBR 12655).
import type { Cliente } from '../db.ts';
import { somarDias } from './financeiro.ts';

export type ConfigQualidade = { idades: number[]; cpsPorIdade: number; idadeControle: number; diametroMm: number; responsavelNome: string | null; responsavelRegistro: string | null };
export const CONFIG_PADRAO: ConfigQualidade = { idades: [7, 28], cpsPorIdade: 2, idadeControle: 28, diametroMm: 100, responsavelNome: null, responsavelRegistro: null };

export async function lerConfig(c: Cliente, empresaId: string): Promise<ConfigQualidade> {
  const r = (await c.query('SELECT * FROM qualidade_config WHERE empresa_id = $1', [empresaId])).rows[0];
  if (!r) return { ...CONFIG_PADRAO };
  return {
    idades: (r.idades as number[]).map(Number).sort((a, b) => a - b),
    cpsPorIdade: Number(r.cps_por_idade),
    idadeControle: Number(r.idade_controle),
    diametroMm: Number(r.diametro_mm),
    responsavelNome: r.responsavel_nome,
    responsavelRegistro: r.responsavel_registro,
  };
}

/** Resistência em MPa a partir da carga de ruptura da prensa (kN) e do diâmetro do CP (mm). */
export function mpaDeKn(kn: number, diametroMm: number): number {
  const area = Math.PI * (diametroMm / 2) ** 2; // mm²
  return Math.round(((kn * 1000) / area) * 10) / 10;
}

/** Faixa de slump do traço, em cm: "10 ± 2" → [8, 12]; "8 a 12" → [8, 12]; "100 ± 20 mm" → [8, 12]. */
export function faixaSlump(texto: string | null | undefined): [number, number] | null {
  if (!texto) return null;
  const t = texto.replace(/,/g, '.').toLowerCase();
  const mm = /mm/.test(t);
  const conv = (v: number) => (mm || v > 40 ? v / 10 : v);
  let m = t.match(/(\d+(?:\.\d+)?)\s*(?:±|\+\/-|\+-|\+ ?- ?)\s*(\d+(?:\.\d+)?)/);
  if (m) {
    const base = conv(Number(m[1]));
    const tol = conv(Number(m[2]));
    return [Math.round((base - tol) * 10) / 10, Math.round((base + tol) * 10) / 10];
  }
  m = t.match(/(\d+(?:\.\d+)?)\s*(?:a|-|até)\s*(\d+(?:\.\d+)?)/);
  if (m) return [conv(Number(m[1])), conv(Number(m[2]))];
  m = t.match(/^\s*(\d+(?:\.\d+)?)\s*(cm|mm)?\s*$/);
  if (m) {
    const v = conv(Number(m[1]));
    return [v - 2, v + 2];
  }
  return null;
}

/**
 * fck estimado pela amostragem total (todas as betonadas amostradas), NBR 12655:
 * até 20 exemplares, o menor valor; acima de 20, o valor de ordem i = 0,05·n (arredondado para cima), em ordem crescente.
 */
export function fckEstimadoTotal(exemplares: number[]): number | null {
  const v = exemplares.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  if (v.length <= 20) return v[0];
  const i = Math.ceil(0.05 * v.length);
  return v[i - 1];
}

export function desvioPadrao(v: number[]): number | null {
  if (v.length < 2) return null;
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
}

/** Cria a amostra e os corpos de prova de uma carga, pelas idades da configuração. */
export async function criarAmostraCarga(c: Cliente, empresaId: string, cargaId: string, dataHora: string, slump: number | null, moldadoPor: string | null = null): Promise<void> {
  const cfg = await lerConfig(c, empresaId);
  const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(dataHora));
  const a = (
    await c.query(
      `INSERT INTO amostras (empresa_id, carga_id, data_moldagem, slump_cm, moldado_por) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (carga_id) DO UPDATE SET slump_cm = coalesce(excluded.slump_cm, amostras.slump_cm), status = 'ativa', atualizado_em = now()
       RETURNING id`,
      [empresaId, cargaId, dataHora, slump, moldadoPor],
    )
  ).rows[0];
  for (const idade of cfg.idades) {
    for (let n = 1; n <= cfg.cpsPorIdade; n++) {
      await c.query(
        `INSERT INTO corpos_prova (empresa_id, amostra_id, idade_dias, numero, data_prevista) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (amostra_id, idade_dias, numero) DO NOTHING`,
        [empresaId, a.id, idade, n, somarDias(dia, idade)],
      );
    }
  }
}

/** Carga cancelada: a amostra é cancelada e os CPs que ainda não foram rompidos são descartados. */
export async function cancelarAmostraCarga(c: Cliente, cargaId: string): Promise<void> {
  const a = (await c.query(`UPDATE amostras SET status = 'cancelada', atualizado_em = now() WHERE carga_id = $1 RETURNING id`, [cargaId])).rows[0];
  if (!a) return;
  await c.query(`UPDATE corpos_prova SET situacao = 'descartado', observacao = 'Carga cancelada', atualizado_em = now() WHERE amostra_id = $1 AND situacao = 'aguardando'`, [a.id]);
}

/** Data da carga corrigida: as datas de rompimento dos CPs ainda não rompidos acompanham. */
export async function reprogramarAmostra(c: Cliente, cargaId: string, dataHora: string): Promise<void> {
  const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(dataHora));
  const a = (await c.query('UPDATE amostras SET data_moldagem = $2, atualizado_em = now() WHERE carga_id = $1 RETURNING id', [cargaId, dataHora])).rows[0];
  if (!a) return;
  await c.query(`UPDATE corpos_prova SET data_prevista = $2::date + idade_dias, atualizado_em = now() WHERE amostra_id = $1 AND situacao = 'aguardando'`, [a.id, dia]);
}
