import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exigir } from '../src/sessao.ts';

// Banco falso: devolve o usuário com a senha inicial ainda não trocada.
const banco = {
  async query() {
    return {
      rowCount: 1,
      rows: [
        {
          id: 'u1', nome: 'Dono', email: 'dono@x.com', perfil: 'dono', empresa_id: 'e1', ativo: true,
          administrador: true, modulos: null, senha_provisoria: true, empresa_ativa: true, modulos_contratados: null,
        },
      ],
    };
  },
};
const req = (method: string, url: string) => ({ method, url, sessao: { sub: 'u1' } }) as never;

test('senha provisória: rotas fora da troca de senha respondem 403', async () => {
  await assert.rejects(exigir(banco as never)(req('GET', '/api/obras')), (e: { status?: number; dados?: unknown }) => {
    assert.equal(e.status, 403);
    assert.deepEqual(e.dados, { senhaProvisoria: true });
    return true;
  });
});

test('senha provisória: a troca de senha e a leitura da conta seguem liberadas', async () => {
  await exigir(banco as never)(req('PUT', '/api/auth/senha?x=1'));
  await exigir(banco as never)(req('GET', '/api/auth/eu'));
  await exigir(banco as never)(req('POST', '/api/auth/sair'));
});

test('senha provisória: o mesmo caminho com outro método continua bloqueado', async () => {
  await assert.rejects(exigir(banco as never)(req('GET', '/api/auth/senha')), { status: 403 });
});
