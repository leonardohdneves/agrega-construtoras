import type { FastifyInstance } from 'fastify';
import type { Banco } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { esquemaAlterarUsuario, esquemaNovoUsuario } from '../esquemas.ts';
import { usuarioPublico } from '../formatos.ts';
import { ErroHttp, naoEncontrado, semPermissao } from '../lib/erros.ts';
import { podeGerenciarPerfil } from '../lib/perfis.ts';
import { gerarHashSenha } from '../lib/senha.ts';
import { empresaDo, exigir } from '../sessao.ts';

export function rotasUsuarios(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.get('/', { preHandler: exigir(banco, 'dono', 'gestor') }, async (req) => {
      const r = await banco.query(
        `SELECT * FROM usuarios WHERE empresa_id = $1 AND excluido_em IS NULL
          ORDER BY ativo DESC, array_position(ARRAY['dono','gestor','motorista']::perfil[], perfil), nome`,
        [empresaDo(req)],
      );
      return { usuarios: r.rows.map(usuarioPublico) };
    });

    app.post('/', { preHandler: exigir(banco, 'dono', 'gestor') }, async (req, reply) => {
      const d = esquemaNovoUsuario.parse(req.body);
      if (!podeGerenciarPerfil(req.usuario!.perfil, d.perfil)) throw semPermissao();
      const empresaId = empresaDo(req);
      const hash = await gerarHashSenha(d.senha);
      const novo = await emTransacao(banco, async (c) => {
        const u = (
          await c.query(
            `INSERT INTO usuarios (empresa_id, nome, email, senha_hash, perfil, telefone_whatsapp)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [empresaId, d.nome, d.email, hash, d.perfil, d.telefoneWhatsapp],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'usuarios', entidadeId: u.id, depois: u });
        return u;
      });
      reply.code(201);
      return { usuario: usuarioPublico(novo) };
    });

    app.patch<{ Params: { id: string } }>('/:id', { preHandler: exigir(banco, 'dono', 'gestor') }, async (req) => {
      const d = esquemaAlterarUsuario.parse(req.body);
      const empresaId = empresaDo(req);
      const eu = req.usuario!;
      const atualizado = await emTransacao(banco, async (c) => {
        const antes = (
          await c.query('SELECT * FROM usuarios WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL FOR UPDATE', [req.params.id, empresaId])
        ).rows[0];
        if (!antes) throw naoEncontrado('Usuário');
        if (!podeGerenciarPerfil(eu.perfil, antes.perfil)) throw semPermissao();
        if (d.perfil && !podeGerenciarPerfil(eu.perfil, d.perfil)) throw semPermissao();
        if (antes.id === eu.id && ((d.perfil && d.perfil !== antes.perfil) || d.ativo === false)) {
          throw new ErroHttp(400, 'Você não pode mudar o próprio perfil nem desativar o próprio acesso.');
        }
        const deixaDeSerDono = antes.perfil === 'dono' && ((d.perfil && d.perfil !== 'dono') || d.ativo === false);
        if (deixaDeSerDono) {
          const donos = await c.query(
            `SELECT count(*)::int AS n FROM usuarios WHERE empresa_id = $1 AND perfil = 'dono' AND ativo AND excluido_em IS NULL`,
            [empresaId],
          );
          if (donos.rows[0].n <= 1) throw new ErroHttp(400, 'A empresa precisa ter pelo menos um dono ativo.');
        }
        const hash = d.senha ? await gerarHashSenha(d.senha) : null;
        const depois = (
          await c.query(
            `UPDATE usuarios SET
               nome = COALESCE($3, nome),
               perfil = COALESCE($4::perfil, perfil),
               ativo = COALESCE($5, ativo),
               telefone_whatsapp = CASE WHEN $6::boolean THEN $7 ELSE telefone_whatsapp END,
               senha_hash = COALESCE($8, senha_hash),
               atualizado_em = now()
             WHERE id = $1 AND empresa_id = $2 RETURNING *`,
            [antes.id, empresaId, d.nome ?? null, d.perfil ?? null, d.ativo ?? null, 'telefoneWhatsapp' in (req.body as object), d.telefoneWhatsapp ?? null, hash],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: eu.id, acao: 'alterar', entidade: 'usuarios', entidadeId: antes.id, antes, depois });
        return depois;
      });
      return { usuario: usuarioPublico(atualizado) };
    });
  };
}
