// Código de barras Code 128 (o do DANFE) e chave de acesso da NF-e.
// ATENÇÃO: este arquivo é copiado igual em apps/web/src/code128.ts (há teste que confere).

const PADROES = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '233111',
].map((p) => p.split('').map(Number));
const PARADA = 106;

/**
 * Classifica 6 larguras (barra, espaço, …) no símbolo mais próximo. Usa principalmente as distâncias
 * borda a borda (barra + espaço vizinho), que não mudam quando a tinta "engorda" as barras (foto, impressão
 * borrada). Devolve -1 se nenhum símbolo servir.
 */
function simbolo(w: number[]): number {
  const soma = w[0] + w[1] + w[2] + w[3] + w[4] + w[5];
  if (soma <= 0) return -1;
  const mod = soma / 11;
  const t = [0, 1, 2, 3].map((k) => (w[k] + w[k + 1]) / mod);
  let melhor = -1;
  let erroMin = Infinity;
  let segundo = Infinity;
  for (let v = 0; v < PADROES.length; v++) {
    const p = PADROES[v];
    let e = 0;
    for (let k = 0; k < 4; k++) e += Math.abs(t[k] - (p[k] + p[k + 1]));
    for (let k = 0; k < 6; k++) e += 0.3 * Math.abs(w[k] / mod - p[k]);
    if (e < erroMin) {
      segundo = erroMin;
      erroMin = e;
      melhor = v;
    } else if (e < segundo) segundo = e;
  }
  return erroMin < 2.4 && segundo - erroMin > 0.3 ? melhor : -1;
}

function textoDosValores(valores: number[]): string | null {
  let conj: 'A' | 'B' | 'C' = valores[0] === 103 ? 'A' : valores[0] === 104 ? 'B' : 'C';
  let s = '';
  let shift = false;
  for (let i = 1; i < valores.length; i++) {
    const v = valores[i];
    const c: 'A' | 'B' | 'C' = shift ? (conj === 'A' ? 'B' : 'A') : conj;
    shift = false;
    if (c === 'C') {
      if (v < 100) s += String(v).padStart(2, '0');
      else if (v === 100) conj = 'B';
      else if (v === 101) conj = 'A';
    } else if (c === 'B') {
      if (v < 96) s += String.fromCharCode(32 + v);
      else if (v === 98) shift = true;
      else if (v === 99) conj = 'C';
      else if (v === 101) conj = 'A';
    } else {
      if (v < 64) s += String.fromCharCode(32 + v);
      else if (v < 96) s += String.fromCharCode(v - 64);
      else if (v === 98) shift = true;
      else if (v === 99) conj = 'C';
      else if (v === 100) conj = 'B';
    }
  }
  return s;
}

/**
 * Decodifica um Code 128 a partir das larguras alternadas (barra, espaço, barra, …) de uma linha.
 * Procura o início em qualquer posição, confere o dígito verificador e a parada.
 */
export function decodificarCode128(larguras: number[]): string | null {
  for (let i = 0; i + 6 * 3 + 7 <= larguras.length; i += 2) {
    const ini = simbolo(larguras.slice(i, i + 6));
    if (ini < 103 || ini > 105) continue;
    const valores = [ini];
    let j = i + 6;
    let ok = false;
    while (j + 6 <= larguras.length) {
      const v = simbolo(larguras.slice(j, j + 6));
      if (v < 0) break;
      if (v === PARADA) {
        ok = true;
        break;
      }
      if (v >= 103) break;
      valores.push(v);
      j += 6;
    }
    if (!ok || valores.length < 3) continue;
    const verif = valores.pop()!;
    let soma = valores[0];
    for (let k = 1; k < valores.length; k++) soma += k * valores[k];
    if (soma % 103 !== verif) continue;
    const t = textoDosValores(valores);
    if (t) return t;
  }
  return null;
}

/**
 * Larguras alternadas (barra, espaço…) de uma linha de pixels em tons de cinza. As bordas são achadas
 * com precisão de fração de pixel (interpolação no ponto de corte), o que permite ler imagens de baixa resolução.
 */
export function largurasDaLinha(px: ArrayLike<number>, ini: number, n: number, passo = 1, corte?: number): number[] {
  let min = 255, max = 0;
  for (let i = 0; i < n; i++) {
    const v = px[ini + i * passo];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max - min < 60) return [];
  const c = corte ?? (min + max) / 2;
  const bordas: number[] = [];
  let ant = px[ini];
  let escuro = ant < c;
  if (escuro) bordas.push(0);
  for (let i = 1; i < n; i++) {
    const v = px[ini + i * passo];
    const e = v < c;
    if (e !== escuro) {
      bordas.push(i - 1 + (c - ant) / (v - ant || 1));
      escuro = e;
    }
    ant = v;
  }
  if (escuro) bordas.push(n);
  const out: number[] = [];
  for (let k = 1; k < bordas.length; k++) out.push(bordas[k] - bordas[k - 1]);
  return out;
}

/** Larguras (em módulos) de um Code 128 conjunto C, para números com quantidade par de dígitos. */
export function codificarCode128C(digitos: string): number[] {
  if (!/^(\d\d)+$/.test(digitos)) throw new Error('Code 128 C precisa de dígitos em pares.');
  const valores = [105];
  for (let i = 0; i < digitos.length; i += 2) valores.push(Number(digitos.slice(i, i + 2)));
  let soma = 105;
  for (let k = 1; k < valores.length; k++) soma += k * valores[k];
  valores.push(soma % 103, PARADA);
  const out = valores.flatMap((v) => PADROES[v]);
  out.push(2); // última barra da parada
  return out;
}

/** Confere o dígito verificador (módulo 11) da chave de acesso de 44 dígitos. */
export function chaveValida(chave: string): boolean {
  if (!/^\d{44}$/.test(chave)) return false;
  let soma = 0;
  let peso = 2;
  for (let i = 42; i >= 0; i--) {
    soma += Number(chave[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  const dv = resto < 2 ? 0 : 11 - resto;
  return dv === Number(chave[43]);
}

export type PartesChave = { uf: string; anoMes: string; documento: string; modelo: string; serie: string; numero: string; tipoEmissao: string };

/** Separa a chave: UF, AAMM, CNPJ/CPF do emitente, modelo (55/65), série, número. */
export function partesDaChave(chave: string): PartesChave | null {
  if (!chaveValida(chave)) return null;
  const doc = chave.slice(6, 20);
  return {
    uf: chave.slice(0, 2),
    anoMes: `20${chave.slice(2, 4)}-${chave.slice(4, 6)}`,
    // CNPJ (ou CPF com zeros à esquerda, no caso de produtor rural).
    documento: doc,
    modelo: chave.slice(20, 22),
    serie: String(Number(chave.slice(22, 25))),
    numero: String(Number(chave.slice(25, 34))),
    tipoEmissao: chave.slice(34, 35),
  };
}

/** Acha uma chave de acesso válida dentro de um texto (44 dígitos seguidos ou em grupos de 4). */
export function acharChave(texto: string): string | null {
  const re = /(?<!\d)(?:\d{4}[ .\u00a0]?){10}\d{4}(?!\d)/g;
  for (const m of texto.matchAll(re)) {
    const c = m[0].replace(/\D/g, '');
    if (chavePlausivel(c)) return c;
  }
  return null;
}

/** Chave com dígito verificador certo, UF, mês e modelo de documento possíveis. */
export function chavePlausivel(c: string): boolean {
  if (!chaveValida(c)) return false;
  const mes = Number(c.slice(4, 6));
  return /^(1[1-7]|2[1-9]|3[1-5]|4[1-3]|5[0-3])/.test(c) && mes >= 1 && mes <= 12 && ['55', '65', '57', '67'].includes(c.slice(20, 22));
}
