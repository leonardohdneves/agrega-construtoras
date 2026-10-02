import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codigoPai, gerarParcelas, PLANO_CONTAS_PADRAO, proximaRecorrencia, situacaoParcela, somarMeses, valorPago } from '../src/lib/financeiro.ts';

test('somarMeses mantém o dia e ajusta fim de mês', () => {
  assert.equal(somarMeses('2026-01-31', 1), '2026-02-28');
  assert.equal(somarMeses('2026-01-15', 12), '2027-01-15');
  assert.equal(somarMeses('2026-11-30', 3), '2027-02-28');
  assert.equal(somarMeses('2028-01-31', 1), '2028-02-29');
});

test('gerarParcelas divide sem perder centavos', () => {
  const p = gerarParcelas(100000, 3, '2026-10-10');
  assert.deepEqual(p.map((x) => x.valorCentavos), [33334, 33333, 33333]);
  assert.equal(p.reduce((s, x) => s + x.valorCentavos, 0), 100000);
  assert.deepEqual(p.map((x) => x.vencimento), ['2026-10-10', '2026-11-10', '2026-12-10']);
  const d = gerarParcelas(9000, 3, '2026-10-01', 'dias', 28);
  assert.deepEqual(d.map((x) => x.vencimento), ['2026-10-01', '2026-10-29', '2026-11-26']);
  assert.equal(gerarParcelas(500, 1, '2026-10-01')[0].valorCentavos, 500);
});

test('recorrência, baixa e situação da parcela', () => {
  assert.equal(proximaRecorrencia('2026-10-05', 'mensal', 2), '2026-12-05');
  assert.equal(proximaRecorrencia('2026-10-05', 'semanal', 1), '2026-10-12');
  assert.equal(proximaRecorrencia('2026-10-05', 'anual', 1), '2027-10-05');
  assert.equal(valorPago(10000, 250, 100), 10150);
  assert.equal(situacaoParcela('aberta', '2026-10-01', '2026-10-02'), 'vencida');
  assert.equal(situacaoParcela('aberta', '2026-10-02', '2026-10-02'), 'vence_hoje');
  assert.equal(situacaoParcela('paga', '2026-09-01', '2026-10-02'), 'paga');
});

test('plano de contas padrão é consistente', () => {
  const codigos = new Set(PLANO_CONTAS_PADRAO.map((c) => c.codigo));
  assert.equal(codigos.size, PLANO_CONTAS_PADRAO.length);
  for (const c of PLANO_CONTAS_PADRAO) {
    const pai = codigoPai(c.codigo);
    if (pai) assert.ok(codigos.has(pai), `pai de ${c.codigo}`);
    else assert.ok(c.grupo, `${c.codigo} raiz deve ser grupo`);
  }
});
