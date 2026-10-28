// Módulo Suprimentos · Compras: solicitações, cotações e mapa, pedidos de compra com aprovação e recebimento pela nota fiscal.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Banco, Cliente } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';
import { estoqueDaMovimentacao, proximoCodigoEstoque, saldoApropriacao, validarApropriacaoObra } from '../lib/estoque.ts';
import { chaveEtiqueta } from '../lib/etiquetas.ts';
import { diasEntre, hojeBrasil } from '../lib/frota.ts';
import { obrasPermitidas } from '../lib/obras-acesso.ts';
import { somarDias, somarMeses } from '../lib/financeiro.ts';
import { normalizar } from '../lib/sugestoes.ts';
import { fornecedorAtende } from '../lib/atuacao.ts';
import { dispensaAprovacao, lerRegras, lerRegrasDe, podeAprovar, proximoNumero, textoRegras, type RegrasAprovacao } from '../lib/aprovacao.ts';
import { empresaDo, exigir } from '../sessao.ts';
import { ErroIa, iaDisponivel } from '../lib/ia-nota.ts';
import { lerPropostaComIa } from '../lib/ia-cotacao.ts';

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

// ---------------------------------------------------------------- itens: necessidades de insumo da obra (apropriadas à EAP)
// Toda compra parte de uma necessidade pendente: insumo cadastrado na obra, apropriado a um nó da EAP.

// Item da solicitação: ou uma necessidade já apropriada (pendente), ou um insumo da planilha escolhido direto,
// apropriado a um nó da EAP no nível de apropriação da obra (a necessidade é criada junto com a solicitação).
const esquemaItemExistente = z.object({
  necessidadeId: z.string().regex(UUID, 'Escolha o insumo da obra.'),
  // Quantidade nova do item já apropriado, na unidade em que ele é pedido (de compra, quando houver).
  quantidade: z.number().positive('A quantidade precisa ser maior que zero.').optional(),
  observacao: texto(200),
});
const esquemaItemNovo = z.object({
  obraItemId: z.string().regex(UUID, 'Escolha o insumo da planilha.'),
  eapNoId: z.string().regex(UUID).nullable(),
  quantidade: z.number().positive('A quantidade precisa ser maior que zero.'),
  unidade: z.string().trim().max(20).optional().nullable(),
  dataNecessaria: dataOpc,
  observacao: texto(200),
});
const esquemaNecessidadeItem = z.union([esquemaItemExistente, esquemaItemNovo]);

/** Altera a quantidade de uma necessidade já apropriada (ainda pendente, liberada pela alteração da solicitação). */
async function ajustarQuantidadeNecessidade(c: Cliente, obraId: string, necessidadeId: string, quantidade: number, n: number) {
  const r = (
    await c.query(
      `SELECT n.status, n.unidade_compra, n.obra_item_id FROM obra_necessidades n WHERE n.id = $1 AND n.obra_id = $2 FOR UPDATE`,
      [necessidadeId, obraId],
    )
  ).rows[0];
  if (!r) throw new ErroHttp(400, `Item ${n + 1}: insumo não encontrado.`);
  if (r.status !== 'pendente') throw new ErroHttp(409, `Item ${n + 1}: o insumo já está em outra solicitação ou foi comprado; a quantidade não pode mudar.`);
  if (r.unidade_compra) {
    const u = (await c.query('SELECT fator FROM obra_insumo_unidades WHERE obra_item_id = $1 AND lower(unidade) = lower($2)', [r.obra_item_id, r.unidade_compra])).rows[0];
    if (!u) throw new ErroHttp(400, `Item ${n + 1}: "${r.unidade_compra}" não é mais unidade de compra deste insumo.`);
    const base = Math.round(quantidade * Number(u.fator) * 10000) / 10000;
    await c.query('UPDATE obra_necessidades SET quantidade = $2, quantidade_compra = $3, atualizado_em = now() WHERE id = $1', [necessidadeId, base, quantidade]);
  } else {
    await c.query('UPDATE obra_necessidades SET quantidade = $2, atualizado_em = now() WHERE id = $1', [necessidadeId, quantidade]);
  }
}

/** Cria as necessidades dos insumos escolhidos direto na planilha (status pendente; a solicitação as marca como solicitadas). */
async function criarNecessidadesDaSolicitacao(c: Cliente, obraId: string, itens: z.infer<typeof esquemaNecessidadeItem>[]): Promise<{ necessidadeId: string; observacao: string | null }[]> {
  const obra = (await c.query('SELECT nivel_apropriacao FROM obras WHERE id = $1', [obraId])).rows[0];
  const nivel = obra.nivel_apropriacao as string;
  const saida: { necessidadeId: string; observacao: string | null }[] = [];
  for (const [n, i] of itens.entries()) {
    if (!('obraItemId' in i)) {
      if (i.quantidade !== undefined) await ajustarQuantidadeNecessidade(c, obraId, i.necessidadeId, i.quantidade, n);
      saida.push({ necessidadeId: i.necessidadeId, observacao: i.observacao || null });
      continue;
    }
    const item = (await c.query("SELECT id, unidade FROM obra_itens WHERE id = $1 AND obra_id = $2 AND tipo = 'insumo'", [i.obraItemId, obraId])).rows[0];
    if (!item) throw new ErroHttp(400, `Item ${n + 1}: escolha um insumo da planilha desta obra.`);
    // Pedido em unidade de compra: a quantidade digitada vai para a necessidade convertida na unidade do orçamento.
    let quantidadeBase = i.quantidade;
    let unidadeCompra: string | null = null;
    let quantidadeCompra: number | null = null;
    const escolhida = (i.unidade ?? '').trim();
    if (escolhida && escolhida.toLowerCase() !== String(item.unidade).toLowerCase()) {
      const u = (await c.query('SELECT unidade, fator FROM obra_insumo_unidades WHERE obra_item_id = $1 AND lower(unidade) = lower($2)', [item.id, escolhida])).rows[0];
      if (!u) throw new ErroHttp(400, `Item ${n + 1}: "${escolhida}" não é unidade de compra deste insumo.`);
      quantidadeBase = Math.round(i.quantidade * Number(u.fator) * 10000) / 10000;
      unidadeCompra = u.unidade as string;
      quantidadeCompra = i.quantidade;
    }
    if (nivel === 'obra') {
      if (i.eapNoId) throw new ErroHttp(400, `Item ${n + 1}: esta obra apropria no nível da obra, sem nó da EAP.`);
    } else {
      if (!i.eapNoId) throw new ErroHttp(400, `Item ${n + 1}: escolha o nó da EAP (${nivel}).`);
      const no = (await c.query('SELECT nivel FROM eap_nos WHERE id = $1 AND obra_id = $2', [i.eapNoId, obraId])).rows[0];
      if (!no) throw new ErroHttp(400, `Item ${n + 1}: nó da EAP não encontrado nesta obra.`);
      if (no.nivel !== nivel) throw new ErroHttp(400, `Item ${n + 1}: a apropriação usa o nível ${nivel}; este nó é ${no.nivel}.`);
    }
    const r = await c.query(
      `INSERT INTO obra_necessidades (obra_id, obra_item_id, eap_no_id, quantidade, data_necessaria, observacao, unidade_compra, quantidade_compra)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [obraId, i.obraItemId, nivel === 'obra' ? null : i.eapNoId, quantidadeBase, i.dataNecessaria ?? null, i.observacao || null, unidadeCompra, quantidadeCompra],
    );
    saida.push({ necessidadeId: r.rows[0].id as string, observacao: i.observacao || null });
  }
  return saida;
}

/** Item de compra resolvido a partir de uma necessidade da obra. */
type ItemResolvido = {
  necessidadeId: string | null;
  obraItemId: string;
  eapNoId: string | null;
  codigo: string;
  descricao: string;
  unidade: string;
  quantidade: number;
  observacao: string | null;
};

/** Confere que as necessidades são desta obra, estão pendentes e apropriadas a um nó da EAP. */
async function resolverNecessidades(c: Cliente, empresaId: string, obraId: string, itens: { necessidadeId: string; observacao: string | null }[]): Promise<ItemResolvido[]> {
  if (!itens.length) throw new ErroHttp(400, 'Inclua pelo menos um item.');
  if (new Set(itens.map((i) => i.necessidadeId)).size !== itens.length) throw new ErroHttp(400, 'Um mesmo insumo não pode aparecer duas vezes.');
  const r = await c.query(
    `SELECT n.id, n.obra_id, n.status, n.quantidade, n.unidade_compra, n.quantidade_compra, n.eap_no_id, oi.id AS obra_item_id, oi.codigo, oi.descricao, oi.unidade
       FROM obra_necessidades n JOIN obra_itens oi ON oi.id = n.obra_item_id JOIN obras o ON o.id = n.obra_id
      WHERE n.id = ANY($1::uuid[]) AND o.empresa_id = $2
      FOR UPDATE OF n`,
    [itens.map((i) => i.necessidadeId), empresaId],
  );
  const porId = new Map(r.rows.map((x) => [x.id as string, x]));
  return itens.map((i, n) => {
    const x = porId.get(i.necessidadeId);
    if (!x) throw new ErroHttp(400, `Item ${n + 1}: insumo não encontrado.`);
    if (x.obra_id !== obraId) throw new ErroHttp(400, `Item ${n + 1}: o insumo não pertence a esta obra.`);
    if (x.status !== 'pendente') throw new ErroHttp(409, `Item ${n + 1} (${x.descricao}): já está em outra solicitação ou foi comprado.`);
    if (!x.eap_no_id) throw new ErroHttp(400, `Item ${n + 1} (${x.descricao}): o insumo não está apropriado a um nó da EAP.`);
    return {
      necessidadeId: x.id as string,
      obraItemId: x.obra_item_id as string,
      eapNoId: x.eap_no_id as string,
      codigo: x.codigo as string,
      descricao: x.descricao as string,
      // Solicitação e pedido seguem a unidade em que o material foi pedido (de compra, quando houver).
      unidade: (x.unidade_compra as string | null) ?? (x.unidade as string),
      quantidade: Number(x.quantidade_compra ?? x.quantidade),
      observacao: i.observacao,
    };
  });
}

/** Devolve ao pendente as necessidades que estavam numa solicitação (antes de alterar ou cancelar). */
async function liberarNecessidades(c: Cliente, solicitacaoId: string) {
  await c.query(
    `UPDATE obra_necessidades SET status = 'pendente', atualizado_em = now()
      WHERE status = 'solicitada' AND id IN (SELECT necessidade_id FROM solicitacoes_itens WHERE solicitacao_id = $1 AND necessidade_id IS NOT NULL)`,
    [solicitacaoId],
  );
}

async function validarFornecedor(c: Cliente, empresaId: string, id: string) {
  const r = await c.query("SELECT id FROM fornecedores WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL AND categoria = 'fornecedor'", [id, empresaId]);
  if (!r.rowCount) throw new ErroHttp(400, 'Fornecedor não encontrado.');
}
/** Fornecedores escolhidos para cotar precisam atuar no escopo do serviço (solicitação de serviço). */
async function validarAtuacaoFornecedores(c: Cliente, empresaId: string, solicitacaoId: string, fornecedorIds: string[]) {
  if (!fornecedorIds.length) return;
  const s = (await c.query('SELECT escopo_servico FROM solicitacoes_compra WHERE id = $1 AND empresa_id = $2', [solicitacaoId, empresaId])).rows[0];
  if (!s?.escopo_servico) return;
  const fs = (await c.query('SELECT razao_social, nome_fantasia, atuacao FROM fornecedores WHERE id = ANY($1::uuid[]) AND empresa_id = $2', [fornecedorIds, empresaId])).rows;
  const fora = fs.filter((f) => !fornecedorAtende(f.atuacao as string[], s.escopo_servico as string));
  if (fora.length) throw new ErroHttp(400, `Fornecedor sem atuação no escopo do serviço: ${fora.map((f) => f.nome_fantasia || f.razao_social).join(', ')}. Ajuste a atuação no cadastro.`);
}
async function validarAtuacaoCotacao(c: Cliente, empresaId: string, cotacaoId: string, fornecedorIds: string[]) {
  const r = await c.query('SELECT solicitacao_id FROM cotacoes WHERE id = $1 AND empresa_id = $2', [cotacaoId, empresaId]);
  if (r.rows[0]) await validarAtuacaoFornecedores(c, empresaId, r.rows[0].solicitacao_id as string, fornecedorIds);
}
async function validarCentro(c: Cliente, empresaId: string, id: string | null) {
  if (id && !(await c.query('SELECT 1 FROM centros_custo WHERE id = $1 AND empresa_id = $2', [id, empresaId])).rowCount) throw new ErroHttp(400, 'Centro de custo não encontrado.');
}

// ---------------------------------------------------------------- solicitações

const esquemaSolicitacao = z.object({
  obraId: z.string().regex(UUID, 'Escolha a obra.'),
  data: dataOpc,
  necessidade: dataOpc,
  observacao: texto(500),
  itens: z.array(esquemaNecessidadeItem).min(1, 'Inclua pelo menos um insumo.').max(200, 'Até 200 itens por solicitação.'),
});

// ---------------------------------------------------------------- solicitação de serviço

const esquemaItemServico = z.object({
  obraItemId: z.string().regex(UUID, 'Escolha o serviço da obra.'),
  eapNoId: uuidOpc,
  quantidade: positivo('A quantidade precisa ser maior que zero.'),
  observacao: texto(200),
});
/** Escopo do serviço: quem fornece material, mão de obra e equipamento (direciona a minuta do contrato). */
export const ESCOPOS_SERVICO = ['mo', 'eq', 'mat', 'mat_mo', 'mat_mo_eq', 'mo_eq', 'mat_eq'] as const;
const esquemaServico = z.object({
  obraId: z.string().regex(UUID, 'Escolha a obra.'),
  data: dataOpc,
  necessidade: dataOpc,
  observacao: texto(500),
  planoContaId: z.string().regex(UUID, 'Escolha a categoria (plano de contas) do serviço.'),
  escopo: z.enum(ESCOPOS_SERVICO, { message: 'Escolha o escopo do serviço (mão de obra, equipamento e/ou material).' }),
  itens: z.array(esquemaItemServico).min(1, 'Inclua pelo menos um serviço.').max(200, 'Até 200 itens por solicitação.'),
});
const ehServico = (corpo: unknown) => (corpo as { tipo?: unknown } | null)?.tipo === 'servico';

async function validarPlanoConta(c: Cliente, empresaId: string, id: string) {
  if (!(await c.query('SELECT 1 FROM plano_contas WHERE id = $1 AND empresa_id = $2', [id, empresaId])).rowCount) throw new ErroHttp(400, 'Categoria (plano de contas) não encontrada.');
}

/** Serviços (composições) escolhidos direto na obra; não geram necessidade de compra. */
async function resolverServicos(c: Cliente, obraId: string, itens: z.infer<typeof esquemaItemServico>[]): Promise<ItemResolvido[]> {
  const nivel = (await c.query('SELECT nivel_apropriacao FROM obras WHERE id = $1', [obraId])).rows[0].nivel_apropriacao as string;
  const saida: ItemResolvido[] = [];
  for (const [n, i] of itens.entries()) {
    const item = (await c.query("SELECT id, codigo, descricao, unidade FROM obra_itens WHERE id = $1 AND obra_id = $2 AND tipo = 'composicao'", [i.obraItemId, obraId])).rows[0];
    if (!item) throw new ErroHttp(400, `Item ${n + 1}: escolha um serviço cadastrado nesta obra.`);
    if (nivel === 'obra') {
      if (i.eapNoId) throw new ErroHttp(400, `Item ${n + 1}: esta obra apropria no nível da obra, sem nó da EAP.`);
    } else {
      if (!i.eapNoId) throw new ErroHttp(400, `Item ${n + 1}: escolha o nó da EAP (${nivel}).`);
      const no = (await c.query('SELECT nivel FROM eap_nos WHERE id = $1 AND obra_id = $2', [i.eapNoId, obraId])).rows[0];
      if (!no) throw new ErroHttp(400, `Item ${n + 1}: nó da EAP não encontrado nesta obra.`);
      if (no.nivel !== nivel) throw new ErroHttp(400, `Item ${n + 1}: a apropriação usa o nível ${nivel}; este nó é ${no.nivel}.`);
    }
    saida.push({ necessidadeId: null, obraItemId: item.id as string, eapNoId: nivel === 'obra' ? null : i.eapNoId, codigo: item.codigo as string, descricao: item.descricao as string, unidade: item.unidade as string, quantidade: i.quantidade, observacao: i.observacao });
  }
  return saida;
}

async function detalharSolicitacao(c: Cliente, empresaId: string, id: string) {
  if (!UUID.test(id)) throw naoEncontrado('Solicitação');
  const s = (
    await c.query(
      `SELECT s.*, u.nome AS solicitante, cc.nome AS centro_custo, o.nome AS obra_nome, o.codigo AS obra_codigo,
              (SELECT json_agg(json_build_object('id', ct.id, 'numero', ct.numero, 'status', ct.status) ORDER BY ct.numero) FROM cotacoes ct WHERE ct.solicitacao_id = s.id) AS cotacoes,
              (SELECT json_agg(json_build_object('id', p.id, 'numero', p.numero, 'status', p.status) ORDER BY p.numero) FROM pedidos_compra p WHERE p.solicitacao_id = s.id) AS pedidos
         FROM solicitacoes_compra s LEFT JOIN usuarios u ON u.id = s.solicitante_id LEFT JOIN centros_custo cc ON cc.id = s.centro_custo_id
              LEFT JOIN obras o ON o.id = s.obra_id
        WHERE s.id = $1 AND s.empresa_id = $2`,
      [id, empresaId],
    )
  ).rows[0];
  if (!s) throw naoEncontrado('Solicitação');
  const itens = (
    await c.query(
      `SELECT si.*, en.codigo AS eap_codigo, en.descricao AS eap_descricao, oi.codigo AS item_codigo
         FROM solicitacoes_itens si LEFT JOIN eap_nos en ON en.id = si.eap_no_id LEFT JOIN obra_itens oi ON oi.id = si.obra_item_id
        WHERE si.solicitacao_id = $1 ORDER BY en.codigo, si.descricao`,
      [id],
    )
  ).rows;
  return {
    id: s.id,
    numero: s.numero,
    data: s.data,
    necessidade: s.necessidade,
    obraId: s.obra_id,
    obra: s.obra_id ? { id: s.obra_id as string, codigo: s.obra_codigo as string, nome: s.obra_nome as string } : null,
    tipo: s.tipo as string,
    planoContaId: (s.plano_conta_id ?? null) as string | null,
    escopo: (s.escopo_servico ?? null) as string | null,
    centroCustoId: s.centro_custo_id,
    centroCusto: s.centro_custo,
    observacao: s.observacao,
    status: s.status,
    finalizadaEm: s.finalizada_em,
    solicitante: s.solicitante,
    cotacoes: s.cotacoes ?? [],
    pedidos: s.pedidos ?? [],
    itens: itens.map((i) => ({
      id: i.id as string,
      necessidadeId: i.necessidade_id as string | null,
      obraItemId: i.obra_item_id as string | null,
      eapNoId: i.eap_no_id as string | null,
      eapCodigo: i.eap_codigo as string | null,
      eapDescricao: i.eap_descricao as string | null,
      codigo: (i.item_codigo as string | null) ?? null,
      descricao: i.descricao as string,
      unidade: i.unidade as string,
      quantidade: Number(i.quantidade),
      observacao: i.observacao as string | null,
    })),
  };
}

/** Grava os itens da solicitação (já validados) e marca as necessidades como solicitadas. */
async function gravarItensSolicitacao(c: Cliente, empresaId: string, solicitacaoId: string, itens: ItemResolvido[]) {
  await c.query('DELETE FROM solicitacoes_itens WHERE solicitacao_id = $1', [solicitacaoId]);
  for (const i of itens)
    await c.query(
      `INSERT INTO solicitacoes_itens (empresa_id, solicitacao_id, descricao, unidade, quantidade, observacao, obra_item_id, eap_no_id, necessidade_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [empresaId, solicitacaoId, i.descricao, i.unidade, i.quantidade, i.observacao, i.obraItemId, i.eapNoId, i.necessidadeId],
    );
  const necessidades = itens.map((i) => i.necessidadeId).filter((x): x is string => !!x);
  if (necessidades.length) await c.query("UPDATE obra_necessidades SET status = 'solicitada', atualizado_em = now() WHERE id = ANY($1::uuid[])", [necessidades]);
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
  const itens = (
    await c.query(
      `SELECT ci.*, en.codigo AS eap_codigo, en.descricao AS eap_descricao, oi.codigo
         FROM cotacoes_itens ci LEFT JOIN eap_nos en ON en.id = ci.eap_no_id LEFT JOIN obra_itens oi ON oi.id = ci.obra_item_id
        WHERE ci.cotacao_id = $1 ORDER BY en.codigo, ci.descricao`,
      [id],
    )
  ).rows;
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
      solicitacaoItemId: i.solicitacao_item_id as string | null,
      necessidadeId: i.necessidade_id as string | null,
      obraItemId: i.obra_item_id as string | null,
      eapNoId: i.eap_no_id as string | null,
      eapCodigo: i.eap_codigo as string | null,
      codigo: i.codigo as string | null,
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
      desconto: reais(f.desconto_centavos)!,
      validade: f.validade as string | null,
      observacao: f.observacao as string | null,
      itensCotados: cotados.length,
      subtotal: Math.round(subtotal * 100) / 100,
      total: Math.round((subtotal - Number(f.desconto_centavos) / 100 + Number(f.frete_centavos) / 100) * 100) / 100,
      completo: cotados.length === linhas.length,
      itensVencidos: vencidos.length,
      totalVencido: Math.round(vencidos.reduce((s, l) => s + (l.totalVencedor ?? 0), 0) * 100) / 100,
    };
  });
  const comVencedor = linhas.filter((l) => l.vencedorId);
  // Frete entra pelo fornecedor que levou ao menos um item.
  const freteVencedores = forn.filter((f) => f.itensVencidos > 0).reduce((s, f) => s + f.frete, 0);
  // Desconto do fornecedor incide sobre os itens dele: só a parte dos itens escolhidos conta.
  const descontoVencedores = forn.reduce((s, f) => {
    if (!f.subtotal || !f.desconto) return s;
    const escolhidoDele = linhas.filter((l) => l.vencedorId === f.id).reduce((t, l) => t + (l.totalVencedor ?? 0), 0);
    return s + f.desconto * (escolhidoDele / f.subtotal);
  }, 0);
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
      totalEscolhido: Math.round((comVencedor.reduce((s, l) => s + (l.totalVencedor ?? 0), 0) + freteVencedores - descontoVencedores) * 100) / 100,
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
/** Pedido com item vindo de solicitação de alguma das obras (o almoxarife só vê as obras que o dono atribuiu a ele). */
const SQL_PEDIDO_DAS_OBRAS = `EXISTS (
  SELECT 1 FROM pedidos_itens pi JOIN cotacoes_itens ci ON ci.id = pi.cotacao_item_id
    JOIN solicitacoes_itens si ON si.id = ci.solicitacao_item_id JOIN solicitacoes_compra sc ON sc.id = si.solicitacao_id
   WHERE pi.pedido_id = p.id AND sc.obra_id = ANY($%N::uuid[]))`;

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
              cc.nome AS centro_custo, ua.nome AS aprovado_por, uc.nome AS criado_por, ct.numero AS cotacao_numero, s.numero AS solicitacao_numero,
              ob.codigo AS obra_codigo, ob.nome AS obra_nome, ob.endereco AS obra_endereco, ob.cidade AS obra_cidade, ob.uf AS obra_uf,
              ob.contato_obra_nome, ob.contato_obra_telefone, ob.referencia_entrega,
              tr.razao_social AS transportadora_nome
         FROM pedidos_compra p JOIN fornecedores f ON f.id = p.fornecedor_id
         LEFT JOIN fornecedores tr ON tr.id = p.transportadora_id
         LEFT JOIN obras ob ON ob.id = (SELECT s2.obra_id FROM solicitacoes_compra s2 WHERE s2.id = p.solicitacao_id)
         LEFT JOIN centros_custo cc ON cc.id = p.centro_custo_id
         LEFT JOIN usuarios ua ON ua.id = p.aprovado_por_id LEFT JOIN usuarios uc ON uc.id = p.criado_por_id
         LEFT JOIN cotacoes ct ON ct.id = p.cotacao_id LEFT JOIN solicitacoes_compra s ON s.id = p.solicitacao_id
        WHERE p.id = $1 AND p.empresa_id = $2`,
      [id, empresaId],
    )
  ).rows[0] as LinhaPedido | undefined;
  if (!p) throw naoEncontrado('Pedido');
  const itens = (
    await c.query(
      `SELECT pi.*, oi.codigo, en.codigo AS eap_codigo, en.descricao AS eap_descricao
         FROM pedidos_itens pi LEFT JOIN obra_itens oi ON oi.id = pi.obra_item_id LEFT JOIN eap_nos en ON en.id = pi.eap_no_id
        WHERE pi.pedido_id = $1 ORDER BY en.codigo, pi.descricao`,
      [id],
    )
  ).rows;
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
      obraItemId: i.obra_item_id as string | null,
      necessidadeId: i.necessidade_id as string | null,
      eapNoId: i.eap_no_id as string | null,
      eapCodigo: i.eap_codigo as string | null,
      eapDescricao: i.eap_descricao as string | null,
      codigo: i.codigo as string | null,
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
    entregaObra: p.obra_codigo
      ? {
          codigo: p.obra_codigo as string,
          nome: p.obra_nome as string,
          endereco: (p.obra_endereco as string | null) ?? null,
          cidade: p.obra_cidade ? `${p.obra_cidade}${p.obra_uf ? `/${String(p.obra_uf).trim()}` : ''}` : null,
          contatoNome: (p.contato_obra_nome as string | null) ?? null,
          contatoTelefone: (p.contato_obra_telefone as string | null) ?? null,
          referencia: (p.referencia_entrega as string | null) ?? null,
        }
      : null,
    frete: reais(p.frete_centavos)!,
    freteTipo: (p.frete_tipo as 'transportadora' | 'proprio' | null) ?? null,
    transportadora: p.transportadora_id ? { id: p.transportadora_id as string, nome: p.transportadora_nome as string } : null,
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

/** Cabeçalho do pedido. Os itens vêm da cotação (com obra, EAP e necessidade) e não são editados aqui. */
const esquemaPedido = z.object({
  fornecedorId: z.string().regex(UUID, 'Escolha o fornecedor.'),
  data: dataOpc,
  previsaoEntrega: dataOpc,
  condicaoPagamento: texto(120),
  localEntrega: texto(200),
  frete: naoNegativo('Frete inválido.').optional().default(0),
  freteTipo: z.enum(['transportadora', 'proprio']).optional().nullable().transform((v) => v ?? null),
  transportadoraId: uuidOpc,
  centroCustoId: uuidOpc,
  observacao: texto(1000),
  solicitacaoId: uuidOpc,
});

async function gravarItensPedido(c: Cliente, empresaId: string, pedidoId: string, itens: (ItemResolvido & { precoUnitario: number; cotacaoItemId: string })[], freteCentavos: number) {
  await c.query('DELETE FROM pedidos_itens WHERE pedido_id = $1', [pedidoId]);
  let total = 0;
  for (const i of itens) {
    const pu = centPreco(i.precoUnitario);
    total += Math.round(pu * i.quantidade);
    await c.query(
      `INSERT INTO pedidos_itens (empresa_id, pedido_id, cotacao_item_id, descricao, unidade, quantidade, preco_unitario_centavos, obra_item_id, eap_no_id, necessidade_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [empresaId, pedidoId, i.cotacaoItemId, i.descricao, i.unidade, i.quantidade, pu, i.obraItemId, i.eapNoId, i.necessidadeId],
    );
  }
  total += freteCentavos;
  await c.query('UPDATE pedidos_compra SET total_centavos = $2, atualizado_em = now() WHERE id = $1', [pedidoId, total]);
  return total;
}

/** Recalcula o total do pedido como soma dos itens + frete. */
export async function recalcularTotalPedido(c: Cliente, pedidoId: string) {
  await c.query(
    `UPDATE pedidos_compra p SET total_centavos = p.frete_centavos + coalesce((SELECT round(sum(round(pi.quantidade * pi.preco_unitario_centavos))) FROM pedidos_itens pi WHERE pi.pedido_id = p.id), 0), atualizado_em = now()
     WHERE p.id = $1`,
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
type MapaCotacao = Awaited<ReturnType<typeof detalharCotacao>>;

/** Serviço concluído: cria um contrato em rascunho por fornecedor vencedor, com os serviços dele (vai para aprovação em Contratos). */
async function gerarContratosDoServico(
  c: Cliente,
  empresaId: string,
  usuarioId: string,
  mapa: MapaCotacao,
  escolhidos: MapaCotacao['itens'],
  sol: { numero: number; plano_conta_id: string | null; obra_id: string | null; centro_custo_id: string | null },
): Promise<{ id: string; numero: number }[]> {
  if (!sol.plano_conta_id) throw new ErroHttp(400, 'Esta solicitação de serviço está sem categoria (plano de contas). Refaça a solicitação.');
  const criados: { id: string; numero: number }[] = [];
  for (const f of mapa.fornecedores.filter((x) => escolhidos.some((i) => i.vencedorId === x.id))) {
    const itens = escolhidos.filter((i) => i.vencedorId === f.id);
    for (const i of itens) if (!i.obraItemId) throw new ErroHttp(400, `${i.descricao}: serviço sem vínculo com a obra. Refaça a solicitação.`);
    const numero = await proximoNumero(c, 'contratos', empresaId);
    const ct = (
      await c.query(
        `INSERT INTO contratos (empresa_id, numero, fornecedor_id, objeto, tipo, inicio, plano_conta_id, centro_custo_id, status, criado_por_id, obra_id, solicitacao_id, cotacao_id)
         VALUES ($1, $2, $3, $4, 'itens', $5, $6, $7, 'rascunho', $8, $9, $10, $11) RETURNING id`,
        [empresaId, numero, f.fornecedorId, `Serviços da solicitação nº ${String(sol.numero).padStart(4, '0')}`, hojeBrasil(), sol.plano_conta_id, sol.centro_custo_id, usuarioId, sol.obra_id, mapa.solicitacaoId, mapa.id],
      )
    ).rows[0];
    let ordem = 0;
    for (const i of itens) {
      ordem += 1;
      const oferta = i.ofertas.find((o) => o.cotacaoFornecedorId === f.id);
      await c.query(
        `INSERT INTO contratos_itens (empresa_id, contrato_id, ordem, descricao, unidade, quantidade, preco_unitario_centavos, obra_item_id, eap_no_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [empresaId, ct.id, ordem, i.descricao, i.unidade, i.quantidade, centPreco(oferta!.precoUnitario), i.obraItemId, i.eapNoId],
      );
    }
    await auditar(c, { empresaId, usuarioId, acao: 'criar', entidade: 'contratos', entidadeId: ct.id, depois: { numero, origem: 'solicitacao de serviço', cotacao: mapa.numero } });
    criados.push({ id: ct.id as string, numero });
  }
  return criados;
}

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

    // ----- Estoque da construtora: saldo por insumo da obra e etapa da EAP; saídas por requisição.
    app.get<{ Querystring: Record<string, string | undefined> }>('/estoque', async (req) => {
      const empresaId = empresaDo(req);
      const obraId = req.query.obraId && UUID.test(req.query.obraId) ? req.query.obraId : null;
      const r = await banco.query(
        `WITH s AS (
           SELECT m.obra_id, m.obra_item_id, m.eap_no_id, m.obra_estoque_id, sum(CASE WHEN m.tipo = 'saida' THEN -m.quantidade ELSE m.quantidade END) AS qtd
             FROM estoque_movimentos m
            WHERE m.empresa_id = $1 AND m.obra_item_id IS NOT NULL AND ($2::uuid IS NULL OR m.obra_id = $2)
            GROUP BY m.obra_id, m.obra_item_id, m.eap_no_id, m.obra_estoque_id)
         SELECT s.obra_id, s.obra_item_id, s.eap_no_id, s.obra_estoque_id, ee.nome AS estoque_nome, s.qtd, oi.codigo, oi.descricao, oi.unidade, o.codigo AS obra_codigo, e.codigo AS eap_codigo, e.descricao AS eap_descricao
           FROM s JOIN obra_itens oi ON oi.id = s.obra_item_id JOIN obras o ON o.id = s.obra_id JOIN eap_nos e ON e.id = s.eap_no_id
           LEFT JOIN obra_estoques ee ON ee.id = s.obra_estoque_id
          WHERE s.qtd <> 0
          ORDER BY oi.descricao, ee.nome, e.codigo`,
        [empresaId, obraId],
      );
      const mapa = new Map<string, { obraItemId: string; codigo: string; descricao: string; unidade: string; saldo: number; apropriacoes: { obraId: string; obraCodigo: string; estoqueId: string | null; estoqueNome: string | null; eapNoId: string; eapCodigo: string; eapDescricao: string; quantidade: number }[] }>();
      for (const x of r.rows) {
        const q = Math.round(Number(x.qtd) * 1000) / 1000;
        const it = mapa.get(x.obra_item_id) ?? { obraItemId: x.obra_item_id, codigo: x.codigo, descricao: x.descricao, unidade: x.unidade, saldo: 0, apropriacoes: [] };
        it.saldo = Math.round((it.saldo + q) * 1000) / 1000;
        it.apropriacoes.push({ obraId: x.obra_id, obraCodigo: x.obra_codigo, estoqueId: x.obra_estoque_id ?? null, estoqueNome: x.estoque_nome ?? null, eapNoId: x.eap_no_id, eapCodigo: x.eap_codigo, eapDescricao: x.eap_descricao, quantidade: q });
        mapa.set(x.obra_item_id, it);
      }
      return { itens: [...mapa.values()] };
    });

    // ----- Transferência entre estoques da mesma obra: saída na origem e entrada no destino, com a mesma referência.
    app.post('/estoque/transferencias', async (req, reply) => {
      const d = z
        .object({
          obraId: z.string().uuid('Escolha a obra.'),
          obraItemId: z.string().uuid('Escolha o insumo.'),
          eapNoId: z.string().uuid('Escolha a etapa.'),
          origemId: z.string().uuid('Escolha o estoque de origem.'),
          destinoId: z.string().uuid('Escolha o estoque de destino.'),
          data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.'),
          quantidade: z.coerce.number({ invalid_type_error: 'Quantidade inválida.' }).positive('Quantidade inválida.').max(10_000_000),
          observacao: z.string().trim().max(300).optional().nullable().transform((v) => v || null),
        })
        .parse(req.body);
      if (d.origemId === d.destinoId) throw new ErroHttp(400, 'Origem e destino são o mesmo estoque.');
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      const qtd = Math.round(d.quantidade * 1000) / 1000;
      const ref = await emTransacao(banco, async (c) => {
        await validarApropriacaoObra(c, empresaId, d.obraId, d.obraItemId, d.eapNoId);
        const origem = await estoqueDaMovimentacao(c, empresaId, d.obraId, d.origemId);
        const destino = await estoqueDaMovimentacao(c, empresaId, d.obraId, d.destinoId);
        const saldo = await saldoApropriacao(c, empresaId, d.obraId, d.obraItemId, d.eapNoId, origem);
        if (qtd > saldo + 0.0005) throw new ErroHttp(400, `Saldo insuficiente no estoque de origem nesta etapa: ${saldo.toLocaleString('pt-BR')} disponível.`);
        const referencia = (await c.query('SELECT gen_random_uuid() AS id')).rows[0].id as string;
        const obs = d.observacao ?? 'Transferência entre estoques';
        await c.query(
          `INSERT INTO estoque_movimentos (empresa_id, obra_id, obra_estoque_id, obra_item_id, eap_no_id, data, tipo, quantidade, observacao, criado_por_id, transferencia_ref)
           VALUES ($1,$2,$3,$4,$5,$6,'saida',$7,$8,$9,$10)`,
          [empresaId, d.obraId, origem, d.obraItemId, d.eapNoId, d.data, qtd, obs, u.id, referencia],
        );
        await c.query(
          `INSERT INTO estoque_movimentos (empresa_id, obra_id, obra_estoque_id, obra_item_id, eap_no_id, data, tipo, quantidade, observacao, criado_por_id, transferencia_ref)
           VALUES ($1,$2,$3,$4,$5,$6,'entrada',$7,$8,$9,$10)`,
          [empresaId, d.obraId, destino, d.obraItemId, d.eapNoId, d.data, qtd, obs, u.id, referencia],
        );
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'criar', entidade: 'estoque_movimentos', entidadeId: referencia, depois: { transferencia: true, quantidade: qtd, origemId: origem, destinoId: destino, obraItemId: d.obraItemId, eapNoId: d.eapNoId } });
        return referencia;
      });
      reply.code(201);
      return { ok: true, transferenciaId: ref };
    });

    // ----- Estoques de cada obra: sempre há um de recebimento (ativo), onde entram as notas de compra.
    app.get<{ Params: { obraId: string } }>('/obras/:obraId/estoques', async (req) => {
      const empresaId = empresaDo(req);
      if (!UUID.test(req.params.obraId)) throw new ErroHttp(404, 'Obra não encontrada.');
      const r = await banco.query(
        `SELECT e.id, e.nome, e.recebimento, e.ativo, (SELECT count(*) FROM estoque_movimentos m WHERE m.obra_estoque_id = e.id)::int AS movimentos
           FROM obra_estoques e JOIN obras o ON o.id = e.obra_id
          WHERE e.obra_id = $1 AND o.empresa_id = $2
          ORDER BY e.recebimento DESC, e.nome`,
        [req.params.obraId, empresaId],
      );
      return { estoques: r.rows.map((x) => ({ id: x.id, nome: x.nome, recebimento: x.recebimento, ativo: x.ativo, movimentos: x.movimentos })) };
    });

    app.post<{ Params: { obraId: string } }>('/obras/:obraId/estoques', async (req, reply) => {
      const d = z.object({ nome: z.string().trim().min(2, 'Informe o nome do estoque.').max(60) }).parse(req.body);
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      if (!UUID.test(req.params.obraId)) throw new ErroHttp(404, 'Obra não encontrada.');
      const id = await emTransacao(banco, async (c) => {
        if (!(await c.query('SELECT 1 FROM obras WHERE id = $1 AND empresa_id = $2', [req.params.obraId, empresaId])).rowCount) throw new ErroHttp(404, 'Obra não encontrada.');
        if ((await c.query('SELECT 1 FROM obra_estoques WHERE obra_id = $1 AND lower(nome) = lower($2)', [req.params.obraId, d.nome])).rowCount)
          throw new ErroHttp(400, 'Já existe um estoque com esse nome nesta obra.');
        const e = (await c.query('INSERT INTO obra_estoques (empresa_id, obra_id, nome, codigo) VALUES ($1,$2,$3,$4) RETURNING id', [empresaId, req.params.obraId, d.nome, await proximoCodigoEstoque(c, empresaId)])).rows[0];
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'criar', entidade: 'obra_estoques', entidadeId: e.id, depois: { obraId: req.params.obraId, nome: d.nome } });
        return e.id as string;
      });
      reply.code(201);
      return { ok: true, id };
    });

    app.put<{ Params: { id: string } }>('/estoques/:id', async (req) => {
      const d = z.object({
        nome: z.string().trim().min(2, 'Informe o nome do estoque.').max(60).optional(),
        ativo: z.boolean().optional(),
      }).parse(req.body);
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      if (!UUID.test(req.params.id)) throw new ErroHttp(404, 'Estoque não encontrado.');
      await emTransacao(banco, async (c) => {
        const atual = (
          await c.query('SELECT e.* FROM obra_estoques e JOIN obras o ON o.id = e.obra_id WHERE e.id = $1 AND o.empresa_id = $2', [req.params.id, empresaId])
        ).rows[0];
        if (!atual) throw new ErroHttp(404, 'Estoque não encontrado.');
        if (atual.recebimento && d.ativo === false) throw new ErroHttp(400, 'O estoque de recebimento não pode ser desativado. Toda obra precisa dele.');
        if (d.nome && d.nome.toLowerCase() !== String(atual.nome).toLowerCase() && (await c.query('SELECT 1 FROM obra_estoques WHERE obra_id = $1 AND lower(nome) = lower($2) AND id <> $3', [atual.obra_id, d.nome, atual.id])).rowCount)
          throw new ErroHttp(400, 'Já existe um estoque com esse nome nesta obra.');
        await c.query('UPDATE obra_estoques SET nome = coalesce($2, nome), ativo = coalesce($3, ativo) WHERE id = $1', [atual.id, d.nome ?? null, d.ativo ?? null]);
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'alterar', entidade: 'obra_estoques', entidadeId: atual.id, antes: { nome: atual.nome, ativo: atual.ativo }, depois: d });
      });
      return { ok: true };
    });

    // ----- Estoques da empresa: com obra ou gerais, código automático.
    app.get<{ Querystring: Record<string, string | undefined> }>('/estoques', async (req) => {
      const empresaId = empresaDo(req);
      const obraId = req.query.obraId && UUID.test(req.query.obraId) ? req.query.obraId : null;
      const r = await banco.query(
        `SELECT e.id, e.codigo, e.nome, e.recebimento, e.ativo, e.obra_id, o.codigo AS obra_codigo, o.nome AS obra_nome
           FROM obra_estoques e LEFT JOIN obras o ON o.id = e.obra_id
          WHERE e.empresa_id = $1 AND ($2::uuid IS NULL OR e.obra_id = $2 OR e.obra_id IS NULL)
          ORDER BY e.recebimento DESC, e.codigo`,
        [empresaId, obraId],
      );
      return { estoques: r.rows.map((x) => ({ id: x.id, codigo: x.codigo, nome: x.nome, recebimento: x.recebimento, ativo: x.ativo, obraId: x.obra_id ?? null, obraCodigo: x.obra_codigo ?? null, obraNome: x.obra_nome ?? null })) };
    });

    app.post('/estoques', async (req, reply) => {
      const d = z
        .object({
          nome: z.string().trim().min(2, 'Informe o nome do estoque.').max(60),
          obraId: z.string().uuid().optional().nullable().transform((v) => v || null),
        })
        .parse(req.body);
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      const criado = await emTransacao(banco, async (c) => {
        if (d.obraId && !(await c.query('SELECT 1 FROM obras WHERE id = $1 AND empresa_id = $2', [d.obraId, empresaId])).rowCount) throw new ErroHttp(400, 'Obra não encontrada.');
        // Nome único dentro da obra (ou entre os gerais).
        if ((await c.query('SELECT 1 FROM obra_estoques WHERE empresa_id = $1 AND coalesce(obra_id::text, $2) = coalesce($3::text, $2) AND lower(nome) = lower($4)', [empresaId, '-', d.obraId, d.nome])).rowCount)
          throw new ErroHttp(400, 'Já existe um estoque com esse nome.');
        const codigo = await proximoCodigoEstoque(c, empresaId);
        const e = (await c.query('INSERT INTO obra_estoques (empresa_id, obra_id, nome, codigo) VALUES ($1,$2,$3,$4) RETURNING id, codigo', [empresaId, d.obraId, d.nome, codigo])).rows[0];
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'criar', entidade: 'obra_estoques', entidadeId: e.id, depois: { codigo, nome: d.nome, obraId: d.obraId } });
        return e;
      });
      reply.code(201);
      return { ok: true, id: criado.id, codigo: criado.codigo };
    });

    // ----- Etiquetas (QR) de cada entrada no estoque (nota fiscal ou despesa com estoque): o QR é o id da entrada, fixo.
    const SQL_ETIQUETAS = `
      SELECT * FROM (
        SELECT m.id, m.data, m.quantidade, m.observacao, m.obra_id, m.eap_no_id, m.obra_estoque_id, m.obra_item_id,
               (m.quantidade - coalesce((SELECT sum(s.quantidade) FROM estoque_movimentos s WHERE s.etiqueta_id = m.id), 0)) AS saldo,
               oi.codigo AS insumo_codigo, oi.descricao AS insumo_descricao, oi.unidade AS insumo_unidade,
               o.codigo AS obra_codigo, o.nome AS obra_nome, e.codigo AS eap_codigo, e.descricao AS eap_descricao,
               est.codigo AS estoque_codigo, est.nome AS estoque_nome, m.empresa_id
          FROM estoque_movimentos m
          JOIN obra_itens oi ON oi.id = m.obra_item_id
          JOIN obras o ON o.id = m.obra_id
          JOIN eap_nos e ON e.id = m.eap_no_id
          LEFT JOIN obra_estoques est ON est.id = m.obra_estoque_id
         WHERE m.tipo = 'entrada' AND m.obra_item_id IS NOT NULL
      ) x`;
    const etiquetaPublica = (x: Record<string, any>) => ({
      id: x.id as string,
      chave: chaveEtiqueta(x.id as string),
      data: String(x.data).slice(0, 10),
      quantidade: Number(x.quantidade),
      saldo: Math.round(Number(x.saldo) * 1000) / 1000,
      observacao: x.observacao ?? null,
      insumo: { codigo: x.insumo_codigo as string, descricao: x.insumo_descricao as string, unidade: x.insumo_unidade as string },
      obraId: x.obra_id as string,
      obraCodigo: x.obra_codigo as string,
      obraNome: x.obra_nome as string,
      eapNoId: x.eap_no_id as string,
      eapCodigo: x.eap_codigo as string,
      eapDescricao: x.eap_descricao as string,
      estoque: { id: (x.obra_estoque_id ?? null) as string | null, codigo: (x.estoque_codigo ?? null) as string | null, nome: (x.estoque_nome ?? null) as string | null },
    });

    app.get<{ Querystring: Record<string, string | undefined> }>('/etiquetas', async (req) => {
      const empresaId = empresaDo(req);
      const obraId = req.query.obraId && UUID.test(req.query.obraId) ? req.query.obraId : null;
      const estoqueId = req.query.estoqueId && UUID.test(req.query.estoqueId) ? req.query.estoqueId : null;
      const soSaldo = req.query.saldo !== '0';
      const r = await banco.query(
        `${SQL_ETIQUETAS} WHERE x.empresa_id = $1 AND ($2::uuid IS NULL OR x.obra_id = $2) AND ($3::uuid IS NULL OR x.obra_estoque_id = $3)
            AND ($4::boolean = false OR x.saldo > 0) ORDER BY x.data DESC, x.insumo_descricao LIMIT 300`,
        [empresaId, obraId, estoqueId, soSaldo],
      );
      return { etiquetas: r.rows.map(etiquetaPublica) };
    });

    app.get<{ Params: { id: string } }>('/etiquetas/:id', async (req) => {
      const empresaId = empresaDo(req);
      if (!UUID.test(req.params.id)) throw new ErroHttp(404, 'Etiqueta não encontrada.');
      const r = await banco.query(`${SQL_ETIQUETAS} WHERE x.empresa_id = $1 AND x.id = $2`, [empresaId, req.params.id]);
      if (!r.rows[0]) throw new ErroHttp(404, 'Etiqueta não encontrada.');
      return { etiqueta: etiquetaPublica(r.rows[0]) };
    });

    // ----- Funcionários que recebem material na obra.
    // Colaboradores: o mesmo cadastro do Administrativo (motoristas), só os ativos. Quem pega material na saída.
    app.get('/colaboradores', async (req) => {
      const r = await banco.query('SELECT id, nome, funcao, cargo FROM motoristas WHERE empresa_id = $1 AND excluido_em IS NULL AND ativo ORDER BY nome', [empresaDo(req)]);
      return { colaboradores: r.rows.map((x) => ({ id: x.id, nome: x.nome, funcao: x.funcao ?? null, cargo: x.cargo ?? null })) };
    });

    // ----- Saída de material por etiqueta: cadastro com obra, etapa, funcionário e o almoxarife que entregou.
    app.post('/saidas-material', async (req, reply) => {
      const d = z
        .object({
          obraId: z.string().uuid('Escolha a obra.'),
          eapNoId: z.string().uuid('Escolha a etapa.'),
          colaboradorId: z.string().uuid('Escolha o colaborador.'),
          data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.'),
          observacao: z.string().trim().max(500).optional().nullable().transform((v) => v || null),
          itens: z
            .array(
              z.object({
                etiquetaId: z.string().uuid('Leia a etiqueta de cada insumo.'),
                quantidade: z.coerce.number({ invalid_type_error: 'Quantidade inválida.' }).positive('Quantidade inválida.').max(10_000_000),
              }),
            )
            .min(1, 'Leia ao menos um insumo.')
            .max(200),
        })
        .parse(req.body);
      if (new Set(d.itens.map((i) => i.etiquetaId)).size !== d.itens.length) throw new ErroHttp(400, 'A mesma etiqueta aparece mais de uma vez.');
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      const criada = await emTransacao(banco, async (c) => {
        await validarApropriacaoObra(c, empresaId, d.obraId, null, d.eapNoId);
        if (!(await c.query('SELECT 1 FROM motoristas WHERE id = $1 AND empresa_id = $2 AND ativo AND excluido_em IS NULL', [d.colaboradorId, empresaId])).rowCount)
          throw new ErroHttp(400, 'Colaborador não encontrado ou inativo.');
        const numero = (await c.query("SELECT 'SAI-' || lpad((coalesce(max(substring(numero FROM '^SAI-([0-9]+)$')::int), 0) + 1)::text, 4, '0') AS numero FROM saidas_material WHERE empresa_id = $1", [empresaId])).rows[0].numero as string;
        const cab = (
          await c.query(
            'INSERT INTO saidas_material (empresa_id, numero, data, obra_id, eap_no_id, colaborador_id, entregue_por_id, observacao) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
            [empresaId, numero, d.data, d.obraId, d.eapNoId, d.colaboradorId, u.id, d.observacao],
          )
        ).rows[0];
        for (const it of d.itens) {
          // Trava a entrada: duas saídas ao mesmo tempo não podem gastar o mesmo saldo.
          const e = (
            await c.query(
              `SELECT m.id, m.obra_id, m.eap_no_id, m.obra_estoque_id, m.obra_item_id,
                      (m.quantidade - coalesce((SELECT sum(s.quantidade) FROM estoque_movimentos s WHERE s.etiqueta_id = m.id), 0)) AS saldo
                 FROM estoque_movimentos m
                WHERE m.id = $1 AND m.empresa_id = $2 AND m.tipo = 'entrada' AND m.nota_item_id IS NOT NULL
                FOR UPDATE OF m`,
              [it.etiquetaId, empresaId],
            )
          ).rows[0];
          if (!e || !e.obra_estoque_id) throw new ErroHttp(400, 'Etiqueta não encontrada.');
          if (e.obra_id !== d.obraId) throw new ErroHttp(400, 'Este insumo é de outra obra.');
          if (e.eap_no_id !== d.eapNoId) throw new ErroHttp(400, 'Este insumo está apropriado a outra etapa. Escolha a etapa dele.');
          const qtd = Math.round(it.quantidade * 1000) / 1000;
          const saldoEtiqueta = Number(e.saldo);
          if (qtd > saldoEtiqueta + 0.0005) throw new ErroHttp(400, `Saldo desta etiqueta insuficiente: ${saldoEtiqueta.toLocaleString('pt-BR')} disponível.`);
          const saldoEstoque = await saldoApropriacao(c, empresaId, d.obraId, e.obra_item_id, d.eapNoId, e.obra_estoque_id);
          if (qtd > saldoEstoque + 0.0005) throw new ErroHttp(400, `Saldo insuficiente neste estoque e etapa: ${saldoEstoque.toLocaleString('pt-BR')} disponível.`);
          await c.query(
            `INSERT INTO estoque_movimentos (empresa_id, obra_id, obra_estoque_id, obra_item_id, eap_no_id, data, tipo, quantidade, observacao, criado_por_id, etiqueta_id, saida_material_id)
             VALUES ($1,$2,$3,$4,$5,$6,'saida',$7,$8,$9,$10,$11)`,
            [empresaId, d.obraId, e.obra_estoque_id, e.obra_item_id, d.eapNoId, d.data, qtd, `Saída ${numero}`, u.id, e.id, cab.id],
          );
        }
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'criar', entidade: 'saidas_material', entidadeId: cab.id, depois: { numero, obraId: d.obraId, eapNoId: d.eapNoId, itens: d.itens.length } });
        return { id: cab.id as string, numero };
      });
      reply.code(201);
      return { ok: true, ...criada };
    });

    app.get('/saidas-material', async (req) => {
      const r = await banco.query(
        `SELECT s.id, s.numero, s.data, s.observacao, o.codigo AS obra_codigo, o.nome AS obra_nome, e.codigo AS eap_codigo, e.descricao AS eap_descricao,
                coalesce(c.nome, s.funcionario_nome) AS colaborador_nome, u.nome AS entregue_por,
                (SELECT count(*) FROM estoque_movimentos m WHERE m.saida_material_id = s.id)::int AS itens
           FROM saidas_material s JOIN obras o ON o.id = s.obra_id JOIN eap_nos e ON e.id = s.eap_no_id
           LEFT JOIN motoristas c ON c.id = s.colaborador_id JOIN usuarios u ON u.id = s.entregue_por_id
          WHERE s.empresa_id = $1 ORDER BY s.criado_em DESC LIMIT 200`,
        [empresaDo(req)],
      );
      return { saidas: r.rows.map((x) => ({ id: x.id, numero: x.numero, data: String(x.data).slice(0, 10), observacao: x.observacao ?? null, obraCodigo: x.obra_codigo, obraNome: x.obra_nome, eapCodigo: x.eap_codigo, eapDescricao: x.eap_descricao, colaborador: x.colaborador_nome, entreguePor: x.entregue_por, itens: x.itens })) };
    });

    // ----- Solicitações de compra: sempre de uma obra, com os insumos das necessidades apropriadas à EAP.
    app.get<{ Querystring: Record<string, string | undefined> }>('/solicitacoes', async (req) => {
      const empresaId = empresaDo(req);
      const status = STATUS_SOLICITACAO.includes(req.query.status as never) ? req.query.status! : null;
      const obraId = req.query.obraId && UUID.test(req.query.obraId) ? req.query.obraId : null;
      const tipo = req.query.tipo === 'servico' || req.query.tipo === 'insumo' ? req.query.tipo : null;
      const r = await banco.query(
        `SELECT s.id, s.numero, s.data, s.necessidade, s.status, s.observacao, s.finalizada_em, s.obra_id, s.tipo, u.nome AS solicitante,
                o.codigo AS obra_codigo, o.nome AS obra_nome,
                (SELECT count(*)::int FROM solicitacoes_itens si WHERE si.solicitacao_id = s.id) AS itens,
                (SELECT string_agg(si.descricao, ', ' ORDER BY si.descricao) FROM solicitacoes_itens si WHERE si.solicitacao_id = s.id) AS resumo
           FROM solicitacoes_compra s LEFT JOIN usuarios u ON u.id = s.solicitante_id LEFT JOIN obras o ON o.id = s.obra_id
          WHERE s.empresa_id = $1 AND ($2::text IS NULL OR s.status = $2) AND ($3::uuid IS NULL OR s.obra_id = $3) AND ($4::text IS NULL OR s.tipo = $4)
            AND ($2::text IS NOT NULL OR s.status IN ('aberta', 'finalizada', 'em_cotacao') OR s.data > current_date - 120)
          ORDER BY (s.status IN ('aberta', 'finalizada', 'em_cotacao')) DESC, s.numero DESC LIMIT 500`,
        [empresaId, status, obraId, tipo],
      );
      const hoje = hojeBrasil();
      const abertas = ['aberta', 'finalizada', 'em_cotacao'];
      return {
        solicitacoes: r.rows.map((s) => ({
          id: s.id,
          tipo: s.tipo as string,
          numero: s.numero,
          data: s.data,
          necessidade: s.necessidade,
          obra: s.obra_id ? { id: s.obra_id as string, codigo: s.obra_codigo as string, nome: s.obra_nome as string } : null,
          status: s.status,
          finalizadaEm: s.finalizada_em,
          observacao: s.observacao,
          solicitante: s.solicitante,
          itens: s.itens,
          resumo: s.resumo,
          diasAberta: abertas.includes(s.status) ? diasEntre(s.data, hoje) : null,
          urgente: abertas.includes(s.status) && !!s.necessidade && s.necessidade <= somarDias(hoje, 3),
        })),
      };
    });

    app.get<{ Params: { id: string } }>('/solicitacoes/:id', async (req) => ({ solicitacao: await detalharSolicitacao(banco, empresaDo(req), req.params.id) }));

    app.post('/solicitacoes', async (req, reply) => {
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      if (ehServico(req.body)) {
        const ds = esquemaServico.parse(req.body);
        const idServico = await emTransacao(banco, async (c) => {
          const obra = (await c.query('SELECT id, centro_custo_id FROM obras WHERE id = $1 AND empresa_id = $2 AND ativo', [ds.obraId, empresaId])).rows[0];
          if (!obra) throw new ErroHttp(400, 'Obra não encontrada.');
          await validarPlanoConta(c, empresaId, ds.planoContaId);
          const itens = await resolverServicos(c, ds.obraId, ds.itens);
          const numero = await proximoNumero(c, 'solicitacoes_compra', empresaId);
          const s = (
            await c.query(
              `INSERT INTO solicitacoes_compra (empresa_id, numero, data, necessidade, obra_id, centro_custo_id, observacao, solicitante_id, tipo, plano_conta_id, escopo_servico)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'servico', $9, $10) RETURNING id`,
              [empresaId, numero, ds.data ?? hojeBrasil(), ds.necessidade, ds.obraId, obra.centro_custo_id, ds.observacao, u.id, ds.planoContaId, ds.escopo],
            )
          ).rows[0];
          await gravarItensSolicitacao(c, empresaId, s.id, itens);
          await auditar(c, { empresaId, usuarioId: u.id, acao: 'criar', entidade: 'solicitacoes_compra', entidadeId: s.id, depois: { numero, tipo: 'servico', itens: itens.length } });
          return s.id as string;
        });
        reply.code(201);
        return { solicitacao: await detalharSolicitacao(banco, empresaId, idServico) };
      }
      const d = esquemaSolicitacao.parse(req.body);
      const id = await emTransacao(banco, async (c) => {
        const obra = (await c.query('SELECT id, centro_custo_id FROM obras WHERE id = $1 AND empresa_id = $2 AND ativo', [d.obraId, empresaId])).rows[0];
        if (!obra) throw new ErroHttp(400, 'Obra não encontrada.');
        const itens = await resolverNecessidades(c, empresaId, d.obraId, await criarNecessidadesDaSolicitacao(c, d.obraId, d.itens));
        const numero = await proximoNumero(c, 'solicitacoes_compra', empresaId);
        const s = (
          await c.query(
            `INSERT INTO solicitacoes_compra (empresa_id, numero, data, necessidade, obra_id, centro_custo_id, observacao, solicitante_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [empresaId, numero, d.data ?? hojeBrasil(), d.necessidade, d.obraId, obra.centro_custo_id, d.observacao, u.id],
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
      const empresaId = empresaDo(req);
      const atual = await detalharSolicitacao(banco, empresaId, req.params.id);
      const servico = atual.tipo === 'servico';
      const d = servico ? esquemaServico.parse(req.body) : esquemaSolicitacao.parse(req.body);
      if (atual.status !== 'aberta') throw new ErroHttp(409, 'Só dá para alterar solicitação aberta (não finalizada e sem cotação).');
      await emTransacao(banco, async (c) => {
        const obra = (await c.query('SELECT id, centro_custo_id FROM obras WHERE id = $1 AND empresa_id = $2 AND ativo', [d.obraId, empresaId])).rows[0];
        if (!obra) throw new ErroHttp(400, 'Obra não encontrada.');
        await liberarNecessidades(c, atual.id);
        const itens = servico
          ? await resolverServicos(c, d.obraId, (d as z.infer<typeof esquemaServico>).itens)
          : await resolverNecessidades(c, empresaId, d.obraId, await criarNecessidadesDaSolicitacao(c, d.obraId, (d as z.infer<typeof esquemaSolicitacao>).itens));
        if (servico) {
          const planoId = (d as z.infer<typeof esquemaServico>).planoContaId;
          await validarPlanoConta(c, empresaId, planoId);
          await c.query('UPDATE solicitacoes_compra SET plano_conta_id = $2, escopo_servico = $3 WHERE id = $1', [atual.id, planoId, (d as z.infer<typeof esquemaServico>).escopo]);
        }
        await c.query(
          'UPDATE solicitacoes_compra SET obra_id = $2, centro_custo_id = $3, data = coalesce($4, data), necessidade = $5, observacao = $6, atualizado_em = now() WHERE id = $1',
          [atual.id, d.obraId, obra.centro_custo_id, d.data, d.necessidade, d.observacao],
        );
        await gravarItensSolicitacao(c, empresaId, atual.id, itens);
        await auditar(c, { empresaId, usuarioId: usuarioDe(req).id, acao: 'alterar', entidade: 'solicitacoes_compra', entidadeId: atual.id, antes: { itens: atual.itens.length }, depois: { itens: itens.length } });
      });
      return { solicitacao: await detalharSolicitacao(banco, empresaId, atual.id) };
    });

    /** Finalizar: a solicitação fica disponível para cotação (e só então aparece no mapa de cotações). */
    app.post<{ Params: { id: string } }>('/solicitacoes/:id/finalizar', async (req) => {
      const empresaId = empresaDo(req);
      const atual = await detalharSolicitacao(banco, empresaId, req.params.id);
      if (atual.status !== 'aberta') throw new ErroHttp(409, 'Esta solicitação já foi finalizada ou está em cotação.');
      if (!atual.itens.length) throw new ErroHttp(400, 'Inclua pelo menos um insumo antes de finalizar.');
      await emTransacao(banco, async (c) => {
        await c.query("UPDATE solicitacoes_compra SET status = 'finalizada', finalizada_em = now(), atualizado_em = now() WHERE id = $1", [atual.id]);
        await auditar(c, { empresaId, usuarioId: usuarioDe(req).id, acao: 'alterar', entidade: 'solicitacoes_compra', entidadeId: atual.id, depois: { status: 'finalizada' } });
      });
      return { solicitacao: await detalharSolicitacao(banco, empresaId, atual.id) };
    });

    app.post<{ Params: { id: string } }>('/solicitacoes/:id/reabrir', async (req) => {
      const empresaId = empresaDo(req);
      const atual = await detalharSolicitacao(banco, empresaId, req.params.id);
      if (atual.status !== 'finalizada') throw new ErroHttp(409, 'Só dá para reabrir solicitação finalizada.');
      await emTransacao(banco, async (c) => {
        await c.query("UPDATE solicitacoes_compra SET status = 'aberta', finalizada_em = NULL, atualizado_em = now() WHERE id = $1", [atual.id]);
        await auditar(c, { empresaId, usuarioId: usuarioDe(req).id, acao: 'alterar', entidade: 'solicitacoes_compra', entidadeId: atual.id, depois: { status: 'aberta' } });
      });
      return { solicitacao: await detalharSolicitacao(banco, empresaId, atual.id) };
    });

    app.post<{ Params: { id: string } }>('/solicitacoes/:id/cancelar', async (req) => {
      const empresaId = empresaDo(req);
      const atual = await detalharSolicitacao(banco, empresaId, req.params.id);
      if (!['aberta', 'finalizada', 'em_cotacao'].includes(atual.status)) throw new ErroHttp(409, 'Esta solicitação já foi atendida ou cancelada.');
      if (atual.cotacoes.some((c: { status: string }) => c.status === 'aberta')) throw new ErroHttp(409, 'Cancele antes a cotação aberta desta solicitação.');
      await emTransacao(banco, async (c) => {
        await liberarNecessidades(c, atual.id);
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

    /** Cotação sempre parte de uma solicitação finalizada; os itens são os da solicitação (obra, EAP e necessidade). */
    app.post('/cotacoes', async (req, reply) => {
      const d = z
        .object({
          solicitacaoId: z.string().regex(UUID, 'Escolha a solicitação finalizada.'),
          data: dataOpc,
          prazoResposta: dataOpc,
          observacao: texto(500),
          fornecedorIds: z.array(z.string().regex(UUID)).max(10, 'Até 10 fornecedores por cotação.').default([]),
        })
        .parse(req.body);
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      const id = await emTransacao(banco, async (c) => {
        const s = (await c.query('SELECT status FROM solicitacoes_compra WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [d.solicitacaoId, empresaId])).rows[0];
        if (!s) throw new ErroHttp(400, 'Solicitação não encontrada.');
        if (s.status !== 'finalizada') throw new ErroHttp(409, 'Só dá para cotar solicitação finalizada.');
        await validarAtuacaoFornecedores(c, empresaId, d.solicitacaoId, d.fornecedorIds);
        const r = await c.query('SELECT * FROM solicitacoes_itens WHERE solicitacao_id = $1 ORDER BY descricao', [d.solicitacaoId]);
        if (!r.rows.length) throw new ErroHttp(400, 'A solicitação não tem itens.');
        const itens = r.rows.map((x) => ({
          solicitacaoItemId: x.id as string,
          necessidadeId: x.necessidade_id as string | null,
          obraItemId: x.obra_item_id as string | null,
          eapNoId: x.eap_no_id as string | null,
          descricao: x.descricao as string,
          unidade: x.unidade as string,
          quantidade: Number(x.quantidade),
        }));
        const numero = await proximoNumero(c, 'cotacoes', empresaId);
        const ct = (
          await c.query(
            'INSERT INTO cotacoes (empresa_id, numero, data, prazo_resposta, solicitacao_id, observacao, criado_por_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
            [empresaId, numero, d.data ?? hojeBrasil(), d.prazoResposta, d.solicitacaoId, d.observacao, u.id],
          )
        ).rows[0];
        for (const i of itens)
          await c.query(
            `INSERT INTO cotacoes_itens (empresa_id, cotacao_id, solicitacao_item_id, descricao, unidade, quantidade, obra_item_id, eap_no_id, necessidade_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [empresaId, ct.id, i.solicitacaoItemId, i.descricao, i.unidade, i.quantidade, i.obraItemId, i.eapNoId, i.necessidadeId],
          );
        for (const f of [...new Set(d.fornecedorIds)]) {
          await validarFornecedor(c, empresaId, f);
          await c.query('INSERT INTO cotacoes_fornecedores (empresa_id, cotacao_id, fornecedor_id) VALUES ($1, $2, $3)', [empresaId, ct.id, f]);
        }
        await c.query("UPDATE solicitacoes_compra SET status = 'em_cotacao', atualizado_em = now() WHERE id = $1", [d.solicitacaoId]);
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
        await validarAtuacaoCotacao(c, empresaId, req.params.id, ids);
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
          desconto: naoNegativo('Desconto inválido.').optional().default(0),
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
          'UPDATE cotacoes_fornecedores SET prazo_entrega_dias = $2, condicao_pagamento = $3, frete_centavos = $4, validade = $5, observacao = $6, desconto_centavos = $7 WHERE id = $1',
          [req.params.cf, d.prazoEntregaDias, d.condicaoPagamento, cent(d.frete), d.validade, d.observacao, cent(d.desconto)],
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

    // ----- Saldo de um serviço da obra: orçado, já contratado, já medido e o que ainda pode ser contratado -----
    app.get<{ Params: { obraItemId: string }; Querystring: { obraId?: string } }>('/servicos/:obraItemId/saldo', async (req) => {
      const empresaId = empresaDo(req);
      const obraId = req.query.obraId ?? '';
      const itemId = req.params.obraItemId;
      if (!UUID.test(obraId) || !UUID.test(itemId)) throw new ErroHttp(400, 'Informe a obra e o serviço.');
      if (!(await banco.query('SELECT 1 FROM obras WHERE id = $1 AND empresa_id = $2', [obraId, empresaId])).rowCount) throw naoEncontrado('Obra');
      const v = (
        await banco.query(
          `SELECT
             (SELECT coalesce(sum(oq.quantidade), 0) FROM orcamento_itens oq WHERE oq.obra_id = $1 AND oq.obra_item_id = $2) AS orcado,
             (SELECT coalesce(sum(ci.quantidade), 0) FROM contratos_itens ci JOIN contratos k ON k.id = ci.contrato_id
                WHERE k.obra_id = $1 AND ci.obra_item_id = $2 AND k.empresa_id = $3 AND k.status <> 'cancelado') AS contratado,
             (SELECT coalesce(sum(mi.quantidade), 0) FROM medicoes_itens mi JOIN medicoes m ON m.id = mi.medicao_id
                JOIN contratos_itens ci ON ci.id = mi.contrato_item_id JOIN contratos k ON k.id = ci.contrato_id
                WHERE k.obra_id = $1 AND ci.obra_item_id = $2 AND k.empresa_id = $3 AND m.status = 'aprovada') AS medido,
             (SELECT unidade FROM obra_itens WHERE id = $2 AND obra_id = $1) AS unidade`,
          [obraId, itemId, empresaId],
        )
      ).rows[0];
      const orcado = Number(v.orcado);
      const contratado = Number(v.contratado);
      return {
        saldo: {
          orcado: r3(orcado),
          contratado: r3(contratado),
          medido: r3(Number(v.medido)),
          saldoContratar: r3(orcado - contratado),
          unidade: (v.unidade as string | null) ?? null,
        },
      };
    });

    // ----- Leitura da proposta do fornecedor por IA (PDF ou foto) -----
    // Só sugere preços e condições: nada é gravado aqui. O usuário confere na tela e salva pela resposta do fornecedor.
    app.get('/cotacoes/leitura-ia', async () => ({ ia: iaDisponivel() }));

    app.post<{ Params: { id: string } }>('/cotacoes/:id/leitura-ia', { bodyLimit: 16 * 1024 * 1024 }, async (req) => {
      const d = z
        .object({
          arquivo: z.string({ required_error: 'Envie a foto ou o PDF da proposta.' }).min(20, 'Arquivo vazio.'),
          tipo: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], { errorMap: () => ({ message: 'Envie um PDF ou uma foto (JPG, PNG ou WEBP).' }) }),
        })
        .parse(req.body);
      const empresaId = empresaDo(req);
      if (!UUID.test(req.params.id)) throw naoEncontrado('Cotação');
      const ct = (await banco.query('SELECT status FROM cotacoes WHERE id = $1 AND empresa_id = $2', [req.params.id, empresaId])).rows[0];
      if (!ct) throw naoEncontrado('Cotação');
      if (ct.status !== 'aberta') throw new ErroHttp(409, 'Esta cotação já foi concluída ou cancelada.');
      if (!iaDisponivel()) throw new ErroHttp(503, 'A leitura por IA não está configurada. Preencha os preços manualmente.');
      const bytes = Buffer.from(d.arquivo, 'base64');
      if (bytes.length > 10 * 1024 * 1024) throw new ErroHttp(400, 'Arquivo grande demais (máximo 10 MB).');
      const itens = (
        await banco.query(
          `SELECT ci.id, oi.codigo, ci.descricao, ci.unidade, ci.quantidade
             FROM cotacoes_itens ci LEFT JOIN obra_itens oi ON oi.id = ci.obra_item_id
            WHERE ci.cotacao_id = $1 ORDER BY ci.descricao`,
          [req.params.id],
        )
      ).rows.map((x) => ({ id: x.id as string, codigo: (x.codigo as string | null) ?? null, descricao: x.descricao as string, unidade: x.unidade as string, quantidade: Number(x.quantidade) }));
      if (!itens.length) throw new ErroHttp(400, 'Esta cotação não tem itens.');
      try {
        return await lerPropostaComIa(bytes, d.tipo, itens);
      } catch (e) {
        if (e instanceof ErroIa) throw new ErroHttp(502, e.message);
        throw e;
      }
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
        const solServico = mapa.solicitacaoId ? (await c.query('SELECT tipo, numero, plano_conta_id, obra_id, centro_custo_id FROM solicitacoes_compra WHERE id = $1', [mapa.solicitacaoId])).rows[0] : null;
        const ehServicoCotacao = solServico?.tipo === 'servico';
        for (const f of ehServicoCotacao ? [] : mapa.fornecedores.filter((x) => escolhidos.some((i) => i.vencedorId === x.id))) {
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
            .map((i) => {
              if (!i.necessidadeId || !i.obraItemId || !i.eapNoId) throw new ErroHttp(400, `${i.descricao}: item sem insumo da obra apropriado à EAP. Refaça a solicitação.`);
              return {
                necessidadeId: i.necessidadeId,
                obraItemId: i.obraItemId,
                eapNoId: i.eapNoId,
                codigo: i.codigo ?? '',
                descricao: i.descricao,
                unidade: i.unidade,
                quantidade: i.quantidade,
                observacao: null,
                precoUnitario: Math.round(i.ofertas.find((o) => o.cotacaoFornecedorId === f.id)!.precoUnitario * (f.subtotal > 0 ? 1 - f.desconto / f.subtotal : 1) * 10000) / 10000,
                cotacaoItemId: i.id,
              };
            });
          await gravarItensPedido(c, empresaId, p.id, itens, cent(f.frete));
          await auditar(c, { empresaId, usuarioId: u.id, acao: 'criar', entidade: 'pedidos_compra', entidadeId: p.id, depois: { numero, cotacao: mapa.numero } });
          criados.push({ id: p.id, numero });
        }
        // Necessidades: as compradas ficam "comprada"; as que não foram escolhidas voltam a pendente para nova cotação.
        const naoEscolhidos = mapa.itens.filter((i) => !i.vencedorId && i.necessidadeId).map((i) => i.necessidadeId as string);
        await c.query("UPDATE obra_necessidades SET status = 'comprada', atualizado_em = now() WHERE id = ANY($1::uuid[])", [escolhidos.map((i) => i.necessidadeId)]);
        if (naoEscolhidos.length) await c.query("UPDATE obra_necessidades SET status = 'pendente', atualizado_em = now() WHERE id = ANY($1::uuid[]) AND status = 'solicitada'", [naoEscolhidos]);
        await c.query("UPDATE cotacoes SET status = 'concluida', concluida_em = now(), atualizado_em = now() WHERE id = $1", [mapa.id]);
        if (mapa.solicitacaoId) await c.query("UPDATE solicitacoes_compra SET status = 'atendida', atualizado_em = now() WHERE id = $1", [mapa.solicitacaoId]);
        const contratos = ehServicoCotacao ? await gerarContratosDoServico(c, empresaId, u.id, mapa, escolhidos, solServico) : [];
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'confirmar', entidade: 'cotacoes', entidadeId: mapa.id, depois: { pedidos: criados.map((x) => x.numero), contratos: contratos.map((x) => x.numero), economia: mapa.resumo.economiaMaior } });
        return { pedidos: criados, contratos };
      });
      return { pedidos: pedidos.pedidos, contratos: pedidos.contratos, cotacao: await detalharCotacao(banco, empresaId, req.params.id) };
    });

    app.post<{ Params: { id: string } }>('/cotacoes/:id/cancelar', async (req) => {
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        await cotacaoAberta(c, empresaId, req.params.id);
        const ct = (await c.query("UPDATE cotacoes SET status = 'cancelada', atualizado_em = now() WHERE id = $1 RETURNING solicitacao_id", [req.params.id])).rows[0];
        // A solicitação volta a ficar finalizada (pronta para nova cotação) se não houver outra cotação em andamento.
        if (ct.solicitacao_id)
          await c.query(
            `UPDATE solicitacoes_compra SET status = 'finalizada', atualizado_em = now()
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
      const u = usuarioDe(req);
      const soConferencia = u.perfil === 'almoxarife';
      const obras = soConferencia ? (await obrasPermitidas(banco, empresaId, u)) ?? [] : [];
      const r = await banco.query(
        `SELECT p.id, p.numero, p.data, p.status, p.previsao_entrega, p.total_centavos, p.aprovacao_automatica,
                coalesce(f.nome_fantasia, f.razao_social) AS fornecedor, ct.numero AS cotacao_numero, ua.nome AS aprovado_por,
                (SELECT string_agg(pi.descricao, ', ' ORDER BY pi.descricao) FROM pedidos_itens pi WHERE pi.pedido_id = p.id) AS resumo,
                (SELECT count(*)::int FROM notas_fiscais n WHERE n.pedido_id = p.id AND n.excluido_em IS NULL AND n.status <> 'cancelada') AS notas
           FROM pedidos_compra p JOIN fornecedores f ON f.id = p.fornecedor_id
           LEFT JOIN cotacoes ct ON ct.id = p.cotacao_id LEFT JOIN usuarios ua ON ua.id = p.aprovado_por_id
          WHERE p.empresa_id = $1
            AND ($4::boolean = false OR (p.status IN ('aprovado', 'enviado', 'parcial', 'recebido', 'encerrado') AND ${SQL_PEDIDO_DAS_OBRAS.replace('%N', '5')}))
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
        [empresaId, filtro, hoje, soConferencia, obras],
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

    app.get<{ Params: { id: string } }>('/pedidos/:id', async (req) => {
      const u = usuarioDe(req);
      const empresaId = empresaDo(req);
      if (u.perfil === 'almoxarife') {
        // Conferência no recebimento: o almoxarife vê o pedido depois de aprovado, com preços, mas não o altera.
        const obras = (await obrasPermitidas(banco, empresaId, u)) ?? [];
        const st = (
          await banco.query(
            `SELECT p.status FROM pedidos_compra p WHERE p.id = $1 AND p.empresa_id = $2 AND ${SQL_PEDIDO_DAS_OBRAS.replace('%N', '3')}`,
            [UUID.test(req.params.id) ? req.params.id : null, empresaId, obras],
          )
        ).rows[0];
        if (!st || !['aprovado', 'enviado', 'parcial', 'recebido', 'encerrado'].includes(st.status)) throw naoEncontrado('Pedido');
      }
      return { pedido: await detalharPedido(banco, empresaId, req.params.id, u) };
    });

    const pedidoPara = async (c: Cliente, empresaId: string, id: string) => {
      if (!UUID.test(id)) throw naoEncontrado('Pedido');
      const p = (await c.query('SELECT * FROM pedidos_compra WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [id, empresaId])).rows[0];
      if (!p) throw naoEncontrado('Pedido');
      return p as LinhaPedido;
    };

    // Pedidos nascem da cotação concluída (um por fornecedor vencedor). Aqui só o cabeçalho é editado; os itens são os da cotação.
    app.put<{ Params: { id: string } }>('/pedidos/:id', async (req) => {
      const d = esquemaPedido.parse(req.body);
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      await emTransacao(banco, async (c) => {
        const p = await pedidoPara(c, empresaId, req.params.id);
        if (!['rascunho', 'reprovado'].includes(p.status)) throw new ErroHttp(409, 'Só dá para alterar pedido em rascunho ou reprovado. Depois de aprovado, cancele e faça outro.');
        await validarFornecedor(c, empresaId, d.fornecedorId);
        await validarCentro(c, empresaId, d.centroCustoId);
        if (d.freteTipo === 'transportadora') {
          if (!d.transportadoraId) throw new ErroHttp(400, 'Escolha o fornecedor de transporte.');
          await validarFornecedor(c, empresaId, d.transportadoraId);
        }
        // Transporte próprio e "sem frete" não têm transportadora.
        const transportadoraId = d.freteTipo === 'transportadora' ? d.transportadoraId : null;
        await c.query(
          `UPDATE pedidos_compra SET fornecedor_id = $2, data = coalesce($3, data), previsao_entrega = $4, condicao_pagamento = $5, local_entrega = $6,
                  frete_centavos = $7, centro_custo_id = $8, observacao = $9, frete_tipo = $10, transportadora_id = $11,
                  status = 'rascunho', motivo_reprovacao = NULL, atualizado_em = now() WHERE id = $1`,
          [p.id, d.fornecedorId, d.data, d.previsaoEntrega, d.condicaoPagamento, d.localEntrega, cent(d.frete), d.centroCustoId, d.observacao, d.freteTipo, transportadoraId],
        );
        // Total = itens + frete. Sem recalcular aqui, o frete editado não entrava no total do pedido.
        await recalcularTotalPedido(c, p.id);
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
        // Pedido gerado por uma cotação: se nada mais ficou ativo, a compra volta a ficar pendente para nova cotação.
        const origem = (await c.query('SELECT cotacao_id, solicitacao_id FROM pedidos_compra WHERE id = $1', [p.id])).rows[0];
        if (origem?.cotacao_id) {
          const necessidades = (
            await c.query(
              `SELECT DISTINCT pi.necessidade_id FROM pedidos_itens pi WHERE pi.pedido_id = $1 AND pi.necessidade_id IS NOT NULL
                 AND NOT EXISTS (SELECT 1 FROM pedidos_itens o JOIN pedidos_compra op ON op.id = o.pedido_id
                                  WHERE o.necessidade_id = pi.necessidade_id AND op.id <> $1 AND op.status <> 'cancelado')`,
              [p.id],
            )
          ).rows.map((r) => r.necessidade_id);
          if (necessidades.length)
            await c.query("UPDATE obra_necessidades SET status = 'pendente', atualizado_em = now() WHERE id = ANY($1::uuid[]) AND status = 'comprada'", [necessidades]);
          const outroPedido = (await c.query("SELECT 1 FROM pedidos_compra WHERE cotacao_id = $1 AND id <> $2 AND status <> 'cancelado'", [origem.cotacao_id, p.id])).rowCount;
          const contrato = (await c.query('SELECT 1 FROM contratos WHERE cotacao_id = $1', [origem.cotacao_id])).rowCount;
          if (origem.solicitacao_id && !outroPedido && !contrato) {
            const outraCompra = (await c.query("SELECT 1 FROM pedidos_compra WHERE solicitacao_id = $1 AND id <> $2 AND status <> 'cancelado'", [origem.solicitacao_id, p.id])).rowCount;
            if (!outraCompra)
              await c.query("UPDATE solicitacoes_compra SET status = 'finalizada', atualizado_em = now() WHERE id = $1 AND status = 'atendida'", [origem.solicitacao_id]);
          }
        }
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'alterar', entidade: 'pedidos_compra', entidadeId: p.id, antes: { status: p.status }, depois: { status: 'cancelado', motivo: d.motivo } });
      });
      return { pedido: await detalharPedido(banco, empresaId, req.params.id, u) };
    });

    // Reabre um pedido cancelado: volta para rascunho. Só vale se nenhuma nota estiver ligada a ele
    // e se a compra não tiver sido refeita em outra cotação.
    app.post<{ Params: { id: string } }>('/pedidos/:id/reabrir', async (req) => {
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      await emTransacao(banco, async (c) => {
        const p = await pedidoPara(c, empresaId, req.params.id);
        if (p.status !== 'cancelado') throw new ErroHttp(409, 'Só dá para reabrir pedido cancelado.');
        if ((await c.query("SELECT 1 FROM notas_fiscais WHERE pedido_id = $1 AND excluido_em IS NULL AND status <> 'cancelada'", [p.id])).rowCount)
          throw new ErroHttp(409, 'Há nota ligada a este pedido. Não dá para reabri-lo.');
        const origem = (await c.query('SELECT cotacao_id, solicitacao_id FROM pedidos_compra WHERE id = $1', [p.id])).rows[0];
        if (origem?.solicitacao_id) {
          const sol = (await c.query('SELECT status FROM solicitacoes_compra WHERE id = $1 FOR UPDATE', [origem.solicitacao_id])).rows[0];
          if (sol && !['finalizada', 'atendida'].includes(sol.status))
            throw new ErroHttp(409, 'A solicitação deste pedido está sendo cotada de novo. Cancele a cotação em andamento antes de reabrir o pedido.');
          const outraCompra = (await c.query("SELECT 1 FROM pedidos_compra WHERE solicitacao_id = $1 AND id <> $2 AND status NOT IN ('cancelado')", [origem.solicitacao_id, p.id])).rowCount;
          if (outraCompra) throw new ErroHttp(409, 'Esta solicitação já tem outro pedido ativo. Não dá para reabrir este.');
          if (sol?.status === 'finalizada') await c.query("UPDATE solicitacoes_compra SET status = 'atendida', atualizado_em = now() WHERE id = $1", [origem.solicitacao_id]);
        }
        // As necessidades que o pedido cobria voltam a comprada, se ainda estiverem pendentes.
        await c.query(
          "UPDATE obra_necessidades SET status = 'comprada', atualizado_em = now() WHERE status = 'pendente' AND id IN (SELECT necessidade_id FROM pedidos_itens WHERE pedido_id = $1 AND necessidade_id IS NOT NULL)",
          [p.id],
        );
        await c.query("UPDATE pedidos_compra SET status = 'rascunho', encerrado_motivo = NULL, atualizado_em = now() WHERE id = $1", [p.id]);
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'alterar', entidade: 'pedidos_compra', entidadeId: p.id, antes: { status: 'cancelado' }, depois: { status: 'rascunho' } });
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
          if (i.pedidoItemId) ligados++;
        }
        if (!ligados) throw new ErroHttp(400, 'Ligue pelo menos um item da nota a um item do pedido.');
        await c.query('UPDATE notas_fiscais SET pedido_id = $2, atualizado_em = now() WHERE id = $1', [n.id, p.id]);
        // A nota herda a obra, o insumo da obra e a etapa do item do pedido (só onde ainda não estão preenchidos).
        await c.query(
          `UPDATE notas_itens ni SET obra_item_id = coalesce(ni.obra_item_id, pi.obra_item_id), eap_no_id = coalesce(ni.eap_no_id, pi.eap_no_id),
                  obra_id = coalesce(ni.obra_id, oi.obra_id)
             FROM pedidos_itens pi LEFT JOIN obra_itens oi ON oi.id = pi.obra_item_id
            WHERE pi.id = ni.pedido_item_id AND ni.nota_id = $1`,
          [n.id],
        );
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
          `SELECT pi.descricao, pi.unidade, max(oi.codigo) AS codigo, sum(pi.quantidade) AS quantidade, sum(pi.quantidade * pi.preco_unitario_centavos) AS valor,
                  min(pi.preco_unitario_centavos) AS menor, max(pi.preco_unitario_centavos) AS maior, count(DISTINCT p.fornecedor_id)::int AS fornecedores
             FROM pedidos_itens pi JOIN pedidos_compra p ON p.id = pi.pedido_id LEFT JOIN obra_itens oi ON oi.id = pi.obra_item_id
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
          `SELECT s.numero, s.data, s.necessidade, s.status, o.nome AS obra, u.nome AS solicitante,
                  (SELECT json_agg(json_build_object('d', si.descricao, 'q', si.quantidade, 'u', si.unidade) ORDER BY si.descricao) FROM solicitacoes_itens si WHERE si.solicitacao_id = s.id) AS itens
             FROM solicitacoes_compra s LEFT JOIN usuarios u ON u.id = s.solicitante_id LEFT JOIN obras o ON o.id = s.obra_id
            WHERE s.empresa_id = $1 AND s.status IN ('aberta', 'finalizada', 'em_cotacao') ORDER BY s.necessidade NULLS LAST, s.numero`,
          [empresaId],
        )
      ).rows.map((x) => ({ numero: x.numero, data: x.data, necessidade: x.necessidade, status: x.status, obra: x.obra, solicitante: x.solicitante, itens: ((x.itens ?? []) as { d: string; q: number; u: string }[]).map((i) => `${i.d} (${Number(i.q).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${i.u === 'm3' ? 'm³' : i.u})`).join(', '), dias: diasEntre(x.data, hoje) }));

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
      const itens: { tipo: 'pedido' | 'contrato' | 'medicao' | 'autorizacao' | 'venda'; id: string; numero: number; titulo: string; pessoa: string; resumo: string | null; valor: number; enviadoEm: string; criadoPor: string | null; link: string; podeAprovar: boolean }[] = r.rows.map((p) => ({
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
      // Vendas do Comercial: só o dono ou o gestor aprova.
      const vds = await banco.query(
        `SELECT v.id, v.numero, v.volume_m3, v.preco_m3_centavos, v.taxa_bomba_centavos, v.data_entrega, v.enviado_aprovacao_em, v.bombeamento, v.condicao_pagamento,
                coalesce(cl.nome_fantasia, cl.razao_social) AS cliente, t.codigo AS traco, uv.nome AS vendedor
           FROM vendas v JOIN clientes cl ON cl.id = v.cliente_id JOIN tracos t ON t.id = v.traco_id JOIN usuarios uv ON uv.id = v.vendedor_id
          WHERE v.empresa_id = $1 AND v.status = 'aguardando_aprovacao' ORDER BY v.enviado_aprovacao_em`,
        [empresaId],
      );
      for (const v of vds.rows) {
        const valor = Math.round(Number(v.volume_m3) * Number(v.preco_m3_centavos)) + Number(v.taxa_bomba_centavos ?? 0);
        const dia = (v.data_entrega instanceof Date ? v.data_entrega.toISOString() : String(v.data_entrega)).slice(0, 10).split('-').reverse().join('/');
        itens.push({
          tipo: 'venda', id: v.id, numero: v.numero, titulo: `Venda nº ${String(v.numero).padStart(4, '0')}`, pessoa: v.cliente,
          resumo: `${Number(v.volume_m3).toLocaleString('pt-BR')} m³ de ${v.traco} para ${dia}${v.bombeamento ? ' · com bombeamento' : ''}${v.condicao_pagamento ? ` · ${v.condicao_pagamento}` : ''} · vendedor ${v.vendedor}`,
          valor: reais(valor)!, enviadoEm: v.enviado_aprovacao_em, criadoPor: v.vendedor, link: `/com/vendas/${v.id}`, podeAprovar: u.perfil === 'dono' || u.perfil === 'gestor',
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
