// P37: ferramentas do MCP exercitadas de ponta a ponta contra a API real (com banco). O app sobe numa porta local e as
// ferramentas chamam a API por HTTP, como em produção. Rode com `npm run test:banco -w apps/api`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepararAppTeste, semBanco, type ContextoTeste } from './apoio/app-teste.ts';
import { ferramentas } from '../../mcp/src/ferramentas/index.ts';
import { ClienteApi } from '../../mcp/src/lib/cliente-api.ts';

let ctx: ContextoTeste;
let api: ClienteApi;
before(async () => {
  if (semBanco) return;
  ctx = await prepararAppTeste('teste_mcp_ferramentas');
  const endereco = await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  api = new ClienteApi(endereco, ctx.usuarios.a.dono.token);
});
after(async () => {
  if (ctx) await ctx.fechar();
});

/** Chama a ferramenta como o servidor MCP chama: valida os argumentos e roda o handler. */
async function usar(nome: string, args: Record<string, unknown> = {}) {
  const f = ferramentas[nome];
  assert.ok(f, `ferramenta ${nome} não existe`);
  const r = (await f.handler(f.inputSchema.parse(args), api)) as { success: boolean; data: any };
  assert.equal(r.success, true);
  return r.data;
}
const um = async (sql: string, p: unknown[]) => (await ctx.banco.query(sql, p)).rows[0].id as string;

test('MCP: plano de contas padrão e versão do orçamento', { skip: semBanco }, async () => {
  const plano = await usar('aplicar_plano_contas_padrao');
  assert.ok(plano.contas >= 0);
  const obra = (await ctx.pedir('dono', 'POST', '/api/eng/obras', { corpo: { codigo: 'MCP-1', nome: 'Obra MCP' } })).corpo.obra.id;
  const v = await usar('criar_versao_orcamento', { obraId: obra, nome: 'Versão inicial' });
  assert.equal(v.versao.numero, 1);
});

test('MCP: reprovar e encerrar pedido de compra', { skip: semBanco }, async () => {
  const forn = (await ctx.pedir('dono', 'POST', '/api/adm/fornecedores', { corpo: { razaoSocial: 'Fornecedor MCP' } })).corpo.fornecedor.id;
  const aguardando = await um(`INSERT INTO pedidos_compra (empresa_id, numero, data, fornecedor_id, status) VALUES ($1, 7001, '2026-11-01', $2, 'aguardando_aprovacao') RETURNING id`, [ctx.empresas.a, forn]);
  const reprovado = await usar('reprovar_pedido_compra', { id: aguardando, motivo: 'Preço acima da cotação' });
  assert.equal(reprovado.pedido.status, 'reprovado');
  const aprovado = await um(`INSERT INTO pedidos_compra (empresa_id, numero, data, fornecedor_id, status) VALUES ($1, 7002, '2026-11-01', $2, 'aprovado') RETURNING id`, [ctx.empresas.a, forn]);
  const encerrado = await usar('encerrar_pedido_compra', { id: aprovado, motivo: 'Fornecedor não tem mais o material' });
  assert.equal(encerrado.pedido.status, 'encerrado');
});

test('MCP: atualizar_rdo e atualizar_pedido_compra são parciais e não apagam o resto (D7)', { skip: semBanco }, async () => {
  const obra = (await ctx.pedir('dono', 'POST', '/api/eng/obras', { corpo: { codigo: 'MCP-2', nome: 'Obra RDO' } })).corpo.obra.id;
  const rdo = (await ctx.pedir('dono', 'POST', `/api/eng/obras/${obra}/rdos`, { corpo: { data: '2026-11-18' } })).corpo.id;
  await ctx.pedir('dono', 'PUT', `/api/eng/obras/${obra}/rdos/${rdo}`, {
    corpo: { data: '2026-11-18', climaManha: 'bom', climaTarde: null, climaNoite: null, responsavel: 'Mestre', observacoes: null, maoDeObra: [{ funcao: 'Pedreiro', empresa: null, quantidade: 3, horas: 8 }], equipamentos: [], atividades: [], ocorrencias: [] },
  });
  await usar('atualizar_rdo', { obraId: obra, rdoId: rdo, data: '2026-11-18', observacoes: 'Chuva à tarde' });
  const lido = (await ctx.pedir('dono', 'GET', `/api/eng/obras/${obra}/rdos/${rdo}`)).corpo.rdo;
  assert.equal(lido.observacoes, 'Chuva à tarde');
  assert.equal(lido.maoDeObra.length, 1, 'a mão de obra continua lá');
  assert.equal(lido.responsavel, 'Mestre');

  const forn = (await ctx.pedir('dono', 'POST', '/api/adm/fornecedores', { corpo: { razaoSocial: 'Fornecedor do pedido' } })).corpo.fornecedor.id;
  const pedido = await um(`INSERT INTO pedidos_compra (empresa_id, numero, data, fornecedor_id, status, condicao_pagamento) VALUES ($1, 7003, '2026-11-01', $2, 'rascunho', '30 dias') RETURNING id`, [ctx.empresas.a, forn]);
  const r = await usar('atualizar_pedido_compra', { id: pedido, observacao: 'Entregar pela manhã' });
  assert.equal(r.pedido.observacao, 'Entregar pela manhã');
  assert.equal(r.pedido.condicaoPagamento, '30 dias', 'o resto do cabeçalho fica');
});
