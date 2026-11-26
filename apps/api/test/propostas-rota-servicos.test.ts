// Propostas de serviços técnicos pela rota: a forma de pagamento (cronograma, intermediários) tem que chegar ao cálculo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepararAppTeste, semBanco, type ContextoTeste } from './apoio/app-teste.ts';

let ctx: ContextoTeste;
let cliente: string;
before(async () => {
  if (semBanco) return;
  ctx = await prepararAppTeste('teste_propostas_servicos');
  const c = await ctx.pedir('dono', 'POST', '/api/com/clientes', { corpo: { razaoSocial: 'Cliente de teste' } });
  cliente = c.corpo.cliente?.id ?? c.corpo.id;
});
after(async () => {
  if (ctx) await ctx.fechar();
});

const itens = [{ descricao: 'Vistoria', unidade: 'un', quantidade: 1, precoUnitario: 1000 }];

test('serviços técnicos por cronograma: as parcelas do cronograma são gravadas', { skip: semBanco }, async () => {
  const marcos = [{ descricao: 'Mobilização', percentual: 20, dias: 0 }, { descricao: 'Conclusão', percentual: 80, dias: 60 }];
  const r = await ctx.pedir('dono', 'POST', '/api/com/obra-propostas', {
    corpo: { tipo: 'servicos_tecnicos', clienteId: cliente, titulo: 'Teste cronograma', origemPreco: 'informado', parametros: { dataInicio: '2026-11-05', modoPagamento: 'cronograma', marcos }, itens },
  });
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  const p = await ctx.pedir('dono', 'GET', `/api/com/obra-propostas/${r.corpo.id}`);
  assert.deepEqual(p.corpo.proposta.parcelas.map((x: { descricao: string; valor: number }) => [x.descricao, x.valor]), [['Mobilização', 200], ['Conclusão', 800]]);
});

test('serviços técnicos com pagamentos intermediários: a quantidade vai para o cálculo', { skip: semBanco }, async () => {
  const r = await ctx.pedir('dono', 'POST', '/api/com/obra-propostas', {
    corpo: { tipo: 'servicos_tecnicos', clienteId: cliente, titulo: 'Teste intermediários', origemPreco: 'informado', parametros: { dataInicio: '2026-11-05', modoPagamento: 'intermediarios', numeroIntermediarios: 2, entradaPct: 30, prazoEntregaDias: 100 }, itens },
  });
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  const p = await ctx.pedir('dono', 'GET', `/api/com/obra-propostas/${r.corpo.id}`);
  assert.equal(p.corpo.proposta.parcelas.length, 4);
});
