import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conferirLeituras, consumoDoAbastecimento, consumoMedio, pioraDeConsumo, saltoSuspeito } from '../src/lib/consumo.ts';

test('Consumo de um abastecimento: km/L e L/h', () => {
  const c = consumoDoAbastecimento({ km: 128430, horimetro: 6215, litros: 182.5 }, { km: 128090, horimetro: 6201 });
  assert.equal(c.kmRodados, 340);
  assert.equal(c.horas, 14);
  assert.equal(c.kmPorLitro, 1.86);
  assert.equal(c.litrosPorHora, 13.04);
});

test('Sem abastecimento anterior ou sem leitura não calcula', () => {
  assert.deepEqual(consumoDoAbastecimento({ km: 100, horimetro: 10, litros: 50 }, null), { kmRodados: null, horas: null, kmPorLitro: null, litrosPorHora: null });
  const so = consumoDoAbastecimento({ km: null, horimetro: 3910, litros: 60 }, { km: 61000, horimetro: 3900 });
  assert.equal(so.kmPorLitro, null);
  assert.equal(so.litrosPorHora, 6);
});

test('Consumo médio é total rodado ÷ total de litros (não a média das médias)', () => {
  const m = consumoMedio([
    { litros: 100, consumo: { kmRodados: null, horas: null, kmPorLitro: null, litrosPorHora: null } },
    { litros: 100, consumo: { kmRodados: 300, horas: 10, kmPorLitro: 3, litrosPorHora: 10 } },
    { litros: 200, consumo: { kmRodados: 200, horas: 10, kmPorLitro: 1, litrosPorHora: 20 } },
  ]);
  assert.equal(m.kmPorLitro, 1.67); // 500 km ÷ 300 L
  assert.equal(m.litrosPorHora, 15); // 300 L ÷ 20 h
  assert.equal(m.litros, 400);
  assert.equal(m.km, 500);
});

test('Leituras fora de ordem são recusadas com mensagem clara', () => {
  const ant = { km: 128090, horimetro: 6201, data: '28/09/2026' };
  const seg = { km: 129000, horimetro: 6260, data: '05/10/2026' };
  assert.equal(conferirLeituras({ km: 128430, horimetro: 6215 }, ant, seg), null);
  assert.match(conferirLeituras({ km: 128000, horimetro: 6215 }, ant, seg)!, /menor que o do abastecimento anterior/);
  assert.match(conferirLeituras({ km: 128430, horimetro: 6100 }, ant, seg)!, /horímetro informado/);
  assert.match(conferirLeituras({ km: 129500, horimetro: 6215 }, ant, seg)!, /maior que o de um abastecimento posterior/);
  assert.equal(conferirLeituras({ km: null, horimetro: null }, null, null), 'Informe o km ou o horímetro.');
  assert.equal(conferirLeituras({ km: 5, horimetro: null }, null, null), null);
});

test('Salto grande de km ou horímetro gera aviso', () => {
  assert.match(saltoSuspeito({ km: 140000, horimetro: null }, { km: 128000, horimetro: null })!, /dígito a mais/);
  assert.equal(saltoSuspeito({ km: 128400, horimetro: null }, { km: 128000, horimetro: null }), null);
});

test('Piora de consumo acima de 15%', () => {
  const media = { kmPorLitro: 2.2, litrosPorHora: 12 };
  assert.equal(pioraDeConsumo({ kmRodados: 300, horas: null, kmPorLitro: 1.8, litrosPorHora: null }, media), 0.18);
  assert.equal(pioraDeConsumo({ kmRodados: 300, horas: null, kmPorLitro: 2.0, litrosPorHora: null }, media), null);
  assert.equal(pioraDeConsumo({ kmRodados: null, horas: 10, kmPorLitro: null, litrosPorHora: 14.4 }, media), 0.2);
});
