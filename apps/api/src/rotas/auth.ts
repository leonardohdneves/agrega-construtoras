import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Banco } from '../db.ts';
import { ErroHttp } from '../lib/erros.ts';
import { conferirSenha, gerarHashSenha } from '../lib/senha.ts';
import { esquemaEmail, esquemaSenha } from '../esquemas.ts';
import { empresaPublica, usuarioPublico } from '../formatos.ts';
import { apagarSessao, exigir, gravarSessao } from '../sessao.ts';

const MSG_LOGIN = 'E-mail ou senha incorretos.';

export function rotasAuth(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.post(
      '/entrar',
      { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
      async (req, reply) => {
        const dados = z.object({ email: esquemaEmail, senha: z.string().min(1, 'Informe a senha.') }).parse(req.body);
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

    app.put('/senha', { preHandler: exigir(banco) }, async (req) => {
      const dados = z.object({ senhaAtual: z.string().min(1, 'Informe a senha atual.'), novaSenha: esquemaSenha }).parse(req.body);
      const u = (await banco.query('SELECT senha_hash FROM usuarios WHERE id = $1', [req.usuario!.id])).rows[0];
      if (!(await conferirSenha(dados.senhaAtual, u.senha_hash))) throw new ErroHttp(400, 'A senha atual não confere.');
      await banco.query('UPDATE usuarios SET senha_hash = $1, atualizado_em = now() WHERE id = $2', [
        await gerarHashSenha(dados.novaSenha),
        req.usuario!.id,
      ]);
      return { ok: true };
    });
  };
}
