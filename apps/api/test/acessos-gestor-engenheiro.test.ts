// Gestor (administrador, todos os módulos contratados, aprova até a alçada que o dono define) e engenheiro de obra
// (Suprimentos só das obras atribuídas a ele). Rode com `npm run test:banco -w apps/api`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepararAppTeste, semBanco, type ContextoTeste } from './apoio/app-teste.ts';
import { MODULOS } from '../src/lib/modulos.ts';

let ctx: ContextoTeste;
before(async () => {
  if (semBanco) return;
  ctx = await prepararAppTeste('teste_acessos_gestor_eng');
});
after(async () => {
  if (ctx) await ctx.fechar();
});

const um = async (sql: string, p: unknown[]) => (await ctx.banco.query(sql, p)).rows[0].id as string;
const novaObra = async (nome: string, responsaveis?: string[]) =>
  (await ctx.pedir('dono', 'POST', '/api/eng/obras', { corpo: { nome, ...(responsaveis ? { responsaveis } : {}) } })).corpo.obra.id as string;

test('gestor: é administrador e tem todos os módulos do contrato, mesmo com lista gravada', { skip: semBanco }, async () => {
  await ctx.banco.query(`UPDATE usuarios SET modulos = ARRAY['engenharia'], administrador = false WHERE id = $1`, [ctx.usuarios.a.gestor.id]);
  const eu = (await ctx.pedir('gestor', 'GET', '/api/auth/eu')).corpo.usuario;
  assert.equal(eu.administrador, true);
  assert.deepEqual(eu.modulosEfetivos, [...MODULOS]);
});

test('gestor: cadastra acessos, menos o de dono', { skip: semBanco }, async () => {
  const corpo = (perfil: string, email: string) => ({ nome: 'Novo Usuário', email, senha: 'SenhaForte#2026', perfil });
  const ok = await ctx.pedir('gestor', 'POST', '/api/usuarios', { corpo: corpo('comprador', 'comprador-novo@a.teste') });
  assert.equal(ok.status, 201, JSON.stringify(ok.corpo));
  const dono = await ctx.pedir('gestor', 'POST', '/api/usuarios', { corpo: corpo('dono', 'dono-novo@a.teste') });
  assert.equal(dono.status, 403);
});

test('gestor: aprova pedidos só até a alçada que o dono define', { skip: semBanco }, async () => {
  const forn = (await ctx.pedir('dono', 'POST', '/api/adm/fornecedores', { corpo: { razaoSocial: 'Fornecedor da alçada' } })).corpo.fornecedor.id;
  const pedido = (numero: number, centavos: number) =>
    um(`INSERT INTO pedidos_compra (empresa_id, numero, data, fornecedor_id, status, total_centavos) VALUES ($1, $2, '2026-11-20', $3, 'aguardando_aprovacao', $4) RETURNING id`, [ctx.empresas.a, numero, forn, centavos]);
  const pequeno = await pedido(8001, 100_000); // R$ 1.000
  const grande = await pedido(8002, 900_000); // R$ 9.000

  // Sem alçada configurada, só o dono aprova.
  assert.equal((await ctx.pedir('gestor', 'POST', `/api/sup/pedidos/${pequeno}/aprovar`)).status, 403);

  // O dono define a alçada: o gestor aprova até esse valor.
  const regra = await ctx.pedir('dono', 'PUT', '/api/ger/config', { corpo: { adminAte: 5000, dispensaAte: null } });
  assert.equal(regra.status, 200, JSON.stringify(regra.corpo));
  assert.equal((await ctx.pedir('gestor', 'POST', `/api/sup/pedidos/${pequeno}/aprovar`)).status, 200);
  assert.equal((await ctx.pedir('gestor', 'POST', `/api/sup/pedidos/${grande}/aprovar`)).status, 403, 'acima da alçada');
  assert.equal((await ctx.pedir('dono', 'POST', `/api/sup/pedidos/${grande}/aprovar`)).status, 200, 'o dono aprova qualquer valor');
});

test('engenheiro de obra: solicitações, pedidos e estoque só das obras atribuídas', { skip: semBanco }, async () => {
  const eng = ctx.usuarios.a.engenheiro_obra.id;
  const dele = await novaObra('Obra do engenheiro', [eng]);
  const alheia = await novaObra('Obra de outro');
  const solicitacao = (numero: number, obra: string) =>
    um(`INSERT INTO solicitacoes_compra (empresa_id, numero, data, obra_id, status, solicitante_id) VALUES ($1, $2, '2026-11-20', $3, 'aberta', $4) RETURNING id`, [ctx.empresas.a, numero, obra, ctx.usuarios.a.dono.id]);
  const sDele = await solicitacao(9001, dele);
  const sAlheia = await solicitacao(9002, alheia);

  const lista = (await ctx.pedir('engenheiro_obra', 'GET', '/api/sup/solicitacoes')).corpo.solicitacoes as { numero: number }[];
  assert.deepEqual(lista.map((s) => s.numero), [9001], 'só a solicitação da obra dele');
  assert.equal((await ctx.pedir('engenheiro_obra', 'GET', `/api/sup/solicitacoes/${sDele}`)).status, 200);
  assert.equal((await ctx.pedir('engenheiro_obra', 'GET', `/api/sup/solicitacoes/${sAlheia}`)).status, 404);
  assert.equal((await ctx.pedir('engenheiro_obra', 'POST', `/api/sup/solicitacoes/${sAlheia}/cancelar`)).status, 404);
  assert.equal((await ctx.pedir('engenheiro_obra', 'POST', '/api/sup/solicitacoes', { corpo: { obraId: alheia, itens: [] } })).status, 403, 'não pede para obra alheia');

  assert.equal((await ctx.pedir('engenheiro_obra', 'GET', `/api/sup/obras/${dele}/estoques`)).status, 200);
  assert.equal((await ctx.pedir('engenheiro_obra', 'GET', `/api/sup/obras/${alheia}/estoques`)).status, 404);
  const estoques = (await ctx.pedir('engenheiro_obra', 'GET', '/api/sup/estoques')).corpo.estoques as { obraId: string | null }[];
  assert.ok(estoques.every((e) => e.obraId === dele), 'estoques só da obra dele');

  // O que não é dele continua barrado: cotação, aprovação de pedido e cadastro de estoque.
  assert.equal((await ctx.pedir('engenheiro_obra', 'GET', '/api/sup/cotacoes')).status, 403);
  assert.equal((await ctx.pedir('engenheiro_obra', 'POST', '/api/sup/pedidos/00000000-0000-0000-0000-000000000000/aprovar')).status, 403);
  assert.equal((await ctx.pedir('engenheiro_obra', 'POST', '/api/sup/estoques', { corpo: { nome: 'Novo' } })).status, 403);
  assert.equal((await ctx.pedir('engenheiro_obra', 'GET', '/api/sup/pedidos')).status, 200);
});

test('mural: os rankings da concreteira ficam desligados', { skip: semBanco }, async () => {
  await ctx.banco.query(`UPDATE empresas SET mural = $2 WHERE id = $1`, [ctx.empresas.a, JSON.stringify({ aniversariantes: true, ranking: true, rankings: ['motoristas_m3', 'vendedores_m3'], posicoes: 5 })]);
  const painel = (await ctx.pedir('dono', 'GET', '/api/mural/painel')).corpo;
  assert.equal(painel.config.ranking, false);
  assert.deepEqual(painel.config.rankings, []);
  assert.deepEqual(painel.rankings, []);
});

test('almoxarife: estoque, etiquetas e saídas só das obras atribuídas a ele', { skip: semBanco }, async () => {
  const almox = ctx.usuarios.a.almoxarife.id;
  const dele = await novaObra('Obra do almoxarife', [almox]);
  const alheia = await novaObra('Obra sem almoxarife');

  assert.equal((await ctx.pedir('almoxarife', 'GET', `/api/sup/obras/${dele}/estoques`)).status, 200);
  assert.equal((await ctx.pedir('almoxarife', 'GET', `/api/sup/obras/${alheia}/estoques`)).status, 404);
  const estoques = (await ctx.pedir('almoxarife', 'GET', '/api/sup/estoques')).corpo.estoques as { obraId: string | null }[];
  assert.ok(estoques.length > 0 && estoques.every((e) => e.obraId === dele), 'só os estoques da obra dele');

  assert.equal((await ctx.pedir('almoxarife', 'POST', `/api/sup/obras/${dele}/estoques`, { corpo: { nome: 'Depósito B' } })).status, 201);
  assert.equal((await ctx.pedir('almoxarife', 'POST', `/api/sup/obras/${alheia}/estoques`, { corpo: { nome: 'Depósito B' } })).status, 404);
  assert.equal((await ctx.pedir('almoxarife', 'POST', '/api/sup/estoques', { corpo: { nome: 'Geral' } })).status, 404, 'estoque geral não é dele');
  const saida = { obraId: alheia, eapNoId: '00000000-0000-4000-8000-000000000001', colaboradorId: '00000000-0000-4000-8000-000000000001', data: '2026-11-23', itens: [{ etiquetaId: '00000000-0000-4000-8000-000000000001', quantidade: 1 }] };
  assert.equal((await ctx.pedir('almoxarife', 'POST', '/api/sup/saidas-material', { corpo: saida })).status, 404, 'saída de material de obra alheia');
  assert.equal((await ctx.pedir('almoxarife', 'GET', '/api/sup/estoque')).status, 200);
  assert.equal((await ctx.pedir('dono', 'GET', `/api/sup/obras/${alheia}/estoques`)).status, 200, 'o dono continua vendo todas');
});
