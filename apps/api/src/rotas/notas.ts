// Etapa 5 · Notas fiscais: importação do XML (NF-e/NFC-e), lançamento manual, conferência,
// apropriação por item (com regras aprendidas), vínculo com abastecimentos e OS e geração do lançamento.
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import type { Banco, Cliente } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';
import { hojeBrasil } from '../lib/frota.ts';
import { somarDias } from '../lib/financeiro.ts';
import { ErroNfe, fecharCentavos, formaDoTPag, lerNfe, type NotaNfe } from '../lib/nfe.ts';
import { escolherRegra, normalizar, sugerirPorPalavras, type Regra } from '../lib/sugestoes.ts';
import { empresaDo, exigir } from '../sessao.ts';
import { fatorPadrao, registrarEntradasNota, removerEntradasNota, sugerirInsumo } from '../lib/estoque.ts';
import { baixarParcela, dinheiro, esquemaBaixa, numeroBr } from './financeiro.ts';

const reais = (c: unknown) => (c === null || c === undefined ? null : Number(c) / 100);
const UUID = /^[0-9a-f-]{36}$/i;
const dataObrig = (msg: string) => z.string({ required_error: msg }).regex(/^\d{4}-\d{2}-\d{2}$/, msg);
const uuidOpc = z.union([z.string().uuid(), z.literal(''), z.null()]).optional().transform((v) => v || null);
const textoOpc = (max = 200) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const MODELOS = ['nfe', 'nfce', 'nfse', 'cte', 'cupom', 'recibo', 'outro'] as const;
const FORMAS = ['pix', 'boleto', 'transferencia', 'cartao', 'dinheiro', 'cheque', 'debito_automatico'] as const;

const esquemaDuplicata = z.object({ numero: textoOpc(30), vencimento: dataObrig('Vencimento inválido.'), valor: dinheiro('o valor da parcela') });

const esquemaItemManual = z.object({
  descricao: z.string({ required_error: 'Descreva o item.' }).trim().min(2, 'Descreva o item.').max(300),
  unidade: textoOpc(10),
  quantidade: z.preprocess(numeroBr, z.number({ invalid_type_error: 'Quantidade inválida.' }).positive('Quantidade inválida.').max(10_000_000)).optional().default(1),
  valor: dinheiro('o valor do item'),
  planoContaId: uuidOpc,
  centroCustoId: uuidOpc,
  veiculoId: uuidOpc,
});

const esquemaNotaManual = z.object({
  direcao: z.enum(['entrada', 'saida']).optional().default('entrada'),
  modelo: z.enum(MODELOS).optional().default('nfe'),
  numero: textoOpc(20),
  serie: textoOpc(5),
  chaveAcesso: z.union([z.string(), z.null()]).optional().transform((v) => (v ?? '').replace(/\D/g, '') || null)
    .refine((v) => v === null || v.length === 44, 'A chave de acesso tem 44 números.'),
  dataEmissao: dataObrig('Data de emissão inválida.'),
  competencia: dataObrig('Data de competência inválida.').optional(),
  fornecedorId: uuidOpc,
  clienteId: uuidOpc,
  frete: dinheiro('o frete', { positivo: false }).optional().default(0),
  desconto: dinheiro('o desconto', { positivo: false }).optional().default(0),
  outras: dinheiro('outras despesas', { positivo: false }).optional().default(0),
  formaPagamento: z.union([z.enum(FORMAS), z.literal(''), z.null()]).optional().transform((v) => v || null),
  observacoes: textoOpc(1000),
  itens: z.array(esquemaItemManual).min(1, 'Inclua pelo menos um item.').max(300),
  duplicatas: z.array(esquemaDuplicata).max(120).optional().default([]),
});

const esquemaAlterarNota = z
  .object({
    competencia: dataObrig('Data de competência inválida.'),
    observacoes: textoOpc(1000),
    fornecedorId: uuidOpc,
    clienteId: uuidOpc,
    formaPagamento: z.union([z.enum(FORMAS), z.literal(''), z.null()]).transform((v) => v || null),
    duplicatas: z.array(esquemaDuplicata).max(120),
    // Só para notas lançadas à mão:
    modelo: z.enum(MODELOS),
    numero: textoOpc(20),
    serie: textoOpc(5),
    dataEmissao: dataObrig('Data de emissão inválida.'),
    frete: dinheiro('o frete', { positivo: false }),
    desconto: dinheiro('o desconto', { positivo: false }),
    outras: dinheiro('outras despesas', { positivo: false }),
  })
  .partial()
  .strict();

const esquemaAlterarItem = z
  .object({
    planoContaId: uuidOpc,
    centroCustoId: uuidOpc,
    veiculoId: uuidOpc,
    // Estoque: insumo e quantas unidades do insumo vale cada unidade da nota (t → kg = 1000).
    insumoId: uuidOpc,
    fatorEstoque: z.union([z.preprocess(numeroBr, z.number({ invalid_type_error: 'Fator inválido.' }).positive('O fator precisa ser maior que zero.').max(1_000_000)), z.null()]),
    // Só para notas lançadas à mão:
    descricao: z.string().trim().min(2, 'Descreva o item.').max(300),
    unidade: textoOpc(10),
    quantidade: z.preprocess(numeroBr, z.number({ invalid_type_error: 'Quantidade inválida.' }).positive('Quantidade inválida.').max(10_000_000)),
    valor: dinheiro('o valor do item'),
  })
  .partial()
  .strict();

const esquemaConfirmar = z.object({
  vencimento: dataObrig('Vencimento inválido.').optional(),
  baixa: esquemaBaixa.omit({ juros: true, desconto: true }).optional().nullable(),
  aprender: z.boolean().optional().default(true),
});

// ---------- Leitura ----------
type Nota = Record<string, any>;

async function carregarNota(c: Cliente, empresaId: string, id: string, travar = false) {
  if (!UUID.test(id)) throw naoEncontrado('Nota');
  const n = (
    await c.query(
      `SELECT n.*, coalesce(f.nome_fantasia, f.razao_social) AS fornecedor_nome, f.criado_automaticamente AS fornecedor_novo,
              coalesce(cl.nome_fantasia, cl.razao_social) AS cliente_nome
         FROM notas_fiscais n LEFT JOIN fornecedores f ON f.id = n.fornecedor_id LEFT JOIN clientes cl ON cl.id = n.cliente_id
        WHERE n.id = $1 AND n.empresa_id = $2 AND n.excluido_em IS NULL ${travar ? 'FOR UPDATE OF n' : ''}`,
      [id, empresaId],
    )
  ).rows[0];
  if (!n) throw naoEncontrado('Nota');
  return n as Nota;
}

async function detalharNota(c: Cliente, empresaId: string, id: string) {
  const n = await carregarNota(c, empresaId, id);
  const itens = (
    await c.query(
      `SELECT i.*, pc.codigo AS plano_codigo, pc.nome AS plano_nome, pc.tipo AS plano_tipo, cc.nome AS centro_nome, v.codigo AS veiculo_codigo,
              (SELECT json_build_object('n', count(*), 'litros', coalesce(sum(a.litros), 0), 'valor', coalesce(sum(a.valor_total_centavos), 0),
                                        'veiculos', string_agg(DISTINCT va.codigo, ', '))
                 FROM abastecimentos a JOIN veiculos va ON va.id = a.veiculo_id WHERE a.nota_item_id = i.id AND a.excluido_em IS NULL) AS abast,
              (SELECT json_build_object('n', count(*), 'valor', coalesce(sum(round(oi.quantidade * oi.valor_unitario_centavos)), 0),
                                        'ordens', string_agg(DISTINCT '#' || o.numero || ' ' || vo.codigo, ', '))
                 FROM os_itens oi JOIN ordens_servico o ON o.id = oi.os_id JOIN veiculos vo ON vo.id = o.veiculo_id
                WHERE oi.nota_item_id = i.id AND oi.excluido_em IS NULL) AS os
         , ins.nome AS insumo_nome, ins.unidade AS insumo_unidade
         FROM notas_itens i LEFT JOIN plano_contas pc ON pc.id = i.plano_conta_id LEFT JOIN insumos ins ON ins.id = i.insumo_id
         LEFT JOIN centros_custo cc ON cc.id = i.centro_custo_id LEFT JOIN veiculos v ON v.id = i.veiculo_id
        WHERE i.nota_id = $1 ORDER BY i.numero_item, i.criado_em`,
      [n.id],
    )
  ).rows;
  const duplicatas = (await c.query('SELECT * FROM notas_duplicatas WHERE nota_id = $1 ORDER BY vencimento, numero', [n.id])).rows;
  let lancamento = null;
  if (n.lancamento_id) {
    const l = (
      await c.query(
        `SELECT l.id, l.status, count(p.*)::int AS parcelas, count(p.*) FILTER (WHERE p.status = 'paga')::int AS pagas
           FROM lancamentos l LEFT JOIN parcelas p ON p.lancamento_id = l.id WHERE l.id = $1 GROUP BY l.id`,
        [n.lancamento_id],
      )
    ).rows[0];
    if (l) lancamento = { id: l.id, status: l.status, parcelas: l.parcelas, pagas: l.pagas };
  }
  return notaPublica(n, itens, duplicatas, lancamento);
}

function notaPublica(n: Nota, itens: Nota[], duplicatas: Nota[], lancamento: unknown) {
  const tipo = n.direcao === 'saida' ? 'receita' : 'despesa';
  const somaItens = itens.reduce((s, i) => s + Number(i.valor_custo_centavos), 0);
  const somaDup = duplicatas.reduce((s, d) => s + Number(d.valor_centavos), 0);
  const pendencias: string[] = [];
  if (tipo === 'despesa' && !n.fornecedor_id) pendencias.push('Escolha o fornecedor.');
  if (tipo === 'receita' && !n.cliente_id) pendencias.push('Escolha o cliente.');
  const semCategoria = itens.filter((i) => !i.plano_conta_id).length;
  if (semCategoria) pendencias.push(semCategoria === 1 ? '1 item sem categoria.' : `${semCategoria} itens sem categoria.`);
  const tipoErrado = itens.filter((i) => i.plano_conta_id && i.plano_tipo !== tipo).length;
  if (tipoErrado) pendencias.push(`${tipoErrado} item(ns) com categoria de ${tipo === 'despesa' ? 'receita' : 'despesa'}.`);
  if (somaItens !== Number(n.total_centavos)) pendencias.push('A soma dos itens é diferente do total da nota.');
  if (duplicatas.length && somaDup !== Number(n.total_centavos)) pendencias.push('A soma das parcelas é diferente do total da nota.');
  if (Number(n.total_centavos) <= 0) pendencias.push('O total da nota precisa ser maior que zero.');
  return {
    id: n.id,
    direcao: n.direcao,
    tipo,
    modelo: n.modelo,
    chaveAcesso: n.chave_acesso,
    numero: n.numero,
    serie: n.serie,
    dataEmissao: n.data_emissao,
    competencia: n.competencia,
    fornecedorId: n.fornecedor_id,
    fornecedorNome: n.fornecedor_nome ?? null,
    fornecedorNovo: n.fornecedor_novo ?? false,
    clienteId: n.cliente_id,
    clienteNome: n.cliente_nome ?? null,
    emitenteNome: n.emitente_nome,
    emitenteDocumento: n.emitente_documento,
    naturezaOperacao: n.natureza_operacao,
    totais: {
      produtos: reais(n.valor_produtos_centavos),
      frete: reais(n.frete_centavos),
      seguro: reais(n.seguro_centavos),
      desconto: reais(n.desconto_centavos),
      outras: reais(n.outras_centavos),
      ipi: reais(n.ipi_centavos),
      icmsSt: reais(n.icms_st_centavos),
      total: reais(n.total_centavos),
    },
    formaPagamento: n.forma_pagamento,
    informacoes: n.informacoes,
    observacoes: n.observacoes,
    avisos: n.avisos ?? [],
    origem: n.origem,
    status: n.status,
    temXml: !!n.xml,
    conferidoEm: n.conferido_em,
    lancamento,
    pendencias,
    itens: itens.map((i) => ({
      id: i.id,
      numeroItem: i.numero_item,
      codigoProduto: i.codigo_produto,
      descricao: i.descricao,
      ncm: i.ncm,
      cfop: i.cfop,
      unidade: i.unidade,
      quantidade: Number(i.quantidade),
      valorProduto: reais(i.valor_produto_centavos),
      valorCusto: reais(i.valor_custo_centavos),
      planoContaId: i.plano_conta_id,
      planoCodigo: i.plano_codigo ?? null,
      planoNome: i.plano_nome ?? null,
      centroCustoId: i.centro_custo_id,
      centroNome: i.centro_nome ?? null,
      veiculoId: i.veiculo_id,
      veiculoCodigo: i.veiculo_codigo ?? null,
      insumoId: i.insumo_id ?? null,
      insumoNome: i.insumo_nome ?? null,
      insumoUnidade: i.insumo_unidade ?? null,
      fatorEstoque: i.fator_estoque === null || i.fator_estoque === undefined ? null : Number(i.fator_estoque),
      sugestao: i.sugestao,
      abastecimentos: i.abast && Number(i.abast.n) ? { quantidade: Number(i.abast.n), litros: Number(i.abast.litros), valor: Number(i.abast.valor) / 100, veiculos: i.abast.veiculos } : null,
      os: i.os && Number(i.os.n) ? { quantidade: Number(i.os.n), valor: Number(i.os.valor) / 100, ordens: i.os.ordens } : null,
    })),
    duplicatas: duplicatas.map((d) => ({ id: d.id, numero: d.numero, vencimento: d.vencimento, valor: reais(d.valor_centavos) })),
  };
}

// ---------- Apoio ----------
async function regrasDaEmpresa(c: Cliente, empresaId: string): Promise<Regra[]> {
  const r = await c.query(
    `SELECT r.* FROM regras_apropriacao r JOIN plano_contas pc ON pc.id = r.plano_conta_id
      WHERE r.empresa_id = $1 AND r.ativo AND pc.ativo AND pc.aceita_lancamento`,
    [empresaId],
  );
  return r.rows.map((x) => ({
    id: x.id,
    fornecedorId: x.fornecedor_id,
    textoContem: x.texto_contem,
    ncm: x.ncm,
    planoContaId: x.plano_conta_id,
    centroCustoId: x.centro_custo_id,
    veiculoId: x.veiculo_id,
  }));
}

type Sugerido = { planoContaId: string | null; centroCustoId: string | null; veiculoId: string | null; regraId: string | null; sugestao: string | null };

/** Monta o sugeridor de apropriação (regras → categoria padrão do fornecedor → palavras-chave). */
async function criarSugeridor(c: Cliente, empresaId: string, tipo: 'receita' | 'despesa', fornecedorId: string | null) {
  const regras = await regrasDaEmpresa(c, empresaId);
  const planos = (await c.query('SELECT id, codigo, tipo FROM plano_contas WHERE empresa_id = $1 AND ativo AND aceita_lancamento', [empresaId])).rows;
  const porCodigo = new Map(planos.filter((p) => p.tipo === tipo).map((p) => [p.codigo, p.id]));
  const tipoDo = new Map(planos.map((p) => [p.id, p.tipo]));
  const centros = (await c.query('SELECT id, nome FROM centros_custo WHERE empresa_id = $1 AND ativo', [empresaId])).rows;
  const centroPorNome = new Map(centros.map((x) => [normalizar(x.nome), x.id]));
  let padraoFornecedor: string | null = null;
  if (fornecedorId) {
    padraoFornecedor = (await c.query('SELECT categoria_padrao_id FROM fornecedores WHERE id = $1', [fornecedorId])).rows[0]?.categoria_padrao_id ?? null;
    if (padraoFornecedor && tipoDo.get(padraoFornecedor) !== tipo) padraoFornecedor = null;
  }
  return (descricao: string, ncm: string | null): Sugerido => {
    const r = escolherRegra(regras, fornecedorId, descricao, ncm);
    if (r && tipoDo.get(r.planoContaId) === tipo)
      return { planoContaId: r.planoContaId, centroCustoId: r.centroCustoId, veiculoId: r.veiculoId, regraId: r.id, sugestao: 'regra' };
    if (tipo === 'receita') {
      const d = normalizar(descricao);
      const codigo = /\bBOMBEAMENTO\b|\bBOMBA\b/.test(d) ? '1.2' : /\bTAXA\b|\bESPERA\b|\bVOLUME MINIMO\b|\bFRETE\b|\bENTREGA\b/.test(d) ? '1.3' : '1.1';
      const plano = porCodigo.get(codigo) ?? porCodigo.get('1.1') ?? null;
      return { planoContaId: plano, centroCustoId: null, veiculoId: null, regraId: null, sugestao: plano ? 'palavras' : null };
    }
    const p = sugerirPorPalavras(descricao, ncm);
    if (p && porCodigo.get(p.codigo))
      return { planoContaId: porCodigo.get(p.codigo)!, centroCustoId: p.centro ? centroPorNome.get(normalizar(p.centro)) ?? null : null, veiculoId: null, regraId: null, sugestao: 'palavras' };
    if (padraoFornecedor) return { planoContaId: padraoFornecedor, centroCustoId: null, veiculoId: null, regraId: null, sugestao: 'fornecedor' };
    return { planoContaId: null, centroCustoId: null, veiculoId: null, regraId: null, sugestao: null };
  };
}

/** Acha o fornecedor (ou cliente) pelo CNPJ/CPF; se não existir, cadastra com os dados da nota. */
async function pessoaDaNota(c: pg.PoolClient, empresaId: string, nfe: NotaNfe, papel: 'fornecedor' | 'cliente') {
  const p = papel === 'fornecedor' ? nfe.emitente : nfe.destinatario;
  if (!p) return { id: null, novo: false };
  const tabela = papel === 'fornecedor' ? 'fornecedores' : 'clientes';
  if (p.documento) {
    const r = (await c.query(`SELECT id FROM ${tabela} WHERE empresa_id = $1 AND cnpj_cpf = $2 AND excluido_em IS NULL`, [empresaId, p.documento])).rows[0];
    if (r) return { id: r.id as string, novo: false };
  }
  const nome = p.nome.slice(0, 200);
  const fantasia = p.fantasia && normalizar(p.fantasia) !== normalizar(p.nome) ? p.fantasia.slice(0, 200) : null;
  if (papel === 'fornecedor') {
    const r = await c.query(
      `INSERT INTO fornecedores (empresa_id, categoria, tipo_pessoa, cnpj_cpf, razao_social, nome_fantasia, telefone, email, cidade, uf, criado_automaticamente)
       VALUES ($1,'fornecedor',$2,$3,$4,$5,$6,$7,$8,$9,true) RETURNING id`,
      [empresaId, p.tipoPessoa, p.documento, nome, fantasia, p.telefone, p.email, p.cidade, p.uf?.slice(0, 2) ?? null],
    );
    return { id: r.rows[0].id as string, novo: true };
  }
  const r = await c.query(
    `INSERT INTO clientes (empresa_id, tipo_pessoa, cnpj_cpf, razao_social, nome_fantasia, telefone, email, cidade, uf)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [empresaId, p.tipoPessoa, p.documento, nome, fantasia, p.telefone, p.email, p.cidade, p.uf?.slice(0, 2) ?? null],
  );
  return { id: r.rows[0].id as string, novo: true };
}

async function exigirRascunho(c: pg.PoolClient, empresaId: string, id: string) {
  const n = await carregarNota(c, empresaId, id, true);
  if (n.status !== 'rascunho' && n.status !== 'aguardando_conferencia')
    throw new ErroHttp(409, n.status === 'confirmada' ? 'A nota já foi confirmada. Para mudar, reabra a nota.' : 'Esta nota foi cancelada.');
  return n;
}

/** Nota lançada à mão: recalcula o total e distribui frete, outras e desconto pelos itens. */
async function recalcularManual(c: pg.PoolClient, notaId: string) {
  const n = (await c.query('SELECT * FROM notas_fiscais WHERE id = $1', [notaId])).rows[0];
  const itens = (await c.query('SELECT id, valor_produto_centavos FROM notas_itens WHERE nota_id = $1 ORDER BY numero_item, criado_em', [notaId])).rows;
  const produtos = itens.reduce((s, i) => s + Number(i.valor_produto_centavos), 0);
  const total = produtos + Number(n.frete_centavos) + Number(n.outras_centavos) - Number(n.desconto_centavos);
  if (total < 0) throw new ErroHttp(400, 'O desconto não pode ser maior que o valor dos itens.');
  const custos = produtos > 0 ? fecharCentavos(itens.map((i) => Math.round((Number(i.valor_produto_centavos) * total) / produtos)), total) : itens.map(() => 0);
  for (const [k, i] of itens.entries()) await c.query('UPDATE notas_itens SET valor_custo_centavos = $2 WHERE id = $1', [i.id, custos[k]]);
  await c.query('UPDATE notas_fiscais SET valor_produtos_centavos = $2, total_centavos = $3, atualizado_em = now() WHERE id = $1', [notaId, produtos, total]);
}

async function validarApropriacao(c: Cliente, empresaId: string, tipo: string, a: { planoContaId?: string | null; centroCustoId?: string | null; veiculoId?: string | null }) {
  if (a.planoContaId) {
    const p = (await c.query('SELECT tipo, aceita_lancamento, nome FROM plano_contas WHERE id = $1 AND empresa_id = $2', [a.planoContaId, empresaId])).rows[0];
    if (!p) throw new ErroHttp(400, 'Categoria não encontrada.');
    if (!p.aceita_lancamento) throw new ErroHttp(400, `"${p.nome}" é um grupo. Escolha uma categoria dentro dele.`);
    if (p.tipo !== tipo) throw new ErroHttp(400, `"${p.nome}" é categoria de ${p.tipo}; esta nota é ${tipo}.`);
  }
  if (a.centroCustoId && !(await c.query('SELECT 1 FROM centros_custo WHERE id = $1 AND empresa_id = $2', [a.centroCustoId, empresaId])).rowCount)
    throw new ErroHttp(400, 'Centro de custo não encontrado.');
  if (a.veiculoId && !(await c.query('SELECT 1 FROM veiculos WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL', [a.veiculoId, empresaId])).rowCount)
    throw new ErroHttp(400, 'Veículo não encontrado.');
}

async function validarPessoa(c: Cliente, empresaId: string, direcao: string, fornecedorId: string | null, clienteId: string | null) {
  if (direcao === 'entrada' && clienteId) throw new ErroHttp(400, 'Nota de compra é de fornecedor, não de cliente.');
  if (direcao === 'saida' && fornecedorId) throw new ErroHttp(400, 'Nota de venda é para cliente, não para fornecedor.');
  if (fornecedorId && !(await c.query('SELECT 1 FROM fornecedores WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL', [fornecedorId, empresaId])).rowCount)
    throw new ErroHttp(400, 'Fornecedor não encontrado.');
  if (clienteId && !(await c.query('SELECT 1 FROM clientes WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL', [clienteId, empresaId])).rowCount)
    throw new ErroHttp(400, 'Cliente não encontrado.');
}

/** Divide um valor em centavos na proporção dos pesos, fechando a soma exata. */
function dividirProporcional(total: number, pesos: number[]): number[] {
  const soma = pesos.reduce((s, p) => s + p, 0);
  if (soma <= 0) return fecharCentavos(pesos.map(() => Math.floor(total / pesos.length)), total);
  return fecharCentavos(pesos.map((p) => Math.round((total * p) / soma)), total);
}

async function desfazerLancamento(c: pg.PoolClient, n: Nota, usuarioId: string) {
  await removerEntradasNota(c, n.id);
  if (!n.lancamento_id) return;
  const pagas = (await c.query("SELECT count(*)::int AS n FROM parcelas WHERE lancamento_id = $1 AND status = 'paga'", [n.lancamento_id])).rows[0].n;
  if (pagas) throw new ErroHttp(409, 'Há parcelas desta nota já pagas. Estorne os pagamentos em Contas a pagar e receber antes.');
  await c.query("UPDATE lancamentos SET status = 'cancelado', atualizado_em = now() WHERE id = $1", [n.lancamento_id]);
  await c.query("UPDATE parcelas SET status = 'cancelada', atualizado_em = now() WHERE lancamento_id = $1 AND status = 'aberta'", [n.lancamento_id]);
  await auditar(c, { empresaId: n.empresa_id, usuarioId, acao: 'excluir', entidade: 'lancamentos', entidadeId: n.lancamento_id, depois: { status: 'cancelado', motivo: 'nota reaberta ou cancelada' } });
}

// ---------- Rotas ----------
export function rotasNotas(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.addHook('preHandler', exigir(banco, 'dono', 'gestor'));

    app.get<{ Querystring: Record<string, string | undefined> }>('/notas', async (req) => {
      const q = req.query;
      const empresaId = empresaDo(req);
      const hoje = hojeBrasil();
      const de = /^\d{4}-\d{2}-\d{2}$/.test(q.de ?? '') ? q.de! : `${hoje.slice(0, 7)}-01`;
      const ate = /^\d{4}-\d{2}-\d{2}$/.test(q.ate ?? '') ? q.ate! : somarDias(`${hoje.slice(0, 7)}-01`, 40).slice(0, 7) + '-01';
      const status = ['rascunho', 'confirmada', 'cancelada'].includes(q.status ?? '') ? q.status! : null;
      const r = await banco.query(
        `SELECT n.id, n.direcao, n.modelo, n.numero, n.serie, n.data_emissao, n.competencia, n.total_centavos, n.status, n.origem, n.lancamento_id,
                coalesce(f.nome_fantasia, f.razao_social, cl.nome_fantasia, cl.razao_social, n.emitente_nome) AS pessoa,
                (SELECT count(*)::int FROM notas_itens i WHERE i.nota_id = n.id) AS itens,
                (SELECT count(*)::int FROM notas_itens i WHERE i.nota_id = n.id AND i.plano_conta_id IS NULL) AS sem_categoria,
                (SELECT string_agg(DISTINCT pc.nome, ', ') FROM notas_itens i JOIN plano_contas pc ON pc.id = i.plano_conta_id WHERE i.nota_id = n.id) AS categorias
           FROM notas_fiscais n LEFT JOIN fornecedores f ON f.id = n.fornecedor_id LEFT JOIN clientes cl ON cl.id = n.cliente_id
          WHERE n.empresa_id = $1 AND n.excluido_em IS NULL
            AND ((($3::text IS NULL OR $3 = 'rascunho') AND n.status IN ('rascunho', 'aguardando_conferencia')) OR (n.data_emissao >= $2::date AND n.data_emissao < $4::date))
            AND ($3::text IS NULL OR n.status = $3 OR ($3 = 'rascunho' AND n.status = 'aguardando_conferencia'))
          ORDER BY (n.status IN ('rascunho', 'aguardando_conferencia')) DESC, n.data_emissao DESC, n.criado_em DESC
          LIMIT 1000`,
        [empresaId, de, status, ate],
      );
      // Rascunhos aparecem sempre (qualquer data); as demais, pelo mês de emissão.
      const notas = r.rows.map((n) => ({
          id: n.id,
          direcao: n.direcao,
          modelo: n.modelo,
          numero: n.numero,
          serie: n.serie,
          dataEmissao: n.data_emissao,
          competencia: n.competencia,
          total: reais(n.total_centavos),
          status: n.status,
          origem: n.origem,
          lancamentoId: n.lancamento_id,
          pessoa: n.pessoa,
          itens: n.itens,
          semCategoria: n.sem_categoria,
          categorias: n.categorias,
        }));
      const rascunhos = (await banco.query("SELECT count(*)::int AS n FROM notas_fiscais WHERE empresa_id = $1 AND excluido_em IS NULL AND status IN ('rascunho','aguardando_conferencia')", [empresaId])).rows[0].n;
      return { de, ate, notas, rascunhos };
    });

    app.get<{ Params: { id: string } }>('/notas/:id', async (req) => ({ nota: await detalharNota(banco, empresaDo(req), req.params.id) }));

    app.get<{ Params: { id: string } }>('/notas/:id/xml', async (req, reply) => {
      const n = await carregarNota(banco, empresaDo(req), req.params.id);
      if (!n.xml) throw new ErroHttp(404, 'Esta nota não tem XML.');
      reply.header('Content-Type', 'application/xml; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${n.chave_acesso ?? `nota-${n.numero ?? n.id}`}.xml"`);
      return n.xml;
    });

    // ----- Importação do XML -----
    app.post('/notas/xml', { bodyLimit: 5 * 1024 * 1024 }, async (req, reply) => {
      const { xml } = z.object({ xml: z.string({ required_error: 'Envie o conteúdo do XML.' }).min(1).max(4_000_000, 'Arquivo grande demais.') }).parse(req.body);
      const empresaId = empresaDo(req);
      let nfe: NotaNfe;
      try {
        nfe = lerNfe(xml);
      } catch (e) {
        if (e instanceof ErroNfe) throw new ErroHttp(400, e.message);
        throw new ErroHttp(400, 'Não consegui ler este XML. Confira se é o arquivo da NF-e.');
      }
      const empresa = (await banco.query('SELECT cnpj FROM empresas WHERE id = $1', [empresaId])).rows[0];
      const cnpjEmpresa = String(empresa?.cnpj ?? '').replace(/\D/g, '');
      if (nfe.chaveAcesso) {
        const ja = (
          await banco.query("SELECT id, numero, status FROM notas_fiscais WHERE empresa_id = $1 AND chave_acesso = $2 AND excluido_em IS NULL", [empresaId, nfe.chaveAcesso])
        ).rows[0];
        if (ja) return reply.code(409).send({ erro: `A nota ${ja.numero ?? ''} já foi importada${ja.status === 'confirmada' ? ' e lançada' : ''}.`.replace('  ', ' '), notaId: ja.id });
      }
      const emitidaPelaEmpresa = !!cnpjEmpresa && nfe.emitente.documento === cnpjEmpresa;
      // Nota emitida pela concreteira é venda (receita), a não ser que seja uma nota de entrada que ela mesma emitiu.
      const direcao: 'entrada' | 'saida' = emitidaPelaEmpresa && nfe.tipoOperacao === 'saida' ? 'saida' : 'entrada';
      const avisos: string[] = [];
      if (nfe.autorizada === false) avisos.push('O XML não traz autorização da SEFAZ (nota pode estar cancelada ou denegada).');
      if (nfe.autorizada === null) avisos.push('O XML não traz o protocolo de autorização. Confira a nota no portal da SEFAZ.');
      if (direcao === 'entrada' && !emitidaPelaEmpresa && nfe.destinatario?.documento && cnpjEmpresa && nfe.destinatario.documento !== cnpjEmpresa)
        avisos.push(`A nota foi emitida para outro CNPJ/CPF (${nfe.destinatario.documento}), não para esta empresa.`);
      if (emitidaPelaEmpresa && direcao === 'entrada') avisos.push('Nota de entrada emitida pela própria empresa (devolução ou retorno). Confira as categorias.');

      const usuarioId = req.usuario!.id;
      const id = await emTransacao(banco, async (c) => {
        const pessoa = await pessoaDaNota(c, empresaId, nfe, direcao === 'entrada' ? 'fornecedor' : 'cliente');
        const sugerir = await criarSugeridor(c, empresaId, direcao === 'saida' ? 'receita' : 'despesa', direcao === 'entrada' ? pessoa.id : null);
        const forma = formaDoTPag(nfe.formasPagamento[0]);
        const n = (
          await c.query(
            `INSERT INTO notas_fiscais (empresa_id, direcao, modelo, chave_acesso, numero, serie, data_emissao, competencia, fornecedor_id, cliente_id,
                                        emitente_nome, emitente_documento, natureza_operacao, valor_produtos_centavos, frete_centavos, seguro_centavos,
                                        desconto_centavos, outras_centavos, ipi_centavos, icms_st_centavos, total_centavos, forma_pagamento, informacoes,
                                        avisos, xml, origem, status, criado_por_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,'xml','rascunho',$25) RETURNING *`,
            [
              empresaId, direcao, nfe.modelo, nfe.chaveAcesso, nfe.numero, nfe.serie, nfe.dataEmissao,
              direcao === 'entrada' ? pessoa.id : null, direcao === 'saida' ? pessoa.id : null,
              nfe.emitente.nome, nfe.emitente.documento, nfe.naturezaOperacao,
              nfe.totais.produtos, nfe.totais.frete, nfe.totais.seguro, nfe.totais.desconto, nfe.totais.outras, nfe.totais.ipi, nfe.totais.icmsSt, nfe.totais.total,
              forma, nfe.informacoes?.slice(0, 2000) ?? null, JSON.stringify(avisos), xml, usuarioId,
            ],
          )
        ).rows[0];
        for (const i of nfe.itens) {
          const s = sugerir(i.descricao, i.ncm);
          const ins = direcao === 'entrada' ? await sugerirInsumo(c, empresaId, pessoa.id, i.descricao, i.unidade) : null;
          await c.query(
            `INSERT INTO notas_itens (empresa_id, nota_id, numero_item, codigo_produto, descricao, ncm, cfop, unidade, quantidade, valor_produto_centavos,
                                      valor_custo_centavos, plano_conta_id, centro_custo_id, veiculo_id, regra_id, sugestao, insumo_id, fator_estoque)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
            [empresaId, n.id, i.numeroItem, i.codigoProduto, i.descricao.slice(0, 300), i.ncm, i.cfop, i.unidade, i.quantidade, i.valorProduto, i.valorCusto,
              s.planoContaId, s.centroCustoId, s.veiculoId, s.regraId, s.sugestao, ins?.insumoId ?? null, ins?.fator ?? null],
          );
        }
        for (const d of nfe.duplicatas) {
          await c.query('INSERT INTO notas_duplicatas (empresa_id, nota_id, numero, vencimento, valor_centavos) VALUES ($1,$2,$3,$4,$5)', [empresaId, n.id, d.numero, d.vencimento, d.valor]);
        }
        await auditar(c, { empresaId, usuarioId, acao: 'criar', entidade: 'notas_fiscais', entidadeId: n.id, depois: { ...n, xml: undefined, itens: nfe.itens.length } });
        return n.id as string;
      });
      reply.code(201);
      return { nota: await detalharNota(banco, empresaId, id) };
    });

    // ----- Nota lançada à mão -----
    app.post('/notas', async (req, reply) => {
      const d = esquemaNotaManual.parse(req.body);
      const empresaId = empresaDo(req);
      const usuarioId = req.usuario!.id;
      const tipo = d.direcao === 'saida' ? 'receita' : 'despesa';
      const id = await emTransacao(banco, async (c) => {
        await validarPessoa(c, empresaId, d.direcao, d.fornecedorId, d.clienteId);
        if (d.chaveAcesso && (await c.query('SELECT 1 FROM notas_fiscais WHERE empresa_id = $1 AND chave_acesso = $2 AND excluido_em IS NULL', [empresaId, d.chaveAcesso])).rowCount)
          throw new ErroHttp(409, 'Já existe uma nota com esta chave de acesso.');
        if (d.numero && (d.fornecedorId || d.clienteId)) {
          const dup = (
            await c.query(
              `SELECT 1 FROM notas_fiscais WHERE empresa_id = $1 AND numero = $2 AND coalesce(serie, '') = coalesce($3, '') AND modelo = $4
                  AND (fornecedor_id = $5 OR cliente_id = $6) AND excluido_em IS NULL AND status <> 'cancelada'`,
              [empresaId, d.numero, d.serie, d.modelo, d.fornecedorId, d.clienteId],
            )
          ).rowCount;
          if (dup) throw new ErroHttp(409, `A nota ${d.numero}${d.serie ? `/${d.serie}` : ''} deste ${tipo === 'despesa' ? 'fornecedor' : 'cliente'} já foi lançada.`);
        }
        const sugerir = await criarSugeridor(c, empresaId, tipo, d.fornecedorId);
        const n = (
          await c.query(
            `INSERT INTO notas_fiscais (empresa_id, direcao, modelo, chave_acesso, numero, serie, data_emissao, competencia, fornecedor_id, cliente_id,
                                        frete_centavos, desconto_centavos, outras_centavos, forma_pagamento, observacoes, origem, status, criado_por_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'manual','rascunho',$16) RETURNING *`,
            [empresaId, d.direcao, d.modelo, d.chaveAcesso, d.numero, d.serie, d.dataEmissao, d.competencia ?? d.dataEmissao, d.fornecedorId, d.clienteId,
              d.frete, d.desconto, d.outras, d.formaPagamento, d.observacoes, usuarioId],
          )
        ).rows[0];
        for (const [k, i] of d.itens.entries()) {
          await validarApropriacao(c, empresaId, tipo, i);
          const s = i.planoContaId ? null : sugerir(i.descricao, null);
          await c.query(
            `INSERT INTO notas_itens (empresa_id, nota_id, numero_item, descricao, unidade, quantidade, valor_produto_centavos, plano_conta_id, centro_custo_id, veiculo_id, regra_id, sugestao)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [empresaId, n.id, k + 1, i.descricao, i.unidade, i.quantidade, i.valor, i.planoContaId ?? s?.planoContaId ?? null,
              i.planoContaId ? i.centroCustoId : i.centroCustoId ?? s?.centroCustoId ?? null, i.veiculoId ?? (i.planoContaId ? null : s?.veiculoId ?? null), s?.regraId ?? null, s?.sugestao ?? null],
          );
        }
        for (const x of d.duplicatas) {
          await c.query('INSERT INTO notas_duplicatas (empresa_id, nota_id, numero, vencimento, valor_centavos) VALUES ($1,$2,$3,$4,$5)', [empresaId, n.id, x.numero, x.vencimento, x.valor]);
        }
        await recalcularManual(c, n.id);
        await auditar(c, { empresaId, usuarioId, acao: 'criar', entidade: 'notas_fiscais', entidadeId: n.id, depois: d });
        return n.id as string;
      });
      reply.code(201);
      return { nota: await detalharNota(banco, empresaId, id) };
    });

    app.patch<{ Params: { id: string } }>('/notas/:id', async (req) => {
      const d = esquemaAlterarNota.parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const n = await exigirRascunho(c, empresaId, req.params.id);
        const manual = n.origem === 'manual';
        const soManual = (['modelo', 'numero', 'serie', 'dataEmissao', 'frete', 'desconto', 'outras'] as const).filter((k) => d[k] !== undefined);
        if (!manual && soManual.length) throw new ErroHttp(400, 'Os dados fiscais vêm do XML e não podem ser alterados.');
        const fornecedorId = d.fornecedorId !== undefined ? d.fornecedorId : n.fornecedor_id;
        const clienteId = d.clienteId !== undefined ? d.clienteId : n.cliente_id;
        await validarPessoa(c, empresaId, n.direcao, fornecedorId, clienteId);
        const campos: Record<string, unknown> = {
          competencia: d.competencia,
          observacoes: d.observacoes,
          fornecedor_id: d.fornecedorId,
          cliente_id: d.clienteId,
          forma_pagamento: d.formaPagamento,
          modelo: d.modelo,
          numero: d.numero,
          serie: d.serie,
          data_emissao: d.dataEmissao,
          frete_centavos: d.frete,
          desconto_centavos: d.desconto,
          outras_centavos: d.outras,
        };
        const sets: string[] = [];
        const valores: unknown[] = [];
        for (const [col, v] of Object.entries(campos)) {
          if (v === undefined) continue;
          valores.push(v);
          sets.push(`${col} = $${valores.length + 1}`);
        }
        if (sets.length) await c.query(`UPDATE notas_fiscais SET ${sets.join(', ')}, atualizado_em = now() WHERE id = $1`, [n.id, ...valores]);
        if (d.duplicatas) {
          await c.query('DELETE FROM notas_duplicatas WHERE nota_id = $1', [n.id]);
          for (const x of d.duplicatas)
            await c.query('INSERT INTO notas_duplicatas (empresa_id, nota_id, numero, vencimento, valor_centavos) VALUES ($1,$2,$3,$4,$5)', [empresaId, n.id, x.numero, x.vencimento, x.valor]);
        }
        if (manual && (d.frete !== undefined || d.desconto !== undefined || d.outras !== undefined)) await recalcularManual(c, n.id);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'notas_fiscais', entidadeId: n.id, antes: { ...n, xml: undefined }, depois: d });
      });
      return { nota: await detalharNota(banco, empresaId, req.params.id) };
    });

    // ----- Itens -----
    app.post<{ Params: { id: string } }>('/notas/:id/itens', async (req, reply) => {
      const d = esquemaItemManual.parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const n = await exigirRascunho(c, empresaId, req.params.id);
        if (n.origem !== 'manual') throw new ErroHttp(400, 'Os itens vêm do XML e não podem ser incluídos à mão.');
        await validarApropriacao(c, empresaId, n.direcao === 'saida' ? 'receita' : 'despesa', d);
        const prox = (await c.query('SELECT coalesce(max(numero_item), 0) + 1 AS n FROM notas_itens WHERE nota_id = $1', [n.id])).rows[0].n;
        await c.query(
          `INSERT INTO notas_itens (empresa_id, nota_id, numero_item, descricao, unidade, quantidade, valor_produto_centavos, plano_conta_id, centro_custo_id, veiculo_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [empresaId, n.id, prox, d.descricao, d.unidade, d.quantidade, d.valor, d.planoContaId, d.centroCustoId, d.veiculoId],
        );
        await recalcularManual(c, n.id);
      });
      reply.code(201);
      return { nota: await detalharNota(banco, empresaId, req.params.id) };
    });

    app.patch<{ Params: { id: string } }>('/notas/itens/:id', async (req) => {
      const d = esquemaAlterarItem.parse(req.body);
      const empresaId = empresaDo(req);
      const notaId = await emTransacao(banco, async (c) => {
        const i = (await c.query('SELECT * FROM notas_itens WHERE id = $1 AND empresa_id = $2', [UUID.test(req.params.id) ? req.params.id : null, empresaId])).rows[0];
        if (!i) throw naoEncontrado('Item');
        const n = await exigirRascunho(c, empresaId, i.nota_id);
        const fiscais = (['descricao', 'unidade', 'quantidade', 'valor'] as const).filter((k) => d[k] !== undefined);
        if (n.origem !== 'manual' && fiscais.length) throw new ErroHttp(400, 'Descrição, quantidade e valor vêm do XML e não podem ser alterados.');
        await validarApropriacao(c, empresaId, n.direcao === 'saida' ? 'receita' : 'despesa', d);
        // Ligação com o insumo do estoque.
        let fator = d.fatorEstoque;
        if (d.insumoId) {
          if (n.direcao !== 'entrada') throw new ErroHttp(400, 'Só notas de compra entram no estoque.');
          const ins = (await c.query('SELECT unidade FROM insumos WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL', [d.insumoId, empresaId])).rows[0];
          if (!ins) throw new ErroHttp(400, 'Insumo não encontrado.');
          if (fator === undefined || fator === null) fator = (i.insumo_id === d.insumoId && i.fator_estoque ? Number(i.fator_estoque) : null) ?? fatorPadrao(d.unidade ?? i.unidade, ins.unidade);
          if (!fator) throw new ErroHttp(400, `Informe quantos ${ins.unidade === 'm3' ? 'm³' : ins.unidade} vale cada ${i.unidade || 'unidade'} da nota.`);
        }
        if (d.insumoId === null) fator = null;
        const campos: Record<string, unknown> = {
          insumo_id: d.insumoId,
          fator_estoque: d.insumoId !== undefined || d.fatorEstoque !== undefined ? fator : undefined,
          plano_conta_id: d.planoContaId,
          centro_custo_id: d.centroCustoId,
          veiculo_id: d.veiculoId,
          descricao: d.descricao,
          unidade: d.unidade,
          quantidade: d.quantidade,
          valor_produto_centavos: d.valor,
        };
        const sets: string[] = [];
        const valores: unknown[] = [];
        for (const [col, v] of Object.entries(campos)) {
          if (v === undefined) continue;
          valores.push(v);
          sets.push(`${col} = $${valores.length + 1}`);
        }
        // Quem escolheu à mão deixa de ser "sugestão".
        if (d.planoContaId !== undefined) sets.push('sugestao = NULL', 'regra_id = NULL');
        if (sets.length) await c.query(`UPDATE notas_itens SET ${sets.join(', ')} WHERE id = $1`, [i.id, ...valores]);
        if (d.valor !== undefined) await recalcularManual(c, n.id);
        return n.id as string;
      });
      return { nota: await detalharNota(banco, empresaId, notaId) };
    });

    // Aplica a mesma apropriação a vários itens (ex.: todos os itens sem categoria).
    app.post<{ Params: { id: string } }>('/notas/:id/apropriar', async (req) => {
      const d = z
        .object({ planoContaId: z.string().uuid('Escolha a categoria.'), centroCustoId: uuidOpc, veiculoId: uuidOpc, somenteSemCategoria: z.boolean().optional().default(true) })
        .parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const n = await exigirRascunho(c, empresaId, req.params.id);
        await validarApropriacao(c, empresaId, n.direcao === 'saida' ? 'receita' : 'despesa', d);
        await c.query(
          `UPDATE notas_itens SET plano_conta_id = $2, centro_custo_id = $3, veiculo_id = coalesce($4, veiculo_id), sugestao = NULL, regra_id = NULL
            WHERE nota_id = $1 AND (NOT $5 OR plano_conta_id IS NULL)`,
          [n.id, d.planoContaId, d.centroCustoId, d.veiculoId, d.somenteSemCategoria],
        );
      });
      return { nota: await detalharNota(banco, empresaId, req.params.id) };
    });

    app.delete<{ Params: { id: string } }>('/notas/itens/:id', async (req) => {
      const empresaId = empresaDo(req);
      const notaId = await emTransacao(banco, async (c) => {
        const i = (await c.query('SELECT * FROM notas_itens WHERE id = $1 AND empresa_id = $2', [UUID.test(req.params.id) ? req.params.id : null, empresaId])).rows[0];
        if (!i) throw naoEncontrado('Item');
        const n = await exigirRascunho(c, empresaId, i.nota_id);
        if (n.origem !== 'manual') throw new ErroHttp(400, 'Os itens vêm do XML e não podem ser removidos.');
        if ((await c.query('SELECT count(*)::int AS n FROM notas_itens WHERE nota_id = $1', [n.id])).rows[0].n <= 1) throw new ErroHttp(400, 'A nota precisa de pelo menos um item.');
        await c.query('DELETE FROM notas_itens WHERE id = $1', [i.id]);
        await recalcularManual(c, n.id);
        return n.id as string;
      });
      return { nota: await detalharNota(banco, empresaId, notaId) };
    });

    // ----- Vínculo com abastecimentos e OS -----
    app.get<{ Params: { id: string } }>('/notas/itens/:id/candidatos', async (req) => {
      const empresaId = empresaDo(req);
      const i = (await banco.query('SELECT * FROM notas_itens WHERE id = $1 AND empresa_id = $2', [UUID.test(req.params.id) ? req.params.id : null, empresaId])).rows[0];
      if (!i) throw naoEncontrado('Item');
      const n = await carregarNota(banco, empresaId, i.nota_id);
      const emissao = String(n.data_emissao);
      const abast = (
        await banco.query(
          `SELECT a.id, a.data_hora, a.litros, a.valor_total_centavos, a.posto, a.fornecedor_id, a.nota_item_id, v.codigo,
                  coalesce(f.nome_fantasia, f.razao_social) AS fornecedor_nome,
                  ni.descricao AS outro_item, nf.numero AS outra_nota
             FROM abastecimentos a JOIN veiculos v ON v.id = a.veiculo_id
             LEFT JOIN fornecedores f ON f.id = a.fornecedor_id
             LEFT JOIN notas_itens ni ON ni.id = a.nota_item_id AND ni.id <> $2
             LEFT JOIN notas_fiscais nf ON nf.id = ni.nota_id
            WHERE a.empresa_id = $1 AND a.excluido_em IS NULL AND a.origem = 'posto'
              AND (a.nota_item_id = $2 OR (a.data_hora::date BETWEEN $3::date - 62 AND $3::date + 1))
            ORDER BY (a.nota_item_id = $2) DESC NULLS LAST, (a.fornecedor_id = $4) DESC NULLS LAST, a.data_hora DESC
            LIMIT 400`,
          [empresaId, i.id, emissao, n.fornecedor_id],
        )
      ).rows;
      const osItens = (
        await banco.query(
          `SELECT oi.id, oi.tipo, oi.descricao, oi.quantidade, round(oi.quantidade * oi.valor_unitario_centavos) AS total, oi.nota_item_id,
                  o.numero, o.abertura, o.status, o.fornecedor_id, v.codigo, coalesce(f.nome_fantasia, f.razao_social) AS fornecedor_nome,
                  ni.descricao AS outro_item
             FROM os_itens oi JOIN ordens_servico o ON o.id = oi.os_id JOIN veiculos v ON v.id = o.veiculo_id
             LEFT JOIN fornecedores f ON f.id = o.fornecedor_id
             LEFT JOIN notas_itens ni ON ni.id = oi.nota_item_id AND ni.id <> $2
            WHERE oi.empresa_id = $1 AND oi.excluido_em IS NULL AND o.status <> 'cancelada'
              AND (oi.nota_item_id = $2 OR (o.abertura BETWEEN $3::date - 120 AND $3::date + 15))
            ORDER BY (oi.nota_item_id = $2) DESC NULLS LAST, (o.fornecedor_id = $4) DESC NULLS LAST, o.abertura DESC, o.numero DESC, oi.criado_em
            LIMIT 400`,
          [empresaId, i.id, emissao, n.fornecedor_id],
        )
      ).rows;
      return {
        item: { id: i.id, descricao: i.descricao, quantidade: Number(i.quantidade), unidade: i.unidade, valorCusto: reais(i.valor_custo_centavos) },
        abastecimentos: abast.map((a) => ({
          id: a.id,
          dataHora: a.data_hora,
          litros: Number(a.litros),
          valor: reais(a.valor_total_centavos),
          veiculoCodigo: a.codigo,
          posto: a.fornecedor_nome ?? a.posto,
          mesmoFornecedor: !!n.fornecedor_id && a.fornecedor_id === n.fornecedor_id,
          vinculado: a.nota_item_id === i.id,
          emOutraNota: a.nota_item_id && a.nota_item_id !== i.id ? `${a.outro_item ?? 'outro item'}${a.outra_nota ? ` (NF ${a.outra_nota})` : ''}` : null,
        })),
        osItens: osItens.map((o) => ({
          id: o.id,
          tipo: o.tipo,
          descricao: o.descricao,
          quantidade: Number(o.quantidade),
          total: reais(o.total),
          osNumero: o.numero,
          abertura: o.abertura,
          osStatus: o.status,
          veiculoCodigo: o.codigo,
          oficina: o.fornecedor_nome,
          mesmoFornecedor: !!n.fornecedor_id && o.fornecedor_id === n.fornecedor_id,
          vinculado: o.nota_item_id === i.id,
          emOutraNota: o.nota_item_id && o.nota_item_id !== i.id ? o.outro_item ?? 'outro item' : null,
        })),
      };
    });

    app.put<{ Params: { id: string } }>('/notas/itens/:id/vinculos', async (req) => {
      const d = z
        .object({ abastecimentoIds: z.array(z.string().uuid()).max(500).optional().default([]), osItemIds: z.array(z.string().uuid()).max(500).optional().default([]) })
        .parse(req.body);
      const empresaId = empresaDo(req);
      const notaId = await emTransacao(banco, async (c) => {
        const i = (await c.query('SELECT * FROM notas_itens WHERE id = $1 AND empresa_id = $2', [UUID.test(req.params.id) ? req.params.id : null, empresaId])).rows[0];
        if (!i) throw naoEncontrado('Item');
        const n = await exigirRascunho(c, empresaId, i.nota_id);
        if (n.direcao !== 'entrada') throw new ErroHttp(400, 'Só notas de compra se ligam a abastecimentos e OS.');
        if (d.abastecimentoIds.length) {
          const r = (
            await c.query(
              `SELECT count(*)::int AS n, count(*) FILTER (WHERE nota_item_id IS NOT NULL AND nota_item_id <> $3)::int AS outros
                 FROM abastecimentos WHERE empresa_id = $1 AND id = ANY($2::uuid[]) AND excluido_em IS NULL`,
              [empresaId, d.abastecimentoIds, i.id],
            )
          ).rows[0];
          if (r.n !== new Set(d.abastecimentoIds).size) throw new ErroHttp(400, 'Abastecimento não encontrado.');
          if (r.outros) throw new ErroHttp(409, 'Algum abastecimento escolhido já está ligado a outra nota.');
        }
        if (d.osItemIds.length) {
          const r = (
            await c.query(
              `SELECT count(*)::int AS n, count(*) FILTER (WHERE nota_item_id IS NOT NULL AND nota_item_id <> $3)::int AS outros
                 FROM os_itens WHERE empresa_id = $1 AND id = ANY($2::uuid[]) AND excluido_em IS NULL`,
              [empresaId, d.osItemIds, i.id],
            )
          ).rows[0];
          if (r.n !== new Set(d.osItemIds).size) throw new ErroHttp(400, 'Item de OS não encontrado.');
          if (r.outros) throw new ErroHttp(409, 'Algum item de OS escolhido já está ligado a outra nota.');
        }
        await c.query('UPDATE abastecimentos SET nota_item_id = NULL, atualizado_em = now() WHERE nota_item_id = $1 AND NOT (id = ANY($2::uuid[]))', [i.id, d.abastecimentoIds]);
        await c.query('UPDATE abastecimentos SET nota_item_id = $1, atualizado_em = now() WHERE empresa_id = $2 AND id = ANY($3::uuid[])', [i.id, empresaId, d.abastecimentoIds]);
        await c.query('UPDATE os_itens SET nota_item_id = NULL WHERE nota_item_id = $1 AND NOT (id = ANY($2::uuid[]))', [i.id, d.osItemIds]);
        await c.query('UPDATE os_itens SET nota_item_id = $1 WHERE empresa_id = $2 AND id = ANY($3::uuid[])', [i.id, empresaId, d.osItemIds]);
        // Ligado a OS de um único veículo: o item passa a ser desse veículo.
        if (d.osItemIds.length) {
          const v = (
            await c.query('SELECT DISTINCT o.veiculo_id FROM os_itens oi JOIN ordens_servico o ON o.id = oi.os_id WHERE oi.id = ANY($1::uuid[])', [d.osItemIds])
          ).rows;
          if (v.length === 1) await c.query('UPDATE notas_itens SET veiculo_id = $2 WHERE id = $1', [i.id, v[0].veiculo_id]);
        }
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'notas_itens', entidadeId: i.id, depois: d });
        return n.id as string;
      });
      return { nota: await detalharNota(banco, empresaId, notaId) };
    });

    // ----- Confirmação: gera o lançamento com apropriações e parcelas -----
    app.post<{ Params: { id: string } }>('/notas/:id/confirmar', async (req) => {
      const d = esquemaConfirmar.parse(req.body ?? {});
      const empresaId = empresaDo(req);
      const usuarioId = req.usuario!.id;
      await emTransacao(banco, async (c) => {
        const n = await exigirRascunho(c, empresaId, req.params.id);
        const det = await detalharNota(c, empresaId, n.id);
        if (det.pendencias.length) throw new ErroHttp(400, `Antes de confirmar: ${det.pendencias.join(' ')}`);
        const tipo = det.tipo;
        const itens = (await c.query('SELECT * FROM notas_itens WHERE nota_id = $1 ORDER BY numero_item, criado_em', [n.id])).rows;
        const pessoa = det.fornecedorNome ?? det.clienteNome ?? det.emitenteNome ?? '';
        const nomeModelo: Record<string, string> = { nfe: 'NF-e', nfce: 'NFC-e', nfse: 'NFS-e', cte: 'CT-e', cupom: 'Cupom', recibo: 'Recibo', outro: 'Nota' };
        const documento = `${nomeModelo[n.modelo] ?? 'Nota'} ${n.numero ?? 's/n'}${n.serie ? `/${n.serie}` : ''}`;
        const principal = [...itens].sort((a, b) => Number(b.valor_custo_centavos) - Number(a.valor_custo_centavos))[0];
        const descricao = `${pessoa} · ${principal.descricao}${itens.length > 1 ? ` e mais ${itens.length - 1}` : ''}`.slice(0, 200);
        const l = (
          await c.query(
            `INSERT INTO lancamentos (empresa_id, tipo, competencia, descricao, documento, valor_total_centavos, cliente_id, fornecedor_id, nota_id, origem, status, observacoes, criado_por_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'confirmado',$11,$12) RETURNING *`,
            [empresaId, tipo, n.competencia, descricao, documento, n.total_centavos, n.cliente_id, n.fornecedor_id, n.id, n.origem === 'manual' ? 'manual' : 'xml', n.observacoes, usuarioId],
          )
        ).rows[0];

        // Apropriações: uma por item; itens ligados a abastecimentos ou OS de vários veículos são rateados por veículo.
        for (const i of itens) {
          const custo = Number(i.valor_custo_centavos);
          if (custo <= 0) continue;
          let partes: { veiculoId: string | null; valor: number; obs: string | null }[] = [{ veiculoId: i.veiculo_id, valor: custo, obs: null }];
          const ab = (
            await c.query(
              `SELECT a.veiculo_id, sum(coalesce(a.valor_total_centavos, 0)) AS valor, sum(a.litros) AS litros FROM abastecimentos a JOIN veiculos v ON v.id = a.veiculo_id
                WHERE a.nota_item_id = $1 AND a.excluido_em IS NULL GROUP BY a.veiculo_id, v.codigo ORDER BY v.codigo`,
              [i.id],
            )
          ).rows;
          const os = (
            await c.query(
              `SELECT o.veiculo_id, sum(round(oi.quantidade * oi.valor_unitario_centavos)) AS valor FROM os_itens oi JOIN ordens_servico o ON o.id = oi.os_id
                WHERE oi.nota_item_id = $1 AND oi.excluido_em IS NULL GROUP BY o.veiculo_id ORDER BY min(o.numero)`,
              [i.id],
            )
          ).rows;
          const base = ab.length ? ab : os;
          if (base.length) {
            const usaValor = base.every((x) => Number(x.valor) > 0);
            const pesos = base.map((x) => (usaValor ? Number(x.valor) : Number(x.litros ?? 1)));
            const valores = dividirProporcional(custo, pesos);
            partes = base.map((x, k) => ({ veiculoId: x.veiculo_id, valor: valores[k], obs: ab.length ? 'rateado pelos abastecimentos' : 'rateado pelas OS' }));
          }
          for (const p of partes.filter((x) => x.valor > 0)) {
            await c.query(
              `INSERT INTO apropriacoes (empresa_id, lancamento_id, plano_conta_id, centro_custo_id, veiculo_id, descricao, valor_centavos, nota_item_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
              [empresaId, l.id, i.plano_conta_id, i.centro_custo_id, p.veiculoId, `${i.descricao}${p.obs ? ` (${p.obs})` : ''}`.slice(0, 200), p.valor, i.id],
            );
          }
        }

        // Parcelas: as duplicatas da nota ou um vencimento único.
        const dups = (await c.query('SELECT * FROM notas_duplicatas WHERE nota_id = $1 ORDER BY vencimento, numero', [n.id])).rows;
        const parcelas = dups.length
          ? dups.map((x) => ({ vencimento: String(x.vencimento), valor: Number(x.valor_centavos) }))
          : [{ vencimento: d.vencimento ?? String(n.data_emissao), valor: Number(n.total_centavos) }];
        const ids: string[] = [];
        for (const [k, p] of parcelas.entries()) {
          const r = await c.query('INSERT INTO parcelas (empresa_id, lancamento_id, numero, vencimento, valor_centavos) VALUES ($1,$2,$3,$4,$5) RETURNING id', [
            empresaId, l.id, k + 1, p.vencimento, p.valor,
          ]);
          ids.push(r.rows[0].id);
        }
        if (d.baixa) {
          for (const pid of ids) await baixarParcela(c, empresaId, usuarioId, pid, { ...d.baixa, forma: d.baixa.forma ?? n.forma_pagamento, juros: 0, desconto: 0 });
        }

        // Aprende: guarda a apropriação de cada item para as próximas notas deste fornecedor.
        if (d.aprender && n.direcao === 'entrada' && n.fornecedor_id) {
          for (const i of itens) {
            const texto = normalizar(i.descricao).slice(0, 80);
            if (!texto) continue;
            const veiculoFixo = i.veiculo_id && !(await c.query('SELECT 1 FROM abastecimentos WHERE nota_item_id = $1 UNION ALL SELECT 1 FROM os_itens WHERE nota_item_id = $1 LIMIT 1', [i.id])).rowCount ? i.veiculo_id : null;
            await c.query(
              `INSERT INTO regras_apropriacao (empresa_id, fornecedor_id, texto_contem, plano_conta_id, centro_custo_id, veiculo_id, origem, vezes_aplicada)
               VALUES ($1,$2,$3,$4,$5,$6,'aprendida',1)
               ON CONFLICT (empresa_id, coalesce(fornecedor_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(texto_contem, ''), coalesce(ncm, ''))
               DO UPDATE SET plano_conta_id = EXCLUDED.plano_conta_id, centro_custo_id = EXCLUDED.centro_custo_id, veiculo_id = EXCLUDED.veiculo_id,
                             vezes_aplicada = regras_apropriacao.vezes_aplicada + 1, ativo = true, atualizado_em = now()`,
              [empresaId, n.fornecedor_id, texto, i.plano_conta_id, i.centro_custo_id, veiculoFixo],
            );
          }
          // Categoria mais usada (em valor) vira a categoria padrão do fornecedor.
          await c.query(
            `UPDATE fornecedores SET categoria_padrao_id = (
                SELECT plano_conta_id FROM notas_itens WHERE nota_id = $2 GROUP BY plano_conta_id ORDER BY sum(valor_custo_centavos) DESC LIMIT 1),
                atualizado_em = now()
              WHERE id = $1`,
            [n.fornecedor_id, n.id],
          );
        }

        await c.query(
          `UPDATE notas_fiscais SET status = 'confirmada', lancamento_id = $2, conferido_por_id = $3, conferido_em = now(), atualizado_em = now() WHERE id = $1`,
          [n.id, l.id, usuarioId],
        );
        if (n.direcao === 'entrada') await registrarEntradasNota(c, empresaId, n.id, usuarioId);
        await auditar(c, { empresaId, usuarioId, acao: 'confirmar', entidade: 'notas_fiscais', entidadeId: n.id, depois: { lancamentoId: l.id, parcelas: parcelas.length, baixa: !!d.baixa } });
      });
      return { nota: await detalharNota(banco, empresaId, req.params.id) };
    });

    app.post<{ Params: { id: string } }>('/notas/:id/reabrir', async (req) => {
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const n = await carregarNota(c, empresaId, req.params.id, true);
        if (n.status !== 'confirmada') throw new ErroHttp(409, 'Só notas confirmadas podem ser reabertas.');
        await desfazerLancamento(c, n, req.usuario!.id);
        await c.query("UPDATE notas_fiscais SET status = 'rascunho', lancamento_id = NULL, conferido_por_id = NULL, conferido_em = NULL, atualizado_em = now() WHERE id = $1", [n.id]);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'notas_fiscais', entidadeId: n.id, depois: { status: 'rascunho', reaberta: true } });
      });
      return { nota: await detalharNota(banco, empresaId, req.params.id) };
    });

    // Cancelamento: a nota foi cancelada pelo emitente. Fica no histórico, sem valor.
    app.post<{ Params: { id: string } }>('/notas/:id/cancelar', async (req) => {
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const n = await carregarNota(c, empresaId, req.params.id, true);
        if (n.status === 'cancelada') throw new ErroHttp(409, 'Esta nota já está cancelada.');
        await desfazerLancamento(c, n, req.usuario!.id);
        await c.query('UPDATE abastecimentos SET nota_item_id = NULL WHERE nota_item_id IN (SELECT id FROM notas_itens WHERE nota_id = $1)', [n.id]);
        await c.query('UPDATE os_itens SET nota_item_id = NULL WHERE nota_item_id IN (SELECT id FROM notas_itens WHERE nota_id = $1)', [n.id]);
        await c.query("UPDATE notas_fiscais SET status = 'cancelada', lancamento_id = NULL, atualizado_em = now() WHERE id = $1", [n.id]);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'excluir', entidade: 'notas_fiscais', entidadeId: n.id, antes: { status: n.status }, depois: { status: 'cancelada' } });
      });
      return { nota: await detalharNota(banco, empresaId, req.params.id) };
    });

    // Exclusão do rascunho (importou errado): libera a chave para importar de novo.
    app.delete<{ Params: { id: string } }>('/notas/:id', async (req) => {
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const n = await exigirRascunho(c, empresaId, req.params.id);
        await c.query('UPDATE abastecimentos SET nota_item_id = NULL WHERE nota_item_id IN (SELECT id FROM notas_itens WHERE nota_id = $1)', [n.id]);
        await c.query('UPDATE os_itens SET nota_item_id = NULL WHERE nota_item_id IN (SELECT id FROM notas_itens WHERE nota_id = $1)', [n.id]);
        await c.query('UPDATE notas_fiscais SET excluido_em = now(), atualizado_em = now() WHERE id = $1', [n.id]);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'excluir', entidade: 'notas_fiscais', entidadeId: n.id, antes: { ...n, xml: undefined } });
      });
      return { ok: true };
    });

    // ----- Regras de apropriação -----
    app.get('/regras-apropriacao', async (req) => {
      const r = await banco.query(
        `SELECT r.*, coalesce(f.nome_fantasia, f.razao_social) AS fornecedor_nome, pc.codigo, pc.nome AS plano_nome, cc.nome AS centro_nome, v.codigo AS veiculo_codigo
           FROM regras_apropriacao r JOIN plano_contas pc ON pc.id = r.plano_conta_id
           LEFT JOIN fornecedores f ON f.id = r.fornecedor_id LEFT JOIN centros_custo cc ON cc.id = r.centro_custo_id LEFT JOIN veiculos v ON v.id = r.veiculo_id
          WHERE r.empresa_id = $1 ORDER BY r.ativo DESC, fornecedor_nome NULLS LAST, r.texto_contem`,
        [empresaDo(req)],
      );
      return {
        regras: r.rows.map((x) => ({
          id: x.id,
          fornecedorId: x.fornecedor_id,
          fornecedorNome: x.fornecedor_nome,
          textoContem: x.texto_contem,
          ncm: x.ncm,
          planoContaId: x.plano_conta_id,
          planoNome: `${x.codigo} ${x.plano_nome}`,
          centroCustoId: x.centro_custo_id,
          centroNome: x.centro_nome,
          veiculoId: x.veiculo_id,
          veiculoCodigo: x.veiculo_codigo,
          origem: x.origem,
          vezesAplicada: x.vezes_aplicada,
          ativo: x.ativo,
        })),
      };
    });

    app.post('/regras-apropriacao', async (req, reply) => {
      const d = z
        .object({
          fornecedorId: uuidOpc,
          textoContem: z.string().trim().max(80).optional().nullable().transform((v) => (v ? normalizar(v) || null : null)),
          ncm: z.string().optional().nullable().transform((v) => (v ?? '').replace(/\D/g, '') || null),
          planoContaId: z.string({ required_error: 'Escolha a categoria.' }).uuid('Escolha a categoria.'),
          centroCustoId: uuidOpc,
          veiculoId: uuidOpc,
        })
        .refine((x) => x.fornecedorId || x.textoContem || x.ncm, 'Informe o fornecedor, um texto da descrição ou o NCM.')
        .parse(req.body);
      const empresaId = empresaDo(req);
      await validarApropriacao(banco, empresaId, 'despesa', d);
      if (d.fornecedorId) await validarPessoa(banco, empresaId, 'entrada', d.fornecedorId, null);
      const r = await banco.query(
        `INSERT INTO regras_apropriacao (empresa_id, fornecedor_id, texto_contem, ncm, plano_conta_id, centro_custo_id, veiculo_id, origem)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'usuario')
         ON CONFLICT (empresa_id, coalesce(fornecedor_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(texto_contem, ''), coalesce(ncm, ''))
         DO UPDATE SET plano_conta_id = EXCLUDED.plano_conta_id, centro_custo_id = EXCLUDED.centro_custo_id, veiculo_id = EXCLUDED.veiculo_id,
                       origem = 'usuario', ativo = true, atualizado_em = now()
         RETURNING id`,
        [empresaId, d.fornecedorId, d.textoContem, d.ncm, d.planoContaId, d.centroCustoId, d.veiculoId],
      );
      reply.code(201);
      return { id: r.rows[0].id };
    });

    app.patch<{ Params: { id: string } }>('/regras-apropriacao/:id', async (req) => {
      const d = z.object({ ativo: z.boolean() }).parse(req.body);
      const r = await banco.query('UPDATE regras_apropriacao SET ativo = $3, atualizado_em = now() WHERE id = $1 AND empresa_id = $2', [
        UUID.test(req.params.id) ? req.params.id : null,
        empresaDo(req),
        d.ativo,
      ]);
      if (!r.rowCount) throw naoEncontrado('Regra');
      return { ok: true };
    });
  };
}
