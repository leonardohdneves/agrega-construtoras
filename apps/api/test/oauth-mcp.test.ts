import { test } from 'node:test';
import assert from 'node:assert/strict';
import { destinoPermitido, segredoConfere } from '../src/lib/oauth-mcp.ts';

const PERMITIDOS = ['https://mcp.exemplo.com.br/oauth/callback'];

test('OAuth do MCP: só o callback cadastrado recebe o código de login', () => {
  assert.equal(destinoPermitido('https://mcp.exemplo.com.br/oauth/callback', PERMITIDOS), true);
  assert.equal(destinoPermitido(undefined, PERMITIDOS), false);
  assert.equal(destinoPermitido('', PERMITIDOS), false);
  assert.equal(destinoPermitido('não é url', PERMITIDOS), false);
  // outro host, outro caminho, outro protocolo
  assert.equal(destinoPermitido('https://malicioso.example/oauth/callback', PERMITIDOS), false);
  assert.equal(destinoPermitido('https://mcp.exemplo.com.br/oauth/callback/x', PERMITIDOS), false);
  assert.equal(destinoPermitido('http://mcp.exemplo.com.br/oauth/callback', PERMITIDOS), false);
  // nada de query ou fragmento escondendo outro destino
  assert.equal(destinoPermitido('https://mcp.exemplo.com.br/oauth/callback?next=https://malicioso.example', PERMITIDOS), false);
  assert.equal(destinoPermitido('https://mcp.exemplo.com.br/oauth/callback#x', PERMITIDOS), false);
  // truques de host
  assert.equal(destinoPermitido('https://mcp.exemplo.com.br@malicioso.example/oauth/callback', PERMITIDOS), false);
  assert.equal(destinoPermitido('https://mcp.exemplo.com.br.malicioso.example/oauth/callback', PERMITIDOS), false);
  // sem lista configurada, ninguém passa
  assert.equal(destinoPermitido('https://mcp.exemplo.com.br/oauth/callback', []), false);
});

test('OAuth do MCP: segredo do servidor MCP confere só quando é exatamente o configurado', () => {
  const S = 'segredo-com-mais-de-trinta-e-dois-caracteres';
  assert.equal(segredoConfere(S, S), true);
  assert.equal(segredoConfere(`${S}x`, S), false);
  assert.equal(segredoConfere(S.slice(0, -1), S), false);
  assert.equal(segredoConfere('', S), false);
  assert.equal(segredoConfere(undefined, S), false);
  assert.equal(segredoConfere([S], S), false, 'cabeçalho repetido chega como lista');
  // Sem segredo configurado ninguém passa, nem com valor vazio.
  assert.equal(segredoConfere('', ''), false);
  assert.equal(segredoConfere(S, ''), false);
});
