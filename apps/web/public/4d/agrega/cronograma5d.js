// Monta o cronograma do 4D/5D a partir das respostas da API do Agrega (planejamento, EAP e previsto × realizado).
// Atividades "resumo" viram nível 1 (agrupamento); as demais viram nível 2 (folhas do 4D).
// Usado pelo conversor (scripts/converter_agrega.js) e pela tela, quando os dados vêm direto da API.
export function montarCronograma({ atividades = [], nos = [], linhas = [], obraId = null, obra = null, fonte = 'API REST do Agrega' }) {
  const eapPorId = new Map(nos.map((n) => [n.id, n]));
  // Avanço por nó da EAP (percentualExecutado, da previsão × realizado), ligado à atividade pelo eapNoId.
  const avancoPorNo = new Map(linhas.map((l) => [l.id, Math.round(l.percentualExecutado ?? 0)]));
  const tarefas = atividades
    .filter((a) => a.inicio && a.fim)
    .map((a) => ({
      id: a.id,
      parentId: null,
      nivel: a.resumo ? 1 : 2,
      ordem: a.ordem,
      nome: a.descricao,
      eapCodigo: a.eapCodigo,
      eapNoId: a.eapNoId,
      eapTipo: eapPorId.get(a.eapNoId)?.nivel ?? null,
      inicio: a.inicio,
      fim: a.fim,
      duracaoDU: a.duracaoDias,
      progresso: avancoPorNo.get(a.eapNoId) ?? 0,
      critica: a.critica,
      folgaDias: a.folgaDias,
    }));
  return {
    fonte,
    obra,
    obraId,
    totais: { atividades: tarefas.length, folhas: tarefas.filter((t) => t.nivel === 2).length },
    tarefas,
  };
}
