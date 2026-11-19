// P07: matrizes de acesso com o app de verdade e banco (rode com `npm run test:banco -w apps/api`).
// 1) Perfil × módulo: cada perfil, com os módulos padrão, entra (ou não) em uma rota de cada módulo.
// 2) Entre empresas: o dono da empresa B não lê nem altera o que é da empresa A.
// Uma mudança de regra de acesso que altere a matriz precisa ser feita aqui também, de propósito.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepararAppTeste, semBanco, type ContextoTeste, type PerfilEmpresa } from './apoio/app-teste.ts';

let ctx: ContextoTeste;
before(async () => {
  if (!semBanco) ctx = await prepararAppTeste('teste_matrizes');
});
after(async () => {
  if (ctx) await ctx.fechar();
});

/** Uma rota de leitura de cada módulo, que não é consulta de cadastro liberada a todos. */
const ROTA: Record<string, string> = {
  // O panorama, e não a lista de obras: a lista é consulta liberada a quem apropria (almoxarife, Financeiro).
  engenharia: '/api/eng/panorama',
  comercial: '/api/com/propostas',
  incorporacao: '/api/com/incorporacao/empreendimentos',
  laudos: '/api/laudos',
  suprimentos: '/api/sup/solicitacoes',
  financeiro: '/api/fin/lancamentos',
  gerencial: '/api/ger/dre',
  administrativo: '/api/adm/colaboradores',
  configuracoes: '/api/rel/configuracoes',
};

/** Onde cada perfil entra com os módulos padrão (MODULOS_PADRAO e as regras de acessoPermitido). */
const ESPERADO: Record<PerfilEmpresa, string[]> = {
  dono: ['engenharia', 'comercial', 'incorporacao', 'laudos', 'suprimentos', 'financeiro', 'gerencial', 'administrativo', 'configuracoes'],
  gestor: ['engenharia', 'comercial', 'incorporacao', 'laudos', 'suprimentos', 'gerencial', 'administrativo'],
  orcamentista: ['engenharia', 'comercial'],
  engenheiro_obra: ['engenharia'],
  mestre_obra: ['engenharia'],
  comprador: ['suprimentos'],
  financeiro: ['financeiro', 'gerencial'],
  administrativo: ['suprimentos', 'administrativo'],
  vendedor: ['comercial'],
  // Almoxarife: só o estoque em Suprimentos (não as solicitações).
  almoxarife: [],
};

test('P07: matriz perfil × módulo', { skip: semBanco }, async () => {
  const obtido: Record<string, string[]> = {};
  const detalhes: string[] = [];
  for (const perfil of Object.keys(ESPERADO) as PerfilEmpresa[]) {
    obtido[perfil] = [];
    for (const [modulo, rota] of Object.entries(ROTA)) {
      const r = await ctx.pedir(perfil, 'GET', rota);
      assert.ok(r.status !== 401 && r.status < 500, `${perfil} ${rota}: ${r.status} ${JSON.stringify(r.corpo)}`);
      if (r.status !== 403) obtido[perfil].push(modulo);
      detalhes.push(`${perfil} ${modulo} ${r.status}`);
    }
  }
  assert.deepEqual(obtido, ESPERADO, detalhes.join('\n'));
});

test('P07: a matriz vale também com o endereço codificado (regressão da P04)', { skip: semBanco }, async () => {
  const codificar = (rota: string) => rota.replace(/^\/api\/(\w)/, (_t, letra: string) => `/api/%${letra.charCodeAt(0).toString(16)}`);
  for (const perfil of ['gestor', 'mestre_obra', 'vendedor'] as const) {
    for (const [modulo, rota] of Object.entries(ROTA)) {
      const r = await ctx.pedir(perfil, 'GET', codificar(rota));
      assert.equal(r.status !== 403, ESPERADO[perfil].includes(modulo), `${perfil} ${codificar(rota)}: ${r.status}`);
    }
  }
});

test('P07: matriz entre empresas: o dono da B não alcança o que é da A', { skip: semBanco }, async () => {
  const obra = (await ctx.pedir('dono', 'POST', '/api/eng/obras', { corpo: { codigo: 'MZ-1', nome: 'Obra da A' } })).corpo.obra.id;
  const cliente = (await ctx.pedir('dono', 'POST', '/api/adm/clientes', { corpo: { razaoSocial: 'Cliente da A' } })).corpo.cliente.id;
  const fornecedor = (await ctx.pedir('dono', 'POST', '/api/adm/fornecedores', { corpo: { razaoSocial: 'Fornecedor da A' } })).corpo.fornecedor.id;
  const colaborador = (await ctx.pedir('dono', 'POST', '/api/adm/colaboradores', { corpo: { nome: 'Colaborador da A', funcao: 'outro' } })).corpo.motorista.id;

  const casos: [string, 'GET' | 'PUT' | 'PATCH' | 'DELETE', string, unknown?][] = [
    ['obra', 'GET', `/api/eng/obras/${obra}`],
    ['obra', 'PUT', `/api/eng/obras/${obra}`, { nome: 'Tomada' }],
    ['RDOs da obra', 'GET', `/api/eng/obras/${obra}/rdos`],
    ['canteiro da obra', 'GET', `/api/eng/obras/${obra}/canteiro`],
    ['visitas da obra', 'GET', `/api/eng/obras/${obra}/visitas`],
    ['cliente', 'PATCH', `/api/adm/clientes/${cliente}`, { telefone: '0' }],
    ['fornecedor', 'PATCH', `/api/adm/fornecedores/${fornecedor}`, { telefone: '0' }],
    ['colaborador', 'PATCH', `/api/adm/colaboradores/${colaborador}`, { cargo: 'Tomado' }],
  ];
  for (const [nome, metodo, url, corpo] of casos) {
    const r = await ctx.pedir('dono', metodo, url, { empresa: 'b', corpo });
    assert.ok(r.status === 404 || r.status === 403, `${nome} (${metodo} ${url}) com o dono da B: ${r.status} ${JSON.stringify(r.corpo)}`);
  }
  // E as listas da B não mostram nada da A.
  for (const rota of ['/api/eng/obras', '/api/adm/clientes', '/api/adm/fornecedores', '/api/adm/colaboradores']) {
    const r = await ctx.pedir('dono', 'GET', rota, { empresa: 'b' });
    assert.equal(r.status, 200);
    for (const id of [obra, cliente, fornecedor, colaborador]) assert.ok(!JSON.stringify(r.corpo).includes(id), `${rota} da B mostra ${id}`);
  }
});

test('P22: rotas legadas da concreteira respondem 404, menos as consultas mantidas', { skip: semBanco }, async () => {
  for (const [metodo, url] of [['GET', '/api/prod/inventarios'], ['GET', '/api/qual/amostras'], ['POST', '/api/frota/abastecimentos'], ['GET', '/api/frota/os'], ['GET', '/api/ger/custo-veiculo'], ['GET', '/api/rel/frota'], ['POST', '/api/frota/motoristas']] as const) {
    assert.equal((await ctx.pedir('dono', metodo, url, metodo === 'POST' ? { corpo: {} } : {})).status, 404, `${metodo} ${url}`);
  }
  for (const url of ['/api/frota/veiculos', '/api/frota/motoristas', '/api/prod/insumos', '/api/prod/tracos']) {
    assert.equal((await ctx.pedir('dono', 'GET', url)).status, 200, url);
  }
});
