// Suprimentos · Contratos com prestadores de serviço, medições e autorizações de pagamento.
// A autorização aprovada gera a conta a pagar do fornecedor (valor líquido) e a dos impostos retidos.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Banco, Cliente } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';
import { hojeBrasil } from '../lib/frota.ts';
import { somarDias, somarMeses } from '../lib/financeiro.ts';
import { dispensaAprovacao, lerRegras, podeAprovar, proximoNumero, textoRegras } from '../lib/aprovacao.ts';
import { empresaDo, exigir } from '../sessao.ts';
import { centrosPermitidos, ehEngenheiroDeObra } from '../lib/obras-acesso.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const reais = (c: unknown) => (c === null || c === undefined ? null : Math.round(Number(c)) / 100);
const preco = (c: unknown) => (c === null || c === undefined ? null : Math.round(Number(c) * 100) / 10000);
const cent = (r: number) => Math.round(r * 100);
const centPreco = (r: number) => Math.round(r * 1_000_000) / 10_000;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const texto = (max = 200) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const dataOpc = z.string().regex(DATA, 'Data inválida.').optional().nullable().transform((v) => v || null);
const dataObr = (msg: string) => z.string({ required_error: msg }).regex(DATA, msg);
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
const naoNegativo = (msg: string) => decimal(msg).refine((n) => n >= 0, msg);
const positivo = (msg: string) => decimal(msg).refine((n) => n > 0, msg);
const FORMAS = ['pix', 'boleto', 'transferencia', 'cartao', 'dinheiro', 'cheque', 'debito_automatico'] as const;
const usuarioDe = (req: FastifyRequest) => req.usuario!;
const pctNum = (v: unknown) => Number(v ?? 0);
/** Medições que contam no saldo do contrato (as que não foram reprovadas nem canceladas). */
const MEDICAO_CONTA = `('rascunho', 'aguardando_aprovacao', 'aprovada')`;

// ---------------------------------------------------------------- contrato

type LinhaContrato = Record<string, any>;

async function carregarContrato(c: Cliente, empresaId: string, id: string, travar = false): Promise<LinhaContrato> {
  if (!UUID.test(id)) throw naoEncontrado('Contrato');
  const r = (await c.query(`SELECT * FROM contratos WHERE id = $1 AND empresa_id = $2${travar ? ' FOR UPDATE' : ''}`, [id, empresaId])).rows[0];
  if (!r) throw naoEncontrado('Contrato');
  return r;
}

/** Retenções de um valor bruto pelas % do contrato. */
function calcularRetencoes(k: LinhaContrato, bruto: number) {
  const v = (p: unknown) => Math.round((bruto * pctNum(p)) / 100);
  const r = { caucao: v(k.caucao_pct), iss: v(k.iss_pct), inss: v(k.inss_pct), ir: v(k.ir_pct), pcc: v(k.pcc_pct) };
  return { ...r, liquido: bruto - r.caucao - r.iss - r.inss - r.ir - r.pcc };
}

async function detalharContrato(c: Cliente, empresaId: string, id: string, usuario?: { perfil: string; administrador: boolean }) {
  const k = (
    await c.query(
      `SELECT k.*, f.razao_social, f.nome_fantasia, f.cnpj_cpf, f.telefone, f.email, f.cidade, f.uf, f.chave_pix,
              pc.codigo AS plano_codigo, pc.nome AS plano_nome, cc.nome AS centro_custo, u.nome AS criado_por, ua.nome AS aprovado_por
         FROM contratos k JOIN fornecedores f ON f.id = k.fornecedor_id JOIN plano_contas pc ON pc.id = k.plano_conta_id
         LEFT JOIN centros_custo cc ON cc.id = k.centro_custo_id LEFT JOIN usuarios u ON u.id = k.criado_por_id LEFT JOIN usuarios ua ON ua.id = k.aprovado_por_id
        WHERE k.id = $1 AND k.empresa_id = $2`,
      [UUID.test(id) ? id : '00000000-0000-0000-0000-000000000000', empresaId],
    )
  ).rows[0];
  if (!k) throw naoEncontrado('Contrato');
  const itens = (
    await c.query(
      `SELECT ci.*, NULL::text AS codigo,
              coalesce((SELECT sum(mi.quantidade) FROM medicoes_itens mi JOIN medicoes m ON m.id = mi.medicao_id WHERE mi.contrato_item_id = ci.id AND m.status = 'aprovada'), 0) AS medido,
              coalesce((SELECT sum(mi.quantidade) FROM medicoes_itens mi JOIN medicoes m ON m.id = mi.medicao_id WHERE mi.contrato_item_id = ci.id AND m.status IN ('rascunho', 'aguardando_aprovacao')), 0) AS pendente
         FROM contratos_itens ci WHERE ci.contrato_id = $1 ORDER BY ci.ordem, ci.descricao`,
      [k.id],
    )
  ).rows;
  const medicoes = (
    await c.query(
      `SELECT m.id, m.numero, m.sequencia, m.periodo_inicio, m.periodo_fim, m.data, m.valor_centavos, m.status,
              (SELECT json_build_object('id', a.id, 'numero', a.numero, 'status', a.status) FROM autorizacoes_pagamento a
                WHERE a.medicao_id = m.id AND a.status IN ('aguardando_aprovacao', 'aprovada') LIMIT 1) AS autorizacao
         FROM medicoes m WHERE m.contrato_id = $1 ORDER BY m.sequencia`,
      [k.id],
    )
  ).rows;
  const autorizacoes = (
    await c.query(
      `SELECT a.id, a.numero, a.tipo, a.data, a.vencimento, a.bruto_centavos, a.caucao_centavos, a.liquido_centavos, a.status,
              (a.iss_centavos + a.inss_centavos + a.ir_centavos + a.pcc_centavos) AS impostos,
              m.sequencia AS medicao_sequencia,
              coalesce((SELECT sum(p.valor_pago_centavos) FROM parcelas p WHERE p.lancamento_id = a.lancamento_id AND p.status = 'paga'), 0) AS pago
         FROM autorizacoes_pagamento a LEFT JOIN medicoes m ON m.id = a.medicao_id WHERE a.contrato_id = $1 ORDER BY a.numero`,
      [k.id],
    )
  ).rows;
  const linhas = itens.map((i) => {
    const q = Number(i.quantidade);
    const pu = Number(i.preco_unitario_centavos);
    const medido = Number(i.medido);
    return {
      id: i.id as string,
      codigo: i.codigo as string | null,
      descricao: i.descricao as string,
      unidade: i.unidade as string,
      quantidade: q,
      precoUnitario: preco(pu)!,
      total: Math.round(pu * q) / 100,
      medido: r3(medido),
      pendente: r3(Number(i.pendente)),
      saldo: r3(q - medido),
      valorMedido: Math.round(pu * medido) / 100,
    };
  });
  const valorContrato = k.tipo === 'global' ? Number(k.valor_global_centavos) : itens.reduce((s, i) => s + Math.round(Number(i.quantidade) * Number(i.preco_unitario_centavos)), 0);
  const aprovadas = medicoes.filter((m) => m.status === 'aprovada');
  const medido = aprovadas.reduce((s, m) => s + Number(m.valor_centavos), 0);
  const pendente = medicoes.filter((m) => ['rascunho', 'aguardando_aprovacao'].includes(m.status)).reduce((s, m) => s + Number(m.valor_centavos), 0);
  const autAprov = autorizacoes.filter((a) => a.status === 'aprovada');
  const caucaoRetida = autAprov.filter((a) => a.tipo === 'medicao').reduce((s, a) => s + Number(a.caucao_centavos), 0);
  const caucaoLiberada = autAprov.filter((a) => a.tipo === 'caucao').reduce((s, a) => s + Number(a.bruto_centavos), 0);
  const caucaoEmLiberacao = autorizacoes.filter((a) => a.tipo === 'caucao' && a.status === 'aguardando_aprovacao').reduce((s, a) => s + Number(a.bruto_centavos), 0);
  const hoje = hojeBrasil();
  const regras = await lerRegras(c, empresaId);
  return {
    id: k.id as string,
    numero: k.numero as number,
    status: k.status as 'rascunho' | 'aguardando_aprovacao' | 'reprovado' | 'vigente' | 'encerrado' | 'cancelado',
    enviadoAprovacaoEm: k.enviado_aprovacao_em as string | null,
    aprovadoPor: k.aprovado_por as string | null,
    aprovadoEm: k.aprovado_em as string | null,
    aprovacaoAutomatica: !!k.aprovacao_automatica,
    motivoReprovacao: k.motivo_reprovacao as string | null,
    podeAprovar: usuario ? podeAprovar(usuario, valorContrato, regras) : false,
    regrasAprovacao: textoRegras(regras),
    fornecedorId: k.fornecedor_id as string,
    fornecedor: {
      nome: (k.nome_fantasia || k.razao_social) as string,
      razaoSocial: k.razao_social as string,
      documento: k.cnpj_cpf as string | null,
      telefone: k.telefone as string | null,
      email: k.email as string | null,
      cidade: k.cidade ? `${k.cidade}${k.uf ? `/${String(k.uf).trim()}` : ''}` : null,
      chavePix: k.chave_pix as string | null,
    },
    objeto: k.objeto as string,
    tipo: k.tipo as 'itens' | 'global',
    dataAssinatura: k.data_assinatura as string | null,
    inicio: k.inicio as string,
    fim: k.fim as string | null,
    vencido: !!k.fim && k.fim < hoje && k.status === 'vigente',
    valorGlobal: reais(k.valor_global_centavos),
    planoContaId: k.plano_conta_id as string,
    planoConta: `${k.plano_codigo} ${k.plano_nome}`,
    centroCustoId: k.centro_custo_id as string | null,
    centroCusto: k.centro_custo as string | null,
    prazoPagamentoDias: k.prazo_pagamento_dias as number,
    formaPagamento: k.forma_pagamento as string | null,
    retencoes: { caucao: pctNum(k.caucao_pct), iss: pctNum(k.iss_pct), inss: pctNum(k.inss_pct), ir: pctNum(k.ir_pct), pcc: pctNum(k.pcc_pct) },
    observacao: k.observacao as string | null,
    encerradoEm: k.encerrado_em as string | null,
    criadoPor: k.criado_por as string | null,
    itens: linhas,
    medicoes: medicoes.map((m) => ({
      id: m.id,
      numero: m.numero,
      sequencia: m.sequencia,
      periodoInicio: m.periodo_inicio,
      periodoFim: m.periodo_fim,
      data: m.data,
      valor: reais(m.valor_centavos),
      status: m.status,
      autorizacao: m.autorizacao,
    })),
    autorizacoes: autorizacoes.map((a) => ({
      id: a.id,
      numero: a.numero,
      tipo: a.tipo,
      data: a.data,
      vencimento: a.vencimento,
      bruto: reais(a.bruto_centavos),
      caucao: reais(a.caucao_centavos),
      impostos: reais(a.impostos),
      liquido: reais(a.liquido_centavos),
      pago: reais(a.pago),
      status: a.status,
      medicaoSequencia: a.medicao_sequencia,
    })),
    resumo: {
      valorContrato: reais(valorContrato)!,
      medido: reais(medido)!,
      pendente: reais(pendente)!,
      saldo: reais(valorContrato - medido)!,
      percentualMedido: valorContrato > 0 ? Math.round((medido / valorContrato) * 10000) / 10000 : 0,
      autorizado: reais(autAprov.filter((a) => a.tipo === 'medicao').reduce((s, a) => s + Number(a.bruto_centavos), 0))!,
      liquidoAutorizado: reais(autAprov.reduce((s, a) => s + Number(a.liquido_centavos), 0))!,
      pago: reais(autAprov.reduce((s, a) => s + Number(a.pago), 0))!,
      impostosRetidos: reais(autAprov.reduce((s, a) => s + Number(a.impostos), 0))!,
      caucaoRetida: reais(caucaoRetida)!,
      caucaoLiberada: reais(caucaoLiberada)!,
      caucaoALiberar: reais(Math.max(caucaoRetida - caucaoLiberada - caucaoEmLiberacao, 0))!,
      medicoesPendentes: medicoes.filter((m) => ['rascunho', 'aguardando_aprovacao'].includes(m.status)).length,
      medicoesSemAutorizacao: medicoes.filter((m) => m.status === 'aprovada' && !m.autorizacao).length,
    },
  };
}

const esquemaContrato = z.object({
  fornecedorId: z.string().regex(UUID, 'Escolha o prestador.'),
  objeto: z.string().trim().min(3, 'Descreva o objeto do contrato.').max(300),
  tipo: z.enum(['itens', 'global']),
  dataAssinatura: dataOpc,
  inicio: dataObr('Informe o início da vigência.'),
  fim: dataOpc,
  valorGlobal: z.union([positivo('Valor global inválido.'), z.null()]).optional().default(null),
  planoContaId: z.string().regex(UUID, 'Escolha a categoria (plano de contas) para apropriar.'),
  centroCustoId: uuidOpc,
  prazoPagamentoDias: z.number().int().min(0).max(180).optional().default(15),
  formaPagamento: z.enum(FORMAS).optional().nullable().transform((v) => v ?? null),
  retencoes: z
    .object({
      caucao: naoNegativo('Caução inválida.').refine((n) => n <= 30, 'Caução até 30%.'),
      iss: naoNegativo('ISS inválido.').refine((n) => n <= 10, 'ISS até 10%.'),
      inss: naoNegativo('INSS inválido.').refine((n) => n <= 20, 'INSS até 20%.'),
      ir: naoNegativo('IR inválido.').refine((n) => n <= 10, 'IR até 10%.'),
      pcc: naoNegativo('PIS/COFINS/CSLL inválido.').refine((n) => n <= 10, 'PIS/COFINS/CSLL até 10%.'),
    })
    .optional()
    .default({ caucao: 0, iss: 0, inss: 0, ir: 0, pcc: 0 }),
  observacao: texto(1000),
  itens: z
    .array(
      z.object({
        id: uuidOpc,
        descricao: z.string().trim().min(1, 'Descreva cada item.').max(200),
        unidade: z.string().trim().min(1).max(10),
        quantidade: positivo('Quantidade inválida.'),
        precoUnitario: naoNegativo('Preço inválido.'),
      }),
    )
    .max(200)
    .optional()
    .default([]),
});

async function validarContrato(c: Cliente, empresaId: string, d: z.infer<typeof esquemaContrato>) {
  if (!(await c.query("SELECT 1 FROM fornecedores WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL", [d.fornecedorId, empresaId])).rowCount)
    throw new ErroHttp(400, 'Prestador não encontrado.');
  const pc = (await c.query('SELECT tipo, aceita_lancamento, nome FROM plano_contas WHERE id = $1 AND empresa_id = $2', [d.planoContaId, empresaId])).rows[0];
  if (!pc) throw new ErroHttp(400, 'Categoria não encontrada no plano de contas.');
  if (pc.tipo !== 'despesa') throw new ErroHttp(400, `"${pc.nome}" é categoria de receita.`);
  if (!pc.aceita_lancamento) throw new ErroHttp(400, `"${pc.nome}" é um grupo. Escolha uma categoria dentro dele.`);
  if (d.centroCustoId && !(await c.query('SELECT 1 FROM centros_custo WHERE id = $1 AND empresa_id = $2', [d.centroCustoId, empresaId])).rowCount)
    throw new ErroHttp(400, 'Centro de custo não encontrado.');
  if (d.fim && d.fim < d.inicio) throw new ErroHttp(400, 'O fim da vigência é antes do início.');
  if (d.tipo === 'global' && !d.valorGlobal) throw new ErroHttp(400, 'Informe o valor global do contrato.');
  if (d.tipo === 'itens' && !d.itens.length) throw new ErroHttp(400, 'Inclua os itens do contrato (serviço, unidade, quantidade e preço).');
}

async function gravarItensContrato(c: Cliente, empresaId: string, contratoId: string, itens: z.infer<typeof esquemaContrato>['itens']) {
  // Itens já medidos não podem sumir nem ficar abaixo do medido (aditivo só aumenta ou inclui).
  const atuais = (
    await c.query(
      `SELECT ci.id, ci.descricao, coalesce((SELECT sum(mi.quantidade) FROM medicoes_itens mi JOIN medicoes m ON m.id = mi.medicao_id
                                              WHERE mi.contrato_item_id = ci.id AND m.status IN ${MEDICAO_CONTA}), 0) AS medido
         FROM contratos_itens ci WHERE ci.contrato_id = $1`,
      [contratoId],
    )
  ).rows;
  const manter = new Set(itens.map((i) => i.id).filter(Boolean));
  for (const a of atuais) {
    const novo = itens.find((i) => i.id === a.id);
    if (Number(a.medido) > 0 && !novo) throw new ErroHttp(409, `"${a.descricao}" já foi medido e não pode sair do contrato.`);
    if (novo && novo.quantidade < Number(a.medido)) throw new ErroHttp(409, `"${a.descricao}": a quantidade não pode ficar abaixo do já medido (${Number(a.medido).toLocaleString('pt-BR')}).`);
  }
  await c.query('DELETE FROM contratos_itens WHERE contrato_id = $1 AND NOT (id = ANY($2::uuid[]))', [contratoId, [...manter]]);
  for (const [n, i] of itens.entries()) {
    if (i.id && atuais.some((a) => a.id === i.id))
      await c.query('UPDATE contratos_itens SET ordem = $2, descricao = $3, unidade = $4, quantidade = $5, preco_unitario_centavos = $6 WHERE id = $1', [i.id, n + 1, i.descricao, i.unidade, r3(i.quantidade), centPreco(i.precoUnitario)]);
    else
      await c.query('INSERT INTO contratos_itens (empresa_id, contrato_id, ordem, descricao, unidade, quantidade, preco_unitario_centavos) VALUES ($1,$2,$3,$4,$5,$6,$7)', [empresaId, contratoId, n + 1, i.descricao, i.unidade, r3(i.quantidade), centPreco(i.precoUnitario)]);
  }
}


// ---------------------------------------------------------------- medição

async function detalharMedicao(c: Cliente, empresaId: string, id: string, usuario?: { perfil: string; administrador: boolean }) {
  if (!UUID.test(id)) throw naoEncontrado('Medição');
  const m = (
    await c.query(
      `SELECT m.*, ua.nome AS aprovado_por, uc.nome AS criado_por FROM medicoes m
         LEFT JOIN usuarios ua ON ua.id = m.aprovado_por_id LEFT JOIN usuarios uc ON uc.id = m.criado_por_id
        WHERE m.id = $1 AND m.empresa_id = $2`,
      [id, empresaId],
    )
  ).rows[0];
  if (!m) throw naoEncontrado('Medição');
  const k = await detalharContrato(c, empresaId, m.contrato_id);
  const lancados = (await c.query('SELECT * FROM medicoes_itens WHERE medicao_id = $1', [m.id])).rows;
  // Anterior = medições aprovadas desta obra com sequência menor.
  const anteriores = (
    await c.query(
      `SELECT mi.contrato_item_id, sum(mi.quantidade) AS q, sum(mi.valor_centavos) AS v FROM medicoes_itens mi JOIN medicoes x ON x.id = mi.medicao_id
        WHERE x.contrato_id = $1 AND x.status = 'aprovada' AND x.sequencia < $2 GROUP BY mi.contrato_item_id`,
      [m.contrato_id, m.sequencia],
    )
  ).rows;
  const ant = (itemId: string | null) => anteriores.find((a) => (a.contrato_item_id ?? null) === itemId);
  const itens =
    k.tipo === 'itens'
      ? k.itens.map((i) => {
          const atual = lancados.find((l) => l.contrato_item_id === i.id);
          const qAnt = Number(ant(i.id)?.q ?? 0);
          const qAtual = Number(atual?.quantidade ?? 0);
          return {
            contratoItemId: i.id,
            descricao: i.descricao,
            unidade: i.unidade,
            quantidadeContrato: i.quantidade,
            precoUnitario: i.precoUnitario,
            totalContrato: i.total,
            anterior: r3(qAnt),
            atual: r3(qAtual),
            acumulado: r3(qAnt + qAtual),
            saldo: r3(i.quantidade - qAnt - qAtual),
            valorAnterior: Math.round(qAnt * i.precoUnitario * 100) / 100,
            valorAtual: reais(atual?.valor_centavos ?? 0)!,
            percentualAcumulado: i.quantidade > 0 ? Math.round(((qAnt + qAtual) / i.quantidade) * 10000) / 10000 : 0,
          };
        })
      : [];
  const valorAnterior = anteriores.reduce((s, a) => s + Number(a.v), 0);
  const valorContratoCent = cent(k.resumo.valorContrato);
  const valorAtual = Number(m.valor_centavos);
  const regras = await lerRegras(c, empresaId);
  const aut = (
    await c.query(
      "SELECT id, numero, status FROM autorizacoes_pagamento WHERE medicao_id = $1 AND status IN ('aguardando_aprovacao', 'aprovada') LIMIT 1",
      [m.id],
    )
  ).rows[0];
  const descontos = (await c.query('SELECT id, descricao, valor_centavos FROM medicoes_descontos WHERE medicao_id = $1 ORDER BY ordem', [m.id])).rows;
  const totalDescontos = descontos.reduce((s, x) => s + Number(x.valor_centavos), 0);
  return {
    id: m.id as string,
    numero: m.numero as number,
    sequencia: m.sequencia as number,
    contratoId: k.id,
    contrato: { numero: k.numero, objeto: k.objeto, tipo: k.tipo, fornecedor: k.fornecedor, retencoes: k.retencoes, valor: k.resumo.valorContrato, status: k.status, prazoPagamentoDias: k.prazoPagamentoDias, formaPagamento: k.formaPagamento },
    periodoInicio: m.periodo_inicio as string,
    periodoFim: m.periodo_fim as string,
    data: m.data as string,
    valor: reais(valorAtual)!,
    observacao: m.observacao as string | null,
    base: m.base as 'quantidades' | 'percentual' | 'valor' | null,
    percentual: m.percentual === null ? null : Number(m.percentual),
    descontos: descontos.map((x) => ({ id: x.id as string, descricao: x.descricao as string, valor: reais(x.valor_centavos)! })),
    totalDescontos: reais(totalDescontos)!,
    status: m.status as 'rascunho' | 'aguardando_aprovacao' | 'aprovada' | 'reprovada' | 'cancelada',
    criadoPor: m.criado_por as string | null,
    enviadoAprovacaoEm: m.enviado_aprovacao_em as string | null,
    aprovadoPor: m.aprovado_por as string | null,
    aprovadoEm: m.aprovado_em as string | null,
    aprovacaoAutomatica: !!m.aprovacao_automatica,
    motivoReprovacao: m.motivo_reprovacao as string | null,
    itens,
    totais: {
      contrato: k.resumo.valorContrato,
      anterior: reais(valorAnterior)!,
      atual: reais(valorAtual)!,
      acumulado: reais(valorAnterior + valorAtual)!,
      saldo: reais(valorContratoCent - valorAnterior - valorAtual)!,
      percentualAcumulado: valorContratoCent > 0 ? Math.round(((valorAnterior + valorAtual) / valorContratoCent) * 10000) / 10000 : 0,
    },
    retencoesPrevistas: (() => {
      const x = calcularRetencoes({ caucao_pct: k.retencoes.caucao, iss_pct: k.retencoes.iss, inss_pct: k.retencoes.inss, ir_pct: k.retencoes.ir, pcc_pct: k.retencoes.pcc }, valorAtual);
      return { caucao: reais(x.caucao)!, iss: reais(x.iss)!, inss: reais(x.inss)!, ir: reais(x.ir)!, pcc: reais(x.pcc)!, liquido: reais(x.liquido)!, descontos: reais(totalDescontos)!, liquidoAPagar: reais(x.liquido - totalDescontos)! };
    })(),
    autorizacao: aut ? { id: aut.id as string, numero: aut.numero as number, status: aut.status as string } : null,
    podeAprovar: usuario ? podeAprovar(usuario, valorAtual, regras) : false,
    regrasAprovacao: textoRegras(regras),
  };
}

const esquemaMedicao = z.object({
  contratoId: z.string().regex(UUID, 'Escolha o contrato.'),
  periodoInicio: dataObr('Informe o início do período medido.'),
  periodoFim: dataObr('Informe o fim do período medido.'),
  data: dataOpc,
  observacao: texto(1000),
  itens: z.array(z.object({ contratoItemId: z.string().regex(UUID), quantidade: naoNegativo('Quantidade inválida.') })).max(200).optional().default([]),
  valor: z.union([positivo('Valor inválido.'), z.null()]).optional().default(null),
  percentual: z.union([positivo('Percentual inválido.'), z.null()]).optional().default(null),
  // Valores a deduzir do pagamento ao terceiro (adiantamento, alimentação, EPI...).
  descontos: z
    .array(z.object({ descricao: z.string({ required_error: 'Informe o que é o desconto.' }).trim().min(1, 'Informe o que é o desconto.').max(120), valor: positivo('Valor do desconto inválido.') }))
    .max(50, 'Até 50 descontos por medição.')
    .optional()
    .default([]),
});

/** Grava os itens (ou o valor do contrato global) e confere o saldo. Devolve o valor em centavos. */
async function gravarMedicao(c: Cliente, empresaId: string, medicaoId: string, k: LinhaContrato, d: z.infer<typeof esquemaMedicao>) {
  if (d.periodoFim < d.periodoInicio) throw new ErroHttp(400, 'O fim do período é antes do início.');
  await c.query('DELETE FROM medicoes_itens WHERE medicao_id = $1', [medicaoId]);
  let total = 0;
  if (k.tipo === 'itens') {
    const itens = (
      await c.query(
        `SELECT ci.*, coalesce((SELECT sum(mi.quantidade) FROM medicoes_itens mi JOIN medicoes m ON m.id = mi.medicao_id
                                 WHERE mi.contrato_item_id = ci.id AND m.status IN ${MEDICAO_CONTA} AND m.id <> $2), 0) AS outros
           FROM contratos_itens ci WHERE ci.contrato_id = $1`,
        [k.id, medicaoId],
      )
    ).rows;
    // Por percentual: aplica o % a cada item, sobre o quantitativo contratado. Por quantitativos: o que foi digitado.
    const lista = d.percentual !== null ? itens.map((i) => ({ contratoItemId: i.id as string, quantidade: (Number(i.quantidade) * d.percentual!) / 100 })) : d.itens;
    for (const l of lista) {
      if (!l.quantidade) continue;
      const i = itens.find((x) => x.id === l.contratoItemId);
      if (!i) throw new ErroHttp(400, 'Item não pertence ao contrato.');
      const saldo = Number(i.quantidade) - Number(i.outros);
      if (l.quantidade > saldo + 0.0005)
        throw new ErroHttp(409, `"${i.descricao}": a medição (${l.quantidade.toLocaleString('pt-BR')}) passa do saldo do contrato (${r3(saldo).toLocaleString('pt-BR')} ${i.unidade}). Faça um aditivo no contrato antes.`);
      const v = Math.round(r3(l.quantidade) * Number(i.preco_unitario_centavos));
      total += v;
      await c.query('INSERT INTO medicoes_itens (empresa_id, medicao_id, contrato_item_id, quantidade, valor_centavos) VALUES ($1,$2,$3,$4,$5)', [empresaId, medicaoId, i.id, r3(l.quantidade), v]);
    }
  } else {
    const global = Number(k.valor_global_centavos);
    const v = d.valor !== null ? cent(d.valor) : d.percentual !== null ? Math.round((global * d.percentual) / 100) : 0;
    const outros = Number(
      (await c.query(`SELECT coalesce(sum(valor_centavos), 0) AS v FROM medicoes WHERE contrato_id = $1 AND id <> $2 AND status IN ${MEDICAO_CONTA}`, [k.id, medicaoId])).rows[0].v,
    );
    if (v > global - outros) throw new ErroHttp(409, `A medição passa do saldo do contrato (${((global - outros) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}). Faça um aditivo antes.`);
    total = v;
    if (v) await c.query('INSERT INTO medicoes_itens (empresa_id, medicao_id, contrato_item_id, quantidade, valor_centavos) VALUES ($1,$2,NULL,0,$3)', [empresaId, medicaoId, v]);
  }
  if (total <= 0) throw new ErroHttp(400, 'Informe o que foi executado no período.');
  const descontos = d.descontos ?? [];
  const somaDescontos = descontos.reduce((s, x) => s + cent(x.valor), 0);
  if (somaDescontos > total) throw new ErroHttp(400, 'Os descontos passam do valor da medição.');
  await c.query('DELETE FROM medicoes_descontos WHERE medicao_id = $1', [medicaoId]);
  for (const [i, x] of descontos.entries())
    await c.query('INSERT INTO medicoes_descontos (empresa_id, medicao_id, ordem, descricao, valor_centavos) VALUES ($1,$2,$3,$4,$5)', [empresaId, medicaoId, i + 1, x.descricao, cent(x.valor)]);
  const base = k.tipo === 'itens' ? (d.percentual !== null ? 'percentual' : 'quantidades') : d.valor !== null ? 'valor' : d.percentual !== null ? 'percentual' : null;
  await c.query('UPDATE medicoes SET valor_centavos = $2, base = $3, percentual = $4, atualizado_em = now() WHERE id = $1', [medicaoId, total, base, d.percentual]);
  return total;
}

// ---------------------------------------------------------------- autorização de pagamento

async function detalharAutorizacao(c: Cliente, empresaId: string, id: string, usuario?: { perfil: string; administrador: boolean }) {
  if (!UUID.test(id)) throw naoEncontrado('Autorização');
  const a = (
    await c.query(
      `SELECT a.*, m.sequencia AS medicao_sequencia, m.numero AS medicao_numero, m.periodo_inicio, m.periodo_fim, ua.nome AS aprovado_por, uc.nome AS criado_por,
              (SELECT json_agg(json_build_object('numero', p.numero, 'vencimento', p.vencimento, 'valor', p.valor_centavos, 'status', p.status, 'pagoEm', p.data_pagamento, 'obs', p.observacoes) ORDER BY p.numero)
                 FROM parcelas p WHERE p.lancamento_id = a.lancamento_id) AS parcelas,
              (SELECT json_agg(json_build_object('numero', p.numero, 'vencimento', p.vencimento, 'valor', p.valor_centavos, 'status', p.status, 'obs', p.observacoes) ORDER BY p.numero)
                 FROM parcelas p WHERE p.lancamento_id = a.lancamento_impostos_id) AS parcelas_impostos
         FROM autorizacoes_pagamento a LEFT JOIN medicoes m ON m.id = a.medicao_id
         LEFT JOIN usuarios ua ON ua.id = a.aprovado_por_id LEFT JOIN usuarios uc ON uc.id = a.criado_por_id
        WHERE a.id = $1 AND a.empresa_id = $2`,
      [id, empresaId],
    )
  ).rows[0];
  if (!a) throw naoEncontrado('Autorização');
  const k = await detalharContrato(c, empresaId, a.contrato_id);
  const regras = await lerRegras(c, empresaId);
  const parc = (x: any) => ({ numero: x.numero, vencimento: x.vencimento, valor: reais(x.valor)!, status: x.status, pagoEm: x.pagoEm ?? null, observacao: x.obs ?? null });
  return {
    id: a.id as string,
    numero: a.numero as number,
    tipo: a.tipo as 'medicao' | 'caucao',
    contratoId: k.id,
    contrato: { numero: k.numero, objeto: k.objeto, fornecedor: k.fornecedor, planoConta: k.planoConta, centroCusto: k.centroCusto, retencoes: k.retencoes },
    medicao: a.medicao_id ? { id: a.medicao_id as string, numero: a.medicao_numero as number, sequencia: a.medicao_sequencia as number, periodoInicio: a.periodo_inicio as string, periodoFim: a.periodo_fim as string } : null,
    data: a.data as string,
    vencimento: a.vencimento as string,
    bruto: reais(a.bruto_centavos)!,
    caucao: reais(a.caucao_centavos)!,
    iss: reais(a.iss_centavos)!,
    inss: reais(a.inss_centavos)!,
    ir: reais(a.ir_centavos)!,
    pcc: reais(a.pcc_centavos)!,
    impostos: reais(Number(a.iss_centavos) + Number(a.inss_centavos) + Number(a.ir_centavos) + Number(a.pcc_centavos))!,
    descontos: reais(a.descontos_centavos)!,
    liquido: reais(a.liquido_centavos)!,
    documento: a.documento as string | null,
    formaPagamento: a.forma_pagamento as string | null,
    observacao: a.observacao as string | null,
    status: a.status as 'aguardando_aprovacao' | 'aprovada' | 'reprovada' | 'cancelada',
    criadoPor: a.criado_por as string | null,
    enviadoAprovacaoEm: a.enviado_aprovacao_em as string,
    aprovadoPor: a.aprovado_por as string | null,
    aprovadoEm: a.aprovado_em as string | null,
    aprovacaoAutomatica: !!a.aprovacao_automatica,
    motivoReprovacao: a.motivo_reprovacao as string | null,
    lancamentoId: a.lancamento_id as string | null,
    lancamentoImpostosId: a.lancamento_impostos_id as string | null,
    parcelas: ((a.parcelas ?? []) as any[]).map(parc),
    parcelasImpostos: ((a.parcelas_impostos ?? []) as any[]).map(parc),
    pago: ((a.parcelas ?? []) as any[]).length > 0 && ((a.parcelas ?? []) as any[]).every((p) => p.status === 'paga'),
    podeAprovar: usuario ? podeAprovar(usuario, Number(a.bruto_centavos), regras) : false,
    regrasAprovacao: textoRegras(regras),
  };
}

/** Na aprovação: conta a pagar do prestador (líquido) e, se houver, a dos impostos retidos (vence dia 20 do mês seguinte). */
export async function gerarContasAPagar(c: Cliente, empresaId: string, autorizacaoId: string, usuarioId: string) {
  const a = (await c.query('SELECT a.*, m.sequencia, m.periodo_fim FROM autorizacoes_pagamento a LEFT JOIN medicoes m ON m.id = a.medicao_id WHERE a.id = $1', [autorizacaoId])).rows[0];
  const k = (await c.query('SELECT k.*, coalesce(f.nome_fantasia, f.razao_social) AS fornecedor FROM contratos k JOIN fornecedores f ON f.id = k.fornecedor_id WHERE k.id = $1', [a.contrato_id])).rows[0];
  const competencia = a.tipo === 'medicao' ? a.periodo_fim : a.data;
  const ref = a.tipo === 'medicao' ? `Medição ${a.sequencia} · contrato ${k.numero}` : `Liberação da caução · contrato ${k.numero}`;
  const doc = `AP ${String(a.numero).padStart(4, '0')}${a.documento ? ` · ${a.documento}` : ''}`;
  const lanc = async (descricao: string, valor: number, fornecedorId: string | null, parcelas: { venc: string; valor: number; obs: string | null }[]) => {
    const l = (
      await c.query(
        `INSERT INTO lancamentos (empresa_id, tipo, competencia, descricao, documento, valor_total_centavos, fornecedor_id, origem, observacoes, criado_por_id)
         VALUES ($1,'despesa',$2,$3,$4,$5,$6,'suprimentos',$7,$8) RETURNING id`,
        [empresaId, competencia, descricao, doc, valor, fornecedorId, `Gerado pela autorização de pagamento nº ${a.numero} (Suprimentos).`, usuarioId],
      )
    ).rows[0];
    await c.query('INSERT INTO apropriacoes (empresa_id, lancamento_id, plano_conta_id, centro_custo_id, descricao, valor_centavos) VALUES ($1,$2,$3,$4,$5,$6)', [empresaId, l.id, k.plano_conta_id, k.centro_custo_id, ref, valor]);
    for (const [i, p] of parcelas.entries())
      await c.query('INSERT INTO parcelas (empresa_id, lancamento_id, numero, vencimento, valor_centavos, forma_pagamento, observacoes) VALUES ($1,$2,$3,$4,$5,$6,$7)', [empresaId, l.id, i + 1, p.venc, p.valor, a.forma_pagamento, p.obs]);
    await auditar(c, { empresaId, usuarioId, acao: 'criar', entidade: 'lancamentos', entidadeId: l.id, depois: { origem: 'suprimentos', autorizacao: a.numero, valor: valor / 100 } });
    return l.id as string;
  };
  const principal = await lanc(`${k.fornecedor} · ${ref} · ${k.objeto}`.slice(0, 300), Number(a.liquido_centavos), k.fornecedor_id, [{ venc: a.vencimento, valor: Number(a.liquido_centavos), obs: null }]);
  const impostos = [
    ['ISS retido', Number(a.iss_centavos)],
    ['INSS retido', Number(a.inss_centavos)],
    ['IR retido', Number(a.ir_centavos)],
    ['PIS/COFINS/CSLL retidos', Number(a.pcc_centavos)],
  ].filter(([, v]) => (v as number) > 0) as [string, number][];
  let lancImp: string | null = null;
  if (impostos.length) {
    const venc = `${somarMeses(`${String(competencia).slice(0, 7)}-01`, 1).slice(0, 7)}-20`;
    const soma = impostos.reduce((s, [, v]) => s + v, 0);
    lancImp = await lanc(`Impostos retidos · ${k.fornecedor} · ${ref}`.slice(0, 300), soma, null, impostos.map(([obs, v]) => ({ venc, valor: v, obs })));
  }
  await c.query('UPDATE autorizacoes_pagamento SET lancamento_id = $2, lancamento_impostos_id = $3 WHERE id = $1', [autorizacaoId, principal, lancImp]);
}

async function cancelarContasAPagar(c: Cliente, a: Record<string, any>, usuarioId: string) {
  for (const l of [a.lancamento_id, a.lancamento_impostos_id].filter(Boolean)) {
    const pagas = (await c.query("SELECT count(*)::int AS n FROM parcelas WHERE lancamento_id = $1 AND status = 'paga'", [l])).rows[0].n;
    if (pagas) throw new ErroHttp(409, 'Já há pagamento lançado para esta autorização. Estorne o pagamento em Contas a pagar e receber antes.');
  }
  for (const l of [a.lancamento_id, a.lancamento_impostos_id].filter(Boolean)) {
    await c.query("UPDATE lancamentos SET status = 'cancelado', atualizado_em = now() WHERE id = $1", [l]);
    await c.query("UPDATE parcelas SET status = 'cancelada', atualizado_em = now() WHERE lancamento_id = $1 AND status = 'aberta'", [l]);
    await auditar(c, { empresaId: a.empresa_id, usuarioId, acao: 'excluir', entidade: 'lancamentos', entidadeId: l, depois: { status: 'cancelado', motivo: `autorização ${a.numero} cancelada` } });
  }
}

// ---------------------------------------------------------------- rotas

export function rotasContratos(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.addHook('preHandler', exigir(banco, 'dono', 'gestor'));
    // Engenheiro de obra: só contratos e medições lançados no centro de custo das obras atribuídas a ele.
    app.addHook('preHandler', async (req) => {
      if (!ehEngenheiroDeObra(req.usuario)) return;
      const empresaId = empresaDo(req);
      const centros = await centrosPermitidos(banco, empresaId, req.usuario);
      const caminho = req.url.split('?')[0].replace(/^\/api\/sup/, '');
      const corpo = (req.body ?? {}) as { centroCustoId?: string | null; contratoId?: string };
      const centroDoContrato = async (id: string) =>
        (await banco.query('SELECT centro_custo_id FROM contratos WHERE id::text = $1 AND empresa_id = $2', [id, empresaId])).rows[0]?.centro_custo_id as string | null | undefined;
      const exigirCentro = (centro: string | null | undefined) => {
        if (!centro || !centros!.includes(centro)) throw new ErroHttp(403, 'Escolha o centro de custo de uma obra sob sua responsabilidade.');
      };
      let m: RegExpExecArray | null;
      if ((m = /^\/contratos\/([^/]+)/.exec(caminho))) {
        const centro = await centroDoContrato(m[1]);
        if (!centro || !centros!.includes(centro)) throw naoEncontrado('Contrato');
        if (req.method === 'PUT' && corpo.centroCustoId !== undefined) exigirCentro(corpo.centroCustoId);
      } else if ((m = /^\/medicoes\/([^/]+)/.exec(caminho))) {
        const r = await banco.query('SELECT k.centro_custo_id FROM medicoes m JOIN contratos k ON k.id = m.contrato_id WHERE m.id::text = $1 AND m.empresa_id = $2', [m[1], empresaId]);
        const centro = r.rows[0]?.centro_custo_id as string | null | undefined;
        if (!centro || !centros!.includes(centro)) throw naoEncontrado('Medição');
      } else if (caminho === '/contratos' && req.method === 'POST') {
        exigirCentro(corpo.centroCustoId);
      } else if (caminho === '/medicoes' && req.method === 'POST') {
        const centro = corpo.contratoId ? await centroDoContrato(corpo.contratoId) : null;
        if (!centro || !centros!.includes(centro)) throw naoEncontrado('Contrato');
      }
      // Listas (GET /contratos e /medicoes) são filtradas na rota.
    });

    // ----- Contratos
    app.get<{ Querystring: Record<string, string | undefined> }>('/contratos', async (req) => {
      const empresaId = empresaDo(req);
      const status = ['rascunho', 'vigente', 'encerrado', 'cancelado'].includes(req.query.status ?? '') ? req.query.status! : null;
      const ids = (
        await banco.query(
          `SELECT id FROM contratos WHERE empresa_id = $1 AND ($2::text IS NULL OR status = $2) AND ($2::text IS NOT NULL OR status IN ('rascunho', 'aguardando_aprovacao', 'reprovado', 'vigente'))
              AND ($3::uuid[] IS NULL OR centro_custo_id = ANY($3::uuid[]))
            ORDER BY array_position(ARRAY['aguardando_aprovacao','reprovado','rascunho','vigente','encerrado','cancelado'], status), numero DESC LIMIT 300`,
          [empresaId, status, await centrosPermitidos(banco, empresaId, req.usuario)],
        )
      ).rows;
      const contratos = [];
      for (const x of ids) {
        const k = await detalharContrato(banco, empresaId, x.id);
        contratos.push({
          id: k.id, numero: k.numero, status: k.status, fornecedor: k.fornecedor.nome, objeto: k.objeto, tipo: k.tipo, inicio: k.inicio, fim: k.fim, vencido: k.vencido,
          valor: k.resumo.valorContrato, medido: k.resumo.medido, saldo: k.resumo.saldo, percentualMedido: k.resumo.percentualMedido, pago: k.resumo.pago,
          medicoesPendentes: k.resumo.medicoesPendentes, medicoesSemAutorizacao: k.resumo.medicoesSemAutorizacao, caucaoALiberar: k.resumo.caucaoALiberar,
        });
      }
      return { contratos };
    });

    app.get<{ Params: { id: string } }>('/contratos/:id', async (req) => ({ contrato: await detalharContrato(banco, empresaDo(req), req.params.id, usuarioDe(req)) }));

    app.post('/contratos', async (req, reply) => {
      const d = esquemaContrato.parse(req.body);
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      const id = await emTransacao(banco, async (c) => {
        await validarContrato(c, empresaId, d);
        const numero = await proximoNumero(c, 'contratos', empresaId);
        const k = (
          await c.query(
            `INSERT INTO contratos (empresa_id, numero, fornecedor_id, objeto, tipo, data_assinatura, inicio, fim, valor_global_centavos, plano_conta_id, centro_custo_id,
                                    prazo_pagamento_dias, forma_pagamento, caucao_pct, iss_pct, inss_pct, ir_pct, pcc_pct, observacao, criado_por_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id`,
            [empresaId, numero, d.fornecedorId, d.objeto, d.tipo, d.dataAssinatura, d.inicio, d.fim, d.tipo === 'global' ? cent(d.valorGlobal!) : null, d.planoContaId, d.centroCustoId,
              d.prazoPagamentoDias, d.formaPagamento, d.retencoes.caucao, d.retencoes.iss, d.retencoes.inss, d.retencoes.ir, d.retencoes.pcc, d.observacao, u.id],
          )
        ).rows[0];
        if (d.tipo === 'itens') await gravarItensContrato(c, empresaId, k.id, d.itens);
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'criar', entidade: 'contratos', entidadeId: k.id, depois: { numero, objeto: d.objeto } });
        return k.id as string;
      });
      reply.code(201);
      return { contrato: await detalharContrato(banco, empresaId, id, u) };
    });

    app.put<{ Params: { id: string } }>('/contratos/:id', async (req) => {
      const d = esquemaContrato.parse(req.body);
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      await emTransacao(banco, async (c) => {
        const k = await carregarContrato(c, empresaId, req.params.id, true);
        if (!['rascunho', 'reprovado', 'vigente'].includes(k.status)) throw new ErroHttp(409, k.status === 'aguardando_aprovacao' ? 'Contrato aguardando aprovação não muda. Aguarde a decisão.' : 'Contrato encerrado ou cancelado não muda.');
        const temMedicao = (await c.query(`SELECT 1 FROM medicoes WHERE contrato_id = $1 AND status IN ${MEDICAO_CONTA}`, [k.id])).rowCount;
        if (temMedicao && (d.tipo !== k.tipo || d.fornecedorId !== k.fornecedor_id)) throw new ErroHttp(409, 'Com medição lançada, o prestador e o tipo do contrato não mudam.');
        await validarContrato(c, empresaId, d);
        if (d.tipo === 'global' && temMedicao) {
          const medido = Number((await c.query(`SELECT coalesce(sum(valor_centavos), 0) AS v FROM medicoes WHERE contrato_id = $1 AND status IN ${MEDICAO_CONTA}`, [k.id])).rows[0].v);
          if (cent(d.valorGlobal!) < medido) throw new ErroHttp(409, 'O valor global não pode ficar abaixo do já medido.');
        }
        await c.query(
          `UPDATE contratos SET fornecedor_id = $2, objeto = $3, tipo = $4, data_assinatura = $5, inicio = $6, fim = $7, valor_global_centavos = $8, plano_conta_id = $9,
                  centro_custo_id = $10, prazo_pagamento_dias = $11, forma_pagamento = $12, caucao_pct = $13, iss_pct = $14, inss_pct = $15, ir_pct = $16, pcc_pct = $17,
                  observacao = $18, atualizado_em = now() WHERE id = $1`,
          [k.id, d.fornecedorId, d.objeto, d.tipo, d.dataAssinatura, d.inicio, d.fim, d.tipo === 'global' ? cent(d.valorGlobal!) : null, d.planoContaId, d.centroCustoId,
            d.prazoPagamentoDias, d.formaPagamento, d.retencoes.caucao, d.retencoes.iss, d.retencoes.inss, d.retencoes.ir, d.retencoes.pcc, d.observacao],
        );
        if (d.tipo === 'itens') await gravarItensContrato(c, empresaId, k.id, d.itens);
        else await c.query('DELETE FROM contratos_itens WHERE contrato_id = $1', [k.id]);
        if (k.status === 'reprovado') await c.query("UPDATE contratos SET status = 'rascunho', motivo_reprovacao = NULL WHERE id = $1", [k.id]);
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'alterar', entidade: 'contratos', entidadeId: k.id, antes: { status: k.status, objeto: k.objeto }, depois: { objeto: d.objeto, aditivo: k.status === 'vigente' } });
      });
      return { contrato: await detalharContrato(banco, empresaId, req.params.id, u) };
    });

    const mudarStatusContrato = (rota: string, de: string[], para: string, msg: string, extra?: (c: Cliente, k: LinhaContrato) => Promise<void>) =>
      app.post<{ Params: { id: string } }>(`/contratos/:id/${rota}`, async (req) => {
        const empresaId = empresaDo(req);
        const u = usuarioDe(req);
        await emTransacao(banco, async (c) => {
          const k = await carregarContrato(c, empresaId, req.params.id, true);
          if (!de.includes(k.status)) throw new ErroHttp(409, msg);
          if (extra) await extra(c, k);
          await c.query(`UPDATE contratos SET status = $2, encerrado_em = CASE WHEN $2 = 'encerrado' THEN $3::date ELSE encerrado_em END, atualizado_em = now() WHERE id = $1`, [k.id, para, hojeBrasil()]);
                    await auditar(c, { empresaId, usuarioId: u.id, acao: 'alterar', entidade: 'contratos', entidadeId: k.id, antes: { status: k.status }, depois: { status: para } });
        });
        return { contrato: await detalharContrato(banco, empresaId, req.params.id, u) };
      });
    // ----- Aprovação do contrato (padrão: o dono aprova). Aprovado, fica vigente e recebe medições.
    const valorDoContrato = async (c: Cliente, k: LinhaContrato) =>
      k.tipo === 'global'
        ? Number(k.valor_global_centavos)
        : Number((await c.query('SELECT coalesce(sum(round(quantidade * preco_unitario_centavos)), 0) AS v FROM contratos_itens WHERE contrato_id = $1', [k.id])).rows[0].v);

    app.post<{ Params: { id: string } }>('/contratos/:id/enviar-aprovacao', async (req) => {
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      await emTransacao(banco, async (c) => {
        const k = await carregarContrato(c, empresaId, req.params.id, true);
        if (!['rascunho', 'reprovado'].includes(k.status)) throw new ErroHttp(409, 'Este contrato já foi enviado para aprovação.');
        const valor = await valorDoContrato(c, k);
        if (valor <= 0) throw new ErroHttp(400, 'O contrato não tem valor.');
        if (dispensaAprovacao(valor, await lerRegras(c, empresaId))) {
          await c.query("UPDATE contratos SET status = 'vigente', enviado_aprovacao_em = now(), aprovado_em = now(), aprovado_por_id = NULL, aprovacao_automatica = true, motivo_reprovacao = NULL, atualizado_em = now() WHERE id = $1", [k.id]);
        } else await c.query("UPDATE contratos SET status = 'aguardando_aprovacao', enviado_aprovacao_em = now(), motivo_reprovacao = NULL, atualizado_em = now() WHERE id = $1", [k.id]);
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'alterar', entidade: 'contratos', entidadeId: k.id, depois: { acao: 'enviar para aprovação', valor: valor / 100 } });
      });
      return { contrato: await detalharContrato(banco, empresaId, req.params.id, u) };
    });

    app.post<{ Params: { id: string } }>('/contratos/:id/aprovar', async (req) => {
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      await emTransacao(banco, async (c) => {
        const k = await carregarContrato(c, empresaId, req.params.id, true);
        if (k.status !== 'aguardando_aprovacao') throw new ErroHttp(409, 'Este contrato não está aguardando aprovação.');
        const valor = await valorDoContrato(c, k);
        if (!podeAprovar(u, valor, await lerRegras(c, empresaId))) throw new ErroHttp(403, 'Você não tem alçada para aprovar este valor.');
        await c.query("UPDATE contratos SET status = 'vigente', aprovado_em = now(), aprovado_por_id = $2, aprovacao_automatica = false, atualizado_em = now() WHERE id = $1", [k.id, u.id]);
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'confirmar', entidade: 'contratos', entidadeId: k.id, depois: { acao: 'aprovar', valor: valor / 100 } });
      });
      return { contrato: await detalharContrato(banco, empresaId, req.params.id, u) };
    });

    app.post<{ Params: { id: string } }>('/contratos/:id/reprovar', async (req) => {
      const d = z.object({ motivo: z.string().trim().min(3, 'Escreva o motivo da reprovação.').max(500) }).parse(req.body);
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      await emTransacao(banco, async (c) => {
        const k = await carregarContrato(c, empresaId, req.params.id, true);
        if (k.status !== 'aguardando_aprovacao') throw new ErroHttp(409, 'Este contrato não está aguardando aprovação.');
        if (!podeAprovar(u, await valorDoContrato(c, k), await lerRegras(c, empresaId))) throw new ErroHttp(403, 'Você não tem alçada para reprovar este valor.');
        await c.query("UPDATE contratos SET status = 'reprovado', motivo_reprovacao = $2, aprovado_por_id = $3, aprovado_em = now(), atualizado_em = now() WHERE id = $1", [k.id, d.motivo, u.id]);
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'alterar', entidade: 'contratos', entidadeId: k.id, depois: { acao: 'reprovar', motivo: d.motivo } });
      });
      return { contrato: await detalharContrato(banco, empresaId, req.params.id, u) };
    });

    mudarStatusContrato('encerrar', ['vigente'], 'encerrado', 'Só contrato vigente é encerrado.', async (c, k) => {
      if ((await c.query("SELECT 1 FROM medicoes WHERE contrato_id = $1 AND status IN ('rascunho', 'aguardando_aprovacao')", [k.id])).rowCount)
        throw new ErroHttp(409, 'Há medição em rascunho ou aguardando aprovação. Conclua ou cancele antes de encerrar.');
    });
    mudarStatusContrato('reabrir', ['encerrado'], 'vigente', 'Só contrato encerrado é reaberto.');
    mudarStatusContrato('cancelar', ['rascunho', 'reprovado', 'aguardando_aprovacao', 'vigente'], 'cancelado', 'Este contrato já foi encerrado ou cancelado.', async (c, k) => {
      if ((await c.query(`SELECT 1 FROM medicoes WHERE contrato_id = $1 AND status IN ${MEDICAO_CONTA}`, [k.id])).rowCount)
        throw new ErroHttp(409, 'Contrato com medição não é cancelado: encerre-o.');
    });

    // ----- Medições
    app.get<{ Querystring: Record<string, string | undefined> }>('/medicoes', async (req) => {
      const empresaId = empresaDo(req);
      const st = req.query.status ?? '';
      const r = await banco.query(
        `SELECT m.id, m.numero, m.sequencia, m.periodo_inicio, m.periodo_fim, m.data, m.valor_centavos, m.status, k.numero AS contrato_numero, k.objeto,
                coalesce(f.nome_fantasia, f.razao_social) AS fornecedor,
                (SELECT json_build_object('id', a.id, 'numero', a.numero, 'status', a.status) FROM autorizacoes_pagamento a
                  WHERE a.medicao_id = m.id AND a.status IN ('aguardando_aprovacao', 'aprovada') LIMIT 1) AS autorizacao
           FROM medicoes m JOIN contratos k ON k.id = m.contrato_id JOIN fornecedores f ON f.id = k.fornecedor_id
          WHERE m.empresa_id = $1
            AND ($3::uuid[] IS NULL OR k.centro_custo_id = ANY($3::uuid[]))
            AND CASE $2
                  WHEN 'aprovacao' THEN m.status = 'aguardando_aprovacao'
                  WHEN 'autorizar' THEN m.status = 'aprovada' AND NOT EXISTS (SELECT 1 FROM autorizacoes_pagamento a WHERE a.medicao_id = m.id AND a.status IN ('aguardando_aprovacao', 'aprovada'))
                  WHEN 'aprovadas' THEN m.status = 'aprovada'
                  WHEN 'canceladas' THEN m.status IN ('cancelada', 'reprovada')
                  ELSE m.status <> 'cancelada' AND (m.status <> 'aprovada' OR m.data > current_date - 180)
                END
          ORDER BY array_position(ARRAY['aguardando_aprovacao','reprovada','rascunho','aprovada','cancelada'], m.status), m.numero DESC LIMIT 500`,
        [empresaId, st, await centrosPermitidos(banco, empresaId, req.usuario)],
      );
      return {
        medicoes: r.rows.map((m) => ({
          id: m.id, numero: m.numero, sequencia: m.sequencia, periodoInicio: m.periodo_inicio, periodoFim: m.periodo_fim, data: m.data, valor: reais(m.valor_centavos),
          status: m.status, contratoNumero: m.contrato_numero, objeto: m.objeto, fornecedor: m.fornecedor, autorizacao: m.autorizacao,
        })),
      };
    });

    app.get<{ Params: { id: string } }>('/medicoes/:id', async (req) => ({ medicao: await detalharMedicao(banco, empresaDo(req), req.params.id, usuarioDe(req)) }));

    app.post('/medicoes', async (req, reply) => {
      const d = esquemaMedicao.parse(req.body);
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      const id = await emTransacao(banco, async (c) => {
        const k = await carregarContrato(c, empresaId, d.contratoId, true);
        if (k.status !== 'vigente') throw new ErroHttp(409, 'Só contrato vigente (aprovado) recebe medição.');
        const numero = await proximoNumero(c, 'medicoes', empresaId);
        const seq = Number((await c.query('SELECT coalesce(max(sequencia), 0) + 1 AS n FROM medicoes WHERE contrato_id = $1', [k.id])).rows[0].n);
        const m = (
          await c.query(
            'INSERT INTO medicoes (empresa_id, numero, contrato_id, sequencia, periodo_inicio, periodo_fim, data, observacao, criado_por_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
            [empresaId, numero, k.id, seq, d.periodoInicio, d.periodoFim, d.data ?? hojeBrasil(), d.observacao, u.id],
          )
        ).rows[0];
        const v = await gravarMedicao(c, empresaId, m.id, k, d);
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'criar', entidade: 'medicoes', entidadeId: m.id, depois: { numero, contrato: k.numero, valor: v / 100 } });
        return m.id as string;
      });
      reply.code(201);
      return { medicao: await detalharMedicao(banco, empresaId, id, u) };
    });

    const medicaoPara = async (c: Cliente, empresaId: string, id: string) => {
      if (!UUID.test(id)) throw naoEncontrado('Medição');
      const m = (await c.query('SELECT * FROM medicoes WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [id, empresaId])).rows[0];
      if (!m) throw naoEncontrado('Medição');
      return m as Record<string, any>;
    };

    app.put<{ Params: { id: string } }>('/medicoes/:id', async (req) => {
      const d = esquemaMedicao.parse(req.body);
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      await emTransacao(banco, async (c) => {
        const m = await medicaoPara(c, empresaId, req.params.id);
        if (!['rascunho', 'reprovada'].includes(m.status)) throw new ErroHttp(409, 'Só medição em rascunho ou reprovada é alterada.');
        if (d.contratoId !== m.contrato_id) throw new ErroHttp(400, 'A medição não muda de contrato.');
        const k = await carregarContrato(c, empresaId, m.contrato_id);
        await c.query("UPDATE medicoes SET periodo_inicio = $2, periodo_fim = $3, data = coalesce($4, data), observacao = $5, status = 'rascunho', motivo_reprovacao = NULL WHERE id = $1", [m.id, d.periodoInicio, d.periodoFim, d.data, d.observacao]);
        const v = await gravarMedicao(c, empresaId, m.id, k, d);
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'alterar', entidade: 'medicoes', entidadeId: m.id, antes: { valor: Number(m.valor_centavos) / 100 }, depois: { valor: v / 100 } });
      });
      return { medicao: await detalharMedicao(banco, empresaId, req.params.id, u) };
    });

    app.post<{ Params: { id: string } }>('/medicoes/:id/enviar-aprovacao', async (req) => {
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      await emTransacao(banco, async (c) => {
        const m = await medicaoPara(c, empresaId, req.params.id);
        if (!['rascunho', 'reprovada'].includes(m.status)) throw new ErroHttp(409, 'Esta medição já foi enviada.');
        const regras = await lerRegras(c, empresaId);
        const v = Number(m.valor_centavos);
        if (dispensaAprovacao(v, regras))
          await c.query("UPDATE medicoes SET status = 'aprovada', enviado_aprovacao_em = now(), aprovado_em = now(), aprovado_por_id = NULL, aprovacao_automatica = true, motivo_reprovacao = NULL WHERE id = $1", [m.id]);
        else await c.query("UPDATE medicoes SET status = 'aguardando_aprovacao', enviado_aprovacao_em = now(), motivo_reprovacao = NULL WHERE id = $1", [m.id]);
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'alterar', entidade: 'medicoes', entidadeId: m.id, depois: { acao: 'enviar para aprovação', valor: v / 100 } });
      });
      return { medicao: await detalharMedicao(banco, empresaId, req.params.id, u) };
    });

    app.post<{ Params: { id: string } }>('/medicoes/:id/aprovar', async (req) => {
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      await emTransacao(banco, async (c) => {
        const m = await medicaoPara(c, empresaId, req.params.id);
        if (m.status !== 'aguardando_aprovacao') throw new ErroHttp(409, 'Esta medição não está aguardando aprovação.');
        if (!podeAprovar(u, Number(m.valor_centavos), await lerRegras(c, empresaId))) throw new ErroHttp(403, 'Você não tem alçada para aprovar este valor.');
        await c.query("UPDATE medicoes SET status = 'aprovada', aprovado_em = now(), aprovado_por_id = $2, aprovacao_automatica = false WHERE id = $1", [m.id, u.id]);
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'confirmar', entidade: 'medicoes', entidadeId: m.id, depois: { acao: 'aprovar', valor: Number(m.valor_centavos) / 100 } });
      });
      return { medicao: await detalharMedicao(banco, empresaId, req.params.id, u) };
    });

    app.post<{ Params: { id: string } }>('/medicoes/:id/reprovar', async (req) => {
      const d = z.object({ motivo: z.string().trim().min(3, 'Escreva o motivo da reprovação.').max(500) }).parse(req.body);
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      await emTransacao(banco, async (c) => {
        const m = await medicaoPara(c, empresaId, req.params.id);
        if (m.status !== 'aguardando_aprovacao') throw new ErroHttp(409, 'Esta medição não está aguardando aprovação.');
        if (!podeAprovar(u, Number(m.valor_centavos), await lerRegras(c, empresaId))) throw new ErroHttp(403, 'Você não tem alçada para reprovar este valor.');
        await c.query("UPDATE medicoes SET status = 'reprovada', motivo_reprovacao = $2, aprovado_por_id = $3, aprovado_em = now() WHERE id = $1", [m.id, d.motivo, u.id]);
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'alterar', entidade: 'medicoes', entidadeId: m.id, depois: { acao: 'reprovar', motivo: d.motivo } });
      });
      return { medicao: await detalharMedicao(banco, empresaId, req.params.id, u) };
    });

    app.post<{ Params: { id: string } }>('/medicoes/:id/cancelar', async (req) => {
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      await emTransacao(banco, async (c) => {
        const m = await medicaoPara(c, empresaId, req.params.id);
        if (m.status === 'cancelada') throw new ErroHttp(409, 'Esta medição já está cancelada.');
        if ((await c.query("SELECT 1 FROM autorizacoes_pagamento WHERE medicao_id = $1 AND status IN ('aguardando_aprovacao', 'aprovada')", [m.id])).rowCount)
          throw new ErroHttp(409, 'Há autorização de pagamento desta medição. Cancele a autorização antes.');
        await c.query("UPDATE medicoes SET status = 'cancelada', atualizado_em = now() WHERE id = $1", [m.id]);
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'alterar', entidade: 'medicoes', entidadeId: m.id, antes: { status: m.status }, depois: { status: 'cancelada' } });
      });
      return { medicao: await detalharMedicao(banco, empresaId, req.params.id, u) };
    });

    // ----- Autorizações de pagamento
    app.get<{ Querystring: Record<string, string | undefined> }>('/autorizacoes', async (req) => {
      const empresaId = empresaDo(req);
      const st = req.query.status ?? '';
      const r = await banco.query(
        `SELECT a.id, a.numero, a.tipo, a.data, a.vencimento, a.bruto_centavos, a.liquido_centavos, a.status, k.numero AS contrato_numero, k.objeto,
                coalesce(f.nome_fantasia, f.razao_social) AS fornecedor, m.sequencia AS medicao_sequencia,
                coalesce((SELECT bool_and(p.status = 'paga') FROM parcelas p WHERE p.lancamento_id = a.lancamento_id), false) AS pago
           FROM autorizacoes_pagamento a JOIN contratos k ON k.id = a.contrato_id JOIN fornecedores f ON f.id = k.fornecedor_id LEFT JOIN medicoes m ON m.id = a.medicao_id
          WHERE a.empresa_id = $1
            AND CASE $2
                  WHEN 'aprovacao' THEN a.status = 'aguardando_aprovacao'
                  WHEN 'aprovadas' THEN a.status = 'aprovada'
                  WHEN 'canceladas' THEN a.status IN ('cancelada', 'reprovada')
                  ELSE a.status <> 'cancelada' AND (a.status <> 'aprovada' OR a.data > current_date - 180)
                END
          ORDER BY (a.status = 'aguardando_aprovacao') DESC, a.numero DESC LIMIT 500`,
        [empresaId, st],
      );
      return {
        autorizacoes: r.rows.map((a) => ({
          id: a.id, numero: a.numero, tipo: a.tipo, data: a.data, vencimento: a.vencimento, bruto: reais(a.bruto_centavos), liquido: reais(a.liquido_centavos), status: a.status,
          contratoNumero: a.contrato_numero, objeto: a.objeto, fornecedor: a.fornecedor, medicaoSequencia: a.medicao_sequencia, pago: a.pago,
        })),
      };
    });

    app.get<{ Params: { id: string } }>('/autorizacoes/:id', async (req) => ({ autorizacao: await detalharAutorizacao(banco, empresaDo(req), req.params.id, usuarioDe(req)) }));

    app.post('/autorizacoes', async (req, reply) => {
      const d = z
        .object({
          medicaoId: uuidOpc,
          contratoId: uuidOpc,
          tipo: z.enum(['medicao', 'caucao']).optional().default('medicao'),
          vencimento: dataOpc,
          documento: texto(80),
          formaPagamento: z.enum(FORMAS).optional().nullable().transform((v) => v ?? null),
          observacao: texto(500),
          // Ajuste manual das retenções (em R$), quando a nota de serviço trouxer valores diferentes.
          retencoes: z
            .object({ caucao: naoNegativo('Caução inválida.'), iss: naoNegativo('ISS inválido.'), inss: naoNegativo('INSS inválido.'), ir: naoNegativo('IR inválido.'), pcc: naoNegativo('PIS/COFINS/CSLL inválido.') })
            .optional()
            .nullable(),
        })
        .parse(req.body);
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      const id = await emTransacao(banco, async (c) => {
        let k: LinhaContrato;
        let bruto: number;
        let medicaoId: string | null = null;
        let ret: ReturnType<typeof calcularRetencoes>;
        if (d.tipo === 'medicao') {
          if (!d.medicaoId) throw new ErroHttp(400, 'Escolha a medição.');
          const m = await medicaoPara(c, empresaId, d.medicaoId);
          if (m.status !== 'aprovada') throw new ErroHttp(409, 'A medição precisa estar aprovada para autorizar o pagamento.');
          if ((await c.query("SELECT 1 FROM autorizacoes_pagamento WHERE medicao_id = $1 AND status IN ('aguardando_aprovacao', 'aprovada')", [m.id])).rowCount)
            throw new ErroHttp(409, 'Esta medição já tem autorização de pagamento.');
          k = await carregarContrato(c, empresaId, m.contrato_id, true);
          bruto = Number(m.valor_centavos);
          medicaoId = m.id;
          ret = calcularRetencoes(k, bruto);
          if (d.retencoes) {
            const x = { caucao: cent(d.retencoes.caucao), iss: cent(d.retencoes.iss), inss: cent(d.retencoes.inss), ir: cent(d.retencoes.ir), pcc: cent(d.retencoes.pcc) };
            ret = { ...x, liquido: bruto - x.caucao - x.iss - x.inss - x.ir - x.pcc };
          }
        } else {
          if (!d.contratoId) throw new ErroHttp(400, 'Escolha o contrato.');
          const det = await detalharContrato(c, empresaId, d.contratoId);
          k = await carregarContrato(c, empresaId, d.contratoId, true);
          if (k.status !== 'encerrado') throw new ErroHttp(409, 'A caução é liberada no encerramento do contrato. Encerre o contrato antes.');
          bruto = cent(det.resumo.caucaoALiberar);
          if (bruto <= 0) throw new ErroHttp(409, 'Não há caução retida a liberar neste contrato.');
          ret = { caucao: 0, iss: 0, inss: 0, ir: 0, pcc: 0, liquido: bruto };
        }
        // Descontos da medição (adiantamento, alimentação, EPI...) também saem do que será pago.
        const descontos = medicaoId ? Number((await c.query('SELECT coalesce(sum(valor_centavos), 0) AS v FROM medicoes_descontos WHERE medicao_id = $1', [medicaoId])).rows[0].v) : 0;
        const liquido = ret.liquido - descontos;
        if (liquido <= 0) throw new ErroHttp(400, 'As retenções e os descontos não podem somar o valor todo.');
        const numero = await proximoNumero(c, 'autorizacoes_pagamento', empresaId);
        const hoje = hojeBrasil();
        const vencimento = d.vencimento ?? somarDias(hoje, Number(k.prazo_pagamento_dias ?? 15));
        const a = (
          await c.query(
            `INSERT INTO autorizacoes_pagamento (empresa_id, numero, tipo, contrato_id, medicao_id, data, vencimento, bruto_centavos, caucao_centavos, iss_centavos, inss_centavos,
                                                 ir_centavos, pcc_centavos, descontos_centavos, liquido_centavos, documento, forma_pagamento, observacao, criado_por_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
            [empresaId, numero, d.tipo, k.id, medicaoId, hoje, vencimento, bruto, ret.caucao, ret.iss, ret.inss, ret.ir, ret.pcc, descontos, liquido, d.documento,
              d.formaPagamento ?? k.forma_pagamento, d.observacao, u.id],
          )
        ).rows[0];
        // Mesma regra dos pedidos: só a dispensa por valor aprova direto; o resto vai para a fila de aprovações.
        const regras = await lerRegras(c, empresaId);
        if (dispensaAprovacao(bruto, regras)) {
          await c.query("UPDATE autorizacoes_pagamento SET status = 'aprovada', aprovado_em = now(), aprovado_por_id = NULL, aprovacao_automatica = true WHERE id = $1", [a.id]);
          await gerarContasAPagar(c, empresaId, a.id, u.id);
        }
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'criar', entidade: 'autorizacoes_pagamento', entidadeId: a.id, depois: { numero, tipo: d.tipo, bruto: bruto / 100, descontos: descontos / 100, liquido: liquido / 100 } });
        return a.id as string;
      });
      reply.code(201);
      return { autorizacao: await detalharAutorizacao(banco, empresaId, id, u) };
    });

    const autorizacaoPara = async (c: Cliente, empresaId: string, id: string) => {
      if (!UUID.test(id)) throw naoEncontrado('Autorização');
      const a = (await c.query('SELECT * FROM autorizacoes_pagamento WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [id, empresaId])).rows[0];
      if (!a) throw naoEncontrado('Autorização');
      return a as Record<string, any>;
    };

    app.post<{ Params: { id: string } }>('/autorizacoes/:id/aprovar', async (req) => {
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      await emTransacao(banco, async (c) => {
        const a = await autorizacaoPara(c, empresaId, req.params.id);
        if (a.status !== 'aguardando_aprovacao') throw new ErroHttp(409, 'Esta autorização não está aguardando aprovação.');
        if (!podeAprovar(u, Number(a.bruto_centavos), await lerRegras(c, empresaId))) throw new ErroHttp(403, 'Você não tem alçada para aprovar este valor.');
        await c.query("UPDATE autorizacoes_pagamento SET status = 'aprovada', aprovado_em = now(), aprovado_por_id = $2, aprovacao_automatica = false, atualizado_em = now() WHERE id = $1", [a.id, u.id]);
        await gerarContasAPagar(c, empresaId, a.id, u.id);
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'confirmar', entidade: 'autorizacoes_pagamento', entidadeId: a.id, depois: { acao: 'aprovar', liquido: Number(a.liquido_centavos) / 100 } });
      });
      return { autorizacao: await detalharAutorizacao(banco, empresaId, req.params.id, u) };
    });

    app.post<{ Params: { id: string } }>('/autorizacoes/:id/reprovar', async (req) => {
      const d = z.object({ motivo: z.string().trim().min(3, 'Escreva o motivo da reprovação.').max(500) }).parse(req.body);
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      await emTransacao(banco, async (c) => {
        const a = await autorizacaoPara(c, empresaId, req.params.id);
        if (a.status !== 'aguardando_aprovacao') throw new ErroHttp(409, 'Esta autorização não está aguardando aprovação.');
        if (!podeAprovar(u, Number(a.bruto_centavos), await lerRegras(c, empresaId))) throw new ErroHttp(403, 'Você não tem alçada para reprovar este valor.');
        await c.query("UPDATE autorizacoes_pagamento SET status = 'reprovada', motivo_reprovacao = $2, aprovado_por_id = $3, aprovado_em = now(), atualizado_em = now() WHERE id = $1", [a.id, d.motivo, u.id]);
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'alterar', entidade: 'autorizacoes_pagamento', entidadeId: a.id, depois: { acao: 'reprovar', motivo: d.motivo } });
      });
      return { autorizacao: await detalharAutorizacao(banco, empresaId, req.params.id, u) };
    });

    app.post<{ Params: { id: string } }>('/autorizacoes/:id/cancelar', async (req) => {
      const empresaId = empresaDo(req);
      const u = usuarioDe(req);
      await emTransacao(banco, async (c) => {
        const a = await autorizacaoPara(c, empresaId, req.params.id);
        if (['cancelada', 'reprovada'].includes(a.status)) throw new ErroHttp(409, 'Esta autorização já foi cancelada ou reprovada.');
        await cancelarContasAPagar(c, a, u.id);
        await c.query("UPDATE autorizacoes_pagamento SET status = 'cancelada', atualizado_em = now() WHERE id = $1", [a.id]);
        await auditar(c, { empresaId, usuarioId: u.id, acao: 'alterar', entidade: 'autorizacoes_pagamento', entidadeId: a.id, antes: { status: a.status }, depois: { status: 'cancelada' } });
      });
      return { autorizacao: await detalharAutorizacao(banco, empresaId, req.params.id, u) };
    });

    // ----- Relatório de contratos
    app.get<{ Querystring: Record<string, string | undefined> }>('/relatorios/contratos', async (req) => {
      const empresaId = empresaDo(req);
      const MES = /^\d{4}-\d{2}$/;
      const hoje = hojeBrasil();
      const de = req.query.de && DATA.test(req.query.de) ? req.query.de : req.query.de && MES.test(req.query.de) ? `${req.query.de}-01` : somarDias(hoje, -90);
      const ate = req.query.ate && DATA.test(req.query.ate) ? req.query.ate : req.query.ate && MES.test(req.query.ate) ? somarDias(somarMeses(`${req.query.ate}-01`, 1), -1) : hoje;
      const ids = (await banco.query("SELECT id FROM contratos WHERE empresa_id = $1 AND status <> 'cancelado' AND (status IN ('rascunho', 'vigente') OR coalesce(encerrado_em, fim, inicio) >= $2::date) ORDER BY numero", [empresaId, de])).rows;
      const posicao = [];
      for (const x of ids) {
        const k = await detalharContrato(banco, empresaId, x.id);
        posicao.push({ id: k.id, numero: k.numero, fornecedor: k.fornecedor.nome, objeto: k.objeto, status: k.status, inicio: k.inicio, fim: k.fim, valor: k.resumo.valorContrato, medido: k.resumo.medido, percentual: k.resumo.percentualMedido, saldo: k.resumo.saldo, pago: k.resumo.pago, caucaoRetida: k.resumo.caucaoRetida - k.resumo.caucaoLiberada, impostos: k.resumo.impostosRetidos });
      }
      const medicoes = (
        await banco.query(
          `SELECT m.id, m.numero, m.sequencia, m.periodo_inicio, m.periodo_fim, m.valor_centavos, m.status, k.numero AS contrato, coalesce(f.nome_fantasia, f.razao_social) AS fornecedor, ua.nome AS aprovado_por
             FROM medicoes m JOIN contratos k ON k.id = m.contrato_id JOIN fornecedores f ON f.id = k.fornecedor_id LEFT JOIN usuarios ua ON ua.id = m.aprovado_por_id
            WHERE m.empresa_id = $1 AND m.periodo_fim BETWEEN $2 AND $3 AND m.status NOT IN ('cancelada') ORDER BY m.periodo_fim, m.numero`,
          [empresaId, de, ate],
        )
      ).rows.map((m) => ({ id: m.id, numero: m.numero, sequencia: m.sequencia, contrato: m.contrato, fornecedor: m.fornecedor, periodoInicio: m.periodo_inicio, periodoFim: m.periodo_fim, valor: reais(m.valor_centavos), status: m.status, aprovadoPor: m.aprovado_por }));
      const pagamentos = (
        await banco.query(
          `SELECT a.id, a.numero, a.tipo, a.data, a.vencimento, a.bruto_centavos, a.caucao_centavos, a.iss_centavos, a.inss_centavos, a.ir_centavos, a.pcc_centavos, a.liquido_centavos, a.status,
                  k.numero AS contrato, coalesce(f.nome_fantasia, f.razao_social) AS fornecedor, ua.nome AS aprovado_por,
                  coalesce((SELECT bool_and(p.status = 'paga') FROM parcelas p WHERE p.lancamento_id = a.lancamento_id), false) AS pago
             FROM autorizacoes_pagamento a JOIN contratos k ON k.id = a.contrato_id JOIN fornecedores f ON f.id = k.fornecedor_id LEFT JOIN usuarios ua ON ua.id = a.aprovado_por_id
            WHERE a.empresa_id = $1 AND a.data BETWEEN $2 AND $3 AND a.status IN ('aguardando_aprovacao', 'aprovada') ORDER BY a.data, a.numero`,
          [empresaId, de, ate],
        )
      ).rows.map((a) => ({
        id: a.id, numero: a.numero, tipo: a.tipo, data: a.data, vencimento: a.vencimento, contrato: a.contrato, fornecedor: a.fornecedor, status: a.status, aprovadoPor: a.aprovado_por, pago: a.pago,
        bruto: reais(a.bruto_centavos), caucao: reais(a.caucao_centavos), iss: reais(a.iss_centavos), inss: reais(a.inss_centavos), ir: reais(a.ir_centavos), pcc: reais(a.pcc_centavos), liquido: reais(a.liquido_centavos),
      }));
      return { de, ate, posicao, medicoes, pagamentos };
    });
  };
}
