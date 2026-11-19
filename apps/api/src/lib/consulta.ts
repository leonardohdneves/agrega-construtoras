// Leitura da query string com zod (P17). Filtro inválido responde 400 no mesmo formato do corpo ({ erro, campos }),
// em vez de ser ignorado em silêncio e devolver outro período ou a lista sem filtro.
import { z } from 'zod';

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Vazio na query (`?x=`) conta como não informado. */
const vazio = (v: unknown) => (v === '' ? undefined : v);

/** Data AAAA-MM-DD opcional. */
export const diaQuery = (campo: string) =>
  z.preprocess(vazio, z.string().regex(DIA, `${campo}: use a data no formato AAAA-MM-DD.`).refine((s) => !Number.isNaN(Date.parse(s)), `${campo}: data inválida.`).optional());

/** Id opcional. */
export const idQuery = (campo: string) => z.preprocess(vazio, z.string().regex(UUID, `${campo}: id inválido.`).optional());

/** Um dos valores aceitos, opcional. */
export const opcaoQuery = <T extends readonly [string, ...string[]]>(campo: string, valores: T) =>
  z.preprocess(vazio, z.enum(valores, { errorMap: () => ({ message: `${campo}: use ${valores.join(', ')}.` }) }).optional());

/** Sinalizador "1" / "0" (ou true / false), opcional, lido como booleano. */
export const flagQuery = (campo: string) =>
  z.preprocess(vazio, z.enum(['1', '0', 'true', 'false'], { errorMap: () => ({ message: `${campo}: use 1 ou 0.` }) }).optional().transform((v) => v === '1' || v === 'true'));

/**
 * Lê a query com o esquema. Parâmetros que o esquema não conhece são ignorados (o navegador e o MCP mandam extras),
 * mas os conhecidos precisam ser válidos.
 */
export function lerQuery<T extends z.ZodRawShape>(campos: T, q: unknown) {
  const r = z.object(campos).parse(q ?? {});
  return r;
}

/** Período com `ate` inclusivo: confere a ordem e o tamanho máximo, em dias. */
export function conferirPeriodo(de: string, ate: string, maxDias = 800) {
  if (ate < de) throw new z.ZodError([{ code: 'custom', path: ['ate'], message: 'A data final é antes da inicial.' }]);
  if ((Date.parse(ate) - Date.parse(de)) / 86_400_000 > maxDias) throw new z.ZodError([{ code: 'custom', path: ['ate'], message: `Escolha um período de até ${maxDias} dias.` }]);
}

/**
 * Lista com teto (P18): a consulta pede `limite + 1` linhas; aqui a sobra é cortada e o retorno diz se havia mais.
 * A resposta leva `temMais` e a tela avisa que a lista não está completa (antes os registros sumiam sem aviso).
 */
export function cortarLista<T>(linhas: T[], limite: number): boolean {
  if (linhas.length <= limite) return false;
  linhas.length = limite;
  return true;
}
