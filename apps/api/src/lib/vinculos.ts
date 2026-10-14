// Ligação dos itens de nota de compra com os insumos cadastrados (estoque).
// Sugere pelo que já foi ligado antes (aprendizado) e pela IA.
import type { Cliente } from '../db.ts';
import { fatorPadrao, sugerirInsumo } from './estoque.ts';
import type { CadastrosIa } from './ia-nota.ts';

export type Vinculo = { insumoId: string | null; fator: number | null; origem: 'aprendido' | 'ia' | null };

type Mapa = { insumos: Map<string, { id: string; unidade: string }> };

/** Lista de insumos enviada à IA para ela indicar o cadastro de cada item (refs curtos). */
export async function cadastrosParaIa(c: Cliente, empresaId: string, entrada: boolean): Promise<{ ia: CadastrosIa; mapa: Mapa }> {
  const ins = entrada
    ? (await c.query("SELECT id, nome, unidade FROM insumos WHERE empresa_id = $1 AND ativo AND excluido_em IS NULL ORDER BY nome LIMIT 150", [empresaId])).rows
    : [];
  const mapa: Mapa = { insumos: new Map() };
  const ia: CadastrosIa = { insumos: [] };
  ins.forEach((x, k) => {
    const ref = `INS-${k + 1}`;
    mapa.insumos.set(ref, { id: x.id, unidade: x.unidade });
    ia.insumos.push({ ref, nome: x.nome, unidade: x.unidade });
  });
  return { ia, mapa };
}

/** Vínculo sugerido para um item: primeiro o aprendido, depois o indicado pela IA. */
export async function vinculoDoItem(
  c: Cliente,
  empresaId: string,
  entrada: boolean,
  fornecedorId: string | null,
  item: { descricao: string; unidade: string | null; ref?: string | null },
  mapa: Mapa | null,
): Promise<Vinculo> {
  if (entrada) {
    const ins = await sugerirInsumo(c, empresaId, fornecedorId, item.descricao, item.unidade);
    if (ins) return { insumoId: ins.insumoId, fator: ins.fator, origem: 'aprendido' };
    const ref = item.ref?.trim().toUpperCase();
    const i = ref && mapa ? mapa.insumos.get(ref) : undefined;
    if (i) return { insumoId: i.id, fator: fatorPadrao(item.unidade, i.unidade), origem: 'ia' };
  }
  return { insumoId: null, fator: null, origem: null };
}
