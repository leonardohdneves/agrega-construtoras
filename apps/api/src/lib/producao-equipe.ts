// Produção da equipe (operador de usina, gestor de pátio, vendedor): R$/m³ por faixas de volume no mês.

export type Faixa = { ate: number | null; valorM3: number }; // ate em m³ (null = acima da última); valorM3 em centavos
export type ModoFaixas = 'progressiva' | 'faixa';
export type Parte = { de: number; ate: number | null; m3: number; valorM3: number; valor: number };

/** Ordena e confere as faixas: limites crescentes e só a última sem limite. */
export function validarFaixas(faixas: Faixa[]): string | null {
  if (!faixas.length) return 'Informe ao menos uma faixa.';
  for (let i = 0; i < faixas.length; i++) {
    const f = faixas[i];
    if (!(f.valorM3 >= 0)) return 'Valor por m³ inválido.';
    if (f.ate === null && i !== faixas.length - 1) return 'Só a última faixa pode ficar sem limite.';
    if (f.ate !== null && !(f.ate > 0)) return 'O limite da faixa precisa ser maior que zero.';
    const ant = i > 0 ? faixas[i - 1].ate : 0;
    if (f.ate !== null && ant !== null && f.ate <= ant) return 'Os limites das faixas precisam ser crescentes.';
  }
  return null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Valor (centavos) do volume pelas faixas.
 * progressiva: até 1.000 m³ a R$ 2,00 e o que passar a R$ 1,50 → 1.200 m³ = 1.000 × 2,00 + 200 × 1,50.
 * faixa: todo o volume paga o valor da faixa em que o total caiu → 1.200 m³ × 1,50.
 */
export function calcularFaixas(m3: number, faixas: Faixa[], modo: ModoFaixas): { valor: number; partes: Parte[] } {
  const total = Math.max(0, m3);
  if (!faixas.length || total === 0) return { valor: 0, partes: [] };
  if (modo === 'faixa') {
    let de = 0;
    for (const f of faixas) {
      if (f.ate === null || total <= f.ate) {
        const valor = Math.round(total * f.valorM3);
        return { valor, partes: [{ de, ate: f.ate, m3: r2(total), valorM3: f.valorM3, valor }] };
      }
      de = f.ate;
    }
    // Passou da última faixa limitada: vale a última.
    const u = faixas[faixas.length - 1];
    const valor = Math.round(total * u.valorM3);
    return { valor, partes: [{ de, ate: u.ate, m3: r2(total), valorM3: u.valorM3, valor }] };
  }
  const partes: Parte[] = [];
  let de = 0;
  for (let i = 0; i < faixas.length && de < total; i++) {
    const f = faixas[i];
    const ultima = i === faixas.length - 1;
    const teto = f.ate === null || ultima ? total : Math.min(f.ate, total);
    const vol = Math.max(0, teto - de);
    if (vol > 0) partes.push({ de, ate: f.ate, m3: r2(vol), valorM3: f.valorM3, valor: Math.round(vol * f.valorM3) });
    de = teto;
  }
  return { valor: partes.reduce((s, p) => s + p.valor, 0), partes };
}

/** "até 1.000 m³: R$ 2,00/m³ · acima de 1.000 m³: R$ 1,50/m³" */
export function textoFaixas(faixas: Faixa[]): string {
  const n = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  const rs = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return faixas
    .map((f, i) => {
      const ant = i > 0 ? faixas[i - 1].ate : null;
      if (f.ate === null) return `${ant ? `acima de ${n(ant)} m³` : 'qualquer volume'}: ${rs(f.valorM3)}/m³`;
      return `${ant ? `de ${n(ant)} a ${n(f.ate)} m³` : `até ${n(f.ate)} m³`}: ${rs(f.valorM3)}/m³`;
    })
    .join(' · ');
}
