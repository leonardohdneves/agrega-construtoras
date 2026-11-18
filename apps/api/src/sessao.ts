// Sessão: lê o cookie em toda requisição e oferece o guarda `exigir(...)` para as rotas.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.ts';
import type { Banco } from './db.ts';
import { naoAutenticado, semPermissao, ErroHttp } from './lib/erros.ts';
import { lerToken, criarToken, type DadosSessao, type Perfil } from './lib/token.ts';
import { acessoPermitido, contratoComBase, listaDoUsuario, modulosEfetivos, type Modulo } from './lib/modulos.ts';

export const COOKIE_SESSAO = 'agrega_sessao';
const VALIDADE = 60 * 60 * 12; // 12 horas

export type UsuarioSessao = {
  id: string;
  nome: string;
  email: string;
  perfil: Perfil;
  empresaId: string | null;
  administrador: boolean;
  modulos: Modulo[];
  senhaProvisoria: boolean;
};

/** Enquanto a senha inicial não for trocada, só estas rotas respondem. */
const ROTAS_COM_SENHA_PROVISORIA = new Set(['GET /api/auth/eu', 'PUT /api/auth/senha', 'POST /api/auth/sair']);

declare module 'fastify' {
  interface FastifyRequest {
    sessao: DadosSessao | null;
    usuario: UsuarioSessao | null;
  }
}

export function instalarSessao(app: FastifyInstance): void {
  app.decorateRequest('sessao', null);
  app.decorateRequest('usuario', null);
  app.addHook('onRequest', async (req) => {
    // Navegador: cookie. Servidor MCP: o mesmo token no cabeçalho `Authorization: Bearer`.
    const portador = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
    req.sessao = lerToken(req.cookies?.[COOKIE_SESSAO] ?? portador, config.jwtSecret);
  });
}

/** Token de sessão (12 horas): vai no cookie do navegador ou, para o servidor MCP, no corpo da resposta do OAuth. */
export function criarTokenSessao(u: Pick<UsuarioSessao, 'id' | 'empresaId' | 'perfil'>): string {
  return criarToken({ sub: u.id, emp: u.empresaId, per: u.perfil }, config.jwtSecret, VALIDADE);
}

export function gravarSessao(reply: FastifyReply, u: Pick<UsuarioSessao, 'id' | 'empresaId' | 'perfil'>): void {
  const token = criarTokenSessao(u);
  reply.setCookie(COOKIE_SESSAO, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSeguro,
    maxAge: VALIDADE,
  });
}

export function apagarSessao(reply: FastifyReply): void {
  reply.clearCookie(COOKIE_SESSAO, { path: '/' });
}

/**
 * Caminho da rota que respondeu, montado a partir do padrão registrado (ex.: /api/eng/obras/:id) e dos parâmetros.
 * Toda decisão de acesso usa este caminho, nunca o `req.url` cru: o Fastify decodifica %XX para achar a rota
 * (/api/%66in → /api/fin), mas o req.url continua com %66 e enganaria a comparação por prefixo (P04).
 * Os parâmetros entram codificados, para um %2F não virar uma barra no meio do caminho.
 */
export function caminhoDaRota(req: FastifyRequest): string {
  const padrao = req.routeOptions?.url;
  if (!padrao) return '';
  const params = (req.params ?? {}) as Record<string, string>;
  return padrao.replace(/:([A-Za-z0-9_]+)/g, (_t, nome: string) => encodeURIComponent(params[nome] ?? ''));
}

/** Guarda de rota: exige usuário ativo e, se informados, um dos perfis. */
export function exigir(banco: Banco, ...perfis: Perfil[]) {
  return async function (req: FastifyRequest): Promise<void> {
    if (!req.sessao) throw naoAutenticado();
    const r = await banco.query(
      `SELECT u.id, u.nome, u.email, u.perfil, u.empresa_id, u.ativo, u.administrador, u.modulos, u.senha_provisoria, e.ativo AS empresa_ativa, e.modulos_contratados
         FROM usuarios u LEFT JOIN empresas e ON e.id = u.empresa_id
        WHERE u.id = $1 AND u.excluido_em IS NULL`,
      [req.sessao.sub],
    );
    const u = r.rows[0];
    if (!u || !u.ativo) throw naoAutenticado();
    if (u.empresa_id && !u.empresa_ativa) throw new ErroHttp(403, 'O acesso desta empresa está suspenso.');
    const administrador = u.perfil === 'dono' || !!u.administrador;
    const lista = listaDoUsuario(u.perfil, u.modulos, administrador);
    // Sem empresa (administrador do sistema) não há contrato; com empresa, vale o que foi vendido.
    const contratados = u.empresa_id ? contratoComBase(u.modulos_contratados) : undefined;
    const senhaProvisoria = !!u.senha_provisoria;
    req.usuario = { id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, empresaId: u.empresa_id, administrador, modulos: modulosEfetivos(u.perfil, lista, contratados), senhaProvisoria };
    if (senhaProvisoria && !ROTAS_COM_SENHA_PROVISORIA.has(`${req.method} ${caminhoDaRota(req)}`)) {
      throw new ErroHttp(403, 'Troque a senha inicial para continuar.', { senhaProvisoria: true });
    }
    if (!acessoPermitido({ perfil: u.perfil, modulos: lista, perfisRota: perfis, url: caminhoDaRota(req), metodo: req.method, contratados })) throw semPermissao();
  };
}

/** Id da empresa do usuário logado; o administrador do sistema não tem empresa própria. */
export function empresaDo(req: FastifyRequest): string {
  const id = req.usuario?.empresaId;
  if (!id) throw new ErroHttp(400, 'Esta área é usada dentro de uma empresa.');
  return id;
}
