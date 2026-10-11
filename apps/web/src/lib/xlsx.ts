// Leitor mínimo de planilhas .xlsx no navegador, sem dependências.
// O .xlsx é um zip de XMLs: lemos o índice do zip, descompactamos com DecompressionStream e lemos as células.
// Só valores (texto e número), sem fórmulas, estilos ou datas formatadas — o suficiente para tabelas de referência.

type Entrada = { metodo: number; tamanho: number; local: number };

export type Planilha = { abas: string[]; ler: (aba: string) => Promise<string[][]> };

const decodificar = (b: Uint8Array) => new TextDecoder().decode(b);

async function inflar(dados: Uint8Array): Promise<Uint8Array> {
  const fluxo = new Blob([dados.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(fluxo).arrayBuffer());
}

function indiceZip(buf: ArrayBuffer): Map<string, Entrada> {
  const v = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let fimDir = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65_557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      fimDir = i;
      break;
    }
  }
  if (fimDir < 0) throw new Error('O arquivo não é uma planilha .xlsx válida.');
  const total = v.getUint16(fimDir + 10, true);
  let p = v.getUint32(fimDir + 16, true);
  const entradas = new Map<string, Entrada>();
  for (let n = 0; n < total; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('A planilha .xlsx está corrompida.');
    const metodo = v.getUint16(p + 10, true);
    const tamanho = v.getUint32(p + 20, true);
    const lenNome = v.getUint16(p + 28, true);
    const lenExtra = v.getUint16(p + 30, true);
    const lenComentario = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    entradas.set(decodificar(bytes.subarray(p + 46, p + 46 + lenNome)), { metodo, tamanho, local });
    p += 46 + lenNome + lenExtra + lenComentario;
  }
  return entradas;
}

async function extrair(buf: ArrayBuffer, e: Entrada): Promise<Uint8Array> {
  const v = new DataView(buf);
  const inicio = e.local + 30 + v.getUint16(e.local + 26, true) + v.getUint16(e.local + 28, true);
  const dados = new Uint8Array(buf, inicio, e.tamanho);
  if (e.metodo === 0) return dados;
  if (e.metodo === 8) return inflar(dados);
  throw new Error('A planilha usa uma compressão não suportada.');
}

const xml = (b: Uint8Array) => new DOMParser().parseFromString(decodificar(b), 'application/xml');
const tags = (el: Document | Element, nome: string) => Array.from(el.getElementsByTagNameNS('*', nome));
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Índice da coluna a partir da referência da célula (A1 → 0, AB7 → 27). */
function coluna(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/** Número sem lixo de ponto flutuante (12.350000000000001 → 12.35). */
const numero = (s: string) => {
  const n = Number(s);
  return Number.isFinite(n) ? String(Number(n.toPrecision(12))) : s;
};

export async function abrirXlsx(buf: ArrayBuffer): Promise<Planilha> {
  const entradas = indiceZip(buf);
  const ler = async (nome: string) => {
    const e = entradas.get(nome);
    return e ? xml(await extrair(buf, e)) : null;
  };
  const livro = await ler('xl/workbook.xml');
  if (!livro) throw new Error('O arquivo não é uma planilha .xlsx válida.');
  const rels = await ler('xl/_rels/workbook.xml.rels');
  const alvo = new Map<string, string>();
  for (const r of rels ? tags(rels, 'Relationship') : []) {
    const t = r.getAttribute('Target') ?? '';
    alvo.set(r.getAttribute('Id') ?? '', t.startsWith('/') ? t.slice(1) : `xl/${t}`);
  }
  const abas = tags(livro, 'sheet').map((s) => ({
    nome: s.getAttribute('name') ?? '',
    caminho: alvo.get(s.getAttributeNS(NS_REL, 'id') ?? s.getAttribute('r:id') ?? '') ?? '',
  }));

  let compartilhados: string[] | null = null;
  const textos = async () => {
    if (compartilhados) return compartilhados;
    const e = entradas.get('xl/sharedStrings.xml');
    const bruto = e ? decodificar(await extrair(buf, e)) : '';
    compartilhados = [];
    // Cada <si> junta os seus <t>, sem os textos fonéticos (<rPh>).
    for (const si of bruto.matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)) {
      const corpo = si[1].replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, '');
      let t = '';
      for (const m of corpo.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)) t += m[1];
      compartilhados.push(entidades(t));
    }
    return compartilhados;
  };

  return {
    abas: abas.map((a) => a.nome),
    async ler(nome) {
      const aba = abas.find((a) => a.nome === nome);
      const e = aba ? entradas.get(aba.caminho) : undefined;
      if (!e) throw new Error(`Não encontrei a aba ${nome}.`);
      const ss = await textos();
      // Leitura por expressões regulares: bem mais rápida que montar o XML inteiro (abas com dezenas de milhares de linhas).
      const xmlAba = decodificar(await extrair(buf, e));
      const linhas: string[][] = [];
      const reLinha = /<(?:\w+:)?row\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g;
      const reCelula = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;
      for (const row of xmlAba.matchAll(reLinha)) {
        const linha: string[] = [];
        let proxima = 0;
        for (const c of (row[1] ?? '').matchAll(reCelula)) {
          const attrs = c[1];
          const corpo = c[2] ?? '';
          const ref = /\br="([A-Z]+)\d*"/.exec(attrs)?.[1];
          const col = ref ? coluna(ref) : proxima;
          proxima = col + 1;
          const t = /\bt="(\w+)"/.exec(attrs)?.[1];
          const v = entidades(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/.exec(corpo)?.[1] ?? '');
          let valor: string;
          if (t === 's') valor = ss[Number(v)] ?? '';
          else if (t === 'inlineStr') valor = entidades([...corpo.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((m) => m[1]).join(''));
          else if (t === 'b') valor = v === '1' ? 'VERDADEIRO' : 'FALSO';
          else if (t === 'str' || t === 'e') valor = v;
          else valor = v === '' ? '' : numero(v);
          while (linha.length < col) linha.push('');
          linha[col] = valor;
        }
        linhas.push(linha);
      }
      return linhas;
    },
  };
}

/** Entidades do XML (&amp;, &lt;, &#233; …). */
function entidades(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&';
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    return String.fromCodePoint(k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
  });
}

/** Converte as linhas de uma aba em texto com ponto e vírgula, sem linhas vazias. */
export function linhasParaTexto(linhas: string[][]): string {
  return linhas
    .map((l) => l.map((c) => c.replace(/[;\r\n\t]+/g, ' ').trim()))
    .filter((l) => l.some((c) => c !== ''))
    .map((l) => l.join(';'))
    .join('\n');
}
