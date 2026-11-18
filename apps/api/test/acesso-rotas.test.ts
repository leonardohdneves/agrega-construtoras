// Regressões de acesso com o app de verdade e banco (ver test/apoio/app-teste.ts). Sem TEST_DATABASE_URL, pulam.
// Rode localmente com `npm run test:banco -w apps/api`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepararAppTeste, semBanco, type ContextoTeste } from './apoio/app-teste.ts';

let ctx: ContextoTeste;
const obras: Record<'A' | 'B', string> = { A: '', B: '' };

before(async () => {
  if (semBanco) return;
  ctx = await prepararAppTeste('teste_acesso_rotas');
  for (const k of ['A', 'B'] as const) {
    const r = await ctx.pedir('dono', 'POST', '/api/eng/obras', { corpo: { codigo: `OB-${k}`, nome: `Obra ${k}` } });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    obras[k] = r.corpo.obra.id;
  }
  // O mestre de obra fica só com a obra A.
  const r = await ctx.pedir('gestor', 'PUT', `/api/eng/obras/${obras.A}`, { corpo: { responsaveis: [ctx.usuarios.a.mestre_obra.id] } });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
});
after(async () => {
  if (ctx) await ctx.fechar();
});

// ---------------------------------------------------------------- P04: a guarda decide pela rota registrada, não pelo req.url cru

test('P04: endereço com letra codificada não fura o módulo Financeiro', { skip: semBanco }, async () => {
  for (const via of ['bearer', 'cookie'] as const) {
    assert.equal((await ctx.pedir('gestor', 'GET', '/api/fin/lancamentos', { via })).status, 403, `normal, ${via}`);
    assert.equal((await ctx.pedir('gestor', 'GET', '/api/%66in/lancamentos', { via })).status, 403, `%66in, ${via}`);
    assert.equal((await ctx.pedir('gestor', 'GET', '/api/fin/%6Cancamentos', { via })).status, 403, `%6C, ${via}`);
  }
  assert.equal((await ctx.pedir('financeiro', 'GET', '/api/%66in/lancamentos')).status, 200, 'quem tem o módulo continua entrando');
});

test('P04: endereço codificado não fura Configurações (usuários)', { skip: semBanco }, async () => {
  const corpo = { nome: 'Intruso', email: 'intruso@a.teste', senha: 'SenhaForte#2026', perfil: 'gestor' };
  for (const via of ['bearer', 'cookie'] as const) {
    const r = await ctx.pedir('mestre_obra', 'POST', '/api/%75suarios', { corpo, via });
    assert.equal(r.status, 403, `${via}: ${JSON.stringify(r.corpo)}`);
  }
});

test('P04: senha provisória também vale com endereço codificado', { skip: semBanco }, async () => {
  await ctx.banco.query('UPDATE usuarios SET senha_provisoria = true WHERE id = $1', [ctx.usuarios.a.comprador.id]);
  try {
    assert.equal((await ctx.pedir('comprador', 'GET', '/api/auth/eu')).status, 200);
    assert.equal((await ctx.pedir('comprador', 'GET', '/api/%73up/pedidos')).status, 403);
  } finally {
    await ctx.banco.query('UPDATE usuarios SET senha_provisoria = false WHERE id = $1', [ctx.usuarios.a.comprador.id]);
  }
});

// ---------------------------------------------------------------- P29: mestre de obra só nas obras atribuídas (D10)

test('P29: mestre de obra lista só as obras atribuídas', { skip: semBanco }, async () => {
  const r = await ctx.pedir('mestre_obra', 'GET', '/api/eng/obras');
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo.obras.map((o: { id: string }) => o.id), [obras.A]);
});

test('P29: mestre de obra não lê nada da obra que não é dele', { skip: semBanco }, async () => {
  for (const sufixo of ['', '/rdos', '/canteiro', '/planejamento', '/eap', '/visitas']) {
    const outra = await ctx.pedir('mestre_obra', 'GET', `/api/eng/obras/${obras.B}${sufixo}`);
    assert.equal(outra.status, 404, `obra B${sufixo}: ${outra.status}`);
    const dele = await ctx.pedir('mestre_obra', 'GET', `/api/eng/obras/${obras.A}${sufixo}`);
    assert.ok(dele.status !== 404 && dele.status !== 403, `obra A${sufixo}: ${dele.status} ${JSON.stringify(dele.corpo)}`);
  }
});

test('P29: mestre de obra sem obra atribuída vê lista vazia', { skip: semBanco }, async () => {
  const r = await ctx.pedir('mestre_obra', 'GET', '/api/eng/obras', { empresa: 'b' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo.obras, []);
});

test('P29: mestre de obra não lança RDO nem na obra dele', { skip: semBanco }, async () => {
  const r = await ctx.pedir('mestre_obra', 'POST', `/api/eng/obras/${obras.A}/rdos`, { corpo: {} });
  assert.equal(r.status, 403);
});

test('P29: só dono e gestor atribuem responsáveis', { skip: semBanco }, async () => {
  const corpo = { responsaveis: [ctx.usuarios.a.mestre_obra.id] };
  const orc = await ctx.pedir('orcamentista', 'PUT', `/api/eng/obras/${obras.B}`, { corpo });
  assert.equal(orc.status, 403, JSON.stringify(orc.corpo));
  const nova = await ctx.pedir('orcamentista', 'POST', '/api/eng/obras', { corpo: { codigo: 'OB-X', nome: 'Obra X', responsaveis: [] } });
  assert.equal(nova.status, 403);
  // O orçamentista continua editando a obra, desde que não mexa nos responsáveis.
  assert.equal((await ctx.pedir('orcamentista', 'PUT', `/api/eng/obras/${obras.B}`, { corpo: { nome: 'Obra B (revisada)' } })).status, 200);
});

test('P29: gestor atribui a obra B e o acesso do mestre aparece na hora', { skip: semBanco }, async () => {
  const mestre = ctx.usuarios.a.mestre_obra.id;
  assert.equal((await ctx.pedir('gestor', 'PUT', `/api/eng/obras/${obras.B}`, { corpo: { responsaveis: [mestre] } })).status, 200);
  assert.equal((await ctx.pedir('mestre_obra', 'GET', `/api/eng/obras/${obras.B}/rdos`)).status, 200);
  // Devolve o estado inicial para os demais testes.
  assert.equal((await ctx.pedir('gestor', 'PUT', `/api/eng/obras/${obras.B}`, { corpo: { responsaveis: [] } })).status, 200);
  assert.equal((await ctx.pedir('mestre_obra', 'GET', `/api/eng/obras/${obras.B}/rdos`)).status, 404);
});
