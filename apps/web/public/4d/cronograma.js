// Regras do 4D: status de cada tarefa em uma data, a partir do cronograma exportado do Agrega.
// Módulo puro (sem DOM), usado pelo visualizador e pelos testes.

export const STATUS = {
  NAO_INICIADO: 'nao_iniciado',
  EM_EXECUCAO: 'em_execucao',
  CONCLUIDO: 'concluido',
  ATRASADO: 'atrasado',
};

export const COR = {
  [STATUS.NAO_INICIADO]: 0x9e9e9e,
  [STATUS.EM_EXECUCAO]: 0x1e88e5,
  [STATUS.CONCLUIDO]: 0x43a047,
  [STATUS.ATRASADO]: 0xe53935,
  SEM_VINCULO: 0xd7ccc8,
};

// Datas como 'AAAA-MM-DD' comparam bem como texto.
export function statusNaData(tarefa, data, hoje) {
  if (!tarefa.inicio || !tarefa.fim) return STATUS.NAO_INICIADO;
  if (data < tarefa.inicio) return STATUS.NAO_INICIADO;
  if (data <= tarefa.fim) return STATUS.EM_EXECUCAO;
  // Após o fim previsto, a data animada é passada ou futura. Só é atraso se a data já passou
  // e o ERP ainda não registra 100%; datas futuras mostram o planejado (concluído).
  if (tarefa.progresso >= 100) return STATUS.CONCLUIDO;
  return hoje && data <= hoje ? STATUS.ATRASADO : STATUS.CONCLUIDO;
}

// Limites da animação: do primeiro início ao último fim entre as tarefas folha (nível 2).
export function intervaloDaObra(tarefas) {
  const folhas = tarefas.filter((t) => t.nivel === 2 && t.inicio && t.fim);
  const base = folhas.length ? folhas : tarefas.filter((t) => t.inicio && t.fim);
  const inicio = base.reduce((a, t) => (t.inicio < a ? t.inicio : a), base[0].inicio);
  const fim = base.reduce((a, t) => (t.fim > a ? t.fim : a), base[0].fim);
  return { inicio, fim };
}

// Gera as datas de dias úteis (seg–sex) entre dois limites, para o slider do 4D.
export function diasUteis(inicio, fim) {
  const dias = [];
  const d = new Date(inicio + 'T00:00:00Z');
  const limite = new Date(fim + 'T00:00:00Z');
  while (d <= limite) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) dias.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dias;
}

// Cor de cada elemento IFC: `vinculos` mapeia GlobalId do IFC -> id da subetapa do Agrega.
export function corDoElemento(globalId, vinculos, tarefasPorId, data, hoje) {
  const tarefaId = vinculos[globalId];
  const tarefa = tarefaId && tarefasPorId.get(tarefaId);
  if (!tarefa) return { cor: COR.SEM_VINCULO, status: null, tarefa: null };
  const status = statusNaData(tarefa, data, hoje);
  return { cor: COR[status], status, tarefa };
}
