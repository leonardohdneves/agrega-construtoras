// Gerador de QR Code (modo byte, correção M, versões 1 a 10), sem dependências.
// Baseado no algoritmo de referência (ISO/IEC 18004); suficiente para links e códigos curtos.

const ECC_POR_BLOCO = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26]; // nível M
const BLOCOS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5]; // nível M

function modulosDados(v: number): number {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) {
    const n = Math.floor(v / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (v >= 7) r -= 36;
  }
  return r;
}
const codewordsDados = (v: number) => Math.floor(modulosDados(v) / 8) - ECC_POR_BLOCO[v] * BLOCOS[v];

function mul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function divisor(grau: number): number[] {
  const r = new Array(grau).fill(0);
  r[grau - 1] = 1;
  let raiz = 1;
  for (let i = 0; i < grau; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = mul(r[j], raiz);
      if (j + 1 < r.length) r[j] ^= r[j + 1];
    }
    raiz = mul(raiz, 0x02);
  }
  return r;
}

function resto(dados: number[], div: number[]): number[] {
  const r = div.map(() => 0);
  for (const b of dados) {
    const f = b ^ (r.shift() as number);
    r.push(0);
    div.forEach((c, i) => (r[i] ^= mul(c, f)));
  }
  return r;
}

function posicoesAlinhamento(v: number, tam: number): number[] {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2;
  const passo = Math.floor((v * 8 + n * 3 + 5) / (n * 4 - 4)) * 2;
  const r = [6];
  for (let p = tam - 7; r.length < n; p -= passo) r.splice(1, 0, p);
  return r;
}

/** Matriz do QR (true = módulo escuro). */
export function gerarQr(texto: string): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(texto));
  let v = 1;
  for (; v <= 10; v++) {
    const bitsCont = v < 10 ? 8 : 16;
    if (4 + bitsCont + bytes.length * 8 <= codewordsDados(v) * 8) break;
  }
  if (v > 10) throw new Error('Texto longo demais para o QR.');
  const tam = v * 4 + 17;

  // Bits de dados
  const bits: number[] = [];
  const push = (val: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, v < 10 ? 8 : 16);
  bytes.forEach((b) => push(b, 8));
  const cap = codewordsDados(v) * 8;
  push(0, Math.min(4, cap - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) push(pad, 8);
  const dados: number[] = [];
  for (let i = 0; i < bits.length; i += 8) dados.push(parseInt(bits.slice(i, i + 8).join(''), 2));

  // Blocos e correção de erros
  const nBlocos = BLOCOS[v];
  const ecc = ECC_POR_BLOCO[v];
  const brutos = Math.floor(modulosDados(v) / 8);
  const curtos = nBlocos - (brutos % nBlocos);
  const lenCurto = Math.floor(brutos / nBlocos);
  const div = divisor(ecc);
  const blocos: number[][] = [];
  for (let i = 0, k = 0; i < nBlocos; i++) {
    const d = dados.slice(k, k + lenCurto - ecc + (i < curtos ? 0 : 1));
    k += d.length;
    const e = resto(d, div);
    if (i < curtos) d.push(0);
    blocos.push(d.concat(e));
  }
  const final: number[] = [];
  for (let i = 0; i < blocos[0].length; i++) {
    blocos.forEach((b, j) => {
      if (i !== lenCurto - ecc || j >= curtos) final.push(b[i]);
    });
  }

  // Padrões de função
  const mod: boolean[][] = Array.from({ length: tam }, () => new Array(tam).fill(false));
  const func: boolean[][] = Array.from({ length: tam }, () => new Array(tam).fill(false));
  const set = (x: number, y: number, escuro: boolean) => {
    mod[y][x] = escuro;
    func[y][x] = true;
  };
  for (let i = 0; i < tam; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  const finder = (x: number, y: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < tam && yy >= 0 && yy < tam) set(xx, yy, d !== 2 && d !== 4);
      }
  };
  finder(3, 3);
  finder(tam - 4, 3);
  finder(3, tam - 4);
  const al = posicoesAlinhamento(v, tam);
  al.forEach((ay, i) =>
    al.forEach((ax, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }),
  );
  const formato = (mascara: number) => {
    const d = (0 << 3) | mascara; // nível M = 00
    let r = d;
    for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const b = ((d << 10) | r) ^ 0x5412;
    const bit = (i: number) => ((b >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(tam - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, tam - 15 + i, bit(i));
    set(8, tam - 8, true);
  };
  formato(0);
  if (v >= 7) {
    let r = v;
    for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
    const b = (v << 12) | r;
    for (let i = 0; i < 18; i++) {
      const bit = ((b >>> i) & 1) !== 0;
      const a = tam - 11 + (i % 3);
      const c = Math.floor(i / 3);
      set(a, c, bit);
      set(c, a, bit);
    }
  }

  // Dados em zigue-zague
  let i = 0;
  for (let dir = tam - 1; dir >= 1; dir -= 2) {
    if (dir === 6) dir = 5;
    for (let vert = 0; vert < tam; vert++)
      for (let j = 0; j < 2; j++) {
        const x = dir - j;
        const sobe = ((dir + 1) & 2) === 0;
        const y = sobe ? tam - 1 - vert : vert;
        if (!func[y][x] && i < final.length * 8) {
          mod[y][x] = ((final[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
  }

  // Máscara: escolhe a de menor penalidade
  const inverte = (m: number, x: number, y: number) =>
    [
      (x + y) % 2 === 0,
      y % 2 === 0,
      x % 3 === 0,
      (x + y) % 3 === 0,
      (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
      ((x * y) % 2) + ((x * y) % 3) === 0,
      (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
      (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
    ][m];
  const aplicar = (m: number) => {
    for (let y = 0; y < tam; y++) for (let x = 0; x < tam; x++) if (!func[y][x] && inverte(m, x, y)) mod[y][x] = !mod[y][x];
  };
  const penalidade = () => {
    let p = 0;
    for (let y = 0; y < tam; y++) {
      for (const linha of [true, false]) {
        let run = 1;
        for (let x = 1; x < tam; x++) {
          const a = linha ? mod[y][x] : mod[x][y];
          const b = linha ? mod[y][x - 1] : mod[x - 1][y];
          if (a === b) {
            run++;
            if (run === 5) p += 3;
            else if (run > 5) p++;
          } else run = 1;
        }
      }
    }
    for (let y = 0; y < tam - 1; y++)
      for (let x = 0; x < tam - 1; x++) {
        const c = mod[y][x];
        if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3;
      }
    const escuros = mod.reduce((s, l) => s + l.filter(Boolean).length, 0);
    p += Math.floor(Math.abs(escuros * 20 - tam * tam * 10) / (tam * tam)) * 10;
    return p;
  };
  let melhor = 0;
  let menor = Infinity;
  for (let m = 0; m < 8; m++) {
    aplicar(m);
    formato(m);
    const p = penalidade();
    if (p < menor) {
      menor = p;
      melhor = m;
    }
    aplicar(m);
  }
  aplicar(melhor);
  formato(melhor);
  return mod;
}

/** Caminho SVG do QR, com margem de 4 módulos. Use num <svg viewBox={`0 0 ${n} ${n}`}>. */
export function qrSvg(texto: string): { tamanho: number; caminho: string } {
  const m = gerarQr(texto);
  const q = 4;
  let d = '';
  m.forEach((linha, y) => linha.forEach((c, x) => c && (d += `M${x + q},${y + q}h1v1h-1z`)));
  return { tamanho: m.length + q * 2, caminho: d };
}
