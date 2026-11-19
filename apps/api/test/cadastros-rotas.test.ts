// Cadastros do Administrativo com o app de verdade e banco (rode com `npm run test:banco -w apps/api`).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepararAppTeste, semBanco, type ContextoTeste } from './apoio/app-teste.ts';
import { criarTokenSessao } from '../src/sessao.ts';

let ctx: ContextoTeste;
before(async () => {
  if (!semBanco) ctx = await prepararAppTeste('teste_cadastros_rotas');
});
after(async () => {
  if (ctx) await ctx.fechar();
});

test('P01: cliente grava e devolve o endereço; PATCH não quebra', { skip: semBanco }, async () => {
  const novo = await ctx.pedir('gestor', 'POST', '/api/adm/clientes', { corpo: { razaoSocial: 'Cliente Teste', endereco: 'Rua A, 10' } });
  assert.equal(novo.status, 201, JSON.stringify(novo.corpo));
  assert.equal(novo.corpo.cliente.endereco, 'Rua A, 10');
  const id = novo.corpo.cliente.id;
  // A tela manda o formulário inteiro, inclusive `atuacao`, que cliente não tem: o campo é ignorado.
  const r = await ctx.pedir('gestor', 'PATCH', `/api/adm/clientes/${id}`, { corpo: { endereco: 'Rua B, 20', atuacao: [], telefone: '11 99999-0000' } });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  const lista = await ctx.pedir('gestor', 'GET', '/api/adm/clientes');
  const c = lista.corpo.clientes.find((x: { id: string }) => x.id === id);
  assert.equal(c.endereco, 'Rua B, 20');
  assert.equal(c.telefone, '11 99999-0000');
});

test('P02: dono e gestor cadastram, editam e desativam colaboradores', { skip: semBanco }, async () => {
  for (const perfil of ['dono', 'gestor'] as const) {
    const novo = await ctx.pedir(perfil, 'POST', '/api/adm/colaboradores', { corpo: { nome: `Pedreiro do ${perfil}`, funcao: 'outro', cargo: 'Pedreiro' } });
    assert.equal(novo.status, 201, `${perfil}: ${JSON.stringify(novo.corpo)}`);
    const id = novo.corpo.motorista.id;
    const editado = await ctx.pedir(perfil, 'PATCH', `/api/adm/colaboradores/${id}`, { corpo: { cargo: 'Mestre pedreiro' } });
    assert.equal(editado.status, 200, JSON.stringify(editado.corpo));
    assert.equal(editado.corpo.motorista.cargo, 'Mestre pedreiro');
    assert.equal((await ctx.pedir(perfil, 'PATCH', `/api/adm/colaboradores/${id}`, { corpo: { ativo: false } })).status, 200);
    const lista = await ctx.pedir(perfil, 'GET', '/api/adm/colaboradores');
    assert.equal(lista.corpo.motoristas.find((x: { id: string }) => x.id === id).ativo, false);
  }
});

test('P02: quem não é dono nem gestor não cadastra colaborador', { skip: semBanco }, async () => {
  const r = await ctx.pedir('comprador', 'POST', '/api/adm/colaboradores', { corpo: { nome: 'X', funcao: 'outro' } });
  assert.equal(r.status, 403);
});

test('P03: PUT da permuta recusa obra e fornecedor de outra empresa', { skip: semBanco }, async () => {
  const obra = async (empresa: 'a' | 'b', codigo: string) =>
    (await ctx.pedir('dono', 'POST', '/api/eng/obras', { empresa, corpo: { codigo, nome: `Obra ${codigo}` } })).corpo.obra.id as string;
  const fornecedor = async (empresa: 'a' | 'b', nome: string) =>
    (await ctx.pedir('dono', 'POST', '/api/adm/fornecedores', { empresa, corpo: { razaoSocial: nome } })).corpo.fornecedor.id as string;
  const obraA = await obra('a', 'PM-A');
  const obraB = await obra('b', 'PM-B');
  const fornA = await fornecedor('a', 'Fornecedor A');
  const fornB = await fornecedor('b', 'Fornecedor B');
  const item = { descricao: 'Cimento', unidade: 'sc', quantidade: 10, precoUnitario: 30 };
  const corpo = (obraId: string, fornecedorId: string) => ({ obraId, fornecedorId, data: '2026-11-18', materiais: [item], servicos: [{ ...item, descricao: 'Reboco' }] });

  const nova = await ctx.pedir('dono', 'POST', '/api/sup/permutas', { corpo: corpo(obraA, fornA) });
  assert.equal(nova.status, 201, JSON.stringify(nova.corpo));
  const id = nova.corpo.permuta.id;
  assert.equal((await ctx.pedir('dono', 'POST', '/api/sup/permutas', { corpo: corpo(obraB, fornA) })).status, 400, 'POST com obra da B');
  assert.equal((await ctx.pedir('dono', 'PUT', `/api/sup/permutas/${id}`, { corpo: corpo(obraB, fornA) })).status, 400, 'PUT com obra da B');
  assert.equal((await ctx.pedir('dono', 'PUT', `/api/sup/permutas/${id}`, { corpo: corpo(obraA, fornB) })).status, 400, 'PUT com fornecedor da B');
  assert.equal((await ctx.pedir('dono', 'PUT', `/api/sup/permutas/${id}`, { corpo: corpo(obraA, fornA) })).status, 200, 'PUT válido');
});

test('P35: empresa criada pelo administrador já lança despesa, sem passar pela tela do plano de contas', { skip: semBanco }, async () => {
  const nova = await ctx.pedir('admin_sistema', 'POST', '/api/admin/empresas', {
    corpo: { razaoSocial: 'Construtora Nova Ltda', cnpj: '11444777000161', regimeTributario: 'simples', aliquotasDre: {}, dono: { nome: 'Dona Nova', email: 'dona@nova.teste', senha: 'SenhaForte#2026' } },
  });
  assert.equal(nova.status, 201, JSON.stringify(nova.corpo));
  const empresaId = nova.corpo.empresa.id;
  // O dono nasce com senha provisória; para o teste, ela já foi trocada.
  const dono = (await ctx.banco.query("UPDATE usuarios SET senha_provisoria = false WHERE email = 'dona@nova.teste' RETURNING id")).rows[0].id;
  // O pacote inicial (Obra) não tem o Financeiro; o administrador amplia o contrato. O plano de contas já existe.
  await ctx.banco.query("UPDATE empresas SET modulos_contratados = array_append(modulos_contratados, 'financeiro') WHERE id = $1", [empresaId]);
  const token = criarTokenSessao({ id: dono, empresaId, perfil: 'dono' });
  const pedir = async (metodo: 'GET' | 'POST', url: string, corpo?: unknown) => {
    const r = await ctx.app.inject({ method: metodo, url, headers: { authorization: `Bearer ${token}` }, ...(corpo ? { payload: corpo as object } : {}) });
    return { status: r.statusCode, corpo: r.json() };
  };
  const plano = await pedir('GET', '/api/fin/plano-contas');
  const conta = plano.corpo.contas.find((x: { tipo: string; aceitaLancamento: boolean }) => x.tipo === 'despesa' && x.aceitaLancamento);
  assert.ok(conta, 'o plano padrão tem categoria de despesa que aceita lançamento');
  const lanc = await pedir('POST', '/api/fin/lancamentos', {
    tipo: 'despesa', competencia: '2026-11-18', descricao: 'Primeira despesa', valorTotal: 100,
    apropriacoes: [{ planoContaId: conta.id }], parcelas: [{ vencimento: '2026-11-30', valor: 100 }],
  });
  assert.equal(lanc.status, 201, JSON.stringify(lanc.corpo));
});

test('P15: usuário com os 9 módulos marcados é aceito; permuta com preço vazio explica em português', { skip: semBanco }, async () => {
  const todos = ['engenharia', 'comercial', 'incorporacao', 'laudos', 'suprimentos', 'financeiro', 'gerencial', 'administrativo', 'configuracoes'];
  const r = await ctx.pedir('dono', 'PATCH', `/api/usuarios/${ctx.usuarios.a.financeiro.id}`, { corpo: { modulos: todos } });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  const obra = (await ctx.pedir('dono', 'POST', '/api/eng/obras', { corpo: { codigo: 'P15', nome: 'Obra P15' } })).corpo.obra.id;
  const forn = (await ctx.pedir('dono', 'POST', '/api/adm/fornecedores', { corpo: { razaoSocial: 'Fornecedor P15' } })).corpo.fornecedor.id;
  const p = await ctx.pedir('dono', 'POST', '/api/sup/permutas', {
    corpo: { obraId: obra, fornecedorId: forn, data: '2026-11-19', materiais: [{ descricao: 'Areia', quantidade: 1, precoUnitario: null }], servicos: [{ descricao: 'Reboco', quantidade: 1, precoUnitario: 10 }] },
  });
  assert.equal(p.status, 400);
  assert.equal(p.corpo.erro, 'Informe o preço acordado.');
});

test('P32: insumo criado com código "I-001" numa tabela própria é usado numa composição', { skip: semBanco }, async () => {
  const t = await ctx.pedir('dono', 'POST', '/api/eng/tabelas', { corpo: { fonte: 'proprio', nome: 'Tabela própria P32' } });
  assert.equal(t.status, 201, JSON.stringify(t.corpo));
  const tabela = t.corpo.tabela?.id ?? t.corpo.id;
  const ins = await ctx.pedir('dono', 'POST', `/api/eng/tabelas/${tabela}/itens`, { corpo: { tipo: 'insumo', codigo: 'I-001', descricao: 'Cimento CP II', unidade: 'sc', preco: 35 } });
  assert.equal(ins.status, 201, JSON.stringify(ins.corpo));
  assert.equal(ins.corpo.codigo ?? ins.corpo.item?.codigo, 'I-001');
  const comp = await ctx.pedir('dono', 'POST', `/api/eng/tabelas/${tabela}/itens`, {
    corpo: { tipo: 'composicao', descricao: 'Argamassa', unidade: 'm3', componentes: [{ insumoCodigo: 'I-001', coeficiente: 6 }] },
  });
  assert.equal(comp.status, 201, JSON.stringify(comp.corpo));
  assert.equal((await ctx.pedir('dono', 'POST', `/api/eng/tabelas/${tabela}/itens`, { corpo: { tipo: 'insumo', codigo: 'I-001', descricao: 'Repetido', unidade: 'un' } })).status, 409);
});

test('P32: conta financeira e centro de custo criados inativos ficam inativos', { skip: semBanco }, async () => {
  const conta = await ctx.pedir('dono', 'POST', '/api/fin/contas', { corpo: { nome: 'Caixa antigo', tipo: 'caixa', saldoInicial: 0, ativo: false } });
  assert.equal(conta.status, 201, JSON.stringify(conta.corpo));
  assert.equal(conta.corpo.conta.ativo, false);
  const centro = await ctx.pedir('dono', 'POST', '/api/fin/centros-custo', { corpo: { nome: 'Centro antigo', ativo: false } });
  assert.equal(centro.status, 201);
  assert.equal(centro.corpo.centro.ativo, false);
});
