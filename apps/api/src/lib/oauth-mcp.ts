// Lado da API na conexão OAuth do servidor MCP (mesmo desenho do AIRO):
//   1. a tela /oauth/authorize chama POST /api/auth/oauth-login e recebe um CÓDIGO de uso único (60 s);
//   2. o servidor MCP troca o código por POST /api/auth/oauth-exchange e recebe o token de sessão + um token de renovação;
//   3. quando o token de sessão vence, o MCP renova por POST /api/auth/oauth-refresh, sem envolver o usuário.
// O token de renovação é rotativo: cada uso invalida o anterior e emite outro. No banco fica só o hash.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Banco, Cliente } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import type { Perfil } from './token.ts';

const VALIDADE_CODIGO_S = 60;
const VALIDADE_REFRESH_DIAS = 30;
/** Repetição do mesmo token logo após a troca (duas requisições simultâneas, nova tentativa de rede) não é tratada como roubo. */
const TOLERANCIA_REUSO_S = 60;

const hash = (valor: string) => createHash('sha256').update(valor).digest('hex');
const novoSegredo = () => randomBytes(32).toString('hex');

export type UsuarioOAuth = { id: string; empresaId: string; perfil: Perfil; sessaoVersao: number };

/**
 * O servidor MCP se identifica com o segredo compartilhado (cabeçalho X-MCP-Secret). Sem segredo configurado, ninguém passa.
 * A comparação é feita sobre o hash dos dois, em tempo constante, para o tempo de resposta não revelar o valor.
 */
export function segredoConfere(recebido: unknown, esperado: string): boolean {
  if (!esperado || typeof recebido !== 'string' || !recebido) return false;
  return timingSafeEqual(createHash('sha256').update(recebido).digest(), createHash('sha256').update(esperado).digest());
}

/** Endereços de retorno aceitos (os /oauth/callback dos servidores MCP), vindos de MCP_CALLBACK_URLS. */
export function destinoPermitido(redirectUri: string | undefined, permitidos: readonly string[]): boolean {
  if (!redirectUri) return false;
  try {
    const u = new URL(redirectUri);
    return permitidos.includes(`${u.origin}${u.pathname}`) && !u.search && !u.hash;
  } catch {
    return false;
  }
}

/** O código nasce preso ao endereço de retorno do login: só o servidor MCP dono desse endereço consegue trocá-lo. */
export async function emitirCodigo(banco: Cliente, usuarioId: string, redirectUri: string): Promise<{ code: string; codeExpiresIn: number }> {
  const code = novoSegredo();
  await banco.query(`INSERT INTO oauth_codigos (codigo_hash, usuario_id, redirect_uri, expira_em) VALUES ($1, $2, $3, now() + make_interval(secs => $4))`, [hash(code), usuarioId, redirectUri, VALIDADE_CODIGO_S]);
  return { code, codeExpiresIn: VALIDADE_CODIGO_S };
}

/** Só usuário ativo, de empresa ativa e com a senha inicial já trocada conecta um assistente. */
async function usuarioApto(c: Cliente, usuarioId: string): Promise<UsuarioOAuth | null> {
  const u = (
    await c.query(
      `SELECT u.id, u.perfil, u.empresa_id, u.sessao_versao FROM usuarios u JOIN empresas e ON e.id = u.empresa_id
        WHERE u.id = $1 AND u.ativo AND u.excluido_em IS NULL AND NOT u.senha_provisoria AND e.ativo`,
      [usuarioId],
    )
  ).rows[0];
  return u ? { id: u.id, empresaId: u.empresa_id, perfil: u.perfil, sessaoVersao: u.sessao_versao } : null;
}

/** Sem `familiaId` começa uma conexão nova (família nova); com ele, o token continua a cadeia do anterior. */
async function emitirRefresh(c: Cliente, usuario: UsuarioOAuth, ip: string | null, familiaId: string | null = null): Promise<string> {
  const refresh = novoSegredo();
  await c.query(
    `INSERT INTO oauth_refresh (token_hash, usuario_id, expira_em, ip, familia_id, sessao_versao)
     VALUES ($1, $2, now() + make_interval(days => $3), $4, COALESCE($5::uuid, gen_random_uuid()), $6)`,
    [hash(refresh), usuario.id, VALIDADE_REFRESH_DIAS, ip, familiaId, usuario.sessaoVersao],
  );
  return refresh;
}

/**
 * Queima o código (uso único, atômico) e devolve o usuário e um token de renovação.
 * null = código inválido, vencido, já usado ou apresentado com outro endereço de retorno (e aí ele é queimado do mesmo jeito).
 */
export async function trocarCodigo(banco: Banco, code: string, redirectUri: string, ip: string | null): Promise<{ usuario: UsuarioOAuth; refreshToken: string } | null> {
  return emTransacao(banco, async (c) => {
    const queimado = (await c.query(`UPDATE oauth_codigos SET usado_em = now() WHERE codigo_hash = $1 AND usado_em IS NULL AND expira_em > now() RETURNING usuario_id, redirect_uri`, [hash(code)])).rows[0];
    // Faxina: código vencido há mais de uma hora não serve para nada.
    await c.query(`DELETE FROM oauth_codigos WHERE expira_em < now() - interval '1 hour'`);
    if (!queimado || queimado.redirect_uri !== redirectUri) return null;
    const usuario = await usuarioApto(c, queimado.usuario_id);
    if (!usuario) return null;
    return { usuario, refreshToken: await emitirRefresh(c, usuario, ip) };
  });
}

/**
 * Trava da família de tokens até o fim da transação: renovação e derrubada da mesma conexão rodam uma de cada vez.
 * Sem ela, um token nascido de uma renovação em andamento escapava da derrubada que corria ao mesmo tempo.
 */
export const SQL_TRAVA_FAMILIA = 'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))';

/**
 * Rotação: o token usado morre e nasce outro, na mesma família. Devolve null quando o token não vale.
 * Se o token apresentado já tinha sido trocado por rotação (reuso), alguém ficou com uma cópia: a família inteira é
 * revogada, inclusive o token atual, e o caso vai para a auditoria. O usuário precisa autorizar o assistente de novo.
 */
export async function renovar(banco: Banco, refreshToken: string, ip: string | null): Promise<{ usuario: UsuarioOAuth; refreshToken: string } | null> {
  return emTransacao(banco, async (c) => {
    const h = hash(refreshToken);
    await c.query(`DELETE FROM oauth_refresh WHERE expira_em < now() - interval '7 days'`);
    // A família de um token nunca muda: dá para ler antes de travar. O estado do token é lido depois da trava.
    const familia = (await c.query('SELECT familia_id FROM oauth_refresh WHERE token_hash = $1', [h])).rows[0]?.familia_id as string | undefined;
    if (!familia) return null;
    await c.query(SQL_TRAVA_FAMILIA, [familia]);
    const atual = (
      await c.query(
        `SELECT id, usuario_id, sessao_versao, revogado_em IS NOT NULL AS revogado, revogacao, expira_em > now() AS vigente,
                COALESCE(revogado_em < now() - make_interval(secs => $2), false) AS fora_da_tolerancia
           FROM oauth_refresh WHERE token_hash = $1 FOR UPDATE`,
        [h, TOLERANCIA_REUSO_S],
      )
    ).rows[0];
    if (!atual || !atual.vigente) return null;
    if (atual.revogado) {
      // Só o token trocado por rotação que reaparece indica cópia. Revogado por troca de senha ou por derrubada anterior, não.
      if (atual.revogacao === 'rotacao' && atual.fora_da_tolerancia) await derrubarFamilia(c, familia, atual.usuario_id, ip);
      return null;
    }
    // O acesso pode ter mudado desde a emissão: usuário desativado, empresa suspensa ou senha trocada encerram a cadeia.
    const usuario = await usuarioApto(c, atual.usuario_id);
    if (!usuario || usuario.sessaoVersao !== atual.sessao_versao) {
      await c.query(`UPDATE oauth_refresh SET revogado_em = now(), revogacao = 'senha' WHERE id = $1`, [atual.id]);
      return null;
    }
    await c.query(`UPDATE oauth_refresh SET revogado_em = now(), revogacao = 'rotacao' WHERE id = $1`, [atual.id]);
    return { usuario, refreshToken: await emitirRefresh(c, usuario, ip, familia) };
  });
}

/** Quem chama já tem a trava da família. Só audita quando havia token vivo: repetir o reuso não gera novo registro. */
async function derrubarFamilia(c: Cliente, familiaId: string, usuarioId: string, ip: string | null): Promise<void> {
  const r = await c.query(`UPDATE oauth_refresh SET revogado_em = now(), revogacao = 'reuso' WHERE familia_id = $1 AND revogado_em IS NULL`, [familiaId]);
  if (!r.rowCount) return;
  const empresaId = (await c.query('SELECT empresa_id FROM usuarios WHERE id = $1', [usuarioId])).rows[0]?.empresa_id ?? null;
  await auditar(c, { empresaId, usuarioId, acao: 'revogar', entidade: 'oauth_refresh', entidadeId: familiaId, depois: { motivo: 'reuso de token de renovação já trocado', tokensRevogados: r.rowCount, ip } });
}

/** Encerra todas as conexões de assistentes do usuário (troca de senha). */
export async function revogarConexoes(c: Cliente, usuarioId: string): Promise<void> {
  await c.query(`UPDATE oauth_refresh SET revogado_em = now(), revogacao = 'senha' WHERE usuario_id = $1 AND revogado_em IS NULL`, [usuarioId]);
}
