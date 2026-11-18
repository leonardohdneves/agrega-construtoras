import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { montarDocumentacao } from '../scripts/gerar-openapi.ts';

const { especificacao } = await montarDocumentacao();
const operacoes = Object.entries(especificacao.paths).flatMap(([caminho, ops]) => Object.entries(ops).map(([metodo, op]) => ({ rota: `${metodo.toUpperCase()} ${caminho}`, op })));

test('documentação da API: docs/openapi.json está em dia com o código', () => {
  const gravado = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '..', 'docs', 'openapi.json'), 'utf8'));
  // Falhou? Rode `npm run docs -w apps/api` e inclua docs/ no commit.
  assert.deepEqual(gravado, JSON.parse(JSON.stringify(especificacao)));
});

test('documentação da API: só estas rotas respondem sem login', () => {
  const publicas = operacoes.filter((o) => (o.op['x-acesso'] as { publica: boolean }).publica).map((o) => o.rota).sort();
  // Uma rota nova que apareça aqui ficou sem o guarda `exigir`.
  assert.deepEqual(publicas, [
    'GET /api/aceite/{codigo}',
    'GET /api/assinatura/{token}',
    'GET /api/auth/oauth-destino',
    'GET /api/saude',
    'POST /api/aceite/{codigo}',
    'POST /api/assinatura/{token}',
    'POST /api/auth/entrar',
    'POST /api/auth/oauth-exchange',
    'POST /api/auth/oauth-login',
    'POST /api/auth/oauth-refresh',
    'POST /api/auth/sair',
    'POST /api/interesse',
  ]);
});

test('documentação da API: toda rota tem grupo e identificador único', () => {
  const ids = operacoes.map((o) => o.op.operationId);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(operacoes.every((o) => o.op.tags?.length === 1 && o.op.tags[0] !== 'Outros'), 'há rota sem grupo: inclua o prefixo em scripts/gerar-openapi.ts');
});
