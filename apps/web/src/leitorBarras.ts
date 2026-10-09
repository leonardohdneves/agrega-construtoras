// Leitura do código de barras da chave de acesso (DANFE) no navegador:
// câmera (BarcodeDetector quando existe, senão o decodificador próprio), foto e imagens dentro do PDF escaneado.
import { chaveDoTexto, chavePlausivel, decodificarCode128, largurasDaLinha } from './code128';

/** Larguras com limiar local (média do mínimo e máximo ao redor), melhor para fotos com sombra. */
function largurasAdaptativas(px: ArrayLike<number>, ini: number, n: number, passo: number, janela: number): number[] {
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) v[i] = px[ini + i * passo];
  const out: number[] = [];
  let escuro = false;
  let tam = 0;
  for (let i = 0; i < n; i++) {
    let mn = 255, mx = 0;
    const a = Math.max(0, i - janela), b = Math.min(n - 1, i + janela);
    for (let k = a; k <= b; k += 2) {
      if (v[k] < mn) mn = v[k];
      if (v[k] > mx) mx = v[k];
    }
    const e: boolean = mx - mn > 40 ? v[i] < (mn + mx) / 2 : escuro && v[i] < 128;
    if (e === escuro) tam++;
    else {
      if (escuro || out.length) out.push(tam);
      escuro = e;
      tam = 1;
    }
  }
  if (escuro) out.push(tam);
  return out;
}

function tentar(l: number[]): string | null {
  for (const t of [decodificarCode128(l), decodificarCode128([...l].reverse())]) if (t && chavePlausivel(t)) return t;
  return null;
}

/** Procura a chave numa imagem em tons de cinza (linhas e colunas). */
export function chaveEmCinza(cinza: Uint8ClampedArray | Uint8Array, w: number, h: number, linhas = 90): string | null {
  const passoY = Math.max(1, Math.floor(h / linhas));
  // Começa pelo meio (onde a câmera costuma estar apontada).
  const ys: number[] = [];
  for (let d = 0; d < h / 2; d += passoY) ys.push(Math.floor(h / 2 + d), Math.floor(h / 2 - d));
  for (const y of ys) {
    if (y < 0 || y >= h) continue;
    const t = tentar(largurasDaLinha(cinza, y * w, w)) ?? tentar(largurasAdaptativas(cinza, y * w, w, 1, Math.max(8, Math.round(w / 40))));
    if (t) return t;
  }
  const passoX = Math.max(1, Math.floor(w / linhas));
  for (let x = 0; x < w; x += passoX) {
    const t = tentar(largurasDaLinha(cinza, x, h, w));
    if (t) return t;
  }
  return null;
}

function cinzaDoCanvas(ctx: CanvasRenderingContext2D, w: number, h: number): Uint8ClampedArray {
  const d = ctx.getImageData(0, 0, w, h).data;
  const out = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = (d[j] * 299 + d[j + 1] * 587 + d[j + 2] * 114) / 1000;
  return out;
}

type Detector = { detect: (img: CanvasImageSource) => Promise<{ rawValue: string }[]> };
let detectorCache: Detector | null | undefined;
/** BarcodeDetector do navegador (Android, macOS), quando lê Code 128. */
export async function detectorNativo(): Promise<Detector | null> {
  if (detectorCache !== undefined) return detectorCache;
  detectorCache = null;
  const BD = (globalThis as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
  if (!BD) return null;
  try {
    const formatos = (await BD.getSupportedFormats?.()) ?? [];
    // Code 128 (DANFE) e QR code (DANFSe da NFS-e nacional e NFC-e trazem a chave no link).
    const quer = ['code_128', 'qr_code'].filter((f) => formatos.includes(f));
    if (quer.length) detectorCache = new BD({ formats: quer });
  } catch {
    detectorCache = null;
  }
  return detectorCache;
}

/** Lê a chave em uma imagem (foto, quadro da câmera ou imagem tirada do PDF). */
export async function chaveDaImagem(fonte: CanvasImageSource, largura: number, altura: number, tela?: HTMLCanvasElement): Promise<string | null> {
  const det = await detectorNativo();
  if (det) {
    try {
      for (const r of await det.detect(fonte)) {
        const c = chaveDoTexto(r.rawValue);
        if (c) return c;
      }
    } catch {
      /* segue com o decodificador próprio */
    }
  }
  const escala = Math.min(1, 2400 / Math.max(largura, altura));
  const w = Math.max(1, Math.round(largura * escala));
  const h = Math.max(1, Math.round(altura * escala));
  const canvas = tela ?? document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(fonte, 0, 0, w, h);
  return chaveEmCinza(cinzaDoCanvas(ctx, w, h), w, h);
}

export async function chaveDoArquivoDeImagem(arquivo: Blob): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(arquivo);
    const t = await chaveDaImagem(bmp, bmp.width, bmp.height);
    bmp.close();
    return t;
  } catch {
    return null;
  }
}

function ascii85(b: Uint8Array): Uint8Array {
  const out: number[] = [];
  let grupo: number[] = [];
  const empurra = (g: number[], bytes: number) => {
    let n = 0;
    for (const x of g) n = n * 85 + x;
    const q = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    for (let k = 0; k < bytes; k++) out.push(q[k]);
  };
  for (let i = 0; i < b.length; i++) {
    const ch = b[i];
    if (ch === 126) break; // ~>
    if (ch === 122 && !grupo.length) {
      out.push(0, 0, 0, 0);
      continue;
    }
    if (ch < 33 || ch > 117) continue;
    grupo.push(ch - 33);
    if (grupo.length === 5) {
      empurra(grupo, 4);
      grupo = [];
    }
  }
  if (grupo.length) {
    const falta = 5 - grupo.length;
    while (grupo.length < 5) grupo.push(84);
    empurra(grupo, 4 - falta);
  }
  return new Uint8Array(out);
}

function hex(b: Uint8Array): Uint8Array {
  const s = Array.from(b, (c) => String.fromCharCode(c)).join('').replace(/>.*$/s, '').replace(/[^0-9a-f]/gi, '');
  const out = new Uint8Array(Math.floor(s.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
}

/** PDF escaneado: tira as imagens JPEG de dentro do PDF e procura o código de barras nelas. */
export async function chaveNoPdf(bytes: Uint8Array): Promise<string | null> {
  const n = Math.min(bytes.length, 30 * 1024 * 1024);
  let s = '';
  for (let i = 0; i < n; i += 32768) s += String.fromCharCode(...bytes.subarray(i, Math.min(n, i + 32768)));
  const re = /<<((?:[^<>]|<<[^>]*>>|<[^<>]*>)*?\/Subtype\s*\/Image(?:[^<>]|<<[^>]*>>|<[^<>]*>)*?)>>\s*stream\r?\n/g;
  let m: RegExpExecArray | null;
  let vistas = 0;
  while ((m = re.exec(s)) && vistas < 12) {
    const dic = m[1];
    if (!/\/DCTDecode/.test(dic)) continue;
    vistas++;
    const ini = m.index + m[0].length;
    const len = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dic);
    let fim = len ? ini + Number(len[1]) : s.indexOf('endstream', ini);
    if (fim < 0 || fim > n) fim = s.indexOf('endstream', ini);
    if (fim <= ini) continue;
    let dados: Uint8Array = bytes.slice(ini, fim);
    if (/\/ASCII85Decode|\/A85\b/.test(dic)) dados = ascii85(dados);
    else if (/\/ASCIIHexDecode|\/AHx\b/.test(dic)) dados = hex(dados);
    const t = await chaveDoArquivoDeImagem(new Blob([dados as BlobPart], { type: 'image/jpeg' }));
    if (t) return t;
  }
  return null;
}

/** Converte uma imagem (foto, quadro da câmera) em JPEG de até `max` px no lado maior, para enviar à IA. */
export async function imagemParaJpeg(fonte: Blob | HTMLVideoElement, max = 2000): Promise<Blob | null> {
  try {
    let img: CanvasImageSource;
    let w: number;
    let h: number;
    let bmp: ImageBitmap | null = null;
    if (fonte instanceof Blob) {
      bmp = await createImageBitmap(fonte);
      img = bmp;
      w = bmp.width;
      h = bmp.height;
    } else {
      img = fonte;
      w = fonte.videoWidth;
      h = fonte.videoHeight;
    }
    if (!w || !h) return null;
    const escala = Math.min(1, max / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * escala);
    canvas.height = Math.round(h * escala);
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
    bmp?.close();
    return await new Promise<Blob | null>((ok) => canvas.toBlob((b) => ok(b), 'image/jpeg', 0.85));
  } catch {
    return null;
  }
}
