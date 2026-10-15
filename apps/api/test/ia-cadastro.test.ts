import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cadastroDaIa } from '../src/lib/ia-cadastro.ts';

test('fornecedor: limpa CNPJ, UF e descarta valores vazios', () => {
  const r = cadastroDaIa('fornecedor', { tipoPessoa: 'PJ', cnpjCpf: '12.345.678/0001-90', razaoSocial: '  Cimentos Teste Ltda ', uf: 'to', email: '', telefone: null, duvidas: ['Inscrição estadual ilegível'] });
  assert.equal(r.dados.cnpjCpf, '12345678000190');
  assert.equal(r.dados.razaoSocial, 'Cimentos Teste Ltda');
  assert.equal(r.dados.uf, 'TO');
  assert.equal('email' in r.dados, false);
  assert.equal('telefone' in r.dados, false);
  assert.deepEqual(r.duvidas, ['Inscrição estadual ilegível']);
});

test('fornecedor: deduz PF pelo tamanho do documento quando não vem o tipo', () => {
  const r = cadastroDaIa('cliente', { cnpjCpf: '123.456.789-09', razaoSocial: 'Maria Silva' });
  assert.equal(r.dados.tipoPessoa, 'PF');
  assert.equal(r.dados.cnpjCpf, '12345678909');
});

test('credor: UF inválida e documento com tamanho errado não entram', () => {
  const r = cadastroDaIa('credor', { cnpjCpf: '123', uf: 'Tocantins', razaoSocial: 'Banco X S.A.' });
  assert.equal('cnpjCpf' in r.dados, false);
  assert.equal('uf' in r.dados, false);
  assert.equal(r.dados.razaoSocial, 'Banco X S.A.');
});

test('colaborador: CNH e datas validadas, função fora da lista descartada', () => {
  const r = cadastroDaIa('colaborador', {
    nome: 'João Pereira', cpf: '123.456.789-09', dataNascimento: '1985-03-12', dataAdmissao: '12/03/2020',
    cnhCategoria: 'ab', cnhVencimento: '2031-05-30', funcao: 'piloto', cnhNumero: '01234 567',
  });
  assert.equal(r.dados.cpf, '12345678909');
  assert.equal(r.dados.dataNascimento, '1985-03-12');
  assert.equal('dataAdmissao' in r.dados, false);
  assert.equal(r.dados.cnhCategoria, 'AB');
  assert.equal(r.dados.cnhVencimento, '2031-05-30');
  assert.equal('funcao' in r.dados, false);
  assert.equal(r.dados.cnhNumero, '01234567');
});
