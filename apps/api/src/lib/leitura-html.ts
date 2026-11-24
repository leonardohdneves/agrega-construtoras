// Leitura de quantitativos em tabelas HTML estáticas (relatórios de projeto, memórias de cálculo, planilhas exportadas).
// Lê as tabelas que têm coluna de unidade e de quantidade e devolve as linhas no mesmo formato da leitura de PDF, para
// a conciliação com as composições da obra. Não executa script: o arquivo é só texto. Sem dependência externa.
import type { QuantitativoLido, ServicoLeitura } from './leitura-projeto.ts';
import { normalizarTexto } from './leitura-projeto.ts';

export type TabelaHtml = { titulo: string; linhas: string[][] };

// Entidades nomeadas comuns em português. A busca respeita maiúsculas e minúsculas (Aacute é Á; aacute é á).
const ENTIDADES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ordm: 'º', ordf: 'ª', sup2: '²', sup3: '³', deg: '°', middot: '·',
  ndash: '–', mdash: '—', times: '×', plusmn: '±', micro: 'µ', oslash: 'ø', Oslash: 'Ø', frac12: '½',
  aacute: 'á', Aacute: 'Á', agrave: 'à', Agrave: 'À', acirc: 'â', Acirc: 'Â', atilde: 'ã', Atilde: 'Ã',
  eacute: 'é', Eacute: 'É', ecirc: 'ê', Ecirc: 'Ê', iacute: 'í', Iacute: 'Í',
  oacute: 'ó', Oacute: 'Ó', ocirc: 'ô', Ocirc: 'Ô', otilde: 'õ', Otilde: 'Õ',
  uacute: 'ú', Uacute: 'Ú', ucirc: 'û', uuml: 'ü', ccedil: 'ç', Ccedil: 'Ç',
};

/** Texto de um trecho de HTML: sem tags, com as entidades comuns decodificadas e os espaços recolhidos. */
export function textoDoHtml(trecho: string): string {
  return trecho
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z0-9]+);/gi, (m, nome) => ENTIDADES[String(nome)] ?? ENTIDADES[String(nome).toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tabelas do HTML, cada uma com o título (o último h1 a h4 antes dela). Ignora script, estilo e comentários. */
export function tabelasDoHtml(html: string): TabelaHtml[] {
  const limpo = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const tabelas: TabelaHtml[] = [];
  let titulo = '';
  for (const m of limpo.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>|<table[\s\S]*?<\/table>/gi)) {
    if (m[1] !== undefined) {
      titulo = textoDoHtml(m[1]);
      continue;
    }
    const linhas = (m[0].match(/<tr[\s\S]*?<\/tr>/gi) ?? []).map((tr) => (tr.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) ?? []).map(textoDoHtml));
    if (linhas.some((l) => l.length)) tabelas.push({ titulo, linhas });
  }
  return tabelas;
}

/** Número no formato brasileiro ("1.172,4", "0,087", "257") ou nulo ("-", vazio, texto). */
export function numeroBrasileiro(texto: string): number | null {
  const t = texto.trim().replace(/\s/g, '');
  if (!/^-?\d[\d.,]*$/.test(t)) return null;
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : /^-?\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

/** Tipo de serviço pela descrição, para a sugestão de composições (forma, armação, concreto ou outro). */
export function classificarServico(descricao: string): ServicoLeitura {
  const t = normalizarTexto(descricao);
  const tem = (...palavras: string[]) => palavras.some((p) => new RegExp(`(^|[^a-z0-9])${p}`).test(t));
  if (tem('forma', 'formas')) return 'forma';
  if (tem('concreto', 'usinado')) return 'concreto';
  if (tem('aco', 'armacao', 'armadura', 'vergalhao', 'tela', 'ca-?50', 'ca-?60')) return 'armacao';
  return 'outro';
}

const CABECALHO_UNIDADE = /^(un|unid|und|unidade)\.?$/i;
const CABECALHO_QUANTIDADE_DIRETO = /^(quantidade|quant|qtd|qtde)\.?$/i;
const CABECALHO_QUANTIDADE_TOTAL = /^total\b/i;
const CABECALHO_DESCRICAO = /^(item|descri|material|servi[cç]o|pe[cç]a|insumo|o que|especifica)/i;
const CABECALHO_CODIGO = /^(c[oó]d|c[oó]digo|ref)\b/i;
const CABECALHO_COMPOSICAO = /composi[cç][aã]o|sinapi|refer[eê]ncia/i;
const CABECALHO_NUMERACAO = /^(eap|n[ºo°.]?|#|it\.?|seq)$/i;
const CABECALHO_VALOR = /(custo|pre[cç]o|valor|r\$|bdi)/i;

export const LIMITE_ITENS_HTML = 1000;

/**
 * Linhas de quantitativo das tabelas. Uma tabela só entra se tiver coluna de unidade e de quantidade (ou "Total…").
 * Linhas com uma célula só (títulos de grupo, como "1. Mureta guia") viram o contexto das linhas seguintes.
 */
export function quantitativosDasTabelas(tabelas: TabelaHtml[]): { itens: QuantitativoLido[]; pendencias: string[] } {
  const itens: QuantitativoLido[] = [];
  const ignoradas: string[] = [];
  let semNumero = 0;
  for (const t of tabelas) {
    const iCab = t.linhas.findIndex((l) => l.some((c) => CABECALHO_UNIDADE.test(c.trim())) && l.some((c) => CABECALHO_QUANTIDADE_DIRETO.test(c.trim()) || CABECALHO_QUANTIDADE_TOTAL.test(c.trim())));
    if (iCab < 0) {
      if (t.linhas.length > 1 && t.linhas.slice(1).some((l) => l.length > 2 && l.some((c) => numeroBrasileiro(c) !== null))) ignoradas.push(t.titulo || 'sem título');
      continue;
    }
    const cab = t.linhas[iCab].map((c) => c.trim());
    const colUn = cab.findIndex((c) => CABECALHO_UNIDADE.test(c));
    const colQtd = cab.findIndex((c) => CABECALHO_QUANTIDADE_DIRETO.test(c)) >= 0 ? cab.findIndex((c) => CABECALHO_QUANTIDADE_DIRETO.test(c)) : cab.findIndex((c) => CABECALHO_QUANTIDADE_TOTAL.test(c));
    const livre = (i: number) => i !== colUn && i !== colQtd;
    const colCodigo = cab.findIndex((c, i) => livre(i) && CABECALHO_CODIGO.test(c));
    const colComp = cab.findIndex((c, i) => livre(i) && i !== colCodigo && CABECALHO_COMPOSICAO.test(c) && !CABECALHO_DESCRICAO.test(c));
    // Descrição: a coluna com nome de descrição; senão a primeira que não seja numeração, código, composição sugerida ou valor.
    let colDesc = cab.findIndex((c, i) => livre(i) && i !== colComp && CABECALHO_DESCRICAO.test(c));
    if (colDesc < 0) colDesc = cab.findIndex((c, i) => livre(i) && i !== colCodigo && i !== colComp && !CABECALHO_NUMERACAO.test(c) && !CABECALHO_VALOR.test(c));
    if (colDesc < 0) colDesc = 0;
    const exigidas = Math.max(colUn, colQtd, colDesc) + 1;
    let grupo = '';
    for (const l of t.linhas.slice(iCab + 1)) {
      if (l.length < exigidas) {
        // Título de grupo: uma célula, ou numeração + título ("1 | CONTENÇÃO"). Linha de observação começa vazia.
        if (l.length >= 1 && l.length <= 2 && l[0]) grupo = l.filter(Boolean).join(' ');
        continue;
      }
      const descricao = l[colDesc].replace(/^[·•\-–]\s*/, '').trim();
      if (!descricao) continue;
      const quantidade = numeroBrasileiro(l[colQtd]);
      if (quantidade === null || quantidade <= 0) {
        if (l[colQtd] && l[colQtd] !== '-') semNumero++;
        continue;
      }
      if (itens.length >= LIMITE_ITENS_HTML) break;
      const codigoSugerido = colCodigo >= 0 ? (l[colCodigo] ?? '').trim().slice(0, 40) : '';
      const composicaoSugerida = colComp >= 0 ? (l[colComp] ?? '').trim().slice(0, 300) : '';
      itens.push({
        ...(codigoSugerido ? { codigoSugerido } : {}),
        ...(composicaoSugerida ? { composicaoSugerida } : {}),
        servico: classificarServico(composicaoSugerida || descricao),
        descricao: descricao.slice(0, 200),
        unidade: l[colUn].trim().slice(0, 20),
        quantidade,
        origem: [t.titulo, grupo].filter(Boolean).join(' · ').slice(0, 200),
      });
    }
  }
  const pendencias: string[] = [];
  if (ignoradas.length) pendencias.push(`Tabela(s) sem colunas de unidade e quantidade, ignorada(s): ${ignoradas.slice(0, 5).join('; ')}${ignoradas.length > 5 ? '…' : ''}.`);
  if (semNumero) pendencias.push(`${semNumero} linha(s) com quantidade que não é número foram ignoradas.`);
  if (itens.length >= LIMITE_ITENS_HTML) pendencias.push(`Só as primeiras ${LIMITE_ITENS_HTML} linhas foram lidas.`);
  return { itens, pendencias };
}

/** O HTML parece um visualizador que monta as tabelas por script: o arquivo traz script e quase nenhuma tabela pronta. */
export function geraTabelasPorScript(html: string, tabelasProntas: number): boolean {
  return tabelasProntas === 0 && /<script[\s>]/i.test(html);
}
