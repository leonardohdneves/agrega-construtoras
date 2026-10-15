import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularProposta, dividir, fechaParcelas } from '../src/lib/propostas-obra.ts';

const ctx = { valorObra: 1_000_000, custoDireto: 800_000 };

test('dividir fecha o total em centavos, com a diferença na última', () => {
  assert.deepEqual(dividir(1000, 3), [333, 333, 334]);
  assert.equal(dividir(10_001, 4).reduce((a, b) => a + b, 0), 10_001);
});

test('acompanhamento com honorário mensal: total = honorário × meses, uma parcela por mês', () => {
  const r = calcularProposta('acompanhamento', 'informado', { dataInicio: '2026-11-05', honorarioMensal: 8000, meses: 6 }, [], null);
  assert.equal(r.valorTotal, 48_000);
  assert.equal(r.parcelas.length, 6);
  assert.equal(r.parcelas[0].vencimento, '2026-11-05');
  assert.equal(r.parcelas[5].vencimento, '2027-04-05');
  assert.ok(fechaParcelas(r.valorTotal, r.parcelas));
});

test('acompanhamento por percentual da obra usa o valor do orçamento', () => {
  const r = calcularProposta('acompanhamento', 'orcamento', { dataInicio: '2026-11-05', modo: 'percentual_obra', percentualObra: 2, meses: 10 }, [], ctx);
  assert.equal(r.valorTotal, 20_000);
  assert.equal(r.parcelas.length, 10);
});

test('administração: taxa sobre o custo direto (orçamento) em parcelas mensais', () => {
  const r = calcularProposta('administracao', 'orcamento', { dataInicio: '2026-11-05', taxaPct: 10, baseAdm: 'custo_direto', meses: 12 }, [], ctx);
  assert.equal(r.valorTotal, 80_000);
  assert.equal(r.parcelas.length, 12);
  assert.ok(fechaParcelas(r.valorTotal, r.parcelas));
});

test('administração informada: exige o valor-base', () => {
  assert.throws(() => calcularProposta('administracao', 'informado', { dataInicio: '2026-11-05', taxaPct: 8, meses: 6 }, [], null), /valor da obra/);
  const r = calcularProposta('administracao', 'informado', { dataInicio: '2026-11-05', taxaPct: 8, meses: 6, valorBaseInformado: 500_000 }, [], null);
  assert.equal(r.valorTotal, 40_000);
});

test('preço global: marcos precisam somar 100% e as parcelas seguem os marcos', () => {
  const marcos = [
    { descricao: 'Fundação', percentual: 30, dias: 30 },
    { descricao: 'Estrutura', percentual: 40, dias: 90 },
    { descricao: 'Acabamento', percentual: 30, dias: 150 },
  ];
  const r = calcularProposta('preco_global', 'orcamento', { dataInicio: '2026-11-05', marcos }, [], ctx);
  assert.equal(r.valorTotal, 1_000_000);
  assert.deepEqual(r.parcelas.map((p) => p.valor), [300_000, 400_000, 300_000]);
  assert.equal(r.parcelas[0].vencimento, '2026-12-05');
  assert.throws(() => calcularProposta('preco_global', 'orcamento', { dataInicio: '2026-11-05', marcos: [{ descricao: 'x', percentual: 90, dias: 10 }] }, [], ctx), /somam 90%/);
});

test('preço unitário: total = soma de quantidade × preço, parcelado', () => {
  const itens = [
    { descricao: 'Escavação', unidade: 'm³', quantidade: 120, precoUnitario: 35.5 },
    { descricao: 'Armação', unidade: 'kg', quantidade: 800, precoUnitario: 9.25 },
  ];
  const r = calcularProposta('preco_unitario', 'informado', { dataInicio: '2026-11-05', numeroParcelas: 4 }, itens, null);
  assert.equal(r.valorTotal, 120 * 35.5 + 800 * 9.25);
  assert.equal(r.parcelas.length, 4);
  assert.ok(fechaParcelas(r.valorTotal, r.parcelas));
  assert.equal(r.itens[0].valor, 4260);
});

test('laudos: entrada na aceitação e saldo na entrega', () => {
  const itens = [{ descricao: 'Laudo de vistoria', unidade: 'un', quantidade: 3, precoUnitario: 2500 }];
  const r = calcularProposta('laudo', 'informado', { dataInicio: '2026-11-05', entradaPct: 30, prazoEntregaDias: 20 }, itens, null);
  assert.equal(r.valorTotal, 7500);
  assert.deepEqual(r.parcelas.map((p) => [p.descricao, p.valor, p.vencimento]), [
    ['Entrada na aceitação', 2250, '2026-11-05'],
    ['Saldo na entrega dos laudos', 5250, '2026-11-25'],
  ]);
});

test('laudo com 100% na aceitação gera uma parcela só, sem prazo', () => {
  const r = calcularProposta('laudo', 'informado', { dataInicio: '2026-11-05', entradaPct: 100 }, [{ descricao: 'Laudo', unidade: 'un', quantidade: 1, precoUnitario: 900 }], null);
  assert.equal(r.parcelas.length, 1);
});

test('orçamento sem obra escolhida é recusado', () => {
  assert.throws(() => calcularProposta('preco_global', 'orcamento', { dataInicio: '2026-11-05', marcos: [{ descricao: 'x', percentual: 100, dias: 1 }] }, [], null), /Escolha a obra/);
});
