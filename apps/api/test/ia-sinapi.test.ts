// Aplicação do mapeamento de colunas (dado pela IA) ao arquivo: o código faz a leitura, a IA só indica as colunas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarMapa, type MapaColunas } from '../src/lib/ia-sinapi.ts';
import { lerCsvReferencia } from '../src/lib/engenharia.ts';

const mapa: MapaColunas = {
  separador: '|',
  linhaInicial: 2,
  colunas: { tipo: 0, codigo: 1, descricao: 2, unidade: 3, preco: 4, grupo: null, insumo: 5, coeficiente: 6 },
  tipoUnico: null,
  valoresTipo: { insumo: 'INSUMO', composicao: 'COMPOSICAO', componente: 'COMPONENTE' },
};

test('converte arquivo com cabeçalho deslocado e tipos em outro idioma', () => {
  const texto = [
    'Relatório de tabela',
    '',
    'TIPO|COD|DESC|UN|VALOR|X|INS|COEF',
    'INSUMO|1|Cimento CP-II|kg|0,85',
    'COMPOSICAO|2|Concreto simples|m3|400,00',
    'COMPONENTE|2|Concreto simples|m3||1|0,8',
    'OUTRO|9|lixo|x|1',
  ].join('\n');
  const r = aplicarMapa(texto, mapa);
  assert.equal(r.ignoradas, 1);
  const leitura = lerCsvReferencia(r.csv);
  assert.deepEqual(leitura.erros, []);
  assert.equal(leitura.insumos.length, 1);
  assert.equal(leitura.composicoes.length, 1);
  assert.equal(leitura.componentes.length, 1);
});

test('descrição com ponto e vírgula não quebra as colunas', () => {
  const texto = ['TIPO|COD|DESC|UN|VALOR', 'INSUMO|1|Tinta; fosca|l|10'].join('\n');
  const r = aplicarMapa(texto, { ...mapa, linhaInicial: 1 });
  assert.equal(lerCsvReferencia(r.csv).erros.length, 0);
});

test('planilha da Caixa só de insumos: sem coluna de tipo, preço da coluna da UF', () => {
  const texto = [
    'SINAPI - Relatório de Insumos',
    'Mês de referência: 09/2026',
    'Classificação;Código do Insumo;Descrição do Insumo;Unidade;Origem de Preço;AC;TO',
    'MATERIAL;1;CIMENTO PORTLAND CP II-32  SACO 50KG;KG;CR;0.85;0.9123456789',
    'MATERIAL;2;AREIA MEDIA;M3;C;120;135.5',
    ';3;SEM PRECO;UN',
    'Total de insumos: 3',
  ].join('\n');
  const r = aplicarMapa(texto, {
    separador: ';',
    linhaInicial: 3,
    colunas: { tipo: null, codigo: 1, descricao: 2, unidade: 3, preco: 6, grupo: 0, insumo: null, coeficiente: null },
    tipoUnico: 'insumo',
    valoresTipo: null,
  });
  assert.equal(r.semPreco, 1);
  assert.equal(r.ignoradas, 1);
  const leitura = lerCsvReferencia(r.csv);
  assert.deepEqual(leitura.erros, []);
  assert.equal(leitura.insumos.length, 2);
  assert.equal(leitura.insumos[0].precoCentavos, 91);
  assert.equal(leitura.insumos[1].precoCentavos, 13550);
  assert.equal(leitura.insumos[0].grupo, 'MATERIAL');
});

test('componente que aponta para insumo fora do arquivo é descartado, não derruba a importação', () => {
  const texto = [
    'TIPO|COD|DESC|UN|VALOR|X|INS|COEF',
    'INSUMO|1|Cimento|kg|0,85',
    'COMPOSICAO|2|Concreto|m3|',
    'COMPONENTE|2||||1|0,8',
    'COMPONENTE|2||||99|1',
  ].join('\n');
  const r = aplicarMapa(texto, { ...mapa, linhaInicial: 1 });
  assert.equal(r.componentesDescartados, 1);
  const leitura = lerCsvReferencia(r.csv);
  assert.deepEqual(leitura.erros, []);
  assert.equal(leitura.componentes.length, 1);
});
