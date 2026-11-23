// Kanban das centrais do canteiro: regras puras (coluna do card e transições da OS) e as rotas com banco
// (frentes criadas a partir dos serviços da central, prioridade, ordem e OS). Rode com `npm run test:banco -w apps/api`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { colunaDoCard, transicaoPermitida } from '../src/lib/canteiro-kanban.ts';
import { prepararAppTeste, semBanco, type ContextoTeste } from './apoio/app-teste.ts';

test('kanban: a coluna do card segue o status da OS', () => {
  assert.equal(colunaDoCard(null), 'planejada');
  assert.equal(colunaDoCard({ status: 'liberada' }), 'liberada');
  assert.equal(colunaDoCard({ status: 'em_execucao' }), 'em_execucao');
  assert.equal(colunaDoCard({ status: 'concluida' }), 'concluida');
  assert.equal(colunaDoCard({ status: 'cancelada' }), 'planejada', 'OS cancelada devolve a frente ao planejamento');
});

test('kanban: a OS só avança, e concluída ou cancelada não voltam', () => {
  assert.ok(transicaoPermitida('liberada', 'em_execucao'));
  assert.ok(transicaoPermitida('em_execucao', 'concluida'));
  assert.ok(transicaoPermitida('liberada', 'cancelada'));
  assert.ok(!transicaoPermitida('liberada', 'concluida'), 'não pula a execução');
  assert.ok(!transicaoPermitida('concluida', 'em_execucao'));
  assert.ok(!transicaoPermitida('cancelada', 'liberada'));
});

let ctx: ContextoTeste;
before(async () => {
  if (semBanco) return;
  ctx = await prepararAppTeste('teste_canteiro_kanban');
});
after(async () => {
  if (ctx) await ctx.fechar();
});

/** Obra com três tarefas na EAP, ligadas à central de argamassa. */
async function obraComCentral() {
  const obra = (await ctx.pedir('dono', 'POST', '/api/eng/obras', { corpo: { nome: 'Obra do kanban' } })).corpo.obra.id as string;
  assert.equal((await ctx.pedir('dono', 'GET', `/api/eng/obras/${obra}/canteiro`)).status, 200);
  const tarefa = async (codigo: string, descricao: string) =>
    (await ctx.banco.query(`INSERT INTO eap_nos (obra_id, nivel, codigo, descricao) VALUES ($1, 'tarefa', $2, $3) RETURNING id`, [obra, codigo, descricao])).rows[0].id as string;
  const servicos = [await tarefa('1.1', 'Reboco interno'), await tarefa('1.2', 'Contrapiso'), await tarefa('1.3', 'Chapisco')];
  const central = await ctx.pedir('dono', 'PUT', `/api/eng/obras/${obra}/canteiro/centrais/argamassa`, { corpo: { periodicidadeDias: 7, servicos } });
  assert.equal(central.status, 200, JSON.stringify(central.corpo));
  return { obra, base: `/api/eng/obras/${obra}/canteiro/centrais/argamassa` };
}

test('kanban: os serviços da central viram cards na coluna Planejada, na ordem da EAP', { skip: semBanco }, async () => {
  const { base } = await obraComCentral();
  const r = await ctx.pedir('dono', 'GET', `${base}/kanban`);
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(r.corpo.total, 3);
  const planejada = r.corpo.colunas.find((c: { id: string }) => c.id === 'planejada');
  assert.deepEqual(planejada.frentes.map((f: { codigo: string }) => f.codigo), ['1.1', '1.2', '1.3']);
  assert.ok(planejada.frentes.every((f: { prioridade: string }) => f.prioridade === 'media'));
  // Ler de novo não duplica cards.
  assert.equal((await ctx.pedir('dono', 'GET', `${base}/kanban`)).corpo.total, 3);
});

test('kanban: prioridade e ordem mudam pelo engenheiro ou gestor', { skip: semBanco }, async () => {
  const { base } = await obraComCentral();
  const frentes = (await ctx.pedir('dono', 'GET', `${base}/kanban`)).corpo.colunas[0].frentes as { id: string; codigo: string }[];
  const [a, b, c] = frentes;
  assert.equal((await ctx.pedir('gestor', 'PATCH', `${base}/frentes/${c.id}`, { corpo: { prioridade: 'alta' } })).status, 200);
  assert.equal((await ctx.pedir('gestor', 'PATCH', `${base}/frentes/${c.id}`, { corpo: { prioridade: 'urgente' } })).status, 400);
  assert.equal((await ctx.pedir('gestor', 'PUT', `${base}/kanban/ordem`, { corpo: { frentes: [c.id, a.id, b.id] } })).status, 200);
  const depois = (await ctx.pedir('dono', 'GET', `${base}/kanban`)).corpo.colunas[0].frentes as { codigo: string; prioridade: string }[];
  assert.deepEqual(depois.map((f) => f.codigo), ['1.3', '1.1', '1.2']);
  assert.equal(depois[0].prioridade, 'alta');
  assert.equal((await ctx.pedir('mestre_obra', 'PATCH', `${base}/frentes/${a.id}`, { corpo: { prioridade: 'baixa' } })).status, 403, 'mestre só consulta');
});

test('kanban: a OS leva o card pelas colunas, e só existe uma OS aberta por frente', { skip: semBanco }, async () => {
  const { base } = await obraComCentral();
  const frente = (await ctx.pedir('dono', 'GET', `${base}/kanban`)).corpo.colunas[0].frentes[0] as { id: string };
  const gerar = await ctx.pedir('dono', 'POST', `${base}/frentes/${frente.id}/os`);
  assert.equal(gerar.status, 201, JSON.stringify(gerar.corpo));
  const os = gerar.corpo.os as { id: string; numero: number };
  assert.equal(os.numero, 1);
  assert.equal((await ctx.pedir('dono', 'POST', `${base}/frentes/${frente.id}/os`)).status, 409, 'já tem OS aberta');

  const coluna = async () => {
    const cols = (await ctx.pedir('dono', 'GET', `${base}/kanban`)).corpo.colunas as { id: string; frentes: { id: string }[] }[];
    return cols.find((c) => c.frentes.some((f) => f.id === frente.id))!.id;
  };
  assert.equal(await coluna(), 'liberada');
  assert.equal((await ctx.pedir('dono', 'PATCH', `${base}/os/${os.id}`, { corpo: { status: 'concluida' } })).status, 409, 'não pula a execução');
  assert.equal((await ctx.pedir('dono', 'PATCH', `${base}/os/${os.id}`, { corpo: { status: 'em_execucao' } })).status, 200);
  assert.equal(await coluna(), 'em_execucao');
  assert.equal((await ctx.pedir('dono', 'PATCH', `${base}/os/${os.id}`, { corpo: { status: 'concluida' } })).status, 200);
  assert.equal(await coluna(), 'concluida');
  // Com a OS concluída, a frente pode ter outra OS (nova etapa da mesma frente).
  const segunda = await ctx.pedir('dono', 'POST', `${base}/frentes/${frente.id}/os`);
  assert.equal(segunda.corpo.os.numero, 2);
});

test('kanban: central inexistente dá 404 e sem o recurso de centrais o kanban some', { skip: semBanco }, async () => {
  const { obra, base } = await obraComCentral();
  assert.equal((await ctx.pedir('dono', 'GET', `/api/eng/obras/${obra}/canteiro/centrais/nao-existe/kanban`)).status, 404);
  await ctx.pedir('admin_sistema', 'PUT', `/api/admin/empresas/${ctx.empresas.a}/contrato`, { corpo: { pacote: 'completo', recursos: ['canteiro_horizontal'], limiteObras: 10, limiteUsuarios: 8 } });
  assert.equal((await ctx.pedir('dono', 'GET', `${base}/kanban`)).status, 403);
  await ctx.pedir('admin_sistema', 'PUT', `/api/admin/empresas/${ctx.empresas.a}/contrato`, { corpo: { pacote: 'completo', recursos: ['canteiro_horizontal', 'centrais'], limiteObras: 10, limiteUsuarios: 8 } });
});
