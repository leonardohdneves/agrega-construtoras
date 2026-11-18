// Cadastros do Administrativo com o app de verdade e banco (rode com `npm run test:banco -w apps/api`).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepararAppTeste, semBanco, type ContextoTeste } from './apoio/app-teste.ts';

let ctx: ContextoTeste;
before(async () => {
  if (!semBanco) ctx = await prepararAppTeste('teste_cadastros_rotas');
});
after(async () => {
  if (ctx) await ctx.fechar();
});

test('P01: cliente grava e devolve o endereço; PATCH não quebra', { skip: semBanco }, async () => {
  const novo = await ctx.pedir('gestor', 'POST', '/api/adm/clientes', { corpo: { razaoSocial: 'Cliente Teste', endereco: 'Rua A, 10' } });
  assert.equal(novo.status, 201, JSON.stringify(novo.corpo));
  assert.equal(novo.corpo.cliente.endereco, 'Rua A, 10');
  const id = novo.corpo.cliente.id;
  // A tela manda o formulário inteiro, inclusive `atuacao`, que cliente não tem: o campo é ignorado.
  const r = await ctx.pedir('gestor', 'PATCH', `/api/adm/clientes/${id}`, { corpo: { endereco: 'Rua B, 20', atuacao: [], telefone: '11 99999-0000' } });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  const lista = await ctx.pedir('gestor', 'GET', '/api/adm/clientes');
  const c = lista.corpo.clientes.find((x: { id: string }) => x.id === id);
  assert.equal(c.endereco, 'Rua B, 20');
  assert.equal(c.telefone, '11 99999-0000');
});

test('P02: dono e gestor cadastram, editam e desativam colaboradores', { skip: semBanco }, async () => {
  for (const perfil of ['dono', 'gestor'] as const) {
    const novo = await ctx.pedir(perfil, 'POST', '/api/adm/colaboradores', { corpo: { nome: `Pedreiro do ${perfil}`, funcao: 'outro', cargo: 'Pedreiro' } });
    assert.equal(novo.status, 201, `${perfil}: ${JSON.stringify(novo.corpo)}`);
    const id = novo.corpo.motorista.id;
    const editado = await ctx.pedir(perfil, 'PATCH', `/api/adm/colaboradores/${id}`, { corpo: { cargo: 'Mestre pedreiro' } });
    assert.equal(editado.status, 200, JSON.stringify(editado.corpo));
    assert.equal(editado.corpo.motorista.cargo, 'Mestre pedreiro');
    assert.equal((await ctx.pedir(perfil, 'PATCH', `/api/adm/colaboradores/${id}`, { corpo: { ativo: false } })).status, 200);
    const lista = await ctx.pedir(perfil, 'GET', '/api/adm/colaboradores');
    assert.equal(lista.corpo.motoristas.find((x: { id: string }) => x.id === id).ativo, false);
  }
});

test('P02: quem não é dono nem gestor não cadastra colaborador', { skip: semBanco }, async () => {
  const r = await ctx.pedir('comprador', 'POST', '/api/adm/colaboradores', { corpo: { nome: 'X', funcao: 'outro' } });
  assert.equal(r.status, 403);
});

test('P03: PUT da permuta recusa obra e fornecedor de outra empresa', { skip: semBanco }, async () => {
  const obra = async (empresa: 'a' | 'b', codigo: string) =>
    (await ctx.pedir('dono', 'POST', '/api/eng/obras', { empresa, corpo: { codigo, nome: `Obra ${codigo}` } })).corpo.obra.id as string;
  const fornecedor = async (empresa: 'a' | 'b', nome: string) =>
    (await ctx.pedir('dono', 'POST', '/api/adm/fornecedores', { empresa, corpo: { razaoSocial: nome } })).corpo.fornecedor.id as string;
  const obraA = await obra('a', 'PM-A');
  const obraB = await obra('b', 'PM-B');
  const fornA = await fornecedor('a', 'Fornecedor A');
  const fornB = await fornecedor('b', 'Fornecedor B');
  const item = { descricao: 'Cimento', unidade: 'sc', quantidade: 10, precoUnitario: 30 };
  const corpo = (obraId: string, fornecedorId: string) => ({ obraId, fornecedorId, data: '2026-11-18', materiais: [item], servicos: [{ ...item, descricao: 'Reboco' }] });

  const nova = await ctx.pedir('dono', 'POST', '/api/sup/permutas', { corpo: corpo(obraA, fornA) });
  assert.equal(nova.status, 201, JSON.stringify(nova.corpo));
  const id = nova.corpo.permuta.id;
  assert.equal((await ctx.pedir('dono', 'POST', '/api/sup/permutas', { corpo: corpo(obraB, fornA) })).status, 400, 'POST com obra da B');
  assert.equal((await ctx.pedir('dono', 'PUT', `/api/sup/permutas/${id}`, { corpo: corpo(obraB, fornA) })).status, 400, 'PUT com obra da B');
  assert.equal((await ctx.pedir('dono', 'PUT', `/api/sup/permutas/${id}`, { corpo: corpo(obraA, fornB) })).status, 400, 'PUT com fornecedor da B');
  assert.equal((await ctx.pedir('dono', 'PUT', `/api/sup/permutas/${id}`, { corpo: corpo(obraA, fornA) })).status, 200, 'PUT válido');
});
