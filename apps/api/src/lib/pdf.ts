// Leitura do conteúdo de um PDF sem dependências: objetos, filtros (Flate, LZW, ASCII), fontes (ToUnicode,
// WinAnsi, Differences, Identity-H), texto com posição na página, retângulos preenchidos (barras de código
// de barras desenhadas em vetor) e imagens. Não renderiza: serve para extrair dados de DANFE, NFS-e e recibos.
import { constants, inflateSync } from 'node:zlib';

export class ErroPdf extends Error {}

export type ItemTexto = { pagina: number; x: number; y: number; w: number; tam: number; texto: string };
export type Retangulo = { pagina: number; x: number; y: number; w: number; h: number };
export type ImagemPdf = { pagina: number; largura: number; altura: number; componentes: number; bits: number; filtro: string | null; dados: Buffer };
export type ConteudoPdf = { paginas: number; itens: ItemTexto[]; retangulos: Retangulo[]; imagens: ImagemPdf[] };
export type Linha = { pagina: number; y: number; itens: ItemTexto[]; texto: string };

// ---------- Valores ----------
type Ref = { ref: number; ger: number };
type Nome = { nome: string };
type Dic = { [k: string]: Valor };
type Fluxo = { dic: Dic; bruto: Buffer };
type Valor = number | boolean | null | string | Buffer | Nome | Ref | Valor[] | Dic | Fluxo;
// Strings literais e hexadecimais viram Buffer; nomes viram { nome }; operadores do conteúdo viram string.

const ehRef = (v: unknown): v is Ref => !!v && typeof v === 'object' && 'ref' in (v as object);
const ehNome = (v: unknown): v is Nome => !!v && typeof v === 'object' && 'nome' in (v as object) && !Buffer.isBuffer(v);
const ehFluxo = (v: unknown): v is Fluxo => !!v && typeof v === 'object' && 'bruto' in (v as object) && 'dic' in (v as object);
const ehDic = (v: unknown): v is Dic => !!v && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v) && !ehRef(v) && !ehNome(v) && !ehFluxo(v);

const BRANCO = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set('()<>[]{}/%'.split('').map((c) => c.charCodeAt(0)));

/** Lexer/parser de valores PDF sobre um Buffer. */
class Leitor {
  b: Buffer;
  p: number;
  constructor(b: Buffer, p = 0) {
    this.b = b;
    this.p = p;
  }
  pular() {
    const b = this.b;
    while (this.p < b.length) {
      const c = b[this.p];
      if (BRANCO.has(c)) this.p++;
      else if (c === 37) {
        while (this.p < b.length && b[this.p] !== 10 && b[this.p] !== 13) this.p++;
      } else break;
    }
  }
  palavra(): string {
    const ini = this.p;
    while (this.p < this.b.length && !BRANCO.has(this.b[this.p]) && !DELIM.has(this.b[this.p])) this.p++;
    return this.b.toString('latin1', ini, this.p);
  }
  /** Lê o próximo valor (ou operador, como string). Retorna undefined no fim. */
  valor(): Valor | undefined {
    this.pular();
    const b = this.b;
    if (this.p >= b.length) return undefined;
    const c = b[this.p];
    if (c === 60 && b[this.p + 1] === 60) {
      this.p += 2;
      const d: Dic = {};
      for (;;) {
        this.pular();
        if (this.p >= b.length) return d;
        if (b[this.p] === 62 && b[this.p + 1] === 62) {
          this.p += 2;
          return d;
        }
        const k = this.valor();
        if (k === undefined) return d;
        if (!ehNome(k)) continue;
        const v = this.valor();
        if (v === undefined) return d;
        d[k.nome] = v;
      }
    }
    if (c === 60) {
      this.p++;
      const ini = this.p;
      while (this.p < b.length && b[this.p] !== 62) this.p++;
      const hex = b.toString('latin1', ini, this.p).replace(/[^0-9a-f]/gi, '');
      this.p++;
      return Buffer.from(hex.length % 2 ? hex + '0' : hex, 'hex');
    }
    if (c === 40) return this.literal();
    if (c === 91) {
      this.p++;
      const a: Valor[] = [];
      for (;;) {
        this.pular();
        if (this.p >= b.length) return a;
        if (b[this.p] === 93) {
          this.p++;
          return a;
        }
        const v = this.valor();
        if (v === undefined) return a;
        a.push(v);
      }
    }
    if (c === 47) {
      this.p++;
      return { nome: this.palavra().replace(/#([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16))) };
    }
    if (c === 93 || c === 62 || c === 41 || c === 123 || c === 125) {
      this.p++;
      return this.valor();
    }
    const w = this.palavra();
    if (!w) {
      this.p++;
      return this.valor();
    }
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) {
      const n = Number(w);
      // Referência indireta: "12 0 R".
      if (/^\d+$/.test(w)) {
        const salvo = this.p;
        this.pular();
        const g = this.palavra();
        if (/^\d+$/.test(g)) {
          this.pular();
          if (this.b[this.p] === 82 && (this.p + 1 >= b.length || BRANCO.has(b[this.p + 1]) || DELIM.has(b[this.p + 1]))) {
            this.p++;
            return { ref: n, ger: Number(g) };
          }
        }
        this.p = salvo;
      }
      return n;
    }
    if (w === 'true') return true;
    if (w === 'false') return false;
    if (w === 'null') return null;
    return w;
  }
  literal(): Buffer {
    const b = this.b;
    this.p++;
    const out: number[] = [];
    let nivel = 1;
    while (this.p < b.length) {
      const c = b[this.p++];
      if (c === 92) {
        const e = b[this.p++];
        if (e === 110) out.push(10);
        else if (e === 114) out.push(13);
        else if (e === 116) out.push(9);
        else if (e === 98) out.push(8);
        else if (e === 102) out.push(12);
        else if (e === 13) {
          if (b[this.p] === 10) this.p++;
        } else if (e === 10) {
          /* continuação de linha */
        } else if (e >= 48 && e <= 55) {
          let o = e - 48;
          for (let k = 0; k < 2 && b[this.p] >= 48 && b[this.p] <= 55; k++) o = o * 8 + (b[this.p++] - 48);
          out.push(o & 255);
        } else out.push(e);
      } else if (c === 40) {
        nivel++;
        out.push(c);
      } else if (c === 41) {
        if (--nivel === 0) break;
        out.push(c);
      } else out.push(c);
    }
    return Buffer.from(out);
  }
}

// ---------- Filtros ----------
function inflar(b: Buffer): Buffer {
  try {
    return inflateSync(b);
  } catch {
    try {
      // Fluxo truncado ou sem o checksum final: aproveita o que der.
      return inflateSync(b, { finishFlush: constants.Z_SYNC_FLUSH });
    } catch {
      return Buffer.alloc(0);
    }
  }
}

function lzw(b: Buffer, early = 1): Buffer {
  const out: number[] = [];
  let dic: number[][] = [];
  const reset = () => {
    dic = [];
    for (let i = 0; i < 256; i++) dic.push([i]);
    dic.push([], []);
  };
  reset();
  let bits = 9;
  let acc = 0;
  let nacc = 0;
  let ant: number[] | null = null;
  for (let i = 0; i < b.length; i++) {
    acc = (acc << 8) | b[i];
    nacc += 8;
    while (nacc >= bits) {
      const cod = (acc >> (nacc - bits)) & ((1 << bits) - 1);
      nacc -= bits;
      if (cod === 256) {
        reset();
        bits = 9;
        ant = null;
        continue;
      }
      if (cod === 257) return Buffer.from(out);
      let ent: number[];
      if (cod < dic.length) ent = dic[cod];
      else if (ant) ent = [...ant, ant[0]];
      else return Buffer.from(out);
      for (const x of ent) out.push(x);
      if (ant) dic.push([...ant, ent[0]]);
      ant = ent;
      if (dic.length + early >= 1 << bits && bits < 12) bits++;
    }
  }
  return Buffer.from(out);
}

function ascii85(b: Buffer): Buffer {
  const s = b.toString('latin1').replace(/\s/g, '').replace(/^<~/, '').replace(/~>.*$/, '');
  const out: number[] = [];
  let grupo: number[] = [];
  for (const ch of s) {
    if (ch === 'z' && grupo.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    const c = ch.charCodeAt(0) - 33;
    if (c < 0 || c > 84) continue;
    grupo.push(c);
    if (grupo.length === 5) {
      let n = 0;
      for (const g of grupo) n = n * 85 + g;
      out.push((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
      grupo = [];
    }
  }
  if (grupo.length) {
    const falta = 5 - grupo.length;
    while (grupo.length < 5) grupo.push(84);
    let n = 0;
    for (const g of grupo) n = n * 85 + g;
    const bytes = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    out.push(...bytes.slice(0, 4 - falta));
  }
  return Buffer.from(out);
}

function preditor(b: Buffer, parms: Dic | undefined): Buffer {
  const pred = Number(parms?.Predictor ?? 1);
  if (pred < 10) return b;
  const colunas = Number(parms?.Columns ?? 1);
  const cores = Number(parms?.Colors ?? 1);
  const bpc = Number(parms?.BitsPerComponent ?? 8);
  const bpp = Math.max(1, Math.ceil((cores * bpc) / 8));
  const linha = Math.ceil((colunas * cores * bpc) / 8);
  const out = Buffer.alloc(Math.floor(b.length / (linha + 1)) * linha);
  let anterior = Buffer.alloc(linha);
  for (let r = 0, o = 0; r + linha < b.length + 1 && o < out.length; r += linha + 1, o += linha) {
    const tipo = b[r];
    const atual = Buffer.from(b.subarray(r + 1, r + 1 + linha));
    for (let i = 0; i < linha; i++) {
      const a = i >= bpp ? atual[i - bpp] : 0;
      const up = anterior[i];
      const ul = i >= bpp ? anterior[i - bpp] : 0;
      if (tipo === 1) atual[i] = (atual[i] + a) & 255;
      else if (tipo === 2) atual[i] = (atual[i] + up) & 255;
      else if (tipo === 3) atual[i] = (atual[i] + ((a + up) >> 1)) & 255;
      else if (tipo === 4) {
        const p = a + up - ul;
        const pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - ul);
        atual[i] = (atual[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? up : ul)) & 255;
      }
    }
    atual.copy(out, o);
    anterior = atual;
  }
  return out;
}

// ---------- Matrizes ----------
type M = [number, number, number, number, number, number];
const ID: M = [1, 0, 0, 1, 0, 0];
const mult = (a: M, b: M): M => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
];
const ponto = (m: M, x: number, y: number): [number, number] => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];

// ---------- Codificações ----------
const WIN_ANSI_80 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';
function winAnsi(c: number): string {
  if (c >= 0x80 && c <= 0x9f) return WIN_ANSI_80[c - 0x80];
  return String.fromCharCode(c);
}

const GLIFOS: Record<string, string> = {
  space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&', quotesingle: "'", quoteright: '’', quoteleft: '‘',
  parenleft: '(', parenright: ')', asterisk: '*', plus: '+', comma: ',', hyphen: '-', minus: '-', period: '.', slash: '/', colon: ':', semicolon: ';',
  less: '<', equal: '=', greater: '>', question: '?', at: '@', bracketleft: '[', backslash: '\\', bracketright: ']', underscore: '_', bar: '|',
  braceleft: '{', braceright: '}', degree: '°', ordmasculine: 'º', ordfeminine: 'ª', endash: '–', emdash: '—', bullet: '•', quotedblleft: '“', quotedblright: '”',
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', section: '§', registered: '®', copyright: '©',
  nbspace: ' ', uni00A0: ' ', fi: 'fi', fl: 'fl', Euro: '€', multiply: '×', periodcentered: '·',
};
const ACENTOS: Record<string, string> = { acute: '́', grave: '̀', circumflex: '̂', tilde: '̃', dieresis: '̈', cedilla: '̧' };
function glifo(nome: string): string {
  if (GLIFOS[nome]) return GLIFOS[nome];
  if (/^[A-Za-z]$/.test(nome)) return nome;
  let m = /^uni([0-9A-F]{4})/i.exec(nome);
  if (m) return String.fromCharCode(parseInt(m[1], 16));
  m = /^u([0-9A-F]{4,6})$/i.exec(nome);
  if (m) return String.fromCodePoint(parseInt(m[1], 16));
  m = /^([A-Za-z])(acute|grave|circumflex|tilde|dieresis|cedilla)$/.exec(nome);
  if (m) return (m[1] + ACENTOS[m[2]]).normalize('NFC');
  m = /^(?:g|cid|G)(\d+)$/.exec(nome);
  if (m) return '';
  return '';
}

type Fonte = {
  bytes: 1 | 2;
  mapa: Map<number, string> | null;
  base: (c: number) => string;
  larguras: (c: number) => number;
  /** Fonte sem forma de saber o texto (CID sem ToUnicode). */
  ilegivel: boolean;
};

function lerCMap(texto: string): { mapa: Map<number, string>; bytes: 1 | 2 } {
  const mapa = new Map<number, string>();
  let bytes: 1 | 2 = 1;
  const esp = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(texto);
  if (esp && /<([0-9a-f]+)>/i.exec(esp[1])?.[1].length === 4) bytes = 2;
  const utf16 = (hex: string) => {
    const b = Buffer.from(hex.length % 4 ? hex.padStart(hex.length + (4 - (hex.length % 4)), '0') : hex, 'hex');
    let s = '';
    for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]);
    return s;
  };
  for (const bloco of texto.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of bloco[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]*)>/gi)) {
      mapa.set(parseInt(m[1], 16), utf16(m[2]));
      if (m[1].length === 4) bytes = 2;
    }
  }
  for (const bloco of texto.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of bloco[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(<([0-9a-f]+)>|\[([^\]]*)\])/gi)) {
      const a = parseInt(m[1], 16);
      const z = Math.min(parseInt(m[2], 16), a + 65535);
      if (m[1].length === 4) bytes = 2;
      if (m[4] !== undefined) {
        const destino = Buffer.from(m[4].length % 2 ? '0' + m[4] : m[4], 'hex');
        for (let c = a; c <= z; c++) {
          const d = Buffer.from(destino);
          // Incrementa o último byte (regra do bfrange).
          let soma = d[d.length - 1] + (c - a);
          d[d.length - 1] = soma & 255;
          if (d.length >= 2) d[d.length - 2] = (d[d.length - 2] + (soma >> 8)) & 255;
          soma = 0;
          mapa.set(c, utf16(d.toString('hex')));
        }
      } else if (m[5] !== undefined) {
        const lista = [...m[5].matchAll(/<([0-9a-f]*)>/gi)].map((x) => x[1]);
        for (let c = a; c <= z && c - a < lista.length; c++) mapa.set(c, utf16(lista[c - a]));
      }
    }
  }
  return { mapa, bytes };
}

// ---------- Documento ----------
class Documento {
  b: Buffer;
  s: string;
  offsets = new Map<number, number>();
  emFluxo = new Map<number, Valor>();
  cache = new Map<number, Valor>();
  fontes = new Map<unknown, Fonte>();
  constructor(b: Buffer) {
    this.b = b;
    this.s = b.toString('latin1');
    const re = /(\d+)\s+(\d+)\s+obj\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.s))) {
      const ini = m.index;
      if (ini > 0 && !BRANCO.has(this.b[ini - 1]) && !DELIM.has(this.b[ini - 1])) continue;
      this.offsets.set(Number(m[1]), m.index + m[0].length);
    }
    if (!this.offsets.size) throw new ErroPdf('O arquivo não parece ser um PDF.');
    // Objetos guardados em fluxos de objetos (PDF 1.5+).
    for (const [n] of this.offsets) {
      const v = this.obj(n);
      if (ehFluxo(v) && ehNome(v.dic.Type) && v.dic.Type.nome === 'ObjStm') {
        try {
          const dados = this.decodificar(v);
          const qtd = Number(v.dic.N ?? 0);
          const primeiro = Number(v.dic.First ?? 0);
          const cab = dados.toString('latin1', 0, primeiro).trim().split(/\s+/).map(Number);
          for (let i = 0; i < qtd && 2 * i + 1 < cab.length; i++) {
            const num = cab[2 * i];
            if (this.offsets.has(num) || this.emFluxo.has(num)) continue;
            const l = new Leitor(dados, primeiro + cab[2 * i + 1]);
            const val = l.valor();
            if (val !== undefined) this.emFluxo.set(num, val);
          }
        } catch {
          /* fluxo de objetos ilegível: segue sem ele */
        }
      }
    }
  }
  obj(n: number): Valor {
    if (this.cache.has(n)) return this.cache.get(n)!;
    this.cache.set(n, null);
    let v: Valor = null;
    const p = this.offsets.get(n);
    if (p !== undefined) {
      const l = new Leitor(this.b, p);
      v = l.valor() ?? null;
      if (ehDic(v)) {
        l.pular();
        if (this.s.startsWith('stream', l.p)) {
          let ini = l.p + 6;
          if (this.b[ini] === 13) ini++;
          if (this.b[ini] === 10) ini++;
          let tam = this.res(v.Length);
          let fim = typeof tam === 'number' ? ini + tam : -1;
          if (fim < 0 || fim > this.b.length || this.s.slice(fim, fim + 20).indexOf('endstream') < 0) {
            fim = this.s.indexOf('endstream', ini);
            if (fim < 0) fim = this.b.length;
            if (this.b[fim - 1] === 10) fim--;
            if (this.b[fim - 1] === 13) fim--;
          }
          tam = null;
          v = { dic: v, bruto: this.b.subarray(ini, fim) };
        }
      }
    } else if (this.emFluxo.has(n)) v = this.emFluxo.get(n)!;
    this.cache.set(n, v);
    return v;
  }
  res(v: Valor | undefined): Valor | undefined {
    let x = v;
    for (let i = 0; i < 20 && ehRef(x); i++) x = this.obj(x.ref);
    return x;
  }
  dic(v: Valor | undefined): Dic | undefined {
    const x = this.res(v);
    if (ehFluxo(x)) return x.dic;
    return ehDic(x) ? x : undefined;
  }
  decodificar(f: Fluxo): Buffer {
    let filtros = this.res(f.dic.Filter);
    let parms = this.res(f.dic.DecodeParms);
    const lf = Array.isArray(filtros) ? filtros.map((x) => this.res(x)) : filtros ? [filtros] : [];
    const lp = Array.isArray(parms) ? parms.map((x) => this.dic(x)) : [this.dic(parms ?? undefined)];
    filtros = null;
    parms = null;
    let d = Buffer.from(f.bruto);
    for (const [i, fx] of lf.entries()) {
      const nome = ehNome(fx) ? fx.nome : '';
      if (nome === 'FlateDecode' || nome === 'Fl') d = preditor(inflar(d), lp[i]);
      else if (nome === 'LZWDecode' || nome === 'LZW') d = preditor(lzw(d, Number(lp[i]?.EarlyChange ?? 1)), lp[i]);
      else if (nome === 'ASCIIHexDecode' || nome === 'AHx') d = Buffer.from(d.toString('latin1').replace(/>.*$/s, '').replace(/[^0-9a-f]/gi, ''), 'hex');
      else if (nome === 'ASCII85Decode' || nome === 'A85') d = ascii85(d);
      else if (nome === 'RunLengthDecode' || nome === 'RL') {
        const out: number[] = [];
        for (let k = 0; k < d.length; ) {
          const n = d[k++];
          if (n === 128) break;
          if (n < 128) {
            for (let j = 0; j <= n && k < d.length; j++) out.push(d[k++]);
          } else {
            const x = d[k++];
            for (let j = 0; j < 257 - n; j++) out.push(x);
          }
        }
        d = Buffer.from(out);
      } else break; // DCT, JPX, CCITT, JBIG2: imagem, fica como está
    }
    return d;
  }
  filtroFinal(f: Fluxo): string | null {
    const fx = this.res(f.dic.Filter);
    const l = Array.isArray(fx) ? fx.map((x) => this.res(x)) : fx ? [fx] : [];
    const ult = l[l.length - 1];
    return ehNome(ult) ? ult.nome : null;
  }
  criptografado(): boolean {
    return /\/Encrypt\s/.test(this.s.slice(-4096)) || /trailer[\s\S]{0,2000}\/Encrypt/.test(this.s) || /\/Type\s*\/XRef[^]{0,600}\/Encrypt/.test(this.s);
  }

  fonte(ref: Valor | undefined): Fonte {
    const chave = ehRef(ref) ? ref.ref : ref;
    if (this.fontes.has(chave)) return this.fontes.get(chave)!;
    const d = this.dic(ref) ?? {};
    const sub = ehNome(d.Subtype) ? d.Subtype.nome : '';
    let mapa: Map<number, string> | null = null;
    let bytes: 1 | 2 = sub === 'Type0' ? 2 : 1;
    const tu = this.res(d.ToUnicode);
    if (ehFluxo(tu)) {
      const cm = lerCMap(this.decodificar(tu).toString('latin1'));
      if (cm.mapa.size) mapa = cm.mapa;
      if (sub === 'Type0') bytes = 2;
      else if (cm.bytes === 2 && sub !== 'Type1' && sub !== 'TrueType' && sub !== 'Type3') bytes = 2;
    }
    // Codificação de fontes simples: WinAnsi como base + Differences.
    const dif = new Map<number, string>();
    const enc = this.res(d.Encoding);
    if (ehDic(enc)) {
      const lista = this.res(enc.Differences);
      if (Array.isArray(lista)) {
        let c = 0;
        for (const x of lista) {
          const v = this.res(x);
          if (typeof v === 'number') c = v;
          else if (ehNome(v)) dif.set(c++, glifo(v.nome));
        }
      }
    }
    const macRoman = ehNome(enc) && enc.nome === 'MacRomanEncoding';
    const base = (c: number) => (dif.has(c) ? dif.get(c)! : macRoman && c >= 128 ? '' : winAnsi(c));
    // Larguras.
    let larguras: (c: number) => number = () => 500;
    if (sub === 'Type0') {
      const desc = this.res(d.DescendantFonts);
      const df = this.dic(Array.isArray(desc) ? desc[0] : undefined) ?? {};
      const dw = Number(this.res(df.DW) ?? 1000);
      const w = this.res(df.W);
      const tab = new Map<number, number>();
      if (Array.isArray(w)) {
        for (let i = 0; i < w.length; ) {
          const a = Number(this.res(w[i]));
          const b = this.res(w[i + 1]);
          if (Array.isArray(b)) {
            b.forEach((x, k) => tab.set(a + k, Number(this.res(x))));
            i += 2;
          } else {
            const z = Number(b);
            const v = Number(this.res(w[i + 2]));
            for (let c = a; c <= z && c - a < 65536; c++) tab.set(c, v);
            i += 3;
          }
        }
      }
      larguras = (c) => tab.get(c) ?? dw;
    } else {
      const ws = this.res(d.Widths);
      const fc = Number(this.res(d.FirstChar) ?? 0);
      if (Array.isArray(ws)) larguras = (c) => Number(this.res(ws[c - fc]) ?? 500) || 500;
    }
    const f: Fonte = { bytes, mapa, base, larguras, ilegivel: sub === 'Type0' && !mapa };
    this.fontes.set(chave, f);
    return f;
  }

  paginas(): { dic: Dic }[] {
    const out: { dic: Dic }[] = [];
    const visitados = new Set<number>();
    const andar = (v: Valor | undefined, herdado: Dic) => {
      if (ehRef(v)) {
        if (visitados.has(v.ref)) return;
        visitados.add(v.ref);
      }
      const d = this.dic(v);
      if (!d || out.length > 60) return;
      const h: Dic = { ...herdado };
      for (const k of ['Resources', 'MediaBox', 'Rotate']) if (d[k] !== undefined) h[k] = d[k];
      const tipo = ehNome(d.Type) ? d.Type.nome : '';
      const kids = this.res(d.Kids);
      if (tipo === 'Pages' || Array.isArray(kids)) {
        if (Array.isArray(kids)) for (const k of kids) andar(k, h);
      } else out.push({ dic: { ...h, ...d, Resources: d.Resources ?? h.Resources } });
    };
    let raiz: Valor | undefined;
    for (const [n] of [...this.offsets, ...this.emFluxo]) {
      const d = this.dic({ ref: n, ger: 0 });
      if (d && ehNome(d.Type) && d.Type.nome === 'Catalog') raiz = d.Pages;
    }
    if (raiz) andar(raiz, {});
    if (!out.length) {
      for (const [n] of [...this.offsets, ...this.emFluxo].sort((a, b) => a[0] - b[0])) {
        const d = this.dic({ ref: n, ger: 0 });
        if (d && ehNome(d.Type) && d.Type.nome === 'Page') out.push({ dic: d });
      }
    }
    return out;
  }
}

// ---------- Interpretação do conteúdo ----------
type Estado = { ctm: M; fonte: Fonte | null; tam: number; tc: number; tw: number; th: number; tl: number; rise: number; lw: number; preenchimento: number; contorno: number };

function interpretar(doc: Documento, conteudo: Buffer, recursos: Dic | undefined, ctm0: M, pagina: number, saida: ConteudoPdf, prof = 0) {
  if (prof > 6) return;
  const fontesDic = doc.dic(recursos?.Font) ?? {};
  const xobjs = doc.dic(recursos?.XObject) ?? {};
  let gs: Estado = { ctm: ctm0, fonte: null, tam: 10, tc: 0, tw: 0, th: 1, tl: 0, rise: 0, lw: 1, preenchimento: 0, contorno: 0 };
  const pilha: Estado[] = [];
  let tm: M = ID;
  let tlm: M = ID;
  let caminho: { tipo: 're' | 'pts'; pts: [number, number][] }[] = [];
  let atual: [number, number][] | null = null;
  const ops: Valor[] = [];
  const l = new Leitor(conteudo);
  let passos = 0;

  const mostrar = (str: Buffer) => {
    const f = gs.fonte;
    if (!f) return;
    let texto = '';
    let largura = 0;
    const passo = f.bytes;
    for (let i = 0; i + passo - 1 < str.length; i += passo) {
      const c = passo === 2 ? (str[i] << 8) | str[i + 1] : str[i];
      const u = f.mapa ? f.mapa.get(c) ?? (passo === 1 ? f.base(c) : '') : f.ilegivel ? '' : f.base(c);
      texto += u;
      const w0 = f.larguras(c) / 1000;
      largura += (w0 * gs.tam + gs.tc + (passo === 1 && c === 32 ? gs.tw : 0)) * gs.th;
    }
    const trm = mult([gs.tam * gs.th, 0, 0, gs.tam, 0, gs.rise], mult(tm, gs.ctm));
    const [x, y] = [trm[4], trm[5]];
    const fim = mult(mult([1, 0, 0, 1, largura, 0], tm), gs.ctm);
    const escala = Math.hypot(trm[2], trm[3]) || gs.tam;
    if (texto.replace(/\s/g, '')) saida.itens.push({ pagina, x, y, w: Math.max(0, fim[4] - x), tam: escala, texto });
    tm = mult([1, 0, 0, 1, largura, 0], tm);
  };

  const fecharRetangulos = (preencher: boolean, contorno: boolean) => {
    for (const p of caminho) {
      if (p.pts.length < 2) continue;
      const xs = p.pts.map((q) => q[0]);
      const ys = p.pts.map((q) => q[1]);
      const x = Math.min(...xs), y = Math.min(...ys);
      const w = Math.max(...xs) - x, h = Math.max(...ys) - y;
      const retangular = p.tipo === 're' || (p.pts.length >= 4 && p.pts.length <= 5 && p.pts.every((q) => (Math.abs(q[0] - x) < 0.01 || Math.abs(q[0] - x - w) < 0.01) && (Math.abs(q[1] - y) < 0.01 || Math.abs(q[1] - y - h) < 0.01)));
      if (preencher && retangular && w > 0 && h > 0 && gs.preenchimento < 0.5) saida.retangulos.push({ pagina, x, y, w, h });
      else if (contorno && p.pts.length === 2 && w < 0.01 && h > 0 && gs.contorno < 0.5) {
        // Barra desenhada como linha vertical grossa.
        const lw = gs.lw * Math.hypot(gs.ctm[0], gs.ctm[1]);
        if (lw > 0) saida.retangulos.push({ pagina, x: x - lw / 2, y, w: lw, h });
      }
    }
    caminho = [];
    atual = null;
  };

  for (;;) {
    if (++passos > 3_000_000) break;
    const v = l.valor();
    if (v === undefined) break;
    if (typeof v !== 'string') {
      ops.push(v);
      if (ops.length > 2000) ops.splice(0, ops.length - 100);
      continue;
    }
    const n = (k: number) => Number(ops[ops.length - k] ?? 0);
    switch (v) {
      case 'q':
        pilha.push({ ...gs });
        break;
      case 'Q':
        gs = pilha.pop() ?? gs;
        break;
      case 'cm':
        gs.ctm = mult([n(6), n(5), n(4), n(3), n(2), n(1)], gs.ctm);
        break;
      case 'w':
        gs.lw = n(1);
        break;
      case 'g':
      case 'rg':
      case 'k':
      case 'sc':
      case 'scn':
      case 'G':
      case 'RG':
      case 'K':
      case 'SC':
      case 'SCN': {
        // Luminosidade da cor (0 = preto, 1 = branco), para separar barras pretas do fundo branco.
        const nums = ops.filter((x): x is number => typeof x === 'number');
        const k = v === 'g' || v === 'G' ? 1 : v === 'rg' || v === 'RG' ? 3 : v === 'k' || v === 'K' ? 4 : nums.length;
        const c = nums.slice(-k);
        const lum = c.length === 1 ? c[0] : c.length === 3 ? 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] : c.length === 4 ? (1 - c[3]) * (1 - (c[0] + c[1] + c[2]) / 3) : 0;
        if (v === v.toLowerCase()) gs.preenchimento = lum;
        else gs.contorno = lum;
        break;
      }
      case 'cs':
        gs.preenchimento = 0;
        break;
      case 'CS':
        gs.contorno = 0;
        break;
      case 'BT':
        tm = tlm = ID;
        break;
      case 'Tf': {
        const nome = ops[ops.length - 2];
        gs.fonte = ehNome(nome) ? doc.fonte(fontesDic[nome.nome]) : null;
        gs.tam = n(1);
        break;
      }
      case 'Tc':
        gs.tc = n(1);
        break;
      case 'Tw':
        gs.tw = n(1);
        break;
      case 'Tz':
        gs.th = n(1) / 100;
        break;
      case 'TL':
        gs.tl = n(1);
        break;
      case 'Ts':
        gs.rise = n(1);
        break;
      case 'Td':
        tlm = tm = mult([1, 0, 0, 1, n(2), n(1)], tlm);
        break;
      case 'TD':
        gs.tl = -n(1);
        tlm = tm = mult([1, 0, 0, 1, n(2), n(1)], tlm);
        break;
      case 'Tm':
        tlm = tm = [n(6), n(5), n(4), n(3), n(2), n(1)];
        break;
      case 'T*':
        tlm = tm = mult([1, 0, 0, 1, 0, -gs.tl], tlm);
        break;
      case 'Tj': {
        const s = ops[ops.length - 1];
        if (Buffer.isBuffer(s)) mostrar(s);
        break;
      }
      case "'": {
        tlm = tm = mult([1, 0, 0, 1, 0, -gs.tl], tlm);
        const s = ops[ops.length - 1];
        if (Buffer.isBuffer(s)) mostrar(s);
        break;
      }
      case '"': {
        gs.tw = n(3);
        gs.tc = n(2);
        tlm = tm = mult([1, 0, 0, 1, 0, -gs.tl], tlm);
        const s = ops[ops.length - 1];
        if (Buffer.isBuffer(s)) mostrar(s);
        break;
      }
      case 'TJ': {
        const a = ops[ops.length - 1];
        if (Array.isArray(a))
          for (const x of a) {
            if (Buffer.isBuffer(x)) mostrar(x);
            else if (typeof x === 'number') tm = mult([1, 0, 0, 1, (-x / 1000) * gs.tam * gs.th, 0], tm);
          }
        break;
      }
      case 're': {
        const [x, y, w, h] = [n(4), n(3), n(2), n(1)];
        const pts = [ponto(gs.ctm, x, y), ponto(gs.ctm, x + w, y), ponto(gs.ctm, x + w, y + h), ponto(gs.ctm, x, y + h)];
        caminho.push({ tipo: 're', pts });
        atual = null;
        break;
      }
      case 'm':
        atual = [ponto(gs.ctm, n(2), n(1))];
        caminho.push({ tipo: 'pts', pts: atual });
        break;
      case 'l':
        if (atual) atual.push(ponto(gs.ctm, n(2), n(1)));
        break;
      case 'c':
      case 'v':
      case 'y':
        if (atual) {
          atual.push(ponto(gs.ctm, n(2), n(1)));
          atual.push([NaN, NaN]); // curva: não é retângulo
        }
        break;
      case 'h':
        break;
      case 'f':
      case 'F':
      case 'f*':
        fecharRetangulos(true, false);
        break;
      case 'B':
      case 'B*':
      case 'b':
      case 'b*':
        fecharRetangulos(true, true);
        break;
      case 'S':
      case 's':
        fecharRetangulos(false, true);
        break;
      case 'n':
        caminho = [];
        atual = null;
        break;
      case 'BI': {
        // Imagem embutida: pula até EI.
        const i = conteudo.indexOf('ID', l.p, 'latin1');
        const e = i < 0 ? -1 : conteudo.indexOf('EI', i + 3, 'latin1');
        l.p = e < 0 ? conteudo.length : e + 2;
        break;
      }
      case 'Do': {
        const nome = ops[ops.length - 1];
        if (!ehNome(nome)) break;
        const x = doc.res(xobjs[nome.nome]);
        if (!ehFluxo(x)) break;
        const sub = ehNome(x.dic.Subtype) ? x.dic.Subtype.nome : '';
        if (sub === 'Form') {
          const mat = doc.res(x.dic.Matrix);
          const m: M = Array.isArray(mat) && mat.length === 6 ? (mat.map((k) => Number(doc.res(k))) as M) : ID;
          interpretar(doc, doc.decodificar(x), doc.dic(x.dic.Resources) ?? recursos, mult(m, gs.ctm), pagina, saida, prof + 1);
        } else if (sub === 'Image' && saida.imagens.length < 40) {
          const cs = doc.res(x.dic.ColorSpace);
          const nomeCs = ehNome(cs) ? cs.nome : Array.isArray(cs) && ehNome(cs[0]) ? cs[0].nome : '';
          const comp = nomeCs === 'DeviceRGB' || nomeCs === 'CalRGB' ? 3 : nomeCs === 'DeviceCMYK' ? 4 : 1;
          const filtro = doc.filtroFinal(x);
          const decodificavel = !filtro || ['FlateDecode', 'Fl', 'LZWDecode', 'ASCIIHexDecode', 'ASCII85Decode', 'RunLengthDecode'].includes(filtro);
          saida.imagens.push({
            pagina,
            largura: Number(doc.res(x.dic.Width) ?? 0),
            altura: Number(doc.res(x.dic.Height) ?? 0),
            componentes: comp,
            bits: Number(doc.res(x.dic.BitsPerComponent) ?? 8),
            filtro: decodificavel ? null : filtro,
            dados: decodificavel ? doc.decodificar(x) : Buffer.from(x.bruto),
          });
        }
        break;
      }
      default:
        break;
    }
    ops.length = 0;
  }
}

/** Lê um PDF e devolve o texto posicionado, os retângulos preenchidos e as imagens de cada página. */
export function lerPdf(arquivo: Buffer): ConteudoPdf {
  if (arquivo.toString('latin1', 0, 1024).indexOf('%PDF') < 0) throw new ErroPdf('O arquivo não é um PDF.');
  const doc = new Documento(arquivo);
  if (doc.criptografado()) throw new ErroPdf('O PDF está protegido (criptografado).');
  const saida: ConteudoPdf = { paginas: 0, itens: [], retangulos: [], imagens: [] };
  const paginas = doc.paginas().slice(0, 30);
  saida.paginas = paginas.length;
  for (const [i, p] of paginas.entries()) {
    const c = doc.res(p.dic.Contents);
    const lista = Array.isArray(c) ? c.map((x) => doc.res(x)) : [c];
    const partes = lista.filter(ehFluxo).map((f) => doc.decodificar(f));
    const conteudo = Buffer.concat(partes.flatMap((x) => [x, Buffer.from('\n')]));
    // Página girada: o texto continua em coordenadas da página sem rotação; para o leitor basta a ordem.
    interpretar(doc, conteudo, doc.dic(p.dic.Resources), ID, i + 1, saida);
  }
  for (const it of saida.itens) it.texto = it.texto.replace(/[   ]/g, ' ').replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl').replace(/\u0000/g, '');
  return saida;
}

/** Agrupa o texto em linhas (de cima para baixo), juntando pedaços próximos e separando colunas por espaços. */
export function linhasDoTexto(itens: ItemTexto[]): Linha[] {
  const linhas: Linha[] = [];
  const porPagina = new Map<number, ItemTexto[]>();
  for (const it of itens) {
    if (!porPagina.has(it.pagina)) porPagina.set(it.pagina, []);
    porPagina.get(it.pagina)!.push(it);
  }
  for (const [pagina, lista] of [...porPagina].sort((a, b) => a[0] - b[0])) {
    const ord = [...lista].sort((a, b) => b.y - a.y || a.x - b.x);
    const grupos: ItemTexto[][] = [];
    for (const it of ord) {
      const g = grupos[grupos.length - 1];
      const ref = g?.[0];
      if (g && Math.abs(ref.y - it.y) <= Math.max(1.2, Math.min(ref.tam, it.tam) * 0.45)) g.push(it);
      else grupos.push([it]);
    }
    for (const g of grupos) {
      g.sort((a, b) => a.x - b.x);
      // Junta pedaços colados (mesma palavra quebrada pelo gerador do PDF).
      const juntos: ItemTexto[] = [];
      for (const it of g) {
        const ant = juntos[juntos.length - 1];
        const vao = ant ? it.x - (ant.x + ant.w) : 0;
        if (ant && vao < Math.max(0.6, it.tam * 0.18) && vao > -Math.max(0.5, it.tam * 0.1)) {
          const espaco = vao > it.tam * 0.12 && !/\s$/.test(ant.texto) && !/^\s/.test(it.texto);
          ant.texto += (espaco ? ' ' : '') + it.texto;
          ant.w = Math.max(ant.w, it.x + it.w - ant.x);
        } else juntos.push({ ...it });
      }
      let texto = '';
      let fimAnt = -Infinity;
      for (const it of juntos) {
        if (texto) texto += it.x - fimAnt > it.tam * 1.5 ? '   ' : ' ';
        texto += it.texto.trim();
        fimAnt = it.x + it.w;
      }
      linhas.push({ pagina, y: g[0].y, itens: juntos.map((x) => ({ ...x, texto: x.texto.trim() })).filter((x) => x.texto), texto: texto.replace(/[ \t]+$/g, '') });
    }
  }
  return linhas;
}
