// Confere o fluxo OAuth inteiro contra uma API e um servidor MCP já no ar (o equivalente ao test-oauth.ts do AIRO).
//   API=http://localhost:3000 MCP=http://localhost:3001 EMAIL=dono@empresa.com SENHA=... npm run teste:oauth -w apps/mcp
// Requisitos: o servidor MCP com "localhost" em ALLOWED_REDIRECT_DOMAINS e a API com o callback dele em MCP_CALLBACK_URLS.
// Faz login de verdade com o usuário informado e, no fim, revoga os tokens que criou.
import crypto from 'node:crypto';

const API = (process.env.API ?? 'http://localhost:3000').replace(/\/+$/, '');
const MCP = (process.env.MCP ?? 'http://localhost:3001').replace(/\/+$/, '');
const EMAIL = process.env.EMAIL ?? '';
const SENHA = process.env.SENHA ?? '';
if (!EMAIL || !SENHA) {
  console.error('Defina EMAIL e SENHA de um usuário de construtora.');
  process.exit(2);
}

let falhas = 0;
const conferir = (rotulo: string, ok: boolean, detalhe: unknown = '') => {
  console.log(`${ok ? '  ok ' : 'FALHA'} ${rotulo}${ok ? '' : ` — ${String(detalhe)}`}`);
  if (!ok) falhas++;
};
const json = async (r: Response) => ({ status: r.status, corpo: (await r.json().catch(() => ({}))) as Record<string, any>, cabecalhos: r.headers });
const post = (url: string, corpo: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) }).then(json);

// 1. Descoberta
const semToken = await post(`${MCP}/mcp`, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
conferir('MCP sem token responde 401 com WWW-Authenticate', semToken.status === 401 && /resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource\/mcp"/.test(semToken.cabecalhos.get('www-authenticate') ?? ''), semToken.cabecalhos.get('www-authenticate'));
const recurso = await fetch(`${MCP}/.well-known/oauth-protected-resource/mcp`).then(json);
conferir('metadados do recurso apontam o servidor de autorização', recurso.corpo.resource === `${MCP}/mcp` && recurso.corpo.authorization_servers?.[0] === MCP, JSON.stringify(recurso.corpo));
const meta = await fetch(`${MCP}/.well-known/oauth-authorization-server`).then(json);
conferir('metadados do servidor de autorização (S256, registro dinâmico)', meta.corpo.registration_endpoint === `${MCP}/oauth/register` && meta.corpo.code_challenge_methods_supported?.[0] === 'S256', JSON.stringify(meta.corpo));

// 2. Registro dinâmico (cliente público, como o Claude)
const REDIRECT = 'http://localhost:9999/retorno';
const reg = await post(meta.corpo.registration_endpoint, { redirect_uris: [REDIRECT], client_name: 'Cliente de teste', token_endpoint_auth_method: 'none' });
conferir('registro dinâmico de cliente', reg.status === 201 && String(reg.corpo.client_id).startsWith('mcp2_'), JSON.stringify(reg.corpo));
const clientId = reg.corpo.client_id as string;
const regRuim = await post(meta.corpo.registration_endpoint, { redirect_uris: ['https://malicioso.example/cb'] });
conferir('registro com domínio fora da lista é recusado', regRuim.status === 400, regRuim.status);

// 3. Authorize → tela de login
const verifier = crypto.randomBytes(32).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
const autorizar = (extra: Record<string, string> = {}) => {
  const u = new URL(meta.corpo.authorization_endpoint);
  const campos = { client_id: clientId, redirect_uri: REDIRECT, response_type: 'code', state: 'estado-do-cliente', code_challenge: challenge, code_challenge_method: 'S256', resource: `${MCP}/mcp`, ...extra };
  for (const [k, v] of Object.entries(campos)) u.searchParams.set(k, v);
  return fetch(u, { redirect: 'manual' });
};
conferir('cliente público sem PKCE é recusado', (await autorizar({ code_challenge: '' })).status === 400);
const ida = await autorizar();
const tela = new URL(ida.headers.get('location') ?? 'http://invalido');
conferir('authorize redireciona para a tela de login do Agrega', ida.status === 302 && tela.pathname === '/oauth/authorize' && tela.searchParams.get('redirect_uri') === `${MCP}/oauth/callback` && tela.searchParams.get('client_name') === 'Cliente de teste', ida.headers.get('location'));
const callback = tela.searchParams.get('redirect_uri') ?? '';
const chave = tela.searchParams.get('state') ?? '';

// 4. O que a tela faz: confere o destino e faz o login
const destino = await fetch(`${API}/api/auth/oauth-destino?redirect_uri=${encodeURIComponent(callback)}`).then(json);
conferir('API reconhece o callback do MCP como destino permitido (MCP_CALLBACK_URLS)', destino.corpo.permitido === true, JSON.stringify(destino.corpo));
const destinoRuim = await fetch(`${API}/api/auth/oauth-destino?redirect_uri=${encodeURIComponent('https://malicioso.example/oauth/callback')}`).then(json);
conferir('API recusa destino desconhecido', destinoRuim.corpo.permitido === false, JSON.stringify(destinoRuim.corpo));
const loginDestinoRuim = await post(`${API}/api/auth/oauth-login`, { email: EMAIL, senha: SENHA, redirectUri: 'https://malicioso.example/oauth/callback' });
conferir('login com destino desconhecido não emite código', loginDestinoRuim.status === 400 && !loginDestinoRuim.corpo.code, JSON.stringify(loginDestinoRuim.corpo));
const login = await post(`${API}/api/auth/oauth-login`, { email: EMAIL, senha: SENHA, redirectUri: callback });
conferir('login devolve código de uso único, sem cookie e sem token', login.status === 200 && login.corpo.code?.length === 64 && !login.cabecalhos.get('set-cookie') && !login.corpo.token, JSON.stringify(login.corpo));

// 5. Callback → código do MCP
const volta = await fetch(`${callback}?code=${login.corpo.code}&state=${chave}`, { redirect: 'manual' });
const final = new URL(volta.headers.get('location') ?? 'http://invalido');
conferir('callback devolve ao cliente o código do MCP e o state dele', volta.status === 302 && final.origin + final.pathname === REDIRECT && final.searchParams.get('state') === 'estado-do-cliente' && !!final.searchParams.get('code'), volta.headers.get('location'));
conferir('quem não é o servidor MCP não troca código na API (sem o segredo: 401)', (await post(`${API}/api/auth/oauth-exchange`, { code: login.corpo.code, redirectUri: callback })).status === 401);

// 6. Token
const tok = await post(meta.corpo.token_endpoint, { grant_type: 'authorization_code', code: final.searchParams.get('code'), client_id: clientId, code_verifier: verifier, redirect_uri: REDIRECT });
conferir('token: access at2_ e refresh rt2_, sem o token da API à vista', tok.status === 200 && String(tok.corpo.access_token).startsWith('at2_') && String(tok.corpo.refresh_token).startsWith('rt2_') && tok.corpo.expires_in <= 3600, JSON.stringify(tok.corpo).slice(0, 200));
conferir('código do MCP também é de uso único', (await post(meta.corpo.token_endpoint, { grant_type: 'authorization_code', code: final.searchParams.get('code'), client_id: clientId, code_verifier: verifier })).status === 400);

// 7. MCP com o token
const mcp = async (corpo: unknown, token: string, sessao?: string | null) => {
  const r = await fetch(`${MCP}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}`, ...(sessao ? { 'mcp-session-id': sessao } : {}) },
    body: JSON.stringify(corpo),
  });
  const texto = await r.text();
  const dado = texto.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).pop() ?? texto;
  let corpoJson: Record<string, any> = {};
  try { corpoJson = JSON.parse(dado); } catch { /* resposta sem corpo */ }
  return { status: r.status, corpo: corpoJson, sessao: r.headers.get('mcp-session-id') };
};
const ini = await mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste', version: '1' } } }, tok.corpo.access_token);
conferir('initialize abre sessão MCP', ini.status === 200 && !!ini.sessao, JSON.stringify(ini.corpo).slice(0, 200));
await mcp({ jsonrpc: '2.0', method: 'notifications/initialized' }, tok.corpo.access_token, ini.sessao);
const lista = await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, tok.corpo.access_token, ini.sessao);
const nomes: string[] = (lista.corpo.result?.tools ?? []).map((f: { name: string }) => f.name);
conferir(`tools/list devolve o catálogo (${nomes.length} ferramentas)`, nomes.includes('usuario_atual'), JSON.stringify(lista.corpo).slice(0, 200));
const eu = await mcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'usuario_atual', arguments: {} } }, tok.corpo.access_token, ini.sessao);
const resposta = JSON.parse(eu.corpo.result?.content?.[0]?.text ?? '{}');
conferir('usuario_atual chama a API em nome de quem autorizou', resposta.success === true && resposta.data?.usuario?.email?.toLowerCase() === EMAIL.toLowerCase(), JSON.stringify(resposta).slice(0, 300));
conferir('token que não foi emitido pelo MCP é recusado', (await mcp({ jsonrpc: '2.0', id: 9, method: 'tools/list' }, 'eyJhbGciOiJIUzI1NiJ9.e30.x')).status === 401);

// 8. Renovação com rotação
const ren = await post(meta.corpo.token_endpoint, { grant_type: 'refresh_token', refresh_token: tok.corpo.refresh_token, client_id: clientId });
conferir('refresh devolve access e refresh novos', ren.status === 200 && String(ren.corpo.access_token).startsWith('at2_') && ren.corpo.refresh_token !== tok.corpo.refresh_token, JSON.stringify(ren.corpo).slice(0, 200));
const replay = await post(meta.corpo.token_endpoint, { grant_type: 'refresh_token', refresh_token: tok.corpo.refresh_token, client_id: clientId });
conferir('repetição do mesmo refresh em 60 s devolve a mesma resposta', replay.status === 200 && replay.corpo.access_token === ren.corpo.access_token, replay.status);
const aposRenovar = await mcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'usuario_atual', arguments: {} } }, ren.corpo.access_token, ini.sessao);
conferir('a mesma sessão MCP segue valendo com o access renovado', aposRenovar.status === 200 && JSON.parse(aposRenovar.corpo.result?.content?.[0]?.text ?? '{}').success === true, JSON.stringify(aposRenovar.corpo).slice(0, 200));

// 9. Revogação (também limpa o que este teste criou)
await post(`${MCP}/oauth/revoke`, { token: ren.corpo.access_token, client_id: clientId });
conferir('access revogado para de valer', (await mcp({ jsonrpc: '2.0', id: 5, method: 'tools/list' }, ren.corpo.access_token, ini.sessao)).status === 401);
await post(`${MCP}/oauth/revoke`, { token: ren.corpo.refresh_token, client_id: clientId });
conferir('refresh revogado não renova mais', (await post(meta.corpo.token_endpoint, { grant_type: 'refresh_token', refresh_token: ren.corpo.refresh_token, client_id: clientId })).status === 400);

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.');
process.exit(falhas ? 1 : 0);
