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

test('kanban: OS atrasada é a aberta com prazo vencido', async () => {
  const { osAtrasada } = await import('../src/lib/canteiro-kanban.ts');
  assert.equal(osAtrasada({ status: 'liberada', prazo: '2026-11-20' }, '2026-11-21'), true);
  assert.equal(osAtrasada({ status: 'em_execucao', prazo: '2026-11-21' }, '2026-11-21'), false, 'no dia do prazo ainda não atrasou');
  assert.equal(osAtrasada({ status: 'concluida', prazo: '2026-11-01' }, '2026-11-21'), false);
  assert.equal(osAtrasada({ status: 'liberada', prazo: null }, '2026-11-21'), false);
});

test('kanban: OS com equipe, quantidade e prazo; editável só enquanto aberta', { skip: semBanco }, async () => {
  const { base } = await obraComCentral();
  const frente = (await ctx.pedir('dono', 'GET', `${base}/kanban`)).corpo.colunas[0].frentes[0] as { id: string; sugestao: unknown };
  assert.ok(frente.sugestao, 'o card traz a sugestão para a OS');
  const gerar = await ctx.pedir('dono', 'POST', `${base}/frentes/${frente.id}/os`, { corpo: { equipe: 'João e Pedro', quantidade: 120.5, unidade: 'm²', prazo: '2020-01-10' } });
  assert.equal(gerar.status, 201, JSON.stringify(gerar.corpo));
  const os = gerar.corpo.os as { id: string };
  const lerOs = async () =>
    ((await ctx.pedir('dono', 'GET', `${base}/kanban`)).corpo.colunas as { frentes: { id: string; os: Record<string, unknown> | null }[] }[]).flatMap((c) => c.frentes).find((f) => f.id === frente.id)!.os!;
  const lida = await lerOs();
  assert.equal(lida.equipe, 'João e Pedro');
  assert.equal(lida.quantidade, 120.5);
  assert.equal(lida.unidade, 'm²');
  assert.equal(lida.prazo, '2020-01-10');
  assert.equal(lida.atrasada, true, 'prazo no passado com OS aberta');

  assert.equal((await ctx.pedir('dono', 'PATCH', `${base}/os/${os.id}`, { corpo: { prazo: '2099-12-31', quantidade: null } })).status, 200);
  const editada = await lerOs();
  assert.equal(editada.prazo, '2099-12-31');
  assert.equal(editada.quantidade, null);
  assert.equal(editada.atrasada, false);
  assert.equal(editada.equipe, 'João e Pedro', 'o que não foi enviado não muda');
  assert.equal((await ctx.pedir('dono', 'PATCH', `${base}/os/${os.id}`, { corpo: { quantidade: 0 } })).status, 400);

  await ctx.pedir('dono', 'PATCH', `${base}/os/${os.id}`, { corpo: { status: 'em_execucao' } });
  await ctx.pedir('dono', 'PATCH', `${base}/os/${os.id}`, { corpo: { status: 'concluida' } });
  assert.equal((await ctx.pedir('dono', 'PATCH', `${base}/os/${os.id}`, { corpo: { equipe: 'Outra' } })).status, 409, 'OS concluída não muda');
});

test('OS: código sequencial, situação da tarefa e cadeia de predecessoras', async () => {
  const { cadeiaDePredecessoras, codigoOs, predecessorasPendentes, situacaoDaTarefa } = await import('../src/lib/canteiro-kanban.ts');
  assert.equal(codigoOs(1), 'OS-0001');
  assert.equal(codigoOs(123), 'OS-0123');
  assert.equal(situacaoDaTarefa(false, null), 'sem_central');
  assert.equal(situacaoDaTarefa(true, null), 'planejada');
  assert.equal(situacaoDaTarefa(true, { status: 'cancelada' }), 'planejada');
  assert.equal(situacaoDaTarefa(true, { status: 'em_execucao' }), 'em_execucao');

  const ativ = (id: string, numero: number, predecessoraId: string | null) => [id, { id, numero, descricao: `Atividade ${numero}`, eapNoId: null, predecessoraId }] as const;
  const mapa = new Map([ativ('a', 1, null), ativ('b', 2, 'a'), ativ('c', 3, 'b'), ativ('x', 8, 'y'), ativ('y', 9, 'x')]);
  assert.deepEqual(cadeiaDePredecessoras('c', mapa).map((a) => a.numero), [2, 1], 'da mais próxima para a mais distante');
  assert.deepEqual(cadeiaDePredecessoras('a', mapa), []);
  assert.deepEqual(cadeiaDePredecessoras('x', mapa).map((a) => a.numero), [9], 'ciclo não trava');

  const p = (nivel: number, situacao: 'planejada' | 'concluida' | 'sem_central') => ({ atividade: 1, descricao: 'x', eapNoId: null, nivel, situacao, codigoOs: null });
  assert.equal(predecessorasPendentes([p(1, 'planejada'), p(1, 'concluida'), p(1, 'sem_central'), p(2, 'planejada')]).length, 1, 'só as diretas e que tenham OS pendente');
});

test('OS: predecessoras do planejamento, aviso ao iniciar e tela da EAP', { skip: semBanco }, async () => {
  const { obra, base } = await obraComCentral();
  const no = async (codigo: string) => (await ctx.banco.query('SELECT id FROM eap_nos WHERE obra_id = $1 AND codigo = $2', [obra, codigo])).rows[0].id as string;
  const atividade = async (numero: number, codigo: string, predecessora: string | null) =>
    (await ctx.banco.query(
      `INSERT INTO obra_atividades (obra_id, eap_no_id, descricao, inicio, duracao_dias, predecessora_id, numero) VALUES ($1, $2, $3, '2026-12-01', 3, $4, $5) RETURNING id`,
      [obra, await no(codigo), `Serviço ${codigo}`, predecessora, numero],
    )).rows[0].id as string;
  const a1 = await atividade(1, '1.1', null);
  await atividade(2, '1.2', a1);

  const cards = async () => ((await ctx.pedir('dono', 'GET', `${base}/kanban`)).corpo.colunas as { frentes: { id: string; codigo: string; os: { codigo: string; status: string } | null; predecessoras: { atividade: number; situacao: string; codigoOs: string | null; nivel: number }[] }[] }[]).flatMap((c) => c.frentes);
  const card = async (codigo: string) => (await cards()).find((f) => f.codigo === codigo)!;

  const f11 = await card('1.1');
  const f12 = await card('1.2');
  assert.deepEqual((await card('1.3')).predecessoras, [], 'tarefa sem atividade predecessora');
  assert.deepEqual(f12.predecessoras.map((p) => [p.atividade, p.situacao, p.nivel]), [[1, 'planejada', 1]]);

  const os12 = (await ctx.pedir('dono', 'POST', `${base}/frentes/${f12.id}/os`, { corpo: {} })).corpo.os as { id: string; codigo: string };
  assert.equal(os12.codigo, 'OS-0001', 'código sequencial único por obra');

  // Predecessora sem OS concluída: avisa, e só segue com a confirmação.
  const aviso = await ctx.pedir('dono', 'PATCH', `${base}/os/${os12.id}`, { corpo: { status: 'em_execucao' } });
  assert.equal(aviso.status, 409);
  assert.equal(aviso.corpo.codigo, 'predecessoras_pendentes');
  assert.match(aviso.corpo.erro, /OS-0001/);
  assert.equal(aviso.corpo.predecessoras.length, 1);
  assert.equal((await ctx.pedir('dono', 'PATCH', `${base}/os/${os12.id}`, { corpo: { status: 'em_execucao', confirmarPredecessoras: true } })).status, 200);

  // Com a predecessora concluída, não há aviso para a próxima OS da mesma tarefa.
  const os11 = (await ctx.pedir('dono', 'POST', `${base}/frentes/${f11.id}/os`, { corpo: {} })).corpo.os as { id: string; codigo: string };
  assert.equal(os11.codigo, 'OS-0002');
  await ctx.pedir('dono', 'PATCH', `${base}/os/${os11.id}`, { corpo: { status: 'em_execucao' } });
  await ctx.pedir('dono', 'PATCH', `${base}/os/${os11.id}`, { corpo: { status: 'concluida' } });
  const f12Depois = await card('1.2');
  assert.deepEqual(f12Depois.predecessoras.map((p) => [p.situacao, p.codigoOs]), [['concluida', 'OS-0002']]);

  // Tela "OS na EAP": a árvore com as frentes, as OS (com código) e o resumo.
  const eap = await ctx.pedir('mestre_obra', 'GET', `/api/eng/obras/${obra}/canteiro/os-eap`);
  assert.equal(eap.status, 404, 'mestre de obra não atribuído à obra nem a enxerga');
  const r = await ctx.pedir('dono', 'GET', `/api/eng/obras/${obra}/canteiro/os-eap`);
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  const nos = r.corpo.nos as { codigo: string; frente: { os: { codigo: string; status: string }[]; prioridade: string } | null }[];
  assert.deepEqual(nos.map((n) => n.codigo), ['1.1', '1.2', '1.3']);
  assert.deepEqual(nos.find((n) => n.codigo === '1.2')!.frente!.os.map((o) => [o.codigo, o.status]), [['OS-0001', 'em_execucao']]);
  assert.deepEqual(nos.find((n) => n.codigo === '1.3')!.frente!.os, [], 'frente sem OS aparece como planejada');
  assert.equal(r.corpo.resumo.concluidas, 1);
  assert.equal(r.corpo.resumo.emExecucao, 1);
  assert.equal(r.corpo.resumo.planejadas, 1);
});
