// Catálogo de ferramentas do MCP: uma coleção por área, somadas aqui.
import type { Colecao } from './tipos.ts';
import { ferramentasConta } from './conta.ts';
import { ferramentasCadastros } from './cadastros.ts';
import { ferramentasEngenharia } from './engenharia.ts';
import { ferramentasFinanceiro } from './financeiro.ts';
import { ferramentasSuprimentos } from './suprimentos.ts';

const colecoes: Colecao[] = [ferramentasConta, ferramentasCadastros, ferramentasEngenharia, ferramentasSuprimentos, ferramentasFinanceiro];

export const ferramentas: Colecao = {};
for (const c of colecoes) {
  for (const [nome, f] of Object.entries(c)) {
    if (ferramentas[nome]) throw new Error(`Ferramenta repetida entre áreas: ${nome}`);
    ferramentas[nome] = f;
  }
}
