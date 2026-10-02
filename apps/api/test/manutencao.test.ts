import { test } from 'node:test';
import assert from 'node:assert/strict';
import { situacaoRevisao } from '../src/lib/manutencao.ts';

const atual = { km: 128430, horas: 6215, hoje: '2026-10-02' };

test('Revisão por km: em dia, próxima e vencida', () => {
  const plano = { intervaloKm: 10000, intervaloHoras: null, intervaloDias: null };
  const emDia = situacaoRevisao(plano, { km: 125000, horas: null, data: null }, atual);
  assert.equal(emDia.situacao, 'em_dia');
  assert.equal(emDia.proximaKm, 135000);
  assert.equal(emDia.faltaKm, 6570);
  assert.equal(situacaoRevisao(plano, { km: 118750, horas: null, data: null }, atual).situacao, 'proxima'); // faltam 320 km
  const venc = situacaoRevisao(plano, { km: 117000, horas: null, data: null }, atual);
  assert.equal(venc.situacao, 'vencida');
  assert.equal(venc.faltaKm, -1430);
});

test('Revisão vence pelo critério que chegar primeiro', () => {
  const plano = { intervaloKm: 15000, intervaloHoras: 500, intervaloDias: 180 };
  // Rodou pouco em km, mas as horas já passaram do intervalo (betoneira parada girando o balão).
  const r = situacaoRevisao(plano, { km: 125000, horas: 5700, data: '2026-08-01' }, atual);
  assert.equal(r.situacao, 'vencida');
  assert.equal(r.faltaHoras, -15);
  assert.equal(r.faltaKm, 11570);
  assert.equal(r.proximaData, '2027-01-28');
});

test('Revisão por data', () => {
  const plano = { intervaloKm: null, intervaloHoras: null, intervaloDias: 7 };
  assert.equal(situacaoRevisao(plano, { km: null, horas: null, data: '2026-09-25' }, atual).situacao, 'vencida');
  const r = situacaoRevisao(plano, { km: null, horas: null, data: '2026-09-28' }, atual);
  assert.equal(r.situacao, 'em_dia');
  assert.equal(r.faltaDias, 3);
});

test('Sem registro da última execução', () => {
  const plano = { intervaloKm: 10000, intervaloHoras: null, intervaloDias: null };
  assert.equal(situacaoRevisao(plano, null, atual).situacao, 'sem_registro');
  // Tem só data, mas o plano é por km: não dá para calcular.
  assert.equal(situacaoRevisao(plano, { km: null, horas: null, data: '2026-09-01' }, atual).situacao, 'sem_registro');
});
