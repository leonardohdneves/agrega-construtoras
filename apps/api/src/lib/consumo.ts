// Cálculos de consumo da frota.
// Método do tanque cheio: o consumo de um abastecimento é a distância (ou as horas)
// desde o abastecimento anterior dividida pelos litros colocados agora.

export type Leitura = { km: number | null; horimetro: number | null };
export type Abast = Leitura & { litros: number };

export type Consumo = {
  kmRodados: number | null;
  horas: number | null;
  kmPorLitro: number | null;
  litrosPorHora: number | null;
};

const arred = (n: number, casas: number) => Math.round(n * 10 ** casas) / 10 ** casas;

export function consumoDoAbastecimento(atual: Abast, anterior: Leitura | null): Consumo {
  if (!anterior) return { kmRodados: null, horas: null, kmPorLitro: null, litrosPorHora: null };
  const kmRodados = atual.km !== null && anterior.km !== null ? arred(atual.km - anterior.km, 1) : null;
  const horas = atual.horimetro !== null && anterior.horimetro !== null ? arred(atual.horimetro - anterior.horimetro, 1) : null;
  return {
    kmRodados,
    horas,
    kmPorLitro: kmRodados !== null && kmRodados > 0 && atual.litros > 0 ? arred(kmRodados / atual.litros, 2) : null,
    litrosPorHora: horas !== null && horas > 0 ? arred(atual.litros / horas, 2) : null,
  };
}

/** Consumo médio de um período: total rodado ÷ total de litros, só com abastecimentos que têm leitura anterior. */
export function consumoMedio(itens: { litros: number; consumo: Consumo }[]): { kmPorLitro: number | null; litrosPorHora: number | null; litros: number; km: number; horas: number } {
  let litrosKm = 0;
  let km = 0;
  let litrosH = 0;
  let horas = 0;
  let litros = 0;
  for (const i of itens) {
    litros += i.litros;
    if (i.consumo.kmPorLitro !== null && i.consumo.kmRodados !== null) {
      km += i.consumo.kmRodados;
      litrosKm += i.litros;
    }
    if (i.consumo.litrosPorHora !== null && i.consumo.horas !== null) {
      horas += i.consumo.horas;
      litrosH += i.litros;
    }
  }
  return {
    kmPorLitro: litrosKm > 0 ? arred(km / litrosKm, 2) : null,
    litrosPorHora: horas > 0 ? arred(litrosH / horas, 2) : null,
    litros: arred(litros, 2),
    km: arred(km, 1),
    horas: arred(horas, 1),
  };
}

const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

/**
 * Confere se o km e o horímetro informados cabem entre o abastecimento anterior e o seguinte do mesmo veículo.
 * Devolve a mensagem de erro, ou null se estiver tudo certo.
 */
export function conferirLeituras(nova: Leitura, anterior: (Leitura & { data: string }) | null, seguinte: (Leitura & { data: string }) | null): string | null {
  if (nova.km === null && nova.horimetro === null) return 'Informe o km ou o horímetro.';
  if (anterior) {
    if (nova.km !== null && anterior.km !== null && nova.km < anterior.km)
      return `O km informado (${fmt(nova.km)}) é menor que o do abastecimento anterior (${fmt(anterior.km)} em ${anterior.data}). Confira o painel do caminhão.`;
    if (nova.horimetro !== null && anterior.horimetro !== null && nova.horimetro < anterior.horimetro)
      return `O horímetro informado (${fmt(nova.horimetro)} h) é menor que o do abastecimento anterior (${fmt(anterior.horimetro)} h em ${anterior.data}).`;
  }
  if (seguinte) {
    if (nova.km !== null && seguinte.km !== null && nova.km > seguinte.km)
      return `O km informado (${fmt(nova.km)}) é maior que o de um abastecimento posterior (${fmt(seguinte.km)} em ${seguinte.data}).`;
    if (nova.horimetro !== null && seguinte.horimetro !== null && nova.horimetro > seguinte.horimetro)
      return `O horímetro informado (${fmt(nova.horimetro)} h) é maior que o de um abastecimento posterior (${fmt(seguinte.horimetro)} h em ${seguinte.data}).`;
  }
  return null;
}

/** Salto grande demais desde o abastecimento anterior (provável erro de digitação). */
export function saltoSuspeito(nova: Leitura, anterior: Leitura | null): string | null {
  if (!anterior) return null;
  if (nova.km !== null && anterior.km !== null && nova.km - anterior.km > 3000)
    return `O km subiu ${fmt(nova.km - anterior.km)} desde o último abastecimento. Confira se não há um dígito a mais.`;
  if (nova.horimetro !== null && anterior.horimetro !== null && nova.horimetro - anterior.horimetro > 300)
    return `O horímetro subiu ${fmt(nova.horimetro - anterior.horimetro)} h desde o último abastecimento. Confira se não há um dígito a mais.`;
  return null;
}

export const TOLERANCIA_CONSUMO = 0.15;

/**
 * Compara o último consumo com a média do veículo. Para km/L, pior é menor; para L/h, pior é maior.
 * Devolve o percentual de piora (ex.: 0.18 = 18% pior) ou null se estiver dentro da tolerância.
 */
export function pioraDeConsumo(ultimo: Consumo, media: { kmPorLitro: number | null; litrosPorHora: number | null }, tolerancia = TOLERANCIA_CONSUMO): number | null {
  if (ultimo.kmPorLitro !== null && media.kmPorLitro) {
    const piora = 1 - ultimo.kmPorLitro / media.kmPorLitro;
    if (piora > tolerancia) return arred(piora, 2);
  }
  if (ultimo.litrosPorHora !== null && media.litrosPorHora) {
    const piora = ultimo.litrosPorHora / media.litrosPorHora - 1;
    if (piora > tolerancia) return arred(piora, 2);
  }
  return null;
}
