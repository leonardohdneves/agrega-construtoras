// Canteiro vertical: ciclo de laje, agenda de guincho e grua por pavimento e consumo de concreto por andar.
// Funções puras (sem banco). Datas em ISO (AAAA-MM-DD); horários em HH:MM.
import { diasEntre } from './acompanhamento.ts';

export const EQUIPAMENTOS_VERTICAIS = ['guincho', 'grua'] as const;
export type EquipamentoVertical = (typeof EQUIPAMENTOS_VERTICAIS)[number];

export const ETAPAS_CICLO = ['formas', 'armacao', 'concretagem', 'cura', 'desforma'] as const;
export type EtapaCiclo = (typeof ETAPAS_CICLO)[number];
export const NOMES_ETAPA: Record<EtapaCiclo, string> = {
  formas: 'Formas',
  armacao: 'Armação',
  concretagem: 'Concretagem',
  cura: 'Cura',
  desforma: 'Desforma',
};

export type EtapaDoCiclo = { etapa: EtapaCiclo; inicio: string; fim: string };
export type ResumoCiclo = {
  etapas: (EtapaDoCiclo & { dias: number })[];
  /** Dias do início da primeira etapa ao fim da última (null sem etapas). */
  diasCiclo: number | null;
};

/** Resume o ciclo de uma laje: dias de cada etapa e dias corridos do ciclo inteiro, na ordem das etapas. */
export function resumirCiclo(etapas: EtapaDoCiclo[]): ResumoCiclo {
  if (!etapas.length) return { etapas: [], diasCiclo: null };
  const ordenadas = [...etapas].sort((a, b) => ETAPAS_CICLO.indexOf(a.etapa) - ETAPAS_CICLO.indexOf(b.etapa));
  const com = ordenadas.map((e) => ({ ...e, dias: diasEntre(e.inicio, e.fim) + 1 }));
  const inicio = com.reduce((m, e) => (e.inicio < m ? e.inicio : m), com[0].inicio);
  const fim = com.reduce((m, e) => (e.fim > m ? e.fim : m), com[0].fim);
  return { etapas: com, diasCiclo: diasEntre(inicio, fim) + 1 };
}

export type ReservaEquipamento = { id: string; equipamento: string; data: string; inicio: string; fim: string };

/** Primeira reserva que se sobrepõe a esta (mesmo equipamento, mesma data, horários que se cruzam). Nula se livre. */
export function conflitoAgenda(nova: Omit<ReservaEquipamento, 'id'>, existentes: ReservaEquipamento[]): ReservaEquipamento | null {
  return existentes.find((e) => e.equipamento === nova.equipamento && e.data === nova.data && nova.inicio < e.fim && nova.fim > e.inicio) ?? null;
}

const arredondar2 = (n: number) => Math.round(n * 100) / 100;

/** Soma do concreto lançado (m³), arredondada em 2 casas. */
export function totalConcreto(volumes: number[]): number {
  return arredondar2(volumes.reduce((soma, v) => soma + v, 0));
}
