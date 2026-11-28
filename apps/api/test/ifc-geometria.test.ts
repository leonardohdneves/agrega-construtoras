// Geometria do IFC lida no servidor para o 3D das telas 4D/5D: peças com identificação, classe e malha; rota protegida.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { geometriaDoIfc } from '../src/lib/ifc-geometria.ts';
import { prepararAppTeste, semBanco, type ContextoTeste } from './apoio/app-teste.ts';

const exemplo = fs.readFileSync(new URL('./fixtures/exemplo_casa.ifc', import.meta.url));

test('modelo de exemplo: 13 peças, cada uma com malha e matriz válidas', async () => {
  const { pecas, ignoradas } = await geometriaDoIfc(new Uint8Array(exemplo));
  assert.equal(pecas.length, 13);
  assert.equal(ignoradas, 0);
  for (const p of pecas) {
    assert.ok(p.guid, 'GlobalId presente');
    assert.equal(p.matriz.length, 16);
    const pos = Buffer.from(p.pos, 'base64').length / 4;
    const nor = Buffer.from(p.nor, 'base64').length / 4;
    const idx = Buffer.from(p.idx, 'base64').length / 4;
    assert.ok(pos > 0 && pos % 3 === 0 && nor === pos, 'posições e normais em ternos');
    assert.ok(idx > 0 && idx % 3 === 0, 'índices em triângulos');
  }
  assert.ok(pecas.some((p) => p.tipo === 'WALL'), 'paredes reconhecidas pela classe');
});

test('modelo acima do limite de vértices é recusado com mensagem', async () => {
  await assert.rejects(() => geometriaDoIfc(new Uint8Array(exemplo), 10), /grande demais/);
});

let ctx: ContextoTeste;
before(async () => {
  if (!semBanco) ctx = await prepararAppTeste('teste_ifc_geometria');
});
after(async () => {
  if (ctx) await ctx.fechar();
});

test('rota: exige sessão, devolve as peças e recusa o que não é IFC', { skip: semBanco }, async () => {
  const corpo = { arquivo: exemplo.toString('base64') };
  const semSessao = await ctx.pedir(null, 'POST', '/api/eng/ifc/geometria', { corpo });
  assert.equal(semSessao.status, 401);
  const r = await ctx.pedir('dono', 'POST', '/api/eng/ifc/geometria', { corpo });
  assert.equal(r.status, 200, JSON.stringify(r.corpo).slice(0, 300));
  assert.equal(r.corpo.pecas.length, 13);
  const ruim = await ctx.pedir('dono', 'POST', '/api/eng/ifc/geometria', { corpo: { arquivo: Buffer.from('a;b;c').toString('base64') } });
  assert.equal(ruim.status, 400);
});

test('quem abre o 5D pelo Planejamento também vê o 3D; almoxarife não', { skip: semBanco }, async () => {
  const corpo = { arquivo: exemplo.toString('base64') };
  for (const perfil of ['gestor', 'orcamentista', 'engenheiro_obra', 'mestre_obra'] as const) {
    const r = await ctx.pedir(perfil, 'POST', '/api/eng/ifc/geometria', { corpo });
    assert.equal(r.status, 200, perfil);
  }
  const almoxarife = await ctx.pedir('almoxarife', 'POST', '/api/eng/ifc/geometria', { corpo });
  assert.equal(almoxarife.status, 403);
});
