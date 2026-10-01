import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esquemaEmpresa, esquemaNovoUsuario, esquemaAlterarUsuario, esquemaNovaEmpresa } from '../src/esquemas.ts';

const empresaOk = {
  razaoSocial: 'Concreteira Teste Ltda',
  nomeFantasia: '',
  cnpj: '11.222.333/0001-81',
  regimeTributario: 'simples',
  aliquotasDre: { simples: '9,5'.replace(',', '.') },
  telefone: '',
  email: '',
  cidade: 'Palmas',
  uf: 'to',
};

test('Empresa: limpa CNPJ, transforma vazios em nulo e põe UF em maiúsculas', () => {
  const d = esquemaEmpresa.parse(empresaOk);
  assert.equal(d.cnpj, '11222333000181');
  assert.equal(d.nomeFantasia, null);
  assert.equal(d.telefone, null);
  assert.equal(d.email, null);
  assert.equal(d.uf, 'TO');
  assert.equal(d.aliquotasDre.simples, 9.5);
});

test('Empresa: recusa CNPJ inválido, regime desconhecido e alíquota fora da faixa', () => {
  const r1 = esquemaEmpresa.safeParse({ ...empresaOk, cnpj: '11.222.333/0001-80' });
  assert.equal(r1.success, false);
  assert.equal(!r1.success && r1.error.issues[0].message, 'CNPJ inválido. Confira os números.');
  assert.equal(esquemaEmpresa.safeParse({ ...empresaOk, regimeTributario: 'mei' }).success, false);
  assert.equal(esquemaEmpresa.safeParse({ ...empresaOk, aliquotasDre: { simples: 120 } }).success, false);
  assert.equal(esquemaEmpresa.safeParse({ ...empresaOk, aliquotasDre: { inventado: 1 } }).success, false);
});

test('Usuário: e-mail em minúsculas, senha mínima e perfil válido', () => {
  const d = esquemaNovoUsuario.parse({ nome: 'Ana Souza', email: ' Ana@Exemplo.COM ', perfil: 'gestor', senha: '12345678' });
  assert.equal(d.email, 'ana@exemplo.com');
  assert.equal(d.telefoneWhatsapp, null);
  const curta = esquemaNovoUsuario.safeParse({ nome: 'Ana', email: 'a@b.com', perfil: 'gestor', senha: '123' });
  assert.equal(curta.success, false);
  assert.equal(esquemaNovoUsuario.safeParse({ nome: 'Ana', email: 'a@b.com', perfil: 'admin_sistema', senha: '12345678' }).success, false);
});

test('Alterar usuário: aceita só os campos previstos', () => {
  assert.equal(esquemaAlterarUsuario.safeParse({ ativo: false }).success, true);
  assert.equal(esquemaAlterarUsuario.safeParse({ empresaId: 'outra' }).success, false);
});

test('Nova empresa: exige dados do dono', () => {
  assert.equal(esquemaNovaEmpresa.safeParse(empresaOk).success, false);
  const d = esquemaNovaEmpresa.parse({ ...empresaOk, dono: { nome: 'Carlos Lima', email: 'carlos@x.com', senha: 'abcdefgh' } });
  assert.equal(d.dono.email, 'carlos@x.com');
});
