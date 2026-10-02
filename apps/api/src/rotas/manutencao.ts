// Rotas da manutenção: planos preventivos, situação por veículo e ordens de serviço.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Banco, Cliente } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';
import { hojeBrasil } from '../lib/frota.ts';
import { PLANO_PADRAO, situacaoRevisao } from '../lib/manutencao.ts';
import { empresaDo, exigir } from '../sessao.ts';

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const dataIso = (v: unknown) => (v ? String(v).slice(0, 10) : null);

function numeroBr(v: unknown): unknown {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim().replace(/\s/g, '');
  let n = s;
  if (s.includes(',')) n = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) n = s.replace(/\./g, '');
  const x = Number(n);
  return Number.isFinite(x) ? x : v;
}
const numero = (campo: string, max: number) => z.preprocess(numeroBr, z.number({ invalid_type_error: `${campo}: número inválido.` }).min(0, `${campo} inválido.`).max(max).nullable());
const inteiroPositivo = (campo: string) => z.preprocess(numeroBr, z.number({ invalid_type_error: `${campo}: número inválido.` }).int(`${campo}: use número inteiro.`).positive(`${campo} deve ser maior que zero.`).nullable());
const data = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.'), z.literal(''), z.null()]).optional().transform((v) => v || null);
const TIPOS_VEICULO = ['betoneira', 'bomba_lanca', 'bomba_estacionaria', 'apoio', 'pa_carregadeira'] as const;

const esquemaPlano = z
  .object({
    tipoVeiculo: z.enum(TIPOS_VEICULO).nullable().optional().default(null),
    item: z.string({ required_error: 'Descreva o item.' }).trim().min(3, 'Descreva o item.').max(200),
    intervaloKm: inteiroPositivo('Intervalo de km').optional().default(null),
    intervaloHoras: inteiroPositivo('Intervalo de horas').optional().default(null),
    intervaloDias: inteiroPositivo('Intervalo de dias').optional().default(null),
    ativo: z.boolean().optional().default(true),
  })
  .refine((d) => d.intervaloKm || d.intervaloHoras || d.intervaloDias, 'Informe pelo menos um intervalo: km, horas ou dias.');

const esquemaRevisao = z.object({
  veiculoId: z.string().uuid(),
  planoId: z.string().uuid(),
  km: numero('Km', 9_999_999).optional().default(null),
  horas: numero('Horímetro', 999_999).optional().default(null),
  data: data,
});

const esquemaOS = z.object({
  veiculoId: z.string({ required_error: 'Escolha o veículo.' }).uuid('Escolha o veículo.'),
  tipo: z.enum(['preventiva', 'corretiva']),
  descricao: z.string({ required_error: 'Descreva o serviço ou defeito.' }).trim().min(3, 'Descreva o serviço ou defeito.').max(1000),
  abertura: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de abertura inválida.').optional(),
  km: numero('Km', 9_999_999).optional().default(null),
  horimetro: numero('Horímetro', 999_999).optional().default(null),
  oficina: z.enum(['interna', 'externa']).optional().default('externa'),
  fornecedorId: z.string().uuid().nullable().optional().default(null),
  observacoes: z.string().trim().max(1000).optional().nullable().transform((v) => v || null),
  pararVeiculo: z.boolean().optional().default(true),
  planoIds: z.array(z.string().uuid()).max(30).optional().default([]),
});

const esquemaAlterarOS = z
  .object({
    descricao: z.string().trim().min(3).max(1000),
    tipo: z.enum(['preventiva', 'corretiva']),
    oficina: z.enum(['interna', 'externa']),
    fornecedorId: z.string().uuid().nullable(),
    km: numero('Km', 9_999_999),
    horimetro: numero('Horímetro', 999_999),
    observacoes: z.string().trim().max(1000).nullable().transform((v) => v || null),
    status: z.enum(['aberta', 'em_andamento']),
  })
  .partial()
  .strict();

const esquemaItem = z.object({
  tipo: z.enum(['peca', 'mao_de_obra', 'servico']),
  descricao: z.string({ required_error: 'Descreva o item.' }).trim().min(2, 'Descreva o item.').max(300),
  quantidade: z.preprocess(numeroBr, z.number({ invalid_type_error: 'Quantidade inválida.' }).positive('Quantidade inválida.').max(100000)).optional().default(1),
  valorUnitario: z.preprocess(numeroBr, z.number({ invalid_type_error: 'Valor inválido.' }).min(0, 'Valor inválido.').max(10_000_000)).optional().default(0),
  planoId: z.string().uuid().nullable().optional().default(null),
});

const esquemaConcluir = z.object({
  conclusao: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de conclusão inválida.'),
  km: numero('Km', 9_999_999).optional().default(null),
  horimetro: numero('Horímetro', 999_999).optional().default(null),
  liberarVeiculo: z.boolean().optional().default(true),
});

function planoPublico(r: Record<string, any>) {
  return {
    id: r.id,
    tipoVeiculo: r.tipo_veiculo,
    item: r.item,
    intervaloKm: r.intervalo_km,
    intervaloHoras: r.intervalo_horas,
    intervaloDias: r.intervalo_dias,
    ativo: r.ativo,
  };
}

/** Situação de cada item do plano em cada veículo ativo. */
export async function situacaoManutencao(c: Cliente, empresaId: string, veiculoId?: string) {
  const hoje = hojeBrasil();
  const veiculos = (
    await c.query(
      `SELECT id, codigo, tipo, km_atual, horimetro_atual, status FROM veiculos
        WHERE empresa_id = $1 AND excluido_em IS NULL AND status <> 'inativo' AND ($2::uuid IS NULL OR id = $2) ORDER BY codigo`,
      [empresaId, veiculoId ?? null],
    )
  ).rows;
  const planos = (await c.query('SELECT * FROM planos_manutencao WHERE empresa_id = $1 AND ativo ORDER BY item', [empresaId])).rows;
  const revs = (await c.query('SELECT * FROM revisoes_veiculo WHERE empresa_id = $1', [empresaId])).rows;
  const ultima = new Map(revs.map((r) => [`${r.veiculo_id}:${r.plano_id}`, r]));
  const itens = [];
  for (const v of veiculos) {
    for (const p of planos) {
      if (p.tipo_veiculo && p.tipo_veiculo !== v.tipo) continue;
      const bomba = String(v.tipo).startsWith('bomba');
      // Itens só de km não se aplicam a quem não roda (pá-carregadeira) — mantém os demais.
      const r = ultima.get(`${v.id}:${p.id}`);
      const sit = situacaoRevisao(
        { intervaloKm: p.intervalo_km, intervaloHoras: p.intervalo_horas, intervaloDias: p.intervalo_dias },
        r ? { km: num(r.ultima_km), horas: num(r.ultima_horas), data: dataIso(r.ultima_data) } : null,
        { km: Number(v.km_atual), horas: Number(v.horimetro_atual), hoje },
      );
      itens.push({
        veiculoId: v.id,
        codigo: v.codigo,
        tipoVeiculo: v.tipo,
        bomba,
        planoId: p.id,
        item: p.item,
        intervaloKm: p.intervalo_km,
        intervaloHoras: p.intervalo_horas,
        intervaloDias: p.intervalo_dias,
        ultimaKm: r ? num(r.ultima_km) : null,
        ultimaHoras: r ? num(r.ultima_horas) : null,
        ultimaData: r ? dataIso(r.ultima_data) : null,
        ...sit,
      });
    }
  }
  return itens;
}

async function proximoNumero(c: Cliente, empresaId: string): Promise<number> {
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`os:${empresaId}`]);
  const r = await c.query('SELECT coalesce(max(numero), 0) + 1 AS n FROM ordens_servico WHERE empresa_id = $1', [empresaId]);
  return r.rows[0].n;
}

async function carregarOS(c: Cliente, empresaId: string, id: string) {
  const os = (
    await c.query(
      `SELECT o.*, v.codigo, v.tipo AS tipo_veiculo, v.status AS status_veiculo, coalesce(f.nome_fantasia, f.razao_social) AS fornecedor_nome
         FROM ordens_servico o JOIN veiculos v ON v.id = o.veiculo_id LEFT JOIN fornecedores f ON f.id = o.fornecedor_id
        WHERE o.id = $1 AND o.empresa_id = $2`,
      [id, empresaId],
    )
  ).rows[0];
  if (!os) throw naoEncontrado('Ordem de serviço');
  const itens = (
    await c.query(
      `SELECT i.*, p.item AS plano_item FROM os_itens i LEFT JOIN planos_manutencao p ON p.id = i.plano_id
        WHERE i.os_id = $1 AND i.excluido_em IS NULL ORDER BY i.criado_em`,
      [id],
    )
  ).rows;
  return { os, itens };
}

function osPublica(o: Record<string, any>, itens: Record<string, any>[] = []) {
  const its = itens.map((i) => ({
    id: i.id,
    tipo: i.tipo,
    descricao: i.descricao,
    quantidade: Number(i.quantidade),
    valorUnitario: Number(i.valor_unitario_centavos) / 100,
    total: Math.round(Number(i.quantidade) * Number(i.valor_unitario_centavos)) / 100,
    planoId: i.plano_id,
    planoItem: i.plano_item ?? null,
    temNota: !!i.nota_item_id,
  }));
  const dias = o.abertura ? Math.max(0, Math.round(((o.conclusao ? Date.parse(String(o.conclusao)) : Date.parse(hojeBrasil())) - Date.parse(String(o.abertura))) / 86_400_000)) : null;
  return {
    id: o.id,
    numero: o.numero,
    veiculoId: o.veiculo_id,
    veiculoCodigo: o.codigo,
    tipo: o.tipo,
    descricao: o.descricao,
    abertura: dataIso(o.abertura),
    conclusao: dataIso(o.conclusao),
    dias,
    km: num(o.km),
    horimetro: num(o.horimetro),
    oficina: o.oficina,
    fornecedorId: o.fornecedor_id,
    fornecedorNome: o.fornecedor_nome ?? null,
    status: o.status,
    observacoes: o.observacoes,
    total: o.total_centavos !== undefined && o.total_centavos !== null ? Number(o.total_centavos) / 100 : Math.round(its.reduce((s, i) => s + i.total * 100, 0)) / 100,
    itens: its,
  };
}

export function rotasManutencao(banco: Banco) {
  return async function (app: FastifyInstance) {
    const gestao = exigir(banco, 'dono', 'gestor');

    // ---------- Planos ----------
    app.get('/planos', { preHandler: gestao }, async (req) => {
      const r = await banco.query('SELECT * FROM planos_manutencao WHERE empresa_id = $1 ORDER BY tipo_veiculo NULLS FIRST, item', [empresaDo(req)]);
      return { planos: r.rows.map(planoPublico) };
    });

    app.post('/planos', { preHandler: gestao }, async (req, reply) => {
      const d = esquemaPlano.parse(req.body);
      const empresaId = empresaDo(req);
      const p = (
        await banco.query(
          `INSERT INTO planos_manutencao (empresa_id, tipo_veiculo, item, intervalo_km, intervalo_horas, intervalo_dias, ativo) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [empresaId, d.tipoVeiculo, d.item, d.intervaloKm, d.intervaloHoras, d.intervaloDias, d.ativo],
        )
      ).rows[0];
      await auditar(banco, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'planos_manutencao', entidadeId: p.id, depois: p });
      reply.code(201);
      return { plano: planoPublico(p) };
    });

    app.put<{ Params: { id: string } }>('/planos/:id', { preHandler: gestao }, async (req) => {
      const d = esquemaPlano.parse(req.body);
      const empresaId = empresaDo(req);
      const p = await emTransacao(banco, async (c) => {
        const antes = (await c.query('SELECT * FROM planos_manutencao WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [req.params.id, empresaId])).rows[0];
        if (!antes) throw naoEncontrado('Item do plano');
        const depois = (
          await c.query(
            `UPDATE planos_manutencao SET tipo_veiculo = $3, item = $4, intervalo_km = $5, intervalo_horas = $6, intervalo_dias = $7, ativo = $8, atualizado_em = now()
              WHERE id = $1 AND empresa_id = $2 RETURNING *`,
            [antes.id, empresaId, d.tipoVeiculo, d.item, d.intervaloKm, d.intervaloHoras, d.intervaloDias, d.ativo],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'planos_manutencao', entidadeId: antes.id, antes, depois });
        return depois;
      });
      return { plano: planoPublico(p) };
    });

    app.post('/planos/padrao', { preHandler: gestao }, async (req) => {
      const empresaId = empresaDo(req);
      const criados = await emTransacao(banco, async (c) => {
        const existentes = new Set((await c.query('SELECT lower(item) AS i FROM planos_manutencao WHERE empresa_id = $1', [empresaId])).rows.map((r) => r.i));
        let n = 0;
        for (const p of PLANO_PADRAO) {
          if (existentes.has(p.item.toLowerCase())) continue;
          await c.query(
            `INSERT INTO planos_manutencao (empresa_id, tipo_veiculo, item, intervalo_km, intervalo_horas, intervalo_dias) VALUES ($1,$2,$3,$4,$5,$6)`,
            [empresaId, p.tipo, p.item, p.km ?? null, p.horas ?? null, p.dias ?? null],
          );
          n++;
        }
        return n;
      });
      return { criados };
    });

    // ---------- Situação ----------
    app.get<{ Querystring: { veiculoId?: string } }>('/manutencao', { preHandler: gestao }, async (req) => {
      const v = req.query.veiculoId && /^[0-9a-f-]{36}$/i.test(req.query.veiculoId) ? req.query.veiculoId : undefined;
      return { itens: await situacaoManutencao(banco, empresaDo(req), v) };
    });

    // Registra a última execução de um item (ex.: ao implantar o sistema).
    app.put('/revisoes', { preHandler: gestao }, async (req) => {
      const d = esquemaRevisao.parse(req.body);
      const empresaId = empresaDo(req);
      if (d.km === null && d.horas === null && d.data === null) throw new ErroHttp(400, 'Informe o km, o horímetro ou a data da última execução.');
      await emTransacao(banco, async (c) => {
        const ok = await c.query(
          `SELECT 1 FROM veiculos v, planos_manutencao p WHERE v.id = $1 AND p.id = $2 AND v.empresa_id = $3 AND p.empresa_id = $3`,
          [d.veiculoId, d.planoId, empresaId],
        );
        if (!ok.rowCount) throw naoEncontrado('Veículo ou item do plano');
        const r = (
          await c.query(
            `INSERT INTO revisoes_veiculo (empresa_id, veiculo_id, plano_id, ultima_km, ultima_horas, ultima_data)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (veiculo_id, plano_id) DO UPDATE SET ultima_km = $4, ultima_horas = $5, ultima_data = $6, os_id = NULL, atualizado_em = now()
             RETURNING *`,
            [empresaId, d.veiculoId, d.planoId, d.km, d.horas, d.data],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'revisoes_veiculo', entidadeId: r.id, depois: r });
      });
      return { ok: true };
    });

    // ---------- Ordens de serviço ----------
    app.get<{ Querystring: { status?: string; veiculoId?: string; dias?: string } }>('/os', { preHandler: gestao }, async (req) => {
      const empresaId = empresaDo(req);
      const status = ['aberta', 'em_andamento', 'concluida', 'cancelada', 'abertas'].includes(req.query.status ?? '') ? req.query.status! : null;
      const veiculoId = req.query.veiculoId && /^[0-9a-f-]{36}$/i.test(req.query.veiculoId) ? req.query.veiculoId : null;
      const dias = Math.min(Math.max(Number(req.query.dias) || 365, 1), 3650);
      const r = await banco.query(
        `SELECT o.*, v.codigo, coalesce(f.nome_fantasia, f.razao_social) AS fornecedor_nome,
                (SELECT coalesce(sum(round(i.quantidade * i.valor_unitario_centavos)), 0) FROM os_itens i WHERE i.os_id = o.id AND i.excluido_em IS NULL) AS total_centavos
           FROM ordens_servico o JOIN veiculos v ON v.id = o.veiculo_id LEFT JOIN fornecedores f ON f.id = o.fornecedor_id
          WHERE o.empresa_id = $1
            AND ($2::text IS NULL OR ($2 = 'abertas' AND o.status IN ('aberta','em_andamento')) OR o.status::text = $2)
            AND ($3::uuid IS NULL OR o.veiculo_id = $3)
            AND (o.status IN ('aberta','em_andamento') OR o.abertura >= current_date - $4::int)
          ORDER BY (o.status IN ('aberta','em_andamento')) DESC, o.abertura DESC, o.numero DESC
          LIMIT 500`,
        [empresaId, status, veiculoId, dias],
      );
      return { ordens: r.rows.map((o) => osPublica(o)) };
    });

    app.post('/os', { preHandler: gestao }, async (req, reply) => {
      const d = esquemaOS.parse(req.body);
      const empresaId = empresaDo(req);
      const id = await emTransacao(banco, async (c) => {
        const v = (await c.query('SELECT * FROM veiculos WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL FOR UPDATE', [d.veiculoId, empresaId])).rows[0];
        if (!v) throw naoEncontrado('Veículo');
        if (d.oficina === 'externa' && d.fornecedorId) {
          const f = await c.query('SELECT 1 FROM fornecedores WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL', [d.fornecedorId, empresaId]);
          if (!f.rowCount) throw new ErroHttp(400, 'Oficina não encontrada em Fornecedores.');
        }
        const numero = await proximoNumero(c, empresaId);
        const os = (
          await c.query(
            `INSERT INTO ordens_servico (empresa_id, numero, veiculo_id, tipo, descricao, abertura, km, horimetro, oficina, fornecedor_id, observacoes, aberta_por_id, status_veiculo_anterior)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
            [empresaId, numero, v.id, d.tipo, d.descricao, d.abertura ?? hojeBrasil(), d.km ?? num(v.km_atual), d.horimetro ?? num(v.horimetro_atual), d.oficina, d.oficina === 'externa' ? d.fornecedorId : null, d.observacoes, req.usuario!.id, v.status],
          )
        ).rows[0];
        // Itens preventivos escolhidos entram como serviço, já ligados ao plano.
        if (d.planoIds.length) {
          const planos = (await c.query('SELECT id, item FROM planos_manutencao WHERE empresa_id = $1 AND id = ANY($2::uuid[])', [empresaId, d.planoIds])).rows;
          for (const p of planos) {
            await c.query(`INSERT INTO os_itens (empresa_id, os_id, tipo, descricao, plano_id) VALUES ($1,$2,'servico',$3,$4)`, [empresaId, os.id, p.item, p.id]);
          }
        }
        if (d.pararVeiculo && v.status !== 'inativo') {
          await c.query(`UPDATE veiculos SET status = 'manutencao', atualizado_em = now() WHERE id = $1`, [v.id]);
        }
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'ordens_servico', entidadeId: os.id, depois: os });
        return os.id;
      });
      const { os, itens } = await carregarOS(banco, empresaId, id);
      reply.code(201);
      return { os: osPublica(os, itens) };
    });

    app.get<{ Params: { id: string } }>('/os/:id', { preHandler: gestao }, async (req) => {
      const { os, itens } = await carregarOS(banco, empresaDo(req), req.params.id);
      return { os: osPublica(os, itens) };
    });

    app.patch<{ Params: { id: string } }>('/os/:id', { preHandler: gestao }, async (req) => {
      const d = esquemaAlterarOS.parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const antes = (await c.query('SELECT * FROM ordens_servico WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [req.params.id, empresaId])).rows[0];
        if (!antes) throw naoEncontrado('Ordem de serviço');
        if (antes.status === 'concluida' || antes.status === 'cancelada') throw new ErroHttp(400, 'Esta ordem de serviço já foi encerrada.');
        const col: Record<string, string> = { descricao: 'descricao', tipo: 'tipo', oficina: 'oficina', fornecedorId: 'fornecedor_id', km: 'km', horimetro: 'horimetro', observacoes: 'observacoes', status: 'status' };
        const partes: string[] = [];
        const valores: unknown[] = [];
        for (const [k, v] of Object.entries(d)) {
          if (v === undefined) continue;
          valores.push(v);
          partes.push(`${col[k]} = $${valores.length + 2}`);
        }
        if (!partes.length) return;
        const depois = (await c.query(`UPDATE ordens_servico SET ${partes.join(', ')}, atualizado_em = now() WHERE id = $1 AND empresa_id = $2 RETURNING *`, [antes.id, empresaId, ...valores])).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'ordens_servico', entidadeId: antes.id, antes, depois });
      });
      const { os, itens } = await carregarOS(banco, empresaId, req.params.id);
      return { os: osPublica(os, itens) };
    });

    app.post<{ Params: { id: string } }>('/os/:id/itens', { preHandler: gestao }, async (req, reply) => {
      const d = esquemaItem.parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const os = (await c.query('SELECT * FROM ordens_servico WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [req.params.id, empresaId])).rows[0];
        if (!os) throw naoEncontrado('Ordem de serviço');
        if (os.status === 'concluida' || os.status === 'cancelada') throw new ErroHttp(400, 'Esta ordem de serviço já foi encerrada.');
        const item = (
          await c.query(
            `INSERT INTO os_itens (empresa_id, os_id, tipo, descricao, quantidade, valor_unitario_centavos, plano_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [empresaId, os.id, d.tipo, d.descricao, d.quantidade, Math.round(d.valorUnitario * 100), d.planoId],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'os_itens', entidadeId: item.id, depois: item });
      });
      const { os, itens } = await carregarOS(banco, empresaId, req.params.id);
      reply.code(201);
      return { os: osPublica(os, itens) };
    });

    app.delete<{ Params: { id: string } }>('/os/itens/:id', { preHandler: gestao }, async (req) => {
      const empresaId = empresaDo(req);
      const osId = await emTransacao(banco, async (c) => {
        const i = (
          await c.query(
            `SELECT i.*, o.status FROM os_itens i JOIN ordens_servico o ON o.id = i.os_id WHERE i.id = $1 AND i.empresa_id = $2 AND i.excluido_em IS NULL FOR UPDATE OF i`,
            [req.params.id, empresaId],
          )
        ).rows[0];
        if (!i) throw naoEncontrado('Item');
        if (i.status === 'concluida' || i.status === 'cancelada') throw new ErroHttp(400, 'Esta ordem de serviço já foi encerrada.');
        await c.query('UPDATE os_itens SET excluido_em = now() WHERE id = $1', [i.id]);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'excluir', entidade: 'os_itens', entidadeId: i.id, antes: i });
        return i.os_id;
      });
      const { os, itens } = await carregarOS(banco, empresaId, osId);
      return { os: osPublica(os, itens) };
    });

    app.post<{ Params: { id: string } }>('/os/:id/concluir', { preHandler: gestao }, async (req) => {
      const d = esquemaConcluir.parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const os = (await c.query('SELECT * FROM ordens_servico WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [req.params.id, empresaId])).rows[0];
        if (!os) throw naoEncontrado('Ordem de serviço');
        if (os.status === 'concluida' || os.status === 'cancelada') throw new ErroHttp(400, 'Esta ordem de serviço já foi encerrada.');
        if (d.conclusao < dataIso(os.abertura)!) throw new ErroHttp(400, 'A conclusão não pode ser antes da abertura.');
        const km = d.km ?? num(os.km);
        const hor = d.horimetro ?? num(os.horimetro);
        await c.query(`UPDATE ordens_servico SET status = 'concluida', conclusao = $2, km = $3, horimetro = $4, atualizado_em = now() WHERE id = $1`, [os.id, d.conclusao, km, hor]);
        // Itens preventivos: registra a execução no plano do veículo.
        const prev = (await c.query('SELECT DISTINCT plano_id FROM os_itens WHERE os_id = $1 AND plano_id IS NOT NULL AND excluido_em IS NULL', [os.id])).rows;
        for (const p of prev) {
          await c.query(
            `INSERT INTO revisoes_veiculo (empresa_id, veiculo_id, plano_id, ultima_km, ultima_horas, ultima_data, os_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (veiculo_id, plano_id) DO UPDATE SET ultima_km = $4, ultima_horas = $5, ultima_data = $6, os_id = $7, atualizado_em = now()`,
            [empresaId, os.veiculo_id, p.plano_id, km, hor, d.conclusao, os.id],
          );
        }
        await c.query(
          `UPDATE veiculos SET km_atual = GREATEST(km_atual, COALESCE($2, km_atual)), horimetro_atual = GREATEST(horimetro_atual, COALESCE($3, horimetro_atual)),
                  status = CASE WHEN $4 AND status = 'manutencao' THEN 'disponivel'::status_veiculo ELSE status END, atualizado_em = now()
            WHERE id = $1`,
          [os.veiculo_id, km, hor, d.liberarVeiculo],
        );
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'confirmar', entidade: 'ordens_servico', entidadeId: os.id, antes: os, depois: { status: 'concluida', conclusao: d.conclusao, km, horimetro: hor } });
      });
      const { os, itens } = await carregarOS(banco, empresaId, req.params.id);
      return { os: osPublica(os, itens) };
    });

    app.post<{ Params: { id: string } }>('/os/:id/cancelar', { preHandler: gestao }, async (req) => {
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const os = (await c.query('SELECT * FROM ordens_servico WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [req.params.id, empresaId])).rows[0];
        if (!os) throw naoEncontrado('Ordem de serviço');
        if (os.status === 'concluida' || os.status === 'cancelada') throw new ErroHttp(400, 'Esta ordem de serviço já foi encerrada.');
        await c.query(`UPDATE ordens_servico SET status = 'cancelada', atualizado_em = now() WHERE id = $1`, [os.id]);
        // Devolve o veículo à situação anterior, se ainda estiver marcado como em manutenção.
        await c.query(`UPDATE veiculos SET status = coalesce($2, 'disponivel')::status_veiculo WHERE id = $1 AND status = 'manutencao'`, [os.veiculo_id, os.status_veiculo_anterior === 'manutencao' ? 'disponivel' : os.status_veiculo_anterior]);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'ordens_servico', entidadeId: os.id, antes: os, depois: { status: 'cancelada' } });
      });
      const { os, itens } = await carregarOS(banco, empresaId, req.params.id);
      return { os: osPublica(os, itens) };
    });

    // Custo de manutenção por veículo (OS concluídas no período).
    app.get<{ Querystring: { dias?: string } }>('/custo-manutencao', { preHandler: gestao }, async (req) => {
      const dias = Math.min(Math.max(Number(req.query.dias) || 30, 1), 3650);
      const r = await banco.query(
        `SELECT o.veiculo_id, v.codigo, count(DISTINCT o.id)::int AS ordens,
                coalesce(sum(round(i.quantidade * i.valor_unitario_centavos)), 0) AS total_centavos,
                coalesce(sum(CASE WHEN i.tipo = 'peca' THEN round(i.quantidade * i.valor_unitario_centavos) END), 0) AS pecas_centavos
           FROM ordens_servico o JOIN veiculos v ON v.id = o.veiculo_id
           LEFT JOIN os_itens i ON i.os_id = o.id AND i.excluido_em IS NULL
          WHERE o.empresa_id = $1 AND o.status = 'concluida' AND o.conclusao >= current_date - $2::int
          GROUP BY o.veiculo_id, v.codigo ORDER BY total_centavos DESC`,
        [empresaDo(req), dias],
      );
      return {
        veiculos: r.rows.map((x) => ({ veiculoId: x.veiculo_id, codigo: x.codigo, ordens: x.ordens, total: Number(x.total_centavos) / 100, pecas: Number(x.pecas_centavos) / 100 })),
      };
    });
  };
}
