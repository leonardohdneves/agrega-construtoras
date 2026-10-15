// Unidades de compra do insumo: validação do cadastro, fator de conversão na entrada e preço base da compra.
// A unidade base é a do orçamento (ex.: kg). Fator = quantas unidades base cabem em 1 unidade de compra (ex.: 1 barra = 46,2 kg).
import { ErroHttp } from './erros.ts';
import { numeroBr } from './engenharia.ts';

export type UnidadeCompra = { unidade: string; fator: number };
export type LinhaCompra = { valorCentavos: number; quantidade: number; unidade: string | null; data: string; fatorMapeado: number | null };

const chave = (u: string) => u.trim().toLowerCase();

/** Valida as unidades de compra cadastradas: diferentes da base, sem repetição e com fator positivo. */
export function unidadesValidas(lista: { unidade: string; fator: number | string }[], base: string): UnidadeCompra[] {
  const vistos = new Set<string>();
  return lista.map((u) => {
    const unidade = u.unidade.trim();
    const fator = typeof u.fator === 'number' ? u.fator : numeroBr(String(u.fator ?? ''));
    if (!unidade) throw new ErroHttp(400, 'Informe a unidade de compra.');
    if (chave(unidade) === chave(base)) throw new ErroHttp(400, `"${unidade}" é a unidade base do insumo. Informe outra unidade de compra.`);
    if (vistos.has(chave(unidade))) throw new ErroHttp(400, `A unidade de compra "${unidade}" está repetida.`);
    if (fator === null || !Number.isFinite(fator) || fator <= 0) throw new ErroHttp(400, `Informe quantos ${base} cabem em 1 ${unidade}.`);
    vistos.add(chave(unidade));
    return { unidade, fator };
  });
}

/**
 * Fator para levar a quantidade de uma nota à unidade base do insumo da obra.
 * Sem unidade na nota ou igual à base: 1. Com unidade de compra cadastrada: o fator dela.
 * Sem conversão cadastrada: 1, como antes (a quantidade da nota é usada sem conversão).
 */
export function fatorEntrada(unidadeNota: string | null, unidadeBase: string, fatorMapeado: number | null): number {
  if (!unidadeNota || chave(unidadeNota) === chave(unidadeBase)) return 1;
  return fatorMapeado && fatorMapeado > 0 ? fatorMapeado : 1;
}

/** Preço unitário na unidade base a partir do valor total de uma linha de nota. */
export function precoBaseDaCompra(valorCentavos: number, quantidade: number, fator: number): number {
  return Math.round(valorCentavos / (quantidade * fator));
}

/**
 * Última compra utilizável: linhas em ordem de data (mais recente primeiro). Ignora as que não dá para converter
 * para a unidade base (unidade de compra sem fator cadastrado).
 */
export function escolherUltimaCompra(linhas: LinhaCompra[], unidadeBase: string): { precoBaseCentavos: number; data: string } | null {
  for (const l of linhas) {
    if (!(l.valorCentavos > 0) || !(l.quantidade > 0)) continue;
    const convertivel = !l.unidade || chave(l.unidade) === chave(unidadeBase) || (l.fatorMapeado !== null && l.fatorMapeado > 0);
    if (!convertivel) continue;
    const fator = fatorEntrada(l.unidade, unidadeBase, l.fatorMapeado);
    return { precoBaseCentavos: precoBaseDaCompra(l.valorCentavos, l.quantidade, fator), data: l.data };
  }
  return null;
}
