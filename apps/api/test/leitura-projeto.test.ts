// Leitura de projeto por IA: casamento dos quantitativos com as composições cadastradas (sem chamar a IA).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ehPdfBase64, lerQuantitativos, pontuarCandidatas, type ComposicaoRef } from '../src/lib/leitura-projeto.ts';

const base = (codigo: string, descricao: string, unidade: string): ComposicaoRef => ({
  id: `id-${codigo}`,
  tabelaId: 't1',
  tabela: 'Própria 2026',
  fonte: 'proprio',
  codigo,
  descricao,
  unidade,
});

const composicoes = [
  base('C1', 'Forma de madeira para vigas e lajes, com escoramento', 'm2'),
  base('C2', 'Forma para pilares de concreto armado', 'm2'),
  base('C3', 'Armação CA-50 corte, dobra e montagem', 'kg'),
  base('C4', 'Armação CA-60 para estribos', 'kg'),
  base('C5', 'Concreto usinado fck 25 MPa, lançado e adensado', 'm3'),
  base('C6', 'Alvenaria de bloco cerâmico', 'm2'),
];

test('forma: só composições de forma, com a unidade certa em primeiro', () => {
  const r = pontuarCandidatas({ servico: 'forma', descricao: 'Forma das vigas do térreo', unidade: 'm2' }, composicoes);
  assert.ok(r.length >= 1);
  assert.ok(r.every((c) => /forma/i.test(c.descricao)));
  assert.equal(r[0].codigo, 'C1');
});

test('armação: bate CA-50 e CA-60 e não traz forma nem concreto', () => {
  const r = pontuarCandidatas({ servico: 'armacao', descricao: 'Aço CA-50 8,0 mm', unidade: 'kg' }, composicoes);
  const codigos = r.map((c) => c.codigo);
  assert.ok(codigos.includes('C3'));
  assert.ok(codigos.includes('C4'));
  assert.ok(!codigos.includes('C1') && !codigos.includes('C5'));
});

test('concreto: sem candidata fora do serviço', () => {
  const r = pontuarCandidatas({ servico: 'concreto', descricao: 'Concreto C-25', unidade: 'm3' }, composicoes);
  assert.deepEqual(r.map((c) => c.codigo), ['C5']);
});

test('limite de candidatas é respeitado', () => {
  const muitas = Array.from({ length: 12 }, (_, i) => base(`X${i}`, `Concreto usinado ${i}`, 'm3'));
  assert.equal(pontuarCandidatas({ servico: 'concreto', descricao: 'Concreto', unidade: 'm3' }, muitas).length, 5);
});

test('outro: exige ao menos duas palavras da descrição', () => {
  const r = pontuarCandidatas({ servico: 'outro', descricao: 'Alvenaria de bloco cerâmico', unidade: 'm2' }, composicoes);
  assert.equal(r[0].codigo, 'C6');
  const nada = pontuarCandidatas({ servico: 'outro', descricao: 'Pintura epóxi', unidade: 'm2' }, composicoes);
  assert.deepEqual(nada, []);
});

test('lerQuantitativos descarta itens inválidos e tipa serviço desconhecido como outro', () => {
  const r = lerQuantitativos({
    itens: [
      { servico: 'forma', descricao: 'Forma das vigas', unidade: 'm2', quantidade: '27,04', origem: 'Quadro' },
      { servico: 'armacao', descricao: '', unidade: 'kg', quantidade: 10, origem: 'x' },
      { servico: 'concreto', descricao: 'Concreto', unidade: 'm3', quantidade: 0, origem: 'x' },
      { servico: 'estranho', descricao: 'Reboco', unidade: 'm2', quantidade: 5, origem: 'x' },
    ],
    pendencias: ['Pilares P3 a P17 sem seção', '  '],
  });
  assert.equal(r.itens.length, 2);
  assert.equal(r.itens[0].quantidade, 27.04);
  assert.equal(r.itens[1].servico, 'outro');
  assert.deepEqual(r.pendencias, ['Pilares P3 a P17 sem seção']);
});

test('ehPdfBase64 reconhece PDF com ou sem prefixo data:', () => {
  const pdf = Buffer.from('%PDF-1.7 conteudo').toString('base64');
  assert.equal(ehPdfBase64(pdf), true);
  assert.equal(ehPdfBase64(`data:application/pdf;base64,${pdf}`), true);
  assert.equal(ehPdfBase64(Buffer.from('<html>').toString('base64')), false);
});
