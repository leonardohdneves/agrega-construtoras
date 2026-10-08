import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parcelasDaVenda, textoCondicao } from '../src/rotas/comercial.ts';
import { somarDias } from '../src/lib/financeiro.ts';

test('parcelas da venda: centavos na primeira e vencimentos pelos prazos', () => {
  const p = parcelasDaVenda(1000001, [30, 60, 90], '2026-10-07', somarDias);
  assert.deepEqual(p.map((x) => x.vencimento), ['2026-11-06', '2026-12-06', '2027-01-05']);
  assert.equal(p.reduce((s, x) => s + x.valor, 0), 1000001);
  assert.equal(p[0].valor, 333335);
  assert.deepEqual(parcelasDaVenda(5000, [0], '2026-10-07', somarDias), [{ vencimento: '2026-10-07', valor: 5000 }]);
});

test('texto da condição de pagamento', () => {
  assert.equal(textoCondicao('pix', [0]), 'À vista no PIX');
  assert.equal(textoCondicao('boleto', [30, 60]), '30/60 dias no boleto');
  assert.equal(textoCondicao(null, null), null);
});
