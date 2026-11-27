// Reconhecimento por semelhança: aprende com as associações feitas pelo usuário e sugere
// atividades para elementos parecidos (mesma classe e dimensões aproximadas).
// Estrutura do aprendizado: { [assinatura]: { [atividadeId]: contagem } }

// Assinatura independente de rotação: dimensões horizontais ordenadas + altura, arredondadas.
export function assinatura({ classe, dx, dy, dz }, passo = 0.05) {
  const q = (v) => Math.round(v / passo);
  const a = Math.min(dx, dy), b = Math.max(dx, dy);
  return `${classe}|${q(a)}|${q(b)}|${q(dz)}`;
}

// Registra que o elemento com essa assinatura foi associado à atividade.
export function aprender(aprendizado, assin, atividadeId) {
  if (!aprendizado[assin]) aprendizado[assin] = {};
  aprendizado[assin][atividadeId] = (aprendizado[assin][atividadeId] || 0) + 1;
  return aprendizado;
}

// Sugere atividade para elementos sem vínculo, só quando a assinatura já foi associada
// a uma única atividade (sem divergência). Não altera `vinculos`; devolve as sugestões.
export function sugerir(assinaturasPorGuid, aprendizado, vinculos) {
  const sugestoes = {};
  for (const [guid, assin] of Object.entries(assinaturasPorGuid)) {
    if (vinculos[guid]) continue;
    const obs = aprendizado[assin];
    if (!obs) continue;
    const atividades = Object.keys(obs);
    if (atividades.length === 1) sugestoes[guid] = atividades[0];
  }
  return sugestoes;
}
