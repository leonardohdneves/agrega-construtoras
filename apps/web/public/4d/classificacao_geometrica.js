// Classificação aproximada de elementos IFC genéricos (IfcBuildingElementProxy) pela caixa envolvente.
// Entrada: { dx, dy, dz } em metros e a cota inferior zMin. Saída: classe provisória.
// É uma heurística para um primeiro teste de 4D; os vínculos devem ser revisados.

export const CLASSE = {
  LAJE: 'laje',
  VIGA: 'viga',
  PAREDE: 'parede',
  ESQUADRIA: 'esquadria',
  PILAR: 'pilar',
  OUTRO: 'outro',
};

export function classificar({ dx, dy, dz }) {
  const L = Math.max(dx, dy); // comprimento maior na horizontal
  const t = Math.min(dx, dy); // espessura na horizontal

  if (dz <= 0.5 && t >= 0.6) return CLASSE.LAJE;
  if (dz <= 1.0 && t <= 0.6 && L >= 0.8) return CLASSE.VIGA;
  if (dz >= 1.5 && t >= 0.12 && t <= 0.4 && L >= 0.9) return CLASSE.PAREDE;
  if (dz >= 0.5 && t < 0.12 && L < 3.5) return CLASSE.ESQUADRIA;
  if (dz >= 1.5 && t >= 0.12 && t <= 0.8 && L < 0.9) return CLASSE.PILAR;
  return CLASSE.OUTRO;
}

// Agrupa cotas inferiores em pavimentos: diferenças maiores que `folga` (m) iniciam um novo nível.
export function agruparNiveis(zs, folga = 0.5) {
  const ordenadas = [...new Set(zs.map((z) => Math.round(z * 100) / 100))].sort((a, b) => a - b);
  const niveis = [];
  for (const z of ordenadas) {
    const ultimo = niveis.at(-1);
    if (ultimo && z - ultimo.max <= folga) ultimo.max = z;
    else niveis.push({ min: z, max: z });
  }
  return niveis;
}

export function nivelDeZ(z, niveis) {
  // o nível é o último cujo início está em ou abaixo de z (com tolerância de 0,5 m)
  let idx = 0;
  niveis.forEach((n, i) => {
    if (z >= n.min - 0.5) idx = i;
  });
  return idx;
}
