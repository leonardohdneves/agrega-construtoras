import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITES_TESTE, limitesVigentes, SQL_EM_TESTE } from '../src/lib/teste.ts';

test('durante o teste valem 1 obra e 3 usuários, mesmo que o contrato seja maior', () => {
  const v = limitesVigentes({ limite_obras: 10, limite_usuarios: 20, em_teste: true });
  assert.deepEqual(v, { obras: 1, usuarios: 3, emTeste: true });
  assert.deepEqual(LIMITES_TESTE, { obras: 1, usuarios: 3 });
});

test('fora do teste valem os limites do contrato (null = sem limite)', () => {
  assert.deepEqual(limitesVigentes({ limite_obras: 10, limite_usuarios: null, em_teste: false }), { obras: 10, usuarios: null, emTeste: false });
});

test('a data do teste é comparada no horário de Brasília e exige início e fim preenchidos', () => {
  assert.match(SQL_EM_TESTE, /America\/Sao_Paulo/);
  assert.match(SQL_EM_TESTE, /teste_inicio IS NOT NULL AND teste_fim IS NOT NULL/);
});
