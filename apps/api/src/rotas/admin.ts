// Área do administrador do sistema (você): cadastro das concreteiras clientes.
import type { FastifyInstance } from 'fastify';
import type { Banco } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { esquemaNovaEmpresa } from '../esquemas.ts';
import { empresaPublica } from '../formatos.ts';
import { gerarHashSenha } from '../lib/senha.ts';
import { exigir } from '../sessao.ts';

export function rotasAdmin(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.get('/empresas', { preHandler: exigir(banco, 'admin_sistema') }, async () => {
      const r = await banco.query(
        `SELECT e.*, (SELECT count(*)::int FROM usuarios u WHERE u.empresa_id = e.id AND u.excluido_em IS NULL) AS total_usuarios
           FROM empresas e WHERE e.excluido_em IS NULL ORDER BY e.razao_social`,
      );
      return { empresas: r.rows.map((e) => ({ ...empresaPublica(e), totalUsuarios: e.total_usuarios })) };
    });

    app.post('/empresas', { preHandler: exigir(banco, 'admin_sistema') }, async (req, reply) => {
      const d = esquemaNovaEmpresa.parse(req.body);
      const hash = await gerarHashSenha(d.dono.senha);
      const empresa = await emTransacao(banco, async (c) => {
        const e = (
          await c.query(
            `INSERT INTO empresas (razao_social, nome_fantasia, cnpj, regime_tributario, aliquotas_dre, telefone, email, cidade, uf)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [d.razaoSocial, d.nomeFantasia, d.cnpj, d.regimeTributario, JSON.stringify(d.aliquotasDre), d.telefone, d.email ?? null, d.cidade, d.uf ?? null],
          )
        ).rows[0];
        const dono = (
          await c.query(
            `INSERT INTO usuarios (empresa_id, nome, email, senha_hash, perfil) VALUES ($1, $2, $3, $4, 'dono') RETURNING id`,
            [e.id, d.dono.nome, d.dono.email, hash],
          )
        ).rows[0];
        await auditar(c, { empresaId: e.id, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'empresas', entidadeId: e.id, depois: e });
        await auditar(c, { empresaId: e.id, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'usuarios', entidadeId: dono.id, depois: { nome: d.dono.nome, email: d.dono.email, perfil: 'dono' } });
        return e;
      });
      reply.code(201);
      return { empresa: empresaPublica(empresa) };
    });
  };
}
