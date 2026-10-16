import type { FastifyInstance } from 'fastify';
import type { Banco } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { esquemaEmpresa, esquemaEmpresaGrupo } from '../esquemas.ts';
import { empresaGrupoPublica, empresaPublica } from '../formatos.ts';
import { z } from 'zod';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';
import { PERFIS_EMPRESA } from '../lib/perfis.ts';
import { empresaDo, exigir } from '../sessao.ts';

export function rotasEmpresa(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.get('/', { preHandler: exigir(banco, ...PERFIS_EMPRESA) }, async (req) => {
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
                    aliquotas_dre = $6, telefone = $7, email = $8, cidade = $9, uf = $10, simples_anexo = $11, simples_faixa = $12, atualizado_em = now()
              WHERE id = $1 RETURNING *`,
            [id, d.razaoSocial, d.nomeFantasia, d.cnpj, d.regimeTributario, JSON.stringify(d.aliquotasDre), d.telefone, d.email ?? null, d.cidade, d.uf ?? null, d.simplesAnexo ?? null, d.simplesFaixa ?? null],
          )
        ).rows[0];
        await auditar(c, { empresaId: id, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'empresas', entidadeId: id, antes, depois });
        return depois;
      });
      return { empresa: empresaPublica(empresa) };
    });

    // ----- Empresas do grupo: CNPJs da empresa, cada um com seu regime (a obra escolhe uma delas) -----
    app.get('/grupo', { preHandler: exigir(banco, ...PERFIS_EMPRESA) }, async (req) => {
      const r = await banco.query('SELECT * FROM empresas_grupo WHERE empresa_id = $1 ORDER BY razao_social', [empresaDo(req)]);
      return { empresas: r.rows.map(empresaGrupoPublica) };
    });

    app.post('/grupo', { preHandler: exigir(banco, 'dono') }, async (req, reply) => {
      const d = esquemaEmpresaGrupo.parse(req.body);
      const empresaId = empresaDo(req);
      const criada = await emTransacao(banco, async (c) => {
        if ((await c.query('SELECT 1 FROM empresas_grupo WHERE empresa_id = $1 AND cnpj = $2', [empresaId, d.cnpj])).rowCount)
          throw new ErroHttp(409, 'Já existe uma empresa do grupo com este CNPJ.');
        const r = (
          await c.query(
            `INSERT INTO empresas_grupo (empresa_id, razao_social, nome_fantasia, cnpj, regime_tributario, simples_anexo, simples_faixa, cidade, uf, ativo, endereco)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
            [empresaId, d.razaoSocial, d.nomeFantasia, d.cnpj, d.regimeTributario, d.simplesAnexo ?? null, d.simplesFaixa ?? null, d.cidade, d.uf ?? null, d.ativo ?? true, d.endereco],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'empresas_grupo', entidadeId: r.id, depois: d });
        return r;
      });
      return reply.code(201).send({ empresa: empresaGrupoPublica(criada) });
    });

    app.put<{ Params: { id: string } }>('/grupo/:id', { preHandler: exigir(banco, 'dono') }, async (req) => {
      const d = esquemaEmpresaGrupo.parse(req.body);
      const empresaId = empresaDo(req);
      const atualizada = await emTransacao(banco, async (c) => {
        const antes = (await c.query('SELECT * FROM empresas_grupo WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [req.params.id, empresaId])).rows[0];
        if (!antes) throw naoEncontrado('Empresa do grupo');
        if ((await c.query('SELECT 1 FROM empresas_grupo WHERE empresa_id = $1 AND cnpj = $2 AND id <> $3', [empresaId, d.cnpj, antes.id])).rowCount)
          throw new ErroHttp(409, 'Já existe uma empresa do grupo com este CNPJ.');
        const r = (
          await c.query(
            `UPDATE empresas_grupo SET razao_social = $3, nome_fantasia = $4, cnpj = $5, regime_tributario = $6, simples_anexo = $7,
                    simples_faixa = $8, cidade = $9, uf = $10, ativo = $11, endereco = $12, atualizado_em = now()
              WHERE id = $1 AND empresa_id = $2 RETURNING *`,
            [antes.id, empresaId, d.razaoSocial, d.nomeFantasia, d.cnpj, d.regimeTributario, d.simplesAnexo ?? null, d.simplesFaixa ?? null, d.cidade, d.uf ?? null, d.ativo ?? true, d.endereco],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'empresas_grupo', entidadeId: antes.id, antes, depois: d });
        return r;
      });
      return { empresa: empresaGrupoPublica(atualizada) };
    });

    const TODOS = PERFIS_EMPRESA;
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
