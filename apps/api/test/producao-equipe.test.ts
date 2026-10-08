import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularFaixas, textoFaixas, validarFaixas } from '../src/lib/producao-equipe.ts';

const faixas = [
  { ate: 1000, valorM3: 200 },
  { ate: null, valorM3: 150 },
];

test('progressiva: cada faixa paga o seu volume', () => {
  assert.equal(calcularFaixas(800, faixas, 'progressiva').valor, 160000);
  const r = calcularFaixas(1200, faixas, 'progressiva');
  assert.equal(r.valor, 1000 * 200 + 200 * 150);
  assert.equal(r.partes.length, 2);
  assert.equal(r.partes[1].m3, 200);
});

test('faixa atingida: todo o volume no valor da faixa', () => {
  assert.equal(calcularFaixas(800, faixas, 'faixa').valor, 160000);
  assert.equal(calcularFaixas(1200, faixas, 'faixa').valor, 1200 * 150);
  assert.equal(calcularFaixas(1000, faixas, 'faixa').valor, 1000 * 200);
});

test('sem volume não paga', () => {
  assert.equal(calcularFaixas(0, faixas, 'progressiva').valor, 0);
});

test('validação das faixas', () => {
  assert.equal(validarFaixas(faixas), null);
  assert.ok(validarFaixas([]));
  assert.ok(validarFaixas([{ ate: null, valorM3: 1 }, { ate: 10, valorM3: 1 }]));
  assert.ok(validarFaixas([{ ate: 10, valorM3: 1 }, { ate: 5, valorM3: 1 }]));
});

test('texto das faixas', () => {
  assert.match(textoFaixas(faixas), /até 1\.000 m³: R\$\s2,00\/m³ · acima de 1\.000 m³: R\$\s1,50\/m³/);
});
