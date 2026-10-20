// Relatório Diário de Obra (RDO): um registro por obra e dia, com clima por período, mão de obra,
// equipamentos, atividades executadas e ocorrências. Segue a organização do diário do Sienge.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Banco, Cliente } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { ErroHttp, naoEncontrado, semPermissao } from '../lib/erros.ts';
import { ehEngenheiroDeObra, regraEngenheiroEngenharia } from '../lib/obras-acesso.ts';
import { empresaDo, exigir } from '../sessao.ts';

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const CLIMAS = ['bom', 'nublado', 'chuva', 'impraticavel'] as const;
const OCORRENCIAS = ['falta_material', 'falta_mao_obra', 'clima', 'acidente', 'paralisacao', 'visita', 'outra'] as const;
const texto = (max = 300) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const horas = z.union([z.number(), z.string()]).optional().nullable().transform((v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
});
const inteiro = z.number().int().min(0).max(100000).catch(0);

const esquemaRdo = z.object({
  data: z.string().regex(DATA, 'Data inválida.'),
  climaManha: z.enum(CLIMAS).optional().nullable().transform((v) => v ?? null),
  climaTarde: z.enum(CLIMAS).optional().nullable().transform((v) => v ?? null),
  climaNoite: z.enum(CLIMAS).optional().nullable().transform((v) => v ?? null),
  responsavel: texto(120),
  observacoes: texto(4000),
  maoDeObra: z.array(z.object({ funcao: z.string().trim().min(1).max(120), empresa: texto(120), quantidade: inteiro, horas })).max(200).default([]),
  equipamentos: z.array(z.object({ descricao: z.string().trim().min(1).max(160), quantidade: inteiro, horas })).max(200).default([]),
  atividades: z
    .array(z.object({ local: texto(120), descricao: z.string().trim().min(1).max(1000), equipe: texto(120), percentual: z.number().min(0).max(100).optional().nullable().transform((v) => v ?? null) }))
    .max(300)
    .default([]),
  ocorrencias: z.array(z.object({ tipo: z.enum(OCORRENCIAS), descricao: texto(500) })).max(200).default([]),
});

async function obraDaEmpresa(c: Cliente | Banco, empresaId: string, obraId: string) {
  const r = await c.query('SELECT id, codigo, nome FROM obras WHERE id = $1 AND empresa_id = $2 AND ativo', [obraId, empresaId]);
  if (!r.rowCount) throw naoEncontrado('Obra');
  return r.rows[0] as { id: string; codigo: string; nome: string };
}

async function carregarRdo(c: Cliente | Banco, empresaId: string, obraId: string, rdoId: string) {
  const r = await c.query('SELECT * FROM rdos WHERE id = $1 AND obra_id = $2 AND empresa_id = $3', [rdoId, obraId, empresaId]);
  if (!r.rowCount) throw naoEncontrado('RDO');
  const cab = r.rows[0];
  const [mo, eq, at, oc, fo] = await Promise.all([
    c.query('SELECT funcao, empresa, quantidade, horas FROM rdo_mao_obra WHERE rdo_id = $1 ORDER BY ordem', [rdoId]),
    c.query('SELECT descricao, quantidade, horas FROM rdo_equipamentos WHERE rdo_id = $1 ORDER BY ordem', [rdoId]),
    c.query('SELECT local, descricao, equipe, percentual FROM rdo_atividades WHERE rdo_id = $1 ORDER BY ordem', [rdoId]),
    c.query('SELECT tipo, descricao FROM rdo_ocorrencias WHERE rdo_id = $1 ORDER BY ordem', [rdoId]),
    c.query('SELECT id, legenda, ordem FROM rdo_fotos WHERE rdo_id = $1 ORDER BY ordem, criado_em', [rdoId]),
  ]);
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    id: cab.id as string,
    numero: cab.numero as number,
    data: String(cab.data).slice(0, 10),
    climaManha: cab.clima_manha as string | null,
    climaTarde: cab.clima_tarde as string | null,
    climaNoite: cab.clima_noite as string | null,
    responsavel: cab.responsavel as string | null,
    observacoes: cab.observacoes as string | null,
    atualizadoEm: cab.atualizado_em as string,
    maoDeObra: mo.rows.map((x) => ({ funcao: x.funcao, empresa: x.empresa, quantidade: Number(x.quantidade), horas: num(x.horas) })),
    equipamentos: eq.rows.map((x) => ({ descricao: x.descricao, quantidade: Number(x.quantidade), horas: num(x.horas) })),
    atividades: at.rows.map((x) => ({ local: x.local, descricao: x.descricao, equipe: x.equipe, percentual: num(x.percentual) })),
    ocorrencias: oc.rows.map((x) => ({ tipo: x.tipo, descricao: x.descricao })),
    fotos: fo.rows.map((x) => ({ id: x.id as string, legenda: x.legenda as string | null, ordem: Number(x.ordem) })),
  };
}

/** Grava os filhos do RDO (substitui as listas). Chamado dentro de transação. */
async function gravarFilhos(c: Cliente, rdoId: string, d: z.infer<typeof esquemaRdo>) {
  await c.query('DELETE FROM rdo_mao_obra WHERE rdo_id = $1', [rdoId]);
  await c.query('DELETE FROM rdo_equipamentos WHERE rdo_id = $1', [rdoId]);
  await c.query('DELETE FROM rdo_atividades WHERE rdo_id = $1', [rdoId]);
  await c.query('DELETE FROM rdo_ocorrencias WHERE rdo_id = $1', [rdoId]);
  for (const [i, m] of d.maoDeObra.entries())
    await c.query('INSERT INTO rdo_mao_obra (rdo_id, ordem, funcao, empresa, quantidade, horas) VALUES ($1,$2,$3,$4,$5,$6)', [rdoId, i, m.funcao, m.empresa, m.quantidade, m.horas]);
  for (const [i, e] of d.equipamentos.entries())
    await c.query('INSERT INTO rdo_equipamentos (rdo_id, ordem, descricao, quantidade, horas) VALUES ($1,$2,$3,$4,$5)', [rdoId, i, e.descricao, e.quantidade, e.horas]);
  for (const [i, a] of d.atividades.entries())
    await c.query('INSERT INTO rdo_atividades (rdo_id, ordem, local, descricao, equipe, percentual) VALUES ($1,$2,$3,$4,$5,$6)', [rdoId, i, a.local, a.descricao, a.equipe, a.percentual]);
  for (const [i, o] of d.ocorrencias.entries())
    await c.query('INSERT INTO rdo_ocorrencias (rdo_id, ordem, tipo, descricao) VALUES ($1,$2,$3,$4)', [rdoId, i, o.tipo, o.descricao]);
}

/** Rotas do RDO dentro de /api/eng. Mesmas regras de acesso da engenharia: o engenheiro de obra só vê as obras dele. */
export function rotasRdo(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.addHook('preHandler', exigir(banco, 'dono', 'gestor'));
    app.addHook('preHandler', async (req) => {
      if (!ehEngenheiroDeObra(req.usuario)) return;
      const regra = regraEngenheiroEngenharia(req.method, req.url.split('?')[0].replace(/^\/api\/eng/, ''));
      if (regra.tipo === 'negado') throw semPermissao();
      if (regra.tipo === 'obra') {
        const ok = await banco.query(
          `SELECT 1 FROM obra_responsaveis r JOIN obras o ON o.id = r.obra_id
            WHERE r.usuario_id = $1 AND o.empresa_id = $2 AND r.obra_id::text = $3`,
          [req.usuario!.id, empresaDo(req), regra.obraId],
        );
        if (!ok.rowCount) throw naoEncontrado('Obra');
      }
    });

    app.get<{ Params: { obraId: string } }>('/obras/:obraId/rdos', async (req) => {
      const empresaId = empresaDo(req);
      const obra = await obraDaEmpresa(banco, empresaId, req.params.obraId);
      const r = await banco.query(
        `SELECT r.id, r.numero, r.data, r.clima_manha, r.clima_tarde, r.clima_noite, r.responsavel,
                (SELECT coalesce(sum(m.quantidade), 0)::int FROM rdo_mao_obra m WHERE m.rdo_id = r.id) AS efetivo,
                (SELECT count(*)::int FROM rdo_ocorrencias o WHERE o.rdo_id = r.id) AS ocorrencias
           FROM rdos r WHERE r.obra_id = $1 AND r.empresa_id = $2 ORDER BY r.data DESC`,
        [obra.id, empresaId],
      );
      return {
        obra,
        rdos: r.rows.map((x) => ({
          id: x.id,
          numero: x.numero,
          data: String(x.data).slice(0, 10),
          climaManha: x.clima_manha,
          climaTarde: x.clima_tarde,
          climaNoite: x.clima_noite,
          responsavel: x.responsavel,
          efetivo: x.efetivo,
          ocorrencias: x.ocorrencias,
        })),
      };
    });

    app.post<{ Params: { obraId: string } }>('/obras/:obraId/rdos', async (req, reply) => {
      const empresaId = empresaDo(req);
      const { data } = z.object({ data: z.string().regex(DATA, 'Data inválida.') }).parse(req.body);
      const id = await emTransacao(banco, async (c) => {
        const obra = await obraDaEmpresa(c, empresaId, req.params.obraId);
        if ((await c.query('SELECT 1 FROM rdos WHERE obra_id = $1 AND data = $2', [obra.id, data])).rowCount)
          throw new ErroHttp(409, 'Já existe um RDO desta obra para esta data.');
        const prox = await c.query('SELECT coalesce(max(numero), 0) + 1 AS n FROM rdos WHERE obra_id = $1', [obra.id]);
        const novo = await c.query(
          `INSERT INTO rdos (empresa_id, obra_id, numero, data, criado_por) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [empresaId, obra.id, Number(prox.rows[0].n), data, req.usuario!.id],
        );
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'rdos', entidadeId: novo.rows[0].id, depois: { obra: obra.codigo, data } });
        return novo.rows[0].id as string;
      });
      reply.code(201);
      return { id };
    });

    app.get<{ Params: { obraId: string; id: string } }>('/obras/:obraId/rdos/:id', async (req) => {
      const empresaId = empresaDo(req);
      const obra = await obraDaEmpresa(banco, empresaId, req.params.obraId);
      return { obra, rdo: await carregarRdo(banco, empresaId, obra.id, req.params.id) };
    });

    app.put<{ Params: { obraId: string; id: string } }>('/obras/:obraId/rdos/:id', async (req) => {
      const empresaId = empresaDo(req);
      const d = esquemaRdo.parse(req.body);
      await emTransacao(banco, async (c) => {
        const obra = await obraDaEmpresa(c, empresaId, req.params.obraId);
        const antes = await carregarRdo(c, empresaId, obra.id, req.params.id);
        if ((await c.query('SELECT 1 FROM rdos WHERE obra_id = $1 AND data = $2 AND id <> $3', [obra.id, d.data, req.params.id])).rowCount)
          throw new ErroHttp(409, 'Já existe um RDO desta obra para esta data.');
        await c.query(
          `UPDATE rdos SET data = $1, clima_manha = $2, clima_tarde = $3, clima_noite = $4, responsavel = $5, observacoes = $6, atualizado_em = now()
            WHERE id = $7 AND obra_id = $8 AND empresa_id = $9`,
          [d.data, d.climaManha, d.climaTarde, d.climaNoite, d.responsavel, d.observacoes, req.params.id, obra.id, empresaId],
        );
        await gravarFilhos(c, req.params.id, d);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'rdos', entidadeId: req.params.id, antes: { data: antes.data }, depois: { data: d.data } });
      });
      return { ok: true };
    });

    // ---- fotos do RDO

    const esquemaFoto = z.object({
      imagem: z.string().min(10),
      tipo: z.enum(['image/jpeg', 'image/png']),
      legenda: texto(200),
    });
    const LIMITE_FOTO = 2 * 1024 * 1024;
    const LIMITE_FOTOS_RDO = 60;

    app.post<{ Params: { obraId: string; id: string } }>('/obras/:obraId/rdos/:id/fotos', { bodyLimit: 4 * 1024 * 1024 }, async (req, reply) => {
      const empresaId = empresaDo(req);
      const d = esquemaFoto.parse(req.body);
      const bytes = Buffer.from(d.imagem, 'base64');
      if (!bytes.length || bytes.length > LIMITE_FOTO) throw new ErroHttp(400, 'Foto grande demais. Reduza a imagem (máximo 2 MB).');
      const id = await emTransacao(banco, async (c) => {
        const obra = await obraDaEmpresa(c, empresaId, req.params.obraId);
        await carregarRdo(c, empresaId, obra.id, req.params.id);
        const total = await c.query('SELECT count(*)::int AS n FROM rdo_fotos WHERE rdo_id = $1', [req.params.id]);
        if (Number(total.rows[0].n) >= LIMITE_FOTOS_RDO) throw new ErroHttp(409, `Limite de ${LIMITE_FOTOS_RDO} fotos por RDO.`);
        const nova = await c.query(
          `INSERT INTO rdo_fotos (rdo_id, ordem, legenda, tipo, conteudo)
           VALUES ($1, (SELECT coalesce(max(ordem), -1) + 1 FROM rdo_fotos WHERE rdo_id = $1), $2, $3, $4) RETURNING id`,
          [req.params.id, d.legenda, d.tipo, bytes],
        );
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'rdo_fotos', entidadeId: nova.rows[0].id, depois: { rdo: req.params.id } });
        return nova.rows[0].id as string;
      });
      reply.code(201);
      return { id };
    });

    app.get<{ Params: { obraId: string; id: string; fotoId: string } }>('/obras/:obraId/rdos/:id/fotos/:fotoId', async (req, reply) => {
      const empresaId = empresaDo(req);
      const obra = await obraDaEmpresa(banco, empresaId, req.params.obraId);
      await carregarRdo(banco, empresaId, obra.id, req.params.id);
      const r = await banco.query('SELECT tipo, conteudo FROM rdo_fotos WHERE id = $1 AND rdo_id = $2', [req.params.fotoId, req.params.id]);
      if (!r.rowCount) throw naoEncontrado('Foto');
      reply.header('Cache-Control', 'private, max-age=3600');
      return reply.type(r.rows[0].tipo as string).send(r.rows[0].conteudo as Buffer);
    });

    app.put<{ Params: { obraId: string; id: string; fotoId: string } }>('/obras/:obraId/rdos/:id/fotos/:fotoId', async (req) => {
      const empresaId = empresaDo(req);
      const { legenda } = z.object({ legenda: texto(200) }).parse(req.body);
      const obra = await obraDaEmpresa(banco, empresaId, req.params.obraId);
      await carregarRdo(banco, empresaId, obra.id, req.params.id);
      const r = await banco.query('UPDATE rdo_fotos SET legenda = $1 WHERE id = $2 AND rdo_id = $3 RETURNING id', [legenda, req.params.fotoId, req.params.id]);
      if (!r.rowCount) throw naoEncontrado('Foto');
      return { ok: true };
    });

    app.delete<{ Params: { obraId: string; id: string; fotoId: string } }>('/obras/:obraId/rdos/:id/fotos/:fotoId', async (req) => {
      const empresaId = empresaDo(req);
      const obra = await obraDaEmpresa(banco, empresaId, req.params.obraId);
      await carregarRdo(banco, empresaId, obra.id, req.params.id);
      const r = await banco.query('DELETE FROM rdo_fotos WHERE id = $1 AND rdo_id = $2 RETURNING id', [req.params.fotoId, req.params.id]);
      if (!r.rowCount) throw naoEncontrado('Foto');
      return { ok: true };
    });

    app.delete<{ Params: { obraId: string; id: string } }>('/obras/:obraId/rdos/:id', async (req) => {
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const obra = await obraDaEmpresa(c, empresaId, req.params.obraId);
        const antes = await carregarRdo(c, empresaId, obra.id, req.params.id);
        await c.query('DELETE FROM rdos WHERE id = $1 AND obra_id = $2', [req.params.id, obra.id]);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'excluir', entidade: 'rdos', entidadeId: req.params.id, antes: { data: antes.data, numero: antes.numero } });
      });
      return { ok: true };
    });
  };
}
