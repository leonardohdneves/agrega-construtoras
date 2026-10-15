import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { lerPropostaComIa, type ItemCotacaoLeitura } from '../src/lib/ia-cotacao.ts';

const itens: ItemCotacaoLeitura[] = [
  { id: '11111111-1111-4111-8111-111111111111', codigo: 'C-01', descricao: 'Cimento CP II 50kg', unidade: 'sc', quantidade: 100 },
  { id: '22222222-2222-4222-8222-222222222222', codigo: null, descricao: 'Areia média', unidade: 'm³', quantidade: 20 },
  { id: '33333333-3333-4333-8333-333333333333', codigo: null, descricao: 'Brita 1', unidade: 'm³', quantidade: 15 },
];

const original = globalThis.fetch;
const oldKey = process.env.ANTHROPIC_API_KEY;
afterEach(() => {
  globalThis.fetch = original;
  if (oldKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = oldKey;
});

function responder(input: Record<string, unknown>) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'registrar_proposta', input }] }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
}

test('proposta: descarta id fora da cotação, preço inválido e duplicado; avisa item sem preço', async () => {
  process.env.ANTHROPIC_API_KEY = 'chave-teste';
  responder({
    precos: [
      { itemId: itens[0].id, precoUnitario: 32.5 },
      { itemId: itens[0].id, precoUnitario: 99 },
      { itemId: '99999999-9999-4999-8999-999999999999', precoUnitario: 1 },
      { itemId: itens[1].id, precoUnitario: -4 },
      { itemId: itens[1].id, precoUnitario: 80.1 },
    ],
    prazoEntregaDias: 7,
    condicaoPagamento: '  28/42 dias boleto ',
    frete: 0,
    validade: '2026-11-30',
    observacao: null,
    duvidas: ['Unidade da brita ilegível'],
  });
  const r = await lerPropostaComIa(Buffer.from('pdf-falso-para-teste-de-tamanho'), 'application/pdf', itens);
  assert.deepEqual(r.precos, [
    { itemId: itens[0].id, precoUnitario: 32.5 },
    { itemId: itens[1].id, precoUnitario: 80.1 },
  ]);
  assert.equal(r.prazoEntregaDias, 7);
  assert.equal(r.condicaoPagamento, '28/42 dias boleto');
  assert.equal(r.frete, 0);
  assert.equal(r.validade, '2026-11-30');
  assert.equal(r.observacao, null);
  assert.equal(r.duvidas[0], 'Unidade da brita ilegível');
  assert.match(r.duvidas[1], /Sem preço na proposta: Brita 1/);
});

test('proposta: data e prazo inválidos viram vazio, nunca inventados', async () => {
  process.env.ANTHROPIC_API_KEY = 'chave-teste';
  responder({ precos: [], prazoEntregaDias: 1000, validade: '30/11/2026', frete: 'grátis' });
  const r = await lerPropostaComIa(Buffer.from('foto-falsa-para-teste-de-tamanho'), 'image/jpeg', itens);
  assert.equal(r.prazoEntregaDias, null);
  assert.equal(r.validade, null);
  assert.equal(r.frete, null);
  assert.equal(r.precos.length, 0);
});
