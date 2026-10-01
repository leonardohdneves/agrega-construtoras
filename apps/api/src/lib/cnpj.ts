// Validação e formatação de CNPJ (somente números, 14 dígitos).

export function limparCnpj(valor: string): string {
  return (valor ?? '').replace(/\D/g, '');
}

function digito(base: string, pesos: number[]): number {
  let soma = 0;
  for (let i = 0; i < pesos.length; i++) soma += Number(base[i]) * pesos[i];
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function cnpjValido(valor: string): boolean {
  const c = limparCnpj(valor);
  if (c.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(c)) return false;
  const d1 = digito(c, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = digito(c, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(c[12]) && d2 === Number(c[13]);
}

export function formatarCnpj(valor: string): string {
  const c = limparCnpj(valor);
  if (c.length !== 14) return valor;
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}
