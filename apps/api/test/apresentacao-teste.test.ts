import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preencherApresentacao } from '../src/lib/apresentacao-teste.ts';

const modelo = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'material', 'apresentacao-teste.html'), 'utf8');

test('personaliza capa, problema e fechamento com o cliente', () => {
  const html = preencherApresentacao(modelo, { cliente: 'Construtora Alfa & Filhos', responsavel: 'Ana Souza' }, '04/11/2026');
  assert.ok(html.includes('Apresentação para Construtora Alfa &amp; Filhos'));
  assert.ok(html.includes('A/C: Ana Souza · 04/11/2026'));
  assert.ok(html.includes('Para Construtora Alfa &amp; Filhos, como em outras construtoras'));
  assert.doesNotMatch(html, /\{\{\w+\}\}/, 'não pode sobrar marcador');
});

test('sem responsável, usa "a informar" e escapa HTML', () => {
  const html = preencherApresentacao(modelo, { cliente: '<b>X</b>', responsavel: null }, 'hoje');
  assert.ok(html.includes('A/C: a informar'));
  assert.ok(html.includes('&lt;b&gt;X&lt;/b&gt;'));
  assert.ok(!html.includes('<b>X</b>'));
});

test('não traz preços nem a proposta', () => {
  const html = preencherApresentacao(modelo, { cliente: 'Y', responsavel: null }, 'hoje');
  assert.doesNotMatch(html, /R\$|\/mês|Investimento/);
});
