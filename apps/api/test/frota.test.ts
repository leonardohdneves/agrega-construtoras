import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpfValido, diasEntre, formatarPlaca, hojeBrasil, normalizarPlaca, situacaoVencimento } from '../src/lib/frota.ts';
import { esquemaAlterarMotorista, esquemaAlterarVeiculo, esquemaDocumento, esquemaMotorista, esquemaVeiculo } from '../src/esquemas-frota.ts';

test('Vencimentos: dias e situação', () => {
  assert.equal(diasEntre('2026-10-02', '2026-10-02'), 0);
  assert.equal(diasEntre('2026-10-02', '2026-11-01'), 30);
  assert.equal(diasEntre('2026-10-02', '2026-09-29'), -3);
  assert.equal(diasEntre('2026-12-31', '2027-01-01'), 1);
  assert.deepEqual(situacaoVencimento('2026-09-29', '2026-10-02'), { situacao: 'vencido', dias: -3 });
  assert.deepEqual(situacaoVencimento('2026-10-02', '2026-10-02'), { situacao: 'vencendo', dias: 0 });
  assert.deepEqual(situacaoVencimento('2026-11-01', '2026-10-02'), { situacao: 'vencendo', dias: 30 });
  assert.deepEqual(situacaoVencimento('2026-11-02', '2026-10-02'), { situacao: 'em_dia', dias: 31 });
  assert.deepEqual(situacaoVencimento(null, '2026-10-02'), { situacao: 'sem_data', dias: null });
});

test('Data de hoje usa o fuso de Brasília', () => {
  // 02:00 UTC de 03/10 ainda é 23:00 de 02/10 em Brasília.
  assert.equal(hojeBrasil(new Date('2026-10-03T02:00:00Z')), '2026-10-02');
  assert.equal(hojeBrasil(new Date('2026-10-03T04:00:00Z')), '2026-10-03');
});

test('Placa: padrão antigo e Mercosul', () => {
  assert.equal(normalizarPlaca('abc-1234'), 'ABC1234');
  assert.equal(normalizarPlaca('RXA 1B23'), 'RXA1B23');
  assert.equal(normalizarPlaca('AB12345'), null);
  assert.equal(normalizarPlaca('ABC12345'), null);
  assert.equal(formatarPlaca('ABC1234'), 'ABC-1234');
  assert.equal(formatarPlaca('RXA1B23'), 'RXA1B23');
});

test('CPF', () => {
  assert.equal(cpfValido('529.982.247-25'), true);
  assert.equal(cpfValido('529.982.247-24'), false);
  assert.equal(cpfValido('111.111.111-11'), false);
});

test('Veículo: aceita números no formato brasileiro e padroniza código e placa', () => {
  const v = esquemaVeiculo.parse({ codigo: ' bet-07 ', tipo: 'betoneira', placa: 'rxa-1b23', capacidadeM3: '8,0', kmAtual: '128.430', horimetroAtual: '6215,5', ano: '2019' });
  assert.equal(v.codigo, 'BET-07');
  assert.equal(v.placa, 'RXA1B23');
  assert.equal(v.capacidadeM3, 8);
  assert.equal(v.kmAtual, 128430);
  assert.equal(v.horimetroAtual, 6215.5);
  assert.equal(v.ano, 2019);
  assert.equal(v.status, 'disponivel');
  const semPlaca = esquemaVeiculo.parse({ codigo: 'PA-01', tipo: 'pa_carregadeira', placa: '' });
  assert.equal(semPlaca.placa, null);
});

test('Veículo: recusa placa, tipo e números inválidos', () => {
  assert.equal(esquemaVeiculo.safeParse({ codigo: 'X', tipo: 'betoneira', placa: '123' }).success, false);
  assert.equal(esquemaVeiculo.safeParse({ codigo: 'X', tipo: 'trator' }).success, false);
  assert.equal(esquemaVeiculo.safeParse({ codigo: 'X', tipo: 'betoneira', kmAtual: '-5' }).success, false);
  assert.equal(esquemaVeiculo.safeParse({ codigo: 'X', tipo: 'betoneira', capacidadeM3: 'muito' }).success, false);
  assert.equal(esquemaVeiculo.safeParse({ codigo: '', tipo: 'betoneira' }).success, false);
});

test('Alterar veículo: só muda o que foi enviado', () => {
  const d = esquemaAlterarVeiculo.parse({ status: 'manutencao' });
  assert.deepEqual(d, { status: 'manutencao' });
  assert.equal(esquemaAlterarVeiculo.safeParse({ empresaId: 'x' }).success, false);
});

test('Documento e motorista', () => {
  const doc = esquemaDocumento.parse({ tipo: 'seguro', vencimento: '2026-10-18', valor: '6.400,00' });
  assert.equal(doc.valor, 6400);
  assert.equal(doc.vencimento, '2026-10-18');
  assert.equal(esquemaDocumento.safeParse({ tipo: 'seguro', vencimento: '18/10/2026' }).success, false);
  const m = esquemaMotorista.parse({ nome: 'João', cpf: '529.982.247-25', cnhCategoria: 'e', cnhVencimento: '' });
  assert.equal(m.cpf, '52998224725');
  assert.equal(m.cnhCategoria, 'E');
  assert.equal(m.cnhVencimento, null);
  assert.equal(esquemaMotorista.safeParse({ nome: 'João', cpf: '123' }).success, false);
  assert.equal(esquemaMotorista.safeParse({ nome: 'João', cnhCategoria: 'Z' }).success, false);
  assert.deepEqual(esquemaAlterarMotorista.parse({ ativo: false }), { ativo: false });
});
