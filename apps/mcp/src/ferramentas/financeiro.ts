// Ferramentas do módulo Financeiro: contas, plano de contas, lançamentos, parcelas (contas a pagar e a receber),
// notas fiscais, conciliação bancária (leitura) e relatórios financeiros e gerenciais.
import { z } from 'zod';
import { colecao, ferramenta } from './tipos.ts';

const data = (descricao: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe(descricao);
const mes = (descricao: string) => z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).describe(descricao);
const FORMAS = ['pix', 'boleto', 'transferencia', 'cartao', 'dinheiro', 'cheque', 'debito_automatico', 'permuta'] as const;
const LINHAS_DRE = [
  'receita_bruta', 'deducoes', 'custo_producao', 'custo_frota', 'custo_pessoal', 'despesas_pessoal', 'despesas_administrativas',
  'despesas_comerciais', 'receitas_financeiras', 'despesas_financeiras', 'outras_receitas', 'outras_despesas', 'impostos_lucro', 'fora_dre',
] as const;

const periodoMeses = {
  de: mes('Primeiro mês do período, no formato AAAA-MM. Opcional.').optional(),
  ate: mes('Último mês do período (incluído), no formato AAAA-MM. Opcional: o padrão é o mês atual.').optional(),
};

const apropriacao = z.object({
  planoContaId: z.string().uuid().describe('Id da categoria do plano de contas (de listar_plano_contas). Precisa ter aceitaLancamento = true e ser do mesmo tipo do lançamento (receita ou despesa).'),
  centroCustoId: z.string().uuid().optional().describe('Id do centro de custo (de listar_centros_custo). Opcional.'),
  veiculoId: z.string().uuid().optional().describe('Id do veículo da frota ao qual o valor se refere. Opcional. Ao editar um lançamento, repita o veiculoId que buscar_lancamento devolveu na apropriação.'),
  descricao: z.string().max(200).optional().describe('Descrição desta parte do valor. Opcional.'),
  valor: z.number().min(0.01).max(100_000_000).optional().describe('Valor desta categoria, em reais. Pode ser omitido quando há uma só apropriação (assume o valor total); com duas ou mais é obrigatório em todas, e a soma tem de ser igual a valorTotal.'),
});

const parcela = z.object({
  vencimento: data('Vencimento da parcela, AAAA-MM-DD.'),
  valor: z.number().min(0.01).max(100_000_000).describe('Valor da parcela, em reais.'),
});

const camposLancamento = {
  tipo: z.enum(['receita', 'despesa']).describe('"despesa" é conta a pagar; "receita" é conta a receber.'),
  competencia: data('Data de competência (a que data o gasto ou a receita pertence), AAAA-MM-DD.'),
  descricao: z.string().min(2).max(200).describe('Descrição do lançamento.'),
  documento: z.string().max(60).optional().describe('Número do documento (boleto, recibo, contrato). Opcional.'),
  clienteId: z.string().uuid().optional().describe('Id do cliente (de listar_clientes). Só em receita: em despesa a API recusa.'),
  fornecedorId: z.string().uuid().optional().describe('Id do fornecedor ou credor (de listar_fornecedores). Só em despesa: em receita a API recusa.'),
  observacoes: z.string().max(1000).optional().describe('Observações livres. Opcional.'),
  valorTotal: z.number().min(0.01).max(100_000_000).describe('Valor total do lançamento, em reais.'),
};

export const ferramentasFinanceiro = colecao(
  // ---------- Leituras ----------
  ferramenta({
    name: 'listar_contas_financeiras',
    description:
      'Lista as contas financeiras da construtora (banco, caixa, cartão, aplicação) com id, nome, tipo, banco, agência, conta, saldoInicial, dataSaldoInicial, saldo atual (em reais) e ativo. Os ids servem de contaId em baixar_parcela, extrato_conta, transferir_entre_contas e na conciliação. Para quem não é dono nem perfil Financeiro, saldoInicial e saldo vêm null (só nome e dados da conta).',
    inputSchema: z.object({}),
    handler: async (_args, api) => ({ success: true, data: await api.get('/fin/contas') }),
  }),
  ferramenta({
    name: 'extrato_conta',
    description:
      'Extrato de uma conta financeira no período: saldoAnterior, movimentos (data, descricao, pessoa, valor positivo para entrada e negativo para saída, saldo acumulado, origem "parcela" ou "transferencia", id e lancamentoId) e saldoFinal, em reais. Sem datas, vai do primeiro dia do mês de "ate" até hoje; o início nunca é anterior à data do saldo inicial da conta. O id da conta vem de listar_contas_financeiras.',
    inputSchema: z.object({
      contaId: z.string().uuid().describe('Id da conta financeira (de listar_contas_financeiras).'),
      de: data('Data inicial, AAAA-MM-DD. Opcional.').optional(),
      ate: data('Data final (incluída), AAAA-MM-DD. Opcional: o padrão é hoje.').optional(),
    }),
    handler: async ({ contaId, de, ate }, api) => ({ success: true, data: await api.get(`/fin/contas/${contaId}/extrato`, { de, ate }) }),
  }),
  ferramenta({
    name: 'listar_transferencias',
    description:
      'Lista as transferências entre contas financeiras no período (id, data, valor em reais, descricao, origemId, origemNome, destinoId, destinoNome), da mais recente para a mais antiga. Sem datas, devolve os últimos 90 dias.',
    inputSchema: z.object({
      de: data('Data inicial, AAAA-MM-DD. Opcional: o padrão é 90 dias atrás.').optional(),
      ate: data('Data final (incluída), AAAA-MM-DD. Opcional: o padrão é hoje.').optional(),
    }),
    handler: async (args, api) => ({ success: true, data: await api.get('/fin/transferencias', args) }),
  }),
  ferramenta({
    name: 'listar_plano_contas',
    description:
      'Lista o plano de contas (categorias de receita e despesa) em ordem de código: id, codigo (ex.: 4.2.1), nome, tipo (receita ou despesa), linhaDre, paiId, aceitaLancamento e ativo. Use o id como planoContaId nas apropriações de criar_lancamento: só servem categorias com aceitaLancamento = true (as outras são grupos) e do mesmo tipo do lançamento.',
    inputSchema: z.object({}),
    handler: async (_args, api) => ({ success: true, data: await api.get('/fin/plano-contas') }),
  }),

ferramenta({
    name: 'aplicar_plano_contas_padrao',
    description:
      'Cria o que falta do plano de contas padrão e dos centros de custo padrão da empresa (não mexe no que já existe). Empresa nova já nasce com ele; use quando o plano estiver vazio ou incompleto. Devolve { contas, centros } com o número de itens criados.',
    inputSchema: z.object({}),
    handler: async (_args, api) => ({ success: true, data: await api.post('/fin/plano-contas/padrao') }),
  }),
  ferramenta({
    name: 'listar_centros_custo',
    description:
      'Lista os centros de custo da construtora (id, nome, ativo). Use o id como centroCustoId nas apropriações de criar_lancamento e no filtro de listar_lancamentos.',
    inputSchema: z.object({}),
    handler: async (_args, api) => ({ success: true, data: await api.get('/fin/centros-custo') }),
  }),
  ferramenta({
    name: 'listar_lancamentos',
    description:
      'Lista os lançamentos financeiros (despesas e receitas) pela data de competência: id, tipo, competencia, descricao, documento, valorTotal, status (confirmado ou cancelado), origem, recorrencia, pessoa (cliente ou fornecedor), categorias, parcelas (quantidade), pagas, valorAberto e proximoVencimento, mais o período aplicado (de, ate). Valores em reais; no máximo 2000 linhas. Atenção: "ate" é exclusivo (competência menor que "ate"); sem datas, devolve o mês atual. Para ver parcelas e apropriações de um lançamento use buscar_lancamento.',
    inputSchema: z.object({
      de: data('Competência inicial (incluída), AAAA-MM-DD. Opcional: o padrão é o primeiro dia do mês atual.').optional(),
      ate: data('Competência final (incluída), AAAA-MM-DD: para incluir março, envie 31/03. Opcional: o padrão é o último dia do mês atual.').optional(),
      tipo: z.enum(['receita', 'despesa']).optional().describe('Filtra só receitas ou só despesas. Opcional.'),
      cancelados: z.boolean().optional().describe('true inclui também os lançamentos cancelados. O padrão é não incluir.'),
      planoContaId: z.string().uuid().optional().describe('Só lançamentos com apropriação nesta categoria (id de listar_plano_contas). Opcional.'),
      centroCustoId: z.string().uuid().optional().describe('Só lançamentos com apropriação neste centro de custo (id de listar_centros_custo). Opcional.'),
      pessoaId: z.string().uuid().optional().describe('Só lançamentos deste fornecedor ou cliente (id de listar_fornecedores ou listar_clientes). Opcional.'),
    }),
    handler: async ({ cancelados, ...resto }, api) => ({
      success: true,
      data: await api.get('/fin/lancamentos', { ...resto, cancelados: cancelados ? '1' : undefined }),
    }),
  }),
  ferramenta({
    name: 'buscar_lancamento',
    description:
      'Devolve um lançamento completo: dados gerais (tipo, competencia, descricao, documento, valorTotal, cliente ou fornecedor, origem, notaId, status, recorrencia, observacoes), apropriacoes (planoContaId, planoCodigo, planoNome, centroCustoId, veiculoId, descricao, valor), parcelas (id, numero, vencimento, valor, status aberta/paga/cancelada, situacao, dataPagamento, juros, desconto, valorPago, contaId, forma) e itens de estoque. Valores em reais. O id vem de listar_lancamentos ou do lancamentoId de listar_parcelas; os ids das parcelas servem em baixar_parcela.',
    inputSchema: z.object({
      lancamentoId: z.string().uuid().describe('Id do lançamento (de listar_lancamentos ou do campo lancamentoId de listar_parcelas).'),
    }),
    handler: async ({ lancamentoId }, api) => ({ success: true, data: await api.get(`/fin/lancamentos/${lancamentoId}`) }),
  }),
  ferramenta({
    name: 'listar_parcelas',
    description:
      'Lista as parcelas de contas a pagar (tipo "despesa", o padrão) ou a receber (tipo "receita") de lançamentos confirmados, com o total em reais. Cada parcela traz id, lancamentoId, numero, totalParcelas, vencimento, valor, status, situacao (a_vencer, vence_hoje, vencida, paga), dataPagamento, juros, desconto, valorPago, contaId, contaNome, forma, descricao, documento, pessoa, categorias e competencia. A situacao escolhe o recorte: "abertas" (padrão), "vencidas", "hoje", "semana" (7 dias a partir de hoje), "mes" (mês atual), "pagas" (por data de pagamento; sem datas, o mês atual até hoje) ou "todas" (abertas e pagas). No máximo 2000 linhas.',
    inputSchema: z.object({
      tipo: z.enum(['despesa', 'receita']).optional().describe('"despesa" = contas a pagar (padrão); "receita" = contas a receber.'),
      situacao: z.enum(['abertas', 'vencidas', 'hoje', 'semana', 'mes', 'pagas', 'todas']).optional().describe('Recorte da lista. O padrão é "abertas".'),
      de: data('Data inicial, AAAA-MM-DD: compara com o vencimento (ou com a data de pagamento em "pagas"). Ignorada em "hoje" e "mes". Opcional.').optional(),
      ate: data('Data final (incluída), AAAA-MM-DD: compara com o vencimento (ou com a data de pagamento em "pagas"). Ignorada em "vencidas", "hoje", "semana" e "mes". Opcional.').optional(),
      contaId: z.string().uuid().optional().describe('Só parcelas baixadas nesta conta financeira (id de listar_contas_financeiras); faz sentido com situacao "pagas". Opcional.'),
    }),
    handler: async (args, api) => ({ success: true, data: await api.get('/fin/parcelas', args) }),
  }),
  ferramenta({
    name: 'obter_recibo_parcela',
    description:
      'Devolve os dados do recibo de um recebimento já baixado: empresa (nome, cnpj), pagador (nome, documento), valor em reais, referente, documento, parcela (ex.: "2/5"), vencimento, dataPagamento, forma, conta e contratoNumero. Só vale para parcela de receita já paga: parcela em aberto devolve erro 409 e parcela de despesa não é encontrada. O id vem de listar_parcelas (tipo "receita", situacao "pagas").',
    inputSchema: z.object({
      parcelaId: z.string().uuid().describe('Id da parcela de receita já recebida (de listar_parcelas ou buscar_lancamento).'),
    }),
    handler: async ({ parcelaId }, api) => ({ success: true, data: await api.get(`/fin/parcelas/${parcelaId}/recibo`) }),
  }),
  ferramenta({
    name: 'resumo_financeiro',
    description:
      'Resumo do painel financeiro de hoje: saldoTotal e contas ativas com saldo, blocos pagar e receber (vencidas, hoje e semana com quantidade e valor; total em aberto; realizadoMes), além de notasParaConferir, extratoPendente (linhas de extrato a conciliar), estoqueBaixo e configurado (se há plano de contas e contas). Valores em reais. Para quem não é dono nem perfil Financeiro, financeiroVisivel vem false, saldoTotal, pagar e receber vêm null e contas vem vazia.',
    inputSchema: z.object({}),
    handler: async (_args, api) => ({ success: true, data: await api.get('/fin/resumo') }),
  }),
  ferramenta({
    name: 'listar_pedidos_para_lancamento',
    description:
      'Lista os pedidos de compra aprovados (ou já enviados/parcialmente recebidos) que ainda não viraram despesa nem nota fiscal: id, numero, data, status, fornecedorId, fornecedor, total em reais e resumo dos itens. Use o id como pedidoId em criar_lancamento para lançar a despesa do pedido (mesmo fornecedor e mesmo valor total). No máximo 200 pedidos.',
    inputSchema: z.object({}),
    handler: async (_args, api) => ({ success: true, data: await api.get('/fin/lancamentos/pedidos-disponiveis') }),
  }),
  ferramenta({
    name: 'listar_notas_fiscais',
    description:
      'Lista as notas fiscais de entrada e de saída: id, direcao (entrada ou saida), modelo, numero, serie, dataEmissao, competencia, total em reais, status (rascunho, aguardando_conferencia, confirmada, cancelada), origem, lancamentoId, pessoa, itens, semCategoria e categorias; devolve também o período aplicado e a contagem de rascunhos. O período filtra pela data de emissão e "ate" é exclusivo; sem datas, o mês atual. Notas em rascunho ou aguardando conferência aparecem sempre, de qualquer data, a menos que o status pedido seja "confirmada" ou "cancelada". No máximo 1000 notas.',
    inputSchema: z.object({
      de: data('Emissão inicial (incluída), AAAA-MM-DD. Opcional: o padrão é o primeiro dia do mês atual.').optional(),
      ate: data('Emissão final (incluída), AAAA-MM-DD. Opcional: o padrão é o último dia do mês atual.').optional(),
      status: z.enum(['rascunho', 'confirmada', 'cancelada']).optional().describe('Filtra pelo status; "rascunho" inclui também as que aguardam conferência (e ignora o período). Opcional.'),
    }),
    handler: async (args, api) => ({ success: true, data: await api.get('/fin/notas', args) }),
  }),
  ferramenta({
    name: 'buscar_nota_fiscal',
    description:
      'Devolve uma nota fiscal completa: cabeçalho (direcao, tipo, modelo, numero, serie, chaveAcesso, dataEmissao, competencia, fornecedor ou cliente, emitente), totais em reais (produtos, frete, seguro, desconto, outras, ipi, icmsSt, total), status, lancamento gerado (id, status, parcelas, pagas), itens (descricao, quantidade, unidade, valorProduto, valorCusto, categoria, centro de custo, obra, vínculo com pedido), duplicatas (vencimento, valor) e pendencias. A lista pendencias diz o que falta para a nota poder ser confirmada. O id vem de listar_notas_fiscais.',
    inputSchema: z.object({
      notaId: z.string().uuid().describe('Id da nota fiscal (de listar_notas_fiscais).'),
    }),
    handler: async ({ notaId }, api) => ({ success: true, data: await api.get(`/fin/notas/${notaId}`) }),
  }),
  ferramenta({
    name: 'resumo_conciliacao',
    description:
      'Situação da conciliação bancária de cada conta financeira: id, nome, tipo, banco, agencia, conta, ativo, pendentes (linhas de extrato por conciliar), sugestoes (pendentes com correspondência sugerida) e comparacao (data, saldo do banco no último extrato, saldo do sistema na mesma data e diferenca, em reais; null se não há extrato com saldo). Só leitura: a conciliação em si é feita na tela do Agrega.',
    inputSchema: z.object({}),
    handler: async (_args, api) => ({ success: true, data: await api.get('/fin/conciliacao/resumo') }),
  }),
  ferramenta({
    name: 'listar_extratos_bancarios',
    description:
      'Lista os extratos bancários (arquivos OFX) já importados, do mais recente para o mais antigo, até 50: id, contaId, arquivo, inicio, fim, saldo em reais, dataSaldo, novas, repetidas, pendentes, usuario e importadoEm. A importação de extrato é feita na tela do Agrega, não por aqui.',
    inputSchema: z.object({
      contaId: z.string().uuid().optional().describe('Só extratos desta conta financeira (id de listar_contas_financeiras). Opcional.'),
    }),
    handler: async (args, api) => ({ success: true, data: await api.get('/fin/conciliacao/extratos', args) }),
  }),
  ferramenta({
    name: 'listar_linhas_extrato',
    description:
      'Lista as linhas do extrato bancário importado de uma conta: id, extratoId, data, valor em reais (positivo é entrada, negativo é saída), tipo, descricao, documento, status (pendente, conciliado ou ignorado), acao, parcela e transferencia correspondentes (com sugestao = true quando é só sugestão, ainda não conciliada) e categoriaSugerida. Por padrão devolve só as pendentes; no máximo 1000 linhas. A conta é obrigatória e vem de listar_contas_financeiras.',
    inputSchema: z.object({
      contaId: z.string().uuid().describe('Id da conta financeira (de listar_contas_financeiras). Obrigatório.'),
      status: z.enum(['pendente', 'conciliado', 'ignorado', 'todas']).optional().describe('Status das linhas. O padrão é "pendente"; "todas" não filtra.'),
      de: data('Data inicial da linha, AAAA-MM-DD. Opcional.').optional(),
      ate: data('Data final da linha (incluída), AAAA-MM-DD. Opcional.').optional(),
    }),
    handler: async (args, api) => ({ success: true, data: await api.get('/fin/conciliacao/linhas', args) }),
  }),
  ferramenta({
    name: 'listar_candidatos_linha_extrato',
    description:
      'Para uma linha do extrato bancário, lista as parcelas (até 30) e as transferências (até 10) que podem corresponder a ela, das mais próximas em valor e data para as mais distantes; "exato" indica valor idêntico ao da linha. Sem busca, considera parcelas com vencimento ou pagamento a até 60 dias da data da linha; com busca, procura o texto na descrição, na pessoa ou no documento. Só leitura. O id da linha vem de listar_linhas_extrato.',
    inputSchema: z.object({
      linhaId: z.string().uuid().describe('Id da linha do extrato (de listar_linhas_extrato).'),
      busca: z.string().max(100).optional().describe('Texto a procurar na descrição do lançamento, no nome da pessoa ou no documento. Opcional.'),
    }),
    handler: async ({ linhaId, busca }, api) => ({ success: true, data: await api.get(`/fin/conciliacao/linhas/${linhaId}/candidatos`, { busca }) }),
  }),

  // ---------- Relatórios ----------
  ferramenta({
    name: 'relatorio_financeiro',
    description:
      'Relatório financeiro do período, em reais: porCategoria (tipo, codigo, nome, linhaDre, valor, lancamentos) e porCentro (despesas por centro de custo), porPessoa (por fornecedor ou cliente), porMes (recebido, pago, jurosPagos, descontosObtidos), porForma (recebido e pago por forma de pagamento) e aging (parcelas em aberto hoje por tipo e faixa: a_vencer, ate30, ate60, ate90, mais90 dias de atraso). Categorias e pessoas contam pela competência; porMes e porForma, pela data de pagamento. O período é em meses inteiros (AAAA-MM), no máximo 24; sem datas, os últimos 3 meses.',
    inputSchema: z.object(periodoMeses),
    handler: async (args, api) => ({ success: true, data: await api.get('/rel/financeiro', args) }),
  }),
  ferramenta({
    name: 'relatorio_dre',
    description:
      'DRE (demonstração do resultado) mês a mês, em reais: linhas (chave, nome, tipo, valores por mês, total e as categorias do plano de contas que compõem cada linha) e "fora" (categorias fora da DRE), além de regime tributário e temAliquota. A visão "competencia" (padrão) usa a data de competência dos lançamentos; "caixa" usa a data de pagamento das parcelas e inclui juros e descontos das baixas. O período é em meses inteiros (AAAA-MM), no máximo 24; sem datas, os últimos 6 meses.',
    inputSchema: z.object({
      ...periodoMeses,
      visao: z.enum(['competencia', 'caixa']).optional().describe('"competencia" (padrão) ou "caixa".'),
      impostos: z.enum(['lancados', 'estimados']).optional().describe('"lancados" (padrão) usa os impostos efetivamente lançados; "estimados" calcula pelo regime e pelas alíquotas cadastradas da empresa.'),
    }),
    handler: async (args, api) => ({ success: true, data: await api.get('/ger/dre', args) }),
  }),
  ferramenta({
    name: 'relatorio_fluxo_caixa',
    description:
      'Fluxo de caixa, em reais: saldoAtual de todas as contas, realizado por mês (entradas, saidas, entradasFora e saidasFora da DRE, liquido e saldoFinal), atrasadas (a receber e a pagar já vencidas), projecao semanal das parcelas em aberto (inicio, fim, receber, pagar, saldo projetado) e menorSaldo previsto. Na projeção, as parcelas atrasadas entram já no saldo da primeira semana. Só o dono e o perfil Financeiro têm acesso: os demais recebem erro 403.',
    inputSchema: z.object({
      ...periodoMeses,
      semanas: z.number().int().min(4).max(26).optional().describe('Quantas semanas projetar a partir de hoje, de 4 a 26. O padrão é 12.'),
    }),
    handler: async (args, api) => ({ success: true, data: await api.get('/ger/fluxo', args) }),
  }),
  ferramenta({
    name: 'relatorio_gerencial',
    description:
      'Resumo gerencial integrado, uma linha por mês, em reais: receita, custoFrota, lucroBruto e resultado (pela DRE por competência), recebido e pago (caixa), notasCompra, notasVenda, notasConfirmadas e notasPendentes, além de dados da frota (litros, km, horas, osConcluidas). O período é em meses inteiros (AAAA-MM), no máximo 24; sem datas, os últimos 6 meses.',
    inputSchema: z.object(periodoMeses),
    handler: async (args, api) => ({ success: true, data: await api.get('/rel/gerencial', args) }),
  }),
  ferramenta({
    name: 'relatorio_indicadores',
    description:
      'Indicadores de gestão da empresa no período. Cada indicador traz id, nome, modulo, unidade, formula, fonte, leitura (como interpretar), melhor (se maior ou menor é melhor), valor do período e valores mês a mês; os marcados com retrato = true são a situação de hoje e não têm série mensal. O período é em meses inteiros (AAAA-MM), no máximo 24; sem datas, os últimos 6 meses.',
    inputSchema: z.object(periodoMeses),
    handler: async (args, api) => ({ success: true, data: await api.get('/rel/indicadores', args) }),
  }),
  ferramenta({
    name: 'criar_lancamento',
    description:
      'Cria um lançamento financeiro: despesa (conta a pagar) ou receita (conta a receber), com as categorias (apropriacoes) e as parcelas. Regras que causam erro 400: a soma das apropriações e a soma das parcelas têm de ser iguais a valorTotal; a categoria precisa aceitar lançamento e ser do mesmo tipo; despesa leva fornecedorId e nunca clienteId, receita leva clienteId e nunca fornecedorId. Com recorrencia, o lançamento é repetido "repeticoes" vezes, deslocando competência e vencimentos. Devolve o primeiro lançamento completo (com os ids das parcelas) e "criados" (quantos foram gerados). Valores em reais, datas AAAA-MM-DD.',
    inputSchema: z.object({
      ...camposLancamento,
      apropriacoes: z.array(apropriacao).min(1).max(50).describe('Categorias do plano de contas (e centros de custo) entre as quais o valor total se divide. Pelo menos uma.'),
      parcelas: z.array(parcela).min(1).max(120).describe('Parcelas com vencimento e valor; a soma tem de ser igual a valorTotal. Para pagamento à vista, uma parcela só com o valor total.'),
      estoque: z
        .array(
          z.object({
            descricao: z.string().min(2).max(200).describe('Descrição do material comprado.'),
            quantidade: z.number().positive().describe('Quantidade que entra no estoque, na unidade do insumo da obra.'),
            unidade: z.string().max(20).optional().describe('Unidade. Opcional.'),
            valor: z.number().min(0).describe('Valor do item, em reais.'),
            obraId: z.string().uuid().describe('Obra (de listar_obras).'),
            obraItemId: z.string().uuid().describe('Insumo da planilha da obra (de listar_itens_obra).'),
            eapNoId: z.string().uuid().describe('Linha da EAP a que o material é apropriado (de listar_planilha_orcamentaria).'),
            obraEstoqueId: z.string().uuid().optional().describe('Estoque da obra que recebe (de listar_estoques). Sem ele, o estoque de recebimento.'),
          }),
        )
        .max(200)
        .optional()
        .describe('Itens que dão entrada no estoque da obra junto com a despesa (compra sem nota). Opcional.'),
      baixa: z
        .object({
          data: data('Data do pagamento ou recebimento, AAAA-MM-DD. No máximo amanhã.'),
          contaId: z.string().uuid().describe('Id da conta financeira por onde o dinheiro saiu ou entrou (de listar_contas_financeiras). A conta precisa estar ativa.'),
          forma: z.enum(FORMAS).optional().describe('Forma de pagamento. Opcional.'),
          juros: z.number().min(0).max(100_000_000).optional().describe('Juros e multa pagos, em reais. Opcional (padrão 0).'),
          desconto: z.number().min(0).max(100_000_000).optional().describe('Desconto obtido, em reais; tem de ser menor que o valor da parcela. Opcional (padrão 0).'),
          observacoes: z.string().max(300).optional().describe('Observação da baixa. Opcional.'),
        })
        .optional()
        .describe('Informe só se o lançamento já foi pago ou recebido: baixa TODAS as parcelas na hora (juros e desconto entram só na primeira; numa recorrência, as próximas ocorrências ficam em aberto). Omita para deixar tudo em aberto.'),
      recorrencia: z.enum(['nenhuma', 'semanal', 'mensal', 'anual']).optional().describe('Repetição do lançamento. O padrão é "nenhuma".'),
      repeticoes: z.number().int().min(1).max(60).optional().describe('Quantos lançamentos gerar ao todo quando há recorrência (1 a 60). Ignorado se recorrencia for "nenhuma".'),
      pedidoId: z.string().uuid().optional().describe('Id de um pedido de compra aprovado (de listar_pedidos_para_lancamento) que esta despesa quita. Exige tipo "despesa", sem recorrência, o mesmo fornecedorId do pedido e valorTotal igual ao total do pedido; pedido que já tem despesa devolve erro 409.'),
    }),
    handler: async (args, api) => ({ success: true, data: await api.post('/fin/lancamentos', args) }),
  }),
  ferramenta({
    name: 'atualizar_lancamento',
    description:
      'Altera um lançamento. A rota exige o objeto INTEIRO, não aceita parcial: chame buscar_lancamento antes e reenvie todos os campos, mudando só o que precisa (campo omitido é recusado com erro 400: para limpar, envie null; as apropriações são todas substituídas e cada uma precisa trazer centroCustoId e veiculoId, mesmo que null). As parcelas já pagas ficam como estão; "parcelas" traz só as parcelas em aberto, que substituem as abertas atuais, e a soma delas mais as já pagas tem de ser igual a valorTotal. Não dá para trocar o tipo, nem alterar lançamento cancelado ou vindo de nota fiscal (erro 409: reabra a nota). Devolve o lançamento atualizado.',
    inputSchema: z.object({
      lancamentoId: z.string().uuid().describe('Id do lançamento a alterar (de listar_lancamentos).'),
      ...camposLancamento,
      tipo: z.enum(['receita', 'despesa']).describe('Tem de ser o mesmo tipo atual do lançamento: a API recusa a troca entre receita e despesa.'),
      apropriacoes: z.array(apropriacao).min(1).max(50).describe('Lista completa das categorias: substitui todas as apropriações atuais. A soma tem de ser igual a valorTotal.'),
      parcelas: z.array(parcela).max(120).describe('Somente as parcelas EM ABERTO (substituem as abertas atuais); não inclua as já pagas. Pode ser lista vazia apenas se as parcelas pagas já somam o valorTotal.'),
    }),
    handler: async ({ lancamentoId, ...corpo }, api) => ({ success: true, data: await api.put(`/fin/lancamentos/${lancamentoId}`, corpo) }),
  }),
  ferramenta({
    name: 'cancelar_lancamento',
    description:
      'Cancela um lançamento e suas parcelas em aberto (o lançamento continua no histórico com status cancelado; a entrada de estoque que ele gerou sai junto). Devolve "cancelados" (quantidade). Erro 409 se houver parcela paga (estorne antes com estornar_baixa_parcela), se já estiver cancelado ou se o lançamento veio de nota fiscal (use cancelar_nota_fiscal ou reabrir_nota_fiscal). O id vem de listar_lancamentos.',
    inputSchema: z.object({
      lancamentoId: z.string().uuid().describe('Id do lançamento a cancelar (de listar_lancamentos).'),
      seguintes: z.boolean().optional().describe('Em lançamento recorrente, true cancela também as repetições seguintes ainda não canceladas. O padrão é false (só este).'),
    }),
    handler: async ({ lancamentoId, seguintes }, api) => ({ success: true, data: await api.post(`/fin/lancamentos/${lancamentoId}/cancelar`, { seguintes }) }),
  }),

  // ---------- Escritas: parcelas ----------
  ferramenta({
    name: 'baixar_parcela',
    description:
      'Registra o pagamento (despesa) ou o recebimento (receita) de uma parcela em aberto: ela passa a "paga" e o valor entra no saldo da conta escolhida. O valor pago é o valor da parcela mais juros menos desconto. Erros: 409 se a parcela já foi baixada ou cancelada; 400 se a data passar de amanhã, se a conta estiver desativada ou se o desconto zerar o valor. Devolve a parcela atualizada. Os ids vêm de listar_parcelas (parcela) e listar_contas_financeiras (conta).',
    inputSchema: z.object({
      parcelaId: z.string().uuid().describe('Id da parcela em aberto (de listar_parcelas ou buscar_lancamento).'),
      data: data('Data do pagamento ou recebimento, AAAA-MM-DD. No máximo amanhã.'),
      contaId: z.string().uuid().describe('Id da conta financeira por onde o dinheiro saiu ou entrou (de listar_contas_financeiras).'),
      forma: z.enum(FORMAS).optional().describe('Forma de pagamento. Opcional.'),
      juros: z.number().min(0).max(100_000_000).optional().describe('Juros e multa, em reais. Opcional (padrão 0).'),
      desconto: z.number().min(0).max(100_000_000).optional().describe('Desconto, em reais; tem de ser menor que o valor da parcela mais os juros. Opcional (padrão 0).'),
      observacoes: z.string().max(300).optional().describe('Observação da baixa. Opcional.'),
    }),
    handler: async ({ parcelaId, ...corpo }, api) => ({ success: true, data: await api.post(`/fin/parcelas/${parcelaId}/baixar`, corpo) }),
  }),
  ferramenta({
    name: 'baixar_parcelas_lote',
    description:
      'Baixa várias parcelas em aberto de uma vez, todas com a mesma data, conta e forma, pelo valor cheio (sem juros nem desconto). É tudo ou nada: se uma parcela falhar (já baixada, cancelada, não encontrada), nenhuma é baixada. Devolve "baixadas" (quantidade). Os ids vêm de listar_parcelas.',
    inputSchema: z.object({
      ids: z.array(z.string().uuid()).min(1).max(200).describe('Ids das parcelas em aberto a baixar (de listar_parcelas), de 1 a 200.'),
      data: data('Data do pagamento ou recebimento de todas, AAAA-MM-DD. Não pode ser futura.'),
      contaId: z.string().uuid().describe('Id da conta financeira (de listar_contas_financeiras).'),
      forma: z.enum(FORMAS).optional().describe('Forma de pagamento. Opcional.'),
      observacoes: z.string().max(300).optional().describe('Observação gravada em todas as baixas. Opcional.'),
    }),
    handler: async (args, api) => ({ success: true, data: await api.post('/fin/parcelas/baixar-lote', args) }),
  }),
  ferramenta({
    name: 'estornar_baixa_parcela',
    description:
      'Desfaz a baixa de uma parcela paga: ela volta a "aberta", perde data de pagamento, conta, forma, juros e desconto, e o valor sai do saldo da conta. Se a parcela estava conciliada com o extrato bancário, a linha do extrato volta a pendente. Erro 409 se a parcela não estiver paga. Devolve a parcela atualizada; o id vem de listar_parcelas com situacao "pagas".',
    inputSchema: z.object({
      parcelaId: z.string().uuid().describe('Id da parcela paga (de listar_parcelas com situacao "pagas", ou de buscar_lancamento).'),
    }),
    handler: async ({ parcelaId }, api) => ({ success: true, data: await api.post(`/fin/parcelas/${parcelaId}/estornar`) }),
  }),
  ferramenta({
    name: 'atualizar_parcela',
    description:
      'Altera o vencimento e/ou as observações de uma parcela em aberto (aceita parcial: envie só o que muda). Não altera o valor: para mudar valores ou a quantidade de parcelas use atualizar_lancamento. Erro 409 se a parcela não estiver em aberto. Devolve a parcela atualizada.',
    inputSchema: z.object({
      parcelaId: z.string().uuid().describe('Id da parcela em aberto (de listar_parcelas ou buscar_lancamento).'),
      vencimento: data('Novo vencimento, AAAA-MM-DD. Opcional.').optional(),
      observacoes: z.string().max(300).optional().describe('Novas observações da parcela. Opcional; texto vazio não apaga a observação atual.'),
    }),
    handler: async ({ parcelaId, ...corpo }, api) => ({ success: true, data: await api.patch(`/fin/parcelas/${parcelaId}`, corpo) }),
  }),

  // ---------- Escritas: contas, transferências, plano de contas ----------
  ferramenta({
    name: 'criar_conta_financeira',
    description:
      'Cria uma conta financeira (banco, caixa, cartão ou aplicação) e devolve a conta com id e saldo. O saldo inicial vale a partir de dataSaldoInicial: baixas e transferências anteriores a essa data não entram no saldo.',
    inputSchema: z.object({
      nome: z.string().min(2).max(80).describe('Nome da conta, como aparece nas listas (ex.: "Itaú conta movimento").'),
      tipo: z.enum(['banco', 'caixa', 'cartao', 'aplicacao']).optional().describe('Tipo da conta. O padrão é "banco".'),
      banco: z.string().max(80).optional().describe('Nome do banco. Opcional.'),
      agencia: z.string().max(20).optional().describe('Agência. Opcional.'),
      conta: z.string().max(30).optional().describe('Número da conta. Opcional.'),
      saldoInicial: z.number().min(-100_000_000).max(100_000_000).optional().describe('Saldo inicial em reais (pode ser negativo). O padrão é 0.'),
      dataSaldoInicial: data('Data a que o saldo inicial se refere, AAAA-MM-DD. Opcional: o padrão é hoje.').optional(),
    }),
    handler: async (args, api) => ({ success: true, data: await api.post('/fin/contas', args) }),
  }),
  ferramenta({
    name: 'atualizar_conta_financeira',
    description:
      'Altera uma conta financeira (aceita parcial: envie só os campos que mudam) e devolve a conta com o saldo recalculado. Use ativo = false para desativar: conta desativada não aceita novas baixas nem transferências. Mudar saldoInicial ou dataSaldoInicial muda o saldo atual da conta.',
    inputSchema: z.object({
      contaId: z.string().uuid().describe('Id da conta financeira (de listar_contas_financeiras).'),
      nome: z.string().min(2).max(80).optional().describe('Novo nome da conta.'),
      tipo: z.enum(['banco', 'caixa', 'cartao', 'aplicacao']).optional().describe('Novo tipo da conta.'),
      banco: z.string().max(80).optional().describe('Nome do banco; texto vazio apaga.'),
      agencia: z.string().max(20).optional().describe('Agência; texto vazio apaga.'),
      conta: z.string().max(30).optional().describe('Número da conta; texto vazio apaga.'),
      saldoInicial: z.number().min(-100_000_000).max(100_000_000).optional().describe('Novo saldo inicial em reais.'),
      dataSaldoInicial: data('Nova data do saldo inicial, AAAA-MM-DD.').optional(),
      ativo: z.boolean().optional().describe('false desativa a conta; true reativa.'),
    }),
    handler: async ({ contaId, ...corpo }, api) => ({ success: true, data: await api.patch(`/fin/contas/${contaId}`, corpo) }),
  }),
  ferramenta({
    name: 'transferir_entre_contas',
    description:
      'Registra uma transferência de dinheiro entre duas contas financeiras da construtora (sai da origem, entra no destino) e devolve o id da transferência. Erro 400 se origem e destino forem a mesma conta ou se alguma delas estiver desativada. Os ids vêm de listar_contas_financeiras; valor em reais.',
    inputSchema: z.object({
      origemId: z.string().uuid().describe('Id da conta de onde o dinheiro sai (de listar_contas_financeiras).'),
      destinoId: z.string().uuid().describe('Id da conta onde o dinheiro entra (de listar_contas_financeiras). Diferente da origem.'),
      data: data('Data da transferência, AAAA-MM-DD.'),
      valor: z.number().min(0.01).max(100_000_000).describe('Valor transferido, em reais.'),
      descricao: z.string().max(200).optional().describe('Descrição da transferência. Opcional.'),
    }),
    handler: async (args, api) => ({ success: true, data: await api.post('/fin/transferencias', args) }),
  }),
  ferramenta({
    name: 'criar_categoria_plano_contas',
    description:
      'Cria uma categoria no plano de contas e devolve a conta criada (id, codigo, nome, tipo, linhaDre, paiId, aceitaLancamento, ativo). O código define a hierarquia: para criar 4.2.1 o grupo 4.2 já precisa existir (erro 400), e o grupo pai deixa de aceitar lançamentos; se o pai já tiver lançamentos, a API recusa. Confira os códigos existentes em listar_plano_contas antes.',
    inputSchema: z.object({
      codigo: z.string().regex(/^\d+(\.\d+)*$/).describe('Código hierárquico só com números e pontos, ex.: "4.2" ou "4.2.1".'),
      nome: z.string().min(2).max(120).describe('Nome da categoria.'),
      tipo: z.enum(['receita', 'despesa']).describe('Se a categoria é de receita ou de despesa.'),
      linhaDre: z.enum(LINHAS_DRE).describe('Linha da DRE em que a categoria entra; "fora_dre" para o que não é resultado (ex.: empréstimos, aportes, investimentos).'),
      aceitaLancamento: z.boolean().optional().describe('true (padrão) para categoria que recebe lançamentos; false para criar um grupo que só agrupa outras categorias.'),
    }),
    handler: async (args, api) => ({ success: true, data: await api.post('/fin/plano-contas', args) }),
  }),
  ferramenta({
    name: 'criar_centro_custo',
    description: 'Cria um centro de custo e devolve { centro: { id, nome, ativo } }. O id passa a servir de centroCustoId nas apropriações de criar_lancamento. Confira em listar_centros_custo se já não existe um com o mesmo nome.',
    inputSchema: z.object({
      nome: z.string().min(2).max(60).describe('Nome do centro de custo.'),
    }),
    handler: async (args, api) => ({ success: true, data: await api.post('/fin/centros-custo', args) }),
  }),

  // ---------- Escritas: notas fiscais ----------
  ferramenta({
    name: 'confirmar_nota_fiscal',
    description:
      'Confirma uma nota fiscal em rascunho (ou aguardando conferência): gera o lançamento financeiro com uma apropriação por item e as parcelas (as duplicatas da nota ou, se não houver, uma parcela única) e, em nota de entrada, dá entrada no estoque. Erro 400 se a nota tiver pendências (veja o campo pendencias de buscar_nota_fiscal: fornecedor, itens sem categoria, somas diferentes do total); erro 409 se já estiver confirmada ou cancelada. Devolve a nota atualizada, com o lançamento gerado. O id vem de listar_notas_fiscais.',
    inputSchema: z.object({
      notaId: z.string().uuid().describe('Id da nota fiscal em rascunho (de listar_notas_fiscais).'),
      vencimento: data('Vencimento da parcela única, AAAA-MM-DD; só é usado quando a nota não tem duplicatas. Opcional: o padrão é a data de emissão.').optional(),
      baixa: z
        .object({
          data: data('Data do pagamento ou recebimento, AAAA-MM-DD. No máximo amanhã.'),
          contaId: z.string().uuid().describe('Id da conta financeira (de listar_contas_financeiras).'),
          forma: z.enum(FORMAS).optional().describe('Forma de pagamento. Opcional: o padrão é a forma de pagamento da nota.'),
          observacoes: z.string().max(300).optional().describe('Observação da baixa. Opcional.'),
        })
        .optional()
        .describe('Informe só se a nota já foi paga: baixa TODAS as parcelas geradas nesta data e conta. Omita para deixar as parcelas em aberto.'),
      aprender: z.boolean().optional().describe('true (padrão) guarda a categoria de cada item como regra para as próximas notas do mesmo fornecedor; false não guarda.'),
    }),
    handler: async ({ notaId, ...corpo }, api) => ({ success: true, data: await api.post(`/fin/notas/${notaId}/confirmar`, corpo) }),
  }),
  ferramenta({
    name: 'reabrir_nota_fiscal',
    description:
      'Reabre uma nota fiscal confirmada: ela volta a rascunho, o lançamento gerado é cancelado junto com as parcelas em aberto e a entrada de estoque é desfeita. Erro 409 se a nota não estiver confirmada ou se houver parcela já paga (estorne antes com estornar_baixa_parcela). Devolve a nota atualizada.',
    inputSchema: z.object({
      notaId: z.string().uuid().describe('Id da nota fiscal confirmada (de listar_notas_fiscais).'),
    }),
    handler: async ({ notaId }, api) => ({ success: true, data: await api.post(`/fin/notas/${notaId}/reabrir`) }),
  }),
  ferramenta({
    name: 'cancelar_nota_fiscal',
    description:
      'Marca a nota fiscal como cancelada (caso em que o emitente cancelou a nota): ela fica no histórico sem valor, o lançamento gerado é cancelado, a entrada de estoque é desfeita e os vínculos com abastecimentos e ordens de serviço são soltos. Não há rota para desfazer o cancelamento. Erro 409 se a nota já estiver cancelada ou se houver parcela já paga (estorne antes com estornar_baixa_parcela). Devolve a nota atualizada.',
    inputSchema: z.object({
      notaId: z.string().uuid().describe('Id da nota fiscal (de listar_notas_fiscais).'),
    }),
    handler: async ({ notaId }, api) => ({ success: true, data: await api.post(`/fin/notas/${notaId}/cancelar`) }),
  }),
);
