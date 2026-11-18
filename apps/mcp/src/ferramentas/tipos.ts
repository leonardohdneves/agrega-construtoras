import type { z, ZodTypeAny } from 'zod';
import type { ClienteApi } from '../lib/cliente-api.ts';

/** Uma ferramenta do MCP: nome em snake_case, descrição para o modelo, entrada validada por zod e o que ela faz na API. */
export interface Ferramenta<T extends ZodTypeAny = ZodTypeAny> {
  name: string;
  description: string;
  inputSchema: T;
  handler: (args: z.infer<T>, api: ClienteApi) => Promise<unknown>;
}

export type Colecao = Record<string, Ferramenta<any>>;

/** Monta uma ferramenta conferindo, pelo tipo, que o handler recebe o que o esquema descreve. */
export function ferramenta<T extends ZodTypeAny>(def: Ferramenta<T>): Ferramenta<T> {
  return def;
}

/** Junta ferramentas numa coleção indexada pelo nome; nome repetido é erro de programação. */
export function colecao(...ferramentas: Ferramenta<any>[]): Colecao {
  const saida: Colecao = {};
  for (const f of ferramentas) {
    if (saida[f.name]) throw new Error(`Ferramenta repetida: ${f.name}`);
    saida[f.name] = f;
  }
  return saida;
}
