import type { FastifyInstance } from 'fastify';
import type { Banco } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { esquemaEmpresa } from '../esquemas.ts';
import { empresaPublica } from '../formatos.ts';
import { z } from 'zod';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';
import { empresaDo, exigir } from '../sessao.ts';

export function rotasEmpresa(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.get('/', { preHandler: exigir(banco, 'dono', 'gestor', 'motorista', 'operador_usina', 'laboratorista') }, async (req) => {
      const r = await banco.query('SELECT * FROM empresas WHERE id = $1', [empresaDo(req)]);
      if (!r.rows[0]) throw naoEncontrado('Empresa');
      return { empresa: empresaPublica(r.rows[0]) };
    });

    app.put('/', { preHandler: exigir(banco, 'dono') }, async (req) => {
      const d = esquemaEmpresa.parse(req.body);
      const id = empresaDo(req);
      const empresa = await emTransacao(banco, async (c) => {
        const antes = (await c.query('SELECT * FROM empresas WHERE id = $1 FOR UPDATE', [id])).rows[0];
        if (!antes) throw naoEncontrado('Empresa');
        const depois = (
          await c.query(
            `UPDATE empresas SET razao_social = $2, nome_fantasia = $3, cnpj = $4, regime_tributario = $5,
                    aliquotas_dre = $6, telefone = $7, email = $8, cidade = $9, uf = $10, atualizado_em = now()
              WHERE id = $1 RETURNING *`,
            [id, d.razaoSocial, d.nomeFantasia, d.cnpj, d.regimeTributario, JSON.stringify(d.aliquotasDre), d.telefone, d.email ?? null, d.cidade, d.uf ?? null],
          )
        ).rows[0];
        await auditar(c, { empresaId: id, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'empresas', entidadeId: id, antes, depois });
        return depois;
      });
      return { empresa: empresaPublica(empresa) };
    });

    const TODOS = ['dono', 'gestor', 'motorista', 'operador_usina', 'laboratorista'] as const;
    const administrador = (req: { usuario: { administrador: boolean } | null }) => {
      if (!req.usuario?.administrador) throw new ErroHttp(403, 'Só administradores alteram a logo e a impressão.');
    };

    // ----- Logo da concreteira (aparece nos relatórios) -----
    app.get('/logo', { preHandler: exigir(banco, ...TODOS) }, async (req, reply) => {
      const r = (await banco.query('SELECT logo, logo_tipo FROM empresas WHERE id = $1', [empresaDo(req)])).rows[0];
      if (!r?.logo) throw naoEncontrado('Logo');
      return reply
        .header('Content-Type', r.logo_tipo)
        .header('Cache-Control', 'private, max-age=86400')
        .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'")
        .send(r.logo);
    });

    app.put('/logo', { preHandler: exigir(banco, ...TODOS), bodyLimit: 1024 * 1024 }, async (req) => {
      administrador(req);
      const { imagem } = z.object({ imagem: z.string({ required_error: 'Envie a imagem.' }) }).parse(req.body);
      const m = imagem.match(/^data:(image\/(?:png|jpeg|svg\+xml|webp));base64,([A-Za-z0-9+/=]+)$/);
      if (!m) throw new ErroHttp(400, 'Use uma imagem PNG, JPG, WEBP ou SVG.');
      const bytes = Buffer.from(m[2], 'base64');
      if (bytes.length > 500 * 1024) throw new ErroHttp(400, 'A imagem passa de 500 KB. Reduza o tamanho e tente de novo.');
      if (m[1] === 'image/svg+xml' && /<script|on\w+=|javascript:/i.test(bytes.toString('utf8'))) throw new ErroHttp(400, 'SVG com script não é aceito.');
      const id = empresaDo(req);
      await emTransacao(banco, async (c) => {
        await c.query('UPDATE empresas SET logo = $2, logo_tipo = $3, logo_atualizado_em = now(), atualizado_em = now() WHERE id = $1', [id, bytes, m[1]]);
        await auditar(c, { empresaId: id, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'empresas', entidadeId: id, depois: { logo: `${m[1]} · ${bytes.length} bytes` } });
      });
      return { empresa: empresaPublica((await banco.query('SELECT * FROM empresas WHERE id = $1', [id])).rows[0]) };
    });

    app.delete('/logo', { preHandler: exigir(banco, ...TODOS) }, async (req) => {
      administrador(req);
      const id = empresaDo(req);
      await emTransacao(banco, async (c) => {
        await c.query('UPDATE empresas SET logo = NULL, logo_tipo = NULL, logo_atualizado_em = NULL, atualizado_em = now() WHERE id = $1', [id]);
        await auditar(c, { empresaId: id, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'empresas', entidadeId: id, depois: { logo: null } });
      });
      return { empresa: empresaPublica((await banco.query('SELECT * FROM empresas WHERE id = $1', [id])).rows[0]) };
    });

    // ----- Padrão de impressão dos relatórios -----
    app.put('/impressao', { preHandler: exigir(banco, ...TODOS) }, async (req) => {
      administrador(req);
      const d = z.object({ orientacao: z.enum(['retrato', 'paisagem']), papel: z.enum(['A4', 'Carta', 'Oficio']) }).parse(req.body);
      const id = empresaDo(req);
      await emTransacao(banco, async (c) => {
        await c.query('UPDATE empresas SET impressao = $2, atualizado_em = now() WHERE id = $1', [id, JSON.stringify(d)]);
        await auditar(c, { empresaId: id, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'empresas', entidadeId: id, depois: { impressao: d } });
      });
      return { empresa: empresaPublica((await banco.query('SELECT * FROM empresas WHERE id = $1', [id])).rows[0]) };
    });
  };
}
