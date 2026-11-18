import { test } from 'node:test';
import assert from 'node:assert/strict';
import { destinoPermitido } from '../src/lib/oauth-mcp.ts';

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
