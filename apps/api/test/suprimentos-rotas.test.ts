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

test('P10: gestor e comprador salvam o fator na nota em rascunho; nota confirmada fica bloqueada', { skip: semBanco }, async () => {
  const um = async (sql: string, p: unknown[]) => (await ctx.banco.query(sql, p)).rows[0].id as string;
  const nota = (status: string) =>
    um(`INSERT INTO notas_fiscais (empresa_id, data_emissao, competencia, status) VALUES ($1, '2026-11-10', '2026-11-10', $2) RETURNING id`, [ctx.empresas.a, status]);
  const item = (notaId: string) =>
    um(`INSERT INTO notas_itens (empresa_id, nota_id, numero_item, descricao, unidade, quantidade) VALUES ($1, $2, 1, 'Cimento', 'sc', 10) RETURNING id`, [ctx.empresas.a, notaId]);
  const rascunho = await item(await nota('rascunho'));
  const confirmada = await item(await nota('confirmada'));
  for (const perfil of ['gestor', 'comprador'] as const) {
    const r = await ctx.pedir(perfil, 'PATCH', `/api/sup/conferencia-unidades/${rascunho}`, { corpo: { fatorEstoque: '2,5' } });
    assert.equal(r.status, 200, `${perfil}: ${JSON.stringify(r.corpo)}`);
  }
  assert.equal(Number((await ctx.banco.query('SELECT fator_estoque FROM notas_itens WHERE id = $1', [rascunho])).rows[0].fator_estoque), 2.5);
  const bloqueada = await ctx.pedir('gestor', 'PATCH', `/api/sup/conferencia-unidades/${confirmada}`, { corpo: { fatorEstoque: 3 } });
  assert.equal(bloqueada.status, 409);
  assert.equal((await ctx.pedir('gestor', 'PATCH', `/api/sup/conferencia-unidades/${rascunho}`, { empresa: 'b', corpo: { fatorEstoque: 3 } })).status, 404, 'outra empresa');
});

test('P11: o perfil Financeiro liga a nota ao pedido e vê as listas da apropriação', { skip: semBanco }, async () => {
  const um = async (sql: string, p: unknown[]) => (await ctx.banco.query(sql, p)).rows[0].id as string;
  const e = ctx.empresas.a;
  const forn = (await ctx.pedir('dono', 'POST', '/api/adm/fornecedores', { corpo: { razaoSocial: 'Cimenteira P11' } })).corpo.fornecedor.id as string;
  const pedido = await um(`INSERT INTO pedidos_compra (empresa_id, numero, data, fornecedor_id, status) VALUES ($1, 9011, '2026-11-01', $2, 'aprovado') RETURNING id`, [e, forn]);
  const itemPedido = await um(`INSERT INTO pedidos_itens (empresa_id, pedido_id, descricao, unidade, quantidade, preco_unitario_centavos) VALUES ($1, $2, 'Cimento', 'sc', 10, 3500) RETURNING id`, [e, pedido]);
  const nota = await um(`INSERT INTO notas_fiscais (empresa_id, data_emissao, competencia, status, fornecedor_id, direcao) VALUES ($1, '2026-11-05', '2026-11-05', 'rascunho', $2, 'entrada') RETURNING id`, [e, forn]);
  const itemNota = await um(`INSERT INTO notas_itens (empresa_id, nota_id, numero_item, descricao, unidade, quantidade) VALUES ($1, $2, 1, 'Cimento CP II', 'sc', 10) RETURNING id`, [e, nota]);

  const candidatos = await ctx.pedir('financeiro', 'GET', `/api/fin/notas/${nota}/pedidos-candidatos`);
  assert.equal(candidatos.status, 200, JSON.stringify(candidatos.corpo));
  const r = await ctx.pedir('financeiro', 'PUT', `/api/fin/notas/${nota}/pedido`, { corpo: { pedidoId: pedido, itens: [{ notaItemId: itemNota, pedidoItemId: itemPedido, quantidade: 10 }] } });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal((await ctx.banco.query('SELECT pedido_id FROM notas_fiscais WHERE id = $1', [nota])).rows[0].pedido_id, pedido);

  const obra = (await ctx.pedir('dono', 'POST', '/api/eng/obras', { corpo: { codigo: 'P11', nome: 'Obra P11' } })).corpo.obra.id;
  for (const rota of ['/api/eng/obras', `/api/eng/obras/${obra}/itens?tipo=insumo`, `/api/eng/obras/${obra}/eap`, `/api/sup/estoques?obraId=${obra}`]) {
    assert.equal((await ctx.pedir('financeiro', 'GET', rota)).status, 200, rota);
  }
  // Só as listas: o resto de Suprimentos e da Engenharia continua fechado para o Financeiro.
  assert.equal((await ctx.pedir('financeiro', 'GET', '/api/sup/solicitacoes')).status, 403);
  assert.equal((await ctx.pedir('financeiro', 'PUT', `/api/sup/pedidos/${pedido}/recebimento`, { corpo: { notaId: nota, itens: [] } })).status, 403);
});
