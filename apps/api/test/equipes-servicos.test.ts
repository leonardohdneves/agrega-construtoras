import { test } from 'node:test';
import assert from 'node:assert/strict';
import { percentualEm, producaoDoMes } from '../src/lib/equipes-servicos.ts';

const medicoes = [
  { data: '2026-09-30', itens: new Map([['n1', 20]]) },
  { data: '2026-10-31', itens: new Map([['n1', 50]]) },
];

test('percentual vale até a próxima medição do mesmo serviço', () => {
  assert.equal(percentualEm(medicoes, 'n1', '2026-09-15'), 0);
  assert.equal(percentualEm(medicoes, 'n1', '2026-10-15'), 20);
  assert.equal(percentualEm(medicoes, 'n1', '2026-11-30'), 50);
  assert.equal(percentualEm(medicoes, 'n2', '2026-11-30'), 0);
});

test('produção do mês = quantidade executada no mês × preço unitário da equipe', () => {
  const r = producaoDoMes({
    atribuicoes: [{ eapNoId: 'n1', codigo: '1.1', descricao: 'Alvenaria', colaboradorId: 'c1', nome: 'Pedro', precoCentavos: 2500 }],
    medicoes,
    orcado: new Map([['n1', { unidade: 'm²', quantidade: 200 }]]),
    noEmMedicao: new Map([['n1', { codigo: '1.1', descricao: 'Alvenaria' }]]),
    de: '2026-10-01',
    ate: '2026-10-31',
  });
  // 50% − 20% = 30% de 200 m² = 60 m² × R$ 25,00 = R$ 1.500,00
  assert.equal(r.totalCentavos, 150000);
  assert.equal(r.colaboradores[0].servicos[0].quantidadeMes, 60);
  assert.equal(r.semEquipe.length, 0);
});

test('serviço medido sem equipe aparece à parte, sem valor', () => {
  const r = producaoDoMes({
    atribuicoes: [],
    medicoes,
    orcado: new Map([['n1', { unidade: 'm²', quantidade: 200 }]]),
    noEmMedicao: new Map([['n1', { codigo: '1.1', descricao: 'Alvenaria' }]]),
    de: '2026-10-01',
    ate: '2026-10-31',
  });
  assert.equal(r.totalCentavos, 0);
  assert.equal(r.semEquipe.length, 1);
  assert.equal(r.semEquipe[0].quantidadeMes, 60);
});

test('serviço sem unidade definida não gera valor', () => {
  const r = producaoDoMes({
    atribuicoes: [{ eapNoId: 'n1', codigo: '1.1', descricao: 'Alvenaria', colaboradorId: 'c1', nome: 'Pedro', precoCentavos: 2500 }],
    medicoes,
    orcado: new Map([['n1', { unidade: null, quantidade: null }]]),
    noEmMedicao: new Map(),
    de: '2026-10-01',
    ate: '2026-10-31',
  });
  assert.equal(r.totalCentavos, 0);
  assert.equal(r.colaboradores[0].servicos[0].valorCentavos, null);
});
