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

/** Código da OS: sequencial único por obra (OS-0001, OS-0002…). */
export const codigoOs = (numero: number) => `OS-${String(numero).padStart(4, '0')}`;

/** Situação de uma tarefa da EAP no canteiro. `sem_central`: a tarefa não está em nenhuma central, então não tem OS. */
export type SituacaoTarefa = 'sem_central' | 'planejada' | 'liberada' | 'em_execucao' | 'concluida';

/** Pela OS mais recente da tarefa (sem OS aberta ou concluída = planejada). */
export function situacaoDaTarefa(naCentral: boolean, os: { status: string } | null): SituacaoTarefa {
  if (!naCentral) return 'sem_central';
  if (!os || os.status === 'cancelada') return 'planejada';
  if (os.status === 'liberada' || os.status === 'em_execucao' || os.status === 'concluida') return os.status;
  return 'planejada';
}

export type PredecessoraTarefa = {
  /** Número da atividade do planejamento (o ID usado nas predecessoras). */
  atividade: number;
  descricao: string;
  eapNoId: string | null;
  /** 1 = predecessora direta; 2 em diante = a predecessora da predecessora. */
  nivel: number;
  situacao: SituacaoTarefa;
  codigoOs: string | null;
};

/** Predecessoras diretas que ainda não terminaram. Tarefa fora das centrais não tem OS: não dá para saber e não conta. */
export function predecessorasPendentes(lista: PredecessoraTarefa[]): PredecessoraTarefa[] {
  return lista.filter((p) => p.nivel === 1 && (p.situacao === 'planejada' || p.situacao === 'liberada' || p.situacao === 'em_execucao'));
}

export type AtividadePlano = { id: string; numero: number; descricao: string; eapNoId: string | null; predecessoraId: string | null };

/** Cadeia de predecessoras de uma atividade, da mais próxima para a mais distante. Para se houver ciclo. */
export function cadeiaDePredecessoras(atividadeId: string, atividades: Map<string, AtividadePlano>, limite = 5): AtividadePlano[] {
  const cadeia: AtividadePlano[] = [];
  const vistas = new Set<string>([atividadeId]);
  let atual = atividades.get(atividadeId)?.predecessoraId ?? null;
  while (atual && !vistas.has(atual) && cadeia.length < limite) {
    const a = atividades.get(atual);
    if (!a) break;
    vistas.add(atual);
    cadeia.push(a);
    atual = a.predecessoraId;
  }
  return cadeia;
}
