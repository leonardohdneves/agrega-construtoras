import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITE_EMPREENDIMENTOS, mensagemLimiteEmpreendimentos } from '../src/lib/avisos.ts';

test('limite de empreendimentos do adicional de incorporação é 3', () => {
  assert.equal(LIMITE_EMPREENDIMENTOS, 3);
});

test('mensagem do aviso cita a empresa e a quantidade', () => {
  const m = mensagemLimiteEmpreendimentos('NEVES ENGENHARIA', 4);
  assert.match(m, /NEVES ENGENHARIA tem 4 empreendimentos/);
  assert.match(m, /até 3/);
});
