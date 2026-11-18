// Sessão com o app de verdade e banco (rode com `npm run test:banco -w apps/api`).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepararAppTeste, semBanco, type ContextoTeste } from './apoio/app-teste.ts';
import { config } from '../src/config.ts';
import { gerarHashSenha } from '../src/lib/senha.ts';
import { criarToken, lerToken } from '../src/lib/token.ts';
import { COOKIE_SESSAO } from '../src/sessao.ts';

const SENHA = 'Senha-de-teste-123';
const HORA = 3600;
const DIA = 24 * HORA;

let ctx: ContextoTeste;
before(async () => {
  if (semBanco) return;
  ctx = await prepararAppTeste('teste_sessao');
  await ctx.banco.query(`UPDATE usuarios SET senha_hash = $1 WHERE email IN ('gestor@a.teste', 'financeiro@a.teste')`, [await gerarHashSenha(SENHA)]);
});
after(async () => {
  if (ctx) await ctx.fechar();
});

let ip = 0;
type Chamada = { metodo?: 'GET' | 'POST' | 'PUT' | 'PATCH'; cookie?: string; bearer?: string; corpo?: unknown; segredoMcp?: boolean };
/** Chama a API escolhendo como a sessão vai (cookie ou Bearer) e devolve também o cookie de sessão que a resposta gravar. */
async function chamar(url: string, o: Chamada = {}) {
  const headers: Record<string, string> = {};
  if (o.cookie) headers.cookie = `${COOKIE_SESSAO}=${o.cookie}`;
  if (o.bearer) headers.authorization = `Bearer ${o.bearer}`;
  if (o.segredoMcp) headers['x-mcp-secret'] = config.mcpApiSecret;
  const r = await ctx.app.inject({ method: o.metodo ?? 'GET', url, headers, remoteAddress: `10.8.0.${++ip}`, ...(o.corpo === undefined ? {} : { payload: o.corpo as object }) });
  const novoCookie = r.cookies.find((c) => c.name === COOKIE_SESSAO && c.value)?.value;
  return { status: r.statusCode, corpo: r.json(), novoCookie };
}
const EU = '/api/auth/eu';

test('P20: trocar a própria senha derruba os tokens antigos (cookie e Bearer) e mantém quem trocou', { skip: semBanco }, async () => {
  const antigo = ctx.usuarios.a.gestor.token;
  assert.equal((await chamar(EU, { cookie: antigo })).status, 200);
  const troca = await chamar('/api/auth/senha', { metodo: 'PUT', cookie: antigo, corpo: { senhaAtual: SENHA, novaSenha: 'Outra-senha-456' } });
  assert.equal(troca.status, 200, JSON.stringify(troca.corpo));
  assert.ok(troca.novoCookie, 'quem trocou recebe um cookie novo e continua logado');
  assert.equal((await chamar(EU, { cookie: antigo })).status, 401, 'cookie antigo');
  assert.equal((await chamar(EU, { bearer: antigo })).status, 401, 'Bearer antigo');
  assert.equal((await chamar(EU, { cookie: troca.novoCookie })).status, 200, 'cookie novo');
});

test('P20: senha redefinida pelo administrador derruba a sessão e as conexões de assistentes do usuário', { skip: semBanco }, async () => {
  const alvo = ctx.usuarios.a.comprador;
  await ctx.banco.query(`INSERT INTO oauth_refresh (token_hash, usuario_id, expira_em) VALUES ('hash-de-teste-p20', $1, now() + interval '30 days')`, [alvo.id]);
  assert.equal((await chamar(EU, { bearer: alvo.token })).status, 200);
  const r = await ctx.pedir('dono', 'PATCH', `/api/usuarios/${alvo.id}`, { corpo: { senha: 'Senha-nova-789' } });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal((await chamar(EU, { bearer: alvo.token })).status, 401, 'sessão do usuário');
  assert.equal((await ctx.banco.query(`SELECT revogado_em FROM oauth_refresh WHERE token_hash = 'hash-de-teste-p20'`)).rows[0].revogado_em !== null, true, 'conexão de assistente');
  assert.equal((await ctx.pedir('dono', 'GET', EU)).status, 200, 'a sessão de quem redefiniu segue valendo');
  // Alterar outros dados não derruba ninguém.
  const outro = ctx.usuarios.a.vendedor;
  assert.equal((await ctx.pedir('dono', 'PATCH', `/api/usuarios/${outro.id}`, { corpo: { nome: 'Vendedor renomeado' } })).status, 200);
  assert.equal((await chamar(EU, { bearer: outro.token })).status, 200);
});

test('P20: trocar a senha derruba também o token de sessão entregue ao servidor MCP', { skip: semBanco }, async () => {
  const callback = 'http://localhost:3001/oauth/callback';
  const login = await chamar('/api/auth/oauth-login', { metodo: 'POST', corpo: { email: 'financeiro@a.teste', senha: SENHA, redirectUri: callback } });
  const troca = await chamar('/api/auth/oauth-exchange', { metodo: 'POST', segredoMcp: true, corpo: { code: login.corpo.code, redirectUri: callback } });
  assert.equal(troca.status, 200, JSON.stringify(troca.corpo));
  assert.equal((await chamar(EU, { bearer: troca.corpo.token })).status, 200);
  const senha = await chamar('/api/auth/senha', { metodo: 'PUT', cookie: ctx.usuarios.a.financeiro.token, corpo: { senhaAtual: SENHA, novaSenha: 'Outra-senha-456' } });
  assert.equal(senha.status, 200, JSON.stringify(senha.corpo));
  assert.equal((await chamar(EU, { bearer: troca.corpo.token })).status, 401, 'token de sessão do assistente');
  assert.equal((await chamar('/api/auth/oauth-refresh', { metodo: 'POST', segredoMcp: true, corpo: { refreshToken: troca.corpo.refreshToken } })).status, 401, 'renovação do assistente');
});

test('P20: a sessão do navegador se renova com o uso; a do Bearer não', { skip: semBanco }, async () => {
  const u = ctx.usuarios.a.orcamentista;
  const dados = { sub: u.id, emp: ctx.empresas.a, per: 'orcamentista' as const };
  const quaseVencido = criarToken(dados, config.jwtSecret, HORA);
  const novo = criarToken(dados, config.jwtSecret, 12 * HORA);
  // Cookie na metade final da validade: a resposta já traz outro, com as 12 horas de novo.
  const r = await chamar(EU, { cookie: quaseVencido });
  assert.equal(r.status, 200);
  assert.ok(r.novoCookie, 'cookie renovado');
  const lido = lerToken(r.novoCookie, config.jwtSecret)!;
  assert.ok(lido.exp - Math.floor(Date.now() / 1000) > 11 * HORA);
  // Cookie recém-emitido não é trocado a cada requisição.
  assert.equal((await chamar(EU, { cookie: novo })).novoCookie, undefined);
  // O servidor MCP renova pelo OAuth, não por cookie.
  assert.equal((await chamar(EU, { bearer: quaseVencido })).novoCookie, undefined);
});

test('P20: a renovação tem teto: sessão aberta há mais de 30 dias pede o login de novo', { skip: semBanco }, async () => {
  const u = ctx.usuarios.a.administrativo;
  const agora = Math.floor(Date.now() / 1000);
  const dados = { sub: u.id, emp: ctx.empresas.a, per: 'administrativo' as const };
  const recente = criarToken({ ...dados, ini: agora - 29 * DIA }, config.jwtSecret, HORA);
  const antiga = criarToken({ ...dados, ini: agora - 31 * DIA }, config.jwtSecret, HORA);
  const r = await chamar(EU, { cookie: recente });
  assert.ok(r.novoCookie, 'dentro do teto, renova');
  assert.equal(lerToken(r.novoCookie, config.jwtSecret)!.ini, agora - 29 * DIA, 'o início da sessão não muda na renovação');
  const velha = await chamar(EU, { cookie: antiga });
  assert.equal(velha.status, 200, 'o token ainda vale até vencer');
  assert.equal(velha.novoCookie, undefined, 'mas não é renovado');
});
