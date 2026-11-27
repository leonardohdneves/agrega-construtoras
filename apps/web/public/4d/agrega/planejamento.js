// Converte o planejamento da API do Agrega (GET /api/eng/obras/:id/planejamento) para o formato de tarefas
// que o visualizador 4D usa. O nível vem do código da EAP (1 = etapa, 2 = subetapa, 3 = tarefa).
// Não depende de rede: a busca usa fetch injetável, para os testes.

/** Nível da linha pelo código da EAP: "1" → 1, "1.2" → 2, "1.2.3" → 3. */
export function nivelDoCodigo(codigo) {
  if (!codigo) return 1;
  return String(codigo).split('.').filter(Boolean).length;
}

/** Código do pai: "1.2.3" → "1.2"; etapa de primeiro nível não tem pai. */
export function codigoDoPai(codigo) {
  const partes = String(codigo ?? '').split('.').filter(Boolean);
  return partes.length > 1 ? partes.slice(0, -1).join('.') : null;
}

/**
 * Atividades da API → tarefas do visualizador. O progresso não vem no planejamento (vem do acompanhamento),
 * então entra como 0; a sincronização de progresso é a fase 5 do plano.
 */
export function tarefasDoPlanejamento(atividades) {
  const idPorCodigo = new Map();
  for (const a of atividades) if (a.eapCodigo) idPorCodigo.set(String(a.eapCodigo), a.id);
  return atividades
    .map((a) => {
      const codigo = a.eapCodigo ? String(a.eapCodigo) : null;
      const paiCodigo = codigo ? codigoDoPai(codigo) : null;
      return {
        id: a.id,
        parentId: paiCodigo ? (idPorCodigo.get(paiCodigo) ?? null) : null,
        nivel: nivelDoCodigo(codigo),
        ordem: a.ordem ?? a.numero ?? 0,
        eapCodigo: codigo,
        nome: a.descricao ?? a.descricaoResumida ?? '',
        inicio: a.inicio,
        fim: a.fim,
        duracaoDU: a.duracaoDias ?? null,
        progresso: 0,
        critica: !!a.critica,
      };
    })
    .filter((t) => t.inicio && t.fim);
}

/**
 * Busca o planejamento da obra. `base` é a origem da API (ex.: https://agrega...app); com `credentials: 'include'`
 * o navegador envia o cookie de sessão do Agrega, então a página precisa estar logada nessa origem.
 */
export async function buscarCronogramaDaObra({ base, obraId, fetchImpl = globalThis.fetch }) {
  const url = `${String(base).replace(/\/+$/, '')}/api/eng/obras/${encodeURIComponent(obraId)}/planejamento`;
  const res = await fetchImpl(url, { credentials: 'include' });
  if (res.status === 401) throw new Error('Sem sessão no Agrega. Entre no Agrega neste navegador e abra o 4D de novo.');
  if (!res.ok) throw new Error(`Não consegui ler o planejamento da obra (HTTP ${res.status}).`);
  const corpo = await res.json();
  return { tarefas: tarefasDoPlanejamento(corpo.atividades ?? []) };
}
