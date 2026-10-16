// Construtora Modelo: empresa de demonstração usada no curso de orçamento, planejamento e gestão de obras.
// Só existe uma conta, a do professor (perfil dono, acesso total). Os alunos apenas assistem, usando essa conta.
// A senha vem da variável CURSO_SENHA: nunca fica no código.
import type pg from 'pg';
import type { Banco } from '../db.ts';
import { emTransacao } from '../db.ts';
import { conferirSenha, gerarHashSenha } from './senha.ts';
import { somarDias } from './financeiro.ts';
import { hojeBrasil } from './frota.ts';

type C = pg.PoolClient;

export const CNPJ_CONSTRUTORA = '24680135000100';
export const EMAIL_PROFESSOR = 'professor@demo.agregaconstrutora.test';
/** Mude este valor para o conteúdo da obra modelo ser apagado e recriado na próxima inicialização. */
export const VERSAO_CONSTRUTORA = 'construtora-2026-10-v1';

// Insumos da obra: código, descrição, unidade, grupo e preço unitário em centavos.
const INSUMOS: [string, string, string, string, number][] = [
  ['INS-001', 'Cimento CP II-32 (saco 50 kg)', 'sc', 'Materiais', 3250],
  ['INS-002', 'Areia média lavada', 'm3', 'Materiais', 12000],
  ['INS-003', 'Brita 1', 'm3', 'Materiais', 13500],
  ['INS-004', 'Aço CA-50 10 mm', 'kg', 'Materiais', 980],
  ['INS-005', 'Madeira serrada para forma', 'm3', 'Materiais', 180000],
  ['INS-006', 'Bloco cerâmico 14x19x39', 'un', 'Materiais', 145],
  ['INS-007', 'Pedreiro', 'h', 'Mão de obra', 2640],
  ['INS-008', 'Servente', 'h', 'Mão de obra', 1850],
  ['INS-009', 'Tubo PVC esgoto 100 mm', 'm', 'Materiais', 2400],
];

// Composições: o preço é a soma de coeficiente × preço do insumo.
const COMPOSICOES: { codigo: string; descricao: string; unidade: string; grupo: string; coef: Record<string, number> }[] = [
  { codigo: 'COM-001', descricao: 'Concreto fck 25 MPa, usinado e lançado', unidade: 'm3', grupo: 'Estrutura', coef: { 'INS-001': 7, 'INS-002': 0.55, 'INS-003': 0.85, 'INS-007': 0.8, 'INS-008': 1.5 } },
  { codigo: 'COM-002', descricao: 'Armação em aço CA-50 (corte, dobra e montagem)', unidade: 'kg', grupo: 'Estrutura', coef: { 'INS-004': 1.1, 'INS-007': 0.045, 'INS-008': 0.02 } },
  { codigo: 'COM-003', descricao: 'Forma de madeira para estrutura', unidade: 'm2', grupo: 'Estrutura', coef: { 'INS-005': 0.03, 'INS-007': 0.9, 'INS-008': 0.4 } },
  { codigo: 'COM-004', descricao: 'Alvenaria de vedação com bloco cerâmico 14x19x39', unidade: 'm2', grupo: 'Alvenaria', coef: { 'INS-006': 28, 'INS-001': 0.2, 'INS-002': 0.03, 'INS-007': 0.9, 'INS-008': 0.45 } },
  { codigo: 'COM-005', descricao: 'Tubulação de esgoto PVC 100 mm, instalada', unidade: 'm', grupo: 'Instalações', coef: { 'INS-009': 1.05, 'INS-007': 0.12, 'INS-008': 0.08 } },
];

const ETAPAS: [string, string][] = [
  ['1', 'Fundação'],
  ['2', 'Estrutura'],
  ['3', 'Alvenaria e vedação'],
  ['4', 'Instalações sanitárias'],
];

// Orçamento: etapa, composição e quantidade.
const ORCAMENTO: [string, string, number][] = [
  ['1', 'COM-001', 38],
  ['1', 'COM-002', 1800],
  ['2', 'COM-001', 92],
  ['2', 'COM-002', 6200],
  ['2', 'COM-003', 540],
  ['3', 'COM-004', 1850],
  ['4', 'COM-005', 260],
];

/** Divide um valor em centavos em `partes` parcelas, com a diferença de arredondamento na última. */
function dividir(total: number, partes: number): number[] {
  const base = Math.floor(total / partes);
  const lista = Array.from({ length: partes }, () => base);
  lista[partes - 1] += total - base * partes;
  return lista;
}

async function popularConstrutora(c: C, e: string, dono: string, hoje: string): Promise<void> {
  const q = (sql: string, p: unknown[] = []) => c.query(sql, p);
  const idDe = async (sql: string, p: unknown[] = []) => (await q(sql, p)).rows[0].id as string;
  const mapa = async (sql: string) =>
    Object.fromEntries((await q(sql, [e])).rows.map((x) => [x.k, x.id])) as Record<string, string>;

  // ----- plano de contas e centros de custo (padrão de construtora)
  const { aplicarPlanoPadrao } = await import('../rotas/financeiro.ts');
  await aplicarPlanoPadrao(c, e);
  const plano = await mapa('SELECT codigo AS k, id FROM plano_contas WHERE empresa_id = $1');
  const centro = await mapa('SELECT nome AS k, id FROM centros_custo WHERE empresa_id = $1');

  // ----- conta bancária, clientes e fornecedores
  const inicio = somarDias(hoje, -120);
  const conta = await idDe(
    `INSERT INTO contas_financeiras (empresa_id, nome, tipo, banco, agencia, conta, saldo_inicial_centavos, data_saldo_inicial)
     VALUES ($1, 'Conta corrente da obra', 'banco', '001', '1234', '56789-0', 50000000, $2) RETURNING id`,
    [e, inicio],
  );
  const cliente = await idDe(
    `INSERT INTO clientes (empresa_id, razao_social, nome_fantasia, cnpj_cpf, ramo, cidade, uf)
     VALUES ($1, 'Incorporadora Vila Verde SPE Ltda', 'Vila Verde Incorporadora', '11222333000181', 'Incorporação imobiliária', 'Palmas', 'TO') RETURNING id`,
    [e],
  );
  const fornecedor = async (razao: string, cnpj: string, ramo: string) =>
    idDe(
      `INSERT INTO fornecedores (empresa_id, razao_social, cnpj_cpf, ramo, cidade, uf) VALUES ($1,$2,$3,$4,'Palmas','TO') RETURNING id`,
      [e, razao, cnpj, ramo],
    );
  const fAco = await fornecedor('Aço Tocantins Siderúrgica Ltda', '33444555000166', 'Aço e ferragens');
  const fCimento = await fornecedor('Cimento Palmas Materiais Ltda', '33444555000247', 'Materiais de construção');
  const fBlocos = await fornecedor('Blocos Capital Cerâmica Ltda', '33444555000328', 'Cerâmica e blocos');
  const fFundacoes = await fornecedor('Fundações Norte Engenharia Ltda', '33444555000409', 'Fundações');
  const fAlvenaria = await fornecedor('Alvenaria Tocantins Construções Ltda', '33444555000581', 'Subempreiteiro de alvenaria');

  // ----- obra
  const obra = await idDe(
    `INSERT INTO obras (empresa_id, codigo, nome, endereco, cidade, uf, responsavel, status, data_inicio, data_previsao,
                        nivel_apropriacao, bdi_percentual, bdi_modo, centro_custo_id)
     VALUES ($1, 'OBR-001', 'Residencial Vila Verde - Bloco A', 'Quadra 104 Sul, lote 12', 'Palmas', 'TO',
             'Eng. Mariana Teixeira (RT)', 'em_andamento', $2, $3, 'etapa', 24.50, 'informado', $4) RETURNING id`,
    [e, inicio, somarDias(hoje, 150), centro['Canteiro de obras']],
  );
  await q(
    `INSERT INTO obra_composicao_preco (obra_id, administracao_pct, imprevistos_pct, financeiro_pct, lucro_pct) VALUES ($1, 4, 1, 1.5, 8)`,
    [obra],
  );

  // ----- insumos e composições
  const precoInsumo: Record<string, number> = {};
  const itemDo: Record<string, string> = {};
  for (const [codigo, descricao, unidade, grupo, preco] of INSUMOS) {
    precoInsumo[codigo] = preco;
    itemDo[codigo] = await idDe(
      `INSERT INTO obra_itens (obra_id, tipo, codigo, descricao, unidade, grupo, preco_centavos)
       VALUES ($1, 'insumo', $2, $3, $4, $5, $6) RETURNING id`,
      [obra, codigo, descricao, unidade, grupo, preco],
    );
  }
  for (const k of COMPOSICOES) {
    const preco = Math.round(Object.entries(k.coef).reduce((soma, [ins, coef]) => soma + coef * precoInsumo[ins], 0));
    itemDo[k.codigo] = await idDe(
      `INSERT INTO obra_itens (obra_id, tipo, codigo, descricao, unidade, grupo, preco_centavos)
       VALUES ($1, 'composicao', $2, $3, $4, $5, $6) RETURNING id`,
      [obra, k.codigo, k.descricao, k.unidade, k.grupo, preco],
    );
    for (const [ins, coef] of Object.entries(k.coef)) {
      await q('INSERT INTO obra_composicao_insumos (composicao_id, insumo_id, coeficiente) VALUES ($1, $2, $3)', [itemDo[k.codigo], itemDo[ins], coef]);
    }
  }

  // ----- EAP (etapas) e orçamento
  const eap: Record<string, string> = {};
  for (const [codigo, descricao] of ETAPAS) {
    eap[codigo] = await idDe(`INSERT INTO eap_nos (obra_id, nivel, codigo, descricao) VALUES ($1, 'etapa', $2, $3) RETURNING id`, [obra, codigo, descricao]);
  }
  for (const [ordem, [etapa, comp, quantidade]] of ORCAMENTO.entries()) {
    await q(
      `INSERT INTO orcamento_itens (obra_id, eap_no_id, obra_item_id, quantidade, ordem) VALUES ($1, $2, $3, $4, $5)`,
      [obra, eap[etapa], itemDo[comp], quantidade, ordem + 1],
    );
  }

  // ----- cronograma: fundação e estrutura concluídas, alvenaria e instalações em andamento
  const fundacao = await idDe(
    `INSERT INTO obra_atividades (obra_id, eap_no_id, descricao, inicio, duracao_dias, predecessora_id, ordem)
     VALUES ($1, $2, 'Fundação em estacas e blocos', $3, 30, NULL, 1) RETURNING id`,
    [obra, eap['1'], somarDias(hoje, -120)],
  );
  const estrutura = await idDe(
    `INSERT INTO obra_atividades (obra_id, eap_no_id, descricao, inicio, duracao_dias, predecessora_id, ordem)
     VALUES ($1, $2, 'Estrutura de concreto armado', $3, 75, $4, 2) RETURNING id`,
    [obra, eap['2'], somarDias(hoje, -90), fundacao],
  );
  await q(
    `INSERT INTO obra_atividades (obra_id, eap_no_id, descricao, inicio, duracao_dias, predecessora_id, ordem)
     VALUES ($1, $2, 'Alvenaria de vedação', $3, 60, $4, 3)`,
    [obra, eap['3'], somarDias(hoje, -15), estrutura],
  );
  await q(
    `INSERT INTO obra_atividades (obra_id, eap_no_id, descricao, inicio, duracao_dias, predecessora_id, ordem)
     VALUES ($1, $2, 'Instalações de esgoto e água fria', $3, 70, NULL, 4)`,
    [obra, eap['4'], somarDias(hoje, -40)],
  );

  // ----- compras: solicitações atendidas, pedidos recebidos e aprovado
  const solicitar = async (numero: number, data: string, necessidade: string, itens: [string, string, number][]) => {
    const s = await idDe(
      `INSERT INTO solicitacoes_compra (empresa_id, numero, data, necessidade, origem, centro_custo_id, status, solicitante_id)
       VALUES ($1, $2, $3, $4, 'manual', $5, 'atendida', $6) RETURNING id`,
      [e, numero, data, necessidade, centro['Canteiro de obras'], dono],
    );
    for (const [descricao, unidade, quantidade] of itens) {
      await q(`INSERT INTO solicitacoes_itens (empresa_id, solicitacao_id, descricao, unidade, quantidade) VALUES ($1, $2, $3, $4, $5)`, [e, s, descricao, unidade, quantidade]);
    }
    return s;
  };
  const pedir = async (numero: number, data: string, previsao: string, status: string, fornecedorId: string, solicitacaoId: string, itens: [string, string, number, number][]) => {
    const total = itens.reduce((soma, [, , qtd, preco]) => soma + Math.round(qtd * preco), 0);
    const p = await idDe(
      `INSERT INTO pedidos_compra (empresa_id, numero, data, fornecedor_id, solicitacao_id, previsao_entrega, condicao_pagamento, local_entrega,
                                   total_centavos, centro_custo_id, status, aprovado_por_id, aprovado_em, criado_por_id)
       VALUES ($1, $2, $3, $4, $5, $6, '30 dias após a entrega', 'Canteiro da obra OBR-001', $7, $8, $9, $10, $3, $10) RETURNING id`,
      [e, numero, data, fornecedorId, solicitacaoId, previsao, total, centro['Canteiro de obras'], status, dono],
    );
    for (const [descricao, unidade, qtd, preco] of itens) {
      await q(`INSERT INTO pedidos_itens (empresa_id, pedido_id, descricao, unidade, quantidade, preco_unitario_centavos) VALUES ($1, $2, $3, $4, $5, $6)`, [e, p, descricao, unidade, qtd, preco]);
    }
    return { id: p, total };
  };
  const sol1 = await solicitar(1, somarDias(hoje, -100), somarDias(hoje, -95), [
    ['Aço CA-50 10 mm', 'kg', 1800],
    ['Cimento CP II-32 (saco 50 kg)', 'sc', 280],
  ]);
  const sol2 = await solicitar(2, somarDias(hoje, -20), somarDias(hoje, -15), [['Bloco cerâmico 14x19x39', 'un', 52000]]);
  const pedidoAco = await pedir(1, somarDias(hoje, -98), somarDias(hoje, -95), 'recebido', fAco, sol1, [['Aço CA-50 10 mm', 'kg', 1800, 980]]);
  const pedidoCimento = await pedir(2, somarDias(hoje, -98), somarDias(hoje, -95), 'recebido', fCimento, sol1, [['Cimento CP II-32 (saco 50 kg)', 'sc', 280, 3250]]);
  const pedidoBlocos = await pedir(3, somarDias(hoje, -18), somarDias(hoje, 3), 'aprovado', fBlocos, sol2, [['Bloco cerâmico 14x19x39', 'un', 52000, 145]]);

  // ----- contratos com subempreiteiros, com retenções
  const contrato = async (numero: number, fornecedorId: string, objeto: string, contaId: string, assinatura: string, inicioC: string, fim: string, status: string, itens: [string, string, number, number][]) => {
    const k = await idDe(
      `INSERT INTO contratos (empresa_id, numero, fornecedor_id, objeto, tipo, data_assinatura, inicio, fim, plano_conta_id, centro_custo_id,
                              prazo_pagamento_dias, caucao_pct, iss_pct, status, encerrado_em, criado_por_id)
       VALUES ($1, $2, $3, $4, 'itens', $5, $6, $7, $8, $9, 15, 5, 2, $10, $11, $12) RETURNING id`,
      [e, numero, fornecedorId, objeto, assinatura, inicioC, fim, contaId, centro['Canteiro de obras'], status, status === 'encerrado' ? fim : null, dono],
    );
    for (const [ordem, [descricao, unidade, quantidade, preco]] of itens.entries()) {
      await q(
        `INSERT INTO contratos_itens (empresa_id, contrato_id, ordem, descricao, unidade, quantidade, preco_unitario_centavos) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [e, k, ordem + 1, descricao, unidade, quantidade, preco],
      );
    }
    return k;
  };
  const c1 = await contrato(1, fFundacoes, 'Execução de fundações em estacas escavadas Ø40 cm', plano['4.2'], somarDias(hoje, -125), inicio, somarDias(hoje, -88), 'encerrado', [
    ['Estaca escavada Ø40 cm (concreto e armação incluídos)', 'm', 1200, 14500],
    ['Mobilização e desmobilização de equipamento', 'un', 1, 1800000],
  ]);
  const c2 = await contrato(2, fAlvenaria, 'Execução de alvenaria de vedação e verga', plano['4.1'], somarDias(hoje, -22), somarDias(hoje, -15), somarDias(hoje, 60), 'vigente', [
    ['Alvenaria de vedação com bloco cerâmico (mão de obra e argamassa)', 'm2', 1850, 3800],
    ['Verga e contraverga em concreto', 'm', 310, 2200],
  ]);

  // ----- medições dos contratos (aprovadas)
  const itensDoContrato = async (contratoId: string) =>
    (await q('SELECT id, quantidade, preco_unitario_centavos FROM contratos_itens WHERE contrato_id = $1 ORDER BY ordem', [contratoId])).rows as {
      id: string;
      preco_unitario_centavos: string;
    }[];
  const medir = async (numero: number, contratoId: string, sequencia: number, periodoIni: string, periodoFim: string, data: string, quantidades: number[]) => {
    const itens = await itensDoContrato(contratoId);
    const linhas = itens.map((it, i) => ({ id: it.id, qtd: quantidades[i], valor: Math.round(quantidades[i] * Number(it.preco_unitario_centavos)) }));
    const bruto = linhas.reduce((soma, l) => soma + l.valor, 0);
    const m = await idDe(
      `INSERT INTO medicoes (empresa_id, numero, contrato_id, sequencia, periodo_inicio, periodo_fim, data, valor_centavos, status,
                             enviado_aprovacao_em, aprovado_por_id, aprovado_em, criado_por_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'aprovada', $7, $9, $7, $9) RETURNING id`,
      [e, numero, contratoId, sequencia, periodoIni, periodoFim, data, bruto, dono],
    );
    for (const l of linhas) {
      await q(`INSERT INTO medicoes_itens (empresa_id, medicao_id, contrato_item_id, quantidade, valor_centavos) VALUES ($1, $2, $3, $4, $5)`, [e, m, l.id, l.qtd, l.valor]);
    }
    return { bruto };
  };
  const m1 = await medir(1, c1, 1, somarDias(hoje, -120), somarDias(hoje, -100), somarDias(hoje, -98), [420, 1]);
  const m2 = await medir(2, c1, 2, somarDias(hoje, -99), somarDias(hoje, -89), somarDias(hoje, -86), [780, 0]);
  const m3 = await medir(3, c2, 1, somarDias(hoje, -15), somarDias(hoje, -1), somarDias(hoje, -1), [620, 0]);

  // ----- financeiro: despesas da obra, pagamentos e um recebimento da incorporadora
  const lancar = async (o: {
    tipo: 'receita' | 'despesa';
    competencia: string;
    descricao: string;
    documento: string;
    valor: number;
    contaPlano: string;
    fornecedorId?: string;
    clienteId?: string;
    parcelas: { vencimento: string; valor: number; pagaEm?: string }[];
  }) => {
    const l = await idDe(
      `INSERT INTO lancamentos (empresa_id, tipo, competencia, descricao, documento, valor_total_centavos, cliente_id, fornecedor_id, origem, status, criado_por_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'manual', 'confirmado', $9) RETURNING id`,
      [e, o.tipo, o.competencia, o.descricao, o.documento, o.valor, o.clienteId ?? null, o.fornecedorId ?? null, dono],
    );
    await q(
      `INSERT INTO apropriacoes (empresa_id, lancamento_id, plano_conta_id, centro_custo_id, valor_centavos) VALUES ($1, $2, $3, $4, $5)`,
      [e, l, o.contaPlano, centro['Canteiro de obras'], o.valor],
    );
    for (const [n, p] of o.parcelas.entries()) {
      await q(
        `INSERT INTO parcelas (empresa_id, lancamento_id, numero, vencimento, valor_centavos, status, data_pagamento, valor_pago_centavos, conta_financeira_id, forma_pagamento, baixado_por_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'transferencia', $10)`,
        [e, l, n + 1, p.vencimento, p.valor, p.pagaEm ? 'paga' : 'aberta', p.pagaEm ?? null, p.pagaEm ? p.valor : null, p.pagaEm ? conta : null, p.pagaEm ? dono : null],
      );
    }
    return l;
  };
  const liquido = (bruto: number) => Math.round((bruto * (100 - 5 - 2)) / 100); // descontadas caução (5%) e ISS (2%)

  await lancar({ tipo: 'receita', competencia: somarDias(hoje, -60), descricao: 'Medição 1 da obra OBR-001 (incorporadora)', documento: 'MED-01', valor: 42000000, contaPlano: plano['1.2'], clienteId: cliente, parcelas: [{ vencimento: somarDias(hoje, -55), valor: 42000000, pagaEm: somarDias(hoje, -55) }] });
  await lancar({ tipo: 'despesa', competencia: somarDias(hoje, -98), descricao: 'Aço CA-50 10 mm - pedido 1', documento: 'NF 1042', valor: pedidoAco.total, contaPlano: plano['3.3'], fornecedorId: fAco, parcelas: [{ vencimento: somarDias(hoje, -90), valor: pedidoAco.total, pagaEm: somarDias(hoje, -90) }] });
  await lancar({ tipo: 'despesa', competencia: somarDias(hoje, -98), descricao: 'Cimento CP II-32 - pedido 2', documento: 'NF 1043', valor: pedidoCimento.total, contaPlano: plano['3.1'], fornecedorId: fCimento, parcelas: [{ vencimento: somarDias(hoje, -92), valor: pedidoCimento.total, pagaEm: somarDias(hoje, -92) }] });
  await lancar({
    tipo: 'despesa',
    competencia: somarDias(hoje, -18),
    descricao: 'Blocos cerâmicos 14x19x39 - pedido 3',
    documento: 'NF 1077',
    valor: pedidoBlocos.total,
    contaPlano: plano['3.4'],
    fornecedorId: fBlocos,
    parcelas: dividir(pedidoBlocos.total, 3).map((valor, i) => ({ vencimento: somarDias(hoje, 10 + i * 30), valor })),
  });
  await lancar({ tipo: 'despesa', competencia: somarDias(hoje, -88), descricao: 'Fundações em estacas - medição 1 (subempreiteiro)', documento: 'MED-01 FUNDAÇÕES', valor: liquido(m1.bruto), contaPlano: plano['4.2'], fornecedorId: fFundacoes, parcelas: [{ vencimento: somarDias(hoje, -95), valor: liquido(m1.bruto), pagaEm: somarDias(hoje, -95) }] });
  await lancar({ tipo: 'despesa', competencia: somarDias(hoje, -86), descricao: 'Fundações em estacas - medição 2 (subempreiteiro)', documento: 'MED-02 FUNDAÇÕES', valor: liquido(m2.bruto), contaPlano: plano['4.2'], fornecedorId: fFundacoes, parcelas: [{ vencimento: somarDias(hoje, -84), valor: liquido(m2.bruto), pagaEm: somarDias(hoje, -84) }] });
  await lancar({ tipo: 'despesa', competencia: somarDias(hoje, -1), descricao: 'Alvenaria de vedação - medição 1 (subempreiteiro)', documento: 'MED-03 ALVENARIA', valor: liquido(m3.bruto), contaPlano: plano['4.1'], fornecedorId: fAlvenaria, parcelas: [{ vencimento: somarDias(hoje, 7), valor: liquido(m3.bruto) }] });
  await lancar({ tipo: 'despesa', competencia: somarDias(hoje, -30), descricao: 'Folha de pagamento da mão de obra direta', documento: 'FOLHA OBR-001', valor: 3600000, contaPlano: plano['6.1'], parcelas: [{ vencimento: somarDias(hoje, -25), valor: 3600000, pagaEm: somarDias(hoje, -25) }] });
}

/**
 * Garante a Construtora Modelo: empresa, conta do professor e obra modelo. A conta usa a senha de CURSO_SENHA
 * (quando ela muda, a senha da conta é atualizada). O conteúdo da obra é refeito quando VERSAO_CONSTRUTORA muda.
 * Falhas são registradas e não derrubam o servidor.
 */
export async function garantirConstrutoraModelo(banco: Banco, senha: string, log = console.log): Promise<void> {
  if (!senha) return;
  try {
    let empresa = (await banco.query('SELECT id FROM empresas WHERE cnpj = $1', [CNPJ_CONSTRUTORA])).rows[0];
    if (!empresa) {
      empresa = (
        await banco.query(
          `INSERT INTO empresas (razao_social, nome_fantasia, cnpj, regime_tributario, aliquotas_dre, cidade, uf, plano)
           VALUES ('Construtora Modelo Ltda', 'Construtora Modelo', $1, 'presumido', '{"pis": 0.65, "cofins": 3, "iss": 2, "irpj": 1.2, "csll": 1.08}', 'Palmas', 'TO', 'demonstracao')
           RETURNING id`,
          [CNPJ_CONSTRUTORA],
        )
      ).rows[0];
      log('Construtora Modelo criada para o curso.');
    }
    const conta = (
      await banco.query('SELECT id, senha_hash FROM usuarios WHERE lower(email) = lower($1) AND excluido_em IS NULL', [EMAIL_PROFESSOR])
    ).rows[0];
    if (!conta) {
      await banco.query(
        `INSERT INTO usuarios (empresa_id, nome, email, senha_hash, perfil, administrador) VALUES ($1, 'Professor', $2, $3, 'dono', true)`,
        [empresa.id, EMAIL_PROFESSOR, await gerarHashSenha(senha)],
      );
      log('Conta do professor da Construtora Modelo criada.');
    } else if (!(await conferirSenha(senha, conta.senha_hash))) {
      await banco.query('UPDATE usuarios SET senha_hash = $2 WHERE id = $1', [conta.id, await gerarHashSenha(senha)]);
      log('Senha da conta do professor da Construtora Modelo atualizada.');
    }
    const dono = (await banco.query('SELECT id FROM usuarios WHERE lower(email) = lower($1)', [EMAIL_PROFESSOR])).rows[0].id as string;

    const versao = async (c: { query: Banco['query'] }) =>
      (await c.query("SELECT valor FROM marcas_sistema WHERE chave = 'construtora_modelo_versao'")).rows[0]?.valor as string | undefined;
    if ((await versao(banco)) === VERSAO_CONSTRUTORA) return;
    const { limparEmpresa } = await import('./demo-modelo.ts');
    const inicio = Date.now();
    await emTransacao(banco, async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(727276)');
      if ((await versao(c as never)) === VERSAO_CONSTRUTORA) return;
      await limparEmpresa(c, empresa.id);
      await popularConstrutora(c, empresa.id, dono, hojeBrasil());
      await c.query(
        `INSERT INTO marcas_sistema (chave, valor) VALUES ('construtora_modelo_versao', $1)
         ON CONFLICT (chave) DO UPDATE SET valor = excluded.valor, atualizado_em = now()`,
        [VERSAO_CONSTRUTORA],
      );
    });
    log(`Obra modelo da Construtora Modelo criada (${VERSAO_CONSTRUTORA}) em ${Math.round((Date.now() - inicio) / 1000)} s.`);
  } catch (err) {
    log(`Falha ao montar a Construtora Modelo do curso: ${(err as Error).message}`);
  }
}
