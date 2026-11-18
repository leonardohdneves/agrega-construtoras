import { test } from 'node:test';
import assert from 'node:assert/strict';

// O segredo é lido na carga do módulo: definir antes de importar.
process.env.OAUTH_SIGNING_SECRET = 'segredo-de-teste-com-mais-de-32-caracteres-0123456789';
const t = await import('../src/lib/oauth-tokens.ts');

/** JWT de mentira (só o payload importa: quem valida a assinatura é a API). */
const jwt = (dados: object) => `x.${Buffer.from(JSON.stringify(dados)).toString('base64url')}.y`;
const agora = () => Math.floor(Date.now() / 1000);

test('client_id carrega o cadastro assinado e não aceita adulteração', () => {
  const id = t.emitirClientId({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], client_name: 'Claude', token_endpoint_auth_method: 'none' });
  assert.ok(id.startsWith('mcp2_'));
  assert.deepEqual(t.lerClientId(id)?.redirect_uris, ['https://claude.ai/api/mcp/auth_callback']);
  assert.equal(t.lerClientId(`${id}x`), null);
  assert.equal(t.lerClientId(123), null);
  assert.equal(t.derivarClientSecret(id), t.derivarClientSecret(id));
});

test('access token: cifrado, com validade limitada pelo token que carrega, e revogável', () => {
  const sessao = jwt({ sub: 'usuario-1', exp: agora() + 120 });
  const { token, expires_in } = t.emitirAccessToken(sessao, 'cliente', 'https://mcp.exemplo/mcp');
  assert.ok(token.startsWith('at2_') && !token.includes(sessao.split('.')[1]), 'o token de sessão não pode aparecer em claro');
  assert.ok(expires_in <= 120, 'nunca vive mais que o token de sessão');
  const lido = t.lerAccessToken(token)!;
  assert.equal(lido.t, sessao);
  assert.equal(lido.aud, 'https://mcp.exemplo/mcp');
  assert.equal(t.subDoJwt(lido.t), 'usuario-1');
  assert.equal(t.lerAccessToken(`${token.slice(0, -2)}AA`), null, 'adulterado não decifra');
  t.revogarJti(lido.jti, lido.exp);
  assert.equal(t.lerAccessToken(token), null, 'revogado deixa de valer');
});

test('refresh token: leva o token de renovação da API e respeita a revogação', () => {
  const sessao = jwt({ sub: 'usuario-1', exp: agora() + 3600 });
  const rt = t.emitirRefreshToken(sessao, 'cliente', 'refresh-da-api');
  assert.ok(rt.startsWith('rt2_'));
  const lido = t.lerRefreshToken(rt)!;
  assert.equal(lido.brt, 'refresh-da-api');
  assert.equal(lido.client_id, 'cliente');
  t.revogarJti(lido.jti, lido.exp!);
  assert.equal(t.lerRefreshToken(rt), null);
  assert.ok(t.lerRefreshToken(rt, { ignorarRevogacao: true }), 'o endpoint de token ainda lê para o replay de 60 s');
});

test('segundosAteExpirar lê o exp do token e tolera lixo', () => {
  assert.equal(t.segundosAteExpirar(jwt({ exp: agora() - 10 })), 0);
  assert.ok((t.segundosAteExpirar(jwt({ exp: agora() + 100 })) ?? 0) > 90);
  assert.equal(t.segundosAteExpirar('nao-e-jwt'), null);
  assert.equal(t.segundosAteExpirar(42), null);
});
