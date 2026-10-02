import { formatarMoeda, formatarNumero } from '../api';

export type Unidade = 'pct' | 'moeda' | 'km_l' | 'l_h' | 'dias' | 'numero' | 'moeda_km' | 'moeda_l' | 'moeda_h' | 'm3' | 'kg_m3' | 'moeda_m3';
export type IndicadorDados = {
  id: string;
  nome: string;
  modulo: 'Frota' | 'Financeiro' | 'Gerencial' | 'Administrativo' | 'Produção' | 'Qualidade';
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
    case 'm3':
      return `${formatarNumero(v, v < 100 ? 1 : 0)} m³`;
    case 'kg_m3':
      return `${formatarNumero(v, 0)} kg/m³`;
    case 'moeda_m3':
      return `${formatarMoeda(v)}/m³`;
    default:
      return formatarNumero(v);
  }
}

