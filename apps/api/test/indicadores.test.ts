import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BRUTO_ZERO, calcularIndicadores, INDICADORES } from '../src/lib/indicadores.ts';

const retrato = { disponiveis: 9, ativos: 12, revisoesEmDia: 30, revisoesComRegistro: 40, receberAberto: 100_000_00, receberVencido: 15_000_00, saldoCaixa: 60_000_00, saidasDia: 2_000_00, notasPendentes: 3 };

test('indicadores do período somam os meses antes de dividir', () => {
  const brutos = {
    '2026-09': { ...BRUTO_ZERO, receita: 100_000_00, lucroBruto: 30_000_00, kmBet: 1000, litrosBet: 500, custoFrotaLancado: 10_000_00 },
    '2026-10': { ...BRUTO_ZERO, receita: 0, kmBet: 3000, litrosBet: 1000, custoFrotaSemNota: 5_000_00 },
  };
  const r = Object.fromEntries(calcularIndicadores(['2026-09', '2026-10'], brutos, retrato).map((i) => [i.id, i]));
  assert.equal(r.consumo_bet.valor, 4000 / 1500);
  assert.equal(r.consumo_bet.valores!['2026-09'], 2);
  assert.equal(r.margem_bruta.valores!['2026-10'], null);
  assert.equal(r.frota_sobre_receita.valor, 0.15);
  assert.equal(r.disponibilidade.valor, 0.75);
  assert.equal(r.disponibilidade.valores, null);
  assert.equal(r.cobertura_caixa.valor, 30);
  assert.equal(r.inadimplencia.valor, 0.15);
});

test('todo indicador tem fórmula, fonte e forma de cálculo', () => {
  for (const i of INDICADORES) {
    assert.ok(i.formula && i.fonte && i.leitura, i.id);
    assert.ok(i.retrato ? i.agora : i.bruto, i.id);
  }
});
