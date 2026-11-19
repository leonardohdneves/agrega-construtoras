// Catálogo de ferramentas do MCP: uma coleção por área, somadas aqui.
import type { Colecao } from './tipos.ts';
import { ferramentasConta } from './conta.ts';
import { ferramentasCadastros } from './cadastros.ts';
import { ferramentasEngenharia } from './engenharia.ts';
import { ferramentasFinanceiro } from './financeiro.ts';
import { ferramentasSuprimentos } from './suprimentos.ts';

/** Áreas do catálogo (P37): a conexão pode expor só algumas (`?grupos=` no endereço ou a ferramenta habilitar_area). */
export const AREAS = ['conta', 'cadastros', 'engenharia', 'suprimentos', 'financeiro'] as const;
export type Area = (typeof AREAS)[number];
const porArea: Record<Area, Colecao> = { conta: ferramentasConta, cadastros: ferramentasCadastros, engenharia: ferramentasEngenharia, suprimentos: ferramentasSuprimentos, financeiro: ferramentasFinanceiro };
const colecoes: Colecao[] = AREAS.map((a) => porArea[a]);

/** Área de cada ferramenta. */
export const areaDaFerramenta: Record<string, Area> = {};
for (const a of AREAS) for (const nome of Object.keys(porArea[a])) areaDaFerramenta[nome] = a;

export const ferramentas: Colecao = {};
for (const c of colecoes) {
  for (const [nome, f] of Object.entries(c)) {
    if (ferramentas[nome]) throw new Error(`Ferramenta repetida entre áreas: ${nome}`);
    ferramentas[nome] = f;
  }
}
