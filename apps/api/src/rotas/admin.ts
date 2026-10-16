// Área do administrador do sistema (você): cadastro das construtoras clientes.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { Banco } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { esquemaContrato, esquemaNovaEmpresa } from '../esquemas.ts';
import { empresaPublica } from '../formatos.ts';
import { contratoComBase } from '../lib/modulos.ts';
import { PACOTES } from '../lib/pacotes.ts';
import { naoEncontrado } from '../lib/erros.ts';
import { gerarHashSenha } from '../lib/senha.ts';
import { exigir } from '../sessao.ts';

export function rotasAdmin(banco: Banco) {
  return async function (app: FastifyInstance) {
    // Material publicitário: só o administrador do sistema lê estes modelos (os arquivos ficam fora da área pública).
    const PASTA_MATERIAL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'material');
    const MATERIAIS: Record<string, string> = {
      'proposta-comercial.html': 'text/html; charset=utf-8',
      'banner-piloto.html': 'text/html; charset=utf-8',
      'qr-banner-piloto.svg': 'image/svg+xml; charset=utf-8',
    };
    app.get<{ Params: { arquivo: string } }>('/material/:arquivo', { preHandler: exigir(banco, 'admin_sistema') }, async (req, reply) => {
      const tipo = MATERIAIS[req.params.arquivo];
      if (!tipo) throw naoEncontrado('Material');
      const conteudo = await readFile(path.join(PASTA_MATERIAL, req.params.arquivo));
      return reply
        .header('Content-Type', tipo)
        .header('Cache-Control', 'private, no-store')
        .header('X-Robots-Tag', 'noindex')
        .send(conteudo);
    });

    // Avisos não lidos para o administrador do sistema (ex.: empresa acima do limite de empreendimentos).
    app.get('/avisos', { preHandler: exigir(banco, 'admin_sistema') }, async () => {
      const r = await banco.query(
        `SELECT a.id, a.tipo, a.quantidade, a.mensagem, a.criado_em, e.razao_social
           FROM avisos_sistema a JOIN empresas e ON e.id = a.empresa_id
          WHERE a.lido_em IS NULL AND e.excluido_em IS NULL ORDER BY a.criado_em DESC`,
      );
      return { avisos: r.rows.map((a) => ({ id: a.id, tipo: a.tipo, quantidade: a.quantidade, mensagem: a.mensagem, criadoEm: a.criado_em, empresa: a.razao_social })) };
    });

    app.post<{ Params: { id: string } }>('/avisos/:id/lido', { preHandler: exigir(banco, 'admin_sistema') }, async (req) => {
      const r = await banco.query(`UPDATE avisos_sistema SET lido_em = coalesce(lido_em, now()) WHERE id = $1 RETURNING id`, [req.params.id]);
      if (!r.rows[0]) throw naoEncontrado('Aviso');
      return { ok: true };
    });

    app.get('/empresas', { preHandler: exigir(banco, 'admin_sistema') }, async () => {
      const r = await banco.query(
        `SELECT e.*, (SELECT count(*)::int FROM usuarios u WHERE u.empresa_id = e.id AND u.excluido_em IS NULL) AS total_usuarios
           FROM empresas e WHERE e.excluido_em IS NULL ORDER BY e.razao_social`,
      );
      return { empresas: r.rows.map((e) => ({ ...empresaPublica(e), totalUsuarios: e.total_usuarios })) };
    });

    // Contrato da construtora: pacote vendido, módulos liberados e limites de obras e usuários.
    app.put<{ Params: { id: string } }>('/empresas/:id/contrato', { preHandler: exigir(banco, 'admin_sistema') }, async (req) => {
      const d = esquemaContrato.parse(req.body);
      const modulos: string[] = d.pacote === 'personalizado' ? (d.modulos ?? []) : PACOTES[d.pacote].modulos;
      const empresa = await emTransacao(banco, async (c) => {
        const antes = (await c.query('SELECT * FROM empresas WHERE id = $1 AND excluido_em IS NULL FOR UPDATE', [req.params.id])).rows[0];
        if (!antes) throw naoEncontrado('Empresa');
        const depois = (
          await c.query(
            `UPDATE empresas SET contrato_pacote = $2, modulos_contratados = $3, limite_obras = $4, limite_usuarios = $5, atualizado_em = now()
              WHERE id = $1 RETURNING *`,
            [antes.id, d.pacote, contratoComBase(modulos), d.limiteObras, d.limiteUsuarios],
          )
        ).rows[0];
        await auditar(c, { empresaId: antes.id, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'empresas', entidadeId: antes.id, antes: { contrato: antes.modulos_contratados, limites: [antes.limite_obras, antes.limite_usuarios] }, depois: { pacote: d.pacote, modulos: contratoComBase(modulos), limiteObras: d.limiteObras, limiteUsuarios: d.limiteUsuarios } });
        return depois;
      });
      return { empresa: empresaPublica(empresa) };
    });

    app.post('/empresas', { preHandler: exigir(banco, 'admin_sistema') }, async (req, reply) => {
      const d = esquemaNovaEmpresa.parse(req.body);
      const hash = await gerarHashSenha(d.dono.senha);
      const empresa = await emTransacao(banco, async (c) => {
        const e = (
          await c.query(
            `INSERT INTO empresas (razao_social, nome_fantasia, cnpj, regime_tributario, aliquotas_dre, telefone, email, cidade, uf,
                                   contrato_pacote, modulos_contratados, limite_obras, limite_usuarios)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'obra', $10, $11, $12) RETURNING *`,
            [d.razaoSocial, d.nomeFantasia, d.cnpj, d.regimeTributario, JSON.stringify(d.aliquotasDre), d.telefone, d.email ?? null, d.cidade, d.uf ?? null,
              contratoComBase(PACOTES.obra.modulos), PACOTES.obra.limiteObras, PACOTES.obra.limiteUsuarios],
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
