// OAuth do servidor MCP com o app de verdade e banco (rode com `npm run test:banco -w apps/api`).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepararAppTeste, semBanco, type ContextoTeste } from './apoio/app-teste.ts';
import { config } from '../src/config.ts';
import { gerarHashSenha } from '../src/lib/senha.ts';

const CALLBACK = 'http://localhost:3001/oauth/callback';
const SENHA = 'Senha-de-teste-123';
const EMAIL = 'gestor@a.teste';

let ctx: ContextoTeste;
before(async () => {
  if (semBanco) return;
  ctx = await prepararAppTeste('teste_oauth_mcp');
  // Só este teste entra pelo login: o usuário precisa de uma senha de verdade.
  await ctx.banco.query('UPDATE usuarios SET senha_hash = $1 WHERE email = $2', [await gerarHashSenha(SENHA), EMAIL]);
});
after(async () => {
  if (ctx) await ctx.fechar();
});

type Resposta = { status: number; corpo: any };
let ip = 0;
/** Chamada sem sessão, como a tela de login e o servidor MCP fazem. Cada uma sai de um endereço, para o limite de tentativas não interferir. */
async function pedir(url: string, corpo: unknown, segredo: string | null = null): Promise<Resposta> {
  const r = await ctx.app.inject({ method: 'POST', url, payload: corpo as object, remoteAddress: `10.9.0.${++ip}`, headers: segredo === null ? {} : { 'x-mcp-secret': segredo } });
  return { status: r.statusCode, corpo: r.json() };
}
const login = async (redirectUri = CALLBACK) => (await pedir('/api/auth/oauth-login', { email: EMAIL, senha: SENHA, redirectUri })).corpo.code as string;
const trocar = (code: string, segredo: string | null = config.mcpApiSecret, redirectUri = CALLBACK) => pedir('/api/auth/oauth-exchange', { code, redirectUri }, segredo);
const renovar = (refreshToken: string, segredo: string | null = config.mcpApiSecret) => pedir('/api/auth/oauth-refresh', { refreshToken }, segredo);

test('P38: sem o segredo do servidor MCP, o código não é trocado e o token não é renovado', { skip: semBanco }, async () => {
  const code = await login();
  assert.equal((await trocar(code, null)).status, 401, 'troca sem o cabeçalho');
  assert.equal((await trocar(code, 'segredo-errado')).status, 401, 'troca com segredo errado');
  // A tentativa recusada não gasta o código: o servidor MCP legítimo ainda consegue trocar.
  const ok = await trocar(code);
  assert.equal(ok.status, 200, JSON.stringify(ok.corpo));
  assert.ok(ok.corpo.token && ok.corpo.refreshToken);
  assert.equal((await renovar(ok.corpo.refreshToken, null)).status, 401, 'renovação sem o cabeçalho');
  assert.equal((await renovar(ok.corpo.refreshToken, 'segredo-errado')).status, 401, 'renovação com segredo errado');
  assert.equal((await renovar(ok.corpo.refreshToken)).status, 200, 'a renovação recusada não gastou o token');
});

test('P38: o código só vale para o endereço de retorno usado no login', { skip: semBanco }, async () => {
  const code = await login();
  const outro = await trocar(code, config.mcpApiSecret, 'http://localhost:3999/oauth/callback');
  assert.equal(outro.status, 400, JSON.stringify(outro.corpo));
  // Código apresentado com o endereço errado é queimado: nem o endereço certo o aproveita depois.
  assert.equal((await trocar(code)).status, 400);
});
