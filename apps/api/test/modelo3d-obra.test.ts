// Modelo 3D guardado na obra: enviar, ler de volta, substituir, remover; recusa o que não é modelo convertido e
// respeita o acesso por obra e perfil.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gzipSync } from 'node:zlib';
import { converterIfc } from '../src/lib/modelo3d.ts';
import { prepararAppTeste, semBanco, type ContextoTeste } from './apoio/app-teste.ts';

let ctx: ContextoTeste;
let obra: string;
let arquivo: Buffer;
let rota: string;

before(async () => {
  if (semBanco) return;
  ctx = await prepararAppTeste('teste_modelo3d_obra');
  obra = (await ctx.pedir('dono', 'POST', '/api/eng/obras', { corpo: { codigo: 'OB-3D', nome: 'Obra 3D' } })).corpo.obra.id as string;
  rota = `/api/eng/obras/${obra}/modelo-3d`;
  const exemplo = fs.readFileSync(new URL('./fixtures/exemplo_casa.ifc', import.meta.url));
  arquivo = (await converterIfc(new Uint8Array(exemplo), 'exemplo_casa.ifc')).arquivo;
});
after(async () => {
  if (ctx) await ctx.fechar();
});

const baixar = (token: string) => ctx.app.inject({ method: 'GET', url: `${rota}/arquivo`, headers: { authorization: `Bearer ${token}` } });

test('guarda, devolve os mesmos bytes, substitui e remove', { skip: semBanco }, async () => {
  assert.equal((await ctx.pedir('dono', 'GET', rota)).corpo.modelo, null);
  const envio = await ctx.pedir('dono', 'PUT', rota, { corpo: { arquivo: arquivo.toString('base64'), nome: 'casa.ifc' } });
  assert.equal(envio.status, 200, JSON.stringify(envio.corpo));
  const info = (await ctx.pedir('dono', 'GET', rota)).corpo.modelo;
  assert.equal(info.nome, 'casa.ifc');
  assert.equal(info.tamanho, arquivo.length);
  assert.ok(info.enviadoEm);
  const volta = await baixar(ctx.usuarios.a.dono.token);
  assert.equal(volta.statusCode, 200);
  assert.deepEqual(volta.rawPayload, arquivo);

  await ctx.pedir('dono', 'PUT', rota, { corpo: { arquivo: arquivo.toString('base64'), nome: 'casa-r1.ifc' } });
  assert.equal((await ctx.pedir('dono', 'GET', rota)).corpo.modelo.nome, 'casa-r1.ifc');

  assert.equal((await ctx.pedir('dono', 'DELETE', rota)).status, 200);
  assert.equal((await ctx.pedir('dono', 'GET', rota)).corpo.modelo, null);
  assert.equal((await ctx.pedir('dono', 'GET', `${rota}/arquivo`)).status, 404);
  assert.equal((await ctx.pedir('dono', 'DELETE', rota)).status, 404);
});

test('recusa o que não é modelo convertido', { skip: semBanco }, async () => {
  for (const ruim of [Buffer.from('ISO-10303-21;'), gzipSync(Buffer.from('outra coisa qualquer'))]) {
    const r = await ctx.pedir('dono', 'PUT', rota, { corpo: { arquivo: ruim.toString('base64'), nome: 'x' } });
    assert.equal(r.status, 400);
    assert.match(r.corpo.erro, /modelo convertido/);
  }
});

test('acesso: sem sessão, outra empresa, engenheiro de outra obra e mestre de obra', { skip: semBanco }, async () => {
  const corpo = { arquivo: arquivo.toString('base64'), nome: 'casa.ifc' };
  await ctx.pedir('dono', 'PUT', rota, { corpo });
  assert.equal((await ctx.pedir(null, 'GET', rota)).status, 401);
  assert.equal((await ctx.pedir('dono', 'GET', rota, { empresa: 'b' })).status, 404);
  assert.equal((await ctx.pedir('dono', 'PUT', rota, { corpo, empresa: 'b' })).status, 404);
  // sem a obra atribuída, o engenheiro não a enxerga
  assert.equal((await ctx.pedir('engenheiro_obra', 'GET', rota)).status, 404);

  await ctx.banco.query('INSERT INTO obra_responsaveis (obra_id, usuario_id) VALUES ($1, $2), ($1, $3)', [obra, ctx.usuarios.a.engenheiro_obra.id, ctx.usuarios.a.mestre_obra.id]);
  assert.equal((await ctx.pedir('engenheiro_obra', 'PUT', rota, { corpo })).status, 200);
  assert.equal((await ctx.pedir('mestre_obra', 'GET', rota)).status, 200);
  assert.equal((await baixar(ctx.usuarios.a.mestre_obra.token)).statusCode, 200);
  assert.equal((await ctx.pedir('mestre_obra', 'PUT', rota, { corpo })).status, 403);
  assert.equal((await ctx.pedir('mestre_obra', 'DELETE', rota)).status, 403);
});
