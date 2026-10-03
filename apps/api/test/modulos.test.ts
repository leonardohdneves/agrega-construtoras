import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acessoPermitido, modulosEfetivos, moduloDaRota } from '../src/lib/modulos.ts';

test('módulo de cada rota', () => {
  assert.equal(moduloDaRota('/api/frota/veiculos?x=1'), 'frota');
  assert.equal(moduloDaRota('/api/rel/financeiro'), 'financeiro');
  assert.equal(moduloDaRota('/api/rel/indicadores'), 'gerencial');
  assert.equal(moduloDaRota('/api/auth/eu'), null);
  assert.equal(moduloDaRota('/api/empresa'), null);
});

test('módulos efetivos', () => {
  assert.equal(modulosEfetivos('dono', ['frota']).length, 8);
  assert.deepEqual(modulosEfetivos('operador_usina', null), ['producao']);
  assert.deepEqual(modulosEfetivos('gestor', ['financeiro', 'frota']), ['frota', 'financeiro']);
});

test('regras de acesso', () => {
  const g = (perfil: any, modulos: string[] | null, perfisRota: any[], url: string, metodo = 'GET') => acessoPermitido({ perfil, modulos, perfisRota, url, metodo });
  // padrão
  assert.equal(g('gestor', null, ['dono', 'gestor'], '/api/fin/lancamentos'), true);
  assert.equal(g('motorista', null, ['dono', 'gestor'], '/api/fin/lancamentos'), false);
  // gestor sem financeiro
  assert.equal(g('gestor', ['frota'], ['dono', 'gestor'], '/api/fin/lancamentos'), false);
  // consulta de cadastro liberada mesmo sem o módulo
  assert.equal(g('gestor', ['financeiro'], ['dono', 'gestor'], '/api/frota/veiculos'), true);
  assert.equal(g('gestor', ['financeiro'], ['dono', 'gestor'], '/api/frota/veiculos', 'POST'), false);
  // operador com Suprimentos a mais: acesso completo
  assert.equal(g('operador_usina', ['producao', 'suprimentos'], ['dono', 'gestor'], '/api/sup/pedidos', 'POST'), true);
  // motorista no módulo padrão continua limitado pelo perfil da rota
  assert.equal(g('motorista', null, ['dono', 'gestor'], '/api/frota/os'), false);
  assert.equal(g('motorista', null, ['dono', 'gestor', 'motorista'], '/api/frota/abastecimentos', 'POST'), true);
  // rota comum
  assert.equal(g('laboratorista', ['qualidade'], [], '/api/auth/eu'), true);
});
