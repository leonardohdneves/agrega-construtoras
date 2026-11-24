// Leitura de planilhas .xlsx sem biblioteca externa: o .xlsx é um zip de XML. Lê o zip (com zlib do Node) e
// devolve cada aba como linhas de texto, para a leitura por IA de composições.
import { inflateRawSync } from 'node:zlib';

/** Abre um zip e devolve o conteúdo de cada arquivo, pelo nome. Só aceita os métodos sem compressão e deflate. */
export function lerZip(buf: Buffer): Map<string, Buffer> {
  let fim = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      fim = i;
      break;
    }
  }
  if (fim < 0) throw new Error('Arquivo Excel inválido (zip sem diretório).');
  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  const saida = new Map<string, Buffer>();
  for (let k = 0; k < total; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Arquivo Excel inválido (diretório corrompido).');
    const metodo = buf.readUInt16LE(p + 10);
    const tamanhoComp = buf.readUInt32LE(p + 20);
    const nomeLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const comentarioLen = buf.readUInt16LE(p + 32);
    const offLocal = buf.readUInt32LE(p + 42);
    const nome = buf.toString('utf8', p + 46, p + 46 + nomeLen);
    p += 46 + nomeLen + extraLen + comentarioLen;
    const nomeLocal = buf.readUInt16LE(offLocal + 26);
    const extraLocal = buf.readUInt16LE(offLocal + 28);
    const ini = offLocal + 30 + nomeLocal + extraLocal;
    const bruto = buf.subarray(ini, ini + tamanhoComp);
    if (metodo === 0) saida.set(nome, Buffer.from(bruto));
    else if (metodo === 8) saida.set(nome, inflateRawSync(bruto));
    else throw new Error('Arquivo Excel com compressão não suportada.');
  }
  return saida;
}

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodificar(texto: string): string {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cod = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cod) ? String.fromCodePoint(cod) : m;
    }
    return ENTIDADES[e.toLowerCase()] ?? m;
  });
}

/** Textos da tabela de strings compartilhadas (uma entrada por <si>, juntando as partes de cada uma). */
function textosCompartilhados(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) =>
    decodificar([...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')),
  );
}

/** Índice de coluna a partir da letra (A=0, Z=25, AA=26…). */
function colunaDe(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d/g, '').toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Linhas de uma aba, com cada célula na sua coluna. Linhas vazias saem. */
function linhasDaAba(xml: string, compartilhadas: string[]): string[][] {
  const linhas: string[][] = [];
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const celulas: string[] = [];
    for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const ref = /\br="([^"]+)"/.exec(attrs)?.[1] ?? '';
      const tipo = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
      const corpo = c[2] ?? '';
      let valor = '';
      if (tipo === 's') valor = compartilhadas[Number(/<v>([\s\S]*?)<\/v>/.exec(corpo)?.[1] ?? -1)] ?? '';
      else if (tipo === 'inlineStr') valor = decodificar([...corpo.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
      else valor = decodificar(/<v>([\s\S]*?)<\/v>/.exec(corpo)?.[1] ?? '');
      const idx = ref ? colunaDe(ref) : celulas.length;
      while (celulas.length < idx) celulas.push('');
      celulas[idx] = valor.trim();
    }
    if (celulas.some((x) => x !== '')) linhas.push(celulas);
  }
  return linhas;
}

/** Texto de todas as abas do .xlsx, uma linha por linha, células separadas por " | ". */
export function xlsxParaTexto(buf: Buffer, limite = 200_000): string {
  const arquivos = lerZip(buf);
  const compartilhadas = arquivos.get('xl/sharedStrings.xml') ? textosCompartilhados(arquivos.get('xl/sharedStrings.xml')!.toString('utf8')) : [];
  const abas = [...arquivos.keys()]
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]));
  const partes: string[] = [];
  for (const nome of abas) {
    partes.push(`## Aba ${nome.replace(/^.*\/(sheet\d+)\.xml$/, '$1')}`);
    for (const linha of linhasDaAba(arquivos.get(nome)!.toString('utf8'), compartilhadas)) partes.push(linha.join(' | '));
  }
  return partes.join('\n').slice(0, limite);
}
