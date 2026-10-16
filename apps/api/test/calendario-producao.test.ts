import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarCalendario, montarCompras } from '../src/lib/planejamento-relatorios.ts';

test('calendário marca início, continuação e término de cada atividade', () => {
  const cal = montarCalendario(
    [{ id: 'a', descricao: 'Forma', eapCodigo: '1.1.1', inicio: '2026-05-04', fim: '2026-05-07' }],
    'semana',
  );
  assert.equal(cal.blocos.length, 1);
  const linha = cal.blocos[0].linhas[0];
  assert.deepEqual(linha.marcas, {
    '2026-05-04': 'inicio', '2026-05-05': 'continua', '2026-05-06': 'continua', '2026-05-07': 'fim',
  });
});

test('atividade de um único dia recebe a marca de início e término', () => {
  const cal = montarCalendario([{ id: 'a', descricao: 'Limpeza', eapCodigo: '1.1', inicio: '2026-05-04', fim: '2026-05-04' }], 'dia');
  assert.deepEqual(cal.blocos[0].linhas[0].marcas, { '2026-05-04': 'unico' });
});

test('períodos sem atividade não aparecem e a atividade entra só nos períodos em que roda', () => {
  const cal = montarCalendario(
    [
      { id: 'a', descricao: 'A', eapCodigo: null, inicio: '2026-05-01', fim: '2026-05-03' },
      { id: 'b', descricao: 'B', eapCodigo: null, inicio: '2026-06-10', fim: '2026-06-11' },
    ],
    'mes',
  );
  assert.deepEqual(cal.blocos.map((b) => b.rotulo), ['05/2026', '06/2026']);
  assert.deepEqual(cal.blocos[0].linhas.map((l) => l.id), ['a']);
  assert.deepEqual(cal.blocos[1].linhas.map((l) => l.id), ['b']);
});

test('quinzena separa o dia 15 do dia 16 e cada bloco tem só os dias dele', () => {
  const cal = montarCalendario([{ id: 'a', descricao: 'A', eapCodigo: null, inicio: '2026-05-14', fim: '2026-05-17' }], 'quinzena');
  assert.deepEqual(cal.blocos.map((b) => b.rotulo), ['1ª quinz. 05/2026', '2ª quinz. 05/2026']);
  assert.deepEqual(cal.blocos[0].dias, ['2026-05-14', '2026-05-15']);
  assert.deepEqual(cal.blocos[1].dias, ['2026-05-16', '2026-05-17']);
  assert.equal(cal.blocos[1].linhas[0].marcas['2026-05-16'], 'continua');
  assert.equal(cal.blocos[1].linhas[0].marcas['2026-05-17'], 'fim');
});

test('sem atividades, o calendário fica vazio', () => {
  assert.deepEqual(montarCalendario([], 'semana'), { inicio: null, fim: null, blocos: [] });
});

const atividades = [
  {
    id: 'a1', descricao: 'Concreto', inicio: '2026-05-01',
    insumos: [
      { codigo: 'M1', descricao: 'Cimento', unidade: 'kg', grupo: 'Material', quantidade: 50 },
      { codigo: 'E1', descricao: 'Betoneira', unidade: 'h', grupo: 'Equipamento', quantidade: 8 },
      { codigo: 'H1', descricao: 'Pedreiro', unidade: 'h', grupo: 'Mao_obra', quantidade: 16 },
      { codigo: 'S1', descricao: 'Frete', unidade: 'un', grupo: 'Terceirizados', quantidade: 1 },
    ],
  },
];

test('materiais: só insumos da classe Material', () => {
  assert.deepEqual(montarCompras(atividades, 'Material').map((i) => i.codigo), ['M1']);
});

test('equipamentos: só insumos da classe Equipamento', () => {
  assert.deepEqual(montarCompras(atividades, 'Equipamento').map((i) => i.codigo), ['E1']);
});

test('sem classe, a compra continua deixando de fora mão de obra, equipamento e terceirizados', () => {
  assert.deepEqual(montarCompras(atividades).map((i) => i.codigo), ['M1']);
});
