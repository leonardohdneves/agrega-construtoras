import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ErroHttp } from '../src/lib/erros.ts';
import { escolherUltimaCompra, fatorEntrada, precoBaseDaCompra, unidadesValidas } from '../src/lib/unidades-insumo.ts';

test('unidades de compra: aceita barra com fator em texto com vírgula', () => {
  const r = unidadesValidas([{ unidade: 'barra', fator: '46,2' }], 'kg');
  assert.deepEqual(r, [{ unidade: 'barra', fator: 46.2 }]);
});

test('unidades de compra: recusa unidade base, repetida e fator inválido', () => {
  assert.throws(() => unidadesValidas([{ unidade: 'KG', fator: 1 }], 'kg'), (e: unknown) => e instanceof ErroHttp && /unidade base/.test((e as Error).message));
  assert.throws(() => unidadesValidas([{ unidade: 'barra', fator: 1 }, { unidade: 'Barra', fator: 2 }], 'kg'), /repetida/);
  assert.throws(() => unidadesValidas([{ unidade: 'barra', fator: 0 }], 'kg'), /cabem em 1 barra/);
  assert.throws(() => unidadesValidas([{ unidade: 'barra', fator: 'abc' }], 'kg'), /cabem em 1 barra/);
});

test('fator da entrada: base, unidade mapeada e sem mapeamento', () => {
  assert.equal(fatorEntrada(null, 'kg', null), 1);
  assert.equal(fatorEntrada('KG', 'kg', null), 1);
  assert.equal(fatorEntrada('barra', 'kg', 46.2), 46.2);
  assert.equal(fatorEntrada('saco', 'kg', null), 1);
});

test('preço base: valor da linha dividido pela quantidade na unidade base', () => {
  // 10 barras por R$ 4.620,00 com 46,2 kg por barra: 462 kg a R$ 10,00 por kg
  assert.equal(precoBaseDaCompra(462000, 10, 46.2), 1000);
});

test('última compra: pega a mais recente convertível e pula as não convertíveis', () => {
  const linhas = [
    { valorCentavos: 900000, quantidade: 5, unidade: 'saco', data: '2026-10-10', fatorMapeado: null },
    { valorCentavos: 462000, quantidade: 10, unidade: 'barra', data: '2026-09-02', fatorMapeado: 46.2 },
  ];
  assert.deepEqual(escolherUltimaCompra(linhas, 'kg'), { precoBaseCentavos: 1000, data: '2026-09-02' });
  assert.equal(escolherUltimaCompra([], 'kg'), null);
  assert.equal(escolherUltimaCompra([{ valorCentavos: 0, quantidade: 1, unidade: 'kg', data: '2026-01-01', fatorMapeado: null }], 'kg'), null);
});
