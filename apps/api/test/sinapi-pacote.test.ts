import { test } from 'node:test';
import assert from 'node:assert/strict';
import { converterPacote, linhasCsv, registros } from '../src/lib/sinapi-pacote.ts';
import { lerCsvReferencia } from '../src/lib/engenharia.ts';

const insumos = '﻿codigo;classificacao;descricao;unidade;origem_preco\nI1;MATERIAL;CIMENTO;KG;CR\nI2;MAO DE OBRA;PEDREIRO;H;CR\nI3;MATERIAL;AREIA;M3;CR\nI4;NÃO LISTADO;SEM PRECO;UN;CR\n';
const composicoes = 'codigo;grupo;descricao;unidade;situacao\nC1;Alv;ARGAMASSA;M3;COM CUSTO\nA1;Aux;AUXILIAR;M3;COM CUSTO\nC2;Alv;ALVENARIA;M2;COM CUSTO\nC3;Alv;SEM INSUMO;M2;COM CUSTO\n';
const itens = 'composicao_codigo;tipo_item;item_codigo;descricao_item;unidade_item;coeficiente;situacao\nC1;INSUMO;I1;CIMENTO;KG;300;COM CUSTO\nC1;INSUMO;I3;AREIA;M3;1,5;COM CUSTO\nA1;INSUMO;I2;PEDREIRO;H;2;COM CUSTO\nC2;COMPOSICAO;A1;AUXILIAR;M3;0.5;COM CUSTO\nC2;INSUMO;I1;CIMENTO;KG;10;COM CUSTO\nC3;INSUMO;I4;SEM PRECO;UN;1;COM CUSTO\n';
const precos = 'codigo_insumo;uf;competencia;regime;preco;origem_preco\nI1;TO;2026-10;COM_DESONERACAO;0.50;CR\nI2;TO;2026-10;COM_DESONERACAO;20;CR\nI3;TO;2026-10;COM_DESONERACAO;100;CR\nI4;TO;2026-10;COM_DESONERACAO;;CR\nI1;TO;2026-10;SEM_DESONERACAO;0.40;CR\nI2;TO;2026-10;SEM_DESONERACAO;;CR\nI3;TO;2026-10;SEM_DESONERACAO;90;CR\n';
const custos = 'codigo_composicao;uf;competencia;regime;custo;percentual_atribuido_sp\nC1;TO;2026-10;COM_DESONERACAO;250.00;0.0\nC2;TO;2026-10;COM_DESONERACAO;999.99;0.0\n';
const arquivos = { insumos, composicoes, composicaoItens: itens, precos, custos };

test('csv: campos com ; entre aspas e BOM', () => {
  assert.deepEqual(linhasCsv('﻿a;"b;c";d\n1;2;3'), [['a', 'b;c', 'd'], ['1', '2', '3']]);
  assert.deepEqual(registros('x;y\n1;2')[0], { x: '1', y: '2' });
});

test('regime COM: achata auxiliar, multiplica coeficientes e exclui o que não tem preço', () => {
  const r = converterPacote(arquivos, 'TO', 'COM_DESONERACAO');
  assert.equal(r.insumos, 3); // I4 sem preço fica de fora
  assert.deepEqual(r.excluidas.map((e) => e.codigo), ['C3']);
  assert.match(r.excluidas[0].motivo, /sem preço/);
  assert.equal(r.composicoes, 3); // C1, A1 (auxiliar com preço) e C2
  // C2 = 10 cimento + 0,5 * (2 pedreiros) → 10 de I1 e 1 de I2
  assert.ok(r.csv.includes('componente;C2;;;;;I2;1'));
  assert.ok(r.csv.includes('componente;C2;;;;;I1;10'));
  assert.ok(r.csv.includes('insumo;I1;CIMENTO;KG;0.50;MATERIAL;;'));
});

test('divergência de custo: C1 calcula 300 contra 250 da fonte; C2 calcula 25 contra 999,99', () => {
  const r = converterPacote(arquivos, 'TO', 'COM_DESONERACAO');
  // C2 = 10 cimento (5) + 0,5 auxiliar (0,5 × 2 pedreiros × 20 = 20) = 25
  assert.deepEqual(r.divergencias.map((d) => d.codigo), ['C2', 'C1']); // maior diferença primeiro
  assert.equal(r.divergencias.find((d) => d.codigo === 'C1')!.calculado, 300);
  assert.equal(r.divergencias.find((d) => d.codigo === 'C2')!.calculado, 25);
});

test('regime SEM: insumo sem preço muda a composição excluída', () => {
  const r = converterPacote(arquivos, 'TO', 'SEM_DESONERACAO');
  assert.ok(r.excluidas.some((e) => e.codigo === 'C2' && /I2/.test(e.motivo)));
  assert.ok(r.codigosComposicoes.has('C1'));
});

test('o CSV gerado passa no leitor de tabelas de referência do sistema', () => {
  const r = converterPacote(arquivos, 'TO', 'COM_DESONERACAO');
  const leitura = lerCsvReferencia(r.csv);
  assert.deepEqual(leitura.erros, []);
  assert.equal(leitura.insumos.length, 3);
  assert.equal(leitura.composicoes.length, 3);
  assert.equal(leitura.componentes.length, r.componentes);
});
