import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preencherProposta } from '../src/lib/proposta-interessado.ts';

const modelo = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'material', 'proposta-comercial.html'), 'utf8');
const base = { empresa: 'Construtora Alfa & Filhos', responsavel: 'Ana <Souza>', cidade: 'Palmas', uf: 'TO', obrasAtivas: 4, usuarios: 6, pacote: 'completo' as const };
const remetente = { nome: 'Leonardo Neves', email: 'comercial@agrega.test', telefone: '(63) 99999-0000' };

test('preenche nome, responsável, data e contato sem sobrar marcador do cliente', () => {
  const html = preencherProposta(modelo, base, remetente, '04/11/2026');
  assert.ok(html.includes('Construtora Alfa &amp; Filhos'));
  assert.ok(html.includes('Ana &lt;Souza&gt;'));
  assert.ok(html.includes('04/11/2026'));
  assert.ok(html.includes('Leonardo Neves · (63) 99999-0000 · comercial@agrega.test'));
  assert.ok(!html.includes('[NOME DA CONSTRUTORA]'));
  assert.ok(!html.includes('[NOME DO RESPONSÁVEL]'));
  assert.ok(!html.includes('[DD/MM/AAAA]'));
  assert.ok(!html.includes('[CONTATO COMERCIAL]'));
});

test('destaca o pacote de interesse e tira o selo do Completo quando ele não é o indicado', () => {
  const obra = preencherProposta(modelo, { ...base, pacote: 'obra' }, remetente, 'hoje');
  assert.match(obra, /<article class="pacote destaque">\s*<h4>Obra<\/h4>/);
  assert.doesNotMatch(obra, /<article class="pacote destaque">\s*<span class="selo">/);
  const completo = preencherProposta(modelo, base, remetente, 'hoje');
  assert.match(completo, /<article class="pacote destaque">\s*<span class="selo">Mais completo<\/span>\s*<h4>Completo<\/h4>/);
});

test('indicação traz o porte informado e cai no texto neutro quando não sabe o pacote', () => {
  const html = preencherProposta(modelo, base, remetente, 'hoje');
  assert.ok(html.includes('pacote Completo, pelo porte informado no cadastro: 4 obra(s) ativa(s) e 6 usuário(s).'));
  const indefinido = preencherProposta(modelo, { ...base, pacote: 'ainda_nao_sei', obrasAtivas: null, usuarios: null }, remetente, 'hoje');
  assert.ok(indefinido.includes('o pacote será definido na conversa'));
});

test('campos sem dado viram "a informar" e nada é injetado sem escape', () => {
  const html = preencherProposta(modelo, { ...base, empresa: '<img src=x onerror=1>', obrasAtivas: null, usuarios: null, pacote: 'obra_gestao' }, { ...remetente, telefone: null, email: null }, 'hoje');
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('telefone a informar'));
  assert.ok(html.includes('e-mail a informar'));
  assert.ok(html.includes('pacote Obra + Gestão, pelo que nos informou no cadastro.'));
  assert.ok(html.includes('CNPJ a informar'));
});
