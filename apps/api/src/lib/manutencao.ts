// Regras da manutenção preventiva.
import { diasEntre } from './frota.ts';

export type Plano = { intervaloKm: number | null; intervaloHoras: number | null; intervaloDias: number | null };
export type Ultima = { km: number | null; horas: number | null; data: string | null } | null;
export type Atual = { km: number; horas: number; hoje: string };

export type SituacaoRevisao = 'vencida' | 'proxima' | 'em_dia' | 'sem_registro';

export type Revisao = {
  situacao: SituacaoRevisao;
  proximaKm: number | null;
  proximaHoras: number | null;
  proximaData: string | null;
  faltaKm: number | null;
  faltaHoras: number | null;
  faltaDias: number | null;
  /** Quanto do intervalo já foi usado (0 a 1+), pelo critério que vence primeiro. */
  uso: number | null;
};

/** Considera "próxima" quando faltam 10% do intervalo ou menos. */
export const MARGEM_AVISO = 0.1;

function somarDias(data: string, dias: number): string {
  const d = new Date(Date.UTC(+data.slice(0, 4), +data.slice(5, 7) - 1, +data.slice(8, 10)) + dias * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function situacaoRevisao(plano: Plano, ultima: Ultima, atual: Atual): Revisao {
  const vazio: Revisao = { situacao: 'sem_registro', proximaKm: null, proximaHoras: null, proximaData: null, faltaKm: null, faltaHoras: null, faltaDias: null, uso: null };
  if (!ultima || (ultima.km === null && ultima.horas === null && ultima.data === null)) return vazio;

  const r: Revisao = { ...vazio };
  const usos: number[] = [];
  if (plano.intervaloKm && ultima.km !== null) {
    r.proximaKm = ultima.km + plano.intervaloKm;
    r.faltaKm = Math.round(r.proximaKm - atual.km);
    usos.push((atual.km - ultima.km) / plano.intervaloKm);
  }
  if (plano.intervaloHoras && ultima.horas !== null) {
    r.proximaHoras = ultima.horas + plano.intervaloHoras;
    r.faltaHoras = Math.round((r.proximaHoras - atual.horas) * 10) / 10;
    usos.push((atual.horas - ultima.horas) / plano.intervaloHoras);
  }
  if (plano.intervaloDias && ultima.data) {
    r.proximaData = somarDias(ultima.data, plano.intervaloDias);
    r.faltaDias = diasEntre(atual.hoje, r.proximaData);
    usos.push(diasEntre(ultima.data, atual.hoje) / plano.intervaloDias);
  }
  if (!usos.length) return vazio;
  const uso = Math.max(...usos);
  r.uso = Math.round(uso * 100) / 100;
  r.situacao = uso >= 1 ? 'vencida' : uso >= 1 - MARGEM_AVISO ? 'proxima' : 'em_dia';
  return r;
}

/** Plano padrão de concreteira, aplicado com um clique. */
export const PLANO_PADRAO: { tipo: 'betoneira' | 'bomba_lanca' | 'bomba_estacionaria' | null; item: string; km?: number; horas?: number; dias?: number }[] = [
  { tipo: null, item: 'Troca de óleo do motor e filtro de óleo', km: 15000, horas: 500, dias: 180 },
  { tipo: null, item: 'Filtros de combustível', km: 30000, horas: 1000 },
  { tipo: null, item: 'Filtro de ar', km: 30000, dias: 365 },
  { tipo: null, item: 'Revisão de freios', km: 20000, dias: 180 },
  { tipo: null, item: 'Lubrificação geral do chassi', dias: 15 },
  { tipo: null, item: 'Rodízio e calibragem de pneus', km: 20000 },
  { tipo: 'betoneira', item: 'Óleo do redutor do balão', horas: 2000, dias: 365 },
  { tipo: 'betoneira', item: 'Lubrificação de roletes e pista do balão', dias: 7 },
  { tipo: 'betoneira', item: 'Inspeção de facas e desgaste interno do balão', dias: 90 },
  { tipo: 'betoneira', item: 'Bomba e motor hidráulico do balão', horas: 4000 },
  { tipo: 'bomba_lanca', item: 'Óleo hidráulico e filtros da bomba', horas: 1000, dias: 365 },
  { tipo: 'bomba_lanca', item: 'Pistões e camisas de concreto', horas: 500 },
  { tipo: 'bomba_lanca', item: 'Tubulação e mangotes (espessura)', dias: 30 },
  { tipo: 'bomba_lanca', item: 'Inspeção estrutural da lança e pinos', dias: 90 },
];
