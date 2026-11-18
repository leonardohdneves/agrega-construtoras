import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Banco } from '../db.ts';
import { ErroHttp } from '../lib/erros.ts';
import { conferirSenha, gerarHashSenha } from '../lib/senha.ts';
import { esquemaEmail, esquemaSenha } from '../esquemas.ts';
import { empresaPublica, usuarioPublico } from '../formatos.ts';
import { apagarSessao, criarTokenSessao, exigir, gravarSessao } from '../sessao.ts';
import { config } from '../config.ts';
import { destinoPermitido, emitirCodigo, renovar, revogarConexoes, trocarCodigo } from '../lib/oauth-mcp.ts';

const MSG_LOGIN = 'E-mail ou senha incorretos.';

export function rotasAuth(banco: Banco) {
  return async function (app: FastifyInstance) {
    const corpoPostEntrar = z.object({ email: esquemaEmail, senha: z.string().min(1, 'Informe a senha.') });
    app.post(
      '/entrar',
      { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { body: corpoPostEntrar } },
      async (req, reply) => {
        const dados = corpoPostEntrar.parse(req.body);
        const r = await banco.query(
          `SELECT u.*, e.ativo AS empresa_ativa, e.modulos_contratados FROM usuarios u
             LEFT JOIN empresas e ON e.id = u.empresa_id
            WHERE lower(u.email) = $1 AND u.excluido_em IS NULL`,
          [dados.email],
        );
        const u = r.rows[0];
        // Mesmo tempo de resposta e mesma mensagem para e-mail inexistente ou senha errada.
        const ok = u ? await conferirSenha(dados.senha, u.senha_hash) : await conferirSenha(dados.senha, 'scrypt$16384$8$1$AAAA$AAAA');
        if (!u || !ok || !u.ativo) throw new ErroHttp(401, MSG_LOGIN);
        if (u.empresa_id && !u.empresa_ativa) throw new ErroHttp(403, 'O acesso desta empresa está suspenso.');
        await banco.query('UPDATE usuarios SET ultimo_acesso = now() WHERE id = $1', [u.id]);
        gravarSessao(reply, { id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, empresaId: u.empresa_id });
        return { usuario: usuarioPublico(u, u.empresa_id ? u.modulos_contratados : undefined) };
      },
    );

    app.post('/sair', async (_req, reply) => {
      apagarSessao(reply);
      return { ok: true };
    });

    app.get('/eu', { preHandler: exigir(banco) }, async (req) => {
      const u = (await banco.query('SELECT * FROM usuarios WHERE id = $1', [req.usuario!.id])).rows[0];
      let empresa = null;
      let contratados: string[] | undefined;
      if (u.empresa_id) {
        const e = (await banco.query('SELECT * FROM empresas WHERE id = $1', [u.empresa_id])).rows[0];
        empresa = e ? empresaPublica(e) : null;
        contratados = e?.modulos_contratados;
      }
      return { usuario: usuarioPublico(u, contratados), empresa };
    });

    const corpoPutSenha = z.object({ senhaAtual: z.string().min(1, 'Informe a senha atual.'), novaSenha: esquemaSenha });
    app.put('/senha', { preHandler: exigir(banco), schema: { body: corpoPutSenha } }, async (req) => {
      const dados = corpoPutSenha.parse(req.body);
      if (dados.novaSenha === dados.senhaAtual) throw new ErroHttp(400, 'A nova senha precisa ser diferente da senha atual.');
      const u = (await banco.query('SELECT senha_hash FROM usuarios WHERE id = $1', [req.usuario!.id])).rows[0];
      if (!(await conferirSenha(dados.senhaAtual, u.senha_hash))) throw new ErroHttp(400, 'A senha atual não confere.');
      await banco.query('UPDATE usuarios SET senha_hash = $1, senha_provisoria = false, atualizado_em = now() WHERE id = $2', [
        await gerarHashSenha(dados.novaSenha),
        req.usuario!.id,
      ]);
      // Senha nova encerra as conexões de assistentes (Claude, ChatGPT): cada um pede o login de novo.
      await revogarConexoes(banco, req.usuario!.id);
      return { ok: true };
    });

    // ----- OAuth do servidor MCP (assistentes de IA), no mesmo desenho do AIRO -----
    // Os nomes dos campos (code, token, refreshToken) seguem o contrato do AIRO, que o servidor MCP espera.

    // A tela /oauth/authorize confere o endereço de retorno antes de mostrar o login e antes de voltar com "cancelado".
    app.get<{ Querystring: { redirect_uri?: string } }>('/oauth-destino', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => ({
      permitido: destinoPermitido(req.query.redirect_uri, config.mcpCallbacks),
    }));

    // Login da tela de autorização: confere e-mail e senha e devolve um código de uso único (60 s). Não cria sessão no navegador.
    const corpoOauthLogin = z.object({ email: esquemaEmail, senha: z.string().min(1, 'Informe a senha.'), redirectUri: z.string().max(500) });
    app.post(
      '/oauth-login',
      {
        // No preHandler, para o corpo já existir: 5 tentativas por endereço + e-mail a cada 15 minutos.
        preHandler: app.rateLimit({ max: 5, timeWindow: '15 minutes', keyGenerator: (req) => `${req.ip}:${String((req.body as { email?: unknown } | null)?.email ?? '').trim().toLowerCase()}` }),
        schema: { body: corpoOauthLogin },
      },
      async (req) => {
        const dados = corpoOauthLogin.parse(req.body);
        if (!destinoPermitido(dados.redirectUri, config.mcpCallbacks)) throw new ErroHttp(400, 'Endereço de retorno não autorizado.');
        const u = (
          await banco.query(
            `SELECT u.id, u.senha_hash, u.ativo, u.empresa_id, u.senha_provisoria, e.ativo AS empresa_ativa FROM usuarios u
               LEFT JOIN empresas e ON e.id = u.empresa_id
              WHERE lower(u.email) = $1 AND u.excluido_em IS NULL`,
            [dados.email],
          )
        ).rows[0];
        // Mesmo tempo de resposta e mesma mensagem para e-mail inexistente ou senha errada.
        const ok = u ? await conferirSenha(dados.senha, u.senha_hash) : await conferirSenha(dados.senha, 'scrypt$16384$8$1$AAAA$AAAA');
        if (!u || !ok || !u.ativo) throw new ErroHttp(401, MSG_LOGIN);
        if (!u.empresa_id) throw new ErroHttp(403, 'A conexão com assistentes é para usuários de uma construtora.');
        if (!u.empresa_ativa) throw new ErroHttp(403, 'O acesso desta empresa está suspenso.');
        if (u.senha_provisoria) throw new ErroHttp(403, 'Entre no Agrega e troque a senha inicial antes de conectar um assistente.');
        return emitirCodigo(banco, u.id);
      },
    );

    // Servidor MCP → API: troca o código de uso único pelo token de sessão e pelo token de renovação.
    const corpoOauthTroca = z.object({ code: z.string().min(32).max(128) });
    app.post('/oauth-exchange', { config: { rateLimit: { max: 30, timeWindow: '15 minutes' } }, schema: { body: corpoOauthTroca } }, async (req) => {
      const r = await trocarCodigo(banco, corpoOauthTroca.parse(req.body).code, req.ip);
      if (!r) throw new ErroHttp(400, 'Código inválido, vencido ou já usado. Refaça o login.');
      await banco.query('UPDATE usuarios SET ultimo_acesso = now() WHERE id = $1', [r.usuario.id]);
      return { token: criarTokenSessao(r.usuario), refreshToken: r.refreshToken };
    });

    // Servidor MCP → API: renova o token de sessão sem envolver o usuário. O token de renovação usado deixa de valer.
    const corpoOauthRenova = z.object({ refreshToken: z.string().min(32).max(128) });
    app.post('/oauth-refresh', { config: { rateLimit: { max: 60, timeWindow: '15 minutes' } }, schema: { body: corpoOauthRenova } }, async (req) => {
      const r = await renovar(banco, corpoOauthRenova.parse(req.body).refreshToken, req.ip);
      if (!r) throw new ErroHttp(401, 'Conexão encerrada. Faça o login de novo.');
      return { token: criarTokenSessao(r.usuario), refreshToken: r.refreshToken };
    });
  };
}
