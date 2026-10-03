// Sessão: lê o cookie em toda requisição e oferece o guarda `exigir(...)` para as rotas.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.ts';
import type { Banco } from './db.ts';
import { naoAutenticado, semPermissao, ErroHttp } from './lib/erros.ts';
import { lerToken, criarToken, type DadosSessao, type Perfil } from './lib/token.ts';
import { acessoPermitido, listaDoUsuario, modulosEfetivos, type Modulo } from './lib/modulos.ts';

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
};

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
    req.sessao = lerToken(req.cookies?.[COOKIE_SESSAO], config.jwtSecret);
  });
}

export function gravarSessao(reply: FastifyReply, u: Pick<UsuarioSessao, 'id' | 'empresaId' | 'perfil'>): void {
  const token = criarToken({ sub: u.id, emp: u.empresaId, per: u.perfil }, config.jwtSecret, VALIDADE);
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

/** Guarda de rota: exige usuário ativo e, se informados, um dos perfis. */
export function exigir(banco: Banco, ...perfis: Perfil[]) {
  return async function (req: FastifyRequest): Promise<void> {
    if (!req.sessao) throw naoAutenticado();
    const r = await banco.query(
      `SELECT u.id, u.nome, u.email, u.perfil, u.empresa_id, u.ativo, u.administrador, u.modulos, e.ativo AS empresa_ativa
         FROM usuarios u LEFT JOIN empresas e ON e.id = u.empresa_id
        WHERE u.id = $1 AND u.excluido_em IS NULL`,
      [req.sessao.sub],
    );
    const u = r.rows[0];
    if (!u || !u.ativo) throw naoAutenticado();
    if (u.empresa_id && !u.empresa_ativa) throw new ErroHttp(403, 'O acesso desta empresa está suspenso.');
    const administrador = u.perfil === 'dono' || !!u.administrador;
    const lista = listaDoUsuario(u.perfil, u.modulos, administrador);
    req.usuario = { id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, empresaId: u.empresa_id, administrador, modulos: modulosEfetivos(u.perfil, lista) };
    if (!acessoPermitido({ perfil: u.perfil, modulos: lista, perfisRota: perfis, url: req.url, metodo: req.method })) throw semPermissao();
  };
}

/** Id da empresa do usuário logado; o administrador do sistema não tem empresa própria. */
export function empresaDo(req: FastifyRequest): string {
  const id = req.usuario?.empresaId;
  if (!id) throw new ErroHttp(400, 'Esta área é usada dentro de uma empresa.');
  return id;
}
