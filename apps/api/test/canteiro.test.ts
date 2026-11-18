import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarItensBoletim, previstoAte, proximoPeriodo } from '../src/lib/canteiro.ts';

const atividades = [{ eapNoId: 'a', inicio: '2026-03-01', fim: '2026-03-10' }]; // 10 dias

test('previsto: avanço linear pelos dias da atividade, até o último dia', () => {
  assert.equal(previstoAte(atividades, 'a', '2026-02-28'), 0);
  assert.equal(previstoAte(atividades, 'a', '2026-03-05'), 50);
  assert.equal(previstoAte(atividades, 'a', '2026-03-10'), 100);
  assert.equal(previstoAte(atividades, 'a', '2026-04-30'), 100);
  assert.equal(previstoAte(atividades, 'x', '2026-03-05'), null);
});

test('previsto: média das atividades de um mesmo serviço', () => {
  const dup = [...atividades, { eapNoId: 'a', inicio: '2026-03-01', fim: '2026-03-01' }];
  assert.equal(previstoAte(dup, 'a', '2026-03-05'), (50 + 100) / 2);
});

test('boletim: previsto e realizado dentro do período', () => {
  const medicoes = [
    { data: '2026-03-03', itens: new Map([['a', 20]]) },
    { data: '2026-03-08', itens: new Map([['a', 60]]) },
  ];
  const [item] = montarItensBoletim({ servicos: ['a'], atividades, medicoes, inicio: '2026-03-04', fim: '2026-03-08' });
  // previsto: 80% em 08/03 menos 30% em 03/03 = 50 pontos; realizado: 60% menos 20% = 40 pontos
  assert.equal(item.previstoPct, 50);
  assert.equal(item.realizadoPct, 40);
});

test('boletim: serviço sem atividade e sem medição vale zero', () => {
  const [item] = montarItensBoletim({ servicos: ['z'], atividades, medicoes: [], inicio: '2026-03-01', fim: '2026-03-31' });
  assert.deepEqual(item, { eapNoId: 'z', previstoPct: 0, realizadoPct: 0 });
});

test('próximo período: começa no dia seguinte ao último boletim e dura a periodicidade', () => {
  assert.deepEqual(proximoPeriodo({ ultimoFim: '2026-03-08', inicioObra: '2026-01-01', hoje: '2026-06-01', periodicidadeDias: 7 }), { inicio: '2026-03-09', fim: '2026-03-15' });
  assert.deepEqual(proximoPeriodo({ ultimoFim: null, inicioObra: '2026-01-05', hoje: '2026-06-01', periodicidadeDias: 14 }), { inicio: '2026-01-05', fim: '2026-01-18' });
  assert.deepEqual(proximoPeriodo({ ultimoFim: null, inicioObra: null, hoje: '2026-06-01', periodicidadeDias: 1 }), { inicio: '2026-06-01', fim: '2026-06-01' });
});
