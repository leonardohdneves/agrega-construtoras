// Planilha (EAP e orçamento): mover linhas para outro pai, copiar linhas marcadas e excluir em lote.
// As funções puras são testadas aqui; o fluxo pela rota (com banco) fica no fim, e pula sem TEST_DATABASE_URL.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { planejarColagem, reposicionarLinha, subarvore } from '../src/lib/engenharia.ts';
import { prepararAppTeste, semBanco, type ContextoTeste } from './apoio/app-teste.ts';

const ARVORE = [
  { id: 'obra', paiId: null, codigo: '1', nivel: 'obra' as const },
  { id: 'e1', paiId: 'obra', codigo: '1.1', nivel: 'etapa' as const },
  { id: 's1', paiId: 'e1', codigo: '1.1.1', nivel: 'subetapa' as const },
  { id: 't1', paiId: 's1', codigo: '1.1.1.1', nivel: 'tarefa' as const },
  { id: 'e2', paiId: 'obra', codigo: '1.2', nivel: 'etapa' as const },
];

test('planilha: subárvore é a linha e tudo abaixo dela', () => {
  assert.deepEqual([...subarvore(ARVORE, ['e1'])].sort(), ['e1', 's1', 't1']);
  assert.deepEqual([...subarvore(ARVORE, ['t1'])], ['t1']);
});

test('planilha: mover uma linha para outro pai leva o que está abaixo dela e renumera', () => {
  // Sub Etapa "s1" passa de dentro de "e1" para dentro de "e2": a tarefa "t1" vai junto.
  const m = reposicionarLinha(ARVORE, 's1', 'e2');
  assert.deepEqual(Object.fromEntries(m), { obra: '1', e1: '1.1', e2: '1.2', s1: '1.2.1', t1: '1.2.1.1' });
  // Para a raiz: a linha vira irmã das etapas.
  const r = reposicionarLinha(ARVORE, 'e1', null);
  assert.equal(r.get('obra'), '1');
  assert.equal(r.get('e1'), '2');
  assert.equal(r.get('s1'), '2.1');
});

test('planilha: colar acima de uma linha põe a cópia entre as irmãs, com o que está abaixo', () => {
  let n = 0;
  const { copias, codigos } = planejarColagem(ARVORE, ['e1'], 'e2', () => `c${++n}`);
  assert.deepEqual(
    copias.map((c) => [c.id, c.origemId, c.paiId, c.nivel]),
    [
      ['c1', 'e1', 'obra', 'etapa'],
      ['c2', 's1', 'c1', 'subetapa'],
      ['c3', 't1', 'c2', 'tarefa'],
    ],
  );
  assert.deepEqual(Object.fromEntries(codigos), { obra: '1', e1: '1.1', s1: '1.1.1', t1: '1.1.1.1', c1: '1.2', c2: '1.2.1', c3: '1.2.1.1', e2: '1.3' });
});

test('planilha: linha marcada dentro de outra marcada não é copiada duas vezes', () => {
  let n = 0;
  const { copias } = planejarColagem(ARVORE, ['e1', 's1', 't1'], 'e2', () => `c${++n}`);
  assert.equal(copias.length, 3, 'só a cópia da etapa e do que está abaixo dela');
});

test('planilha: colar uma tarefa acima de outra, dentro de uma etapa, fica no mesmo pai da de destino', () => {
  let n = 0;
  const { copias, paiId, codigos } = planejarColagem(ARVORE, ['t1'], 's1', () => `c${++n}`);
  assert.equal(paiId, 'e1', 'o pai da cópia é o pai de s1');
  assert.equal(copias[0].paiId, 'e1');
  assert.deepEqual(Object.fromEntries(codigos), { obra: '1', e1: '1.1', c1: '1.1.1', s1: '1.1.2', t1: '1.1.2.1', e2: '1.2' });
});

test('planilha: colar duas tarefas irmãs mantém a ordem delas', () => {
  const nos = [
    { id: 'obra', paiId: null, codigo: '1', nivel: 'obra' as const },
    { id: 'a', paiId: 'obra', codigo: '1.1', nivel: 'tarefa' as const },
    { id: 'b', paiId: 'obra', codigo: '1.2', nivel: 'tarefa' as const },
  ];
  let n = 0;
  const { codigos } = planejarColagem(nos, ['a'], 'b', () => `c${++n}`);
  assert.deepEqual(Object.fromEntries(codigos), { obra: '1', a: '1.1', c1: '1.2', b: '1.3' });
});

// ----- Rota com banco: troca de nível e de pai, cópia e exclusão em lote.
let ctx: ContextoTeste;
before(async () => {
  if (semBanco) return;
  ctx = await prepararAppTeste('teste_planilha_eap');
});
after(async () => {
  if (ctx) await ctx.fechar();
});

async function linhasDaObra(obra: string): Promise<{ id: string; descricao: string; codigo: string; nivel: string; paiId: string | null }[]> {
  return (await ctx.pedir('dono', 'GET', `/api/eng/obras/${obra}/planilha`)).corpo.linhas;
}

test('rota: subetapa vira etapa quando se escolhe a raiz como pai (o Salvar da edição funciona)', { skip: semBanco }, async () => {
  const obra = (await ctx.pedir('dono', 'POST', '/api/eng/obras', { corpo: { nome: 'Obra da planilha' } })).corpo.obra.id as string;
  const e1 = (await ctx.pedir('dono', 'POST', `/api/eng/obras/${obra}/planilha`, { corpo: { nivel: 'etapa', paiId: null, descricao: 'Etapa A' } })).corpo.id as string;
  const s1 = (await ctx.pedir('dono', 'POST', `/api/eng/obras/${obra}/planilha`, { corpo: { nivel: 'subetapa', paiId: e1, descricao: 'Sub 1' } })).corpo.id as string;
  // Sem escolher outro pai, o servidor recusa (o pai atual é uma Etapa); a tela manda o pai novo.
  const recusa = await ctx.pedir('dono', 'PUT', `/api/eng/obras/${obra}/planilha/${s1}`, { corpo: { nivel: 'etapa' } });
  assert.equal(recusa.status, 400);
  const ok = await ctx.pedir('dono', 'PUT', `/api/eng/obras/${obra}/planilha/${s1}`, { corpo: { nivel: 'etapa', paiId: null } });
  assert.equal(ok.status, 200, JSON.stringify(ok.corpo));
  const linhas = await linhasDaObra(obra);
  assert.equal(linhas.find((l) => l.id === s1)!.nivel, 'etapa');
  assert.equal(linhas.find((l) => l.id === s1)!.paiId, null);
});

test('rota: tarefa muda de subetapa; não se põe uma linha dentro dela mesma', { skip: semBanco }, async () => {
  const obra = (await ctx.pedir('dono', 'POST', '/api/eng/obras', { corpo: { nome: 'Obra de mover' } })).corpo.obra.id as string;
  const e1 = (await ctx.pedir('dono', 'POST', `/api/eng/obras/${obra}/planilha`, { corpo: { nivel: 'etapa', paiId: null, descricao: 'Etapa B' } })).corpo.id as string;
  const e2 = (await ctx.pedir('dono', 'POST', `/api/eng/obras/${obra}/planilha`, { corpo: { nivel: 'etapa', paiId: null, descricao: 'Etapa C' } })).corpo.id as string;
  const s1 = (await ctx.pedir('dono', 'POST', `/api/eng/obras/${obra}/planilha`, { corpo: { nivel: 'subetapa', paiId: e1, descricao: 'Sub B1' } })).corpo.id as string;
  const t1 = (await ctx.pedir('dono', 'POST', `/api/eng/obras/${obra}/planilha`, { corpo: { nivel: 'tarefa', paiId: s1, descricao: 'Tarefa B1a' } })).corpo.id as string;
  // Subetapa para outra etapa, com a tarefa dentro dela.
  assert.equal((await ctx.pedir('dono', 'PUT', `/api/eng/obras/${obra}/planilha/${s1}`, { corpo: { paiId: e2 } })).status, 200);
  let linhas = await linhasDaObra(obra);
  assert.equal(linhas.find((l) => l.id === t1)!.codigo.startsWith(linhas.find((l) => l.id === e2)!.codigo + '.'), true);
  // Tarefa para dentro dela mesma: recusado.
  const dentro = await ctx.pedir('dono', 'PUT', `/api/eng/obras/${obra}/planilha/${e2}`, { corpo: { paiId: t1 } });
  assert.equal(dentro.status, 400);
});

test('rota: colar acima de uma linha e excluir em lote', { skip: semBanco }, async () => {
  const obra = (await ctx.pedir('dono', 'POST', '/api/eng/obras', { corpo: { nome: 'Obra de lote' } })).corpo.obra.id as string;
  const e1 = (await ctx.pedir('dono', 'POST', `/api/eng/obras/${obra}/planilha`, { corpo: { nivel: 'etapa', paiId: null, descricao: 'Etapa D' } })).corpo.id as string;
  await ctx.pedir('dono', 'POST', `/api/eng/obras/${obra}/planilha`, { corpo: { nivel: 'subetapa', paiId: e1, descricao: 'Sub D1' } });
  const antes = (await linhasDaObra(obra)).length;
  const copia = await ctx.pedir('dono', 'POST', `/api/eng/obras/${obra}/planilha/colar`, { corpo: { ids: [e1], antesDeId: e1 } });
  assert.equal(copia.status, 200, JSON.stringify(copia.corpo));
  assert.equal(copia.corpo.coladas, 2);
  const depois = await linhasDaObra(obra);
  assert.equal(depois.length, antes + 2);
  const novaEtapa = depois.find((l) => l.descricao === 'Etapa D' && l.id !== e1)!;
  assert.notEqual(novaEtapa.codigo, depois.find((l) => l.id === e1)!.codigo, 'a cópia tem código próprio');
  const apaga = await ctx.pedir('dono', 'POST', `/api/eng/obras/${obra}/planilha/excluir-lote`, { corpo: { ids: [novaEtapa.id] } });
  assert.equal(apaga.status, 200, JSON.stringify(apaga.corpo));
  assert.equal(apaga.corpo.excluidas, 2, 'a cópia e a subetapa dela');
  assert.equal((await linhasDaObra(obra)).length, antes);
});

test('rota: não se cola etapa dentro de sub etapa ou tarefa', { skip: semBanco }, async () => {
  const obra = (await ctx.pedir('dono', 'POST', '/api/eng/obras', { corpo: { nome: 'Obra de colar' } })).corpo.obra.id as string;
  const e = (await ctx.pedir('dono', 'POST', `/api/eng/obras/${obra}/planilha`, { corpo: { nivel: 'etapa', paiId: null, descricao: 'Etapa E' } })).corpo.id as string;
  const sub = (await ctx.pedir('dono', 'POST', `/api/eng/obras/${obra}/planilha`, { corpo: { nivel: 'subetapa', paiId: e, descricao: 'Sub E' } })).corpo.id as string;
  const t = (await ctx.pedir('dono', 'POST', `/api/eng/obras/${obra}/planilha`, { corpo: { nivel: 'tarefa', paiId: sub, descricao: 'Tarefa E' } })).corpo.id as string;
  const r = await ctx.pedir('dono', 'POST', `/api/eng/obras/${obra}/planilha/colar`, { corpo: { ids: [e], antesDeId: t } });
  assert.equal(r.status, 400, JSON.stringify(r.corpo));
});
