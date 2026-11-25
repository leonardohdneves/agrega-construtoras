// Regra de custo da Caixa nas tabelas SINAPI (cada linha truncada ao centavo, auxiliares pelo custo já calculado) e
// cálculo exato nas tabelas próprias, na tabela e na obra. Com SINAPI_CSV, confere o SINAPI inteiro contra o oficial.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepararAppTeste, semBanco, type ContextoTeste } from './apoio/app-teste.ts';

let ctx: ContextoTeste;
before(async () => {
  if (!semBanco) ctx = await prepararAppTeste('teste_custo_regra_sinapi');
});
after(async () => {
  if (ctx) await ctx.fechar();
});

// Insumos A (3,33) e B (7,77); serviço AUX = 1 × A; serviço P = 0,3333 × AUX + 0,0017 × B.
// Caixa: AUX = 3,33; linhas de P: 3,33 × 0,3333 = 1,109889 → 1,10 e 7,77 × 0,0017 = 0,013209 → 0,01; P = 1,11.
// Exato: 1,109889 + 0,013209 = 1,123098 → 1,12.
const CSV = [
  'tipo;codigo;descricao;unidade;preco;grupo;insumo;coeficiente',
  'insumo;A;INSUMO A;KG;3.33;MATERIAL;;',
  'insumo;B;INSUMO B;KG;7.77;MATERIAL;;',
  'composicao;AUX;SERVICO AUXILIAR;M3;;Teste;;',
  'componente;AUX;;;;;A;1',
  'item_insumo;AUX;;;;;A;1',
  'composicao;P;SERVICO P;M2;;Teste;;',
  'componente;P;;;;;A;0.3333',
  'componente;P;;;;;B;0.0017',
  'item_composicao;P;;;;;AUX;0.3333',
  'item_insumo;P;;;;;B;0.0017',
].join('\n');

async function tabela(fonte: 'sinapi' | 'proprio', nome: string) {
  const r = await ctx.pedir('dono', 'POST', '/api/eng/tabelas', { corpo: { fonte, nome, uf: fonte === 'sinapi' ? 'TO' : null, mesReferencia: fonte === 'sinapi' ? '2026-09' : null, desonerado: fonte === 'sinapi', csv: CSV } });
  assert.equal(r.status, 201, JSON.stringify(r.corpo).slice(0, 300));
  return r.corpo.tabela.id as string;
}
const preco = async (t: string, cod: string) => {
  const l = await ctx.pedir('dono', 'GET', `/api/eng/tabelas/${t}/itens?tipo=composicao`);
  return l.corpo.itens.find((i: { codigo: string }) => i.codigo === cod).preco as number;
};

test('tabela SINAPI: custo pela regra da Caixa (linha truncada, auxiliar pelo custo calculado)', { skip: semBanco }, async () => {
  const t = await tabela('sinapi', 'SINAPI regra');
  assert.equal(await preco(t, 'AUX'), 3.33);
  assert.equal(await preco(t, 'P'), 1.11);
});

test('tabela própria: custo exato, sem truncar', { skip: semBanco }, async () => {
  const t = await tabela('proprio', 'Própria exata');
  assert.equal(await preco(t, 'P'), 1.12);
});

test('obra: o serviço SINAPI chega com o mesmo custo e acompanha o preço do insumo; editar volta ao exato', { skip: semBanco }, async () => {
  const t = await tabela('sinapi', 'SINAPI obra');
  const lista = await ctx.pedir('dono', 'GET', `/api/eng/tabelas/${t}/itens?tipo=composicao`);
  const p = lista.corpo.itens.find((i: { codigo: string }) => i.codigo === 'P').id as string;
  const obra = (await ctx.pedir('dono', 'POST', '/api/eng/obras', { corpo: { codigo: 'OB-REGRA', nome: 'Obra da regra' } })).corpo.obra.id as string;
  const imp = await ctx.pedir('dono', 'POST', `/api/eng/obras/${obra}/importar`, { corpo: { tabelaId: t, composicaoIds: [p] } });
  assert.equal(imp.status, 200, JSON.stringify(imp.corpo));
  const itens = async () => (await ctx.pedir('dono', 'GET', `/api/eng/obras/${obra}/itens`)).corpo.itens as { id: string; tipo: string; codigo: string; preco: number | null }[];
  let todos = await itens();
  assert.ok(todos.some((i) => i.codigo === 'AUX' && i.tipo === 'composicao'), 'o serviço auxiliar vem junto');
  assert.equal(todos.find((i) => i.codigo === 'P')!.preco, 1.11);

  // O preço do insumo A na obra sobe para 4,00: AUX = 4,00; P = trunc(4,00 × 0,3333 = 1,3332) 1,33 + 0,01 = 1,34.
  const a = todos.find((i) => i.codigo === 'A')!;
  const mudou = await ctx.pedir('dono', 'PATCH', `/api/eng/obras/${obra}/itens/${a.id}`, { corpo: { preco: 4 } });
  assert.equal(mudou.status, 200, JSON.stringify(mudou.corpo));
  todos = await itens();
  assert.equal(todos.find((i) => i.codigo === 'AUX')!.preco, 4);
  assert.equal(todos.find((i) => i.codigo === 'P')!.preco, 1.34);

  // Editar a composição na obra: passa a somar exato (A 4,00 × 0,3333 + B 7,77 × 0,0017 = 1,3332 + 0,013209 = 1,346409 → 1,35).
  const b = todos.find((i) => i.codigo === 'B')!;
  const pItem = todos.find((i) => i.codigo === 'P')!;
  const ed = await ctx.pedir('dono', 'PUT', `/api/eng/obras/${obra}/itens/${pItem.id}/composicao`, { corpo: { componentes: [{ insumoId: a.id, coeficiente: 0.3333 }, { insumoId: b.id, coeficiente: 0.0017 }] } });
  assert.equal(ed.status, 200, JSON.stringify(ed.corpo));
  todos = await itens();
  assert.equal(todos.find((i) => i.codigo === 'P')!.preco, 1.35);
});
