// Atuação do fornecedor (material, mão de obra, equipamento) e o escopo do serviço que ele pode cotar.
export const ATUACOES = ['mat', 'mo', 'eq'] as const;
export type Atuacao = (typeof ATUACOES)[number];

const COMPONENTES: Record<string, Atuacao[]> = {
  mo: ['mo'],
  eq: ['eq'],
  mat: ['mat'],
  mat_mo: ['mat', 'mo'],
  mat_mo_eq: ['mat', 'mo', 'eq'],
  mo_eq: ['mo', 'eq'],
  mat_eq: ['mat', 'eq'],
};

/** Atuações que o fornecedor precisa ter para atender o escopo: qualquer uma delas basta (escopo combinado). Sem escopo, não filtra. */
export function atuacoesDoEscopo(escopo: string | null | undefined): Atuacao[] | null {
  return escopo ? (COMPONENTES[escopo] ?? null) : null;
}

export function fornecedorAtende(atuacao: readonly string[] | null | undefined, escopo: string | null | undefined): boolean {
  const exigidas = atuacoesDoEscopo(escopo);
  if (!exigidas) return true;
  return (atuacao ?? []).some((a) => exigidas.includes(a as Atuacao));
}
