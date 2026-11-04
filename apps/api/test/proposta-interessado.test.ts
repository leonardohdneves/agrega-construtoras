import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatarCnpjProposta, indicacaoContrato, indicacaoInteressado, preencherProposta, type PacoteProposta } from '../src/lib/proposta-interessado.ts';

const modelo = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'material', 'proposta-comercial.html'), 'utf8');
const remetente = { nome: 'Leonardo Neves', email: 'comercial@agrega.test', telefone: '(63) 99999-0000', cnpj: null };
const dados = (pacote: PacoteProposta, indicacao: string, extra: Partial<{ empresa: string; responsavel: string | null; cnpj: string | null }> = {}) => ({
  empresa: 'Construtora Alfa & Filhos',
  responsavel: 'Ana <Souza>',
  cnpj: '12345678000190',
  pacote,
  indicacao,
  ...extra,
});

test('formata CNPJ de 14 dígitos e deixa outros valores como estão', () => {
  assert.equal(formatarCnpjProposta('12345678000190'), '12.345.678/0001-90');
  assert.equal(formatarCnpjProposta(null), null);
  assert.equal(formatarCnpjProposta('12.345'), '12.345');
});

test('preenche cliente, responsável, CNPJ, data e contato sem sobrar marcador', () => {
  const html = preencherProposta(modelo, dados('completo', 'x'), remetente, '04/11/2026');
  assert.ok(html.includes('Construtora Alfa &amp; Filhos'));
  assert.ok(html.includes('Ana &lt;Souza&gt;'));
  assert.ok(html.includes('CNPJ 12.345.678/0001-90'));
  assert.ok(html.includes('04/11/2026'));
  assert.ok(html.includes('Leonardo Neves · telefone a informar · comercial@agrega.test'.replace('telefone a informar', '(63) 99999-0000')));
  assert.ok(html.includes('CNPJ a informar'), 'CNPJ da Agrega ainda não cadastrado');
  for (const marcador of ['[NOME DA CONSTRUTORA]', '[NOME DO RESPONSÁVEL]', '[CARGO]', '[CNPJ]', '[DD/MM/AAAA]', '[CONTATO COMERCIAL]', '[NOME DO REPRESENTANTE]']) {
    assert.ok(!html.includes(marcador), `sobrou ${marcador}`);
  }
});

test('sem responsável ou CNPJ do cliente, usa "a informar"', () => {
  const html = preencherProposta(modelo, dados('obra', 'x', { responsavel: null, cnpj: null }), remetente, 'hoje');
  assert.ok(html.includes('A/C: a informar'));
  assert.ok(html.includes('a informar<br>CNPJ a informar'));
});

test('destaca o pacote e tira o selo do Completo quando ele não é o indicado', () => {
  const obra = preencherProposta(modelo, dados('obra', 'x'), remetente, 'hoje');
  assert.match(obra, /<article class="pacote destaque">\s*<h4>Obra<\/h4>/);
  assert.doesNotMatch(obra, /<span class="selo">Mais completo/);
  const completo = preencherProposta(modelo, dados('completo', 'x'), remetente, 'hoje');
  assert.match(completo, /<article class="pacote destaque">\s*<span class="selo">Mais completo<\/span>\s*<h4>Completo<\/h4>/);
});

test('pacote personalizado não destaca cartão nenhum', () => {
  const html = preencherProposta(modelo, dados('personalizado', 'x'), remetente, 'hoje');
  assert.doesNotMatch(html, /pacote destaque/);
});

test('indicação do interessado usa o porte informado ou o texto neutro', () => {
  assert.equal(indicacaoInteressado('completo', 4, 6), 'pacote Completo, pelo porte informado no cadastro: 4 obra(s) ativa(s) e 6 usuário(s).');
  assert.equal(indicacaoInteressado('obra_gestao', null, null), 'pacote Obra + Gestão, pelo que nos informou no cadastro.');
  assert.equal(indicacaoInteressado('ainda_nao_sei', 2, 2), 'o pacote será definido na conversa, de acordo com o porte da operação.');
});

test('indicação da construtora cadastrada usa os limites do contrato', () => {
  assert.equal(indicacaoContrato('completo', 10, 8), 'pacote Completo, com até 10 obra(s) ativa(s) e até 8 usuário(s).');
  assert.equal(indicacaoContrato('personalizado', 15, null), 'pacote personalizado, com os módulos combinados e até 15 obra(s) ativa(s).');
  assert.equal(indicacaoContrato('personalizado', null, null), 'pacote personalizado, com os módulos combinados no contrato.');
});

test('texto vindo do cadastro é escapado (sem injeção de HTML)', () => {
  const html = preencherProposta(modelo, dados('obra', 'x', { empresa: '<img src=x onerror=1>' }), remetente, 'hoje');
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x onerror=1&gt;'));
});
