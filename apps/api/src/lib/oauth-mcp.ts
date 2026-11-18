// Lado da API na conexão OAuth do servidor MCP (mesmo desenho do AIRO):
//   1. a tela /oauth/authorize chama POST /api/auth/oauth-login e recebe um CÓDIGO de uso único (60 s);
//   2. o servidor MCP troca o código por POST /api/auth/oauth-exchange e recebe o token de sessão + um token de renovação;
//   3. quando o token de sessão vence, o MCP renova por POST /api/auth/oauth-refresh, sem envolver o usuário.
// O token de renovação é rotativo: cada uso invalida o anterior e emite outro. No banco fica só o hash.
import { createHash, randomBytes } from 'node:crypto';
import type { Banco, Cliente } from '../db.ts';
import { emTransacao } from '../db.ts';
import type { Perfil } from './token.ts';

const VALIDADE_CODIGO_S = 60;
const VALIDADE_REFRESH_DIAS = 30;

const hash = (valor: string) => createHash('sha256').update(valor).digest('hex');
const novoSegredo = () => randomBytes(32).toString('hex');

export type UsuarioOAuth = { id: string; empresaId: string; perfil: Perfil };

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

export async function emitirCodigo(banco: Cliente, usuarioId: string): Promise<{ code: string; codeExpiresIn: number }> {
  const code = novoSegredo();
  await banco.query(`INSERT INTO oauth_codigos (codigo_hash, usuario_id, expira_em) VALUES ($1, $2, now() + make_interval(secs => $3))`, [hash(code), usuarioId, VALIDADE_CODIGO_S]);
  return { code, codeExpiresIn: VALIDADE_CODIGO_S };
}

/** Só usuário ativo, de empresa ativa e com a senha inicial já trocada conecta um assistente. */
async function usuarioApto(c: Cliente, usuarioId: string): Promise<UsuarioOAuth | null> {
  const u = (
    await c.query(
      `SELECT u.id, u.perfil, u.empresa_id FROM usuarios u JOIN empresas e ON e.id = u.empresa_id
        WHERE u.id = $1 AND u.ativo AND u.excluido_em IS NULL AND NOT u.senha_provisoria AND e.ativo`,
      [usuarioId],
    )
  ).rows[0];
  return u ? { id: u.id, empresaId: u.empresa_id, perfil: u.perfil } : null;
}

async function emitirRefresh(c: Cliente, usuarioId: string, ip: string | null): Promise<string> {
  const refresh = novoSegredo();
  await c.query(`INSERT INTO oauth_refresh (token_hash, usuario_id, expira_em, ip) VALUES ($1, $2, now() + make_interval(days => $3), $4)`, [hash(refresh), usuarioId, VALIDADE_REFRESH_DIAS, ip]);
  return refresh;
}

/** Queima o código (uso único, atômico) e devolve o usuário e um token de renovação. null = código inválido, vencido ou já usado. */
export async function trocarCodigo(banco: Banco, code: string, ip: string | null): Promise<{ usuario: UsuarioOAuth; refreshToken: string } | null> {
  return emTransacao(banco, async (c) => {
    const queimado = (await c.query(`UPDATE oauth_codigos SET usado_em = now() WHERE codigo_hash = $1 AND usado_em IS NULL AND expira_em > now() RETURNING usuario_id`, [hash(code)])).rows[0];
    // Faxina: código vencido há mais de uma hora não serve para nada.
    await c.query(`DELETE FROM oauth_codigos WHERE expira_em < now() - interval '1 hour'`);
    if (!queimado) return null;
    const usuario = await usuarioApto(c, queimado.usuario_id);
    if (!usuario) return null;
    return { usuario, refreshToken: await emitirRefresh(c, usuario.id, ip) };
  });
}

/** Rotação: o token usado morre e nasce outro. Reuso de um token já rotacionado devolve null. */
export async function renovar(banco: Banco, refreshToken: string, ip: string | null): Promise<{ usuario: UsuarioOAuth; refreshToken: string } | null> {
  return emTransacao(banco, async (c) => {
    const atual = (await c.query(`UPDATE oauth_refresh SET revogado_em = now() WHERE token_hash = $1 AND revogado_em IS NULL AND expira_em > now() RETURNING usuario_id`, [hash(refreshToken)])).rows[0];
    await c.query(`DELETE FROM oauth_refresh WHERE expira_em < now() - interval '7 days'`);
    if (!atual) return null;
    // O acesso pode ter mudado desde a última renovação: usuário desativado ou empresa suspensa encerram a cadeia.
    const usuario = await usuarioApto(c, atual.usuario_id);
    if (!usuario) return null;
    return { usuario, refreshToken: await emitirRefresh(c, usuario.id, ip) };
  });
}

/** Encerra todas as conexões de assistentes do usuário (troca de senha). */
export async function revogarConexoes(c: Cliente, usuarioId: string): Promise<void> {
  await c.query(`UPDATE oauth_refresh SET revogado_em = now() WHERE usuario_id = $1 AND revogado_em IS NULL`, [usuarioId]);
}
