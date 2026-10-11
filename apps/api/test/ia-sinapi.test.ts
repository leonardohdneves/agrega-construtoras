// Aplicação do mapeamento de colunas (dado pela IA) ao arquivo: o código faz a leitura, a IA só indica as colunas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarMapa, type MapaColunas } from '../src/lib/ia-sinapi.ts';
import { lerCsvReferencia } from '../src/lib/engenharia.ts';

const mapa: MapaColunas = {
  separador: '|',
  linhaInicial: 2,
  colunas: { tipo: 0, codigo: 1, descricao: 2, unidade: 3, preco: 4, grupo: null, insumo: 5, coeficiente: 6 },
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
