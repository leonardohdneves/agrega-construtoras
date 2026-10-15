import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chaveEtiqueta, idDaEtiqueta } from '../src/lib/etiquetas.ts';

const ID = '3f2a9c10-7b1e-4d2f-9a6b-0c5d8e1f2a3b';

test('a chave da etiqueta volta ao id da entrada', () => {
  assert.equal(idDaEtiqueta(chaveEtiqueta(ID)), ID);
});

test('aceita o id puro e ignora maiúsculas', () => {
  assert.equal(idDaEtiqueta(ID.toUpperCase()), ID);
});

test('texto que não traz um id não vira etiqueta', () => {
  assert.equal(idDaEtiqueta('AGREGA-ETQ:nao-e-um-id'), null);
  assert.equal(idDaEtiqueta(''), null);
});
