// Conciliação da planilha orçamentária importada com a tabela de referência do Agrega.
// Regras: código igual na tabela associa; senão, descrição e unidade iguais associam;
// o resto fica pendente, com sugestões (só sugestões: nada é associado sem confirmação manual).
// Valores em centavos. Funções puras.

export type RefComposicao = { id: string; codigo: string; descricao: string; unidade: string; precoCentavos: number };
export type LinhaPlanilha = { eap: string | null; codigo: string | null; descricao: string; unidade: string; quantidade: number; precoUnitarioCentavos: number };

export type ResultadoConciliacao =
  | {
      status: 'associado';
      criterio: 'codigo' | 'descricao';
      referencia: RefComposicao;
      alertaUnidade: boolean;
      diferencaPrecoCentavos: number; // planilha - tabela
    }
  | { status: 'pendente'; sugestoes: { referencia: RefComposicao; similaridade: number }[] };

const STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'em', 'com', 'para', 'por', 'na', 'no', 'nas', 'nos', 'e', 'a', 'o', 'as', 'os', 'um', 'uma']);

/** Minúsculas, sem acento e sem pontuação, para comparar descrições. */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

// Raiz simples da palavra: as cinco primeiras letras (bloco/blocos, ceramico/ceramicos).
const raiz = (t: string) => (t.length > 5 ? t.slice(0, 5) : t);

function tokens(texto: string): Set<string> {
  return new Set(normalizarTexto(texto).split(' ').filter((t) => t.length > 1 && !STOPWORDS.has(t)).map(raiz));
}

/** Semelhança de Jaccard entre as palavras das descrições (0 a 1). */
export function similaridade(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let comum = 0;
  for (const t of ta) if (tb.has(t)) comum++;
  return comum / (ta.size + tb.size - comum);
}

const semEspacos = (texto: string) => normalizarTexto(texto).replace(/ /g, '');
const normUnidade = semEspacos;

export function conciliarLinha(linha: LinhaPlanilha, referencias: RefComposicao[], limiteSugestao = 0.35, maxSugestoes = 3): ResultadoConciliacao {
  const alvo = linha.codigo?.trim() || null;
  const porCodigo = alvo ? referencias.find((r) => r.codigo.trim().toLowerCase() === alvo.toLowerCase()) : undefined;
  const porDescricao = !porCodigo
    ? referencias.find((r) => semEspacos(r.descricao) === semEspacos(linha.descricao) && normUnidade(r.unidade) === normUnidade(linha.unidade))
    : undefined;
  const achado = porCodigo ?? porDescricao;
  if (achado) {
    return {
      status: 'associado',
      criterio: porCodigo ? 'codigo' : 'descricao',
      referencia: achado,
      alertaUnidade: normUnidade(achado.unidade) !== normUnidade(linha.unidade),
      diferencaPrecoCentavos: linha.precoUnitarioCentavos - achado.precoCentavos,
    };
  }
  const sugestoes = referencias
    .map((r) => {
      const base = similaridade(linha.descricao, r.descricao);
      // Mesma unidade desempata, sem criar sugestão sozinha.
      const pontos = base + (normUnidade(r.unidade) === normUnidade(linha.unidade) ? 0.05 : 0);
      return { referencia: r, similaridade: pontos };
    })
    .filter((s) => s.similaridade >= limiteSugestao)
    .sort((x, y) => y.similaridade - x.similaridade)
    .slice(0, maxSugestoes)
    .map((s) => ({ referencia: s.referencia, similaridade: Math.round(s.similaridade * 100) / 100 }));
  return { status: 'pendente', sugestoes };
}
