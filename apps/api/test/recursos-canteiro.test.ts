// Recursos do canteiro (horizontal, vertical e centrais) e funções do canteiro vertical (ciclo de laje, agenda e
// concreto por andar). Funções puras, sem banco.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recursoDaRotaCanteiro, recursosEfetivos } from '../src/lib/recursos.ts';
import { conflitoAgenda, resumirCiclo, totalConcreto } from '../src/lib/canteiro-vertical.ts';

test('recursos: o canteiro vertical traz a base e as centrais', () => {
  assert.deepEqual(recursosEfetivos(['canteiro_vertical']), ['canteiro_horizontal', 'canteiro_vertical', 'centrais']);
  assert.deepEqual(recursosEfetivos(['centrais']), ['centrais']);
  assert.deepEqual(recursosEfetivos(null), []);
});

test('recursos: cada rota do canteiro pede o recurso certo', () => {
  const base = '/api/eng/obras/abc/canteiro';
  assert.equal(recursoDaRotaCanteiro(base), 'canteiro_horizontal');
  assert.equal(recursoDaRotaCanteiro(`${base}/centrais/argamassa`), 'centrais');
  assert.equal(recursoDaRotaCanteiro(`${base}/boletins/123`), 'centrais');
  assert.equal(recursoDaRotaCanteiro(`${base}/vertical/agenda`), 'canteiro_vertical');
  assert.equal(recursoDaRotaCanteiro('/api/eng/obras/abc/itens'), null);
});

test('ciclo: dias de cada etapa e dias corridos do ciclo inteiro, na ordem das etapas', () => {
  const r = resumirCiclo([
    { etapa: 'cura', inicio: '2026-11-07', fim: '2026-11-09' },
    { etapa: 'formas', inicio: '2026-11-02', fim: '2026-11-04' },
    { etapa: 'concretagem', inicio: '2026-11-07', fim: '2026-11-07' },
  ]);
  assert.deepEqual(
    r.etapas.map((e) => [e.etapa, e.dias]),
    [
      ['formas', 3],
      ['concretagem', 1],
      ['cura', 3],
    ],
  );
  assert.equal(r.diasCiclo, 8);
});

test('ciclo: sem etapas, não há dias de ciclo', () => {
  assert.deepEqual(resumirCiclo([]), { etapas: [], diasCiclo: null });
});

test('agenda: horários que se cruzam no mesmo equipamento e dia são conflito', () => {
  const existentes = [{ id: '1', equipamento: 'guincho', data: '2026-11-24', inicio: '07:00', fim: '11:00' }];
  const novo = (equipamento: string, inicio: string, fim: string) => ({ equipamento, data: '2026-11-24', inicio, fim });
  assert.equal(conflitoAgenda(novo('guincho', '10:00', '12:00'), existentes)?.id, '1');
  assert.equal(conflitoAgenda(novo('guincho', '11:00', '12:00'), existentes), null, 'fim igual ao início não é conflito');
  assert.equal(conflitoAgenda(novo('grua', '08:00', '09:00'), existentes), null, 'outro equipamento está livre');
  assert.equal(conflitoAgenda({ equipamento: 'guincho', data: '2026-11-25', inicio: '08:00', fim: '09:00' }, existentes), null, 'outro dia está livre');
});

test('concreto: soma por andar com duas casas decimais', () => {
  assert.equal(totalConcreto([12.5, 8.25]), 20.75);
  assert.equal(totalConcreto([]), 0);
  assert.equal(totalConcreto([0.1, 0.2]), 0.3);
});
