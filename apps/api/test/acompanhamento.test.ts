import { test } from 'node:test';
import assert from 'node:assert/strict';
import { curvaS, fimsDeMes, percentualDeQuantidade, percentuaisEm, previstoXExecutado, valorExecutadoEm, valorPrevistoEm } from '../src/lib/acompanhamento.ts';

test('percentual pela quantidade é limitado entre 0 e 100', () => {
  assert.equal(percentualDeQuantidade(50, 200), 25);
  assert.equal(percentualDeQuantidade(300, 200), 100);
  assert.equal(percentualDeQuantidade(10, 0), 0);
});

test('o último % informado vale até a data, e medições futuras não contam', () => {
  const medicoes = [
    { data: '2026-01-31', itens: new Map([['a', 40]]) },
    { data: '2026-02-28', itens: new Map([['a', 70], ['b', 10]]) },
    { data: '2026-03-31', itens: new Map([['a', 100]]) },
  ];
  assert.deepEqual([...percentuaisEm(medicoes, '2026-02-15')], [['a', 40]]);
  assert.deepEqual(new Map(percentuaisEm(medicoes, '2026-02-28')), new Map([['a', 70], ['b', 10]]));
});

test('valor executado = % × custo de cada linha', () => {
  const custos = new Map([['a', 1000], ['b', 500]]);
  const medicoes = [{ data: '2026-02-28', itens: new Map([['a', 50], ['b', 20]]) }];
  assert.equal(valorExecutadoEm(custos, medicoes, '2026-03-01'), 500 + 100);
});

test('previsto distribui o custo linearmente nos dias da atividade', () => {
  // 10 dias, custo 1000: depois de 5 dias, 500.
  const atv = [{ eapNoId: 'a', inicio: '2026-01-01', fim: '2026-01-10', custo: 1000 }];
  assert.equal(valorPrevistoEm(atv, '2026-01-05'), 500);
  assert.equal(valorPrevistoEm(atv, '2026-02-01'), 1000);
  assert.equal(valorPrevistoEm(atv, '2025-12-31'), 0);
});

test('fins de mês entre duas datas', () => {
  assert.deepEqual(fimsDeMes('2026-01-15', '2026-03-02'), ['2026-01-31', '2026-02-28']);
});

test('Curva S não mostra executado nem realizado depois de hoje', () => {
  const custos = new Map([['a', 1000]]);
  const medicoes = [{ data: '2026-01-31', itens: new Map([['a', 50]]) }];
  const atv = [{ eapNoId: 'a', inicio: '2026-01-01', fim: '2026-02-28', custo: 1000 }];
  const pontos = curvaS({ custos, medicoes, atividades: atv, despesas: [{ data: '2026-01-20', valor: 300 }], de: '2026-01-01', ate: '2026-03-31', hoje: '2026-02-10' });
  assert.equal(pontos[0].realizado, 300);
  assert.equal(pontos[0].executado, 500);
  assert.equal(pontos[1].executado, null); // fevereiro termina depois de hoje
  assert.equal(pontos[2].previsto, 1000);
});

test('previsto x executado soma as folhas abaixo de cada etapa e calcula o SPI', () => {
  const nos = [
    { id: 'e1', paiId: null, codigo: '1', nivel: 'etapa', descricao: 'Fundação' },
    { id: 'f1', paiId: 'e1', codigo: '1.1', nivel: 'tarefa', descricao: 'Sapata' },
    { id: 'f2', paiId: 'e1', codigo: '1.2', nivel: 'tarefa', descricao: 'Baldrame' },
  ];
  const custos = new Map([['f1', 1000], ['f2', 1000]]);
  const medicoes = [{ data: '2026-01-31', itens: new Map([['f1', 100], ['f2', 0]]) }];
  const atv = [
    { eapNoId: 'f1', inicio: '2026-01-01', fim: '2026-01-10', custo: 1000 },
    { eapNoId: 'f2', inicio: '2026-01-11', fim: '2026-01-20', custo: 1000 },
  ];
  const linhas = previstoXExecutado({ nos, custos, medicoes, atividades: atv, dataRef: '2026-01-31' });
  const etapa = linhas.find((l) => l.id === 'e1')!;
  assert.equal(etapa.custoPrevisto, 2000);
  assert.equal(etapa.executado, 1000);
  assert.equal(etapa.previstoAte, 2000);
  assert.equal(etapa.spi, 0.5);
  assert.equal(etapa.saldo, 1000);
});

test('Curva S inclui o mês em que termina o planejamento, mesmo antes do último dia', () => {
  const pontos = curvaS({
    custos: new Map([['a', 1000]]),
    medicoes: [],
    atividades: [{ eapNoId: 'a', inicio: '2026-05-01', fim: '2026-06-08', custo: 1000 }],
    despesas: [],
    de: '2026-05-01',
    ate: '2026-06-08',
    hoje: '2026-05-09',
  });
  assert.deepEqual(pontos.map((p) => p.data), ['2026-05-31', '2026-06-30']);
  assert.equal(pontos[1].previsto, 1000);
});

test('Curva S vai até o mês de hoje quando o planejamento já terminou', () => {
  const pontos = curvaS({
    custos: new Map([['a', 1000]]),
    medicoes: [{ data: '2026-05-09', itens: new Map([['a', 50]]) }],
    atividades: [{ eapNoId: 'a', inicio: '2026-05-01', fim: '2026-05-20', custo: 1000 }],
    despesas: [{ data: '2026-09-10', valor: 300 }],
    de: '2026-05-01',
    ate: '2026-05-20',
    hoje: '2026-10-15',
  });
  assert.deepEqual(pontos.map((p) => p.data), ['2026-05-31', '2026-06-30', '2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31']);
  assert.equal(pontos[4].realizado, 300);
  assert.equal(pontos[4].executado, 500);
  assert.equal(pontos[5].executado, null); // 31/10 ainda não chegou
});
