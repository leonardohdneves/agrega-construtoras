import { test } from 'node:test';
import assert from 'node:assert/strict';
// Funções puras da árvore do planejamento (usadas pela tela): testadas aqui porque não dependem de React.
import { montarLinhas, type Atividade } from '../../web/src/paginas/arvorePlanejamento.ts';

// EAP: 1 (etapa) > 1.1 (subetapa) > 1.1.1 e 1.1.2 (tarefas); 1.2 (tarefa direta da etapa 1)
const nos = [
  { id: 'E1', paiId: null, nivel: 'etapa', codigo: '1', descricao: 'Fundações', itens: 0, subtotal: null },
  { id: 'S1', paiId: 'E1', nivel: 'subetapa', codigo: '1.1', descricao: 'Estacas', itens: 0, subtotal: null },
  { id: 'T1', paiId: 'S1', nivel: 'tarefa', codigo: '1.1.1', descricao: 'Estaca 1', itens: 0, subtotal: null },
  { id: 'T2', paiId: 'S1', nivel: 'tarefa', codigo: '1.1.2', descricao: 'Estaca 2', itens: 0, subtotal: null },
  { id: 'T3', paiId: 'E1', nivel: 'tarefa', codigo: '1.2', descricao: 'Blocos', itens: 0, subtotal: null },
  { id: 'E2', paiId: null, nivel: 'etapa', codigo: '2', descricao: 'Estrutura', itens: 0, subtotal: null },
];

const ativ = (id: string, eapNoId: string | null, inicio: string, fim: string, dur: number): Atividade => ({
  id, ordem: 0, descricao: `Atv ${id}`, eapNoId, eapCodigo: null, eapDescricao: null, inicioInformado: inicio,
  duracaoDias: dur, predecessoraId: null, inicio, fim, resumo: false,
});

const atividades = [
  ativ('a1', 'T1', '2026-05-01', '2026-05-03', 3),
  ativ('a2', 'T2', '2026-05-10', '2026-05-12', 3),
  ativ('a3', 'T3', '2026-05-20', '2026-05-20', 1),
];

test('etapa e subetapa mostram início e fim das tarefas abaixo delas', () => {
  const l = montarLinhas(nos, atividades, new Set());
  const s1 = l.find((x) => x.chave === 'S1')!;
  const e1 = l.find((x) => x.chave === 'E1')!;
  assert.equal(s1.resumo, true);
  assert.equal(s1.inicio, '2026-05-01');
  assert.equal(s1.fim, '2026-05-12');
  assert.equal(e1.inicio, '2026-05-01');
  assert.equal(e1.fim, '2026-05-20');
  assert.equal(e1.dias, 20);
});

test('a ordem segue a EAP e a profundidade mostra o nível', () => {
  const l = montarLinhas(nos, atividades, new Set());
  assert.deepEqual(l.map((x) => x.codigo), ['1', '1.1', '1.1.1', '1.1.2', '1.2', '2']);
  assert.deepEqual(l.map((x) => x.profundidade), [0, 1, 2, 2, 1, 0]);
});

test('etapa recolhida esconde o que está abaixo dela, sem perder as datas', () => {
  const l = montarLinhas(nos, atividades, new Set(['E1']));
  assert.deepEqual(l.map((x) => x.codigo), ['1', '2']);
  assert.equal(l[0].aberta, false);
  assert.equal(l[0].fim, '2026-05-20');
});

test('subetapa recolhida mantém as tarefas da etapa visíveis', () => {
  const l = montarLinhas(nos, atividades, new Set(['S1']));
  assert.deepEqual(l.map((x) => x.codigo), ['1', '1.1', '1.2', '2']);
});

test('tarefa sem atividade aparece sem datas', () => {
  const l = montarLinhas(nos, atividades.slice(0, 2), new Set());
  const t3 = l.find((x) => x.chave === 'T3')!;
  assert.equal(t3.atividade, null);
  assert.equal(t3.inicio, null);
  assert.equal(t3.noId, 'T3');
});

test('atividade sem linha da EAP vai para o fim da lista', () => {
  const l = montarLinhas(nos, [...atividades, ativ('avulsa', null, '2026-06-01', '2026-06-02', 2)], new Set());
  const ultima = l[l.length - 1];
  assert.equal(ultima.atividade?.id, 'avulsa');
  assert.equal(ultima.noId, null);
});

test('atividade lançada direto numa etapa aparece como tarefa dentro dela', () => {
  const comFilho = [...nos, { id: 'T4', paiId: 'E2', nivel: 'tarefa', codigo: '2.1', descricao: 'Pilares', itens: 0, subtotal: null }];
  const l = montarLinhas(comFilho, [ativ('direta', 'E2', '2026-07-01', '2026-07-03', 3)], new Set());
  const i = l.findIndex((x) => x.chave === 'E2');
  assert.equal(l[i + 1].atividade?.id, 'direta');
  assert.equal(l[i + 1].profundidade, 1);
});
