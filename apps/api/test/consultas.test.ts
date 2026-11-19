// P17 e P33: filtros da query string validados (400 em vez de ignorar) e `ate` inclusivo.
// Rode com `npm run test:banco -w apps/api`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepararAppTeste, semBanco, type ContextoTeste } from './apoio/app-teste.ts';

let ctx: ContextoTeste;
let conta = '';
let contaBanco = '';
before(async () => {
  if (semBanco) return;
  ctx = await prepararAppTeste('teste_consultas');
  await ctx.pedir('dono', 'POST', '/api/fin/plano-contas/padrao');
  conta = (await ctx.pedir('dono', 'GET', '/api/fin/plano-contas')).corpo.contas.find((x: { tipo: string; aceitaLancamento: boolean }) => x.tipo === 'despesa' && x.aceitaLancamento).id;
  contaBanco = (await ctx.pedir('dono', 'POST', '/api/fin/contas', { corpo: { nome: 'Banco teste', tipo: 'banco', saldoInicial: 1000 } })).corpo.conta.id;
});
after(async () => {
  if (ctx) await ctx.fechar();
});

const despesa = (competencia: string, extra: Record<string, unknown> = {}) =>
  ctx.pedir('dono', 'POST', '/api/fin/lancamentos', {
    corpo: { tipo: 'despesa', competencia, descricao: `Despesa ${competencia}`, valorTotal: 100, apropriacoes: [{ planoContaId: conta }], parcelas: [{ vencimento: competencia, valor: 100 }], ...extra },
  });

test('P17: filtro inválido responde 400 com o campo, em vez de ser ignorado', { skip: semBanco }, async () => {
  const r = await ctx.pedir('dono', 'GET', '/api/fin/lancamentos?de=ontem');
  assert.equal(r.status, 400);
  assert.equal(r.corpo.campos[0].campo, 'de');
  assert.equal((await ctx.pedir('dono', 'GET', '/api/fin/lancamentos?tipo=qualquer')).status, 400);
  assert.equal((await ctx.pedir('dono', 'GET', '/api/fin/notas?status=errado')).status, 400);
  assert.equal((await ctx.pedir('dono', 'GET', '/api/sup/solicitacoes?status=talvez')).status, 400);
  assert.equal((await ctx.pedir('dono', 'GET', '/api/sup/pedidos?status=todos')).status, 400);
  assert.equal((await ctx.pedir('dono', 'GET', '/api/eng/obras?tipo=outra')).status, 400);
  assert.equal((await ctx.pedir('dono', 'GET', '/api/fin/lancamentos?de=2026-11-30&ate=2026-11-01')).status, 400, 'data final antes da inicial');
  // Parâmetro vazio conta como não informado.
  assert.equal((await ctx.pedir('dono', 'GET', '/api/fin/lancamentos?tipo=')).status, 200);
});

test('P33: `ate` inclusivo nos lançamentos', { skip: semBanco }, async () => {
  assert.equal((await despesa('2026-10-31')).status, 201);
  const r = await ctx.pedir('dono', 'GET', '/api/fin/lancamentos?de=2026-10-01&ate=2026-10-31');
  assert.equal(r.status, 200);
  assert.ok(r.corpo.lancamentos.some((l: { competencia: string }) => l.competencia === '2026-10-31'), 'o último dia entra');
  const nov = await ctx.pedir('dono', 'GET', '/api/fin/lancamentos?de=2026-11-01&ate=2026-11-30');
  assert.ok(!nov.corpo.lancamentos.some((l: { competencia: string }) => l.competencia === '2026-10-31'));
});

test('P33: situações de parcelas que já definem o período recusam de/ate', { skip: semBanco }, async () => {
  assert.equal((await ctx.pedir('dono', 'GET', '/api/fin/parcelas?situacao=semana&de=2026-01-01')).status, 400);
  assert.equal((await ctx.pedir('dono', 'GET', '/api/fin/parcelas?situacao=pagas&de=2026-01-01&ate=2026-12-31')).status, 200);
});

test('P33: baixa na criação do lançamento quita todas as parcelas, como na nota', { skip: semBanco }, async () => {
  const r = await despesa('2026-11-10', {
    valorTotal: 300,
    parcelas: [{ vencimento: '2026-11-10', valor: 100 }, { vencimento: '2026-12-10', valor: 100 }, { vencimento: '2027-01-10', valor: 100 }],
    baixa: { data: '2026-11-10', contaId: contaBanco },
  });
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  const id = r.corpo.lancamento?.id ?? r.corpo.id;
  const parcelas = (await ctx.banco.query('SELECT status FROM parcelas WHERE lancamento_id = $1', [id])).rows.map((p) => p.status);
  assert.deepEqual(parcelas, ['paga', 'paga', 'paga']);
});
