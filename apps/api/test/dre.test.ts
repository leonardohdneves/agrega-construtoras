import { test } from 'node:test';
import assert from 'node:assert/strict';
import { impostosEstimados, mesesEntre, montarDre, type CategoriaDre } from '../src/lib/dre.ts';

const cats: CategoriaDre[] = [
  { id: 'v', codigo: '1.1', nome: 'Venda de concreto', tipo: 'receita', linha: 'receita_bruta' },
  { id: 'i', codigo: '2.1', nome: 'Impostos', tipo: 'despesa', linha: 'deducoes' },
  { id: 'c', codigo: '3.1', nome: 'Cimento', tipo: 'despesa', linha: 'custo_producao' },
  { id: 'd', codigo: '4.1', nome: 'Diesel', tipo: 'despesa', linha: 'custo_frota' },
  { id: 'a', codigo: '6.1', nome: 'Aluguel', tipo: 'despesa', linha: 'despesas_administrativas' },
  { id: 'j', codigo: '8.3', nome: 'Juros', tipo: 'despesa', linha: 'despesas_financeiras' },
  { id: 'k', codigo: '11.1', nome: 'Compra de caminhão', tipo: 'despesa', linha: 'fora_dre' },
];
const meses = ['2026-09', '2026-10'];
const valores = [
  { mes: '2026-09', categoriaId: 'v', centavos: 100_000_00 },
  { mes: '2026-09', categoriaId: 'i', centavos: 6_000_00 },
  { mes: '2026-09', categoriaId: 'c', centavos: 40_000_00 },
  { mes: '2026-09', categoriaId: 'd', centavos: 15_000_00 },
  { mes: '2026-10', categoriaId: 'a', centavos: 4_000_00 },
  { mes: '2026-10', categoriaId: 'j', centavos: 1_000_00 },
  { mes: '2026-10', categoriaId: 'k', centavos: 300_000_00 },
  { mes: '2027-01', categoriaId: 'v', centavos: 1 },
];
const linha = (r: ReturnType<typeof montarDre>, chave: string) => r.linhas.find((l) => l.chave === chave)!;

test('DRE soma por linha, subtotais e deixa investimento fora', () => {
  const r = montarDre(meses, cats, valores, { impostos: 'lancados', regime: 'simples', aliquotas: {} });
  assert.equal(linha(r, 'receita_bruta').total, 100_000_00);
  assert.equal(linha(r, 'receita_liquida').valores['2026-09'], 94_000_00);
  assert.equal(linha(r, 'lucro_bruto').valores['2026-09'], 39_000_00);
  assert.equal(linha(r, 'resultado_operacional').valores['2026-10'], -4_000_00);
  assert.equal(linha(r, 'resultado_liquido').total, 34_000_00);
  assert.equal(r.fora.total, -300_000_00);
  assert.equal(linha(r, 'custo_frota').categorias[0].nome, 'Diesel');
});

test('impostos estimados pelo regime substituem os lançados', () => {
  const r = montarDre(meses, cats, valores, { impostos: 'estimados', regime: 'simples', aliquotas: { simples: 8.5 } });
  assert.equal(linha(r, 'deducoes').valores['2026-09'], -8_500_00);
  assert.equal(linha(r, 'deducoes').categorias.length, 0);
  assert.equal(linha(r, 'receita_liquida').valores['2026-09'], 91_500_00);
});

test('presumido e real calculam IR e CSLL de formas diferentes', () => {
  const pres = impostosEstimados('presumido', { pis: 0.65, cofins: 3, icms: 12, irpj: 1.2, csll: 1.08 }, 100_000_00, 30_000_00);
  assert.equal(pres.deducoes, -15_650_00);
  assert.equal(pres.lucro, -2_280_00);
  const real = impostosEstimados('real', { pis: 1.65, cofins: 7.6, irpj: 15, csll: 9 }, 100_000_00, 30_000_00);
  assert.equal(real.deducoes, -9_250_00);
  assert.equal(real.lucro, -Math.round((30_000_00 - 9_250_00) * 0.24));
  assert.equal(impostosEstimados('real', { irpj: 15 }, 1000, -5000).lucro, 0);
});

test('mesesEntre atravessa o ano', () => {
  assert.deepEqual(mesesEntre('2026-11', '2027-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
});
