// Módulo Produção: insumos, traços, cargas produzidas, produção dos motoristas e escala de trabalho.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Banco, Cliente } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';
import { hojeBrasil } from '../lib/frota.ts';
import { somarDias } from '../lib/financeiro.ts';
import { empresaDo, exigir } from '../sessao.ts';
import { gravarConsumoCarga, saldosEm } from '../lib/estoque.ts';
import { atualizarSituacaoVenda, vendaPublica } from './comercial.ts';
import { cancelarAmostraCarga, criarAmostraCarga, reprogramarAmostra } from '../lib/qualidade.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const DIA_LOCAL = (col: string) => `(${col} AT TIME ZONE 'America/Sao_Paulo')::date`;
const reais = (c: unknown) => (c === null || c === undefined ? null : Math.round(Number(c)) / 100);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

const texto = (max = 200) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const idOpcional = z.union([z.string().uuid(), z.literal(''), z.null()]).optional().transform((v) => v || null);
const decimal = (msg: string) =>
  z.union([z.number(), z.string()]).transform((v, ctx) => {
    const n = typeof v === 'number' ? v : Number(String(v).replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: 'custom', message: msg });
      return z.NEVER;
    }
    return n;
  });

export const TIPOS_INSUMO = ['cimento', 'areia', 'brita', 'aditivo', 'agua', 'fibra', 'outro'] as const;
export const UNIDADES_INSUMO = ['kg', 'L', 'm3', 't', 'un'] as const;

const esquemaInsumo = z.object({
  nome: z.string({ required_error: 'Informe o nome do insumo.' }).trim().min(2, 'Informe o nome do insumo.').max(120),
  tipo: z.enum(TIPOS_INSUMO).optional().default('outro'),
  unidade: z.enum(UNIDADES_INSUMO).optional().default('kg'),
  custoUnitario: decimal('Custo inválido.').nullable().optional(),
  estoqueMinimo: decimal('Estoque mínimo inválido.').nullable().optional(),
  ativo: z.boolean().optional().default(true),
  controlaEstoque: z.boolean().optional().default(true),
});

const esquemaTraco = z.object({
  codigo: z.string({ required_error: 'Informe o código do traço.' }).trim().min(1, 'Informe o código do traço.').max(40),
  descricao: texto(200),
  fck: z.union([z.number().int().min(5).max(100), z.null()]).optional(),
  slump: texto(20),
  brita: texto(40),
  observacoes: texto(1000),
  ativo: z.boolean().optional().default(true),
  itens: z
    .array(z.object({ insumoId: z.string().uuid(), quantidade: decimal('Quantidade inválida.').refine((n) => n > 0, 'A quantidade precisa ser maior que zero.') }))
    .max(30)
    .optional(),
});

const esquemaCarga = z.object({
  dataHora: z.string().optional(),
  tracoId: z.string({ required_error: 'Escolha o traço.' }).uuid('Escolha o traço.'),
  volume: decimal('Volume inválido.').refine((n) => n > 0 && n <= 20, 'O volume da carga vai de 0,5 a 20 m³.'),
  clienteId: idOpcional,
  obra: texto(200),
  betoneiraId: z.string({ required_error: 'Escolha a betoneira.' }).uuid('Escolha a betoneira.'),
  motoristaId: idOpcional,
  bombaId: idOpcional,
  operadorBombaId: idOpcional,
  volumeBombeado: decimal('Volume bombeado inválido.').nullable().optional(),
  devolvido: decimal('Volume devolvido inválido.').optional().default(0),
  slump: decimal('Slump inválido.').refine((n) => n >= 0 && n <= 30, 'Slump entre 0 e 30 cm.').nullable().optional(),
  documento: texto(60),
  observacoes: texto(1000),
  vendaId: idOpcional,
  cargaFinal: z.boolean().optional().default(false),
});

export function insumoPublico(r: Record<string, any>) {
  return {
    id: r.id,
    nome: r.nome,
    tipo: r.tipo,
    unidade: r.unidade,
    custoUnitario: r.custo_unitario_centavos === null ? null : Number((Number(r.custo_unitario_centavos) / 100).toFixed(6)),
    estoqueMinimo: num(r.estoque_minimo),
    ativo: r.ativo,
    controlaEstoque: r.controla_estoque ?? true,
    custoOrigem: r.custo_origem ?? null,
    custoAtualizadoEm: r.custo_atualizado_em ?? null,
    usadoEmTracos: Number(r.tracos ?? 0),
  };
}

async function carregarTraco(c: Cliente, empresaId: string, id: string) {
  if (!UUID.test(id)) throw naoEncontrado('Traço');
  const t = (await c.query('SELECT * FROM tracos WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL', [id, empresaId])).rows[0];
  if (!t) throw naoEncontrado('Traço');
  const itens = (
    await c.query(
      `SELECT ti.insumo_id, ti.quantidade, i.nome, i.tipo, i.unidade, i.custo_unitario_centavos
         FROM tracos_itens ti JOIN insumos i ON i.id = ti.insumo_id WHERE ti.traco_id = $1
        ORDER BY array_position(ARRAY['cimento','areia','brita','agua','aditivo','fibra','outro'], i.tipo), i.nome`,
      [id],
    )
  ).rows;
  return tracoPublico(t, itens);
}

function tracoPublico(t: Record<string, any>, itens: Record<string, any>[]) {
  let semCusto = false;
  const lista = itens.map((i) => {
    const custo = i.custo_unitario_centavos === null ? null : Number(i.custo_unitario_centavos) * Number(i.quantidade);
    if (custo === null) semCusto = true;
    return { insumoId: i.insumo_id, nome: i.nome, tipo: i.tipo, unidade: i.unidade, quantidade: Number(i.quantidade), custo: custo === null ? null : Math.round(custo) / 100 };
  });
  const cimento = lista.filter((i) => i.tipo === 'cimento').reduce((s, i) => s + (i.unidade === 't' ? i.quantidade * 1000 : i.quantidade), 0);
  return {
    id: t.id,
    codigo: t.codigo,
    descricao: t.descricao,
    fck: t.fck,
    slump: t.slump,
    brita: t.brita,
    observacoes: t.observacoes,
    ativo: t.ativo,
    itens: lista,
    cimentoKgM3: Math.round(cimento),
    custoM3: lista.length ? Math.round(lista.reduce((s, i) => s + (i.custo ?? 0), 0) * 100) / 100 : null,
    custoIncompleto: semCusto,
  };
}

function cargaPublica(r: Record<string, any>) {
  return {
    id: r.id,
    numero: r.numero,
    dataHora: r.data_hora instanceof Date ? r.data_hora.toISOString() : r.data_hora,
    dia: r.dia,
    tracoId: r.traco_id,
    tracoCodigo: r.traco_codigo,
    volume: Number(r.volume_m3),
    clienteId: r.cliente_id,
    clienteNome: r.cliente_nome,
    obra: r.obra,
    betoneiraId: r.betoneira_id,
    betoneiraCodigo: r.betoneira_codigo,
    motoristaId: r.motorista_id,
    motoristaNome: r.motorista_nome,
    bombaId: r.bomba_id,
    bombaCodigo: r.bomba_codigo,
    operadorBombaId: r.operador_bomba_id,
    operadorBombaNome: r.operador_nome,
    volumeBombeado: num(r.volume_bombeado_m3),
    devolvido: Number(r.devolvido_m3),
    slump: r.slump_cm === null || r.slump_cm === undefined ? null : Number(r.slump_cm),
    documento: r.documento,
    observacoes: r.observacoes,
    status: r.status,
    motivoCancelamento: r.motivo_cancelamento,
    registradoPor: r.registrado_por,
    vendaId: r.venda_id ?? null,
    vendaNumero: r.venda_numero ?? null,
    cargaFinal: !!r.carga_final,
    amostraStatus: r.amostra_status ?? null,
    saidaEm: r.saida_em ?? null,
    chegadaEm: r.chegada_em ?? null,
    descargaEm: r.descarga_em ?? null,
    slumpEntrega: num(r.slump_entrega_cm),
    obsMotorista: r.obs_motorista ?? null,
  };
}

const SELECT_CARGA = `
  SELECT c.*, ${DIA_LOCAL('c.data_hora')} AS dia, t.codigo AS traco_codigo, coalesce(cl.nome_fantasia, cl.razao_social) AS cliente_nome,
         b.codigo AS betoneira_codigo, m.nome AS motorista_nome, bo.codigo AS bomba_codigo, o.nome AS operador_nome, u.nome AS registrado_por, am.slump_cm, am.status AS amostra_status, vd.numero AS venda_numero
    FROM cargas c JOIN tracos t ON t.id = c.traco_id JOIN veiculos b ON b.id = c.betoneira_id
    LEFT JOIN clientes cl ON cl.id = c.cliente_id LEFT JOIN motoristas m ON m.id = c.motorista_id
    LEFT JOIN veiculos bo ON bo.id = c.bomba_id LEFT JOIN motoristas o ON o.id = c.operador_bomba_id
    LEFT JOIN usuarios u ON u.id = c.registrado_por_id LEFT JOIN amostras am ON am.carga_id = c.id LEFT JOIN vendas vd ON vd.id = c.venda_id`;

/** Confere se os cadastros escolhidos na carga são desta empresa e do tipo certo. */
async function validarCarga(c: Cliente, empresaId: string, d: z.infer<typeof esquemaCarga>) {
  const t = (await c.query('SELECT ativo FROM tracos WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL', [d.tracoId, empresaId])).rows[0];
  if (!t) throw new ErroHttp(400, 'Traço não encontrado.');
  const b = (await c.query('SELECT tipo FROM veiculos WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL', [d.betoneiraId, empresaId])).rows[0];
  if (!b || b.tipo !== 'betoneira') throw new ErroHttp(400, 'Escolha uma betoneira da frota.');
  if (d.bombaId) {
    const x = (await c.query('SELECT tipo FROM veiculos WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL', [d.bombaId, empresaId])).rows[0];
    if (!x || !String(x.tipo).startsWith('bomba')) throw new ErroHttp(400, 'Escolha uma bomba da frota.');
  }
  for (const [id, nome] of [[d.motoristaId, 'Motorista'], [d.operadorBombaId, 'Operador da bomba']] as const) {
    if (id && !(await c.query('SELECT 1 FROM motoristas WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL', [id, empresaId])).rowCount) {
      throw new ErroHttp(400, `${nome} não encontrado.`);
    }
  }
  if (d.clienteId && !(await c.query('SELECT 1 FROM clientes WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL', [d.clienteId, empresaId])).rowCount) {
    throw new ErroHttp(400, 'Cliente não encontrado.');
  }
  if (d.vendaId) {
    const v = (await c.query('SELECT status, lancamento_id, entrega_finalizada_em FROM vendas WHERE id = $1 AND empresa_id = $2', [d.vendaId, empresaId])).rows[0];
    if (!v) throw new ErroHttp(400, 'Venda da programação não encontrada.');
    if (!['aprovada', 'concluida'].includes(v.status)) throw new ErroHttp(400, 'A venda escolhida não está aprovada.');
    if (v.lancamento_id || v.entrega_finalizada_em) throw new ErroHttp(400, 'A entrega desta venda já foi finalizada e faturada.');
  }
  if ((d.devolvido ?? 0) > d.volume) throw new ErroHttp(400, 'O volume devolvido não pode passar o volume da carga.');
  if (d.volumeBombeado && d.volumeBombeado > d.volume) throw new ErroHttp(400, 'O volume bombeado não pode passar o volume da carga.');
  if (d.volumeBombeado && !d.bombaId) throw new ErroHttp(400, 'Escolha a bomba usada no bombeamento.');
}

function dataHoraDaCarga(v: string | undefined): string {
  if (!v) return new Date().toISOString();
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v : `${v}-03:00`);
  if (Number.isNaN(d.getTime())) throw new ErroHttp(400, 'Data e hora inválidas.');
  if (d.getTime() > Date.now() + 6 * 3600_000) throw new ErroHttp(400, 'A data da carga não pode ser no futuro.');
  return d.toISOString();
}

/** Período por dias (de/ate em AAAA-MM-DD); o padrão é o mês atual até hoje. */
function periodoDias(q: Record<string, string | undefined>) {
  const hoje = hojeBrasil();
  const de = q.de && DATA.test(q.de) ? q.de : `${hoje.slice(0, 7)}-01`;
  const ate = q.ate && DATA.test(q.ate) ? q.ate : hoje;
  if (ate < de) throw new ErroHttp(400, 'A data final é antes da inicial.');
  if (Date.parse(ate) - Date.parse(de) > 400 * 86_400_000) throw new ErroHttp(400, 'Escolha um período de até 13 meses.');
  return { de, ate, hoje };
}

/**
 * Vendas aprovadas para entregar: as do período e as atrasadas que ainda têm saldo.
 * `abertas` = só as que ainda têm saldo (para escolher na carga).
 */
async function programacao(c: Cliente, empresaId: string, de: string | null, ate: string | null, abertas: boolean) {
  const r = await c.query(
    `SELECT v.*, coalesce(cl.nome_fantasia, cl.razao_social) AS cliente_nome, cl.telefone AS cliente_telefone, t.codigo AS traco_codigo, t.descricao AS traco_descricao,
            uv.nome AS vendedor_nome, ua.nome AS aprovado_por,
            coalesce((SELECT sum(x.volume_m3) FROM cargas x WHERE x.venda_id = v.id AND x.status = 'produzida'), 0) AS entregue_m3,
            coalesce((SELECT sum(x.devolvido_m3) FROM cargas x WHERE x.venda_id = v.id AND x.status = 'produzida'), 0) AS devolvido_m3,
            (SELECT count(*) FROM cargas x WHERE x.venda_id = v.id AND x.status = 'produzida') AS cargas
       FROM vendas v JOIN clientes cl ON cl.id = v.cliente_id JOIN tracos t ON t.id = v.traco_id
       JOIN usuarios uv ON uv.id = v.vendedor_id LEFT JOIN usuarios ua ON ua.id = v.aprovado_por_id
      WHERE v.empresa_id = $1 AND v.status IN ('aprovada', 'concluida')
        AND (CASE WHEN $4 THEN v.status = 'aprovada' AND v.data_entrega <= (now() AT TIME ZONE 'America/Sao_Paulo')::date + 7
                  ELSE v.data_entrega BETWEEN $2::date AND $3::date OR (v.status = 'aprovada' AND v.data_entrega < $2::date) END)
      ORDER BY v.data_entrega, v.hora_entrega NULLS LAST, v.numero
      LIMIT 300`,
    [empresaId, de, ate, abertas],
  );
  return r.rows.map(vendaPublica);
}

/** Produção (m³ e valor) de cada pessoa no período, carga a carga. */
async function linhasProducao(c: Cliente, empresaId: string, de: string, ate: string, pessoaId: string | null) {
  return (
    await c.query(
      `WITH c AS (
         SELECT c.*, ${DIA_LOCAL('c.data_hora')} AS dia FROM cargas c
          WHERE c.empresa_id = $1 AND c.status = 'produzida' AND ${DIA_LOCAL('c.data_hora')} BETWEEN $2 AND $3
       ), p AS (
         SELECT c.id, c.numero, c.dia, c.data_hora, c.traco_id, c.cliente_id, c.obra, c.betoneira_id AS veiculo_id, c.motorista_id AS pessoa_id,
                'entrega' AS papel, c.volume_m3 - c.devolvido_m3 AS m3,
                (SELECT v.valor_m3_centavos FROM valores_producao v WHERE v.empresa_id = c.empresa_id AND v.funcao = 'motorista' AND v.vigencia <= c.dia
                  ORDER BY v.vigencia DESC LIMIT 1) AS valor_m3
           FROM c WHERE c.motorista_id IS NOT NULL
         UNION ALL
         SELECT c.id, c.numero, c.dia, c.data_hora, c.traco_id, c.cliente_id, c.obra, c.bomba_id, c.operador_bomba_id,
                'bombeamento', c.volume_bombeado_m3,
                (SELECT v.valor_m3_centavos FROM valores_producao v WHERE v.empresa_id = c.empresa_id AND v.funcao = 'operador_bomba' AND v.vigencia <= c.dia
                  ORDER BY v.vigencia DESC LIMIT 1)
           FROM c WHERE c.operador_bomba_id IS NOT NULL AND coalesce(c.volume_bombeado_m3, 0) > 0
       )
       SELECT p.*, round(p.m3 * coalesce(p.valor_m3, 0)) AS valor, t.codigo AS traco_codigo, coalesce(cl.nome_fantasia, cl.razao_social) AS cliente_nome,
              ve.codigo AS veiculo_codigo, m.nome AS pessoa_nome, m.funcao
         FROM p JOIN motoristas m ON m.id = p.pessoa_id JOIN tracos t ON t.id = p.traco_id
         LEFT JOIN clientes cl ON cl.id = p.cliente_id LEFT JOIN veiculos ve ON ve.id = p.veiculo_id
        WHERE ($4::uuid IS NULL OR p.pessoa_id = $4)
        ORDER BY p.data_hora, p.numero`,
      [empresaId, de, ate, pessoaId],
    )
  ).rows.map((r) => ({
    cargaId: r.id,
    numero: r.numero,
    dia: r.dia,
    dataHora: r.data_hora instanceof Date ? r.data_hora.toISOString() : r.data_hora,
    pessoaId: r.pessoa_id,
    pessoaNome: r.pessoa_nome,
    funcao: r.funcao,
    papel: r.papel as 'entrega' | 'bombeamento',
    tracoCodigo: r.traco_codigo,
    clienteNome: r.cliente_nome,
    obra: r.obra,
    veiculoCodigo: r.veiculo_codigo,
    m3: Number(r.m3),
    valorM3: reais(r.valor_m3),
    valor: reais(r.valor) ?? 0,
  }));
}

type LinhaProducao = Awaited<ReturnType<typeof linhasProducao>>[number];

function resumirProducao(linhas: LinhaProducao[]) {
  const mapa = new Map<string, { pessoaId: string; nome: string; funcao: string; entregas: number; m3Entregue: number; valorEntregas: number; bombeamentos: number; m3Bombeado: number; valorBombeamento: number; dias: Set<string> }>();
  for (const l of linhas) {
    const p = mapa.get(l.pessoaId) ?? { pessoaId: l.pessoaId, nome: l.pessoaNome, funcao: l.funcao, entregas: 0, m3Entregue: 0, valorEntregas: 0, bombeamentos: 0, m3Bombeado: 0, valorBombeamento: 0, dias: new Set<string>() };
    if (l.papel === 'entrega') {
      p.entregas++;
      p.m3Entregue += l.m3;
      p.valorEntregas += l.valor;
    } else {
      p.bombeamentos++;
      p.m3Bombeado += l.m3;
      p.valorBombeamento += l.valor;
    }
    p.dias.add(l.dia);
    mapa.set(l.pessoaId, p);
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return [...mapa.values()]
    .map(({ dias, ...p }) => ({
      ...p,
      m3Entregue: r2(p.m3Entregue),
      m3Bombeado: r2(p.m3Bombeado),
      valorEntregas: r2(p.valorEntregas),
      valorBombeamento: r2(p.valorBombeamento),
      total: r2(p.valorEntregas + p.valorBombeamento),
      diasTrabalhados: dias.size,
    }))
    .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'));
}

async function valoresVigentes(c: Cliente, empresaId: string, data: string) {
  const r = (
    await c.query(
      `SELECT DISTINCT ON (funcao) funcao, valor_m3_centavos, vigencia FROM valores_producao
        WHERE empresa_id = $1 AND vigencia <= $2 ORDER BY funcao, vigencia DESC`,
      [empresaId, data],
    )
  ).rows;
  const de = (f: string) => {
    const x = r.find((v) => v.funcao === f);
    return x ? { valorM3: reais(x.valor_m3_centavos), vigencia: x.vigencia } : null;
  };
  return { motorista: de('motorista'), operadorBomba: de('operador_bomba') };
}

async function motoristaDoUsuario(c: Cliente, req: FastifyRequest) {
  const r = (await c.query('SELECT motorista_id FROM usuarios WHERE id = $1', [req.usuario!.id])).rows[0];
  if (!r?.motorista_id) throw new ErroHttp(400, 'Seu acesso ainda não está ligado ao seu cadastro de motorista. Peça ao gestor para fazer a ligação em Frota › Motoristas.');
  return r.motorista_id as string;
}

export function rotasProducao(banco: Banco) {
  return async function (app: FastifyInstance) {
    const gestao = exigir(banco, 'dono', 'gestor');
    const usina = exigir(banco, 'dono', 'gestor', 'operador_usina');
    const consultaTracos = exigir(banco, 'dono', 'gestor', 'operador_usina', 'laboratorista');
    const motorista = exigir(banco, 'motorista');

    // ======================= Insumos =======================
    app.get('/insumos', { preHandler: consultaTracos }, async (req) => {
      const r = await banco.query(
        `SELECT i.*, (SELECT count(*) FROM tracos_itens ti JOIN tracos t ON t.id = ti.traco_id WHERE ti.insumo_id = i.id AND t.excluido_em IS NULL) AS tracos
           FROM insumos i WHERE i.empresa_id = $1 AND i.excluido_em IS NULL
          ORDER BY i.ativo DESC, array_position(ARRAY['cimento','areia','brita','agua','aditivo','fibra','outro'], i.tipo), i.nome`,
        [empresaDo(req)],
      );
      return { insumos: r.rows.map(insumoPublico) };
    });

    app.post('/insumos', { preHandler: gestao }, async (req, reply) => {
      const d = esquemaInsumo.parse(req.body);
      const empresaId = empresaDo(req);
      const r = await emTransacao(banco, async (c) => {
        if ((await c.query('SELECT 1 FROM insumos WHERE empresa_id = $1 AND lower(nome) = lower($2) AND excluido_em IS NULL', [empresaId, d.nome])).rowCount) {
          throw new ErroHttp(409, 'Já existe um insumo com esse nome.');
        }
        const x = (
          await c.query(
            `INSERT INTO insumos (empresa_id, nome, tipo, unidade, custo_unitario_centavos, estoque_minimo, ativo, controla_estoque, custo_origem)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'cadastro') RETURNING *`,
            [empresaId, d.nome, d.tipo, d.unidade, d.custoUnitario === null || d.custoUnitario === undefined ? null : d.custoUnitario * 100, d.estoqueMinimo ?? null, d.ativo, d.controlaEstoque],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'insumos', entidadeId: x.id, depois: d });
        return x;
      });
      return reply.code(201).send({ insumo: insumoPublico(r) });
    });

    app.patch<{ Params: { id: string } }>('/insumos/:id', { preHandler: gestao }, async (req) => {
      const d = esquemaInsumo.partial().strict().parse(req.body);
      const empresaId = empresaDo(req);
      if (!UUID.test(req.params.id)) throw naoEncontrado('Insumo');
      const r = await emTransacao(banco, async (c) => {
        const antes = (await c.query('SELECT * FROM insumos WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL', [req.params.id, empresaId])).rows[0];
        if (!antes) throw naoEncontrado('Insumo');
        if (d.nome && (await c.query('SELECT 1 FROM insumos WHERE empresa_id = $1 AND lower(nome) = lower($2) AND id <> $3 AND excluido_em IS NULL', [empresaId, d.nome, antes.id])).rowCount) {
          throw new ErroHttp(409, 'Já existe um insumo com esse nome.');
        }
        const x = (
          await c.query(
            `UPDATE insumos SET nome = coalesce($3, nome), tipo = coalesce($4, tipo), unidade = coalesce($5, unidade),
                    custo_unitario_centavos = CASE WHEN $6 THEN $7 ELSE custo_unitario_centavos END,
                    custo_origem = CASE WHEN $6 THEN 'cadastro' ELSE custo_origem END, controla_estoque = coalesce($11, controla_estoque),
                    estoque_minimo = CASE WHEN $8 THEN $9 ELSE estoque_minimo END, ativo = coalesce($10, ativo), atualizado_em = now()
              WHERE id = $1 AND empresa_id = $2 RETURNING *`,
            [antes.id, empresaId, d.nome ?? null, d.tipo ?? null, d.unidade ?? null, 'custoUnitario' in d, d.custoUnitario === null || d.custoUnitario === undefined ? null : d.custoUnitario * 100,
              'estoqueMinimo' in d, d.estoqueMinimo ?? null, d.ativo ?? null, d.controlaEstoque ?? null],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'insumos', entidadeId: x.id, antes, depois: d });
        return x;
      });
      return { insumo: insumoPublico(r) };
    });

    // ======================= Traços =======================
    app.get<{ Querystring: { todos?: string } }>('/tracos', { preHandler: consultaTracos }, async (req) => {
      const empresaId = empresaDo(req);
      const tracos = (
        await banco.query(`SELECT * FROM tracos WHERE empresa_id = $1 AND excluido_em IS NULL ${req.query.todos === '1' ? '' : 'AND ativo'} ORDER BY ativo DESC, fck NULLS LAST, codigo`, [empresaId])
      ).rows;
      const itens = (
        await banco.query(
          `SELECT ti.traco_id, ti.insumo_id, ti.quantidade, i.nome, i.tipo, i.unidade, i.custo_unitario_centavos
             FROM tracos_itens ti JOIN insumos i ON i.id = ti.insumo_id WHERE ti.empresa_id = $1
            ORDER BY array_position(ARRAY['cimento','areia','brita','agua','aditivo','fibra','outro'], i.tipo), i.nome`,
          [empresaId],
        )
      ).rows;
      return { tracos: tracos.map((t) => tracoPublico(t, itens.filter((i) => i.traco_id === t.id))) };
    });

    app.get<{ Params: { id: string } }>('/tracos/:id', { preHandler: consultaTracos }, async (req) => ({ traco: await carregarTraco(banco, empresaDo(req), req.params.id) }));

    async function gravarItens(c: Cliente, empresaId: string, tracoId: string, itens: { insumoId: string; quantidade: number }[]) {
      const ids = [...new Set(itens.map((i) => i.insumoId))];
      if (ids.length !== itens.length) throw new ErroHttp(400, 'Cada insumo aparece uma vez só no traço.');
      if (ids.length) {
        const n = (await c.query('SELECT count(*)::int AS n FROM insumos WHERE empresa_id = $1 AND id = ANY($2::uuid[]) AND excluido_em IS NULL', [empresaId, ids])).rows[0].n;
        if (n !== ids.length) throw new ErroHttp(400, 'Insumo não encontrado.');
      }
      await c.query('DELETE FROM tracos_itens WHERE traco_id = $1', [tracoId]);
      for (const i of itens) {
        await c.query('INSERT INTO tracos_itens (empresa_id, traco_id, insumo_id, quantidade) VALUES ($1,$2,$3,$4)', [empresaId, tracoId, i.insumoId, i.quantidade]);
      }
    }

    app.post('/tracos', { preHandler: gestao }, async (req, reply) => {
      const d = esquemaTraco.parse(req.body);
      const empresaId = empresaDo(req);
      const id = await emTransacao(banco, async (c) => {
        if ((await c.query('SELECT 1 FROM tracos WHERE empresa_id = $1 AND upper(codigo) = upper($2) AND excluido_em IS NULL', [empresaId, d.codigo])).rowCount) {
          throw new ErroHttp(409, 'Já existe um traço com esse código.');
        }
        const t = (
          await c.query(
            `INSERT INTO tracos (empresa_id, codigo, descricao, fck, slump, brita, observacoes, ativo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [empresaId, d.codigo, d.descricao, d.fck ?? null, d.slump, d.brita, d.observacoes, d.ativo],
          )
        ).rows[0];
        await gravarItens(c, empresaId, t.id, d.itens ?? []);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'tracos', entidadeId: t.id, depois: d });
        return t.id as string;
      });
      return reply.code(201).send({ traco: await carregarTraco(banco, empresaId, id) });
    });

    app.patch<{ Params: { id: string } }>('/tracos/:id', { preHandler: gestao }, async (req) => {
      const d = esquemaTraco.partial().strict().parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const antes = await carregarTraco(c, empresaId, req.params.id);
        if (d.codigo && (await c.query('SELECT 1 FROM tracos WHERE empresa_id = $1 AND upper(codigo) = upper($2) AND id <> $3 AND excluido_em IS NULL', [empresaId, d.codigo, antes.id])).rowCount) {
          throw new ErroHttp(409, 'Já existe um traço com esse código.');
        }
        await c.query(
          `UPDATE tracos SET codigo = coalesce($3, codigo), descricao = CASE WHEN $4 THEN $5 ELSE descricao END, fck = CASE WHEN $6 THEN $7::int ELSE fck END,
                  slump = CASE WHEN $8 THEN $9 ELSE slump END, brita = CASE WHEN $10 THEN $11 ELSE brita END,
                  observacoes = CASE WHEN $12 THEN $13 ELSE observacoes END, ativo = coalesce($14, ativo), atualizado_em = now()
            WHERE id = $1 AND empresa_id = $2`,
          [antes.id, empresaId, d.codigo ?? null, 'descricao' in d, d.descricao ?? null, 'fck' in d, d.fck ?? null, 'slump' in d, d.slump ?? null,
            'brita' in d, d.brita ?? null, 'observacoes' in d, d.observacoes ?? null, d.ativo ?? null],
        );
        if (d.itens) await gravarItens(c, empresaId, antes.id, d.itens);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'tracos', entidadeId: antes.id, antes, depois: d });
      });
      return { traco: await carregarTraco(banco, empresaId, req.params.id) };
    });

    // ======================= Cargas =======================
    app.get('/cargas/opcoes', { preHandler: usina }, async (req) => {
      const empresaId = empresaDo(req);
      const hoje = hojeBrasil();
      const [tracos, veiculos, pessoas, clientes, escala, ultimas] = await Promise.all([
        banco.query('SELECT id, codigo, descricao, fck, slump FROM tracos WHERE empresa_id = $1 AND excluido_em IS NULL AND ativo ORDER BY fck NULLS LAST, codigo', [empresaId]),
        banco.query(
          `SELECT id, codigo, tipo, placa, capacidade_m3, status FROM veiculos
            WHERE empresa_id = $1 AND excluido_em IS NULL AND status <> 'inativo' AND (tipo = 'betoneira' OR tipo::text LIKE 'bomba%') ORDER BY codigo`,
          [empresaId],
        ),
        banco.query(
          `SELECT id, nome, funcao FROM motoristas WHERE empresa_id = $1 AND excluido_em IS NULL AND ativo
              AND funcao IN ('motorista', 'operador_bomba', 'motorista_operador') ORDER BY nome`,
          [empresaId],
        ),
        banco.query('SELECT id, coalesce(nome_fantasia, razao_social) AS nome FROM clientes WHERE empresa_id = $1 AND excluido_em IS NULL AND ativo ORDER BY 2', [empresaId]),
        banco.query('SELECT motorista_id, entrada, folga FROM escalas WHERE empresa_id = $1 AND data = $2', [empresaId, hoje]),
        // Última combinação do dia: betoneira → motorista e bomba → operador.
        banco.query(
          `(SELECT DISTINCT ON (betoneira_id) betoneira_id AS veiculo_id, motorista_id AS pessoa_id FROM cargas
             WHERE empresa_id = $1 AND status = 'produzida' AND motorista_id IS NOT NULL AND data_hora > now() - interval '7 days' ORDER BY betoneira_id, data_hora DESC)
           UNION ALL
           (SELECT DISTINCT ON (bomba_id) bomba_id, operador_bomba_id FROM cargas
             WHERE empresa_id = $1 AND status = 'produzida' AND bomba_id IS NOT NULL AND operador_bomba_id IS NOT NULL AND data_hora > now() - interval '7 days'
             ORDER BY bomba_id, data_hora DESC)`,
          [empresaId],
        ),
      ]);
      return {
        tracos: tracos.rows.map((t) => ({ id: t.id, codigo: t.codigo, descricao: t.descricao, fck: t.fck, slump: t.slump })),
        betoneiras: veiculos.rows.filter((v) => v.tipo === 'betoneira').map((v) => ({ id: v.id, codigo: v.codigo, placa: v.placa, capacidade: num(v.capacidade_m3), status: v.status })),
        bombas: veiculos.rows.filter((v) => v.tipo !== 'betoneira').map((v) => ({ id: v.id, codigo: v.codigo, placa: v.placa, status: v.status })),
        pessoas: pessoas.rows.map((p) => {
          const e = escala.rows.find((x) => x.motorista_id === p.id);
          return { id: p.id, nome: p.nome, funcao: p.funcao, escala: e ? (e.folga ? 'folga' : String(e.entrada).slice(0, 5)) : null };
        }),
        clientes: clientes.rows,
        programacao: (await programacao(banco, empresaId, null, null, true)).map((v) => ({
          id: v.id, numero: v.numero, clienteId: v.clienteId, clienteNome: v.clienteNome, obra: v.obra, endereco: v.endereco, tracoId: v.tracoId, tracoCodigo: v.tracoCodigo,
          volume: v.volume, entregue: v.entregue, saldo: v.saldo, dataEntrega: v.dataEntrega, horaEntrega: v.horaEntrega, bombeamento: v.bombeamento,
        })),
        // Última pessoa de cada veículo nos últimos dias (betoneira → motorista, bomba → operador), para sugerir no formulário.
        motoristaDaBetoneira: Object.fromEntries(ultimas.rows.map((x) => [x.veiculo_id, x.pessoa_id])),
      };
    });

    app.get<{ Querystring: Record<string, string | undefined> }>('/cargas', { preHandler: usina }, async (req) => {
      const empresaId = empresaDo(req);
      const hoje = hojeBrasil();
      const de = req.query.de && DATA.test(req.query.de) ? req.query.de : hoje;
      const ate = req.query.ate && DATA.test(req.query.ate) ? req.query.ate : de;
      if (ate < de) throw new ErroHttp(400, 'A data final é antes da inicial.');
      const filtros: string[] = [];
      const p: unknown[] = [empresaId, de, ate];
      for (const [k, col] of [['motoristaId', 'c.motorista_id'], ['betoneiraId', 'c.betoneira_id'], ['tracoId', 'c.traco_id'], ['clienteId', 'c.cliente_id']] as const) {
        const v = req.query[k];
        if (v && UUID.test(v)) {
          p.push(v);
          filtros.push(`${col} = $${p.length}`);
        }
      }
      const r = await banco.query(
        `${SELECT_CARGA} WHERE c.empresa_id = $1 AND ${DIA_LOCAL('c.data_hora')} BETWEEN $2 AND $3 ${filtros.map((f) => `AND ${f}`).join(' ')}
          ORDER BY c.data_hora DESC, c.numero DESC LIMIT 2000`,
        p,
      );
      const cargas = r.rows.map(cargaPublica);
      const validas = cargas.filter((c) => c.status === 'produzida');
      const soma = (f: (c: (typeof cargas)[number]) => number) => Math.round(validas.reduce((s, c) => s + f(c), 0) * 100) / 100;
      return {
        de,
        ate,
        cargas,
        resumo: {
          cargas: validas.length,
          canceladas: cargas.length - validas.length,
          m3: soma((c) => c.volume),
          devolvido: soma((c) => c.devolvido),
          bombeado: soma((c) => c.volumeBombeado ?? 0),
        },
      };
    });

    app.post('/cargas', { preHandler: usina }, async (req, reply) => {
      const d = esquemaCarga.parse(req.body);
      const empresaId = empresaDo(req);
      const dataHora = dataHoraDaCarga(d.dataHora);
      const id = await emTransacao(banco, async (c) => {
        await validarCarga(c, empresaId, d);
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`cargas:${empresaId}`]);
        const numero = (await c.query('SELECT coalesce(max(numero), 0) + 1 AS n FROM cargas WHERE empresa_id = $1', [empresaId])).rows[0].n;
        const x = (
          await c.query(
            `INSERT INTO cargas (empresa_id, numero, data_hora, traco_id, volume_m3, cliente_id, obra, betoneira_id, motorista_id, bomba_id, operador_bomba_id,
                                 volume_bombeado_m3, devolvido_m3, documento, observacoes, registrado_por_id, venda_id, carga_final)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
            [empresaId, numero, dataHora, d.tracoId, d.volume, d.clienteId, d.obra, d.betoneiraId, d.motoristaId, d.bombaId, d.bombaId ? d.operadorBombaId : null,
              d.bombaId ? (d.volumeBombeado ?? null) : null, d.devolvido ?? 0, d.documento, d.observacoes, req.usuario!.id, d.vendaId, !!d.vendaId && d.cargaFinal],
          )
        ).rows[0];
        await gravarConsumoCarga(c, x.id);
        await atualizarSituacaoVenda(c, d.vendaId);
        await criarAmostraCarga(c, empresaId, x.id, dataHora, d.slump ?? null);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'cargas', entidadeId: x.id, depois: { ...d, numero } });
        return x.id as string;
      });
      const r = await banco.query(`${SELECT_CARGA} WHERE c.id = $1`, [id]);
      return reply.code(201).send({ carga: cargaPublica(r.rows[0]) });
    });

    /** Operador de usina só mexe nas cargas do dia; dono e gestor em qualquer uma. */
    async function cargaEditavel(c: Cliente, req: FastifyRequest, id: string) {
      if (!UUID.test(id)) throw naoEncontrado('Carga');
      const r = (await c.query(`${SELECT_CARGA} WHERE c.id = $1 AND c.empresa_id = $2`, [id, empresaDo(req)])).rows[0];
      if (!r) throw naoEncontrado('Carga');
      if (req.usuario!.perfil === 'operador_usina' && String(r.dia) !== hojeBrasil()) {
        throw new ErroHttp(403, 'Cargas de outros dias só o gestor pode alterar.');
      }
      return r;
    }

    app.patch<{ Params: { id: string } }>('/cargas/:id', { preHandler: usina }, async (req) => {
      const parcial = esquemaCarga.partial().strict().parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const antes = await cargaEditavel(c, req, req.params.id);
        if (antes.status === 'cancelada') throw new ErroHttp(400, 'Carga cancelada não pode ser alterada.');
        const atual = {
          tracoId: antes.traco_id, volume: Number(antes.volume_m3), clienteId: antes.cliente_id, obra: antes.obra, betoneiraId: antes.betoneira_id,
          motoristaId: antes.motorista_id, bombaId: antes.bomba_id, operadorBombaId: antes.operador_bomba_id, volumeBombeado: num(antes.volume_bombeado_m3),
          devolvido: Number(antes.devolvido_m3), documento: antes.documento, observacoes: antes.observacoes, vendaId: antes.venda_id, cargaFinal: antes.carga_final,
        };
        const d = { ...atual, ...parcial } as z.infer<typeof esquemaCarga>;
        await validarCarga(c, empresaId, d);
        const dataHora = parcial.dataHora ? dataHoraDaCarga(parcial.dataHora) : null;
        await c.query(
          `UPDATE cargas SET data_hora = coalesce($3, data_hora), traco_id = $4, volume_m3 = $5, cliente_id = $6, obra = $7, betoneira_id = $8, motorista_id = $9,
                  bomba_id = $10, operador_bomba_id = $11, volume_bombeado_m3 = $12, devolvido_m3 = $13, documento = $14, observacoes = $15, venda_id = $16, carga_final = $17, atualizado_em = now()
            WHERE id = $1 AND empresa_id = $2`,
          [antes.id, empresaId, dataHora, d.tracoId, d.volume, d.clienteId, d.obra, d.betoneiraId, d.motoristaId, d.bombaId, d.bombaId ? d.operadorBombaId : null,
            d.bombaId ? (d.volumeBombeado ?? null) : null, d.devolvido ?? 0, d.documento, d.observacoes, d.vendaId ?? null, !!d.vendaId && !!d.cargaFinal],
        );
        await atualizarSituacaoVenda(c, antes.venda_id);
        if (d.vendaId !== antes.venda_id) await atualizarSituacaoVenda(c, d.vendaId);
        if (parcial.tracoId !== undefined || parcial.volume !== undefined) await gravarConsumoCarga(c, antes.id);
        if (dataHora) await reprogramarAmostra(c, antes.id, dataHora);
        if (parcial.slump !== undefined) await c.query('UPDATE amostras SET slump_cm = $2, atualizado_em = now() WHERE carga_id = $1', [antes.id, parcial.slump]);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'cargas', entidadeId: antes.id, antes: cargaPublica(antes), depois: parcial });
      });
      const r = await banco.query(`${SELECT_CARGA} WHERE c.id = $1`, [req.params.id]);
      return { carga: cargaPublica(r.rows[0]) };
    });

    app.post<{ Params: { id: string } }>('/cargas/:id/cancelar', { preHandler: usina }, async (req) => {
      const { motivo } = z.object({ motivo: z.string({ required_error: 'Informe o motivo.' }).trim().min(3, 'Informe o motivo do cancelamento.').max(300) }).parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const antes = await cargaEditavel(c, req, req.params.id);
        if (antes.status === 'cancelada') throw new ErroHttp(400, 'A carga já está cancelada.');
        await c.query(`UPDATE cargas SET status = 'cancelada', motivo_cancelamento = $3, atualizado_em = now() WHERE id = $1 AND empresa_id = $2`, [antes.id, empresaId, motivo]);
        await gravarConsumoCarga(c, antes.id);
        await cancelarAmostraCarga(c, antes.id);
        await atualizarSituacaoVenda(c, antes.venda_id);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'cargas', entidadeId: antes.id, antes: { status: antes.status }, depois: { status: 'cancelada', motivo } });
      });
      const r = await banco.query(`${SELECT_CARGA} WHERE c.id = $1`, [req.params.id]);
      return { carga: cargaPublica(r.rows[0]) };
    });

    // ======================= Romaneios e etiquetas =======================
    const impressao = exigir(banco, 'dono', 'gestor', 'operador_usina', 'laboratorista');
    function idsDe(q: string | undefined): string[] {
      const ids = (q ?? '').split(',').map((x) => x.trim()).filter((x) => UUID.test(x));
      if (!ids.length) throw new ErroHttp(400, 'Escolha ao menos uma carga.');
      if (ids.length > 200) throw new ErroHttp(400, 'Escolha até 200 cargas por vez.');
      return [...new Set(ids)];
    }

    /** Dados do documento de entrega (NBR 7212) de cada carga: concreto, transporte, composição e água na central. */
    app.get<{ Querystring: { ids?: string } }>('/romaneios', { preHandler: usina }, async (req) => {
      const empresaId = empresaDo(req);
      const ids = idsDe(req.query.ids);
      const r = await banco.query(
        `SELECT c.*, t.codigo AS traco_codigo, t.descricao AS traco_descricao, t.fck, t.slump AS traco_slump, t.brita AS traco_brita,
                coalesce(cl.nome_fantasia, cl.razao_social) AS cliente_nome, cl.razao_social AS cliente_razao, cl.cnpj_cpf AS cliente_doc, cl.telefone AS cliente_telefone,
                b.codigo AS betoneira_codigo, b.placa AS betoneira_placa, m.nome AS motorista_nome, bo.codigo AS bomba_codigo, o.nome AS operador_nome, u.nome AS registrado_por,
                v.numero AS venda_numero, v.endereco, v.contato, v.observacoes AS obs_venda
           FROM cargas c JOIN tracos t ON t.id = c.traco_id JOIN veiculos b ON b.id = c.betoneira_id LEFT JOIN clientes cl ON cl.id = c.cliente_id
           LEFT JOIN motoristas m ON m.id = c.motorista_id LEFT JOIN veiculos bo ON bo.id = c.bomba_id LEFT JOIN motoristas o ON o.id = c.operador_bomba_id
           LEFT JOIN usuarios u ON u.id = c.registrado_por_id LEFT JOIN vendas v ON v.id = c.venda_id
          WHERE c.empresa_id = $1 AND c.id = ANY($2::uuid[]) ORDER BY c.data_hora, c.numero`,
        [empresaId, ids],
      );
      const comp = await banco.query(
        `SELECT cc.carga_id, i.nome, i.tipo, i.unidade, cc.quantidade FROM cargas_consumo cc JOIN insumos i ON i.id = cc.insumo_id
          WHERE cc.carga_id = ANY($1::uuid[])
          ORDER BY CASE i.tipo WHEN 'cimento' THEN 1 WHEN 'areia' THEN 2 WHEN 'brita' THEN 3 WHEN 'agua' THEN 4 WHEN 'aditivo' THEN 5 ELSE 6 END, i.nome`,
        [ids],
      );
      // Consumo pelo traço quando a carga foi cancelada (o consumo é zerado ao cancelar).
      const pelos = await banco.query(
        `SELECT c.id AS carga_id, i.nome, i.tipo, i.unidade, round(ti.quantidade * c.volume_m3, 3) AS quantidade
           FROM cargas c JOIN tracos_itens ti ON ti.traco_id = c.traco_id JOIN insumos i ON i.id = ti.insumo_id WHERE c.id = ANY($1::uuid[])`,
        [ids],
      );
      const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null));
      return {
        romaneios: r.rows.map((x) => {
          const itens = (comp.rows.some((k) => k.carga_id === x.id) ? comp.rows : pelos.rows)
            .filter((k) => k.carga_id === x.id)
            .map((k) => ({ nome: k.nome as string, tipo: k.tipo as string, unidade: k.unidade as string, quantidade: Number(k.quantidade) }));
          return {
            id: x.id, numero: x.numero, dataHora: iso(x.data_hora), status: x.status, motivoCancelamento: x.motivo_cancelamento, volume: Number(x.volume_m3),
            documento: x.documento, observacoes: [x.obs_venda, x.observacoes].filter(Boolean).join(' · ') || null,
            cliente: x.cliente_nome ? { nome: x.cliente_nome, razao: x.cliente_razao, documento: x.cliente_doc, telefone: x.cliente_telefone } : null,
            obra: x.obra, endereco: x.endereco, contato: x.contato, vendaNumero: x.venda_numero, cargaFinal: !!x.carga_final,
            traco: { codigo: x.traco_codigo, descricao: x.traco_descricao, fck: num(x.fck), slump: x.traco_slump, brita: x.traco_brita },
            betoneira: x.betoneira_codigo, placa: x.betoneira_placa, motorista: x.motorista_nome, bomba: x.bomba_codigo, operadorBomba: x.operador_nome,
            volumeBombeado: num(x.volume_bombeado_m3), registradoPor: x.registrado_por,
            composicao: itens,
            aguaCentral: Math.round(itens.filter((k) => k.tipo === 'agua').reduce((s, k) => s + k.quantidade, 0) * 10) / 10,
            aditivos: itens.filter((k) => k.tipo === 'aditivo').map((k) => k.nome),
          };
        }),
      };
    });

    /** Etiquetas dos corpos de prova das cargas (só amostras com a moldagem confirmada). */
    app.get<{ Querystring: { ids?: string } }>('/etiquetas', { preHandler: impressao }, async (req) => {
      const empresaId = empresaDo(req);
      const ids = idsDe(req.query.ids);
      const r = await banco.query(
        `SELECT c.id AS carga_id, c.numero AS carga_numero, cp.id, cp.idade_dias, cp.numero, cp.data_prevista, a.data_moldagem, a.status AS amostra_status,
                t.codigo AS traco_codigo, t.fck, coalesce(cl.nome_fantasia, cl.razao_social) AS cliente_nome, c.obra
           FROM cargas c JOIN amostras a ON a.carga_id = c.id JOIN corpos_prova cp ON cp.amostra_id = a.id JOIN tracos t ON t.id = c.traco_id
           LEFT JOIN clientes cl ON cl.id = c.cliente_id
          WHERE c.empresa_id = $1 AND c.id = ANY($2::uuid[]) AND a.status = 'ativa' AND cp.situacao <> 'descartado'
          ORDER BY c.data_hora, c.numero, cp.idade_dias, cp.numero`,
        [empresaId, ids],
      );
      const semCps = await banco.query(
        `SELECT c.numero, coalesce(a.status, 'sem_amostra') AS status FROM cargas c LEFT JOIN amostras a ON a.carga_id = c.id
          WHERE c.empresa_id = $1 AND c.id = ANY($2::uuid[]) AND (a.status IS NULL OR a.status <> 'ativa') ORDER BY c.numero`,
        [empresaId, ids],
      );
      return {
        etiquetas: r.rows.map((x) => ({
          id: x.id, codigo: `${x.carga_numero}-${x.idade_dias}-${x.numero}`, cargaId: x.carga_id, cargaNumero: x.carga_numero, idade: x.idade_dias, cp: x.numero,
          dataMoldagem: x.data_moldagem instanceof Date ? x.data_moldagem.toISOString() : x.data_moldagem, dataPrevista: x.data_prevista,
          tracoCodigo: x.traco_codigo, fck: num(x.fck), clienteNome: x.cliente_nome, obra: x.obra,
        })),
        semEtiqueta: semCps.rows.map((x) => ({ numero: x.numero, status: x.status })),
      };
    });

    // ======================= Estoque na hora da carga =======================
    /** Saldo atual de cada insumo do traço, o consumo desta carga e o que sobra depois dela. */
    app.get<{ Querystring: { tracoId?: string; volume?: string; ignorarCarga?: string } }>('/cargas/estoque', { preHandler: usina }, async (req) => {
      const empresaId = empresaDo(req);
      const { tracoId } = req.query;
      if (!tracoId || !UUID.test(tracoId)) throw new ErroHttp(400, 'Escolha o traço.');
      const volume = Math.max(0, Number(String(req.query.volume ?? '0').replace(',', '.')) || 0);
      const itens = (
        await banco.query(
          `SELECT i.id, i.nome, i.tipo, i.unidade, i.estoque_minimo, i.controla_estoque, ti.quantidade
             FROM tracos_itens ti JOIN insumos i ON i.id = ti.insumo_id JOIN tracos t ON t.id = ti.traco_id
            WHERE ti.traco_id = $1 AND t.empresa_id = $2 ORDER BY CASE i.tipo WHEN 'cimento' THEN 1 WHEN 'areia' THEN 2 WHEN 'brita' THEN 3 WHEN 'agua' THEN 4 WHEN 'aditivo' THEN 5 ELSE 6 END, i.nome`,
          [tracoId, empresaId],
        )
      ).rows;
      const saldos = await saldosEm(banco, empresaId, hojeBrasil());
      // Ao corrigir uma carga, o consumo dela já está no saldo: devolve antes de recalcular.
      const devolver = new Map<string, number>();
      if (req.query.ignorarCarga && UUID.test(req.query.ignorarCarga)) {
        const r = await banco.query(
          `SELECT cc.insumo_id, cc.quantidade FROM cargas_consumo cc JOIN cargas c ON c.id = cc.carga_id WHERE cc.carga_id = $1 AND c.empresa_id = $2 AND c.status = 'produzida'`,
          [req.query.ignorarCarga, empresaId],
        );
        for (const x of r.rows) devolver.set(x.insumo_id, Number(x.quantidade));
      }
      const r3 = (n: number) => Math.round(n * 1000) / 1000;
      return {
        volume,
        itens: itens.map((i) => {
          const controla = !!i.controla_estoque;
          const saldo = r3((saldos.get(i.id) ?? 0) + (devolver.get(i.id) ?? 0));
          const consumo = r3(Number(i.quantidade) * volume);
          const restante = r3(saldo - consumo);
          const minimo = num(i.estoque_minimo);
          return {
            insumoId: i.id, nome: i.nome, tipo: i.tipo, unidade: i.unidade, porM3: Number(i.quantidade), controlaEstoque: controla,
            saldo: controla ? saldo : null, consumo, restante: controla ? restante : null, minimo,
            // Quantos m³ deste traço o saldo ainda produz.
            rendeM3: controla && Number(i.quantidade) > 0 ? Math.max(0, Math.floor((saldo / Number(i.quantidade)) * 10) / 10) : null,
            situacao: !controla ? 'livre' : restante < 0 ? 'falta' : minimo !== null && restante < minimo ? 'abaixo' : 'ok',
          };
        }),
      };
    });

    // ======================= Programação de entregas (vendas aprovadas no Comercial) =======================
    app.get<{ Querystring: Record<string, string | undefined> }>('/programacao', { preHandler: usina }, async (req) => {
      const empresaId = empresaDo(req);
      const hoje = hojeBrasil();
      const de = req.query.de && DATA.test(req.query.de) ? req.query.de : hoje;
      const ate = req.query.ate && DATA.test(req.query.ate) ? req.query.ate : somarDias(de, 6);
      if (ate < de) throw new ErroHttp(400, 'A data final é antes da inicial.');
      return { de, ate, hoje, vendas: await programacao(banco, empresaId, de, ate, false) };
    });

    /** Encerra a entrega com saldo (cliente não quis o restante, por exemplo). */
    app.post<{ Params: { id: string } }>('/programacao/:id/encerrar', { preHandler: gestao }, async (req) => {
      const empresaId = empresaDo(req);
      const { motivo } = z.object({ motivo: texto(300) }).parse(req.body ?? {});
      await emTransacao(banco, async (c) => {
        if (!UUID.test(req.params.id)) throw naoEncontrado('Venda');
        const v = (await c.query('SELECT id, status FROM vendas WHERE id = $1 AND empresa_id = $2', [req.params.id, empresaId])).rows[0];
        if (!v) throw naoEncontrado('Venda');
        if (v.status !== 'aprovada') throw new ErroHttp(409, 'Só entregas em andamento podem ser encerradas.');
        await c.query(
          `UPDATE vendas SET status = 'concluida', encerrada_em = now(), encerrada_por_id = $2, motivo = coalesce($3, motivo), atualizado_em = now() WHERE id = $1`,
          [v.id, req.usuario!.id, motivo],
        );
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'encerrar', entidade: 'vendas', entidadeId: v.id, depois: { motivo } });
      });
      return { ok: true };
    });

    // ======================= Valores de produção =======================
    app.get('/valores', { preHandler: gestao }, async (req) => {
      const empresaId = empresaDo(req);
      const r = await banco.query('SELECT * FROM valores_producao WHERE empresa_id = $1 ORDER BY funcao, vigencia DESC', [empresaId]);
      return {
        vigentes: await valoresVigentes(banco, empresaId, hojeBrasil()),
        historico: r.rows.map((v) => ({ id: v.id, funcao: v.funcao, valorM3: reais(v.valor_m3_centavos), vigencia: v.vigencia })),
      };
    });

    app.post('/valores', { preHandler: gestao }, async (req, reply) => {
      const d = z
        .object({
          funcao: z.enum(['motorista', 'operador_bomba']),
          valorM3: decimal('Valor inválido.').refine((n) => n >= 0 && n <= 1000, 'Valor por m³ entre R$ 0 e R$ 1.000.'),
          vigencia: z.string().regex(DATA, 'Informe a data de início.'),
        })
        .parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const x = (
          await c.query(
            `INSERT INTO valores_producao (empresa_id, funcao, valor_m3_centavos, vigencia, criado_por_id) VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (empresa_id, funcao, vigencia) DO UPDATE SET valor_m3_centavos = excluded.valor_m3_centavos, criado_por_id = excluded.criado_por_id, criado_em = now()
             RETURNING id`,
            [empresaId, d.funcao, Math.round(d.valorM3 * 100), d.vigencia, req.usuario!.id],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'valores_producao', entidadeId: x.id, depois: d });
      });
      return reply.code(201).send({ ok: true });
    });

    app.delete<{ Params: { id: string } }>('/valores/:id', { preHandler: gestao }, async (req) => {
      const empresaId = empresaDo(req);
      if (!UUID.test(req.params.id)) throw naoEncontrado('Valor');
      await emTransacao(banco, async (c) => {
        const antes = (await c.query('DELETE FROM valores_producao WHERE id = $1 AND empresa_id = $2 RETURNING *', [req.params.id, empresaId])).rows[0];
        if (!antes) throw naoEncontrado('Valor');
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'excluir', entidade: 'valores_producao', entidadeId: antes.id, antes });
      });
      return { ok: true };
    });

    // ======================= Produção dos motoristas =======================
    app.get<{ Querystring: Record<string, string | undefined> }>('/producao', { preHandler: gestao }, async (req) => {
      const empresaId = empresaDo(req);
      const { de, ate } = periodoDias(req.query);
      const pessoaId = req.query.pessoaId && UUID.test(req.query.pessoaId) ? req.query.pessoaId : null;
      const linhas = await linhasProducao(banco, empresaId, de, ate, pessoaId);
      const semValor = (
        await banco.query(
          `SELECT funcao FROM (VALUES ('motorista'), ('operador_bomba')) f(funcao)
            WHERE NOT EXISTS (SELECT 1 FROM valores_producao v WHERE v.empresa_id = $1 AND v.funcao = f.funcao AND v.vigencia <= $2)`,
          [empresaId, ate],
        )
      ).rows.map((x) => x.funcao);
      return { de, ate, pessoas: resumirProducao(linhas), detalhe: pessoaId ? linhas : [], valores: await valoresVigentes(banco, empresaId, ate), semValor };
    });

    app.get<{ Querystring: Record<string, string | undefined> }>('/minha-producao', { preHandler: motorista }, async (req) => {
      const empresaId = empresaDo(req);
      const { de, ate } = periodoDias(req.query);
      const eu = await motoristaDoUsuario(banco, req);
      const linhas = await linhasProducao(banco, empresaId, de, ate, eu);
      return { de, ate, resumo: resumirProducao(linhas)[0] ?? null, detalhe: linhas, valores: await valoresVigentes(banco, empresaId, ate) };
    });

    // ======================= Escala =======================
    async function pessoasEscala(c: Cliente, empresaId: string) {
      return (
        await c.query(
          `SELECT id, nome, funcao FROM motoristas WHERE empresa_id = $1 AND excluido_em IS NULL AND ativo
              AND funcao IN ('motorista', 'operador_bomba', 'motorista_operador')
            ORDER BY array_position(ARRAY['motorista','motorista_operador','operador_bomba'], funcao), nome`,
          [empresaId],
        )
      ).rows;
    }

    app.get<{ Querystring: { data?: string; copiar?: string } }>('/escala', { preHandler: gestao }, async (req) => {
      const empresaId = empresaDo(req);
      const data = req.query.data && DATA.test(req.query.data) ? req.query.data : hojeBrasil();
      const pessoas = await pessoasEscala(banco, empresaId);
      const doDia = (await banco.query('SELECT * FROM escalas WHERE empresa_id = $1 AND data = $2', [empresaId, data])).rows;
      // Para copiar: o último dia antes deste que tem escala.
      const anterior = (await banco.query('SELECT max(data) AS d FROM escalas WHERE empresa_id = $1 AND data < $2', [empresaId, data])).rows[0]?.d ?? null;
      const base = req.query.copiar === '1' && anterior ? (await banco.query('SELECT * FROM escalas WHERE empresa_id = $1 AND data = $2', [empresaId, anterior])).rows : doDia;
      return {
        data,
        anterior,
        salva: doDia.length > 0,
        itens: pessoas.map((p) => {
          const e = base.find((x) => x.motorista_id === p.id);
          return {
            motoristaId: p.id,
            nome: p.nome,
            funcao: p.funcao,
            entrada: e?.entrada ? String(e.entrada).slice(0, 5) : null,
            folga: e?.folga ?? false,
            observacao: e?.observacao ?? null,
          };
        }),
      };
    });

    app.put<{ Params: { data: string } }>('/escala/:data', { preHandler: gestao }, async (req) => {
      if (!DATA.test(req.params.data)) throw new ErroHttp(400, 'Data inválida.');
      const d = z
        .object({
          itens: z
            .array(
              z.object({
                motoristaId: z.string().uuid(),
                entrada: z.union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido. Use HH:MM.'), z.literal(''), z.null()]).optional().transform((v) => v || null),
                folga: z.boolean().optional().default(false),
                observacao: texto(200),
              }),
            )
            .max(300),
        })
        .parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const ids = d.itens.map((i) => i.motoristaId);
        if (ids.length) {
          const n = (await c.query('SELECT count(*)::int AS n FROM motoristas WHERE empresa_id = $1 AND id = ANY($2::uuid[])', [empresaId, ids])).rows[0].n;
          if (n !== new Set(ids).size) throw new ErroHttp(400, 'Pessoa não encontrada.');
        }
        await c.query('DELETE FROM escalas WHERE empresa_id = $1 AND data = $2', [empresaId, req.params.data]);
        for (const i of d.itens) {
          if (!i.folga && !i.entrada) continue;
          await c.query(
            `INSERT INTO escalas (empresa_id, data, motorista_id, entrada, folga, observacao, atualizado_por_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [empresaId, req.params.data, i.motoristaId, i.folga ? null : i.entrada, i.folga, i.observacao, req.usuario!.id],
          );
        }
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'escalas', entidadeId: empresaId, depois: { data: req.params.data, itens: d.itens.length } });
      });
      return { ok: true };
    });

    // ======================= Cargas do motorista (app) =======================
    /** Cargas do motorista: as de hoje e as que ainda não foram descarregadas. */
    app.get('/minhas-cargas', { preHandler: motorista }, async (req) => {
      const empresaId = empresaDo(req);
      const mot = await motoristaDoUsuario(banco, req);
      const r = await banco.query(
        `SELECT c.*, t.codigo AS traco_codigo, t.slump AS slump_traco, coalesce(cl.nome_fantasia, cl.razao_social) AS cliente_nome, cl.telefone AS cliente_telefone,
                b.codigo AS betoneira_codigo, bo.codigo AS bomba_codigo, v.numero AS venda_numero, v.endereco, v.contato, v.observacoes AS obs_venda
           FROM cargas c JOIN tracos t ON t.id = c.traco_id JOIN veiculos b ON b.id = c.betoneira_id LEFT JOIN clientes cl ON cl.id = c.cliente_id
           LEFT JOIN veiculos bo ON bo.id = c.bomba_id LEFT JOIN vendas v ON v.id = c.venda_id
          WHERE c.empresa_id = $1 AND c.motorista_id = $2 AND c.status = 'produzida'
            AND (${DIA_LOCAL('c.data_hora')} = $3 OR (c.descarga_em IS NULL AND c.data_hora > now() - interval '2 days'))
          ORDER BY (c.descarga_em IS NULL) DESC, c.data_hora DESC LIMIT 30`,
        [empresaId, mot, hojeBrasil()],
      );
      return {
        cargas: r.rows.map((x) => ({
          id: x.id, numero: x.numero, dataHora: x.data_hora instanceof Date ? x.data_hora.toISOString() : x.data_hora, tracoCodigo: x.traco_codigo, slumpTraco: x.slump_traco,
          volume: Number(x.volume_m3), clienteNome: x.cliente_nome, clienteTelefone: x.cliente_telefone, obra: x.obra, endereco: x.endereco, contato: x.contato,
          observacoes: [x.obs_venda, x.observacoes].filter(Boolean).join(' · ') || null, betoneiraCodigo: x.betoneira_codigo, bombaCodigo: x.bomba_codigo,
          vendaNumero: x.venda_numero, saidaEm: x.saida_em, chegadaEm: x.chegada_em, descargaEm: x.descarga_em, slumpEntrega: num(x.slump_entrega_cm),
          devolvido: Number(x.devolvido_m3), obsMotorista: x.obs_motorista,
        })),
      };
    });

    app.post<{ Params: { id: string } }>('/minhas-cargas/:id/etapa', { preHandler: motorista }, async (req) => {
      const d = z
        .object({
          etapa: z.enum(['saida', 'chegada', 'descarga'], { errorMap: () => ({ message: 'Etapa inválida.' }) }),
          slump: decimal('Slump inválido.').refine((n) => n >= 0 && n <= 30, 'Slump entre 0 e 30 cm.').nullable().optional(),
          devolvido: decimal('Volume devolvido inválido.').refine((n) => n >= 0, 'Volume devolvido inválido.').nullable().optional(),
          observacao: texto(300),
        })
        .parse(req.body ?? {});
      const empresaId = empresaDo(req);
      if (!UUID.test(req.params.id)) throw naoEncontrado('Carga');
      await emTransacao(banco, async (c) => {
        const mot = await motoristaDoUsuario(c, req);
        const x = (await c.query('SELECT * FROM cargas WHERE id = $1 AND empresa_id = $2 AND motorista_id = $3 FOR UPDATE', [req.params.id, empresaId, mot])).rows[0];
        if (!x) throw naoEncontrado('Carga');
        if (x.status !== 'produzida') throw new ErroHttp(409, 'Esta carga foi cancelada.');
        if (d.etapa === 'descarga') {
          if (d.slump === null || d.slump === undefined) throw new ErroHttp(400, 'Informe o slump medido na obra.');
          if ((d.devolvido ?? 0) > Number(x.volume_m3)) throw new ErroHttp(400, 'O volume devolvido não pode passar o volume da carga.');
          await c.query(
            `UPDATE cargas SET saida_em = coalesce(saida_em, data_hora), chegada_em = coalesce(chegada_em, now()), descarga_em = now(), slump_entrega_cm = $2,
                    devolvido_m3 = coalesce($3, devolvido_m3), obs_motorista = $4, atualizado_em = now() WHERE id = $1`,
            [x.id, d.slump, d.devolvido ?? null, d.observacao],
          );
        } else {
          const sql = d.etapa === 'saida' ? 'saida_em = coalesce(saida_em, now())' : 'saida_em = coalesce(saida_em, now()), chegada_em = coalesce(chegada_em, now())';
          await c.query(`UPDATE cargas SET ${sql}, atualizado_em = now() WHERE id = $1`, [x.id]);
        }
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'cargas', entidadeId: x.id, depois: { motorista: d } });
      });
      return { ok: true };
    });

    app.get('/minha-escala', { preHandler: motorista }, async (req) => {
      const empresaId = empresaDo(req);
      const eu = await motoristaDoUsuario(banco, req);
      const hoje = hojeBrasil();
      const r = await banco.query(
        `SELECT data, entrada, folga, observacao FROM escalas WHERE empresa_id = $1 AND motorista_id = $2 AND data BETWEEN $3 AND $4 ORDER BY data`,
        [empresaId, eu, somarDias(hoje, -1), somarDias(hoje, 14)],
      );
      return { hoje, dias: r.rows.map((x) => ({ data: x.data, entrada: x.entrada ? String(x.entrada).slice(0, 5) : null, folga: x.folga, observacao: x.observacao })) };
    });

  };
}
