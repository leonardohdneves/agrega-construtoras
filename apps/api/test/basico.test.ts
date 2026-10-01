import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cnpjValido, formatarCnpj, limparCnpj } from '../src/lib/cnpj.ts';
import { conferirSenha, gerarHashSenha } from '../src/lib/senha.ts';
import { criarToken, lerToken } from '../src/lib/token.ts';
import { acessaFinanceiro, podeEditarEmpresa, podeGerenciarPerfil } from '../src/lib/perfis.ts';
import { CNPJ_DEMO } from '../src/lib/demo.ts';

test('CNPJ: válidos, inválidos e formatação', () => {
  assert.equal(cnpjValido('11.222.333/0001-81'), true);
  assert.equal(cnpjValido(CNPJ_DEMO), true);
  assert.equal(cnpjValido('11.222.333/0001-82'), false);
  assert.equal(cnpjValido('00000000000000'), false);
  assert.equal(cnpjValido('123'), false);
  assert.equal(limparCnpj('11.222.333/0001-81'), '11222333000181');
  assert.equal(formatarCnpj('11222333000181'), '11.222.333/0001-81');
});

test('Senha: hash confere com a senha certa e recusa a errada', async () => {
  const hash = await gerarHashSenha('betoneira-07');
  assert.match(hash, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await conferirSenha('betoneira-07', hash), true);
  assert.equal(await conferirSenha('betoneira-08', hash), false);
  assert.equal(await conferirSenha('qualquer', 'formato-invalido'), false);
  assert.notEqual(await gerarHashSenha('x'.repeat(8)), await gerarHashSenha('x'.repeat(8)));
});

test('Token: lê o que assinou, recusa adulterado, vencido ou de outro segredo', () => {
  const segredo = 's'.repeat(40);
  const t = criarToken({ sub: 'u1', emp: 'e1', per: 'gestor' }, segredo, 60, 1000);
  const lido = lerToken(t, segredo, 1010);
  assert.equal(lido?.sub, 'u1');
  assert.equal(lido?.emp, 'e1');
  assert.equal(lido?.per, 'gestor');
  assert.equal(lerToken(t, segredo, 1061), null, 'vencido');
  assert.equal(lerToken(t, 'outro'.repeat(10), 1010), null, 'outro segredo');
  const [h, , a] = t.split('.');
  const corpoFalso = Buffer.from(JSON.stringify({ sub: 'u1', emp: 'e1', per: 'dono', iat: 1000, exp: 9999 })).toString('base64url');
  assert.equal(lerToken(`${h}.${corpoFalso}.${a}`, segredo, 1010), null, 'adulterado');
  assert.equal(lerToken(undefined, segredo), null);
  assert.equal(lerToken('abc', segredo), null);
});

test('Perfis: quem gerencia quem e quem vê o financeiro', () => {
  assert.equal(podeGerenciarPerfil('dono', 'gestor'), true);
  assert.equal(podeGerenciarPerfil('dono', 'dono'), true);
  assert.equal(podeGerenciarPerfil('gestor', 'motorista'), true);
  assert.equal(podeGerenciarPerfil('gestor', 'gestor'), false);
  assert.equal(podeGerenciarPerfil('gestor', 'dono'), false);
  assert.equal(podeGerenciarPerfil('motorista', 'motorista'), false);
  assert.equal(podeGerenciarPerfil('dono', 'admin_sistema'), false);
  assert.equal(acessaFinanceiro('dono'), true);
  assert.equal(acessaFinanceiro('gestor'), true);
  assert.equal(acessaFinanceiro('motorista'), false);
  assert.equal(podeEditarEmpresa('dono'), true);
  assert.equal(podeEditarEmpresa('gestor'), false);
});
