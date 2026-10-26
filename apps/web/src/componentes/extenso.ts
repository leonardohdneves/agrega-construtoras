// Valor por extenso (reais e centavos), para o texto do modelo de laudo.
const UNIDADES_EXT = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS_EXT = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS_EXT = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
function ate999(n: number): string {
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const r = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CENTENAS_EXT[c]);
  if (r) partes.push(r < 20 ? UNIDADES_EXT[r] : DEZENAS_EXT[Math.floor(r / 10)] + (r % 10 ? ` e ${UNIDADES_EXT[r % 10]}` : ''));
  return partes.join(' e ');
}
function porExtenso(n: number): string {
  if (n === 0) return 'zero';
  const partes: string[] = [];
  const mi = Math.floor(n / 1000000);
  const mil = Math.floor((n % 1000000) / 1000);
  const resto = n % 1000;
  if (mi) partes.push(mi === 1 ? 'um milhão' : `${ate999(mi)} milhões`);
  if (mil) partes.push(mil === 1 ? 'mil' : `${ate999(mil)} mil`);
  if (resto) partes.push(ate999(resto));
  return partes.join(' e ');
}
export function valorExtenso(valor: number): string {
  const reais = Math.floor(valor);
  const centavos = Math.round((valor - reais) * 100);
  let t = `${porExtenso(reais)} ${reais === 1 ? 'real' : 'reais'}`;
  if (centavos) t += ` e ${porExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`;
  return t;
}
