// Recursos do canteiro vendidos à parte, somados aos pacotes atuais (ver pacotes.ts). Cada recurso libera um conjunto de
// rotas do canteiro. O canteiro vertical já traz a base do canteiro e as centrais de produção.
export const RECURSOS_CANTEIRO = ['canteiro_horizontal', 'canteiro_vertical', 'centrais'] as const;
export type RecursoCanteiro = (typeof RECURSOS_CANTEIRO)[number];

export const NOMES_RECURSO: Record<RecursoCanteiro, string> = {
  canteiro_horizontal: 'Canteiro horizontal',
  canteiro_vertical: 'Canteiro vertical',
  centrais: 'Centrais de produção',
};

/** Recursos efetivos de um contrato: o canteiro vertical inclui a base e as centrais. */
export function recursosEfetivos(lista: readonly string[] | null | undefined): RecursoCanteiro[] {
  const conjunto = new Set(lista ?? []);
  if (conjunto.has('canteiro_vertical')) {
    conjunto.add('canteiro_horizontal');
    conjunto.add('centrais');
  }
  return RECURSOS_CANTEIRO.filter((r) => conjunto.has(r));
}

/**
 * Recurso exigido por um endereço da API do canteiro (null = a rota não é do canteiro).
 * O caminho chega completo, como em /api/eng/obras/:id/canteiro/... .
 */
export function recursoDaRotaCanteiro(caminho: string): RecursoCanteiro | null {
  if (/^\/api\/eng\/obras\/[^/]+\/canteiro\/vertical(\/|$)/.test(caminho)) return 'canteiro_vertical';
  if (/^\/api\/eng\/obras\/[^/]+\/canteiro\/(centrais|boletins)(\/|$)/.test(caminho)) return 'centrais';
  if (/^\/api\/eng\/obras\/[^/]+\/canteiro(\/|$)/.test(caminho)) return 'canteiro_horizontal';
  return null;
}
