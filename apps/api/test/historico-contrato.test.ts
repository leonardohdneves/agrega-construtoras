// Histórico do contrato: leitura dos registros de auditoria e texto das mudanças (sem banco), e a rota do administrador
// do sistema (com banco). Rode a parte com banco com `npm run test:banco -w apps/api`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { descreverMudancas, lerContrato } from '../src/lib/historico-contrato.ts';
import { prepararAppTeste, semBanco, type ContextoTeste } from './apoio/app-teste.ts';

test('histórico: pacote, módulos, recursos, limites e teste', () => {
  const antes = lerContrato({ pacote: 'obra', modulos: ['engenharia', 'suprimentos', 'configuracoes'], recursos: ['canteiro_horizontal'], limiteObras: 3, limiteUsuarios: 3, testeFim: null });
  const depois = lerContrato({
    pacote: 'completo',
    modulos: ['engenharia', 'comercial', 'financeiro', 'configuracoes'],
    recursos: ['canteiro_horizontal', 'centrais'],
    limiteObras: 10,
    limiteUsuarios: null,
    testeFim: '2026-12-01',
  });
  assert.deepEqual(descreverMudancas(antes, depois), [
    'Pacote: Obra → Completo',
    'Módulos liberados: Comercial, Financeiro',
    'Módulos retirados: Suprimentos',
    'Recursos do canteiro liberados: Centrais de produção',
    'Limite de obras: 3 → 10',
    'Limite de usuários: 3 → sem limite',
    'Teste até 01/12/2026',
  ]);
});

test('histórico: nada mudou, nada é descrito', () => {
  const c = { pacote: 'obra', modulos: ['engenharia', 'configuracoes'], recursos: [], limiteObras: 3, limiteUsuarios: 3, testeFim: null };
  assert.deepEqual(descreverMudancas(lerContrato(c), lerContrato(c)), []);
});

test('histórico: registros antigos (sem pacote anterior nem recursos) ainda são lidos', () => {
  // Formato anterior: "antes" com contrato/limites/teste e "depois" com teste em par.
  const antes = lerContrato({ contrato: ['engenharia', 'configuracoes'], limites: [3, 5], teste: [null, null] });
  const depois = lerContrato({ pacote: 'obra_gestao', modulos: ['engenharia', 'financeiro', 'configuracoes'], limiteObras: 3, limiteUsuarios: 8, teste: [null, null] });
  assert.deepEqual(descreverMudancas(antes, depois), ['Pacote: Obra + Gestão', 'Módulos liberados: Financeiro', 'Limite de usuários: 5 → 8']);
});

test('histórico: teste encerrado', () => {
  const antes = lerContrato({ pacote: 'completo', testeFim: '2026-11-30' });
  assert.deepEqual(descreverMudancas(antes, lerContrato({ pacote: 'completo', testeFim: null })), ['Teste encerrado']);
});

let ctx: ContextoTeste;
before(async () => {
  if (semBanco) return;
  ctx = await prepararAppTeste('teste_historico_contrato');
});
after(async () => {
  if (ctx) await ctx.fechar();
});

test('histórico: cada alteração do contrato aparece, da mais recente para a mais antiga', { skip: semBanco }, async () => {
  const url = `/api/admin/empresas/${ctx.empresas.a}/contrato`;
  const salvar = (corpo: Record<string, unknown>) => ctx.pedir('admin_sistema', 'PUT', url, { corpo });
  assert.equal((await salvar({ pacote: 'obra', recursos: [], limiteObras: 3, limiteUsuarios: 3 })).status, 200);
  assert.equal((await salvar({ pacote: 'completo', recursos: ['centrais'], limiteObras: 10, limiteUsuarios: 8 })).status, 200);

  const r = await ctx.pedir('admin_sistema', 'GET', `${url}/historico`);
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  const [ultima, anterior] = r.corpo.historico as { tipo: string; quem: string | null; mudancas: string[] }[];
  assert.equal(ultima.tipo, 'alteracao');
  assert.ok(ultima.mudancas.includes('Pacote: Obra → Completo'), ultima.mudancas.join(' | '));
  assert.ok(ultima.mudancas.includes('Recursos do canteiro liberados: Centrais de produção'));
  assert.ok(ultima.mudancas.includes('Limite de obras: 3 → 10'));
  assert.ok(anterior.mudancas.some((m) => m.startsWith('Pacote:')));
  assert.ok(ultima.quem, 'mostra quem alterou');
  assert.equal(typeof r.corpo.empresa.nome, 'string');
});

test('histórico: só o administrador do sistema vê, e empresa inexistente dá 404', { skip: semBanco }, async () => {
  assert.equal((await ctx.pedir('dono', 'GET', `/api/admin/empresas/${ctx.empresas.a}/contrato/historico`)).status, 403);
  assert.equal((await ctx.pedir('admin_sistema', 'GET', '/api/admin/empresas/nao-e-uuid/contrato/historico')).status, 404);
  assert.equal((await ctx.pedir('admin_sistema', 'GET', '/api/admin/empresas/00000000-0000-4000-8000-000000000000/contrato/historico')).status, 404);
});
