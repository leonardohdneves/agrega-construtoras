import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acessoPermitido, MODULOS_PADRAO } from '../src/lib/modulos.ts';

const ENG = ['dono', 'gestor'] as const;
const pode = (url: string, metodo = 'GET', perfisRota: string[] = [...ENG]) =>
  acessoPermitido({ perfil: 'mestre_obra', modulos: null, perfisRota: perfisRota as never[], url, metodo });

test('mestre de obra: módulo padrão é só a Engenharia', () => {
  assert.deepEqual(MODULOS_PADRAO.mestre_obra, ['engenharia']);
});

test('mestre de obra: consulta a Engenharia e o canteiro, sem alterar nada', () => {
  assert.equal(pode('/api/eng/obras/1/canteiro'), true);
  assert.equal(pode('/api/eng/obras/1/canteiro/boletins/2'), true);
  assert.equal(pode('/api/eng/obras/1/canteiro/centrais/argamassa', 'PUT'), false);
  assert.equal(pode('/api/eng/obras/1/canteiro/centrais/argamassa/boletins', 'POST'), false);
  assert.equal(pode('/api/eng/obras/1/canteiro/boletins/2', 'DELETE'), false);
  assert.equal(pode('/api/eng/obras/1/planejamento', 'PUT'), false);
});

test('mestre de obra: não vê usuários, fornecedores nem financeiro (perfis das rotas reais)', () => {
  assert.equal(acessoPermitido({ perfil: 'mestre_obra', modulos: null, perfisRota: ['dono', 'gestor'], url: '/api/usuarios', metodo: 'GET' }), false);
  assert.equal(acessoPermitido({ perfil: 'mestre_obra', modulos: null, perfisRota: ['dono', 'financeiro'], url: '/api/fin/contas', metodo: 'GET' }), false);
});
