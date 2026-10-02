import { formatarMoeda, formatarNumero } from '../api';

export type Unidade = 'pct' | 'moeda' | 'km_l' | 'l_h' | 'dias' | 'numero' | 'moeda_km' | 'moeda_l' | 'moeda_h';
export type IndicadorDados = {
  id: string;
  nome: string;
  modulo: 'Frota' | 'Financeiro' | 'Gerencial' | 'Administrativo';
  unidade: Unidade;
  formula: string;
  fonte: string;
  leitura: string;
  melhor: 'maior' | 'menor' | 'neutro';
  retrato: boolean;
  valor: number | null;
  valores: Record<string, number | null> | null;
};
export type RespIndicadores = { meses: string[]; hoje: string; indicadores: IndicadorDados[] };

export function fmtIndicador(v: number | null | undefined, u: Unidade): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  switch (u) {
    case 'pct':
      return `${(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
    case 'moeda':
      return formatarMoeda(v);
    case 'km_l':
      return `${formatarNumero(v, 2)} km/L`;
    case 'l_h':
      return `${formatarNumero(v, 1)} L/h`;
    case 'dias':
      return `${formatarNumero(v, 1)} dias`;
    case 'moeda_km':
      return `${formatarMoeda(v)}/km`;
    case 'moeda_l':
      return `${formatarMoeda(v)}/L`;
    case 'moeda_h':
      return `${formatarMoeda(v)}/h`;
    default:
      return formatarNumero(v);
  }
}

/** Tom do indicador comparando o último mês com o anterior (verde quando melhora). */
export function tendencia(ind: IndicadorDados, meses: string[]): { delta: number | null; tom: 'ok' | 'perigo' | undefined } {
  if (!ind.valores || meses.length < 2) return { delta: null, tom: undefined };
  const a = ind.valores[meses[meses.length - 1]];
  const b = ind.valores[meses[meses.length - 2]];
  if (a === null || b === null || a === undefined || b === undefined || b === 0) return { delta: null, tom: undefined };
  const delta = (a - b) / Math.abs(b);
  if (ind.melhor === 'neutro' || Math.abs(delta) < 0.005) return { delta, tom: undefined };
  const melhorou = ind.melhor === 'maior' ? delta > 0 : delta < 0;
  return { delta, tom: melhorou ? 'ok' : 'perigo' };
}

/** Linha mínima dos últimos meses. */
export function Sparkline({ valores, meses }: { valores: Record<string, number | null> | null; meses: string[] }) {
  if (!valores) return null;
  const pts = meses.map((m) => valores[m]);
  const nums = pts.filter((x): x is number => x !== null && Number.isFinite(x));
  if (nums.length < 2) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const w = 120;
  const h = 32;
  const passo = w / Math.max(pts.length - 1, 1);
  const y = (v: number) => (max === min ? h / 2 : h - 3 - ((v - min) / (max - min)) * (h - 6));
  let d = '';
  pts.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) return;
    d += `${d ? 'L' : 'M'}${(i * passo).toFixed(1)},${y(v).toFixed(1)}`;
  });
  const ult = pts.length - 1;
  const ultimo = pts[ult];
  return (
    <svg className="sparkline" viewBox={`-2 0 ${w + 4} ${h}`} width="100%" height={h} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      {ultimo !== null && Number.isFinite(ultimo) && <circle cx={ult * passo} cy={y(ultimo)} r="3" fill="currentColor" />}
    </svg>
  );
}
