// Rota de leitura de IFC: envia o modelo de exemplo, recebe os quantitativos por pavimento e tipo, e rejeita o que não é IFC.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { prepararAppTeste, semBanco, type ContextoTeste } from './apoio/app-teste.ts';

let ctx: ContextoTeste;
let obra: string;
before(async () => {
  if (semBanco) return;
  ctx = await prepararAppTeste('teste_leitura_ifc');
  obra = (await ctx.pedir('dono', 'POST', '/api/eng/obras', { corpo: { codigo: 'OB-IFC', nome: 'Obra IFC' } })).corpo.obra.id as string;
});
after(async () => {
  if (ctx) await ctx.fechar();
});

test('IFC de exemplo: a rota devolve os quantitativos por pavimento e tipo', { skip: semBanco }, async () => {
  const arquivo = fs.readFileSync(new URL('./fixtures/exemplo_casa.ifc', import.meta.url)).toString('base64');
  const r = await ctx.pedir('dono', 'POST', `/api/eng/obras/${obra}/leitura-ifc`, { corpo: { arquivo, nome: 'exemplo_casa.ifc' } });
  assert.equal(r.status, 200, JSON.stringify(r.corpo).slice(0, 300));
  assert.ok(r.corpo.itens.length >= 3);
  const laje = r.corpo.itens.find((i: { tipo: string }) => i.tipo === 'laje');
  assert.equal(laje.pavimento, 'Terreo');
  assert.equal(laje.unidade, 'm³');
  assert.ok(Array.isArray(laje.candidatas));
});

test('leitura de IFC: modelo de obra com mais de 40 MB é aceito; acima de 60 MB, recusado', { skip: semBanco }, async () => {
  const exemplo = fs.readFileSync(new URL('./fixtures/exemplo_casa.ifc', import.meta.url));
  // linhas em branco no fim só aumentam o tamanho, sem mudar o modelo
  const comTamanho = (mb: number) => Buffer.concat([exemplo, Buffer.alloc(mb * 1024 * 1024, '\n')]).toString('base64');
  const grande = await ctx.pedir('dono', 'POST', `/api/eng/obras/${obra}/leitura-ifc`, { corpo: { arquivo: comTamanho(41) } });
  assert.equal(grande.status, 200, JSON.stringify(grande.corpo).slice(0, 300));
  assert.ok(grande.corpo.itens.length >= 3);
  const demais = await ctx.pedir('dono', 'POST', `/api/eng/obras/${obra}/leitura-ifc`, { corpo: { arquivo: comTamanho(61) } });
  assert.equal(demais.status, 400);
  assert.match(demais.corpo.erro, /máximo 60 MB/);
});

test('leitura de IFC: arquivo que não é IFC é recusado', { skip: semBanco }, async () => {
  const texto = Buffer.from('Item;Un;Quantidade\nA;m;1').toString('base64');
  const r = await ctx.pedir('dono', 'POST', `/api/eng/obras/${obra}/leitura-ifc`, { corpo: { arquivo: texto, nome: 'planilha.csv' } });
  assert.equal(r.status, 400);
  assert.match(r.corpo.erro, /Envie um arquivo IFC/);
});
