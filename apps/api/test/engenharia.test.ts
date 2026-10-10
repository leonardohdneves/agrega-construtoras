import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bdiCalculado, codigoDoNo, lerCsvReferencia, nivelDoNovoNo, numeroBr } from '../src/lib/engenharia.ts';

test('BDI calculado pela fórmula do TCU', () => {
  // (1+0,0668) x (1+0,0123) x (1+0,074) / (1-0,0665) - 1 = 24,24%
  const bdi = bdiCalculado({ ac: 4, s: 0.8, r: 1.27, g: 0.61, df: 1.23, l: 7.4, i: 6.65 });
  assert.equal(bdi, 24.25);
  assert.equal(bdiCalculado({}), 0);
  assert.equal(bdiCalculado({ l: 10 }), 10);
});

test('níveis da EAP respeitam o nível de apropriação', () => {
  assert.equal(nivelDoNovoNo('obra', null), null, 'obra não usa EAP');
  assert.equal(nivelDoNovoNo('etapa', null), 'etapa');
  assert.equal(nivelDoNovoNo('etapa', 'etapa'), null, 'não passa do nível de apropriação');
  assert.equal(nivelDoNovoNo('subetapa', 'etapa'), 'subetapa');
  assert.equal(nivelDoNovoNo('subetapa', 'subetapa'), null);
  assert.equal(nivelDoNovoNo('tarefa', 'subetapa'), 'tarefa');
  assert.equal(nivelDoNovoNo('tarefa', 'tarefa'), null);
});

test('código hierárquico', () => {
  assert.equal(codigoDoNo(null, 0), '1');
  assert.equal(codigoDoNo(null, 2), '3');
  assert.equal(codigoDoNo('1.2', 0), '1.2.1');
});

test('números em pt-BR e com ponto', () => {
  assert.equal(numeroBr('1.234,56'), 1234.56);
  assert.equal(numeroBr('12,5'), 12.5);
  assert.equal(numeroBr('1234.56'), 1234.56);
  assert.equal(numeroBr(''), null);
  assert.equal(numeroBr('abc'), null);
});

test('CSV de referência: insumos, composições e componentes', () => {
  const csv = [
    'tipo;codigo;descricao;unidade;preco;grupo;insumo;coeficiente',
    'insumo;1;Cimento CP II;kg;"0,85";materiais;;',
    'insumo;2;Pedreiro;h;28,40;mao-de-obra;;',
    'composicao;C1;Alvenaria 1 vez;m2;;alvenaria;;',
    'componente;C1;;;;;1;4,5',
    'componente;C1;;;;;2;0,8',
  ].join('\n').replace('"0,85"', '0,85');
  const r = lerCsvReferencia(csv);
  assert.deepEqual(r.erros, []);
  assert.equal(r.insumos.length, 2);
  assert.equal(r.insumos[0].precoCentavos, 85);
  assert.equal(r.composicoes.length, 1);
  assert.equal(r.componentes.length, 2);
  assert.equal(r.componentes[0].coeficiente, 4.5);
});

test('CSV aponta erros de cabeçalho, linha incompleta e componente órfão', () => {
  assert.match(lerCsvReferencia('a;b').erros[0], /cabeçalho/);
  const r = lerCsvReferencia([
    'tipo;codigo;descricao;unidade;preco;grupo;insumo;coeficiente',
    'insumo;1;;kg;1;;;',
    'insumo;2;Areia;m3;abc;;;',
    'componente;X;;;;;9;1',
  ].join('\n'));
  assert.ok(r.erros.some((e) => /Linha 2: falta a descrição/.test(e)));
  assert.ok(r.erros.some((e) => /Linha 3: preço inválido/.test(e)));
  assert.ok(r.erros.some((e) => /composição X não existe/.test(e)));
  assert.ok(r.erros.some((e) => /insumo 9 não existe/.test(e)));
});
