import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preencherApresentacao } from '../src/lib/apresentacao-teste.ts';

const modelo = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'material', 'apresentacao-teste.html'), 'utf8');

test('personaliza capa, problema e fechamento com o cliente', () => {
  const html = preencherApresentacao(modelo, { cliente: 'Construtora Alfa & Filhos', responsavel: 'Ana Souza' }, '04/11/2026');
  assert.ok(html.includes('Apresentação para <b>Construtora Alfa &amp; Filhos</b>'));
  assert.ok(html.includes('Responsável: <b>Ana Souza</b>'));
  assert.ok(html.includes('04/11/2026'));
  assert.ok(html.includes('class="icone"'), 'logo oficial presente');
  assert.ok(html.includes('Para Construtora Alfa &amp; Filhos, como em outras construtoras'));
  assert.doesNotMatch(html, /\{\{\w+\}\}/, 'não pode sobrar marcador');
});

test('sem responsável, usa "a informar" e escapa HTML', () => {
  const html = preencherApresentacao(modelo, { cliente: '<b>X</b>', responsavel: null }, 'hoje');
  assert.ok(html.includes('Responsável: <b>a informar</b>'));
  assert.ok(html.includes('&lt;b&gt;X&lt;/b&gt;'));
  assert.ok(!html.includes('<b>X</b>'));
});

test('não traz preços nem a proposta', () => {
  const html = preencherApresentacao(modelo, { cliente: 'Y', responsavel: null }, 'hoje');
  assert.doesNotMatch(html, /R\$|\/mês|Investimento/);
});

test('construtora já cadastrada: o botão leva ao login do app', () => {
  const html = preencherApresentacao(modelo, { cliente: 'Construtora Beta', responsavel: 'Ana', cadastrado: true }, 'hoje');
  assert.match(html, /href="\/entrar"[^>]*>Entrar no Agrega</);
  assert.ok(html.includes('Para Construtora Beta, é só entrar com o seu usuário e senha.'));
  assert.doesNotMatch(html, /href="\/interesse"/);
});

test('interessado: o botão leva ao cadastro de interessados', () => {
  const html = preencherApresentacao(modelo, { cliente: 'Gama', responsavel: null }, 'hoje');
  assert.match(html, /href="\/interesse"[^>]*>Quero o período de testes</);
  assert.doesNotMatch(html, /\{\{\w+\}\}/);
});

test('com o endereço do sistema, o botão tem link absoluto (funciona no PDF)', () => {
  const html = preencherApresentacao(modelo, { cliente: 'Delta', responsavel: null, cadastrado: true }, 'hoje', 'https://app.agrega.test');
  assert.match(html, /href="https:\/\/app\.agrega\.test\/entrar"/);
  const interessado = preencherApresentacao(modelo, { cliente: 'Eta', responsavel: null }, 'hoje', 'https://app.agrega.test/');
  assert.match(interessado, /href="https:\/\/app\.agrega\.test\/interesse"/);
});

test('a apresentação traz o botão de imprimir, que some na impressão', () => {
  const html = preencherApresentacao(modelo, { cliente: 'Theta', responsavel: null }, 'hoje');
  assert.match(html, /onclick="window\.print\(\)"/);
  assert.match(html, /\.nao-imprimir \{ display: none !important; \}/);
});
