// Módulo Financeiro (Etapa 4): contas, plano de contas, centros de custo, lançamentos,
// contas a pagar e a receber (parcelas), baixas e transferências. Só dono e gestor.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Banco, Cliente } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { acessaFinanceiro } from '../lib/perfis.ts';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';
import { hojeBrasil } from '../lib/frota.ts';
import {
  CENTROS_CUSTO_PADRAO,
  type ContaPadrao,
  codigoPai,
  PLANO_CONTAS_PADRAO,
  proximaRecorrencia,
  situacaoParcela,
  somarDias,
  valorPago,
} from '../lib/financeiro.ts';
import { empresaDo, exigir } from '../sessao.ts';
import { ErroIa, iaDisponivel } from '../lib/ia-nota.ts';
import { lerLancamentoComIa } from '../lib/ia-lancamento.ts';
import {
  estoqueDaMovimentacao,
  registrarEntradasLancamento,
  removerEntradasLancamento,
  SQL_SALDOS,
  validarApropriacaoObra,
} from '../lib/estoque.ts';

// ---------- Esquemas ----------
export function numeroBr(v: unknown): unknown {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim().replace(/\s/g, '').replace(/^R\$/i, '');
  let n = s;
  if (s.includes(',')) n = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) n = s.replace(/\./g, '');
  const x = Number(n);
  return Number.isFinite(x) ? x : v;
}
/** Valor em reais (aceita "1.234,56") convertido para centavos inteiros. */
export const dinheiro = (campo: string, { positivo = true } = {}) =>
  z.preprocess(
    // Campo vazio: obrigatório vira "Informe…"; opcional (juros, desconto) vira zero.
    (v) => numeroBr(v) ?? (positivo ? undefined : 0),
    z
      .number({ required_error: `Informe ${campo}.`, invalid_type_error: `${campo[0].toUpperCase()}${campo.slice(1)}: valor inválido.` })
      .min(positivo ? 0.01 : 0, `Informe ${campo}.`)
      .max(100_000_000, `${campo[0].toUpperCase()}${campo.slice(1)} acima do permitido.`)
      .transform((v) => Math.round(v * 100)),
  );
const dataObrig = (msg: string) => z.string({ required_error: msg }).regex(/^\d{4}-\d{2}-\d{2}$/, msg);
const textoOpc = (max = 200) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const uuidOpc = z.union([z.string().uuid(), z.literal(''), z.null()]).optional().transform((v) => v || null);
const FORMAS = ['pix', 'boleto', 'transferencia', 'cartao', 'dinheiro', 'cheque', 'debito_automatico'] as const;
const formaOpc = z.union([z.enum(FORMAS), z.literal(''), z.null()]).optional().transform((v) => v || null);
const LINHAS = [
  'receita_bruta', 'deducoes', 'custo_producao', 'custo_frota', 'custo_pessoal', 'despesas_pessoal', 'despesas_administrativas',
  'despesas_comerciais', 'receitas_financeiras', 'despesas_financeiras', 'outras_receitas', 'outras_despesas', 'impostos_lucro', 'fora_dre',
] as const;

const camposConta = {
  nome: z.string({ required_error: 'Dê um nome à conta.' }).trim().min(2, 'Dê um nome à conta.').max(80),
  tipo: z.enum(['banco', 'caixa', 'cartao', 'aplicacao']).optional().default('banco'),
  banco: textoOpc(80),
  agencia: textoOpc(20),
  conta: textoOpc(30),
  saldoInicial: z.preprocess(numeroBr, z.number({ invalid_type_error: 'Saldo inicial inválido.' }).min(-100_000_000).max(100_000_000).nullable())
    .optional()
    .transform((v) => Math.round((v ?? 0) * 100)),
  dataSaldoInicial: dataObrig('Data do saldo inicial inválida.').optional(),
  ativo: z.boolean().optional(),
};
const esquemaConta = z.object(camposConta);
const esquemaAlterarConta = z.object(camposConta).partial().strict();

const esquemaPlano = z.object({
  codigo: z.string({ required_error: 'Informe o código.' }).trim().regex(/^\d+(\.\d+)*$/, 'Código no formato 4.2 ou 4.2.1.'),
  nome: z.string({ required_error: 'Informe o nome.' }).trim().min(2, 'Informe o nome.').max(120),
  tipo: z.enum(['receita', 'despesa']),
  linhaDre: z.enum(LINHAS),
  aceitaLancamento: z.boolean().optional().default(true),
});
const esquemaAlterarPlano = z
  .object({ nome: z.string().trim().min(2).max(120), linhaDre: z.enum(LINHAS), tipo: z.enum(['receita', 'despesa']), ativo: z.boolean() })
  .partial()
  .strict();

const esquemaCentro = z.object({
  nome: z.string({ required_error: 'Informe o nome.' }).trim().min(2, 'Informe o nome.').max(60),
  ativo: z.boolean().optional(),
});

const esquemaApropriacao = z.object({
  planoContaId: z.string({ required_error: 'Escolha a categoria.' }).uuid('Escolha a categoria.'),
  centroCustoId: uuidOpc,
  veiculoId: uuidOpc,
  descricao: textoOpc(200),
  valor: dinheiro('o valor da categoria').optional(),
});
const esquemaParcela = z.object({
  vencimento: dataObrig('Vencimento de parcela inválido.'),
  valor: dinheiro('o valor da parcela'),
});
export const esquemaBaixa = z.object({
  data: dataObrig('Data do pagamento inválida.'),
  contaId: z.string({ required_error: 'Escolha a conta.' }).uuid('Escolha a conta.'),
  forma: formaOpc,
  juros: dinheiro('os juros', { positivo: false }).optional().default(0),
  desconto: dinheiro('o desconto', { positivo: false }).optional().default(0),
  observacoes: textoOpc(300),
});

const camposLancamento = {
  tipo: z.enum(['receita', 'despesa']),
  competencia: dataObrig('Data de competência inválida.'),
  descricao: z.string({ required_error: 'Descreva o lançamento.' }).trim().min(2, 'Descreva o lançamento.').max(200),
  documento: textoOpc(60),
  clienteId: uuidOpc,
  fornecedorId: uuidOpc,
  observacoes: textoOpc(1000),
  valorTotal: dinheiro('o valor total'),
  apropriacoes: z.array(esquemaApropriacao).min(1, 'Informe a categoria.').max(50),
  parcelas: z.array(esquemaParcela).min(1, 'Informe o vencimento.').max(120, 'No máximo 120 parcelas.'),
};
// Item que dá entrada no estoque da construtora: mesma apropriação de um item de nota (obra, insumo da obra, etapa e estoque).
const esquemaItemEstoque = z.object({
  descricao: z.string({ required_error: 'Descreva o item.' }).trim().min(2, 'Descreva o item.').max(200),
  quantidade: z.preprocess(numeroBr, z.number({ invalid_type_error: 'Quantidade inválida.' }).positive('Quantidade inválida.').max(10_000_000)),
  unidade: textoOpc(20),
  valor: dinheiro('o valor do item', { positivo: false }),
  obraId: z.string({ required_error: 'Escolha a obra.' }).uuid('Escolha a obra.'),
  obraItemId: z.string({ required_error: 'Escolha o insumo da obra.' }).uuid('Escolha o insumo da obra.'),
  eapNoId: z.string({ required_error: 'Escolha a etapa da EAP.' }).uuid('Escolha a etapa da EAP.'),
  obraEstoqueId: uuidOpc,
});
const esquemaLancamento = z.object({
  ...camposLancamento,
  baixa: esquemaBaixa.optional().nullable(),
  recorrencia: z.enum(['nenhuma', 'semanal', 'mensal', 'anual']).optional().default('nenhuma'),
  repeticoes: z.coerce.number().int().min(1).max(60, 'No máximo 60 repetições.').optional().default(1),
  estoque: z.array(esquemaItemEstoque).max(200, 'No máximo 200 itens de estoque.').optional().default([]),
  pedidoId: uuidOpc,
});
const esquemaEditarLancamento = z.object({ ...camposLancamento, parcelas: z.array(esquemaParcela).max(120, 'No máximo 120 parcelas.') });

// ---------- Formatos ----------
const brl = (centavos: number) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const reais = (c: unknown) => (c === null || c === undefined ? null : Number(c) / 100);

function contaPublica(r: Record<string, any>) {
  return {
    id: r.id,
    nome: r.nome,
    tipo: r.tipo,
    banco: r.banco,
    agencia: r.agencia,
    conta: r.conta,
    saldoInicial: reais(r.saldo_inicial_centavos),
    dataSaldoInicial: r.data_saldo_inicial,
    saldo: reais(r.saldo_centavos ?? r.saldo_inicial_centavos),
    ativo: r.ativo,
  };
}

function planoPublico(r: Record<string, any>) {
  return {
    id: r.id,
    codigo: r.codigo,
    nome: r.nome,
    tipo: r.tipo,
    linhaDre: r.linha_dre,
    paiId: r.pai_id,
    aceitaLancamento: r.aceita_lancamento,
    ativo: r.ativo,
  };
}

const ordemCodigo = (a: string, b: string) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? -1) - (y[i] ?? -1);
    if (d) return d;
  }
  return 0;
};

function parcelaPublica(r: Record<string, any>, hoje: string) {
  return {
    id: r.id,
    lancamentoId: r.lancamento_id,
    numero: r.numero,
    totalParcelas: r.total_parcelas ?? null,
    vencimento: r.vencimento,
    valor: reais(r.valor_centavos),
    status: r.status,
    situacao: situacaoParcela(r.status, r.vencimento, hoje),
    dataPagamento: r.data_pagamento,
    juros: reais(r.juros_centavos),
    desconto: reais(r.desconto_centavos),
    valorPago: reais(r.valor_pago_centavos),
    contaId: r.conta_financeira_id,
    contaNome: r.conta_nome ?? null,
    forma: r.forma_pagamento,
    observacoes: r.observacoes,
    ...(r.descricao !== undefined
      ? {
          tipo: r.tipo,
          descricao: r.descricao,
          documento: r.documento,
          pessoa: r.pessoa ?? null,
          categorias: r.categorias ?? null,
          competencia: r.competencia,
        }
      : {}),
  };
}

// ---------- Consultas ----------
export const SQL_SALDO = `
  c.saldo_inicial_centavos
  + coalesce((SELECT sum(CASE WHEN l.tipo = 'receita' THEN p.valor_pago_centavos ELSE -p.valor_pago_centavos END)
                FROM parcelas p JOIN lancamentos l ON l.id = p.lancamento_id
               WHERE p.conta_financeira_id = c.id AND p.status = 'paga' AND p.data_pagamento >= c.data_saldo_inicial
                 AND l.excluido_em IS NULL AND l.status = 'confirmado'), 0)
  + coalesce((SELECT sum(CASE WHEN t.conta_destino_id = c.id THEN t.valor_centavos ELSE -t.valor_centavos END)
                FROM transferencias t
               WHERE (t.conta_origem_id = c.id OR t.conta_destino_id = c.id) AND t.excluido_em IS NULL AND t.data >= c.data_saldo_inicial), 0)`;

async function carregarLancamento(c: Cliente, empresaId: string, id: string) {
  const l = (
    await c.query(
      `SELECT l.*, coalesce(cl.nome_fantasia, cl.razao_social) AS cliente_nome, coalesce(f.nome_fantasia, f.razao_social) AS fornecedor_nome,
              (SELECT count(*)::int FROM lancamentos x WHERE x.recorrencia_pai_id = coalesce(l.recorrencia_pai_id, l.id) AND x.excluido_em IS NULL) AS recorrencia_total
         FROM lancamentos l LEFT JOIN clientes cl ON cl.id = l.cliente_id LEFT JOIN fornecedores f ON f.id = l.fornecedor_id
        WHERE l.id = $1 AND l.empresa_id = $2 AND l.excluido_em IS NULL`,
      [id, empresaId],
    )
  ).rows[0];
  if (!l) throw naoEncontrado('Lançamento');
  const es = (
    await c.query(
      `SELECT li.*, ob.codigo AS obra_codigo, ob.nome AS obra_nome, oi.codigo AS insumo_codigo, oi.descricao AS insumo_descricao,
              en.codigo AS eap_codigo, en.descricao AS eap_descricao
         FROM lancamento_itens_estoque li JOIN obras ob ON ob.id = li.obra_id
         LEFT JOIN obra_itens oi ON oi.id = li.obra_item_id LEFT JOIN eap_nos en ON en.id = li.eap_no_id
        WHERE li.lancamento_id = $1 ORDER BY li.criado_em, li.id`,
      [id],
    )
  ).rows;
  const ap = (
    await c.query(
      `SELECT a.*, pc.codigo, pc.nome AS plano_nome, cc.nome AS centro_nome, v.codigo AS veiculo_codigo
         FROM apropriacoes a JOIN plano_contas pc ON pc.id = a.plano_conta_id
         LEFT JOIN centros_custo cc ON cc.id = a.centro_custo_id LEFT JOIN veiculos v ON v.id = a.veiculo_id
        WHERE a.lancamento_id = $1 ORDER BY a.criado_em, a.id`,
      [id],
    )
  ).rows;
  const pa = (
    await c.query(
      `SELECT p.*, cf.nome AS conta_nome FROM parcelas p LEFT JOIN contas_financeiras cf ON cf.id = p.conta_financeira_id
        WHERE p.lancamento_id = $1 ORDER BY p.numero`,
      [id],
    )
  ).rows;
  return { l, ap, pa, es };
}

function lancamentoPublico({ l, ap, pa, es }: Awaited<ReturnType<typeof carregarLancamento>>, hoje: string) {
  return {
    id: l.id,
    tipo: l.tipo,
    estoque: es.map((x) => ({
      id: x.id,
      descricao: x.descricao,
      quantidade: Number(x.quantidade),
      unidade: x.unidade,
      valor: reais(x.valor_centavos),
      obra: x.obra_codigo ? `${x.obra_codigo} · ${x.obra_nome}` : null,
      insumoObra: x.insumo_codigo ? `${x.insumo_codigo} · ${x.insumo_descricao}` : null,
      etapa: x.eap_codigo ? `${x.eap_codigo} ${x.eap_descricao}` : null,
    })),
    competencia: l.competencia,
    descricao: l.descricao,
    documento: l.documento,
    valorTotal: reais(l.valor_total_centavos),
    clienteId: l.cliente_id,
    clienteNome: l.cliente_nome,
    fornecedorId: l.fornecedor_id,
    fornecedorNome: l.fornecedor_nome,
    origem: l.origem,
    notaId: l.nota_id,
    status: l.status,
    recorrencia: l.recorrencia,
    recorrenciaOrdem: l.recorrencia_ordem,
    recorrenciaTotal: l.recorrencia !== 'nenhuma' ? l.recorrencia_total : null,
    observacoes: l.observacoes,
    criadoEm: l.criado_em,
    apropriacoes: ap.map((a) => ({
      id: a.id,
      planoContaId: a.plano_conta_id,
      planoCodigo: a.codigo,
      planoNome: a.plano_nome,
      centroCustoId: a.centro_custo_id,
      centroNome: a.centro_nome,
      veiculoId: a.veiculo_id,
      veiculoCodigo: a.veiculo_codigo,
      descricao: a.descricao,
      valor: reais(a.valor_centavos),
    })),
    parcelas: pa.map((p) => parcelaPublica({ ...p, total_parcelas: pa.length }, hoje)),
  };
}

/** Confere se todas as referências pertencem à empresa e se a categoria combina com o tipo. */
async function validarReferencias(
  c: Cliente,
  empresaId: string,
  d: { tipo: 'receita' | 'despesa'; clienteId: string | null; fornecedorId: string | null; apropriacoes: { planoContaId: string; centroCustoId: string | null; veiculoId: string | null }[] },
) {
  if (d.tipo === 'receita' && d.fornecedorId) throw new ErroHttp(400, 'Receita é recebida de um cliente, não de fornecedor.');
  if (d.tipo === 'despesa' && d.clienteId) throw new ErroHttp(400, 'Despesa é paga a um fornecedor ou credor, não a cliente.');
  if (d.clienteId && !(await c.query('SELECT 1 FROM clientes WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL', [d.clienteId, empresaId])).rowCount)
    throw new ErroHttp(400, 'Cliente não encontrado.');
  if (d.fornecedorId && !(await c.query('SELECT 1 FROM fornecedores WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL', [d.fornecedorId, empresaId])).rowCount)
    throw new ErroHttp(400, 'Fornecedor ou credor não encontrado.');
  const planos = [...new Set(d.apropriacoes.map((a) => a.planoContaId))];
  const pr = (await c.query('SELECT id, tipo, aceita_lancamento, ativo, nome FROM plano_contas WHERE empresa_id = $1 AND id = ANY($2::uuid[])', [empresaId, planos])).rows;
  if (pr.length !== planos.length) throw new ErroHttp(400, 'Categoria não encontrada no plano de contas.');
  for (const p of pr) {
    if (!p.aceita_lancamento) throw new ErroHttp(400, `"${p.nome}" é um grupo. Escolha uma categoria dentro dele.`);
    if (p.tipo !== d.tipo) throw new ErroHttp(400, `"${p.nome}" é categoria de ${p.tipo}; este lançamento é ${d.tipo}.`);
  }
  const centros = [...new Set(d.apropriacoes.map((a) => a.centroCustoId).filter(Boolean))] as string[];
  if (centros.length && (await c.query('SELECT count(*)::int AS n FROM centros_custo WHERE empresa_id = $1 AND id = ANY($2::uuid[])', [empresaId, centros])).rows[0].n !== centros.length)
    throw new ErroHttp(400, 'Centro de custo não encontrado.');
  const veics = [...new Set(d.apropriacoes.map((a) => a.veiculoId).filter(Boolean))] as string[];
  if (veics.length && (await c.query('SELECT count(*)::int AS n FROM veiculos WHERE empresa_id = $1 AND excluido_em IS NULL AND id = ANY($2::uuid[])', [empresaId, veics])).rows[0].n !== veics.length)
    throw new ErroHttp(400, 'Veículo não encontrado.');
}

/** Completa o valor da apropriação única e confere as somas. */
function conferirSomas(d: { valorTotal: number; apropriacoes: { valor?: number }[]; parcelas: { valor: number }[] }) {
  if (d.apropriacoes.length === 1 && d.apropriacoes[0].valor === undefined) d.apropriacoes[0].valor = d.valorTotal;
  if (d.apropriacoes.some((a) => a.valor === undefined)) throw new ErroHttp(400, 'Informe o valor de cada categoria.');
  const somaAp = d.apropriacoes.reduce((s, a) => s + (a.valor ?? 0), 0);
  if (somaAp !== d.valorTotal) throw new ErroHttp(400, `A soma das categorias (${brl(somaAp)}) é diferente do valor total (${brl(d.valorTotal)}).`);
  const somaPa = d.parcelas.reduce((s, p) => s + p.valor, 0);
  if (somaPa !== d.valorTotal) throw new ErroHttp(400, `A soma das parcelas (${brl(somaPa)}) é diferente do valor total (${brl(d.valorTotal)}).`);
}

async function contaAtiva(c: Cliente, empresaId: string, contaId: string) {
  const r = (await c.query('SELECT * FROM contas_financeiras WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL', [contaId, empresaId])).rows[0];
  if (!r) throw new ErroHttp(400, 'Conta não encontrada.');
  if (!r.ativo) throw new ErroHttp(400, `A conta ${r.nome} está desativada.`);
  return r;
}

async function inserirApropriacoesEParcelas(
  c: Cliente,
  empresaId: string,
  lancamentoId: string,
  apropriacoes: { planoContaId: string; centroCustoId: string | null; veiculoId: string | null; descricao: string | null; valor?: number }[],
  parcelas: { vencimento: string; valor: number }[] | null,
  numeroInicial = 1,
) {
  for (const a of apropriacoes) {
    await c.query(
      `INSERT INTO apropriacoes (empresa_id, lancamento_id, plano_conta_id, centro_custo_id, veiculo_id, descricao, valor_centavos) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [empresaId, lancamentoId, a.planoContaId, a.centroCustoId, a.veiculoId, a.descricao, a.valor],
    );
  }
  const ids: string[] = [];
  for (const [i, p] of (parcelas ?? []).entries()) {
    const r = await c.query(`INSERT INTO parcelas (empresa_id, lancamento_id, numero, vencimento, valor_centavos) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [
      empresaId,
      lancamentoId,
      numeroInicial + i,
      p.vencimento,
      p.valor,
    ]);
    ids.push(r.rows[0].id);
  }
  return ids;
}

export async function baixarParcela(
  c: Cliente,
  empresaId: string,
  usuarioId: string,
  parcelaId: string,
  b: { data: string; contaId: string; forma: string | null; juros: number; desconto: number; observacoes?: string | null },
) {
  const antes = (
    await c.query(
      `SELECT p.* FROM parcelas p JOIN lancamentos l ON l.id = p.lancamento_id
        WHERE p.id = $1 AND p.empresa_id = $2 AND l.excluido_em IS NULL FOR UPDATE OF p`,
      [parcelaId, empresaId],
    )
  ).rows[0];
  if (!antes) throw naoEncontrado('Parcela');
  if (antes.status !== 'aberta') throw new ErroHttp(409, antes.status === 'paga' ? 'Esta parcela já foi baixada.' : 'Esta parcela foi cancelada.');
  await contaAtiva(c, empresaId, b.contaId);
  if (b.data > somarDias(hojeBrasil(), 1)) throw new ErroHttp(400, 'A data do pagamento não pode ser futura.');
  const pago = valorPago(Number(antes.valor_centavos), b.juros, b.desconto);
  if (pago <= 0) throw new ErroHttp(400, 'O desconto não pode ser maior que o valor da parcela.');
  const depois = (
    await c.query(
      `UPDATE parcelas SET status = 'paga', data_pagamento = $3, conta_financeira_id = $4, forma_pagamento = $5, juros_centavos = $6,
              desconto_centavos = $7, valor_pago_centavos = $8, observacoes = coalesce($9, observacoes), baixado_por_id = $10, atualizado_em = now()
        WHERE id = $1 AND empresa_id = $2 RETURNING *`,
      [parcelaId, empresaId, b.data, b.contaId, b.forma, b.juros, b.desconto, pago, b.observacoes ?? null, usuarioId],
    )
  ).rows[0];
  await auditar(c, { empresaId, usuarioId, acao: 'alterar', entidade: 'parcelas', entidadeId: parcelaId, antes, depois });
  return depois;
}

// ---------- Rotas ----------
export function rotasFinanceiro(banco: Banco) {
  return async function (app: FastifyInstance) {
    const gestao = exigir(banco, 'dono', 'gestor');
    app.addHook('preHandler', gestao);

    // ----- Contas bancárias e caixa -----
    app.get('/contas', async (req) => {
      const r = await banco.query(
        `SELECT c.*, (${SQL_SALDO}) AS saldo_centavos FROM contas_financeiras c
          WHERE c.empresa_id = $1 AND c.excluido_em IS NULL ORDER BY c.ativo DESC, c.tipo, c.nome`,
        [empresaDo(req)],
      );
      // Quem não é do financeiro vê as contas só pelo nome (para escolher em listas), sem saldo.
      if (!acessaFinanceiro(req.usuario!.perfil)) return { contas: r.rows.map((x) => ({ ...contaPublica(x), saldoInicial: null, saldo: null })) };
      return { contas: r.rows.map(contaPublica) };
    });

    app.post('/contas', async (req, reply) => {
      const d = esquemaConta.parse(req.body);
      const empresaId = empresaDo(req);
      const conta = await emTransacao(banco, async (c) => {
        const n = (
          await c.query(
            `INSERT INTO contas_financeiras (empresa_id, nome, tipo, banco, agencia, conta, saldo_inicial_centavos, data_saldo_inicial)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
            [empresaId, d.nome, d.tipo, d.banco, d.agencia, d.conta, d.saldoInicial, d.dataSaldoInicial ?? hojeBrasil()],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'contas_financeiras', entidadeId: n.id, depois: n });
        return n;
      });
      reply.code(201);
      return { conta: contaPublica(conta) };
    });

    app.patch<{ Params: { id: string } }>('/contas/:id', async (req) => {
      const d = esquemaAlterarConta.parse(req.body);
      const empresaId = empresaDo(req);
      const COL: Record<string, string> = {
        nome: 'nome', tipo: 'tipo', banco: 'banco', agencia: 'agencia', conta: 'conta',
        saldoInicial: 'saldo_inicial_centavos', dataSaldoInicial: 'data_saldo_inicial', ativo: 'ativo',
      };
      const conta = await emTransacao(banco, async (c) => {
        const antes = (await c.query('SELECT * FROM contas_financeiras WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL FOR UPDATE', [req.params.id, empresaId])).rows[0];
        if (!antes) throw naoEncontrado('Conta');
        const partes: string[] = [];
        const vals: unknown[] = [];
        for (const [k, v] of Object.entries(d)) {
          if (v === undefined || !COL[k]) continue;
          vals.push(v);
          partes.push(`${COL[k]} = $${vals.length + 2}`);
        }
        if (!partes.length) return antes;
        const depois = (await c.query(`UPDATE contas_financeiras SET ${partes.join(', ')}, atualizado_em = now() WHERE id = $1 AND empresa_id = $2 RETURNING *`, [antes.id, empresaId, ...vals])).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'contas_financeiras', entidadeId: antes.id, antes, depois });
        return depois;
      });
      const r = await banco.query(`SELECT c.*, (${SQL_SALDO}) AS saldo_centavos FROM contas_financeiras c WHERE c.id = $1`, [conta.id]);
      return { conta: contaPublica(r.rows[0]) };
    });

    // Extrato de uma conta: pagamentos, recebimentos e transferências com saldo acumulado.
    app.get<{ Params: { id: string }; Querystring: { de?: string; ate?: string } }>('/contas/:id/extrato', async (req) => {
      const empresaId = empresaDo(req);
      const conta = (await banco.query('SELECT * FROM contas_financeiras WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL', [req.params.id, empresaId])).rows[0];
      if (!conta) throw naoEncontrado('Conta');
      const hoje = hojeBrasil();
      const ate = /^\d{4}-\d{2}-\d{2}$/.test(req.query.ate ?? '') ? req.query.ate! : hoje;
      let de = /^\d{4}-\d{2}-\d{2}$/.test(req.query.de ?? '') ? req.query.de! : `${ate.slice(0, 7)}-01`;
      if (de < conta.data_saldo_inicial) de = conta.data_saldo_inicial;
      const movimentos = (
        await banco.query(
          `SELECT * FROM (
             SELECT p.data_pagamento AS data, l.descricao || CASE WHEN n.total > 1 THEN ' (' || p.numero || '/' || n.total || ')' ELSE '' END AS descricao,
                    coalesce(cl.nome_fantasia, cl.razao_social, f.nome_fantasia, f.razao_social) AS pessoa,
                    CASE WHEN l.tipo = 'receita' THEN p.valor_pago_centavos ELSE -p.valor_pago_centavos END AS valor,
                    'parcela' AS origem, p.id, l.id AS lancamento_id, p.criado_em
               FROM parcelas p JOIN lancamentos l ON l.id = p.lancamento_id
               JOIN LATERAL (SELECT count(*) AS total FROM parcelas x WHERE x.lancamento_id = l.id) n ON true
               LEFT JOIN clientes cl ON cl.id = l.cliente_id LEFT JOIN fornecedores f ON f.id = l.fornecedor_id
              WHERE p.conta_financeira_id = $1 AND p.status = 'paga' AND l.excluido_em IS NULL AND l.status = 'confirmado'
                AND p.data_pagamento BETWEEN $2 AND $3
             UNION ALL
             SELECT t.data, coalesce(t.descricao, 'Transferência') || CASE WHEN t.conta_destino_id = $1 THEN ' · de ' || o.nome ELSE ' · para ' || de.nome END,
                    NULL, CASE WHEN t.conta_destino_id = $1 THEN t.valor_centavos ELSE -t.valor_centavos END, 'transferencia', t.id, NULL, t.criado_em
               FROM transferencias t JOIN contas_financeiras o ON o.id = t.conta_origem_id JOIN contas_financeiras de ON de.id = t.conta_destino_id
              WHERE (t.conta_origem_id = $1 OR t.conta_destino_id = $1) AND t.excluido_em IS NULL AND t.data BETWEEN $2 AND $3
           ) m ORDER BY data, criado_em`,
          [conta.id, de, ate],
        )
      ).rows;
      const anterior = (
        await banco.query(
          `SELECT c.saldo_inicial_centavos
             + coalesce((SELECT sum(CASE WHEN l.tipo = 'receita' THEN p.valor_pago_centavos ELSE -p.valor_pago_centavos END)
                  FROM parcelas p JOIN lancamentos l ON l.id = p.lancamento_id
                 WHERE p.conta_financeira_id = c.id AND p.status = 'paga' AND l.excluido_em IS NULL AND l.status = 'confirmado'
                   AND p.data_pagamento >= c.data_saldo_inicial AND p.data_pagamento < $2), 0)
             + coalesce((SELECT sum(CASE WHEN t.conta_destino_id = c.id THEN t.valor_centavos ELSE -t.valor_centavos END) FROM transferencias t
                 WHERE (t.conta_origem_id = c.id OR t.conta_destino_id = c.id) AND t.excluido_em IS NULL
                   AND t.data >= c.data_saldo_inicial AND t.data < $2), 0) AS saldo
             FROM contas_financeiras c WHERE c.id = $1`,
          [conta.id, de],
        )
      ).rows[0].saldo;
      let saldo = Number(anterior);
      return {
        conta: contaPublica(conta),
        de,
        ate,
        saldoAnterior: saldo / 100,
        movimentos: movimentos.map((m) => {
          saldo += Number(m.valor);
          return { data: m.data, descricao: m.descricao, pessoa: m.pessoa, valor: Number(m.valor) / 100, saldo: saldo / 100, origem: m.origem, id: m.id, lancamentoId: m.lancamento_id };
        }),
        saldoFinal: saldo / 100,
      };
    });

    // ----- Transferências -----
    app.get<{ Querystring: { de?: string; ate?: string } }>('/transferencias', async (req) => {
      const hoje = hojeBrasil();
      const de = /^\d{4}-\d{2}-\d{2}$/.test(req.query.de ?? '') ? req.query.de! : somarDias(hoje, -90);
      const ate = /^\d{4}-\d{2}-\d{2}$/.test(req.query.ate ?? '') ? req.query.ate! : hoje;
      const r = await banco.query(
        `SELECT t.*, o.nome AS origem_nome, d.nome AS destino_nome FROM transferencias t
           JOIN contas_financeiras o ON o.id = t.conta_origem_id JOIN contas_financeiras d ON d.id = t.conta_destino_id
          WHERE t.empresa_id = $1 AND t.excluido_em IS NULL AND t.data BETWEEN $2 AND $3 ORDER BY t.data DESC, t.criado_em DESC`,
        [empresaDo(req), de, ate],
      );
      return {
        transferencias: r.rows.map((t) => ({
          id: t.id, data: t.data, valor: reais(t.valor_centavos), descricao: t.descricao,
          origemId: t.conta_origem_id, origemNome: t.origem_nome, destinoId: t.conta_destino_id, destinoNome: t.destino_nome,
        })),
      };
    });

    app.post('/transferencias', async (req, reply) => {
      const d = z
        .object({
          origemId: z.string({ required_error: 'Escolha a conta de origem.' }).uuid('Escolha a conta de origem.'),
          destinoId: z.string({ required_error: 'Escolha a conta de destino.' }).uuid('Escolha a conta de destino.'),
          data: dataObrig('Data inválida.'),
          valor: dinheiro('o valor'),
          descricao: textoOpc(200),
        })
        .parse(req.body);
      if (d.origemId === d.destinoId) throw new ErroHttp(400, 'Escolha contas diferentes.');
      const empresaId = empresaDo(req);
      const t = await emTransacao(banco, async (c) => {
        await contaAtiva(c, empresaId, d.origemId);
        await contaAtiva(c, empresaId, d.destinoId);
        const n = (
          await c.query(
            `INSERT INTO transferencias (empresa_id, conta_origem_id, conta_destino_id, data, valor_centavos, descricao, criado_por_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [empresaId, d.origemId, d.destinoId, d.data, d.valor, d.descricao, req.usuario!.id],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'transferencias', entidadeId: n.id, depois: n });
        return n;
      });
      reply.code(201);
      return { transferencia: { id: t.id } };
    });

    app.delete<{ Params: { id: string } }>('/transferencias/:id', async (req) => {
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const antes = (await c.query('SELECT * FROM transferencias WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL FOR UPDATE', [req.params.id, empresaId])).rows[0];
        if (!antes) throw naoEncontrado('Transferência');
        await c.query('UPDATE transferencias SET excluido_em = now() WHERE id = $1', [antes.id]);
        await c.query(
          `UPDATE extrato_linhas SET status = 'pendente', acao = NULL, transferencia_id = NULL, conciliado_por_id = NULL, conciliado_em = NULL WHERE transferencia_id = $1`,
          [antes.id],
        );
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'excluir', entidade: 'transferencias', entidadeId: antes.id, antes });
      });
      return { ok: true };
    });

    // ----- Plano de contas -----
    app.get('/plano-contas', async (req) => {
      const r = await banco.query('SELECT * FROM plano_contas WHERE empresa_id = $1', [empresaDo(req)]);
      return { contas: r.rows.sort((a, b) => ordemCodigo(a.codigo, b.codigo)).map(planoPublico) };
    });

    app.post('/plano-contas', async (req, reply) => {
      const d = esquemaPlano.parse(req.body);
      const empresaId = empresaDo(req);
      const n = await emTransacao(banco, async (c) => {
        const paiCodigo = codigoPai(d.codigo);
        let paiId: string | null = null;
        if (paiCodigo) {
          const pai = (await c.query('SELECT * FROM plano_contas WHERE empresa_id = $1 AND codigo = $2', [empresaId, paiCodigo])).rows[0];
          if (!pai) throw new ErroHttp(400, `Crie antes o grupo ${paiCodigo}.`);
          paiId = pai.id;
          // Um grupo não recebe lançamentos diretamente.
          if (pai.aceita_lancamento) {
            const usado = await c.query('SELECT 1 FROM apropriacoes WHERE plano_conta_id = $1 LIMIT 1', [pai.id]);
            if (usado.rowCount) throw new ErroHttp(400, `"${pai.nome}" já tem lançamentos e não pode virar grupo.`);
            await c.query('UPDATE plano_contas SET aceita_lancamento = false, atualizado_em = now() WHERE id = $1', [pai.id]);
          }
        }
        const r = (
          await c.query(
            `INSERT INTO plano_contas (empresa_id, codigo, nome, tipo, linha_dre, pai_id, aceita_lancamento) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [empresaId, d.codigo, d.nome, d.tipo, d.linhaDre, paiId, d.aceitaLancamento],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'plano_contas', entidadeId: r.id, depois: r });
        return r;
      });
      reply.code(201);
      return { conta: planoPublico(n) };
    });

    app.patch<{ Params: { id: string } }>('/plano-contas/:id', async (req) => {
      const d = esquemaAlterarPlano.parse(req.body);
      const empresaId = empresaDo(req);
      const r = await emTransacao(banco, async (c) => {
        const antes = (await c.query('SELECT * FROM plano_contas WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [req.params.id, empresaId])).rows[0];
        if (!antes) throw naoEncontrado('Categoria');
        if (d.tipo && d.tipo !== antes.tipo && (await c.query('SELECT 1 FROM apropriacoes WHERE plano_conta_id = $1 LIMIT 1', [antes.id])).rowCount)
          throw new ErroHttp(400, 'Esta categoria já tem lançamentos; não dá para trocar entre receita e despesa.');
        const depois = (
          await c.query(
            `UPDATE plano_contas SET nome = coalesce($3, nome), linha_dre = coalesce($4, linha_dre), tipo = coalesce($5, tipo), ativo = coalesce($6, ativo), atualizado_em = now()
              WHERE id = $1 AND empresa_id = $2 RETURNING *`,
            [antes.id, empresaId, d.nome ?? null, d.linhaDre ?? null, d.tipo ?? null, d.ativo ?? null],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'plano_contas', entidadeId: antes.id, antes, depois });
        return depois;
      });
      return { conta: planoPublico(r) };
    });

    // Aplica o plano padrão de construtora e os centros de custo padrão (só cria o que falta).
    app.post('/plano-contas/padrao', async (req) => {
      const empresaId = empresaDo(req);
      const criados = await emTransacao(banco, (c) => aplicarPlanoPadrao(c, empresaId));
      await auditar(banco, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'plano_contas', entidadeId: empresaId, depois: { padrao: true, ...criados } });
      return criados;
    });

    // ----- Centros de custo -----
    app.get('/centros-custo', async (req) => {
      const r = await banco.query('SELECT * FROM centros_custo WHERE empresa_id = $1 ORDER BY ativo DESC, nome', [empresaDo(req)]);
      return { centros: r.rows.map((x) => ({ id: x.id, nome: x.nome, ativo: x.ativo })) };
    });

    app.post('/centros-custo', async (req, reply) => {
      const d = esquemaCentro.parse(req.body);
      const empresaId = empresaDo(req);
      const r = (await banco.query('INSERT INTO centros_custo (empresa_id, nome) VALUES ($1,$2) RETURNING *', [empresaId, d.nome])).rows[0];
      await auditar(banco, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'centros_custo', entidadeId: r.id, depois: r });
      reply.code(201);
      return { centro: { id: r.id, nome: r.nome, ativo: r.ativo } };
    });

    app.patch<{ Params: { id: string } }>('/centros-custo/:id', async (req) => {
      const d = esquemaCentro.partial().strict().parse(req.body);
      const empresaId = empresaDo(req);
      const r = (
        await banco.query(
          'UPDATE centros_custo SET nome = coalesce($3, nome), ativo = coalesce($4, ativo), atualizado_em = now() WHERE id = $1 AND empresa_id = $2 RETURNING *',
          [req.params.id, empresaId, d.nome ?? null, d.ativo ?? null],
        )
      ).rows[0];
      if (!r) throw naoEncontrado('Centro de custo');
      await auditar(banco, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'centros_custo', entidadeId: r.id, depois: r });
      return { centro: { id: r.id, nome: r.nome, ativo: r.ativo } };
    });

    // ----- Lançamentos -----
    app.get<{ Querystring: Record<string, string | undefined> }>('/lancamentos', async (req) => {
      const q = req.query;
      const empresaId = empresaDo(req);
      const hoje = hojeBrasil();
      const de = /^\d{4}-\d{2}-\d{2}$/.test(q.de ?? '') ? q.de! : `${hoje.slice(0, 7)}-01`;
      const ate = /^\d{4}-\d{2}-\d{2}$/.test(q.ate ?? '') ? q.ate! : somarDias(`${hoje.slice(0, 7)}-01`, 40).slice(0, 7) + '-01';
      const tipo = q.tipo === 'receita' || q.tipo === 'despesa' ? q.tipo : null;
      const uuid = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
      const r = await banco.query(
        `SELECT l.id, l.tipo, l.competencia, l.descricao, l.documento, l.valor_total_centavos, l.status, l.origem, l.recorrencia, l.recorrencia_ordem,
                coalesce(cl.nome_fantasia, cl.razao_social, f.nome_fantasia, f.razao_social) AS pessoa,
                (SELECT string_agg(DISTINCT pc.nome, ', ') FROM apropriacoes a JOIN plano_contas pc ON pc.id = a.plano_conta_id WHERE a.lancamento_id = l.id) AS categorias,
                (SELECT string_agg(DISTINCT v.codigo, ', ') FROM apropriacoes a JOIN veiculos v ON v.id = a.veiculo_id WHERE a.lancamento_id = l.id) AS veiculos,
                (SELECT count(*)::int FROM parcelas p WHERE p.lancamento_id = l.id) AS parcelas,
                (SELECT count(*)::int FROM parcelas p WHERE p.lancamento_id = l.id AND p.status = 'paga') AS pagas,
                (SELECT coalesce(sum(p.valor_centavos), 0) FROM parcelas p WHERE p.lancamento_id = l.id AND p.status = 'aberta') AS aberto_centavos,
                (SELECT min(p.vencimento) FROM parcelas p WHERE p.lancamento_id = l.id AND p.status = 'aberta') AS proximo_vencimento
           FROM lancamentos l LEFT JOIN clientes cl ON cl.id = l.cliente_id LEFT JOIN fornecedores f ON f.id = l.fornecedor_id
          WHERE l.empresa_id = $1 AND l.excluido_em IS NULL AND l.competencia >= $2 AND l.competencia < $3
            AND ($4::text IS NULL OR l.tipo = $4)
            AND ($5::boolean OR l.status <> 'cancelado')
            AND ($6::uuid IS NULL OR EXISTS (SELECT 1 FROM apropriacoes a WHERE a.lancamento_id = l.id AND a.plano_conta_id = $6))
            AND ($7::uuid IS NULL OR EXISTS (SELECT 1 FROM apropriacoes a WHERE a.lancamento_id = l.id AND a.veiculo_id = $7))
            AND ($8::uuid IS NULL OR EXISTS (SELECT 1 FROM apropriacoes a WHERE a.lancamento_id = l.id AND a.centro_custo_id = $8))
            AND ($9::uuid IS NULL OR l.fornecedor_id = $9 OR l.cliente_id = $9)
          ORDER BY l.competencia DESC, l.criado_em DESC
          LIMIT 2000`,
        [empresaId, de, ate, tipo, q.cancelados === '1', uuid(q.planoContaId), uuid(q.veiculoId), uuid(q.centroCustoId), uuid(q.pessoaId)],
      );
      return {
        de,
        ate,
        lancamentos: r.rows.map((l) => ({
          id: l.id, tipo: l.tipo, competencia: l.competencia, descricao: l.descricao, documento: l.documento,
          valorTotal: reais(l.valor_total_centavos), status: l.status, origem: l.origem, recorrencia: l.recorrencia, recorrenciaOrdem: l.recorrencia_ordem,
          pessoa: l.pessoa, categorias: l.categorias, veiculos: l.veiculos, parcelas: l.parcelas, pagas: l.pagas,
          valorAberto: reais(l.aberto_centavos), proximoVencimento: l.proximo_vencimento,
        })),
      };
    });

    // Pedidos de compra aprovados (ou já em andamento) que ainda não viraram despesa: para preencher o lançamento.
    // ----- Leitura do documento por IA (foto ou PDF) -----
    // A IA só sugere os campos; o lançamento só é salvo depois de conferido no formulário.
    app.get('/lancamentos/leitura', async () => ({ ia: iaDisponivel() }));

    app.post('/lancamentos/leitura', { bodyLimit: 16 * 1024 * 1024 }, async (req) => {
      const d = z
        .object({
          arquivo: z.string({ required_error: 'Envie a foto ou o PDF.' }).min(20, 'Arquivo vazio.'),
          tipo: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], { errorMap: () => ({ message: 'Envie um PDF ou uma foto (JPG, PNG ou WEBP).' }) }),
          tipoLancamento: z.enum(['receita', 'despesa']),
        })
        .parse(req.body);
      if (!iaDisponivel()) throw new ErroHttp(503, 'A leitura por IA não está configurada. Preencha os dados manualmente.');
      const bytes = Buffer.from(d.arquivo, 'base64');
      if (bytes.length > 10 * 1024 * 1024) throw new ErroHttp(400, 'Arquivo grande demais (máximo 10 MB).');
      let lido;
      try {
        lido = await lerLancamentoComIa(bytes, d.tipo, d.tipoLancamento);
      } catch (e) {
        if (e instanceof ErroIa) throw new ErroHttp(502, e.message);
        throw e;
      }
      // Procura a outra parte pelo CNPJ/CPF entre os cadastros da empresa.
      let pessoaId: string | null = null;
      if (lido.pessoaCnpjCpf) {
        const tabela = d.tipoLancamento === 'receita' ? 'clientes' : 'fornecedores';
        const r = await banco.query(`SELECT id FROM ${tabela} WHERE empresa_id = $1 AND cnpj_cpf = $2 AND excluido_em IS NULL LIMIT 1`, [empresaDo(req), lido.pessoaCnpjCpf]);
        pessoaId = (r.rows[0] as { id: string } | undefined)?.id ?? null;
      }
      const duvidas = [...lido.duvidas];
      if (lido.pessoaNome && !pessoaId) {
        duvidas.push(`${d.tipoLancamento === 'receita' ? 'Cliente' : 'Fornecedor'} "${lido.pessoaNome}" não está cadastrado. Cadastre-o e escolha-o no campo.`);
      }
      if (lido.parcelas && lido.parcelas > 1) duvidas.push(`O documento tem ${lido.parcelas} parcelas. Ajuste o parcelamento abaixo.`);
      const dados: Record<string, string | number> = {};
      if (lido.descricao) dados.descricao = lido.descricao;
      if (lido.documento) dados.documento = lido.documento;
      if (lido.competencia) dados.competencia = lido.competencia;
      if (lido.vencimento) dados.vencimento = lido.vencimento;
      if (lido.valorTotal !== null) dados.valorTotal = lido.valorTotal;
      if (pessoaId) dados.pessoaId = pessoaId;
      return { dados, duvidas };
    });

    app.get('/lancamentos/pedidos-disponiveis', async (req) => {
      const empresaId = empresaDo(req);
      const r = await banco.query(
        `SELECT p.id, p.numero, p.data, p.status, p.total_centavos, p.fornecedor_id, coalesce(f.nome_fantasia, f.razao_social) AS fornecedor,
                (SELECT string_agg(pi.descricao, ', ' ORDER BY pi.descricao) FROM pedidos_itens pi WHERE pi.pedido_id = p.id) AS resumo
           FROM pedidos_compra p JOIN fornecedores f ON f.id = p.fornecedor_id
          WHERE p.empresa_id = $1 AND p.status IN ('aprovado', 'enviado', 'parcial')
            AND NOT EXISTS (SELECT 1 FROM lancamentos l WHERE l.pedido_id = p.id AND l.status <> 'cancelado' AND l.excluido_em IS NULL)
            AND NOT EXISTS (SELECT 1 FROM notas_fiscais n JOIN lancamentos l ON l.id = n.lancamento_id WHERE n.pedido_id = p.id AND l.status <> 'cancelado' AND n.excluido_em IS NULL)
          ORDER BY p.numero DESC LIMIT 200`,
        [empresaId],
      );
      return {
        pedidos: r.rows.map((p) => ({
          id: p.id as string,
          numero: p.numero as number,
          data: p.data,
          status: p.status as string,
          fornecedorId: p.fornecedor_id as string,
          fornecedor: p.fornecedor as string,
          total: reais(p.total_centavos),
          resumo: (p.resumo as string | null) ?? '',
        })),
      };
    });

    // Itens de estoque sugeridos pelo pedido: obra, insumo da obra e etapa vêm da solicitação de compra que originou
    // o pedido; quantidade, unidade e valor são os comprados (do pedido).
    app.get<{ Params: { id: string } }>('/lancamentos/pedidos-disponiveis/:id/estoque', async (req) => {
      const empresaId = empresaDo(req);
      if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw naoEncontrado('Pedido');
      const p = (await banco.query('SELECT status FROM pedidos_compra WHERE id = $1 AND empresa_id = $2', [req.params.id, empresaId])).rows[0];
      if (!p || !['aprovado', 'enviado', 'parcial'].includes(p.status)) throw naoEncontrado('Pedido');
      const r = await banco.query(
        `SELECT pi.descricao AS pedido_descricao, pi.unidade AS pedido_unidade, pi.quantidade, pi.preco_unitario_centavos,
                si.descricao AS sol_descricao,
                coalesce(pi.obra_item_id, si.obra_item_id) AS obra_item_id,
                coalesce(pi.eap_no_id, si.eap_no_id) AS eap_no_id,
                coalesce(oi.obra_id, sc.obra_id) AS obra_id
           FROM pedidos_itens pi
           LEFT JOIN cotacoes_itens ci ON ci.id = pi.cotacao_item_id
           LEFT JOIN solicitacoes_itens si ON si.id = ci.solicitacao_item_id
           LEFT JOIN solicitacoes_compra sc ON sc.id = si.solicitacao_id
           LEFT JOIN obra_itens oi ON oi.id = coalesce(pi.obra_item_id, si.obra_item_id)
          WHERE pi.pedido_id = $1
          ORDER BY pi.descricao, pi.id`,
        [req.params.id],
      );
      return {
        itens: r.rows.map((i) => ({
          descricao: (i.sol_descricao as string | null) ?? (i.pedido_descricao as string),
          quantidade: Number(i.quantidade),
          unidade: i.pedido_unidade as string,
          valor: Math.round(Number(i.quantidade) * Number(i.preco_unitario_centavos)) / 100,
          obraId: (i.obra_id as string | null) ?? '',
          obraItemId: (i.obra_item_id as string | null) ?? '',
          eapNoId: (i.eap_no_id as string | null) ?? '',
        })),
      };
    });

    app.get<{ Params: { id: string } }>('/lancamentos/:id', async (req) => {
      return { lancamento: lancamentoPublico(await carregarLancamento(banco, empresaDo(req), req.params.id), hojeBrasil()) };
    });

    app.post('/lancamentos', async (req, reply) => {
      const d = esquemaLancamento.parse(req.body);
      conferirSomas(d);
      if (d.estoque.length) {
        if (d.tipo !== 'despesa') throw new ErroHttp(400, 'Só despesas dão entrada no estoque.');
        if (d.recorrencia !== 'nenhuma') throw new ErroHttp(400, 'Lançamento recorrente não pode dar entrada no estoque. Lance cada compra separadamente.');
        const somaEstoque = d.estoque.reduce((s, i) => s + i.valor, 0);
        if (somaEstoque > d.valorTotal) throw new ErroHttp(400, `Os itens de estoque (${brl(somaEstoque)}) passam do valor total (${brl(d.valorTotal)}).`);
      }
      const empresaId = empresaDo(req);
      const usuarioId = req.usuario!.id;
      if (d.pedidoId && (d.tipo !== 'despesa' || d.recorrencia !== 'nenhuma')) throw new ErroHttp(400, 'Só uma despesa avulsa pode ser lançada a partir de um pedido de compra.');
      const { primeiroId, criados } = await emTransacao(banco, async (c) => {
        await validarReferencias(c, empresaId, d);
        if (d.pedidoId) {
          // Pedido aprovado do mesmo fornecedor, ainda sem despesa lançada (nem por nota fiscal).
          const p = (await c.query('SELECT status, fornecedor_id, total_centavos FROM pedidos_compra WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [d.pedidoId, empresaId])).rows[0];
          if (!p || !['aprovado', 'enviado', 'parcial'].includes(p.status)) throw new ErroHttp(400, 'O pedido precisa estar aprovado para virar despesa.');
          if (p.fornecedor_id !== d.fornecedorId) throw new ErroHttp(400, 'O fornecedor da despesa é diferente do fornecedor do pedido.');
          if (Number(p.total_centavos) !== d.valorTotal) throw new ErroHttp(400, `O valor da despesa (${brl(d.valorTotal)}) é diferente do total do pedido (${brl(Number(p.total_centavos))}).`);
          const ja = (await c.query(
            `SELECT 1 FROM lancamentos l WHERE l.pedido_id = $1 AND l.status <> 'cancelado' AND l.excluido_em IS NULL
             UNION ALL SELECT 1 FROM notas_fiscais n JOIN lancamentos l ON l.id = n.lancamento_id WHERE n.pedido_id = $1 AND l.status <> 'cancelado' AND n.excluido_em IS NULL`,
            [d.pedidoId],
          )).rowCount;
          if (ja) throw new ErroHttp(409, 'Este pedido já tem despesa lançada.');
        }
        const repeticoes = d.recorrencia === 'nenhuma' ? 1 : d.repeticoes;
        let primeiroId = '';
        for (let k = 0; k < repeticoes; k++) {
          const desloca = (data: string) => (k === 0 || d.recorrencia === 'nenhuma' ? data : proximaRecorrencia(data, d.recorrencia as 'mensal', k));
          const l = (
            await c.query(
              `INSERT INTO lancamentos (empresa_id, tipo, competencia, descricao, documento, valor_total_centavos, cliente_id, fornecedor_id, observacoes,
                                        recorrencia, recorrencia_pai_id, recorrencia_ordem, criado_por_id, pedido_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
              [
                empresaId, d.tipo, desloca(d.competencia), d.descricao, d.documento, d.valorTotal, d.clienteId, d.fornecedorId, d.observacoes,
                d.recorrencia, k === 0 ? null : primeiroId, d.recorrencia === 'nenhuma' ? null : k + 1, usuarioId, k === 0 ? d.pedidoId : null,
              ],
            )
          ).rows[0];
          if (k === 0) {
            primeiroId = l.id;
            if (d.recorrencia !== 'nenhuma') await c.query('UPDATE lancamentos SET recorrencia_pai_id = id WHERE id = $1', [l.id]);
          }
          const ids = await inserirApropriacoesEParcelas(
            c, empresaId, l.id, d.apropriacoes,
            d.parcelas.map((p) => ({ vencimento: desloca(p.vencimento), valor: p.valor })),
          );
          if (k === 0 && d.estoque.length) {
            for (const i of d.estoque) {
              await validarApropriacaoObra(c, empresaId, i.obraId, i.obraItemId, i.eapNoId);
              if (i.obraEstoqueId) await estoqueDaMovimentacao(c, empresaId, i.obraId, i.obraEstoqueId);
              await c.query(
                `INSERT INTO lancamento_itens_estoque (empresa_id, lancamento_id, descricao, quantidade, unidade, valor_centavos, obra_id, obra_item_id, eap_no_id, obra_estoque_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                [empresaId, l.id, i.descricao, i.quantidade, i.unidade, i.valor, i.obraId, i.obraItemId, i.eapNoId, i.obraEstoqueId],
              );
            }
            await registrarEntradasLancamento(c, empresaId, l.id, hojeBrasil(), usuarioId);
          }
          await auditar(c, { empresaId, usuarioId, acao: 'criar', entidade: 'lancamentos', entidadeId: l.id, depois: { ...l, apropriacoes: d.apropriacoes, parcelas: d.parcelas.length, estoque: d.estoque.length } });
          if (k === 0 && d.baixa) await baixarParcela(c, empresaId, usuarioId, ids[0], d.baixa);
        }
        return { primeiroId, criados: repeticoes };
      });
      reply.code(201);
      return { lancamento: lancamentoPublico(await carregarLancamento(banco, empresaId, primeiroId), hojeBrasil()), criados };
    });

    // Edição: as parcelas pagas ficam como estão; "parcelas" traz só as parcelas em aberto (substituídas).
    app.put<{ Params: { id: string } }>('/lancamentos/:id', async (req) => {
      const d = esquemaEditarLancamento.parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const antes = (await c.query('SELECT * FROM lancamentos WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL FOR UPDATE', [req.params.id, empresaId])).rows[0];
        if (!antes) throw naoEncontrado('Lançamento');
        if (antes.status === 'cancelado') throw new ErroHttp(409, 'Lançamento cancelado não pode ser alterado.');
        if (antes.nota_id) throw new ErroHttp(409, 'Este lançamento veio de uma nota fiscal. Para mudar, reabra a nota em Notas fiscais.');
        if (antes.tipo !== d.tipo) throw new ErroHttp(400, 'Não dá para trocar entre receita e despesa. Cancele e lance de novo.');
        await validarReferencias(c, empresaId, d);
        const parcelasAntes = (await c.query('SELECT * FROM parcelas WHERE lancamento_id = $1 ORDER BY numero FOR UPDATE', [antes.id])).rows;
        const somaPagas = parcelasAntes.filter((p) => p.status === 'paga').reduce((s, p) => s + Number(p.valor_centavos), 0);
        conferirSomas({ ...d, parcelas: [...d.parcelas, { valor: somaPagas }] });
        if (!d.parcelas.length && somaPagas !== d.valorTotal) throw new ErroHttp(400, 'Informe o vencimento do valor em aberto.');
        await c.query(
          `UPDATE lancamentos SET competencia = $3, descricao = $4, documento = $5, valor_total_centavos = $6, cliente_id = $7, fornecedor_id = $8,
                  observacoes = $9, atualizado_em = now() WHERE id = $1 AND empresa_id = $2`,
          [antes.id, empresaId, d.competencia, d.descricao, d.documento, d.valorTotal, d.clienteId, d.fornecedorId, d.observacoes],
        );
        await c.query('DELETE FROM apropriacoes WHERE lancamento_id = $1', [antes.id]);
        await c.query("DELETE FROM parcelas WHERE lancamento_id = $1 AND status <> 'paga'", [antes.id]);
        await inserirApropriacoesEParcelas(c, empresaId, antes.id, d.apropriacoes, d.parcelas, 1000);
        // Renumera pela ordem de vencimento.
        await c.query(
          `UPDATE parcelas p SET numero = x.n FROM (SELECT id, row_number() OVER (ORDER BY vencimento, numero) AS n FROM parcelas WHERE lancamento_id = $1) x
            WHERE p.id = x.id`,
          [antes.id],
        );
        await auditar(c, {
          empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'lancamentos', entidadeId: antes.id,
          antes: { ...antes, parcelas: parcelasAntes }, depois: d,
        });
      });
      return { lancamento: lancamentoPublico(await carregarLancamento(banco, empresaId, req.params.id), hojeBrasil()) };
    });

    app.post<{ Params: { id: string } }>('/lancamentos/:id/cancelar', async (req) => {
      const d = z.object({ seguintes: z.boolean().optional().default(false) }).parse(req.body ?? {});
      const empresaId = empresaDo(req);
      const n = await emTransacao(banco, async (c) => {
        const l = (await c.query('SELECT * FROM lancamentos WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL FOR UPDATE', [req.params.id, empresaId])).rows[0];
        if (!l) throw naoEncontrado('Lançamento');
        if (l.status === 'cancelado') throw new ErroHttp(409, 'Este lançamento já está cancelado.');
        if (l.nota_id) throw new ErroHttp(409, 'Este lançamento veio de uma nota fiscal. Cancele ou reabra a nota em Notas fiscais.');
        let alvos = [l];
        if (d.seguintes && l.recorrencia_pai_id) {
          alvos = (
            await c.query(
              `SELECT * FROM lancamentos WHERE empresa_id = $1 AND recorrencia_pai_id = $2 AND recorrencia_ordem >= $3 AND status <> 'cancelado' AND excluido_em IS NULL FOR UPDATE`,
              [empresaId, l.recorrencia_pai_id, l.recorrencia_ordem],
            )
          ).rows;
        }
        const ids = alvos.map((a) => a.id);
        const pagas = (await c.query("SELECT count(*)::int AS n FROM parcelas WHERE lancamento_id = ANY($1::uuid[]) AND status = 'paga'", [ids])).rows[0].n;
        if (pagas) throw new ErroHttp(409, 'Há parcelas pagas. Estorne os pagamentos antes de cancelar.');
        await c.query("UPDATE lancamentos SET status = 'cancelado', atualizado_em = now() WHERE id = ANY($1::uuid[])", [ids]);
        await c.query("UPDATE parcelas SET status = 'cancelada', atualizado_em = now() WHERE lancamento_id = ANY($1::uuid[]) AND status = 'aberta'", [ids]);
        // A entrada no estoque sai junto com o lançamento.
        for (const id of ids) await removerEntradasLancamento(c, id);
        for (const a of alvos) await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'excluir', entidade: 'lancamentos', entidadeId: a.id, antes: a, depois: { status: 'cancelado' } });
        return ids.length;
      });
      return { cancelados: n };
    });

    // ----- Contas a pagar e a receber -----
    app.get<{ Querystring: Record<string, string | undefined> }>('/parcelas', async (req) => {
      const q = req.query;
      const empresaId = empresaDo(req);
      const hoje = hojeBrasil();
      const tipo = q.tipo === 'receita' ? 'receita' : 'despesa';
      const situacao = ['abertas', 'vencidas', 'hoje', 'semana', 'mes', 'pagas', 'todas'].includes(q.situacao ?? '') ? q.situacao! : 'abertas';
      const data = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
      let de = data(q.de);
      let ate = data(q.ate);
      let status: string | null = 'aberta';
      let campoData = 'p.vencimento';
      if (situacao === 'vencidas') ate = somarDias(hoje, -1);
      if (situacao === 'hoje') de = ate = hoje;
      if (situacao === 'semana') (de = de ?? hoje), (ate = somarDias(hoje, 6));
      if (situacao === 'mes') (de = `${hoje.slice(0, 7)}-01`), (ate = somarDias(somarDias(`${hoje.slice(0, 7)}-01`, 32).slice(0, 7) + '-01', -1));
      if (situacao === 'pagas') {
        status = 'paga';
        campoData = 'p.data_pagamento';
        de = de ?? `${hoje.slice(0, 7)}-01`;
        ate = ate ?? hoje;
      }
      if (situacao === 'todas') status = null;
      const contaId = q.contaId && /^[0-9a-f-]{36}$/i.test(q.contaId) ? q.contaId : null;
      const r = await banco.query(
        `SELECT p.*, l.tipo, l.descricao, l.documento, l.competencia, cf.nome AS conta_nome,
                coalesce(cl.nome_fantasia, cl.razao_social, f.nome_fantasia, f.razao_social) AS pessoa,
                (SELECT count(*)::int FROM parcelas x WHERE x.lancamento_id = l.id) AS total_parcelas,
                (SELECT string_agg(DISTINCT pc.nome, ', ') FROM apropriacoes a JOIN plano_contas pc ON pc.id = a.plano_conta_id WHERE a.lancamento_id = l.id) AS categorias
           FROM parcelas p JOIN lancamentos l ON l.id = p.lancamento_id
           LEFT JOIN contas_financeiras cf ON cf.id = p.conta_financeira_id
           LEFT JOIN clientes cl ON cl.id = l.cliente_id LEFT JOIN fornecedores f ON f.id = l.fornecedor_id
          WHERE p.empresa_id = $1 AND l.tipo = $2 AND l.excluido_em IS NULL AND l.status = 'confirmado'
            AND ($3::text IS NULL OR p.status = $3) AND ($3::text IS NOT NULL OR p.status <> 'cancelada')
            AND ($4::date IS NULL OR ${campoData} >= $4) AND ($5::date IS NULL OR ${campoData} <= $5)
            AND ($6::uuid IS NULL OR p.conta_financeira_id = $6)
          ORDER BY ${situacao === 'pagas' ? 'p.data_pagamento DESC' : 'p.vencimento'}, l.descricao, p.numero
          LIMIT 2000`,
        [empresaId, tipo, status, de, ate, contaId],
      );
      const parcelas = r.rows.map((p) => parcelaPublica(p, hoje));
      const total = parcelas.reduce((s, p) => s + (situacao === 'pagas' ? p.valorPago ?? 0 : p.valor ?? 0), 0);
      return { tipo, situacao, de, ate, parcelas, total: Math.round(total * 100) / 100 };
    });

    app.post<{ Params: { id: string } }>('/parcelas/:id/baixar', async (req) => {
      const d = esquemaBaixa.parse(req.body);
      const empresaId = empresaDo(req);
      const p = await emTransacao(banco, (c) => baixarParcela(c, empresaId, req.usuario!.id, req.params.id, d));
      return { parcela: parcelaPublica(p, hojeBrasil()) };
    });

    /** Dados do recibo de um recebimento já baixado. O recibo não gera numeração própria: a referência é a parcela e o lançamento. */
    app.get<{ Params: { id: string } }>('/parcelas/:id/recibo', async (req) => {
      const empresaId = empresaDo(req);
      if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw naoEncontrado('Recebimento');
      const r = (await banco.query(
        `SELECT p.numero, p.vencimento, p.valor_pago_centavos, p.data_pagamento, p.status, p.forma_pagamento,
                l.descricao, l.documento, cf.nome AS conta_nome,
                coalesce(cl.nome_fantasia, cl.razao_social) AS pagador, cl.cnpj_cpf,
                (SELECT count(*)::int FROM parcelas x WHERE x.lancamento_id = l.id) AS total_parcelas,
                ct.numero AS contrato_numero
           FROM parcelas p JOIN lancamentos l ON l.id = p.lancamento_id
           LEFT JOIN contas_financeiras cf ON cf.id = p.conta_financeira_id
           LEFT JOIN clientes cl ON cl.id = l.cliente_id
           LEFT JOIN contratos_cliente ct ON ct.lancamento_id = l.id
          WHERE p.id = $1 AND p.empresa_id = $2 AND l.tipo = 'receita' AND l.excluido_em IS NULL`,
        [req.params.id, empresaId],
      )).rows[0];
      if (!r) throw naoEncontrado('Recebimento');
      if (r.status !== 'paga') throw new ErroHttp(409, 'O recibo só é emitido depois da baixa do recebimento.');
      const emp = (await banco.query('SELECT coalesce(nome_fantasia, razao_social) AS nome, cnpj FROM empresas WHERE id = $1', [empresaId])).rows[0];
      return {
        recibo: {
          empresa: { nome: emp?.nome ?? '', cnpj: emp?.cnpj ?? null },
          pagador: { nome: r.pagador ?? '', documento: r.cnpj_cpf ?? null },
          valor: reais(r.valor_pago_centavos),
          referente: r.descricao,
          documento: r.documento,
          parcela: `${r.numero}/${r.total_parcelas}`,
          vencimento: String(r.vencimento).slice(0, 10),
          dataPagamento: String(r.data_pagamento).slice(0, 10),
          forma: r.forma_pagamento ?? null,
          conta: r.conta_nome ?? null,
          contratoNumero: r.contrato_numero ?? null,
          emitidoEm: hojeBrasil(),
        },
      };
    });

    app.post('/parcelas/baixar-lote', async (req) => {
      const d = esquemaBaixa.omit({ juros: true, desconto: true }).extend({ ids: z.array(z.string().uuid()).min(1).max(200) }).parse(req.body);
      const empresaId = empresaDo(req);
      const n = await emTransacao(banco, async (c) => {
        for (const id of d.ids) await baixarParcela(c, empresaId, req.usuario!.id, id, { ...d, juros: 0, desconto: 0 });
        return d.ids.length;
      });
      return { baixadas: n };
    });

    app.post<{ Params: { id: string } }>('/parcelas/:id/estornar', async (req) => {
      const empresaId = empresaDo(req);
      const p = await emTransacao(banco, async (c) => {
        const antes = (await c.query('SELECT * FROM parcelas WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [req.params.id, empresaId])).rows[0];
        if (!antes) throw naoEncontrado('Parcela');
        if (antes.status !== 'paga') throw new ErroHttp(409, 'Esta parcela não está paga.');
        // Se estava conciliada com o extrato, a linha do extrato volta a ficar pendente.
        await c.query(
          `UPDATE extrato_linhas SET status = 'pendente', acao = NULL, parcela_id = NULL, conciliado_por_id = NULL, conciliado_em = NULL WHERE parcela_id = $1`,
          [antes.id],
        );
        const depois = (
          await c.query(
            `UPDATE parcelas SET status = 'aberta', data_pagamento = NULL, conta_financeira_id = NULL, forma_pagamento = NULL, juros_centavos = 0,
                    desconto_centavos = 0, valor_pago_centavos = NULL, baixado_por_id = NULL, atualizado_em = now() WHERE id = $1 RETURNING *`,
            [antes.id],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'parcelas', entidadeId: antes.id, antes, depois: { ...depois, estorno: true } });
        return depois;
      });
      return { parcela: parcelaPublica(p, hojeBrasil()) };
    });

    app.patch<{ Params: { id: string } }>('/parcelas/:id', async (req) => {
      const d = z.object({ vencimento: dataObrig('Vencimento inválido.').optional(), observacoes: textoOpc(300) }).strict().parse(req.body);
      const empresaId = empresaDo(req);
      const p = await emTransacao(banco, async (c) => {
        const antes = (await c.query('SELECT * FROM parcelas WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [req.params.id, empresaId])).rows[0];
        if (!antes) throw naoEncontrado('Parcela');
        if (antes.status !== 'aberta') throw new ErroHttp(409, 'Só parcelas em aberto podem ser alteradas.');
        const depois = (
          await c.query('UPDATE parcelas SET vencimento = coalesce($2, vencimento), observacoes = coalesce($3, observacoes), atualizado_em = now() WHERE id = $1 RETURNING *', [
            antes.id,
            d.vencimento ?? null,
            d.observacoes ?? null,
          ])
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'parcelas', entidadeId: antes.id, antes, depois });
        return depois;
      });
      return { parcela: parcelaPublica(p, hojeBrasil()) };
    });

    // ----- Resumo para o painel -----
    app.get('/resumo', async (req) => {
      const empresaId = empresaDo(req);
      const hoje = hojeBrasil();
      const inicioMes = `${hoje.slice(0, 7)}-01`;
      const contas = (
        await banco.query(`SELECT c.*, (${SQL_SALDO}) AS saldo_centavos FROM contas_financeiras c WHERE c.empresa_id = $1 AND c.excluido_em IS NULL AND c.ativo ORDER BY c.tipo, c.nome`, [empresaId])
      ).rows.map(contaPublica);
      const r = (
        await banco.query(
          `SELECT l.tipo,
                  count(*) FILTER (WHERE p.status = 'aberta' AND p.vencimento < $2)::int AS vencidas_n,
                  coalesce(sum(p.valor_centavos) FILTER (WHERE p.status = 'aberta' AND p.vencimento < $2), 0) AS vencidas,
                  count(*) FILTER (WHERE p.status = 'aberta' AND p.vencimento = $2)::int AS hoje_n,
                  coalesce(sum(p.valor_centavos) FILTER (WHERE p.status = 'aberta' AND p.vencimento = $2), 0) AS hoje,
                  count(*) FILTER (WHERE p.status = 'aberta' AND p.vencimento BETWEEN $2 AND $3)::int AS semana_n,
                  coalesce(sum(p.valor_centavos) FILTER (WHERE p.status = 'aberta' AND p.vencimento BETWEEN $2 AND $3), 0) AS semana,
                  coalesce(sum(p.valor_centavos) FILTER (WHERE p.status = 'aberta'), 0) AS aberto,
                  coalesce(sum(p.valor_pago_centavos) FILTER (WHERE p.status = 'paga' AND p.data_pagamento BETWEEN $4 AND $2), 0) AS realizado_mes
             FROM parcelas p JOIN lancamentos l ON l.id = p.lancamento_id
            WHERE p.empresa_id = $1 AND l.excluido_em IS NULL AND l.status = 'confirmado'
            GROUP BY l.tipo`,
          [empresaId, hoje, somarDias(hoje, 6), inicioMes],
        )
      ).rows;
      const bloco = (tipo: string) => {
        const x = r.find((y) => y.tipo === tipo) ?? {};
        return {
          vencidas: { quantidade: x.vencidas_n ?? 0, valor: reais(x.vencidas ?? 0) },
          hoje: { quantidade: x.hoje_n ?? 0, valor: reais(x.hoje ?? 0) },
          semana: { quantidade: x.semana_n ?? 0, valor: reais(x.semana ?? 0) },
          aberto: reais(x.aberto ?? 0),
          realizadoMes: reais(x.realizado_mes ?? 0),
        };
      };
      const temPlano = (await banco.query('SELECT 1 FROM plano_contas WHERE empresa_id = $1 LIMIT 1', [empresaId])).rowCount! > 0;
      const extratoPendente = (
        await banco.query("SELECT count(*)::int AS n FROM extrato_linhas WHERE empresa_id = $1 AND status = 'pendente'", [empresaId])
      ).rows[0].n;
      const notasParaConferir = (
        await banco.query("SELECT count(*)::int AS n FROM notas_fiscais WHERE empresa_id = $1 AND excluido_em IS NULL AND status IN ('rascunho', 'aguardando_conferencia')", [empresaId])
      ).rows[0].n;
      // Insumos abaixo do estoque mínimo (saldo teórico de hoje).
      const estoqueBaixo = (
        await banco.query(
          `WITH s AS (${SQL_SALDOS})
           SELECT count(*)::int AS n FROM insumos i JOIN s ON s.insumo_id = i.id
            WHERE i.ativo AND i.controla_estoque AND i.estoque_minimo IS NOT NULL AND s.saldo < i.estoque_minimo`,
          [empresaId, hojeBrasil()],
        )
      ).rows[0].n;
      // Qualidade: corpos de prova atrasados, resultados abaixo do fck (60 dias) e calibrações vencidas.
      const qual = (
        await banco.query(
          `SELECT (SELECT count(*) FROM corpos_prova cp JOIN amostras a ON a.id = cp.amostra_id
                    WHERE cp.empresa_id = $1 AND cp.situacao = 'aguardando' AND a.status = 'ativa' AND cp.data_prevista < $2)::int AS cps,
                  (SELECT count(*) FROM equipamentos WHERE empresa_id = $1 AND excluido_em IS NULL AND ativo AND ultima_calibracao + validade_dias < $2)::int AS calib,
                  (SELECT count(*) FROM amostras a JOIN cargas ca ON ca.id = a.carga_id JOIN tracos t ON t.id = ca.traco_id
                    WHERE a.empresa_id = $1 AND a.status = 'ativa' AND a.data_moldagem > $2::date - 60 AND t.fck IS NOT NULL
                      AND (SELECT max(cp.resistencia_mpa) FROM corpos_prova cp WHERE cp.amostra_id = a.id AND cp.situacao = 'rompido'
                            AND cp.idade_dias = coalesce((SELECT idade_controle FROM qualidade_config WHERE empresa_id = $1), 28)) < t.fck)::int AS abaixo`,
          [empresaId, hojeBrasil()],
        )
      ).rows[0];
      const ve = acessaFinanceiro(req.usuario!.perfil);
      return {
        qualidade: { cpsAtrasados: qual.cps, calibracoesVencidas: qual.calib, abaixoFck: qual.abaixo },
        estoqueBaixo,
        // Saldos e contas: só dono e perfil Financeiro.
        financeiroVisivel: ve,
        saldoTotal: ve ? Math.round(contas.reduce((s, c) => s + (c.saldo ?? 0), 0) * 100) / 100 : null,
        contas: ve ? contas : [],
        pagar: ve ? bloco('despesa') : null,
        receber: ve ? bloco('receita') : null,
        configurado: { planoContas: temPlano, contas: contas.length > 0 },
        notasParaConferir,
        extratoPendente,
      };
    });
  };
}

/** Cria o que falta do plano de contas padrão e dos centros de custo padrão. */
export async function aplicarPlanoPadrao(c: Cliente, empresaId: string, plano: ContaPadrao[] = PLANO_CONTAS_PADRAO, listaCentros: string[] = CENTROS_CUSTO_PADRAO) {
  let contas = 0;
  for (const p of plano) {
    const r = await c.query(
      `INSERT INTO plano_contas (empresa_id, codigo, nome, tipo, linha_dre, aceita_lancamento) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (empresa_id, codigo) DO NOTHING`,
      [empresaId, p.codigo, p.nome, p.tipo, p.linha, !p.grupo],
    );
    contas += r.rowCount ?? 0;
  }
  // Liga cada conta ao seu grupo pelo código.
  await c.query(
    `UPDATE plano_contas f SET pai_id = g.id FROM plano_contas g
      WHERE f.empresa_id = $1 AND g.empresa_id = $1 AND f.pai_id IS NULL
        AND g.codigo = regexp_replace(f.codigo, '\\.[0-9]+$', '') AND f.codigo LIKE '%.%'`,
    [empresaId],
  );
  let centros = 0;
  for (const nome of listaCentros) {
    const r = await c.query(
      `INSERT INTO centros_custo (empresa_id, nome) SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM centros_custo WHERE empresa_id = $1 AND lower(nome) = lower($2))`,
      [empresaId, nome],
    );
    centros += r.rowCount ?? 0;
  }
  return { contas, centros };
}
