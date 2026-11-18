// OAuth do servidor MCP com o app de verdade e banco (rode com `npm run test:banco -w apps/api`).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepararAppTeste, semBanco, type ContextoTeste } from './apoio/app-teste.ts';
import { config } from '../src/config.ts';
import { gerarHashSenha } from '../src/lib/senha.ts';
import { revogarConexoes, SQL_TRAVA_FAMILIA } from '../src/lib/oauth-mcp.ts';

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

test('P39: reusar um token de renovação já trocado derruba a cadeia inteira e fica na auditoria', { skip: semBanco }, async () => {
  const primeiro = (await trocar(await login())).corpo.refreshToken as string;
  const segundo = (await renovar(primeiro)).corpo.refreshToken as string;
  const terceiro = (await renovar(segundo)).corpo.refreshToken as string;
  assert.ok(terceiro);
  // Um token trocado há mais de um minuto reaparece: alguém guardou uma cópia.
  await ctx.banco.query(`UPDATE oauth_refresh SET revogado_em = now() - interval '5 minutes' WHERE revogado_em IS NOT NULL`);
  assert.equal((await renovar(primeiro)).status, 401);
  // O token atual, que era válido, cai junto.
  assert.equal((await renovar(terceiro)).status, 401, 'o descendente válido precisa ser revogado');
  const aud = await ctx.banco.query(`SELECT usuario_id, depois FROM auditoria WHERE entidade = 'oauth_refresh' AND acao = 'revogar'`);
  assert.equal(aud.rowCount, 1);
  assert.equal(aud.rows[0].usuario_id, ctx.usuarios.a.gestor.id);
});

test('P39: outra conexão do mesmo usuário não é afetada pelo reuso', { skip: semBanco }, async () => {
  const conexaoA = (await trocar(await login())).corpo.refreshToken as string;
  const conexaoB = (await trocar(await login())).corpo.refreshToken as string;
  const novoA = (await renovar(conexaoA)).corpo.refreshToken as string;
  await ctx.banco.query(`UPDATE oauth_refresh SET revogado_em = now() - interval '5 minutes' WHERE revogado_em IS NOT NULL`);
  assert.equal((await renovar(conexaoA)).status, 401);
  assert.equal((await renovar(novoA)).status, 401);
  assert.equal((await renovar(conexaoB)).status, 200, 'a conexão B é de outra cadeia');
});

test('P39: repetição imediata do mesmo token (duas requisições simultâneas) não derruba a cadeia', { skip: semBanco }, async () => {
  const primeiro = (await trocar(await login())).corpo.refreshToken as string;
  const segundo = (await renovar(primeiro)).corpo.refreshToken as string;
  assert.equal((await renovar(primeiro)).status, 401, 'o token já trocado não renova de novo');
  assert.equal((await renovar(segundo)).status, 200, 'mas o novo continua valendo');
});

test('revisão: token revogado por troca de senha, reapresentado, não vira alerta de reuso na auditoria', { skip: semBanco }, async () => {
  const token = (await trocar(await login())).corpo.refreshToken as string;
  const antes = (await ctx.banco.query(`SELECT count(*)::int AS n FROM auditoria WHERE entidade = 'oauth_refresh'`)).rows[0].n;
  await revogarConexoes(ctx.banco, ctx.usuarios.a.gestor.id);
  await ctx.banco.query(`UPDATE oauth_refresh SET revogado_em = now() - interval '5 minutes' WHERE revogado_em IS NOT NULL`);
  assert.equal((await renovar(token)).status, 401);
  assert.equal((await renovar(token)).status, 401);
  const depois = (await ctx.banco.query(`SELECT count(*)::int AS n FROM auditoria WHERE entidade = 'oauth_refresh'`)).rows[0].n;
  assert.equal(depois, antes, 'troca de senha não é roubo de token');
});

test('revisão: reuso repetido da mesma cadeia já derrubada não enche a auditoria', { skip: semBanco }, async () => {
  const primeiro = (await trocar(await login())).corpo.refreshToken as string;
  await renovar(primeiro);
  await ctx.banco.query(`UPDATE oauth_refresh SET revogado_em = now() - interval '5 minutes' WHERE revogado_em IS NOT NULL`);
  const antes = (await ctx.banco.query(`SELECT count(*)::int AS n FROM auditoria WHERE entidade = 'oauth_refresh'`)).rows[0].n;
  for (let i = 0; i < 3; i++) assert.equal((await renovar(primeiro)).status, 401);
  const depois = (await ctx.banco.query(`SELECT count(*)::int AS n FROM auditoria WHERE entidade = 'oauth_refresh'`)).rows[0].n;
  assert.equal(depois, antes + 1, 'um registro pela derrubada, nenhum pelas repetições');
});

test('revisão: token de renovação emitido antes da troca de senha não renova, mesmo que tenha escapado da revogação', { skip: semBanco }, async () => {
  const token = (await trocar(await login())).corpo.refreshToken as string;
  // Simula a corrida: a senha muda (versão da sessão sobe) e este token, nascido de uma renovação em andamento, não foi revogado.
  await ctx.banco.query('UPDATE usuarios SET sessao_versao = sessao_versao + 1 WHERE id = $1', [ctx.usuarios.a.gestor.id]);
  try {
    assert.equal((await renovar(token)).status, 401);
    assert.equal((await ctx.banco.query(`SELECT count(*)::int AS n FROM oauth_refresh WHERE usuario_id = $1 AND revogado_em IS NULL`, [ctx.usuarios.a.gestor.id])).rows[0].n, 0, 'nenhum token vivo sobra');
  } finally {
    await ctx.banco.query('UPDATE usuarios SET sessao_versao = sessao_versao - 1 WHERE id = $1', [ctx.usuarios.a.gestor.id]);
  }
});

test('revisão: renovação e derrubada da mesma família não rodam ao mesmo tempo', { skip: semBanco }, async () => {
  const token = (await trocar(await login())).corpo.refreshToken as string;
  const familia = (await ctx.banco.query(`SELECT familia_id FROM oauth_refresh WHERE usuario_id = $1 AND revogado_em IS NULL ORDER BY criado_em DESC LIMIT 1`, [ctx.usuarios.a.gestor.id])).rows[0].familia_id as string;
  // Outra transação segura a família (é o que a detecção de reuso faz enquanto revoga).
  const outra = await ctx.banco.connect();
  try {
    await outra.query('BEGIN');
    await outra.query(SQL_TRAVA_FAMILIA, [familia]);
    let terminou = false;
    const pendente = renovar(token).then((r) => { terminou = true; return r; });
    await new Promise((ok) => setTimeout(ok, 400));
    assert.equal(terminou, false, 'a renovação espera a outra transação terminar');
    await outra.query('COMMIT');
    assert.equal((await pendente).status, 200);
  } finally {
    await outra.query('ROLLBACK').catch(() => {});
    outra.release();
  }
});

test('revisão: sem MCP_API_SECRET configurado, a API responde 503 (não configurado), não 401', { skip: semBanco }, async () => {
  const code = await login();
  const original = config.mcpApiSecret;
  config.mcpApiSecret = '';
  try {
    assert.equal((await trocar(code, 'qualquer-coisa')).status, 503);
    assert.equal((await renovar('x'.repeat(64), 'qualquer-coisa')).status, 503);
  } finally {
    config.mcpApiSecret = original;
  }
  assert.equal((await trocar(code)).status, 200, 'a recusa não gastou o código');
  const errado = await trocar(await login(), 'segredo-errado');
  assert.equal(errado.status, 401);
  assert.equal(errado.corpo.codigo, 'servidor_mcp_nao_autorizado', 'o servidor MCP distingue segredo recusado de sessão encerrada');
});
