// Aplicação do mapeamento de colunas (dado pela IA) ao arquivo: o código faz a leitura, a IA só indica as colunas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarMapa, mapaRecortado, type MapaColunas } from '../src/lib/ia-sinapi.ts';
import { lerCsvReferencia } from '../src/lib/engenharia.ts';

const mapa: MapaColunas = {
  separador: '|',
  linhaInicial: 2,
  colunas: { tipo: 0, codigo: 1, descricao: 2, unidade: 3, preco: 4, grupo: null, insumo: 5, coeficiente: 6 },
  tipoUnico: null,
  valoresTipo: { insumo: 'INSUMO', composicao: 'COMPOSICAO', componenteInsumo: 'COMPONENTE', componenteComposicao: null },
};

test('converte arquivo com cabeçalho deslocado e tipos próprios', () => {
  const texto = [
    'Relatório de tabela',
    '',
    'TIPO|COD|DESC|UN|VALOR|INS|COEF',
    'INSUMO|1|Cimento CP-II|kg|0,85',
    'COMPOSICAO|2|Concreto simples|m3|400,00',
    'COMPONENTE|2||||1|0,8',
    'OUTRO|9|lixo|x|1',
  ].join('\n');
  const r = aplicarMapa(texto, mapa);
  assert.equal(r.ignoradas, 1);
  const leitura = lerCsvReferencia(r.csv);
  assert.deepEqual(leitura.erros, []);
  assert.equal(leitura.insumos.length, 1);
  assert.equal(leitura.composicoes.length, 1);
  assert.deepEqual(leitura.componentes, [{ composicao: '2', insumo: '1', coeficiente: 0.8 }]);
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
});

// SINAPI analítico: linha da composição com "Tipo Item" vazio; itens INSUMO ou COMPOSICAO (auxiliar).
const analitico: MapaColunas = {
  separador: ';',
  linhaInicial: 1,
  colunas: { tipo: 2, codigo: 1, descricao: 4, unidade: 5, preco: null, grupo: 0, insumo: 3, coeficiente: 6 },
  tipoUnico: null,
  valoresTipo: { insumo: null, composicao: '', componenteInsumo: 'INSUMO', componenteComposicao: ['COMPOSICAO', 'COMPOSIÇÃO'] },
};
const textoAnalitico = [
  'Grupo;Código da Composição;Tipo Item;Código do Item;Descrição;Unidade;Coeficiente',
  'ARGAMASSAS;100;;;ARGAMASSA TRAÇO 1:3;M3;',
  'ARGAMASSAS;100;INSUMO;1;CIMENTO;KG;400',
  'ARGAMASSAS;100;INSUMO;2;AREIA;M3;1,2',
  'ALVENARIA;200;;;ALVENARIA DE BLOCO;M2;',
  'ALVENARIA;200;INSUMO;3;BLOCO;UN;12,5',
  'ALVENARIA;200;COMPOSICAO;100;ARGAMASSA TRAÇO 1:3;M3;0,01',
  'ALVENARIA;200;INSUMO;999;ITEM QUE NÃO EXISTE;UN;1',
].join('\n');

test('analítico importado na tabela dos insumos: composição auxiliar é achatada em insumos', () => {
  const externos = { insumos: new Set(['1', '2', '3']), composicoes: new Map() };
  const r = aplicarMapa(textoAnalitico, analitico, externos);
  assert.equal(r.auxiliaresAchatadas, 1);
  assert.equal(r.componentesDescartados, 1);
  const leitura = lerCsvReferencia(r.csv, externos.insumos);
  assert.deepEqual(leitura.erros, []);
  assert.equal(leitura.composicoes.length, 2);
  const de200 = Object.fromEntries(leitura.componentes.filter((k) => k.composicao === '200').map((k) => [k.insumo, k.coeficiente]));
  assert.deepEqual(de200, { '3': 12.5, '1': 4, '2': 0.012 });
});

test('analítico sem os insumos: composições ficam sem insumos e o resumo avisa', () => {
  const r = aplicarMapa(textoAnalitico, analitico);
  assert.equal(r.composicoesSemInsumos, 2);
  assert.deepEqual(lerCsvReferencia(r.csv).erros, []);
});

test('texto recortado pelo navegador usa as colunas na ordem padrão', () => {
  const texto = ['composicao;10;Serviço;m2;;G;;', 'item;10;;;;;5;2'].join('\n');
  const r = aplicarMapa(texto, mapaRecortado(null, { insumo: null, composicao: 'composicao', componenteInsumo: 'item', componenteComposicao: null }), {
    insumos: new Set(['5']),
    composicoes: new Map(),
  });
  assert.equal(r.componentesDescartados, 0);
  assert.match(r.csv, /componente;10;;;;;5;2/);
});
