// Leitura de IFC para a EAP e o orçamento: volume pela geometria, agrupamento por pavimento e tipo, e conferência
// do modelo de exemplo (casa de 10 × 8 m, com paredes, laje, pilares, viga, porta e janela).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { quantitativosDoIfc, volumeDaMalha } from '../src/lib/ifc-leitura.ts';

test('volume de malha fechada: tetraedro de volume 1/6', () => {
  const vertices = new Float32Array([
    0, 0, 0, 0, 0, 0,
    1, 0, 0, 0, 0, 0,
    0, 1, 0, 0, 0, 0,
    0, 0, 1, 0, 0, 0,
  ]);
  const indices = new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 3, 2]);
  const identidade = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  assert.ok(Math.abs(volumeDaMalha(vertices, indices, identidade) - 1 / 6) < 1e-9);
});

test('volume respeita a transformação do elemento (escala 2 vira volume × 8)', () => {
  const vertices = new Float32Array([0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0]);
  const indices = new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 3, 2]);
  const escala2 = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1];
  assert.ok(Math.abs(volumeDaMalha(vertices, indices, escala2) - 8 / 6) < 1e-9);
});

test('modelo de exemplo: agrupa por pavimento e tipo, com volume e contagem', async () => {
  const bytes = new Uint8Array(fs.readFileSync(new URL('./fixtures/exemplo_casa.ifc', import.meta.url)));
  const r = await quantitativosDoIfc(bytes);
  assert.ok(r.itens.length > 0, 'há itens');
  assert.ok(r.itens.every((i) => i.pavimento && i.descricao && i.quantidade >= 0));
  const paredes = r.itens.filter((i) => i.tipo === 'parede');
  assert.ok(paredes.length > 0 && paredes.every((i) => i.unidade === 'm³' && i.quantidade > 0), 'paredes em m³ com volume');
  // o modelo de exemplo tem 4 paredes, 1 laje e 4 pilares; sem viga, porta ou janela
  assert.ok(r.itens.some((i) => i.tipo === 'laje') && r.itens.some((i) => i.tipo === 'pilar'), 'laje e pilar agrupados');
  assert.equal(r.itens.reduce((s, i) => s + i.elementos, 0), 9, 'os 9 elementos do modelo entram nos grupos');
  // laje 10 × 8 × 0,15 m = 12 m³ (conferido à mão)
  assert.ok(Math.abs(r.itens.find((i) => i.tipo === 'laje')!.quantidade - 12) < 0.01, 'volume da laje');
  const portas = r.itens.filter((i) => i.tipo === 'porta');
  assert.ok(portas.every((i) => i.unidade === 'un' && Number.isInteger(i.quantidade)), 'portas contadas em un');
});
