// Testes de rota com o app de verdade e banco (ver test/apoio/app-teste.ts). Sem TEST_DATABASE_URL, pulam.
// Este arquivo só confere a base: sessão por Bearer e por cookie, sem sessão, guarda de perfil e isolamento entre empresas.
// As matrizes de perfil × módulo e entre empresas entram no Sprint 1 (P07).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepararAppTeste, semBanco, type ContextoTeste } from './apoio/app-teste.ts';

let ctx: ContextoTeste;

before(async () => {
  if (!semBanco) ctx = await prepararAppTeste('teste_rotas_base');
});
after(async () => {
  if (ctx) await ctx.fechar();
});

test('saúde responde sem sessão', { skip: semBanco }, async () => {
  const r = await ctx.pedir(null, 'GET', '/api/saude');
  assert.equal(r.status, 200);
  assert.equal(r.corpo.ok, true);
});

test('sem sessão: 401 numa rota protegida', { skip: semBanco }, async () => {
  const r = await ctx.pedir(null, 'GET', '/api/auth/eu');
  assert.equal(r.status, 401);
});

test('a sessão vale por Bearer e por cookie', { skip: semBanco }, async () => {
  for (const via of ['bearer', 'cookie'] as const) {
    const r = await ctx.pedir('dono', 'GET', '/api/auth/eu', { via });
    assert.equal(r.status, 200, `via ${via}`);
    assert.equal(r.corpo.usuario.id, ctx.usuarios.a.dono.id);
  }
});

test('o Financeiro é só de dono e financeiro', { skip: semBanco }, async () => {
  assert.equal((await ctx.pedir('dono', 'GET', '/api/fin/lancamentos')).status, 200);
  assert.equal((await ctx.pedir('financeiro', 'GET', '/api/fin/lancamentos')).status, 200);
  assert.equal((await ctx.pedir('mestre_obra', 'GET', '/api/fin/lancamentos')).status, 403);
});

test('uma empresa não vê a obra da outra', { skip: semBanco }, async () => {
  const criada = await ctx.pedir('dono', 'POST', '/api/eng/obras', { corpo: { codigo: 'OB-A1', nome: 'Obra da A' } });
  assert.ok(criada.status < 300, JSON.stringify(criada.corpo));
  const id = criada.corpo.obra?.id ?? criada.corpo.id;
  const listaB = await ctx.pedir('dono', 'GET', '/api/eng/obras', { empresa: 'b' });
  assert.equal(listaB.status, 200);
  assert.ok(!JSON.stringify(listaB.corpo).includes(id));
  const detalheB = await ctx.pedir('dono', 'GET', `/api/eng/obras/${id}`, { empresa: 'b' });
  assert.equal(detalheB.status, 404);
});
