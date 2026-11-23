// Kanban das centrais do canteiro: colunas, prioridades e transições da OS. Funções puras, sem banco.

export const COLUNAS_KANBAN = ['planejada', 'liberada', 'em_execucao', 'concluida'] as const;
export type ColunaKanban = (typeof COLUNAS_KANBAN)[number];
export const NOMES_COLUNA: Record<ColunaKanban, string> = {
  planejada: 'Planejada',
  liberada: 'Liberada',
  em_execucao: 'Em execução',
  concluida: 'Concluída',
};

export const PRIORIDADES = ['alta', 'media', 'baixa'] as const;
export type Prioridade = (typeof PRIORIDADES)[number];
export const NOMES_PRIORIDADE: Record<Prioridade, string> = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };

export const STATUS_OS = ['liberada', 'em_execucao', 'concluida', 'cancelada'] as const;
export type StatusOs = (typeof STATUS_OS)[number];

/** Coluna do card: sem OS aberta fica em "Planejada"; com OS, segue o status dela (cancelada volta a "Planejada"). */
export function colunaDoCard(os: { status: string } | null): ColunaKanban {
  if (!os || os.status === 'cancelada') return 'planejada';
  if (os.status === 'liberada') return 'liberada';
  if (os.status === 'em_execucao') return 'em_execucao';
  return 'concluida';
}

/** Próximos status permitidos da OS. Concluída e cancelada não voltam. */
const TRANSICOES: Record<StatusOs, StatusOs[]> = {
  liberada: ['em_execucao', 'cancelada'],
  em_execucao: ['concluida', 'cancelada'],
  concluida: [],
  cancelada: [],
};
export function transicaoPermitida(de: string, para: string): boolean {
  return (TRANSICOES[de as StatusOs] ?? []).includes(para as StatusOs);
}

/** OS aberta é a que ainda não foi concluída nem cancelada: a frente só tem uma por vez. */
export const osAberta = (status: string) => status === 'liberada' || status === 'em_execucao';

/** OS em aberto com o prazo vencido (o prazo é o último dia: vence no dia seguinte). */
export function osAtrasada(os: { status: string; prazo: string | null }, hoje: string): boolean {
  return osAberta(os.status) && !!os.prazo && os.prazo < hoje;
}
