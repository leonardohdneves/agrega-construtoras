// Acompanhamento por visitas: obra em que a construtora só visita e orienta. Cada visita guarda data, responsável,
// anotações e fotos (tiradas no celular). O relatório da visita é impresso/salvo em PDF pelo front, com a logo
// e as cores da empresa. Não há EAP, orçamento, planejamento nem estoque nessas obras.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Banco, Cliente } from '../db.ts';
import { emTransacao } from '../db.ts';
import { randomBytes } from 'node:crypto';
import { auditar } from '../auditoria.ts';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';
import { codigoDaVisita, validarImagemAssinatura } from '../lib/assinatura.ts';
import { obrasPermitidas } from '../lib/obras-acesso.ts';
import { empresaDo, exigir } from '../sessao.ts';

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const PERFIS_VISITA = ['dono', 'gestor', 'engenheiro_obra'] as const;
const texto = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const LIMITE_FOTO = 2 * 1024 * 1024;
const LIMITE_FOTOS_VISITA = 40;

const esquemaVisita = z.object({
  data: z.string().regex(DATA, 'Data inválida.').optional(),
  responsavel: texto(120),
  observacoes: texto(8000),
});

const esquemaFoto = z.object({
  imagem: z.string().min(10),
  tipo: z.enum(['image/jpeg', 'image/png']),
  legenda: texto(200),
});

async function obraDeVisita(c: Cliente | Banco, empresaId: string, obraId: string, usuario: { id: string; perfil: string } | undefined) {
  const r = await c.query(
    `SELECT id, codigo, nome, endereco, cidade, uf, responsavel, tipo FROM obras WHERE id = $1 AND empresa_id = $2 AND ativo`,
    [obraId, empresaId],
  );
  if (!r.rowCount) throw naoEncontrado('Obra');
  const permitidas = await obrasPermitidas(c, empresaId, usuario);
  if (permitidas && !permitidas.includes(obraId)) throw naoEncontrado('Obra');
  if (r.rows[0].tipo !== 'acompanhamento') throw new ErroHttp(409, 'Esta obra não é de acompanhamento por visitas.');
  return r.rows[0] as { id: string; codigo: string; nome: string; endereco: string | null; cidade: string | null; uf: string | null; responsavel: string | null; tipo: string };
}

async function visitaDaObra(c: Cliente | Banco, empresaId: string, obraId: string, visitaId: string) {
  const r = await c.query('SELECT * FROM obra_visitas WHERE id = $1 AND obra_id = $2 AND empresa_id = $3', [visitaId, obraId, empresaId]);
  if (!r.rowCount) throw naoEncontrado('Visita');
  return r.rows[0] as { id: string; numero: number; data: string; responsavel: string | null; observacoes: string | null };
}

const dataTexto = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d));

/** Código de verificação atual da visita (texto e fotos). */
async function codigoAtual(c: Cliente, visitaId: string): Promise<string> {
  const v = (await c.query(`SELECT numero, data::text AS data, responsavel, observacoes FROM obra_visitas WHERE id = $1`, [visitaId])).rows[0];
  const fotos = (await c.query('SELECT id::text AS id FROM obra_visita_fotos WHERE visita_id = $1', [visitaId])).rows.map((f) => f.id as string);
  return codigoDaVisita(v, fotos);
}

/** Remove as assinaturas que não conferem mais com o conteúdo da visita (ao alterar texto ou fotos). */
async function reconciliarAssinaturas(c: Cliente, visitaId: string) {
  await c.query('DELETE FROM visita_assinaturas WHERE visita_id = $1 AND codigo <> $2', [visitaId, await codigoAtual(c, visitaId)]);
}

const esquemaAssinatura = z.object({
  nome: z.string({ required_error: 'Informe o nome de quem assina.' }).trim().min(3, 'Informe o nome de quem assina.').max(120),
  imagem: z.string({ required_error: 'Assine na tela.' }).min(10, 'Assine na tela.'),
});

export function rotasAcompanhamento(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.addHook('preHandler', exigir(banco, ...PERFIS_VISITA));

    // Obras de acompanhamento que o usuário enxerga (engenheiro de obra: só as atribuídas a ele).
    app.get('/acompanhamento/obras', async (req) => {
      const empresaId = empresaDo(req);
      const permitidas = await obrasPermitidas(banco, empresaId, req.usuario);
      const r = await banco.query(
        `SELECT o.id, o.codigo, o.nome, o.cidade, o.uf, o.status,
                (SELECT count(*)::int FROM obra_visitas v WHERE v.obra_id = o.id) AS visitas,
                (SELECT max(v.data)::text FROM obra_visitas v WHERE v.obra_id = o.id) AS ultima_visita
           FROM obras o
          WHERE o.empresa_id = $1 AND o.ativo AND o.tipo = 'acompanhamento' AND o.status <> 'arquivada'
            AND ($2::uuid[] IS NULL OR o.id = ANY($2::uuid[]))
          ORDER BY o.codigo`,
        [empresaId, permitidas],
      );
      return { obras: r.rows };
    });

    app.get<{ Params: { obraId: string } }>('/obras/:obraId/visitas', async (req) => {
      const empresaId = empresaDo(req);
      const obra = await obraDeVisita(banco, empresaId, req.params.obraId, req.usuario);
      const r = await banco.query(
        `SELECT v.id, v.numero, v.data::text AS data, v.responsavel, v.observacoes,
                (SELECT count(*)::int FROM obra_visita_fotos f WHERE f.visita_id = v.id) AS fotos
           FROM obra_visitas v WHERE v.obra_id = $1 AND v.empresa_id = $2 ORDER BY v.numero DESC`,
        [obra.id, empresaId],
      );
      return { visitas: r.rows };
    });

    app.post<{ Params: { obraId: string } }>('/obras/:obraId/visitas', async (req, reply) => {
      const empresaId = empresaDo(req);
      const d = esquemaVisita.parse(req.body ?? {});
      const id = await emTransacao(banco, async (c) => {
        const obra = await obraDeVisita(c, empresaId, req.params.obraId, req.usuario);
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`visitas:${obra.id}`]);
        const prox = await c.query('SELECT coalesce(max(numero), 0) + 1 AS n FROM obra_visitas WHERE obra_id = $1', [obra.id]);
        const nova = await c.query(
          `INSERT INTO obra_visitas (empresa_id, obra_id, numero, data, responsavel, observacoes)
           VALUES ($1, $2, $3, coalesce($4::date, current_date), $5, $6) RETURNING id`,
          [empresaId, obra.id, prox.rows[0].n, d.data ?? null, d.responsavel, d.observacoes],
        );
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'obra_visitas', entidadeId: nova.rows[0].id, depois: { obra: obra.codigo, numero: prox.rows[0].n } });
        return nova.rows[0].id as string;
      });
      reply.code(201);
      return { id };
    });

    app.get<{ Params: { obraId: string; id: string } }>('/obras/:obraId/visitas/:id', async (req) => {
      const empresaId = empresaDo(req);
      const obra = await obraDeVisita(banco, empresaId, req.params.obraId, req.usuario);
      const v = await visitaDaObra(banco, empresaId, obra.id, req.params.id);
      const fotos = await banco.query('SELECT id, legenda, ordem FROM obra_visita_fotos WHERE visita_id = $1 ORDER BY ordem, criado_em', [v.id]);
      const assinaturas = await banco.query(
        'SELECT papel, nome, imagem, codigo, assinado_em FROM visita_assinaturas WHERE visita_id = $1',
        [v.id],
      );
      return {
        visita: { ...v, data: dataTexto(v.data), fotos: fotos.rows, assinaturas: assinaturas.rows },
        obra: { id: obra.id, codigo: obra.codigo, nome: obra.nome, endereco: obra.endereco, cidade: obra.cidade, uf: obra.uf, responsavel: obra.responsavel },
      };
    });

    app.put<{ Params: { obraId: string; id: string } }>('/obras/:obraId/visitas/:id', async (req) => {
      const empresaId = empresaDo(req);
      const d = esquemaVisita.parse(req.body ?? {});
      await emTransacao(banco, async (c) => {
        const obra = await obraDeVisita(c, empresaId, req.params.obraId, req.usuario);
        const antes = await visitaDaObra(c, empresaId, obra.id, req.params.id);
        await c.query(
          `UPDATE obra_visitas SET data = coalesce($2::date, data), responsavel = $3, observacoes = $4, atualizado_em = now() WHERE id = $1`,
          [antes.id, d.data ?? null, d.responsavel, d.observacoes],
        );
        await reconciliarAssinaturas(c, antes.id);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'obra_visitas', entidadeId: antes.id, antes: { numero: antes.numero }, depois: d });
      });
      return { ok: true };
    });

    app.delete<{ Params: { obraId: string; id: string } }>('/obras/:obraId/visitas/:id', async (req) => {
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const obra = await obraDeVisita(c, empresaId, req.params.obraId, req.usuario);
        const v = await visitaDaObra(c, empresaId, obra.id, req.params.id);
        await c.query('DELETE FROM obra_visitas WHERE id = $1', [v.id]);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'excluir', entidade: 'obra_visitas', entidadeId: v.id, antes: { numero: v.numero, data: dataTexto(v.data) } });
      });
      return { ok: true };
    });

    // Assinatura do responsável pela visita, desenhada na tela do celular (quem está logado).
    app.post<{ Params: { obraId: string; id: string } }>('/obras/:obraId/visitas/:id/assinaturas', async (req) => {
      const empresaId = empresaDo(req);
      const d = esquemaAssinatura.parse(req.body ?? {});
      const imagem = validarImagemAssinatura(d.imagem);
      await emTransacao(banco, async (c) => {
        const obra = await obraDeVisita(c, empresaId, req.params.obraId, req.usuario);
        const v = await visitaDaObra(c, empresaId, obra.id, req.params.id);
        const codigo = await codigoAtual(c, v.id);
        await c.query(
          `INSERT INTO visita_assinaturas (empresa_id, visita_id, papel, nome, imagem, codigo, assinado_por, ip)
           VALUES ($1, $2, 'responsavel', $3, $4, $5, $6, $7)
           ON CONFLICT (visita_id, papel) DO UPDATE SET nome = EXCLUDED.nome, imagem = EXCLUDED.imagem, codigo = EXCLUDED.codigo,
             assinado_em = now(), assinado_por = EXCLUDED.assinado_por, ip = EXCLUDED.ip`,
          [empresaId, v.id, d.nome, imagem, codigo, req.usuario!.id, req.ip],
        );
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'confirmar', entidade: 'obra_visitas', entidadeId: v.id, depois: { papel: 'responsavel', codigo } });
      });
      return { ok: true };
    });

    // Gera o link para o dono da obra assinar a visita, sem login. Vale 30 dias; um link novo substitui o anterior.
    app.post<{ Params: { obraId: string; id: string } }>('/obras/:obraId/visitas/:id/link-assinatura', async (req) => {
      const empresaId = empresaDo(req);
      const token = randomBytes(24).toString('base64url');
      await emTransacao(banco, async (c) => {
        const obra = await obraDeVisita(c, empresaId, req.params.obraId, req.usuario);
        const v = await visitaDaObra(c, empresaId, obra.id, req.params.id);
        await c.query(
          `UPDATE obra_visitas SET assinatura_token = $2, assinatura_token_expira = now() + interval '30 days' WHERE id = $1`,
          [v.id, token],
        );
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'obra_visitas', entidadeId: v.id, depois: { link_assinatura: true } });
      });
      return { caminho: `/assinar/${token}`, validoAte: 30 };
    });

    app.post<{ Params: { obraId: string; id: string } }>('/obras/:obraId/visitas/:id/fotos', { bodyLimit: 4 * 1024 * 1024 }, async (req, reply) => {
      const empresaId = empresaDo(req);
      const d = esquemaFoto.parse(req.body);
      const bytes = Buffer.from(d.imagem, 'base64');
      if (!bytes.length || bytes.length > LIMITE_FOTO) throw new ErroHttp(400, 'Foto grande demais. Reduza a imagem (máximo 2 MB).');
      const id = await emTransacao(banco, async (c) => {
        const obra = await obraDeVisita(c, empresaId, req.params.obraId, req.usuario);
        const v = await visitaDaObra(c, empresaId, obra.id, req.params.id);
        const total = await c.query('SELECT count(*)::int AS n FROM obra_visita_fotos WHERE visita_id = $1', [v.id]);
        if (Number(total.rows[0].n) >= LIMITE_FOTOS_VISITA) throw new ErroHttp(409, `Limite de ${LIMITE_FOTOS_VISITA} fotos por visita.`);
        const nova = await c.query(
          `INSERT INTO obra_visita_fotos (visita_id, ordem, legenda, tipo, conteudo)
           VALUES ($1, (SELECT coalesce(max(ordem), -1) + 1 FROM obra_visita_fotos WHERE visita_id = $1), $2, $3, $4) RETURNING id`,
          [v.id, d.legenda, d.tipo, bytes],
        );
        await reconciliarAssinaturas(c, v.id);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'obra_visita_fotos', entidadeId: nova.rows[0].id, depois: { visita: v.id } });
        return nova.rows[0].id as string;
      });
      reply.code(201);
      return { id };
    });

    app.get<{ Params: { obraId: string; id: string; fotoId: string } }>('/obras/:obraId/visitas/:id/fotos/:fotoId', async (req, reply) => {
      const empresaId = empresaDo(req);
      const obra = await obraDeVisita(banco, empresaId, req.params.obraId, req.usuario);
      const v = await visitaDaObra(banco, empresaId, obra.id, req.params.id);
      const r = await banco.query('SELECT tipo, conteudo FROM obra_visita_fotos WHERE id = $1 AND visita_id = $2', [req.params.fotoId, v.id]);
      if (!r.rowCount) throw naoEncontrado('Foto');
      reply.header('Content-Type', r.rows[0].tipo).header('Cache-Control', 'private, max-age=86400');
      return reply.send(r.rows[0].conteudo);
    });

    app.put<{ Params: { obraId: string; id: string; fotoId: string } }>('/obras/:obraId/visitas/:id/fotos/:fotoId', async (req) => {
      const empresaId = empresaDo(req);
      const d = z.object({ legenda: texto(200) }).parse(req.body ?? {});
      await emTransacao(banco, async (c) => {
        const obra = await obraDeVisita(c, empresaId, req.params.obraId, req.usuario);
        const v = await visitaDaObra(c, empresaId, obra.id, req.params.id);
        const r = await c.query('UPDATE obra_visita_fotos SET legenda = $3 WHERE id = $1 AND visita_id = $2 RETURNING id', [req.params.fotoId, v.id, d.legenda]);
        if (!r.rowCount) throw naoEncontrado('Foto');
      });
      return { ok: true };
    });

    app.delete<{ Params: { obraId: string; id: string; fotoId: string } }>('/obras/:obraId/visitas/:id/fotos/:fotoId', async (req) => {
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const obra = await obraDeVisita(c, empresaId, req.params.obraId, req.usuario);
        const v = await visitaDaObra(c, empresaId, obra.id, req.params.id);
        const r = await c.query('DELETE FROM obra_visita_fotos WHERE id = $1 AND visita_id = $2 RETURNING id', [req.params.fotoId, v.id]);
        if (!r.rowCount) throw naoEncontrado('Foto');
        await reconciliarAssinaturas(c, v.id);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'excluir', entidade: 'obra_visita_fotos', entidadeId: req.params.fotoId, antes: { visita: v.id } });
      });
      return { ok: true };
    });
  };
}
