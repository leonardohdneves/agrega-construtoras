import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faixaSlump, fckEstimadoTotal, mpaDeKn, desvioPadrao } from '../src/lib/qualidade.ts';

test('faixa de slump do traço', () => {
  assert.deepEqual(faixaSlump('10 ± 2'), [8, 12]);
  assert.deepEqual(faixaSlump('12±2'), [10, 14]);
  assert.deepEqual(faixaSlump('100 ± 20 mm'), [8, 12]);
  assert.deepEqual(faixaSlump('8 a 12'), [8, 12]);
  assert.deepEqual(faixaSlump('10'), [8, 12]);
  assert.equal(faixaSlump(''), null);
  assert.equal(faixaSlump('fluido'), null);
});

test('fck estimado com amostragem total', () => {
  assert.equal(fckEstimadoTotal([]), null);
  assert.equal(fckEstimadoTotal([31, 28.5, 33]), 28.5);
  // 20 exemplares: ainda o menor
  assert.equal(fckEstimadoTotal(Array.from({ length: 20 }, (_, i) => 30 + i)), 30);
  // 21 exemplares: i = ceil(1,05) = 2 → segundo menor
  assert.equal(fckEstimadoTotal(Array.from({ length: 21 }, (_, i) => 30 + i)), 31);
  // 60 exemplares: i = 3
  assert.equal(fckEstimadoTotal(Array.from({ length: 60 }, (_, i) => 30 + i)), 32);
});

test('conversão da prensa e desvio padrão', () => {
  assert.equal(mpaDeKn(235.6, 100), 30);
  assert.equal(desvioPadrao([1]), null);
  assert.equal(Math.round(desvioPadrao([2, 4, 4, 4, 5, 5, 7, 9])! * 1000) / 1000, 2.138);
});
