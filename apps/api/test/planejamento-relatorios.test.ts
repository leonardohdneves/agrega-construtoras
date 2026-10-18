import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarCompras, montarEquipes, montarGantt, periodosDoIntervalo } from '../src/lib/planejamento-relatorios.ts';

test('quinzenas seguem o calendário (1 a 15 e 16 até o fim do mês)', () => {
  const p = periodosDoIntervalo('2026-02-10', '2026-03-03', 'quinzena');
  assert.deepEqual(
    p.map((x) => [x.inicio, x.fim, x.dias]),
    [
      ['2026-02-10', '2026-02-15', 6],
      ['2026-02-16', '2026-02-28', 13],
      ['2026-03-01', '2026-03-03', 3],
    ],
  );
});

test('meses são cortados no início e no fim do intervalo', () => {
  const p = periodosDoIntervalo('2026-01-20', '2026-03-05', 'mes');
  assert.deepEqual(p.map((x) => [x.rotulo, x.dias]), [['01/2026', 12], ['02/2026', 28], ['03/2026', 5]]);
});

test('semanas partem do início do projeto e o último bloco é cortado', () => {
  const p = periodosDoIntervalo('2026-05-04', '2026-05-16', 'semana');
  assert.deepEqual(p.map((x) => [x.inicio, x.fim, x.dias]), [['2026-05-04', '2026-05-10', 7], ['2026-05-11', '2026-05-16', 6]]);
});

test('gantt calcula o intervalo do projeto e o deslocamento de cada barra', () => {
  const g = montarGantt(
    [
      { id: 'a', descricao: 'A', eapCodigo: '1', inicio: '2026-06-01', fim: '2026-06-05', duracaoDias: 5, predecessoraId: null },
      { id: 'b', descricao: 'B', eapCodigo: '2', inicio: '2026-06-08', fim: '2026-06-10', duracaoDias: 3, predecessoraId: 'a' },
    ],
    'dia',
  );
  assert.equal(g.totalDias, 10);
  assert.equal(g.atividades[1].deslocamentoDias, 7);
});

test('equipes: trabalhadores por dia = horas ÷ duração ÷ horas por dia, com pico arredondado para cima', () => {
  // 80 h de servente em 5 dias com jornada de 8 h = 2 serventes por dia.
  const e = montarEquipes(
    [{ id: 'a', descricao: 'Alvenaria', inicio: '2026-06-01', duracaoDias: 5, recursos: [{ codigo: '6111', descricao: 'SERVENTE', horas: 80 }] }],
    8,
    'semana',
  );
  assert.equal(e.porTipo[0].pico, 2);
  assert.equal(e.porAtividade[0].recursos[0].trabalhadores, 2);
});

test('equipes: atividades sobrepostas somam o mesmo tipo de mão de obra', () => {
  const e = montarEquipes(
    [
      { id: 'a', descricao: 'A', inicio: '2026-06-01', duracaoDias: 2, recursos: [{ codigo: '6111', descricao: 'SERVENTE', horas: 16 }] },
      { id: 'b', descricao: 'B', inicio: '2026-06-02', duracaoDias: 2, recursos: [{ codigo: '6111', descricao: 'SERVENTE', horas: 16 }] },
    ],
    8,
    'dia',
  );
  // Em 02/06 as duas atividades estão ativas: 1 + 1 = 2 serventes.
  assert.equal(e.porTipo[0].pico, 2);
});

test('compras: não inclui mão de obra, equipamento nem terceirizados, e agrupa por insumo', () => {
  const c = montarCompras([
    {
      id: 'a', descricao: 'Radier', inicio: '2026-06-10',
      insumos: [
        { codigo: 'C1', descricao: 'CIMENTO', unidade: 'kg', grupo: 'Material', quantidade: 100 },
        { codigo: 'M1', descricao: 'PEDREIRO', unidade: 'h', grupo: 'Mao_obra', quantidade: 40 },
        { codigo: 'E1', descricao: 'BETONEIRA', unidade: 'h', grupo: 'Equipamento', quantidade: 8 },
      ],
    },
    {
      id: 'b', descricao: 'Contrapiso', inicio: '2026-06-20',
      insumos: [{ codigo: 'C1', descricao: 'CIMENTO', unidade: 'kg', grupo: 'Material', quantidade: 50 }],
    },
  ]);
  assert.equal(c.length, 1);
  assert.equal(c[0].total, 150);
  assert.equal(c[0].primeira, '2026-06-10');
});

test('equipes: etapas e subetapas totalizam as atividades subordinadas, na ordem da EAP', () => {
  const e = montarEquipes(
    [
      // Atividades lançadas antes das etapas (como acontece quando a EAP é gerada depois).
      { id: 't1', descricao: 'Fôrma', eapCodigo: '1.1.1', inicio: '2026-05-18', duracaoDias: 2, recursos: [{ codigo: 'CARP', descricao: 'CARPINTEIRO', horas: 32 }] },
      { id: 't2', descricao: 'Armação', eapCodigo: '1.1.2', inicio: '2026-05-19', duracaoDias: 2, recursos: [{ codigo: 'CARP', descricao: 'CARPINTEIRO', horas: 16 }, { codigo: 'ARM', descricao: 'ARMADOR', horas: 16 }] },
      { id: 't3', descricao: 'Pintura', eapCodigo: '1.2.1', inicio: '2026-05-25', duracaoDias: 1, recursos: [] },
      { id: 'e1', descricao: 'OBRA', eapCodigo: '1', resumo: true, inicio: '2026-05-18', fim: '2026-05-25', duracaoDias: 1, recursos: [] },
      { id: 's1', descricao: 'FUNDAÇÕES', eapCodigo: '1.1', resumo: true, inicio: '2026-05-18', fim: '2026-05-20', duracaoDias: 1, recursos: [] },
      { id: 's2', descricao: 'ACABAMENTO', eapCodigo: '1.2', resumo: true, inicio: '2026-05-25', fim: '2026-05-25', duracaoDias: 1, recursos: [] },
    ],
    8,
    'semana',
  );
  assert.deepEqual(e.porAtividade.map((a) => a.id), ['e1', 's1', 't1', 't2', 's2', 't3']);
  const fund = e.porAtividade.find((a) => a.id === 's1')!;
  assert.equal(fund.resumo, true);
  assert.equal(fund.duracaoDias, 3);
  assert.equal(fund.fim, '2026-05-20');
  // Carpinteiro: 2/dia na fôrma (18 e 19) + 1/dia na armação (19 e 20) → pico 3 no dia 19; horas somadas 48.
  const carp = fund.recursos.find((r) => r.codigo === 'CARP')!;
  assert.equal(carp.trabalhadores, 3);
  assert.equal(carp.horas, 48);
  assert.equal(fund.recursos.find((r) => r.codigo === 'ARM')!.trabalhadores, 1);
  assert.equal(e.porAtividade.find((a) => a.id === 'e1')!.recursos.find((r) => r.codigo === 'CARP')!.horas, 48);
  assert.equal(e.porAtividade.find((a) => a.id === 's2')!.recursos.length, 0);
  // Os totais por tipo não mudam: etapas não somam carga em dobro.
  assert.equal(e.porTipo.find((t) => t.codigo === 'CARP')!.pico, 3);
});
