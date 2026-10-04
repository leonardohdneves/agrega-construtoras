// Módulo Suprimentos · Compras: solicitações, cotações e mapa, pedidos de compra com aprovação e recebimento pela nota fiscal.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Banco, Cliente } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';
import { diasEntre, hojeBrasil } from '../lib/frota.ts';
import { somarDias, somarMeses } from '../lib/financeiro.ts';
import { SQL_SALDOS } from '../lib/estoque.ts';
import { normalizar } from '../lib/sugestoes.ts';
import { dispensaAprovacao, lerRegras, lerRegrasDe, podeAprovar, proximoNumero, textoRegras, type RegrasAprovacao } from '../lib/aprovacao.ts';
import { empresaDo, exigir } from '../sessao.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const reais = (c: unknown) => (c === null || c === undefined ? null : Math.round(Number(c)) / 100);
const preco = (c: unknown) => (c === null || c === undefined ? null : Math.round(Number(c) * 100) / 10000); // centavos(4 casas) → reais(6 casas)
const cent = (r: number) => Math.round(r * 100);
const centPreco = (r: number) => Math.round(r * 1_000_000) / 10_000;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const texto = (max = 200) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const dataOpc = z.string().regex(DATA, 'Data inválida.').optional().nullable().transform((v) => v || null);
const uuidOpc = z.string().regex(UUID).optional().nullable().transform((v) => v || null);
const decimal = (msg: string) =>
  z.union([z.number(), z.string()]).transform((v, ctx) => {
    const n = typeof v === 'number' ? v : Number(String(v).replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: 'custom', message: msg });
      return z.NEVER;
    }
    return n;
  });
const positivo = (msg: string) => decimal(msg).refine((n) => n > 0, msg);
const naoNegativo = (msg: string) => decimal(msg).refine((n) => n >= 0, msg);

const STATUS_SOLICITACAO = ['aberta', 'em_cotacao', 'atendida', 'cancelada'] as const;
const STATUS_PEDIDO = ['rascunho', 'aguardando_aprovacao', 'aprovado', 'reprovado', 'enviado', 'parcial', 'recebido', 'encerrado', 'cancelado'] as const;
/** Pedidos que ainda podem receber mercadoria. */
const PEDIDO_A_RECEBER = ['aprovado', 'enviado', 'parcial'];

const usuarioDe = (req: FastifyRequest) => req.usuario!;

function periodo(q: Record<string, string | undefined>, padraoDias = 90) {
  const hoje = hojeBrasil();
  // Aceita dia (aaaa-mm-dd) ou mês (aaaa-mm), como nos demais relatórios.
  const MES = /^\d{4}-\d{2}$/;
  const de = q.de && DATA.test(q.de) ? q.de : q.de && MES.test(q.de) ? `${q.de}-01` : somarDias(hoje, -padraoDias);
  const ate = q.ate && DATA.test(q.ate) ? q.ate : q.ate && MES.test(q.ate) ? somarDias(somarMeses(`${q.ate}-01`, 1), -1) : hoje;
  if (ate < de) throw new ErroHttp(400, 'A data final é antes da inicial.');
  if (Date.parse(ate) - Date.parse(de) > 400 * 86_400_000) throw new ErroHttp(400, 'Escolha um período de até 13 meses.');
  return { de, ate, hoje };
}

// ---------------------------------------------------------------- itens (insumo do cadastro ou descrição livre)

const esquemaItem = z.object({
  insumoId: uuidOpc,
  catalogoId: uuidOpc,
  descricao: texto(200),
  unidade: z.string().trim().max(10).optional().nullable().transform((v) => v || null),
  quantidade: positivo('A quantidade deve ser maior que zero.'),
  observacao: texto(200),
});
type ItemEntrada = z.infer<typeof esquemaItem>;
type ItemResolvido = { insumoId: string | null; catalogoId: string | null; descricao: string; unidade: string; quantidade: number; observacao: string | null };

async function resolverItens(c: Cliente, empresaId: string, itens: ItemEntrada[]): Promise<ItemResolvido[]> {
  if (!itens.length) throw new ErroHttp(400, 'Inclua pelo menos um item.');
  const ids = [...new Set(itens.map((i) => i.insumoId).filter(Boolean))] as string[];
  const insumos = new Map<string, { nome: string; unidade: string }>();
  if (ids.length) {
    const r = await c.query('SELECT id, nome, unidade FROM insumos WHERE empresa_id = $1 AND id = ANY($2::uuid[]) AND excluido_em IS NULL', [empresaId, ids]);
    for (const x of r.rows) insumos.set(x.id, { nome: x.nome, unidade: x.unidade });
  }
  const cids = [...new Set(itens.map((i) => i.catalogoId).filter(Boolean))] as string[];
  const catalogo = new Map<string, { descricao: string; unidade: string }>();
  if (cids.length) {
    const r = await c.query('SELECT id, descricao, unidade FROM catalogo_itens WHERE empresa_id = $1 AND id = ANY($2::uuid[])', [empresaId, cids]);
    for (const x of r.rows) catalogo.set(x.id, { descricao: x.descricao, unidade: x.unidade });
  }
  return itens.map((i, n) => {
    if (i.catalogoId && !i.insumoId) {
      const it = catalogo.get(i.catalogoId);
      if (!it) throw new ErroHttp(400, `Item ${n + 1}: item do catálogo não encontrado.`);
      return { insumoId: null, catalogoId: i.catalogoId, descricao: it.descricao, unidade: it.unidade, quantidade: r3(i.quantidade), observacao: i.observacao };
    }
    if (i.insumoId) {
      const ins = insumos.get(i.insumoId);
      if (!ins) throw new ErroHttp(400, `Item ${n + 1}: insumo não encontrado.`);
      return { insumoId: i.insumoId, catalogoId: null, descricao: i.descricao ?? ins.nome, unidade: i.unidade ?? ins.unidade, quantidade: r3(i.quantidade), observacao: i.observacao };
    }
    if (!i.descricao) throw new ErroHttp(400, `Item ${n + 1}: escolha o insumo ou escreva a descrição.`);
    if (!i.unidade) throw new ErroHttp(400, `Item ${n + 1}: informe a unidade.`);
    return { insumoId: null, catalogoId: null, descricao: i.descricao, unidade: i.unidade, quantidade: r3(i.quantidade), observacao: i.observacao };
  });
}

async function validarFornecedor(c: Cliente, empresaId: string, id: string) {
  const r = await c.query("SELECT id FROM fornecedores WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL AND categoria = 'fornecedor'", [id, empresaId]);
  if (!r.rowCount) throw new ErroHttp(400, 'Fornecedor não encontrado.');
}
async function validarCentro(c: Cliente, empresaId: string, id: string | null) {
  if (id && !(await c.query('SELECT 1 FROM centros_custo WHERE id = $1 AND empresa_id = $2', [id, empresaId])).rowCount) throw new ErroHttp(400, 'Centro de custo não encontrado.');
}

// ---------------------------------------------------------------- solicitações

const esquemaSolicitacao = z.object({
  data: dataOpc,
  necessidade: dataOpc,
  centroCustoId: uuidOpc,
  observacao: texto(500),
  origem: z.enum(['manual', 'estoque_minimo']).optional().default('manual'),
  itens: z.array(esquemaItem).max(100, 'Até 100 itens por solicitação.'),
});

async function detalharSolicitacao(c: Cliente, empresaId: string, id: string) {
  if (!UUID.test(id)) throw naoEncontrado('Solicitação');
  const s = (
    await c.query(
      `SELECT s.*, u.nome AS solicitante, cc.nome AS centro_custo,
              (SELECT json_agg(json_build_object('id', ct.id, 'numero', ct.numero, 'status', ct.status) ORDER BY ct.numero) FROM cotacoes ct WHERE ct.solicitacao_id = s.id) AS cotacoes,
              (SELECT json_agg(json_build_object('id', p.id, 'numero', p.numero, 'status', p.status) ORDER BY p.numero) FROM pedidos_compra p WHERE p.solicitacao_id = s.id) AS pedidos
         FROM solicitacoes_compra s LEFT JOIN usuarios u ON u.id = s.solicitante_id LEFT JOIN centros_custo cc ON cc.id = s.centro_custo_id
        WHERE s.id = $1 AND s.empresa_id = $2`,
      [id, empresaId],
    )
  ).rows[0];
  if (!s) throw naoEncontrado('Solicitação');
  const itens = (
    await c.query(
      `SELECT si.*, i.tipo FROM solicitacoes_itens si LEFT JOIN insumos i ON i.id = si.insumo_id WHERE si.solicitacao_id = $1 ORDER BY si.descricao`,
      [id],
    )
  ).rows;
  return {
    id: s.id,
    numero: s.numero,
    data: s.data,
    necessidade: s.necessidade,
    origem: s.origem,
    centroCustoId: s.centro_custo_id,
    centroCusto: s.centro_custo,
    observacao: s.observacao,
    status: s.status,
    solicitante: s.solicitante,
    cotacoes: s.cotacoes ?? [],
    pedidos: s.pedidos ?? [],
    itens: itens.map((i) => ({ id: i.id, insumoId: i.insumo_id, catalogoId: i.catalogo_id, tipo: i.tipo, descricao: i.descricao, unidade: i.unidade, quantidade: Number(i.quantidade), observacao: i.observacao })),
  };
}

async function gravarItensSolicitacao(c: Cliente, empresaId: string, solicitacaoId: string, itens: ItemResolvido[]) {
  await c.query('DELETE FROM solicitacoes_itens WHERE solicitacao_id = $1', [solicitacaoId]);
  for (const i of itens)
    await c.query(
      'INSERT INTO solicitacoes_itens (empresa_id, solicitacao_id, insumo_id, catalogo_id, descricao, unidade, quantidade, observacao) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [empresaId, solicitacaoId, i.insumoId, i.catalogoId, i.descricao, i.unidade, i.quantidade, i.observacao],
    );
}

/** Insumos abaixo do estoque mínimo, descontando o que já está pedido ou solicitado, com a quantidade para repor até 2× o mínimo. */
async function sugestaoEstoque(c: Cliente, empresaId: string) {
  const hoje = hojeBrasil();
  const r = await c.query(
    `WITH s AS (${SQL_SALDOS})
     SELECT i.id, i.nome, i.tipo, i.unidade, i.estoque_minimo, s.saldo,
            coalesce((SELECT sum(cc.quantidade) FROM cargas_consumo cc JOIN cargas c ON c.id = cc.carga_id
                       WHERE cc.insumo_id = i.id AND c.status = 'produzida' AND (c.data_hora AT TIME ZONE 'America/Sao_Paulo')::date > $2::date - 30), 0) / 30.0 AS consumo_dia,
            coalesce((SELECT sum(pi.quantidade - coalesce((SELECT sum(ni.quantidade_pedido) FROM notas_itens ni JOIN notas_fiscais n ON n.id = ni.nota_id
                                                             WHERE ni.pedido_item_id = pi.id AND n.excluido_em IS NULL AND n.status <> 'cancelada'), 0))
                        FROM pedidos_itens pi JOIN pedidos_compra p ON p.id = pi.pedido_id
                       WHERE pi.insumo_id = i.id AND p.status IN ('rascunho', 'aguardando_aprovacao', 'aprovado', 'enviado', 'parcial')), 0) AS em_pedido,
            coalesce((SELECT sum(si.quantidade) FROM solicitacoes_itens si JOIN solicitacoes_compra sc ON sc.id = si.solicitacao_id
                       WHERE si.insumo_id = i.id AND sc.status IN ('aberta', 'em_cotacao')), 0) AS em_solicitacao
       FROM insumos i JOIN s ON s.insumo_id = i.id
      WHERE i.empresa_id = $1 AND i.excluido_em IS NULL AND i.ativo AND i.controla_estoque AND i.estoque_minimo IS NOT NULL AND i.estoque_minimo > 0
      ORDER BY i.nome`,
    [empresaId, hoje],
  );
  return r.rows
    .map((x) => {
      const minimo = Number(x.estoque_minimo);
      const saldo = Number(x.saldo);
      const emPedido = Math.max(0, Number(x.em_pedido));
      const emSolicitacao = Number(x.em_solicitacao);
      const consumoDia = Number(x.consumo_dia);
      const sugerido = 2 * minimo - saldo - emPedido - emSolicitacao;
      return {
        insumoId: x.id as string,
        nome: x.nome as string,
        tipo: x.tipo as string,
        unidade: x.unidade as string,
        estoqueMinimo: minimo,
        saldo: r3(saldo),
        emPedido: r3(emPedido),
        emSolicitacao: r3(emSolicitacao),
        diasCobertura: consumoDia > 0 && saldo > 0 ? Math.floor(saldo / consumoDia) : null,
        sugerido: sugerido > 0 ? Math.ceil(sugerido) : 0,
        abaixo: saldo < minimo,
      };
    })
    .filter((x) => x.abaixo);
}

// ---------------------------------------------------------------- cotações e mapa

async function detalharCotacao(c: Cliente, empresaId: string, id: string) {
  if (!UUID.test(id)) throw naoEncontrado('Cotação');
  const ct = (
    await c.query(
      `SELECT ct.*, s.numero AS solicitacao_numero, u.nome AS criado_por FROM cotacoes ct
         LEFT JOIN solicitacoes_compra s ON s.id = ct.solicitacao_id LEFT JOIN usuarios u ON u.id = ct.criado_por_id
        WHERE ct.id = $1 AND ct.empresa_id = $2`,
      [id, empresaId],
    )
  ).rows[0];
  if (!ct) throw naoEncontrado('Cotação');
  const fornecedores = (
    await c.query(
      `SELECT cf.*, f.razao_social, f.nome_fantasia, f.cnpj_cpf, f.telefone, f.email, f.cidade, f.uf
         FROM cotacoes_fornecedores cf JOIN fornecedores f ON f.id = cf.fornecedor_id
        WHERE cf.cotacao_id = $1 ORDER BY coalesce(f.nome_fantasia, f.razao_social)`,
      [id],
    )
  ).rows;
  const itens = (await c.query('SELECT * FROM cotacoes_itens WHERE cotacao_id = $1 ORDER BY descricao', [id])).rows;
  const precos = (await c.query('SELECT cp.* FROM cotacoes_precos cp JOIN cotacoes_itens ci ON ci.id = cp.cotacao_item_id WHERE ci.cotacao_id = $1', [id])).rows;
  const pedidos = (
    await c.query(
      `SELECT p.id, p.numero, p.status, p.total_centavos, coalesce(f.nome_fantasia, f.razao_social) AS fornecedor
         FROM pedidos_compra p JOIN fornecedores f ON f.id = p.fornecedor_id WHERE p.cotacao_id = $1 ORDER BY p.numero`,
      [id],
    )
  ).rows;

  const mapaPreco = new Map<string, number>(); // `${cf}:${item}` → centavos (4 casas)
  for (const p of precos) mapaPreco.set(`${p.cotacao_fornecedor_id}:${p.cotacao_item_id}`, Number(p.preco_unitario_centavos));

  const linhas = itens.map((i) => {
    const q = Number(i.quantidade);
    const ofertas = fornecedores
      .map((f) => {
        const pu = mapaPreco.get(`${f.id}:${i.id}`);
        return pu === undefined ? null : { cotacaoFornecedorId: f.id as string, precoUnitario: preco(pu)!, total: Math.round(pu * q) / 100, centavos: pu };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
    const menor = ofertas.length ? ofertas.reduce((a, b) => (b.centavos < a.centavos ? b : a)) : null;
    const maior = ofertas.length ? ofertas.reduce((a, b) => (b.centavos > a.centavos ? b : a)) : null;
    const media = ofertas.length ? ofertas.reduce((s, o) => s + o.centavos, 0) / ofertas.length : null;
    const venc = ofertas.find((o) => o.cotacaoFornecedorId === i.vencedor_id) ?? null;
    return {
      id: i.id as string,
      insumoId: i.insumo_id as string | null,
      catalogoId: i.catalogo_id as string | null,
      descricao: i.descricao as string,
      unidade: i.unidade as string,
      quantidade: q,
      ofertas: ofertas.map(({ centavos: _c, ...o }) => o),
      menorPrecoId: menor?.cotacaoFornecedorId ?? null,
      vencedorId: (i.vencedor_id as string | null) ?? null,
      justificativa: i.justificativa as string | null,
      foraDoMenor: !!venc && !!menor && venc.centavos > menor.centavos,
      totalVencedor: venc ? Math.round(venc.centavos * q) / 100 : null,
      economiaMaior: venc && maior ? Math.round((maior.centavos - venc.centavos) * q) / 100 : null,
      economiaMedia: venc && media !== null ? Math.round((media - venc.centavos) * q) / 100 : null,
    };
  });

  const forn = fornecedores.map((f) => {
    const cotados = linhas.filter((l) => l.ofertas.some((o) => o.cotacaoFornecedorId === f.id));
    const subtotal = cotados.reduce((s, l) => s + l.ofertas.find((o) => o.cotacaoFornecedorId === f.id)!.total, 0);
    const vencidos = linhas.filter((l) => l.vencedorId === f.id);
    return {
      id: f.id as string,
      fornecedorId: f.fornecedor_id as string,
      nome: (f.nome_fantasia || f.razao_social) as string,
      razaoSocial: f.razao_social as string,
      documento: f.cnpj_cpf as string | null,
      telefone: f.telefone as string | null,
      email: f.email as string | null,
      cidade: f.cidade ? `${f.cidade}${f.uf ? `/${String(f.uf).trim()}` : ''}` : null,
      prazoEntregaDias: num(f.prazo_entrega_dias),
      condicaoPagamento: f.condicao_pagamento as string | null,
      frete: reais(f.frete_centavos)!,
      validade: f.validade as string | null,
      observacao: f.observacao as string | null,
      itensCotados: cotados.length,
      subtotal: Math.round(subtotal * 100) / 100,
      total: Math.round((subtotal + Number(f.frete_centavos) / 100) * 100) / 100,
      completo: cotados.length === linhas.length,
      itensVencidos: vencidos.length,
      totalVencido: Math.round(vencidos.reduce((s, l) => s + (l.totalVencedor ?? 0), 0) * 100) / 100,
    };
  });
  const comVencedor = linhas.filter((l) => l.vencedorId);
  // Frete entra pelo fornecedor que levou ao menos um item.
  const freteVencedores = forn.filter((f) => f.itensVencidos > 0).reduce((s, f) => s + f.frete, 0);
  const melhorCompleto = forn.filter((f) => f.completo).sort((a, b) => a.total - b.total)[0] ?? null;
  return {
    id: ct.id,
    numero: ct.numero,
    data: ct.data,
    prazoResposta: ct.prazo_resposta,
    solicitacaoId: ct.solicitacao_id,
    solicitacaoNumero: ct.solicitacao_numero,
    observacao: ct.observacao,
    justificativa: ct.justificativa,
    status: ct.status,
    criadoPor: ct.criado_por,
    concluidaEm: ct.concluida_em,
    fornecedores: forn,
    itens: linhas,
    pedidos: pedidos.map((p) => ({ id: p.id, numero: p.numero, status: p.status, total: reais(p.total_centavos), fornecedor: p.fornecedor })),
    resumo: {
      itens: linhas.length,
      itensComVencedor: comVencedor.length,
      itensForaDoMenor: linhas.filter((l) => l.foraDoMenor).length,
      totalEscolhido: Math.round((comVencedor.reduce((s, l) => s + (l.totalVencedor ?? 0), 0) + freteVencedores) * 100) / 100,
      freteEscolhido: freteVencedores,
      economiaMaior: Math.round(comVencedor.reduce((s, l) => s + (l.economiaMaior ?? 0), 0) * 100) / 100,
      economiaMedia: Math.round(comVencedor.reduce((s, l) => s + (l.economiaMedia ?? 0), 0) * 100) / 100,
      melhorFornecedorCompleto: melhorCompleto ? { id: melhorCompleto.id, nome: melhorCompleto.nome, total: melhorCompleto.total } : null,
    },
  };
}

// ---------------------------------------------------------------- pedidos

type LinhaPedido = Record<string, any>;

/** Recebido de cada item do pedido (pelas notas ligadas e não canceladas). */
async function recebidosDoPedido(c: Cliente, pedidoId: string) {
  const r = await c.query(
    `SELECT ni.pedido_item_id, sum(ni.quantidade_pedido) AS quantidade, sum(ni.valor_produto_centavos) AS valor
       FROM notas_itens ni JOIN notas_fiscais n ON n.id = ni.nota_id
      WHERE n.pedido_id = $1 AND ni.pedido_item_id IS NOT NULL AND n.excluido_em IS NULL AND n.status <> 'cancelada'
      GROUP BY ni.pedido_item_id`,
    [pedidoId],
  );
  return new Map(r.rows.map((x) => [x.pedido_item_id as string, { quantidade: Number(x.quantidade ?? 0), valorCentavos: Number(x.valor ?? 0) }]));
}

async function detalharPedido(c: Cliente, empresaId: string, id: string, usuario?: { perfil: string; administrador: boolean }) {
  if (!UUID.test(id)) throw naoEncontrado('Pedido');
  const p = (
    await c.query(
      `SELECT p.*, f.razao_social, f.nome_fantasia, f.cnpj_cpf, f.telefone, f.email, f.cidade, f.uf, f.chave_pix,
              cc.nome AS centro_custo, ua.nome AS aprovado_por, uc.nome AS criado_por, ct.numero AS cotacao_numero, s.numero AS solicitacao_numero
         FROM pedidos_compra p JOIN fornecedores f ON f.id = p.fornecedor_id
         LEFT JOIN centros_custo cc ON cc.id = p.centro_custo_id
         LEFT JOIN usuarios ua ON ua.id = p.aprovado_por_id LEFT JOIN usuarios uc ON uc.id = p.criado_por_id
         LEFT JOIN cotacoes ct ON ct.id = p.cotacao_id LEFT JOIN solicitacoes_compra s ON s.id = p.solicitacao_id
        WHERE p.id = $1 AND p.empresa_id = $2`,
      [id, empresaId],
    )
  ).rows[0] as LinhaPedido | undefined;
  if (!p) throw naoEncontrado('Pedido');
  const itens = (await c.query('SELECT pi.*, i.tipo, ct.codigo FROM pedidos_itens pi LEFT JOIN insumos i ON i.id = pi.insumo_id LEFT JOIN catalogo_itens ct ON ct.id = pi.catalogo_id WHERE pi.pedido_id = $1 ORDER BY pi.descricao', [id])).rows;
  const recebidos = await recebidosDoPedido(c, id);
  const notas = (
    await c.query(
      `SELECT n.id, n.numero, n.serie, n.modelo, n.data_emissao, n.total_centavos, n.status, n.lancamento_id,
              (SELECT count(*)::int FROM notas_itens ni WHERE ni.nota_id = n.id AND ni.pedido_item_id IS NOT NULL) AS itens_ligados
         FROM notas_fiscais n WHERE n.pedido_id = $1 AND n.excluido_em IS NULL ORDER BY n.data_emissao, n.numero`,
      [id],
    )
  ).rows;
  const regras = await lerRegras(c, empresaId);
  const hoje = hojeBrasil();
  const linhas = itens.map((i) => {
    const q = Number(i.quantidade);
    const pu = Number(i.preco_unitario_centavos);
    const rec = recebidos.get(i.id);
    const qRec = rec?.quantidade ?? 0;
    const precoNota = rec && rec.quantidade > 0 ? rec.valorCentavos / rec.quantidade : null; // centavos por unidade do pedido
    const difPreco = precoNota !== null && pu > 0 ? precoNota / pu - 1 : null;
    return {
      id: i.id as string,
      insumoId: i.insumo_id as string | null,
      catalogoId: i.catalogo_id as string | null,
      codigo: i.codigo as string | null,
      tipo: i.tipo as string | null,
      descricao: i.descricao as string,
      unidade: i.unidade as string,
      quantidade: q,
      precoUnitario: preco(pu)!,
      total: Math.round(pu * q) / 100,
      recebido: r3(qRec),
      saldo: r3(Math.max(q - qRec, 0)),
      precoNota: precoNota === null ? null : preco(precoNota),
      diferencaPreco: difPreco === null ? null : Math.round(difPreco * 10000) / 10000,
      diferencaQuantidade: qRec > 0 ? r3(qRec - q) : null,
    };
  });
  const atrasado = PEDIDO_A_RECEBER.includes(p.status) && p.previsao_entrega && p.previsao_entrega < hoje;
  return {
    id: p.id as string,
    numero: p.numero as number,
    data: p.data as string,
    status: p.status as (typeof STATUS_PEDIDO)[number],
    fornecedorId: p.fornecedor_id as string,
    fornecedor: {
      nome: (p.nome_fantasia || p.razao_social) as string,
      razaoSocial: p.razao_social as string,
      documento: p.cnpj_cpf as string | null,
      telefone: p.telefone as string | null,
      email: p.email as string | null,
      cidade: p.cidade ? `${p.cidade}${p.uf ? `/${String(p.uf).trim()}` : ''}` : null,
    },
    cotacaoId: p.cotacao_id as string | null,
    cotacaoNumero: p.cotacao_numero as number | null,
    solicitacaoId: p.solicitacao_id as string | null,
    solicitacaoNumero: p.solicitacao_numero as number | null,
    previsaoEntrega: p.previsao_entrega as string | null,
    atrasado: !!atrasado,
    diasAtraso: atrasado ? diasEntre(p.previsao_entrega, hoje) : 0,
    condicaoPagamento: p.condicao_pagamento as string | null,
    localEntrega: p.local_entrega as string | null,
    frete: reais(p.frete_centavos)!,
    subtotal: Math.round(linhas.reduce((s, l) => s + l.total, 0) * 100) / 100,
    total: reais(p.total_centavos)!,
    centroCustoId: p.centro_custo_id as string | null,
    centroCusto: p.centro_custo as string | null,
    observacao: p.observacao as string | null,
    criadoPor: p.criado_por as string | null,
    enviadoAprovacaoEm: p.enviado_aprovacao_em as string | null,
    aprovadoPor: p.aprovado_por as string | null,
    aprovadoEm: p.aprovado_em as string | null,
    aprovacaoAutomatica: !!p.aprovacao_automatica,
    motivoReprovacao: p.motivo_reprovacao as string | null,
    enviadoFornecedorEm: p.enviado_fornecedor_em as string | null,
    encerradoMotivo: p.encerrado_motivo as string | null,
    itens: linhas,
    notas: notas.map((n) => ({
      id: n.id,
      numero: n.numero,
      serie: n.serie,
      modelo: n.modelo,
      dataEmissao: n.data_emissao,
      total: reais(n.total_centavos),
      status: n.status,
      lancada: !!n.lancamento_id,
      itensLigados: n.itens_ligados,
    })),
    divergencias: linhas.filter((l) => (l.diferencaPreco !== null && Math.abs(l.diferencaPreco) > 0.005) || (l.diferencaQuantidade !== null && l.saldo === 0 && Math.abs(l.diferencaQuantidade) > l.quantidade * 0.005)).length,
    podeAprovar: usuario ? podeAprovar(usuario, Number(p.total_centavos), regras) : false,
    regrasAprovacao: textoRegras(regras),
  };
}

const esquemaPedido = z.object({
  fornecedorId: z.string().regex(UUID, 'Escolha o fornecedor.'),
  data: dataOpc,
  previsaoEntrega: dataOpc,
  condicaoPagamento: texto(120),
  localEntrega: texto(200),
  frete: naoNegativo('Frete inválido.').optional().default(0),
  centroCustoId: uuidOpc,
  observacao: texto(1000),
  solicitacaoId: uuidOpc,
  itens: z
    .array(esquemaItem.extend({ precoUnitario: naoNegativo('Preço inválido.') }))
    .max(100, 'Até 100 itens por pedido.'),
});

async function gravarItensPedido(c: Cliente, empresaId: string, pedidoId: string, itens: (ItemResolvido & { precoUnitario: number; cotacaoItemId?: string | null })[], freteCentavos: number) {
  await c.query('DELETE FROM pedidos_itens WHERE pedido_id = $1', [pedidoId]);
  let total = 0;
  for (const i of itens) {
    const pu = centPreco(i.precoUnitario);
    total += Math.round(pu * i.quantidade);
    await c.query(
      `INSERT INTO pedidos_itens (empresa_id, pedido_id, cotacao_item_id, insumo_id, catalogo_id, descricao, unidade, quantidade, preco_unitario_centavos)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [empresaId, pedidoId, i.cotacaoItemId ?? null, i.insumoId, i.catalogoId ?? null, i.descricao, i.unidade, i.quantidade, pu],
    );
  }
  total += freteCentavos;
  await c.query('UPDATE pedidos_compra SET total_centavos = $2, atualizado_em = now() WHERE id = $1', [pedidoId, total]);
  return total;
}

/** Último preço pago dos itens do catálogo, na aprovação do pedido. */
export async function atualizarUltimoPrecoPedido(c: Cliente, pedidoId: string) {
  await c.query(
    `UPDATE catalogo_itens ct SET ultimo_preco_centavos = pi.preco_unitario_centavos, ultimo_preco_em = p.data, ultimo_fornecedor_id = p.fornecedor_id, atualizado_em = now()
       FROM pedidos_itens pi JOIN pedidos_compra p ON p.id = pi.pedido_id
      WHERE pi.pedido_id = $1 AND ct.id = pi.catalogo_id AND (ct.ultimo_preco_em IS NULL OR ct.ultimo_preco_em <= p.data)`,
    [pedidoId],
  );
}

/** Situação do pedido pelo que já foi recebido. */
export async function atualizarStatusRecebimento(c: Cliente, pedidoId: string) {
  const p = (await c.query('SELECT status, enviado_fornecedor_em FROM pedidos_compra WHERE id = $1 FOR UPDATE', [pedidoId])).rows[0];
  if (!p || !['aprovado', 'enviado', 'parcial', 'recebido'].includes(p.status)) return;
  const itens = (await c.query('SELECT id, quantidade FROM pedidos_itens WHERE pedido_id = $1', [pedidoId])).rows;
  const rec = await recebidosDoPedido(c, pedidoId);
  const algum = [...rec.values()].some((r) => r.quantidade > 0);
  const tudo = itens.length > 0 && itens.every((i) => (rec.get(i.id)?.quantidade ?? 0) >= Number(i.quantidade) * 0.995);
  const novo = tudo ? 'recebido' : algum ? 'parcial' : p.enviado_fornecedor_em ? 'enviado' : 'aprovado';
  if (novo !== p.status) await c.query('UPDATE pedidos_compra SET status = $2, atualizado_em = now() WHERE id = $1', [pedidoId, novo]);
}

/** Pareia itens da nota com itens do pedido: mesmo insumo, senão descrição parecida. */
function sugerirPares(notaItens: { id: string; descricao: string; insumo_id: string | null; quantidade: number; fator: number | null; unidade: string | null }[], pedidoItens: { id: string; descricao: string; insumo_id: string | null; unidade: string }[]) {
  const palavras = (s: string) => new Set(normalizar(s).split(' ').filter((p) => p.length > 2));
  return notaItens.map((ni) => {
    let alvo = ni.insumo_id ? pedidoItens.find((pi) => pi.insumo_id === ni.insumo_id) : undefined;
    if (!alvo) {
      const a = palavras(ni.descricao);
      let melhor = 0;
      for (const pi of pedidoItens) {
        const b = palavras(pi.descricao);
        const comuns = [...a].filter((x) => b.has(x)).length;
        const nota = comuns / Math.max(1, Math.min(a.size, b.size));
        if (comuns && nota > melhor) {
          melhor = nota;
          alvo = pi;
        }
      }
      if (melhor < 0.5) alvo = undefined;
    }
    // Quantidade na unidade do pedido: a do estoque (nota × fator) quando o item é de insumo; senão a da nota.
    const qtd = alvo ? (ni.fator && alvo.insumo_id && ni.insumo_id === alvo.insumo_id ? r3(ni.quantidade * ni.fator) : r3(ni.quantidade)) : null;
    return { notaItemId: ni.id, pedidoItemId: alvo?.id ?? null, quantidade: qtd };
  });
}

// ---------------------------------------------------------------- rotas

export function rotasSuprimentos(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.addHook('preHandler', exigir(banco, 'dono', 'gestor'));

    // ----- Solicitações de compra
    app.get<{ Querystring: Record<string, string | undefined> }>('/solicitacoes', async (req) => {
      const empresaId = empresaDo(req);
      const status = STATUS_SOLICITACAO.includes(req.query.status as never) ? req.query.status! : null;
      const r = await banco.query(
        `SELECT s.id, s.numero, s.data, s.necessidade, s.origem, s.status, s.observacao, u.nome AS solicitante,
                (SELECT count(*)::int FROM solicitacoes_itens si WHERE si.solicitacao_id = s.id) AS itens,
                (SELECT string_agg(si.descricao, ', ' ORDER BY si.descricao) FROM solicitacoes_itens si WHERE si.solicitacao_id = s.id) AS resumo
           FROM solicitacoes_compra s LEFT JOIN usuarios u ON u.id = s.solicitante_id
          WHERE s.empresa_id = $1 AND ($2::text IS NULL OR s.status = $2)
            AND ($2::text IS NOT NULL OR s.status IN ('aberta', 'em_cotacao') OR s.data > current_date - 120)
          ORDER BY (s.status IN ('aberta', 'em_cotacao')) DESC, s.numero DESC LIMIT 500`,
        [empresaId, status],
      );
      const hoje = hojeBrasil();
      return {
        solicitacoes: r.rows.map((s) => ({
          id: s.id,
          numero: s.numero,
          data: s.data,
          necessidade: s.necessidade,
          origem: s.origem,
          status: s.status,
          observacao: s.observacao,
          solicitante: s.solicitante,
          itens: s.itens,
          resumo: s.resumo,
          diasAberta: ['aberta', 'em_cotacao'].includes(s.status) ? diasEntre(s.data, hoje) : null,
          urgente: ['aberta', 'em_cotacao'].includes(s.status) && !!s.necessidade && s.necessidade <= somarDias(hoje, 3),
        })),
      };
    });

    app.get('/solicitacoes/estoque-minimo', async (req) => ({ insumos: await sugestaoEstoque(banco, empresaDo(req)) }));

    app.get<{ Params: { id: string } }>('/solicitacoes/:id', async (req) => ({ solicitacao: await detalharSolicitacao(banco, empresaDo(req), req.params.id) }));

    app.post('/solicitacoes', async (req, reply) => {
      const d = esquemaSolicitacao.parse(req.body);
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      const id = await emTransacao(banco, async (c) => {
        await validarCentro(c, empresaId, d.centroCustoId);
        const itens = await resolverItens(c, empresaId, d.itens);
        const numero = await proximoNumero(c, 'solicitacoes_compra', empresaId);
        const s = (
          await c.query(
            `INSERT INTO solicitacoes_compra (empresa_id, numero, data, necessidade, origem, centro_custo_id, observacao, solicitante_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [empresaId, numero, d.data ?? hojeBrasil(), d.necessidade, d.origem, d.centroCustoId, d.observacao, u.id],
          )
        ).rows[0];
        await gravarItensSolicitacao(c, empresaId, s.id, itens);
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'criar', entidade: 'solicitacoes_compra', entidadeId: s.id, depois: { numero, itens: itens.length } });
        return s.id as string;
      });
      reply.code(201);
      return { solicitacao: await detalharSolicitacao(banco, empresaId, id) };
    });

    app.put<{ Params: { id: string } }>('/solicitacoes/:id', async (req) => {
      const d = esquemaSolicitacao.parse(req.body);
      const empresaId = empresaDo(req);
      const atual = await detalharSolicitacao(banco, empresaId, req.params.id);
      if (atual.status !== 'aberta') throw new ErroHttp(409, 'Só dá para alterar solicitação aberta (sem cotação).');
      await emTransacao(banco, async (c) => {
        await validarCentro(c, empresaId, d.centroCustoId);
        const itens = await resolverItens(c, empresaId, d.itens);
        await c.query(
          'UPDATE solicitacoes_compra SET data = coalesce($2, data), necessidade = $3, centro_custo_id = $4, observacao = $5, atualizado_em = now() WHERE id = $1',
          [atual.id, d.data, d.necessidade, d.centroCustoId, d.observacao],
        );
        await gravarItensSolicitacao(c, empresaId, atual.id, itens);
        await auditar(c, { empresaId, usuarioId: usuarioDe(req).id, acao: 'alterar', entidade: 'solicitacoes_compra', entidadeId: atual.id, antes: { itens: atual.itens.length }, depois: { itens: itens.length } });
      });
      return { solicitacao: await detalharSolicitacao(banco, empresaId, atual.id) };
    });

    app.post<{ Params: { id: string } }>('/solicitacoes/:id/cancelar', async (req) => {
      const empresaId = empresaDo(req);
      const atual = await detalharSolicitacao(banco, empresaId, req.params.id);
      if (!['aberta', 'em_cotacao'].includes(atual.status)) throw new ErroHttp(409, 'Esta solicitação já foi atendida ou cancelada.');
      if (atual.cotacoes.some((c: { status: string }) => c.status === 'aberta')) throw new ErroHttp(409, 'Cancele antes a cotação aberta desta solicitação.');
      await emTransacao(banco, async (c) => {
        await c.query("UPDATE solicitacoes_compra SET status = 'cancelada', atualizado_em = now() WHERE id = $1", [atual.id]);
        await auditar(c, { empresaId, usuarioId: usuarioDe(req).id, acao: 'alterar', entidade: 'solicitacoes_compra', entidadeId: atual.id, depois: { status: 'cancelada' } });
      });
      return { solicitacao: await detalharSolicitacao(banco, empresaId, atual.id) };
    });

    // ----- Cotações
    app.get<{ Querystring: Record<string, string | undefined> }>('/cotacoes', async (req) => {
      const empresaId = empresaDo(req);
      const status = ['aberta', 'concluida', 'cancelada'].includes(req.query.status ?? '') ? req.query.status! : null;
      const r = await banco.query(
        `SELECT ct.id, ct.numero, ct.data, ct.prazo_resposta, ct.status, s.numero AS solicitacao_numero,
                (SELECT count(*)::int FROM cotacoes_itens ci WHERE ci.cotacao_id = ct.id) AS itens,
                (SELECT count(*)::int FROM cotacoes_fornecedores cf WHERE cf.cotacao_id = ct.id) AS fornecedores,
                (SELECT count(DISTINCT cp.cotacao_fornecedor_id)::int FROM cotacoes_precos cp JOIN cotacoes_itens ci ON ci.id = cp.cotacao_item_id WHERE ci.cotacao_id = ct.id) AS respostas,
                (SELECT string_agg(ci.descricao, ', ' ORDER BY ci.descricao) FROM cotacoes_itens ci WHERE ci.cotacao_id = ct.id) AS resumo,
                (SELECT count(*)::int FROM pedidos_compra p WHERE p.cotacao_id = ct.id) AS pedidos
           FROM cotacoes ct LEFT JOIN solicitacoes_compra s ON s.id = ct.solicitacao_id
          WHERE ct.empresa_id = $1 AND ($2::text IS NULL OR ct.status = $2)
            AND ($2::text IS NOT NULL OR ct.status = 'aberta' OR ct.data > current_date - 120)
          ORDER BY (ct.status = 'aberta') DESC, ct.numero DESC LIMIT 500`,
        [empresaId, status],
      );
      return {
        cotacoes: r.rows.map((x) => ({
          id: x.id,
          numero: x.numero,
          data: x.data,
          prazoResposta: x.prazo_resposta,
          status: x.status,
          solicitacaoNumero: x.solicitacao_numero,
          itens: x.itens,
          fornecedores: x.fornecedores,
          respostas: x.respostas,
          resumo: x.resumo,
          pedidos: x.pedidos,
        })),
      };
    });

    app.get<{ Params: { id: string } }>('/cotacoes/:id', async (req) => ({ cotacao: await detalharCotacao(banco, empresaDo(req), req.params.id) }));

    app.post('/cotacoes', async (req, reply) => {
      const d = z
        .object({
          solicitacaoId: uuidOpc,
          data: dataOpc,
          prazoResposta: dataOpc,
          observacao: texto(500),
          fornecedorIds: z.array(z.string().regex(UUID)).max(10, 'Até 10 fornecedores por cotação.').default([]),
          itens: z.array(esquemaItem).max(100).optional().default([]),
        })
        .parse(req.body);
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      const id = await emTransacao(banco, async (c) => {
        let itens: (ItemResolvido & { solicitacaoItemId: string | null })[];
        if (d.solicitacaoId) {
          const s = (await c.query('SELECT status FROM solicitacoes_compra WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [d.solicitacaoId, empresaId])).rows[0];
          if (!s) throw new ErroHttp(400, 'Solicitação não encontrada.');
          if (!['aberta', 'em_cotacao'].includes(s.status)) throw new ErroHttp(409, 'Esta solicitação já foi atendida ou cancelada.');
          const r = await c.query('SELECT * FROM solicitacoes_itens WHERE solicitacao_id = $1', [d.solicitacaoId]);
          itens = r.rows.map((x) => ({ insumoId: x.insumo_id, catalogoId: x.catalogo_id, descricao: x.descricao, unidade: x.unidade, quantidade: Number(x.quantidade), observacao: x.observacao, solicitacaoItemId: x.id }));
          await c.query("UPDATE solicitacoes_compra SET status = 'em_cotacao', atualizado_em = now() WHERE id = $1", [d.solicitacaoId]);
        } else {
          itens = (await resolverItens(c, empresaId, d.itens)).map((i) => ({ ...i, solicitacaoItemId: null }));
        }
        if (!itens.length) throw new ErroHttp(400, 'A cotação precisa de pelo menos um item.');
        const numero = await proximoNumero(c, 'cotacoes', empresaId);
        const ct = (
          await c.query(
            'INSERT INTO cotacoes (empresa_id, numero, data, prazo_resposta, solicitacao_id, observacao, criado_por_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
            [empresaId, numero, d.data ?? hojeBrasil(), d.prazoResposta, d.solicitacaoId, d.observacao, u.id],
          )
        ).rows[0];
        for (const i of itens)
          await c.query(
            'INSERT INTO cotacoes_itens (empresa_id, cotacao_id, solicitacao_item_id, insumo_id, catalogo_id, descricao, unidade, quantidade) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
            [empresaId, ct.id, i.solicitacaoItemId, i.insumoId, i.catalogoId, i.descricao, i.unidade, i.quantidade],
          );
        for (const f of [...new Set(d.fornecedorIds)]) {
          await validarFornecedor(c, empresaId, f);
          await c.query('INSERT INTO cotacoes_fornecedores (empresa_id, cotacao_id, fornecedor_id) VALUES ($1, $2, $3)', [empresaId, ct.id, f]);
        }
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'criar', entidade: 'cotacoes', entidadeId: ct.id, depois: { numero, itens: itens.length, fornecedores: d.fornecedorIds.length } });
        return ct.id as string;
      });
      reply.code(201);
      return { cotacao: await detalharCotacao(banco, empresaId, id) };
    });

    const cotacaoAberta = async (c: Cliente, empresaId: string, id: string) => {
      if (!UUID.test(id)) throw naoEncontrado('Cotação');
      const ct = (await c.query('SELECT id, status FROM cotacoes WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [id, empresaId])).rows[0];
      if (!ct) throw naoEncontrado('Cotação');
      if (ct.status !== 'aberta') throw new ErroHttp(409, 'Esta cotação já foi concluída ou cancelada.');
    };

    app.put<{ Params: { id: string } }>('/cotacoes/:id/fornecedores', async (req) => {
      const d = z.object({ fornecedorIds: z.array(z.string().regex(UUID)).max(10, 'Até 10 fornecedores por cotação.') }).parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        await cotacaoAberta(c, empresaId, req.params.id);
        const ids = [...new Set(d.fornecedorIds)];
        for (const f of ids) await validarFornecedor(c, empresaId, f);
        await c.query('DELETE FROM cotacoes_fornecedores WHERE cotacao_id = $1 AND NOT (fornecedor_id = ANY($2::uuid[]))', [req.params.id, ids]);
        for (const f of ids)
          await c.query('INSERT INTO cotacoes_fornecedores (empresa_id, cotacao_id, fornecedor_id) VALUES ($1, $2, $3) ON CONFLICT (cotacao_id, fornecedor_id) DO NOTHING', [empresaId, req.params.id, f]);
        await auditar(c, { empresaId, usuarioId: usuarioDe(req).id, acao: 'alterar', entidade: 'cotacoes', entidadeId: req.params.id, depois: { fornecedores: ids.length } });
      });
      return { cotacao: await detalharCotacao(banco, empresaId, req.params.id) };
    });

    app.put<{ Params: { id: string; cf: string } }>('/cotacoes/:id/respostas/:cf', async (req) => {
      const d = z
        .object({
          prazoEntregaDias: z.union([z.number().int().min(0).max(365), z.null()]).optional().default(null),
          condicaoPagamento: texto(120),
          frete: naoNegativo('Frete inválido.').optional().default(0),
          validade: dataOpc,
          observacao: texto(300),
          precos: z.array(z.object({ itemId: z.string().regex(UUID), precoUnitario: z.union([naoNegativo('Preço inválido.'), z.null()]) })).max(100),
        })
        .parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        await cotacaoAberta(c, empresaId, req.params.id);
        if (!UUID.test(req.params.cf) || !(await c.query('SELECT 1 FROM cotacoes_fornecedores WHERE id = $1 AND cotacao_id = $2', [req.params.cf, req.params.id])).rowCount)
          throw naoEncontrado('Fornecedor da cotação');
        await c.query(
          'UPDATE cotacoes_fornecedores SET prazo_entrega_dias = $2, condicao_pagamento = $3, frete_centavos = $4, validade = $5, observacao = $6 WHERE id = $1',
          [req.params.cf, d.prazoEntregaDias, d.condicaoPagamento, cent(d.frete), d.validade, d.observacao],
        );
        const itensValidos = new Set((await c.query('SELECT id FROM cotacoes_itens WHERE cotacao_id = $1', [req.params.id])).rows.map((x) => x.id as string));
        for (const p of d.precos) {
          if (!itensValidos.has(p.itemId)) throw new ErroHttp(400, 'Item não pertence a esta cotação.');
          if (p.precoUnitario === null) {
            await c.query('DELETE FROM cotacoes_precos WHERE cotacao_fornecedor_id = $1 AND cotacao_item_id = $2', [req.params.cf, p.itemId]);
            // Se este fornecedor era o escolhido para o item, a escolha deixa de valer.
            await c.query('UPDATE cotacoes_itens SET vencedor_id = NULL, justificativa = NULL WHERE id = $1 AND vencedor_id = $2', [p.itemId, req.params.cf]);
          } else
            await c.query(
              `INSERT INTO cotacoes_precos (empresa_id, cotacao_fornecedor_id, cotacao_item_id, preco_unitario_centavos) VALUES ($1, $2, $3, $4)
               ON CONFLICT (cotacao_fornecedor_id, cotacao_item_id) DO UPDATE SET preco_unitario_centavos = EXCLUDED.preco_unitario_centavos`,
              [empresaId, req.params.cf, p.itemId, centPreco(p.precoUnitario)],
            );
        }
        await auditar(c, { empresaId, usuarioId: usuarioDe(req).id, acao: 'alterar', entidade: 'cotacoes_fornecedores', entidadeId: req.params.cf, depois: { precos: d.precos.filter((p) => p.precoUnitario !== null).length } });
      });
      return { cotacao: await detalharCotacao(banco, empresaId, req.params.id) };
    });

    // Escolha do vencedor de cada item. Sem `vencedorId` em nenhum item = aplicar o menor preço em todos.
    app.put<{ Params: { id: string } }>('/cotacoes/:id/vencedores', async (req) => {
      const d = z
        .object({
          menorPreco: z.boolean().optional().default(false),
          itens: z.array(z.object({ itemId: z.string().regex(UUID), vencedorId: z.union([z.string().regex(UUID), z.null()]), justificativa: texto(300) })).max(100).default([]),
          justificativa: texto(1000),
        })
        .parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        await cotacaoAberta(c, empresaId, req.params.id);
        const mapa = await detalharCotacao(c, empresaId, req.params.id);
        const escolhas = d.menorPreco ? mapa.itens.map((i) => ({ itemId: i.id, vencedorId: i.menorPrecoId, justificativa: null })) : d.itens;
        for (const e of escolhas) {
          const item = mapa.itens.find((i) => i.id === e.itemId);
          if (!item) throw new ErroHttp(400, 'Item não pertence a esta cotação.');
          if (e.vencedorId) {
            const oferta = item.ofertas.find((o) => o.cotacaoFornecedorId === e.vencedorId);
            if (!oferta) throw new ErroHttp(400, `${item.descricao}: este fornecedor não cotou o item.`);
            const menor = item.ofertas.find((o) => o.cotacaoFornecedorId === item.menorPrecoId)!;
            if (oferta.precoUnitario > menor.precoUnitario && !e.justificativa)
              throw new ErroHttp(400, `${item.descricao}: escreva a justificativa para não comprar pelo menor preço.`);
          }
          await c.query('UPDATE cotacoes_itens SET vencedor_id = $2, justificativa = $3 WHERE id = $1', [e.itemId, e.vencedorId, e.vencedorId ? e.justificativa : null]);
        }
        await c.query('UPDATE cotacoes SET justificativa = coalesce($2, justificativa), atualizado_em = now() WHERE id = $1', [req.params.id, d.justificativa]);
        await auditar(c, { empresaId, usuarioId: usuarioDe(req).id, acao: 'alterar', entidade: 'cotacoes', entidadeId: req.params.id, depois: { vencedores: escolhas.filter((e) => e.vencedorId).length, menorPreco: d.menorPreco } });
      });
      return { cotacao: await detalharCotacao(banco, empresaId, req.params.id) };
    });

    // Conclui o mapa: um pedido (rascunho) para cada fornecedor vencedor.
    app.post<{ Params: { id: string } }>('/cotacoes/:id/concluir', async (req) => {
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      const pedidos = await emTransacao(banco, async (c) => {
        await cotacaoAberta(c, empresaId, req.params.id);
        const mapa = await detalharCotacao(c, empresaId, req.params.id);
        const escolhidos = mapa.itens.filter((i) => i.vencedorId);
        if (!escolhidos.length) throw new ErroHttp(400, 'Escolha o fornecedor de pelo menos um item (ou use "Aplicar menor preço").');
        const solicitacaoCentro = mapa.solicitacaoId
          ? (await c.query('SELECT centro_custo_id, necessidade FROM solicitacoes_compra WHERE id = $1', [mapa.solicitacaoId])).rows[0]
          : null;
        const criados: { id: string; numero: number }[] = [];
        for (const f of mapa.fornecedores.filter((x) => escolhidos.some((i) => i.vencedorId === x.id))) {
          const numero = await proximoNumero(c, 'pedidos_compra', empresaId);
          const hoje = hojeBrasil();
          const previsao = f.prazoEntregaDias !== null ? somarDias(hoje, f.prazoEntregaDias) : solicitacaoCentro?.necessidade ?? null;
          const p = (
            await c.query(
              `INSERT INTO pedidos_compra (empresa_id, numero, data, fornecedor_id, cotacao_id, solicitacao_id, previsao_entrega, condicao_pagamento, frete_centavos, centro_custo_id, criado_por_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
              [empresaId, numero, hoje, f.fornecedorId, mapa.id, mapa.solicitacaoId, previsao, f.condicaoPagamento, cent(f.frete), solicitacaoCentro?.centro_custo_id ?? null, u.id],
            )
          ).rows[0];
          const itens = escolhidos
            .filter((i) => i.vencedorId === f.id)
            .map((i) => ({
              insumoId: i.insumoId,
              catalogoId: i.catalogoId,
              descricao: i.descricao,
              unidade: i.unidade,
              quantidade: i.quantidade,
              observacao: null,
              precoUnitario: i.ofertas.find((o) => o.cotacaoFornecedorId === f.id)!.precoUnitario,
              cotacaoItemId: i.id,
            }));
          await gravarItensPedido(c, empresaId, p.id, itens, cent(f.frete));
          await auditar(c, { empresaId, usuarioId: u.id, acao: 'criar', entidade: 'pedidos_compra', entidadeId: p.id, depois: { numero, cotacao: mapa.numero } });
          criados.push({ id: p.id, numero });
        }
        await c.query("UPDATE cotacoes SET status = 'concluida', concluida_em = now(), atualizado_em = now() WHERE id = $1", [mapa.id]);
        if (mapa.solicitacaoId) await c.query("UPDATE solicitacoes_compra SET status = 'atendida', atualizado_em = now() WHERE id = $1", [mapa.solicitacaoId]);
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'confirmar', entidade: 'cotacoes', entidadeId: mapa.id, depois: { pedidos: criados.map((x) => x.numero), economia: mapa.resumo.economiaMaior } });
        return criados;
      });
      return { pedidos, cotacao: await detalharCotacao(banco, empresaId, req.params.id) };
    });

    app.post<{ Params: { id: string } }>('/cotacoes/:id/cancelar', async (req) => {
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        await cotacaoAberta(c, empresaId, req.params.id);
        const ct = (await c.query("UPDATE cotacoes SET status = 'cancelada', atualizado_em = now() WHERE id = $1 RETURNING solicitacao_id", [req.params.id])).rows[0];
        // A solicitação volta a ficar aberta se não houver outra cotação em andamento.
        if (ct.solicitacao_id)
          await c.query(
            `UPDATE solicitacoes_compra SET status = 'aberta', atualizado_em = now()
              WHERE id = $1 AND status = 'em_cotacao' AND NOT EXISTS (SELECT 1 FROM cotacoes WHERE solicitacao_id = $1 AND status = 'aberta')`,
            [ct.solicitacao_id],
          );
        await auditar(c, { empresaId, usuarioId: usuarioDe(req).id, acao: 'alterar', entidade: 'cotacoes', entidadeId: req.params.id, depois: { status: 'cancelada' } });
      });
      return { cotacao: await detalharCotacao(banco, empresaId, req.params.id) };
    });

    // ----- Pedidos de compra
    app.get<{ Querystring: Record<string, string | undefined> }>('/pedidos', async (req) => {
      const empresaId = empresaDo(req);
      const filtro = req.query.status ?? '';
      const hoje = hojeBrasil();
      const r = await banco.query(
        `SELECT p.id, p.numero, p.data, p.status, p.previsao_entrega, p.total_centavos, p.aprovacao_automatica,
                coalesce(f.nome_fantasia, f.razao_social) AS fornecedor, ct.numero AS cotacao_numero, ua.nome AS aprovado_por,
                (SELECT string_agg(pi.descricao, ', ' ORDER BY pi.descricao) FROM pedidos_itens pi WHERE pi.pedido_id = p.id) AS resumo,
                (SELECT count(*)::int FROM notas_fiscais n WHERE n.pedido_id = p.id AND n.excluido_em IS NULL AND n.status <> 'cancelada') AS notas
           FROM pedidos_compra p JOIN fornecedores f ON f.id = p.fornecedor_id
           LEFT JOIN cotacoes ct ON ct.id = p.cotacao_id LEFT JOIN usuarios ua ON ua.id = p.aprovado_por_id
          WHERE p.empresa_id = $1
            AND CASE $2
                  WHEN 'abertos' THEN p.status IN ('rascunho', 'aguardando_aprovacao', 'aprovado', 'enviado', 'parcial', 'reprovado')
                  WHEN 'aprovacao' THEN p.status = 'aguardando_aprovacao'
                  WHEN 'receber' THEN p.status IN ('aprovado', 'enviado', 'parcial')
                  WHEN 'atrasados' THEN p.status IN ('aprovado', 'enviado', 'parcial') AND p.previsao_entrega < $3::date
                  WHEN 'concluidos' THEN p.status IN ('recebido', 'encerrado')
                  WHEN 'cancelados' THEN p.status IN ('cancelado', 'reprovado')
                  ELSE p.status NOT IN ('cancelado') AND (p.status NOT IN ('recebido', 'encerrado') OR p.data > $3::date - 180)
                END
          ORDER BY array_position(ARRAY['aguardando_aprovacao','reprovado','rascunho','aprovado','enviado','parcial','recebido','encerrado','cancelado'], p.status), p.numero DESC
          LIMIT 500`,
        [empresaId, filtro, hoje],
      );
      return {
        pedidos: r.rows.map((p) => {
          const atrasado = PEDIDO_A_RECEBER.includes(p.status) && p.previsao_entrega && p.previsao_entrega < hoje;
          return {
            id: p.id,
            numero: p.numero,
            data: p.data,
            status: p.status,
            previsaoEntrega: p.previsao_entrega,
            atrasado: !!atrasado,
            diasAtraso: atrasado ? diasEntre(p.previsao_entrega, hoje) : 0,
            total: reais(p.total_centavos),
            fornecedor: p.fornecedor,
            cotacaoNumero: p.cotacao_numero,
            aprovadoPor: p.aprovado_por,
            aprovacaoAutomatica: p.aprovacao_automatica,
            resumo: p.resumo,
            notas: p.notas,
          };
        }),
      };
    });

    app.get<{ Params: { id: string } }>('/pedidos/:id', async (req) => ({ pedido: await detalharPedido(banco, empresaDo(req), req.params.id, usuarioDe(req)) }));

    app.post('/pedidos', async (req, reply) => {
      const d = esquemaPedido.parse(req.body);
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      const id = await emTransacao(banco, async (c) => {
        await validarFornecedor(c, empresaId, d.fornecedorId);
        await validarCentro(c, empresaId, d.centroCustoId);
        if (d.solicitacaoId && !(await c.query('SELECT 1 FROM solicitacoes_compra WHERE id = $1 AND empresa_id = $2', [d.solicitacaoId, empresaId])).rowCount)
          throw new ErroHttp(400, 'Solicitação não encontrada.');
        const base = await resolverItens(c, empresaId, d.itens);
        const numero = await proximoNumero(c, 'pedidos_compra', empresaId);
        const p = (
          await c.query(
            `INSERT INTO pedidos_compra (empresa_id, numero, data, fornecedor_id, solicitacao_id, previsao_entrega, condicao_pagamento, local_entrega, frete_centavos, centro_custo_id, observacao, criado_por_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
            [empresaId, numero, d.data ?? hojeBrasil(), d.fornecedorId, d.solicitacaoId, d.previsaoEntrega, d.condicaoPagamento, d.localEntrega, cent(d.frete), d.centroCustoId, d.observacao, u.id],
          )
        ).rows[0];
        await gravarItensPedido(c, empresaId, p.id, base.map((b, n) => ({ ...b, precoUnitario: d.itens[n].precoUnitario })), cent(d.frete));
        if (d.solicitacaoId) await c.query("UPDATE solicitacoes_compra SET status = 'atendida', atualizado_em = now() WHERE id = $1 AND status IN ('aberta', 'em_cotacao')", [d.solicitacaoId]);
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'criar', entidade: 'pedidos_compra', entidadeId: p.id, depois: { numero, itens: base.length } });
        return p.id as string;
      });
      reply.code(201);
      return { pedido: await detalharPedido(banco, empresaId, id, u) };
    });

    const pedidoPara = async (c: Cliente, empresaId: string, id: string) => {
      if (!UUID.test(id)) throw naoEncontrado('Pedido');
      const p = (await c.query('SELECT * FROM pedidos_compra WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [id, empresaId])).rows[0];
      if (!p) throw naoEncontrado('Pedido');
      return p as LinhaPedido;
    };

    app.put<{ Params: { id: string } }>('/pedidos/:id', async (req) => {
      const d = esquemaPedido.parse(req.body);
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      await emTransacao(banco, async (c) => {
        const p = await pedidoPara(c, empresaId, req.params.id);
        if (!['rascunho', 'reprovado'].includes(p.status)) throw new ErroHttp(409, 'Só dá para alterar pedido em rascunho ou reprovado. Depois de aprovado, cancele e faça outro.');
        await validarFornecedor(c, empresaId, d.fornecedorId);
        await validarCentro(c, empresaId, d.centroCustoId);
        const base = await resolverItens(c, empresaId, d.itens);
        // Mantém o vínculo com a cotação dos itens que continuam iguais.
        const antigos = (await c.query('SELECT insumo_id, descricao, cotacao_item_id FROM pedidos_itens WHERE pedido_id = $1', [p.id])).rows;
        await c.query(
          `UPDATE pedidos_compra SET fornecedor_id = $2, data = coalesce($3, data), previsao_entrega = $4, condicao_pagamento = $5, local_entrega = $6,
                  frete_centavos = $7, centro_custo_id = $8, observacao = $9, status = 'rascunho', motivo_reprovacao = NULL, atualizado_em = now() WHERE id = $1`,
          [p.id, d.fornecedorId, d.data, d.previsaoEntrega, d.condicaoPagamento, d.localEntrega, cent(d.frete), d.centroCustoId, d.observacao],
        );
        await gravarItensPedido(
          c,
          empresaId,
          p.id,
          base.map((b, n) => ({
            ...b,
            precoUnitario: d.itens[n].precoUnitario,
            cotacaoItemId: antigos.find((a) => (a.insumo_id && a.insumo_id === b.insumoId) || a.descricao === b.descricao)?.cotacao_item_id ?? null,
          })),
          cent(d.frete),
        );
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'alterar', entidade: 'pedidos_compra', entidadeId: p.id, antes: { status: p.status, total: reais(p.total_centavos) } });
      });
      return { pedido: await detalharPedido(banco, empresaId, req.params.id, u) };
    });

    app.post<{ Params: { id: string } }>('/pedidos/:id/enviar-aprovacao', async (req) => {
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      await emTransacao(banco, async (c) => {
        const p = await pedidoPara(c, empresaId, req.params.id);
        if (!['rascunho', 'reprovado'].includes(p.status)) throw new ErroHttp(409, 'Este pedido já foi enviado para aprovação.');
        const itens = (await c.query('SELECT count(*)::int AS n FROM pedidos_itens WHERE pedido_id = $1', [p.id])).rows[0].n;
        if (!itens) throw new ErroHttp(400, 'O pedido não tem itens.');
        const regras = await lerRegras(c, empresaId);
        const valor = Number(p.total_centavos);
        if (dispensaAprovacao(valor, regras)) {
          await c.query(
            "UPDATE pedidos_compra SET status = 'aprovado', enviado_aprovacao_em = now(), aprovado_em = now(), aprovado_por_id = NULL, aprovacao_automatica = true, motivo_reprovacao = NULL, atualizado_em = now() WHERE id = $1",
            [p.id],
          );
          await atualizarUltimoPrecoPedido(c, p.id);
        } else {
          // Sempre passa pela fila de aprovações (inclusive quando quem envia é o próprio aprovador).
          await c.query("UPDATE pedidos_compra SET status = 'aguardando_aprovacao', enviado_aprovacao_em = now(), motivo_reprovacao = NULL, atualizado_em = now() WHERE id = $1", [p.id]);
        }
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'alterar', entidade: 'pedidos_compra', entidadeId: p.id, depois: { acao: 'enviar para aprovação', valor: reais(valor) } });
      });
      return { pedido: await detalharPedido(banco, empresaId, req.params.id, u) };
    });

    app.post<{ Params: { id: string } }>('/pedidos/:id/aprovar', async (req) => {
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      await emTransacao(banco, async (c) => {
        const p = await pedidoPara(c, empresaId, req.params.id);
        if (p.status !== 'aguardando_aprovacao') throw new ErroHttp(409, 'Este pedido não está aguardando aprovação.');
        if (!podeAprovar(u, Number(p.total_centavos), await lerRegras(c, empresaId))) throw new ErroHttp(403, 'Você não tem alçada para aprovar este valor.');
        await c.query("UPDATE pedidos_compra SET status = 'aprovado', aprovado_em = now(), aprovado_por_id = $2, aprovacao_automatica = false, atualizado_em = now() WHERE id = $1", [p.id, u.id]);
        await atualizarUltimoPrecoPedido(c, p.id);
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'confirmar', entidade: 'pedidos_compra', entidadeId: p.id, depois: { acao: 'aprovar', valor: reais(p.total_centavos) } });
      });
      return { pedido: await detalharPedido(banco, empresaId, req.params.id, u) };
    });

    app.post<{ Params: { id: string } }>('/pedidos/:id/reprovar', async (req) => {
      const d = z.object({ motivo: z.string().trim().min(3, 'Escreva o motivo da reprovação.').max(500) }).parse(req.body);
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      await emTransacao(banco, async (c) => {
        const p = await pedidoPara(c, empresaId, req.params.id);
        if (p.status !== 'aguardando_aprovacao') throw new ErroHttp(409, 'Este pedido não está aguardando aprovação.');
        if (!podeAprovar(u, Number(p.total_centavos), await lerRegras(c, empresaId))) throw new ErroHttp(403, 'Você não tem alçada para reprovar este valor.');
        await c.query("UPDATE pedidos_compra SET status = 'reprovado', motivo_reprovacao = $2, aprovado_por_id = $3, aprovado_em = now(), atualizado_em = now() WHERE id = $1", [p.id, d.motivo, u.id]);
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'alterar', entidade: 'pedidos_compra', entidadeId: p.id, depois: { acao: 'reprovar', motivo: d.motivo } });
      });
      return { pedido: await detalharPedido(banco, empresaId, req.params.id, u) };
    });

    app.post<{ Params: { id: string } }>('/pedidos/:id/enviado', async (req) => {
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      await emTransacao(banco, async (c) => {
        const p = await pedidoPara(c, empresaId, req.params.id);
        if (p.status !== 'aprovado') throw new ErroHttp(409, 'Só pedido aprovado é enviado ao fornecedor.');
        await c.query("UPDATE pedidos_compra SET status = 'enviado', enviado_fornecedor_em = now(), atualizado_em = now() WHERE id = $1", [p.id]);
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'alterar', entidade: 'pedidos_compra', entidadeId: p.id, depois: { status: 'enviado' } });
      });
      return { pedido: await detalharPedido(banco, empresaId, req.params.id, u) };
    });

    app.post<{ Params: { id: string } }>('/pedidos/:id/cancelar', async (req) => {
      const d = z.object({ motivo: texto(500) }).parse(req.body ?? {});
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      await emTransacao(banco, async (c) => {
        const p = await pedidoPara(c, empresaId, req.params.id);
        if (['recebido', 'encerrado', 'cancelado', 'parcial'].includes(p.status)) throw new ErroHttp(409, p.status === 'parcial' ? 'Pedido com entrega parcial: use "Encerrar com saldo".' : 'Este pedido já foi concluído ou cancelado.');
        if ((await c.query("SELECT 1 FROM notas_fiscais WHERE pedido_id = $1 AND excluido_em IS NULL AND status <> 'cancelada'", [p.id])).rowCount)
          throw new ErroHttp(409, 'Há nota ligada a este pedido. Desfaça o recebimento antes.');
        await c.query("UPDATE pedidos_compra SET status = 'cancelado', encerrado_motivo = $2, atualizado_em = now() WHERE id = $1", [p.id, d.motivo]);
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'alterar', entidade: 'pedidos_compra', entidadeId: p.id, antes: { status: p.status }, depois: { status: 'cancelado', motivo: d.motivo } });
      });
      return { pedido: await detalharPedido(banco, empresaId, req.params.id, u) };
    });

    app.post<{ Params: { id: string } }>('/pedidos/:id/encerrar', async (req) => {
      const d = z.object({ motivo: z.string().trim().min(3, 'Escreva por que o saldo não será entregue.').max(500) }).parse(req.body);
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      await emTransacao(banco, async (c) => {
        const p = await pedidoPara(c, empresaId, req.params.id);
        if (!PEDIDO_A_RECEBER.includes(p.status)) throw new ErroHttp(409, 'Só pedido aprovado e ainda não recebido pode ser encerrado.');
        await c.query("UPDATE pedidos_compra SET status = 'encerrado', encerrado_motivo = $2, atualizado_em = now() WHERE id = $1", [p.id, d.motivo]);
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'alterar', entidade: 'pedidos_compra', entidadeId: p.id, antes: { status: p.status }, depois: { status: 'encerrado', motivo: d.motivo } });
      });
      return { pedido: await detalharPedido(banco, empresaId, req.params.id, u) };
    });

    // ----- Recebimento pela nota fiscal
    app.get<{ Params: { id: string } }>('/pedidos/:id/notas-candidatas', async (req) => {
      const empresaId = empresaDo(req);
      const pedido = await detalharPedido(banco, empresaId, req.params.id);
      const notas = (
        await banco.query(
          `SELECT n.id, n.numero, n.serie, n.modelo, n.data_emissao, n.total_centavos, n.status, n.pedido_id
             FROM notas_fiscais n
            WHERE n.empresa_id = $1 AND n.fornecedor_id = $2 AND n.direcao = 'entrada' AND n.excluido_em IS NULL AND n.status <> 'cancelada'
              AND (n.pedido_id IS NULL OR n.pedido_id = $3) AND n.data_emissao >= $4::date - 30
            ORDER BY n.data_emissao DESC LIMIT 30`,
          [empresaId, pedido.fornecedorId, pedido.id, pedido.data],
        )
      ).rows;
      const pedidoItens = pedido.itens.map((i) => ({ id: i.id, descricao: i.descricao, insumo_id: i.insumoId, unidade: i.unidade }));
      const saida = [];
      for (const n of notas) {
        const itens = (
          await banco.query(
            'SELECT id, numero_item, descricao, unidade, quantidade, valor_produto_centavos, insumo_id, fator_estoque, pedido_item_id, quantidade_pedido FROM notas_itens WHERE nota_id = $1 ORDER BY numero_item',
            [n.id],
          )
        ).rows;
        const sugestao = sugerirPares(
          itens.map((i) => ({ id: i.id, descricao: i.descricao, insumo_id: i.insumo_id, quantidade: Number(i.quantidade), fator: num(i.fator_estoque), unidade: i.unidade })),
          pedidoItens,
        );
        saida.push({
          id: n.id,
          numero: n.numero,
          serie: n.serie,
          modelo: n.modelo,
          dataEmissao: n.data_emissao,
          total: reais(n.total_centavos),
          status: n.status,
          ligada: n.pedido_id === pedido.id,
          itens: itens.map((i, k) => ({
            id: i.id,
            numeroItem: i.numero_item,
            descricao: i.descricao,
            unidade: i.unidade,
            quantidade: Number(i.quantidade),
            valor: reais(i.valor_produto_centavos),
            pedidoItemId: n.pedido_id === pedido.id ? i.pedido_item_id : sugestao[k].pedidoItemId,
            quantidadePedido: n.pedido_id === pedido.id ? num(i.quantidade_pedido) : sugestao[k].quantidade,
          })),
        });
      }
      return { notas: saida };
    });

    app.put<{ Params: { id: string } }>('/pedidos/:id/recebimento', async (req) => {
      const d = z
        .object({
          notaId: z.string().regex(UUID),
          itens: z.array(z.object({ notaItemId: z.string().regex(UUID), pedidoItemId: z.union([z.string().regex(UUID), z.null()]), quantidade: z.union([positivo('Quantidade inválida.'), z.null()]) })).max(300),
        })
        .parse(req.body);
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      await emTransacao(banco, async (c) => {
        const p = await pedidoPara(c, empresaId, req.params.id);
        if (!['aprovado', 'enviado', 'parcial', 'recebido'].includes(p.status)) throw new ErroHttp(409, 'O pedido precisa estar aprovado para receber.');
        const n = (await c.query("SELECT id, fornecedor_id, pedido_id, direcao, status FROM notas_fiscais WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL FOR UPDATE", [d.notaId, empresaId])).rows[0];
        if (!n || n.direcao !== 'entrada' || n.status === 'cancelada') throw new ErroHttp(400, 'Nota não encontrada.');
        if (n.fornecedor_id !== p.fornecedor_id) throw new ErroHttp(400, 'A nota é de outro fornecedor.');
        if (n.pedido_id && n.pedido_id !== p.id) throw new ErroHttp(409, 'Esta nota já está ligada a outro pedido.');
        const itensPedido = new Set((await c.query('SELECT id FROM pedidos_itens WHERE pedido_id = $1', [p.id])).rows.map((x) => x.id as string));
        const itensNota = new Set((await c.query('SELECT id FROM notas_itens WHERE nota_id = $1', [n.id])).rows.map((x) => x.id as string));
        let ligados = 0;
        for (const i of d.itens) {
          if (!itensNota.has(i.notaItemId)) throw new ErroHttp(400, 'Item não pertence à nota.');
          if (i.pedidoItemId && !itensPedido.has(i.pedidoItemId)) throw new ErroHttp(400, 'Item não pertence ao pedido.');
          if (i.pedidoItemId && i.quantidade === null) throw new ErroHttp(400, 'Informe a quantidade recebida na unidade do pedido.');
          await c.query('UPDATE notas_itens SET pedido_item_id = $2, quantidade_pedido = $3 WHERE id = $1', [i.notaItemId, i.pedidoItemId, i.pedidoItemId ? r3(i.quantidade!) : null]);
          // Item do catálogo com categoria: a nota (ainda sem categoria) herda para a conta a pagar.
          if (i.pedidoItemId)
            await c.query(
              `UPDATE notas_itens ni SET plano_conta_id = ct.plano_conta_id, centro_custo_id = coalesce(ni.centro_custo_id, p.centro_custo_id)
                 FROM pedidos_itens pi JOIN pedidos_compra p ON p.id = pi.pedido_id JOIN catalogo_itens ct ON ct.id = pi.catalogo_id
                WHERE ni.id = $1 AND pi.id = $2 AND ni.plano_conta_id IS NULL AND ct.plano_conta_id IS NOT NULL`,
              [i.notaItemId, i.pedidoItemId],
            );
          if (i.pedidoItemId) ligados++;
        }
        if (!ligados) throw new ErroHttp(400, 'Ligue pelo menos um item da nota a um item do pedido.');
        await c.query('UPDATE notas_fiscais SET pedido_id = $2, atualizado_em = now() WHERE id = $1', [n.id, p.id]);
        await atualizarStatusRecebimento(c, p.id);
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'alterar', entidade: 'pedidos_compra', entidadeId: p.id, depois: { recebimento: n.id, itens: ligados } });
      });
      return { pedido: await detalharPedido(banco, empresaId, req.params.id, u) };
    });

    app.delete<{ Params: { id: string; nota: string } }>('/pedidos/:id/recebimento/:nota', async (req) => {
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      await emTransacao(banco, async (c) => {
        const p = await pedidoPara(c, empresaId, req.params.id);
        if (['encerrado', 'cancelado'].includes(p.status)) throw new ErroHttp(409, 'Pedido encerrado ou cancelado.');
        if (!UUID.test(req.params.nota)) throw naoEncontrado('Nota');
        const r = await c.query('UPDATE notas_fiscais SET pedido_id = NULL, atualizado_em = now() WHERE id = $1 AND pedido_id = $2 RETURNING id', [req.params.nota, p.id]);
        if (!r.rowCount) throw naoEncontrado('Nota');
        await c.query('UPDATE notas_itens SET pedido_item_id = NULL, quantidade_pedido = NULL WHERE nota_id = $1', [req.params.nota]);
        await atualizarStatusRecebimento(c, p.id);
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'alterar', entidade: 'pedidos_compra', entidadeId: p.id, depois: { desfazerRecebimento: req.params.nota } });
      });
      return { pedido: await detalharPedido(banco, empresaId, req.params.id, u) };
    });

    // ----- Relatórios de compras
    app.get<{ Querystring: Record<string, string | undefined> }>('/relatorios', async (req) => {
      const empresaId = empresaDo(req);
      const { de, ate, hoje } = periodo(req.query);
      const VALIDOS = `p.status IN ('aprovado', 'enviado', 'parcial', 'recebido', 'encerrado')`;

      const porFornecedor = (
        await banco.query(
          `SELECT coalesce(f.nome_fantasia, f.razao_social) AS fornecedor, count(*)::int AS pedidos, sum(p.total_centavos) AS total,
                  count(*) FILTER (WHERE p.status IN ('recebido', 'encerrado'))::int AS concluidos,
                  count(*) FILTER (WHERE p.status IN ('aprovado', 'enviado', 'parcial') AND p.previsao_entrega < $4::date)::int AS atrasados
             FROM pedidos_compra p JOIN fornecedores f ON f.id = p.fornecedor_id
            WHERE p.empresa_id = $1 AND p.data BETWEEN $2 AND $3 AND ${VALIDOS}
            GROUP BY 1 ORDER BY sum(p.total_centavos) DESC`,
          [empresaId, de, ate, hoje],
        )
      ).rows.map((x) => ({ fornecedor: x.fornecedor, pedidos: x.pedidos, total: reais(x.total), concluidos: x.concluidos, atrasados: x.atrasados }));

      const porItem = (
        await banco.query(
          `SELECT pi.descricao, pi.unidade, max(ct.codigo) AS codigo, sum(pi.quantidade) AS quantidade, sum(pi.quantidade * pi.preco_unitario_centavos) AS valor,
                  min(pi.preco_unitario_centavos) AS menor, max(pi.preco_unitario_centavos) AS maior, count(DISTINCT p.fornecedor_id)::int AS fornecedores
             FROM pedidos_itens pi JOIN pedidos_compra p ON p.id = pi.pedido_id LEFT JOIN catalogo_itens ct ON ct.id = pi.catalogo_id
            WHERE p.empresa_id = $1 AND p.data BETWEEN $2 AND $3 AND ${VALIDOS}
            GROUP BY pi.descricao, pi.unidade ORDER BY sum(pi.quantidade * pi.preco_unitario_centavos) DESC`,
          [empresaId, de, ate],
        )
      ).rows.map((x) => {
        const q = Number(x.quantidade);
        return {
          descricao: x.descricao,
          codigo: x.codigo as string | null,
          unidade: x.unidade,
          quantidade: r3(q),
          valor: Math.round(Number(x.valor)) / 100,
          precoMedio: q > 0 ? Math.round((Number(x.valor) / q) * 100) / 10000 : null,
          menorPreco: preco(x.menor),
          maiorPreco: preco(x.maior),
          fornecedores: x.fornecedores,
        };
      });

      const abertos = (
        await banco.query(
          `SELECT p.id FROM pedidos_compra p WHERE p.empresa_id = $1 AND p.status IN ('aprovado', 'enviado', 'parcial') ORDER BY p.previsao_entrega NULLS LAST, p.numero`,
          [empresaId],
        )
      ).rows;
      const emAberto = [];
      for (const a of abertos) {
        const p = await detalharPedido(banco, empresaId, a.id);
        const saldo = p.itens.reduce((s, i) => s + (i.saldo / i.quantidade) * i.total, 0);
        emAberto.push({
          id: p.id,
          numero: p.numero,
          data: p.data,
          fornecedor: p.fornecedor.nome,
          status: p.status,
          previsaoEntrega: p.previsaoEntrega,
          diasAtraso: p.diasAtraso,
          total: p.total,
          saldo: Math.round(saldo * 100) / 100,
          itens: p.itens.filter((i) => i.saldo > 0).map((i) => `${i.descricao} (${i.saldo.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${i.unidade === 'm3' ? 'm³' : i.unidade})`).join(', '),
        });
      }

      const cot = (
        await banco.query(`SELECT id FROM cotacoes WHERE empresa_id = $1 AND status = 'concluida' AND data BETWEEN $2 AND $3 ORDER BY numero`, [empresaId, de, ate])
      ).rows;
      const economia = [];
      for (const x of cot) {
        const m = await detalharCotacao(banco, empresaId, x.id);
        economia.push({
          id: m.id,
          numero: m.numero,
          data: m.data,
          itens: m.resumo.itensComVencedor,
          fornecedores: m.fornecedores.length,
          total: m.resumo.totalEscolhido,
          economiaMaior: m.resumo.economiaMaior,
          economiaMedia: m.resumo.economiaMedia,
          foraDoMenor: m.resumo.itensForaDoMenor,
          justificativa: m.justificativa,
        });
      }

      const divergencias = (
        await banco.query(
          `SELECT p.numero, coalesce(f.nome_fantasia, f.razao_social) AS fornecedor, n.numero AS nota, n.data_emissao, pi.descricao, pi.unidade,
                  pi.quantidade AS qtd_pedido, pi.preco_unitario_centavos AS preco_pedido,
                  sum(ni.quantidade_pedido) AS qtd_nota, sum(ni.valor_produto_centavos) AS valor_nota
             FROM notas_itens ni JOIN notas_fiscais n ON n.id = ni.nota_id JOIN pedidos_itens pi ON pi.id = ni.pedido_item_id
             JOIN pedidos_compra p ON p.id = pi.pedido_id JOIN fornecedores f ON f.id = p.fornecedor_id
            WHERE p.empresa_id = $1 AND n.data_emissao BETWEEN $2 AND $3 AND n.excluido_em IS NULL AND n.status <> 'cancelada'
            GROUP BY p.numero, f.nome_fantasia, f.razao_social, n.numero, n.data_emissao, pi.id, pi.descricao, pi.unidade, pi.quantidade, pi.preco_unitario_centavos
            ORDER BY n.data_emissao DESC`,
          [empresaId, de, ate],
        )
      ).rows
        .map((x) => {
          const qn = Number(x.qtd_nota);
          const pn = qn > 0 ? Number(x.valor_nota) / qn : null;
          const pp = Number(x.preco_pedido);
          const dif = pn !== null && pp > 0 ? pn / pp - 1 : null;
          return {
            pedido: x.numero,
            fornecedor: x.fornecedor,
            nota: x.nota,
            data: x.data_emissao,
            descricao: x.descricao,
            unidade: x.unidade,
            quantidadePedido: Number(x.qtd_pedido),
            quantidadeNota: r3(qn),
            precoPedido: preco(pp),
            precoNota: pn === null ? null : preco(pn),
            diferencaPreco: dif === null ? null : Math.round(dif * 10000) / 10000,
            valorDiferenca: pn === null ? 0 : Math.round(((pn - pp) * qn)) / 100,
          };
        })
        .filter((x) => x.diferencaPreco !== null && Math.abs(x.diferencaPreco) > 0.005);

      const pendentes = (
        await banco.query(
          `SELECT s.numero, s.data, s.necessidade, s.status, s.origem, u.nome AS solicitante,
                  (SELECT json_agg(json_build_object('d', si.descricao, 'q', si.quantidade, 'u', si.unidade) ORDER BY si.descricao) FROM solicitacoes_itens si WHERE si.solicitacao_id = s.id) AS itens
             FROM solicitacoes_compra s LEFT JOIN usuarios u ON u.id = s.solicitante_id
            WHERE s.empresa_id = $1 AND s.status IN ('aberta', 'em_cotacao') ORDER BY s.necessidade NULLS LAST, s.numero`,
          [empresaId],
        )
      ).rows.map((x) => ({ numero: x.numero, data: x.data, necessidade: x.necessidade, status: x.status, origem: x.origem, solicitante: x.solicitante, itens: ((x.itens ?? []) as { d: string; q: number; u: string }[]).map((i) => `${i.d} (${Number(i.q).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${i.u === 'm3' ? 'm³' : i.u})`).join(', '), dias: diasEntre(x.data, hoje) }));

      const totalComprado = porFornecedor.reduce((s, f) => s + (f.total ?? 0), 0);
      return {
        de,
        ate,
        resumo: {
          pedidos: porFornecedor.reduce((s, f) => s + f.pedidos, 0),
          totalComprado: Math.round(totalComprado * 100) / 100,
          fornecedores: porFornecedor.length,
          emAberto: emAberto.length,
          saldoAReceber: Math.round(emAberto.reduce((s, p) => s + p.saldo, 0) * 100) / 100,
          atrasados: emAberto.filter((p) => p.diasAtraso > 0).length,
          economiaMaior: Math.round(economia.reduce((s, e) => s + e.economiaMaior, 0) * 100) / 100,
          economiaMedia: Math.round(economia.reduce((s, e) => s + e.economiaMedia, 0) * 100) / 100,
          cotacoes: economia.length,
          divergencias: divergencias.length,
          solicitacoesPendentes: pendentes.length,
        },
        porFornecedor,
        porItem,
        emAberto,
        economia,
        divergencias,
        pendentes,
      };
    });
  };
}

// ---------------------------------------------------------------- aprovações (módulo Gerencial)
// Fila única do que espera decisão: pedidos de compra, contratos, medições e autorizações de pagamento.
export function rotasAprovacoes(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.addHook('preHandler', exigir(banco, 'dono', 'gestor'));

    // ----- Aprovações pendentes e regras
    app.get('/aprovacoes', async (req) => {
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      const regras = await lerRegras(banco, empresaId);
      const r = await banco.query(
        `SELECT p.id, p.numero, p.data, p.total_centavos, p.enviado_aprovacao_em, coalesce(f.nome_fantasia, f.razao_social) AS fornecedor, uc.nome AS criado_por,
                (SELECT string_agg(pi.descricao, ', ' ORDER BY pi.descricao) FROM pedidos_itens pi WHERE pi.pedido_id = p.id) AS resumo
           FROM pedidos_compra p JOIN fornecedores f ON f.id = p.fornecedor_id LEFT JOIN usuarios uc ON uc.id = p.criado_por_id
          WHERE p.empresa_id = $1 AND p.status = 'aguardando_aprovacao' ORDER BY p.enviado_aprovacao_em`,
        [empresaId],
      );
      const meds = await banco.query(
        `SELECT m.id, m.numero, m.sequencia, m.valor_centavos, m.enviado_aprovacao_em, k.numero AS contrato, k.objeto, coalesce(f.nome_fantasia, f.razao_social) AS fornecedor, uc.nome AS criado_por
           FROM medicoes m JOIN contratos k ON k.id = m.contrato_id JOIN fornecedores f ON f.id = k.fornecedor_id LEFT JOIN usuarios uc ON uc.id = m.criado_por_id
          WHERE m.empresa_id = $1 AND m.status = 'aguardando_aprovacao' ORDER BY m.enviado_aprovacao_em`,
        [empresaId],
      );
      const auts = await banco.query(
        `SELECT a.id, a.numero, a.tipo, a.bruto_centavos, a.liquido_centavos, a.enviado_aprovacao_em, k.numero AS contrato, coalesce(f.nome_fantasia, f.razao_social) AS fornecedor,
                uc.nome AS criado_por, m.sequencia
           FROM autorizacoes_pagamento a JOIN contratos k ON k.id = a.contrato_id JOIN fornecedores f ON f.id = k.fornecedor_id
           LEFT JOIN usuarios uc ON uc.id = a.criado_por_id LEFT JOIN medicoes m ON m.id = a.medicao_id
          WHERE a.empresa_id = $1 AND a.status = 'aguardando_aprovacao' ORDER BY a.enviado_aprovacao_em`,
        [empresaId],
      );
      const itens: { tipo: 'pedido' | 'contrato' | 'medicao' | 'autorizacao'; id: string; numero: number; titulo: string; pessoa: string; resumo: string | null; valor: number; enviadoEm: string; criadoPor: string | null; link: string; podeAprovar: boolean }[] = r.rows.map((p) => ({
        tipo: 'pedido' as const,
        id: p.id as string,
        numero: p.numero as number,
        titulo: `Pedido de compra nº ${p.numero}`,
        pessoa: p.fornecedor as string,
        resumo: p.resumo as string | null,
        valor: reais(p.total_centavos)!,
        enviadoEm: p.enviado_aprovacao_em as string,
        criadoPor: p.criado_por as string | null,
        link: `/sup/pedidos/${p.id}`,
        podeAprovar: podeAprovar(u, Number(p.total_centavos), regras),
      }));
      for (const m of meds.rows)
        itens.push({
          tipo: 'medicao', id: m.id, numero: m.numero, titulo: `Medição ${m.sequencia} · contrato nº ${String(m.contrato).padStart(4, '0')}`, pessoa: m.fornecedor, resumo: m.objeto,
          valor: reais(m.valor_centavos)!, enviadoEm: m.enviado_aprovacao_em, criadoPor: m.criado_por, link: `/sup/medicoes/${m.id}`, podeAprovar: podeAprovar(u, Number(m.valor_centavos), regras),
        });
      for (const a of auts.rows)
        itens.push({
          tipo: 'autorizacao', id: a.id, numero: a.numero, titulo: `Autorização de pagamento nº ${String(a.numero).padStart(4, '0')}`, pessoa: a.fornecedor,
          resumo: a.tipo === 'caucao' ? `Liberação da caução · contrato nº ${String(a.contrato).padStart(4, '0')}` : `Medição ${a.sequencia} · contrato nº ${String(a.contrato).padStart(4, '0')} · líquido ${(Number(a.liquido_centavos) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
          valor: reais(a.bruto_centavos)!, enviadoEm: a.enviado_aprovacao_em, criadoPor: a.criado_por, link: `/sup/autorizacoes/${a.id}`, podeAprovar: podeAprovar(u, Number(a.bruto_centavos), regras),
        });
      const cts = await banco.query(
        `SELECT k.id, k.numero, k.objeto, k.tipo, k.valor_global_centavos, k.enviado_aprovacao_em, coalesce(f.nome_fantasia, f.razao_social) AS fornecedor, uc.nome AS criado_por,
                coalesce((SELECT sum(round(ci.quantidade * ci.preco_unitario_centavos)) FROM contratos_itens ci WHERE ci.contrato_id = k.id), 0) AS valor_itens
           FROM contratos k JOIN fornecedores f ON f.id = k.fornecedor_id LEFT JOIN usuarios uc ON uc.id = k.criado_por_id
          WHERE k.empresa_id = $1 AND k.status = 'aguardando_aprovacao' ORDER BY k.enviado_aprovacao_em`,
        [empresaId],
      );
      for (const k of cts.rows) {
        const valor = k.tipo === 'global' ? Number(k.valor_global_centavos) : Number(k.valor_itens);
        itens.push({
          tipo: 'contrato', id: k.id, numero: k.numero, titulo: `Contrato nº ${String(k.numero).padStart(4, '0')}`, pessoa: k.fornecedor, resumo: k.objeto,
          valor: reais(valor)!, enviadoEm: k.enviado_aprovacao_em, criadoPor: k.criado_por, link: `/sup/contratos/${k.id}`, podeAprovar: podeAprovar(u, valor, regras),
        });
      }
      itens.sort((x, y) => new Date(x.enviadoEm).getTime() - new Date(y.enviadoEm).getTime());
      return { itens, regras: { adminAte: reais(regras.adminAte), dispensaAte: reais(regras.dispensaAte), texto: textoRegras(regras) } };
    });

    app.get('/config', async (req) => {
      const regras = await lerRegras(banco, empresaDo(req));
      return { regras: { adminAte: reais(regras.adminAte), dispensaAte: reais(regras.dispensaAte), texto: textoRegras(regras) } };
    });

    app.put('/config', async (req) => {
      const u = usuarioDe(req);
      if (u.perfil !== 'dono') throw new ErroHttp(403, 'Só o dono muda as regras de aprovação.');
      const d = z
        .object({ adminAte: z.union([naoNegativo('Valor inválido.'), z.null()]), dispensaAte: z.union([naoNegativo('Valor inválido.'), z.null()]) })
        .parse(req.body);
      const empresaId = empresaDo(req);
      const regras: RegrasAprovacao = lerRegrasDe({ adminAte: d.adminAte === null ? null : cent(d.adminAte), dispensaAte: d.dispensaAte === null ? null : cent(d.dispensaAte) });
      await emTransacao(banco, async (c) => {
        await c.query('UPDATE empresas SET aprovacao = $2, atualizado_em = now() WHERE id = $1', [empresaId, JSON.stringify(regras)]);
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'alterar', entidade: 'empresas', entidadeId: empresaId, depois: { aprovacao: d } });
      });
      return { regras: { adminAte: reais(regras.adminAte), dispensaAte: reais(regras.dispensaAte), texto: textoRegras(regras) } };
    });

  };
}
