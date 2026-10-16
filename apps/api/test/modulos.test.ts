import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acessoPermitido, modulosEfetivos, moduloDaRota } from '../src/lib/modulos.ts';

test('módulo de cada rota', () => {
  assert.equal(moduloDaRota('/api/frota/veiculos?x=1'), 'frota');
  assert.equal(moduloDaRota('/api/rel/financeiro'), 'financeiro');
  assert.equal(moduloDaRota('/api/rel/indicadores'), 'gerencial');
  assert.equal(moduloDaRota('/api/eng/obras/1'), 'engenharia');
  assert.equal(moduloDaRota('/api/auth/eu'), null);
  assert.equal(moduloDaRota('/api/empresa'), null);
});

test('módulos efetivos', () => {
  assert.equal(modulosEfetivos('dono', ['frota']).length, 7);
  assert.deepEqual(modulosEfetivos('operador_usina', null), []);
  // módulos da concreteira gravados num usuário antigo não valem mais
  assert.deepEqual(modulosEfetivos('gestor', ['financeiro', 'frota']), ['financeiro']);
  assert.deepEqual(modulosEfetivos('gestor', null), ['engenharia', 'comercial', 'suprimentos', 'gerencial', 'administrativo']);
  assert.deepEqual(modulosEfetivos('orcamentista', null), ['engenharia', 'comercial']);
  assert.deepEqual(modulosEfetivos('engenheiro_obra', null), ['engenharia']);
  assert.deepEqual(modulosEfetivos('comprador', null), ['suprimentos']);
});

test('regras de acesso', () => {
  const g = (perfil: any, modulos: string[] | null, perfisRota: any[], url: string, metodo = 'GET') => acessoPermitido({ perfil, modulos, perfisRota, url, metodo });
  // padrão: o Financeiro é só do dono e do perfil Financeiro
  assert.equal(g('dono', null, ['dono', 'gestor'], '/api/fin/lancamentos'), true);
  assert.equal(g('gestor', null, ['dono', 'gestor'], '/api/fin/lancamentos'), false);
  assert.equal(g('financeiro', null, ['dono', 'gestor'], '/api/fin/lancamentos', 'POST'), true);
  assert.equal(g('gestor', null, ['dono', 'gestor'], '/api/fin/resumo'), true);
  assert.equal(g('gestor', null, ['dono', 'gestor'], '/api/fin/contas'), true);
  assert.equal(g('motorista', null, ['dono', 'gestor'], '/api/fin/lancamentos'), false);
  // consulta de cadastro liberada mesmo sem o módulo
  assert.equal(g('gestor', ['financeiro'], ['dono', 'gestor'], '/api/frota/veiculos'), true);
  assert.equal(g('gestor', ['financeiro'], ['dono', 'gestor'], '/api/frota/veiculos', 'POST'), false);
  assert.equal(g('motorista', null, ['dono', 'gestor'], '/api/frota/os'), false);
  // perfis novos: acesso pelos módulos
  assert.equal(g('vendedor', null, ['dono', 'gestor', 'vendedor'], '/api/com/vendas', 'POST'), true);
  assert.equal(g('vendedor', null, ['dono', 'gestor'], '/api/ger/producao-equipe'), false);
  assert.equal(g('administrativo', null, ['dono', 'gestor'], '/api/sup/pedidos', 'POST'), true);
  assert.equal(g('administrativo', null, ['dono', 'gestor'], '/api/adm/clientes', 'POST'), true);
  assert.equal(g('administrativo', null, ['dono', 'gestor'], '/api/fin/lancamentos'), false);
  assert.equal(g('financeiro', null, ['dono', 'gestor'], '/api/ger/dre'), true);
  assert.equal(g('financeiro', null, ['dono', 'gestor'], '/api/prod/cargas', 'POST'), false);
  assert.equal(g('operador_usina', null, ['dono', 'gestor', 'vendedor'], '/api/com/vendas'), false);
  // construtora: frota, produção e qualidade saíram (só as listas respondem)
  assert.equal(g('dono', null, ['dono', 'gestor'], '/api/frota/os'), false);
  assert.equal(g('dono', null, ['dono', 'gestor'], '/api/prod/cargas', 'POST'), false);
  assert.equal(g('dono', null, ['dono', 'gestor'], '/api/qual/amostras'), false);
  assert.equal(g('dono', null, ['dono', 'gestor'], '/api/prod/insumos'), true);
  // engenharia como módulo
  assert.equal(g('dono', null, ['dono', 'gestor'], '/api/eng/obras', 'POST'), true);
  assert.equal(g('gestor', null, ['dono', 'gestor'], '/api/eng/obras', 'POST'), true);
  assert.equal(g('gestor', ['suprimentos'], ['dono', 'gestor'], '/api/eng/obras'), false);
  assert.equal(g('vendedor', null, ['dono', 'gestor'], '/api/eng/obras'), false);
  assert.equal(g('financeiro', null, ['dono', 'gestor'], '/api/eng/obras'), false);
  // orçamentista: engenharia e comercial; nada de compras nem caixa
  assert.equal(g('orcamentista', null, ['dono', 'gestor'], '/api/eng/obras/1/planilha', 'POST'), true);
  assert.equal(g('orcamentista', null, ['dono', 'gestor', 'vendedor'], '/api/com/propostas', 'POST'), true);
  assert.equal(g('orcamentista', null, ['dono', 'gestor'], '/api/sup/pedidos', 'POST'), false);
  assert.equal(g('orcamentista', null, ['dono', 'gestor'], '/api/fin/lancamentos'), false);
  // comprador: suprimentos
  assert.equal(g('comprador', null, ['dono', 'gestor'], '/api/sup/pedidos', 'POST'), true);
  assert.equal(g('comprador', null, ['dono', 'gestor'], '/api/eng/obras'), false);
  assert.equal(g('comprador', null, ['dono', 'gestor'], '/api/fin/lancamentos'), false);
  // engenheiro de obra: engenharia, contratos e medições (a rota limita às obras dele)
  assert.equal(g('engenheiro_obra', null, ['dono', 'gestor'], '/api/eng/obras/1/planejamento', 'PUT'), true);
  assert.equal(g('engenheiro_obra', null, ['dono', 'gestor'], '/api/sup/contratos', 'POST'), true);
  assert.equal(g('engenheiro_obra', null, ['dono', 'gestor'], '/api/sup/medicoes/9'), true);
  assert.equal(g('engenheiro_obra', null, ['dono', 'gestor'], '/api/sup/pedidos', 'POST'), false);
  assert.equal(g('engenheiro_obra', null, ['dono', 'gestor'], '/api/sup/autorizacoes'), false);
  assert.equal(g('engenheiro_obra', null, ['dono', 'gestor'], '/api/fin/plano-contas'), true);
  assert.equal(g('engenheiro_obra', null, ['dono', 'gestor'], '/api/fin/lancamentos'), false);
  assert.equal(g('engenheiro_obra', null, ['dono', 'gestor'], '/api/com/propostas'), false);
  // rota comum
  assert.equal(g('laboratorista', ['qualidade'], [], '/api/auth/eu'), true);
});

test('contrato da empresa limita os módulos, inclusive do dono', () => {
  assert.deepEqual(modulosEfetivos('dono', null, ['engenharia', 'suprimentos', 'configuracoes']), ['engenharia', 'suprimentos', 'configuracoes']);
  assert.deepEqual(modulosEfetivos('gestor', null, ['engenharia', 'suprimentos', 'configuracoes']), ['engenharia', 'suprimentos']);
});

test('contrato Obra: financeiro e comercial ficam fora, mesmo para o dono', () => {
  const contrato = ['engenharia', 'suprimentos', 'configuracoes'];
  const g = (perfil: any, url: string, metodo = 'GET') => acessoPermitido({ perfil, modulos: null, perfisRota: [], url, metodo, contratados: contrato });
  assert.equal(g('dono', '/api/eng/obras'), true);
  assert.equal(g('dono', '/api/sup/solicitacoes'), true);
  assert.equal(g('dono', '/api/fin/lancamentos'), false);
  assert.equal(g('dono', '/api/com/propostas'), false);
  // lista de cadastro usada por outro módulo continua respondendo
  assert.equal(g('dono', '/api/fin/plano-contas'), true);
  assert.equal(g('dono', '/api/fin/plano-contas', 'POST'), false);
});

test('contrato sem suprimentos: almoxarife não entra no estoque', () => {
  const g = (url: string) => acessoPermitido({ perfil: 'almoxarife', modulos: null, perfisRota: ['almoxarife'], url, metodo: 'GET', contratados: ['engenharia', 'configuracoes'] });
  assert.equal(g('/api/sup/estoques'), false);
});
