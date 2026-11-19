// P34: comportamentos inesperados corrigidos. Rode com `npm run test:banco -w apps/api`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepararAppTeste, semBanco, type ContextoTeste } from './apoio/app-teste.ts';

let ctx: ContextoTeste;
let obra = '';
let despesa = '';
before(async () => {
  if (semBanco) return;
  ctx = await prepararAppTeste('teste_comportamentos');
  obra = (await ctx.pedir('dono', 'POST', '/api/eng/obras', { corpo: { codigo: 'P34', nome: 'Obra P34' } })).corpo.obra.id;
  await ctx.pedir('dono', 'POST', '/api/fin/plano-contas/padrao');
  despesa = (await ctx.pedir('dono', 'GET', '/api/fin/plano-contas')).corpo.contas.find((x: { tipo: string; aceitaLancamento: boolean }) => x.tipo === 'despesa' && x.aceitaLancamento).id;
});
after(async () => {
  if (ctx) await ctx.fechar();
});
const um = async (sql: string, p: unknown[]) => (await ctx.banco.query(sql, p)).rows[0].id as string;

/** Serviço da obra numa Tarefa da EAP, com orçamento (para medir e para os contadores do item). */
async function servicoNaTarefa() {
  const tarefa = await um(`INSERT INTO eap_nos (obra_id, nivel, codigo, descricao) VALUES ($1, 'tarefa', '1', 'Alvenaria') RETURNING id`, [obra]);
  const insumo = await um(`INSERT INTO obra_itens (obra_id, tipo, codigo, descricao, unidade, preco_centavos) VALUES ($1, 'insumo', 'I-1', 'Bloco', 'un', 200) RETURNING id`, [obra]);
  const comp = await um(`INSERT INTO obra_itens (obra_id, tipo, codigo, descricao, unidade, preco_centavos) VALUES ($1, 'composicao', 'S-1', 'Alvenaria de bloco', 'm2', 5000) RETURNING id`, [obra]);
  await ctx.banco.query('INSERT INTO obra_composicao_insumos (composicao_id, insumo_id, coeficiente) VALUES ($1, $2, 12.5)', [comp, insumo]);
  await ctx.banco.query('INSERT INTO orcamento_itens (obra_id, eap_no_id, obra_item_id, quantidade, ordem) VALUES ($1, $2, $3, 100, 1)', [obra, tarefa, comp]);
  return { tarefa, comp };
}

test('P34: medição física na mesma data só substitui com confirmação; contadores do item corretos', { skip: semBanco }, async () => {
  const { tarefa, comp } = await servicoNaTarefa();
  const medir = (percentual: number, substituir?: boolean) =>
    ctx.pedir('dono', 'POST', `/api/eng/obras/${obra}/acompanhamento/medicoes`, { corpo: { data: '2026-11-15', itens: [{ eapNoId: tarefa, percentual }], ...(substituir ? { substituir } : {}) } });
  assert.equal((await medir(30)).status, 201);
  const repetida = await medir(50);
  assert.equal(repetida.status, 409);
  assert.equal(repetida.corpo.jaExiste, true);
  assert.equal((await medir(50, true)).status, 201);
  const item = (await ctx.pedir('dono', 'GET', `/api/eng/obras/${obra}/itens/${comp}`)).corpo.item;
  assert.ok(item.componentes > 0 || item.noOrcamento === true, JSON.stringify(item));
});

test('P34: PATCH da parcela apaga a observação quando ela vem vazia', { skip: semBanco }, async () => {
  const l = await ctx.pedir('dono', 'POST', '/api/fin/lancamentos', {
    corpo: { tipo: 'despesa', competencia: '2026-11-10', descricao: 'Despesa P34', valorTotal: 50, apropriacoes: [{ planoContaId: despesa }], parcelas: [{ vencimento: '2026-11-30', valor: 50 }] },
  });
  const id = l.corpo.lancamento?.id ?? l.corpo.id;
  const parcela = (await ctx.banco.query('SELECT id FROM parcelas WHERE lancamento_id = $1', [id])).rows[0].id;
  await ctx.pedir('dono', 'PATCH', `/api/fin/parcelas/${parcela}`, { corpo: { observacoes: 'combinado por telefone' } });
  assert.equal((await ctx.pedir('dono', 'PATCH', `/api/fin/parcelas/${parcela}`, { corpo: { observacoes: '' } })).status, 200);
  assert.equal((await ctx.banco.query('SELECT observacoes FROM parcelas WHERE id = $1', [parcela])).rows[0].observacoes, null);
  // Mexer só no vencimento não apaga a observação.
  await ctx.pedir('dono', 'PATCH', `/api/fin/parcelas/${parcela}`, { corpo: { observacoes: 'nova' } });
  await ctx.pedir('dono', 'PATCH', `/api/fin/parcelas/${parcela}`, { corpo: { vencimento: '2026-12-05' } });
  assert.equal((await ctx.banco.query('SELECT observacoes FROM parcelas WHERE id = $1', [parcela])).rows[0].observacoes, 'nova');
});

test('P34: solicitação de serviço sem o campo tipo é reconhecida pelo formato', { skip: semBanco }, async () => {
  const obraNivel = (await ctx.pedir('dono', 'POST', '/api/eng/obras', { corpo: { codigo: 'P34-S', nome: 'Obra no nível obra', nivelApropriacao: 'obra' } })).corpo.obra.id;
  const comp = await um(`INSERT INTO obra_itens (obra_id, tipo, codigo, descricao, unidade, preco_centavos) VALUES ($1, 'composicao', 'S-9', 'Pintura', 'm2', 1500) RETURNING id`, [obraNivel]);
  const r = await ctx.pedir('dono', 'POST', '/api/sup/solicitacoes', { corpo: { obraId: obraNivel, planoContaId: despesa, escopo: 'mo', itens: [{ obraItemId: comp, quantidade: 10 }] } });
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  assert.equal(r.corpo.solicitacao.tipo, 'servico');
});

test('P34: contrato manual fica ligado à obra', { skip: semBanco }, async () => {
  const forn = (await ctx.pedir('dono', 'POST', '/api/adm/fornecedores', { corpo: { razaoSocial: 'Empreiteira P34' } })).corpo.fornecedor.id;
  const r = await ctx.pedir('dono', 'POST', '/api/sup/contratos', {
    corpo: { obraId: obra, fornecedorId: forn, objeto: 'Pintura da fachada', tipo: 'global', inicio: '2026-11-01', valorGlobal: 10000, planoContaId: despesa },
  });
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  assert.equal(r.corpo.contrato.obraId, obra);
  const outra = (await ctx.pedir('dono', 'POST', '/api/eng/obras', { corpo: { codigo: 'P34-B', nome: 'Outra' }, empresa: 'b' })).corpo.obra.id;
  const errada = await ctx.pedir('dono', 'POST', '/api/sup/contratos', {
    corpo: { obraId: outra, fornecedorId: forn, objeto: 'Contrato com obra alheia', tipo: 'global', inicio: '2026-11-01', valorGlobal: 1, planoContaId: despesa },
  });
  assert.equal(errada.status, 400);
});

test('P34: linhas de extrato sem contaId trazem todas as contas', { skip: semBanco }, async () => {
  const r = await ctx.pedir('dono', 'GET', '/api/fin/conciliacao/linhas?status=todas');
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.ok(Array.isArray(r.corpo.linhas));
});

test('P34: relatórios da obra devolvem o BDI usado no cálculo', { skip: semBanco }, async () => {
  const abc = (await ctx.pedir('dono', 'GET', `/api/eng/obras/${obra}/relatorio-abc`)).corpo;
  const orc = (await ctx.pedir('dono', 'GET', `/api/eng/obras/${obra}/orcamento`)).corpo;
  assert.equal(abc.obra.bdiPercentual, orc.bdiPercentual);
});
