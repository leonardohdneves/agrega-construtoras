// Suprimentos com o app de verdade e banco (rode com `npm run test:banco -w apps/api`).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepararAppTeste, semBanco, type ContextoTeste } from './apoio/app-teste.ts';

let ctx: ContextoTeste;
before(async () => {
  if (!semBanco) ctx = await prepararAppTeste('teste_suprimentos_rotas');
});
after(async () => {
  if (ctx) await ctx.fechar();
});

/** Obra nova e um insumo cadastrado na planilha dela. */
async function obraComInsumo(codigo: string, nivelApropriacao: 'obra' | 'etapa') {
  const r = await ctx.pedir('dono', 'POST', '/api/eng/obras', { corpo: { codigo, nome: `Obra ${codigo}`, nivelApropriacao } });
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  const obraId = r.corpo.obra.id as string;
  const item = await ctx.banco.query(
    `INSERT INTO obra_itens (obra_id, tipo, codigo, descricao, unidade, preco_centavos) VALUES ($1, 'insumo', 'I-01', 'Cimento CP II', 'sc', 3500) RETURNING id`,
    [obraId],
  );
  return { obraId, obraItemId: item.rows[0].id as string };
}

test('P30: solicitação de material em obra apropriada no nível da obra', { skip: semBanco }, async () => {
  const { obraId, obraItemId } = await obraComInsumo('NV-OBRA', 'obra');
  const r = await ctx.pedir('dono', 'POST', '/api/sup/solicitacoes', { corpo: { obraId, itens: [{ obraItemId, eapNoId: null, quantidade: 10 }] } });
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  assert.equal(r.corpo.solicitacao.itens.length, 1);
});

test('P30: obra apropriada por etapa continua exigindo o nó da EAP', { skip: semBanco }, async () => {
  const { obraId, obraItemId } = await obraComInsumo('NV-ETAPA', 'etapa');
  const r = await ctx.pedir('dono', 'POST', '/api/sup/solicitacoes', { corpo: { obraId, itens: [{ obraItemId, eapNoId: null, quantidade: 10 }] } });
  assert.equal(r.status, 400);
});

test('P08: filtro de solicitações por status "finalizada"', { skip: semBanco }, async () => {
  const { obraId, obraItemId } = await obraComInsumo('FILTRO', 'obra');
  const nova = async () => (await ctx.pedir('dono', 'POST', '/api/sup/solicitacoes', { corpo: { obraId, itens: [{ obraItemId, eapNoId: null, quantidade: 1 }] } })).corpo.solicitacao.id as string;
  const aberta = await nova();
  const finalizada = await nova();
  await ctx.banco.query("UPDATE solicitacoes_compra SET status = 'finalizada', finalizada_em = now() WHERE id = $1", [finalizada]);
  const ids = async (status: string) => (await ctx.pedir('dono', 'GET', `/api/sup/solicitacoes?status=${status}&obraId=${obraId}`)).corpo.solicitacoes.map((s: { id: string }) => s.id);
  assert.deepEqual(await ids('finalizada'), [finalizada]);
  assert.deepEqual(await ids('aberta'), [aberta]);
});

test('P09: transferência entre estoques aceita "1.000" (mil) e "2,5"', { skip: semBanco }, async () => {
  const { obraId, obraItemId } = await obraComInsumo('TRANSF', 'etapa');
  const um = async (sql: string, p: unknown[]) => (await ctx.banco.query(sql, p)).rows[0].id as string;
  const etapa = await um(`INSERT INTO eap_nos (obra_id, nivel, codigo, descricao) VALUES ($1, 'etapa', '1', 'Estrutura') RETURNING id`, [obraId]);
  const estoque = (nome: string, codigo: string) =>
    um('INSERT INTO obra_estoques (empresa_id, obra_id, nome, codigo) VALUES ($1, $2, $3, $4) RETURNING id', [ctx.empresas.a, obraId, nome, codigo]);
  const origem = await estoque('Almoxarifado central', 'EST-9001');
  const destino = await estoque('Frente de serviço', 'EST-9002');
  await ctx.banco.query(
    `INSERT INTO estoque_movimentos (empresa_id, obra_id, obra_estoque_id, obra_item_id, eap_no_id, data, tipo, quantidade) VALUES ($1, $2, $3, $4, $5, '2026-11-01', 'entrada', 2000)`,
    [ctx.empresas.a, obraId, origem, obraItemId, etapa],
  );
  const transferir = (quantidade: string) =>
    ctx.pedir('dono', 'POST', '/api/sup/estoque/transferencias', { corpo: { obraId, obraItemId, eapNoId: etapa, origemId: origem, destinoId: destino, data: '2026-11-18', quantidade } });
  assert.equal((await transferir('1.000')).status, 201);
  assert.equal((await transferir('2,5')).status, 201);
  const saldo = async (estoqueId: string) =>
    Number((await ctx.banco.query(`SELECT sum(CASE WHEN tipo = 'saida' THEN -quantidade ELSE quantidade END) AS s FROM estoque_movimentos WHERE obra_estoque_id = $1`, [estoqueId])).rows[0].s);
  assert.equal(await saldo(destino), 1002.5);
  assert.equal(await saldo(origem), 997.5);
});
