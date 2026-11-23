// Canteiro vertical e recursos do contrato, com banco: o contrato libera as rotas, a obra escolhe o tipo, e a agenda,
// o ciclo de laje e o concreto por andar funcionam. Rode com `npm run test:banco -w apps/api`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepararAppTeste, semBanco, type ContextoTeste } from './apoio/app-teste.ts';

let ctx: ContextoTeste;
before(async () => {
  if (semBanco) return;
  ctx = await prepararAppTeste('teste_canteiro_vertical');
});
after(async () => {
  if (ctx) await ctx.fechar();
});

/** Define os recursos do contrato da empresa A (o administrador do sistema faz isso). */
const contratar = (recursos: string[]) =>
  ctx.pedir('admin_sistema', 'PUT', `/api/admin/empresas/${ctx.empresas.a}/contrato`, {
    corpo: { pacote: 'completo', recursos, limiteObras: 10, limiteUsuarios: 8 },
  });
const novaObra = async (tipoCanteiro: 'horizontal' | 'vertical', nome: string) =>
  (await ctx.pedir('dono', 'POST', '/api/eng/obras', { corpo: { nome, tipoCanteiro } })).corpo.obra.id as string;
const base = (obra: string) => `/api/eng/obras/${obra}/canteiro`;

test('contrato: sem o recurso, as rotas do canteiro respondem 403 e com o recurso liberam', { skip: semBanco }, async () => {
  const obra = await novaObra('horizontal', 'Casa 1');
  assert.equal((await contratar([])).status, 200);
  assert.equal((await ctx.pedir('dono', 'GET', base(obra))).status, 403);

  assert.equal((await contratar(['canteiro_horizontal'])).status, 200);
  assert.equal((await ctx.pedir('dono', 'GET', base(obra))).status, 200);
  assert.equal((await ctx.pedir('dono', 'GET', `${base(obra)}/centrais/argamassa`)).status, 403, 'centrais precisam do add-on');

  const emp = await ctx.pedir('admin_sistema', 'GET', `/api/admin/empresas/${ctx.empresas.a}/dados`);
  assert.deepEqual(emp.corpo.empresa.contrato.recursos, ['canteiro_horizontal']);
});

test('contrato: o canteiro vertical libera a base e as centrais', { skip: semBanco }, async () => {
  const obra = await novaObra('vertical', 'Torre 1');
  await contratar(['canteiro_vertical']);
  assert.equal((await ctx.pedir('dono', 'GET', base(obra))).status, 200);
  assert.equal((await ctx.pedir('dono', 'GET', `${base(obra)}/centrais/argamassa`)).status, 200);
  assert.equal((await ctx.pedir('dono', 'GET', `${base(obra)}/vertical/pavimentos`)).status, 200);
});

test('obra horizontal não usa as rotas verticais, mesmo com o recurso', { skip: semBanco }, async () => {
  await contratar(['canteiro_vertical']);
  const horizontal = await novaObra('horizontal', 'Casa 2');
  const r = await ctx.pedir('dono', 'GET', `${base(horizontal)}/vertical/pavimentos`);
  assert.equal(r.status, 409);
  assert.match(r.corpo.erro, /horizontal/);

  // Mudar o tipo na alteração da obra libera as rotas verticais.
  const alterada = await ctx.pedir('dono', 'PUT', `/api/eng/obras/${horizontal}`, { corpo: { tipoCanteiro: 'vertical' } });
  assert.equal(alterada.corpo.obra.tipoCanteiro, 'vertical');
  assert.equal((await ctx.pedir('dono', 'GET', `${base(horizontal)}/vertical/pavimentos`)).status, 200);
});

test('pavimentos: nome único e ordem automática', { skip: semBanco }, async () => {
  await contratar(['canteiro_vertical']);
  const obra = await novaObra('vertical', 'Torre 2');
  const url = `${base(obra)}/vertical/pavimentos`;
  assert.equal((await ctx.pedir('dono', 'POST', url, { corpo: { nome: 'Térreo' } })).status, 201);
  assert.equal((await ctx.pedir('dono', 'POST', url, { corpo: { nome: '1º pavimento' } })).status, 201);
  assert.equal((await ctx.pedir('dono', 'POST', url, { corpo: { nome: 'Térreo' } })).status, 409);
  const lista = (await ctx.pedir('dono', 'GET', url)).corpo.pavimentos as { nome: string; ordem: number }[];
  assert.deepEqual(
    lista.map((p) => [p.nome, p.ordem]),
    [
      ['Térreo', 0],
      ['1º pavimento', 1],
    ],
  );
});

test('ciclo de laje: dias do ciclo, validação e média da obra', { skip: semBanco }, async () => {
  await contratar(['canteiro_vertical']);
  const obra = await novaObra('vertical', 'Torre 3');
  const pav = (await ctx.pedir('dono', 'POST', `${base(obra)}/vertical/pavimentos`, { corpo: { nome: 'Laje 1' } })).corpo.id as string;
  const ciclo = `${base(obra)}/vertical/pavimentos/${pav}/ciclo`;

  const invertido = await ctx.pedir('dono', 'PUT', ciclo, { corpo: { etapas: [{ etapa: 'formas', inicio: '2026-11-05', fim: '2026-11-02' }] } });
  assert.equal(invertido.status, 400);

  const gravado = await ctx.pedir('dono', 'PUT', ciclo, {
    corpo: {
      etapas: [
        { etapa: 'formas', inicio: '2026-11-02', fim: '2026-11-04' },
        { etapa: 'armacao', inicio: '2026-11-05', fim: '2026-11-06' },
        { etapa: 'concretagem', inicio: '2026-11-07', fim: '2026-11-07' },
        { etapa: 'cura', inicio: '2026-11-07', fim: '2026-11-09' },
        { etapa: 'desforma', inicio: '2026-11-10', fim: '2026-11-10' },
      ],
    },
  });
  assert.equal(gravado.status, 200);
  const lista = (await ctx.pedir('dono', 'GET', `${base(obra)}/vertical/pavimentos`)).corpo;
  assert.equal(lista.pavimentos[0].ciclo.diasCiclo, 9, 'de 2 a 10 de novembro');
  assert.equal(lista.mediaDiasCiclo, 9);
});

test('agenda: guincho não se sobrepõe, grua é independente, e a exclusão libera o horário', { skip: semBanco }, async () => {
  await contratar(['canteiro_vertical']);
  const obra = await novaObra('vertical', 'Torre 4');
  const pav = (await ctx.pedir('dono', 'POST', `${base(obra)}/vertical/pavimentos`, { corpo: { nome: 'Laje 2' } })).corpo.id as string;
  const agenda = `${base(obra)}/vertical/agenda`;
  const reserva = (equipamento: string, inicio: string, fim: string) => ({ pavimentoId: pav, equipamento, data: '2026-11-24', inicio, fim });

  const primeira = await ctx.pedir('dono', 'POST', agenda, { corpo: reserva('guincho', '07:00', '11:00') });
  assert.equal(primeira.status, 201);
  const conflito = await ctx.pedir('dono', 'POST', agenda, { corpo: reserva('guincho', '10:00', '12:00') });
  assert.equal(conflito.status, 409);
  assert.match(conflito.corpo.erro, /07:00 a 11:00/);
  assert.equal((await ctx.pedir('dono', 'POST', agenda, { corpo: reserva('guincho', '11:00', '12:00') })).status, 201);
  assert.equal((await ctx.pedir('dono', 'POST', agenda, { corpo: reserva('grua', '07:00', '11:00') })).status, 201);
  assert.equal((await ctx.pedir('dono', 'POST', agenda, { corpo: reserva('grua', '09:00', '08:00') })).status, 400, 'fim antes do início');

  const periodo = (await ctx.pedir('dono', 'GET', `${agenda}?inicio=2026-11-24&fim=2026-11-24`)).corpo.agenda;
  assert.equal(periodo.length, 3);
  assert.equal(periodo[0].inicio, '07:00');

  assert.equal((await ctx.pedir('dono', 'DELETE', `${agenda}/${primeira.corpo.id}`)).status, 200);
  assert.equal((await ctx.pedir('dono', 'POST', agenda, { corpo: reserva('guincho', '07:00', '08:00') })).status, 201);
});

test('concreto por andar: soma por pavimento e validação do volume', { skip: semBanco }, async () => {
  await contratar(['canteiro_vertical']);
  const obra = await novaObra('vertical', 'Torre 5');
  const t1 = (await ctx.pedir('dono', 'POST', `${base(obra)}/vertical/pavimentos`, { corpo: { nome: 'Andar A' } })).corpo.id as string;
  const t2 = (await ctx.pedir('dono', 'POST', `${base(obra)}/vertical/pavimentos`, { corpo: { nome: 'Andar B' } })).corpo.id as string;
  const concreto = `${base(obra)}/vertical/concretagens`;
  const lancar = (pavimentoId: string, data: string, volumeM3: number) => ctx.pedir('dono', 'POST', concreto, { corpo: { pavimentoId, data, volumeM3, fck: '30' } });

  assert.equal((await lancar(t1, '2026-11-20', 0)).status, 400);
  const c1 = await lancar(t1, '2026-11-20', 12.5);
  assert.equal(c1.status, 201);
  assert.equal((await lancar(t1, '2026-11-21', 8.25)).status, 201);
  assert.equal((await lancar(t2, '2026-11-21', 1)).status, 201);

  const lista = (await ctx.pedir('dono', 'GET', `${base(obra)}/vertical/pavimentos`)).corpo;
  const porNome = Object.fromEntries(lista.pavimentos.map((p: { nome: string; concretadoM3: number }) => [p.nome, p.concretadoM3]));
  assert.equal(porNome['Andar A'], 20.75);
  assert.equal(porNome['Andar B'], 1);
  assert.equal(lista.concretadoTotalM3, 21.75);

  assert.equal((await ctx.pedir('dono', 'DELETE', `${concreto}/${c1.corpo.id}`)).status, 200);
  const depois = (await ctx.pedir('dono', 'GET', `${base(obra)}/vertical/pavimentos`)).corpo;
  assert.equal(depois.concretadoTotalM3, 9.25);
});
