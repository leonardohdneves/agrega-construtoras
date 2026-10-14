import { test } from 'node:test';
import assert from 'node:assert/strict';
import { datasComResumos, resumosDaEap } from '../src/lib/engenharia.ts';

// EAP: etapa E1 > subetapa S1 > tarefas T1, T2; etapa E2 > tarefa T3
const nos = [
  { id: 'E1', paiId: null }, { id: 'S1', paiId: 'E1' }, { id: 'T1', paiId: 'S1' }, { id: 'T2', paiId: 'S1' },
  { id: 'E2', paiId: null }, { id: 'T3', paiId: 'E2' },
];

test('resumo da etapa e da subetapa usa início e fim das tarefas abaixo', () => {
  const atividades = [
    { id: 'a-E1', eapNoId: 'E1' }, { id: 'a-S1', eapNoId: 'S1' }, { id: 'a-T1', eapNoId: 'T1' }, { id: 'a-T2', eapNoId: 'T2' }, { id: 'a-T3', eapNoId: 'T3' },
  ];
  const brutas = new Map([
    ['a-E1', { inicio: '2026-01-01', fim: '2026-01-02' }],
    ['a-S1', { inicio: '2026-01-01', fim: '2026-01-02' }],
    ['a-T1', { inicio: '2026-01-05', fim: '2026-01-10' }],
    ['a-T2', { inicio: '2026-01-12', fim: '2026-01-20' }],
    ['a-T3', { inicio: '2026-02-01', fim: '2026-02-03' }],
  ]);
  const d = datasComResumos(brutas, atividades, nos);
  assert.deepEqual(d.get('a-S1'), { inicio: '2026-01-05', fim: '2026-01-20' });
  assert.deepEqual(d.get('a-E1'), { inicio: '2026-01-05', fim: '2026-01-20' });
  assert.deepEqual(d.get('a-T1'), brutas.get('a-T1'));
  assert.deepEqual(d.get('a-T3'), brutas.get('a-T3'));
});

test('resumo sem tarefas com atividade mantém as próprias datas', () => {
  const d = datasComResumos(new Map([['a-E2', { inicio: '2026-03-01', fim: '2026-03-02' }]]), [{ id: 'a-E2', eapNoId: 'E2' }], nos);
  assert.deepEqual(d.get('a-E2'), { inicio: '2026-03-01', fim: '2026-03-02' });
});

test('resumosDaEap identifica etapas e subetapas (nós com filhos)', () => {
  assert.deepEqual([...resumosDaEap(nos)].sort(), ['E1', 'E2', 'S1']);
});
