// P31 (D7): PUT substitui e exige tudo. Rotas que zeravam em silêncio o que fosse omitido passam a recusar.
// Rode com `npm run test:banco -w apps/api`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepararAppTeste, semBanco, type ContextoTeste } from './apoio/app-teste.ts';

let ctx: ContextoTeste;
let obra = '';
before(async () => {
  if (semBanco) return;
  ctx = await prepararAppTeste('teste_put_completo');
  obra = (await ctx.pedir('dono', 'POST', '/api/eng/obras', { corpo: { codigo: 'PUT-1', nome: 'Obra do PUT' } })).corpo.obra.id;
});
after(async () => {
  if (ctx) await ctx.fechar();
});
const um = async (sql: string, p: unknown[]) => (await ctx.banco.query(sql, p)).rows[0].id as string;

test('P31: PUT do RDO só com { data, observacoes } é recusado e não apaga as listas', { skip: semBanco }, async () => {
  const rdo = (await ctx.pedir('dono', 'POST', `/api/eng/obras/${obra}/rdos`, { corpo: { data: '2026-11-18' } })).corpo.id;
  const completo = {
    data: '2026-11-18', climaManha: 'bom', climaTarde: null, climaNoite: null, responsavel: 'Mestre João', observacoes: 'Concretagem',
    maoDeObra: [{ funcao: 'Pedreiro', empresa: null, quantidade: 4, horas: 8 }], equipamentos: [{ descricao: 'Betoneira', quantidade: 1, horas: 6 }],
    atividades: [{ local: 'Bloco A', descricao: 'Laje do 2º pavimento', equipe: null, percentual: 40 }], ocorrencias: [],
  };
  assert.equal((await ctx.pedir('dono', 'PUT', `/api/eng/obras/${obra}/rdos/${rdo}`, { corpo: completo })).status, 200);
  const parcial = await ctx.pedir('dono', 'PUT', `/api/eng/obras/${obra}/rdos/${rdo}`, { corpo: { data: '2026-11-18', observacoes: 'só isso' } });
  assert.equal(parcial.status, 400);
  assert.match(parcial.corpo.erro, /PUT regrava o RDO inteiro/);
  const lido = (await ctx.pedir('dono', 'GET', `/api/eng/obras/${obra}/rdos/${rdo}`)).corpo.rdo;
  assert.equal(lido.maoDeObra.length, 1);
  assert.equal(lido.responsavel, 'Mestre João');
  // P34: quantidade inválida é recusada (antes virava 0).
  const invalida = await ctx.pedir('dono', 'PUT', `/api/eng/obras/${obra}/rdos/${rdo}`, { corpo: { ...completo, maoDeObra: [{ funcao: 'Servente', empresa: null, quantidade: 'muitos', horas: null }] } });
  assert.equal(invalida.status, 400);
});

test('P31: PUT da visita exige os três campos', { skip: semBanco }, async () => {
  const obraVisita = (await ctx.pedir('dono', 'POST', '/api/eng/obras', { corpo: { codigo: 'VIS-1', nome: 'Obra de visitas', tipo: 'acompanhamento' } })).corpo.obra.id;
  const v = await ctx.pedir('dono', 'POST', `/api/eng/obras/${obraVisita}/visitas`, { corpo: { data: '2026-11-18', responsavel: 'Eng. Ana', observacoes: 'Tudo certo' } });
  assert.equal(v.status, 201, JSON.stringify(v.corpo));
  const id = v.corpo.visita?.id ?? v.corpo.id;
  assert.equal((await ctx.pedir('dono', 'PUT', `/api/eng/obras/${obraVisita}/visitas/${id}`, { corpo: { data: '2026-11-18' } })).status, 400);
  assert.equal((await ctx.pedir('dono', 'PUT', `/api/eng/obras/${obraVisita}/visitas/${id}`, { corpo: { data: '2026-11-19', responsavel: 'Eng. Ana', observacoes: null } })).status, 200);
});

test('P31: PUT do lançamento exige veiculoId em cada apropriação (antes o vínculo sumia)', { skip: semBanco }, async () => {
  await ctx.pedir('dono', 'POST', '/api/fin/plano-contas/padrao');
  const conta = (await ctx.pedir('dono', 'GET', '/api/fin/plano-contas')).corpo.contas.find((x: { tipo: string; aceitaLancamento: boolean }) => x.tipo === 'despesa' && x.aceitaLancamento);
  const base = { tipo: 'despesa', competencia: '2026-11-18', descricao: 'Despesa do PUT', valorTotal: 100, parcelas: [{ vencimento: '2026-11-30', valor: 100 }] };
  const novo = await ctx.pedir('dono', 'POST', '/api/fin/lancamentos', { corpo: { ...base, apropriacoes: [{ planoContaId: conta.id }] } });
  assert.equal(novo.status, 201, JSON.stringify(novo.corpo));
  const id = novo.corpo.lancamento.id;
  const semCampos = await ctx.pedir('dono', 'PUT', `/api/fin/lancamentos/${id}`, { corpo: { ...base, apropriacoes: [{ planoContaId: conta.id }] } });
  assert.equal(semCampos.status, 400);
  const completo = { ...base, documento: null, clienteId: null, fornecedorId: null, observacoes: null, apropriacoes: [{ planoContaId: conta.id, centroCustoId: null, veiculoId: null }] };
  const ok = await ctx.pedir('dono', 'PUT', `/api/fin/lancamentos/${id}`, { corpo: completo });
  assert.equal(ok.status, 200, JSON.stringify(ok.corpo));
});

test('P31: PUT do pedido exige o cabeçalho e não troca o fornecedor de pedido da cotação', { skip: semBanco }, async () => {
  const e = ctx.empresas.a;
  const forn = async (nome: string) => (await ctx.pedir('dono', 'POST', '/api/adm/fornecedores', { corpo: { razaoSocial: nome } })).corpo.fornecedor.id as string;
  const f1 = await forn('Fornecedor vencedor');
  const f2 = await forn('Outro fornecedor');
  const cotacao = await um(`INSERT INTO cotacoes (empresa_id, numero, data) VALUES ($1, 9031, '2026-11-01') RETURNING id`, [e]);
  const pedido = await um(`INSERT INTO pedidos_compra (empresa_id, numero, data, fornecedor_id, cotacao_id, status) VALUES ($1, 9031, '2026-11-02', $2, $3, 'rascunho') RETURNING id`, [e, f1, cotacao]);
  const cabecalho = { fornecedorId: f1, data: '2026-11-02', previsaoEntrega: null, condicaoPagamento: '30 dias', localEntrega: null, frete: 0, freteTipo: null, transportadoraId: null, centroCustoId: null, observacao: null };
  assert.equal((await ctx.pedir('dono', 'PUT', `/api/sup/pedidos/${pedido}`, { corpo: { fornecedorId: f1 } })).status, 400, 'cabeçalho incompleto');
  assert.equal((await ctx.pedir('dono', 'PUT', `/api/sup/pedidos/${pedido}`, { corpo: { ...cabecalho, fornecedorId: f2 } })).status, 409, 'troca de fornecedor');
  const ok = await ctx.pedir('dono', 'PUT', `/api/sup/pedidos/${pedido}`, { corpo: cabecalho });
  assert.equal(ok.status, 200, JSON.stringify(ok.corpo));
  assert.equal(ok.corpo.pedido.condicaoPagamento, '30 dias');
});
