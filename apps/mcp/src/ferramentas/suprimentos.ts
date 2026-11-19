// Ferramentas do módulo Suprimentos: estoque da obra, solicitações de compra, cotações (mapa), pedidos de compra,
// contratos com prestadores, medições, autorizações de pagamento, fila de aprovações, relatórios, patrimônio e permutas.
// Rotas em /api/sup (suprimentos.ts, contratos.ts, patrimonio.ts, permutas.ts) e /api/ger/aprovacoes.
import { z } from 'zod';
import { colecao, ferramenta } from './tipos.ts';

const uuid = (descricao: string) => z.string().uuid().describe(descricao);
const dia = (descricao: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe(descricao);

const FORMAS_PAGAMENTO = ['pix', 'boleto', 'transferencia', 'cartao', 'dinheiro', 'cheque', 'debito_automatico', 'permuta'] as const;
const ESCOPOS_SERVICO = ['mo', 'eq', 'mat', 'mat_mo', 'mat_mo_eq', 'mo_eq', 'mat_eq'] as const;

// ---------------------------------------------------------------- esquemas compartilhados

/** Item de solicitação de material: necessidade já apropriada (necessidadeId) ou insumo da planilha (obraItemId). */
const itemSolicitacaoMaterial = z.object({
  necessidadeId: uuid(
    'Id de uma necessidade de insumo já apropriada na obra e ainda pendente (módulo Engenharia, necessidades da obra; ou `itens[].necessidadeId` de `buscar_solicitacao_compra`). Use este OU `obraItemId`.',
  ).optional(),
  obraItemId: uuid('Id do insumo na planilha da obra (item do tipo insumo, módulo Engenharia). Cria a necessidade junto com a solicitação. Use este OU `necessidadeId`.').optional(),
  eapNoId: uuid(
    'Só com `obraItemId`: id do nó da EAP da obra onde o insumo é apropriado, no nível de apropriação da obra (etapa, subetapa ou tarefa). Omita apenas se a obra apropria no nível "obra".',
  ).optional(),
  quantidade: z
    .number()
    .positive()
    .describe('Quantidade, maior que zero. Obrigatória com `obraItemId`. Com `necessidadeId` é opcional e, se enviada, altera a quantidade da necessidade (na unidade em que ela é pedida).')
    .optional(),
  unidade: z
    .string()
    .max(20)
    .describe('Só com `obraItemId`: unidade de compra, quando diferente da unidade do orçamento. Precisa estar cadastrada como unidade de compra do insumo na obra; a quantidade é convertida pelo fator.')
    .optional(),
  dataNecessaria: dia('Só com `obraItemId`: data em que o material é necessário na obra (AAAA-MM-DD).').optional(),
  observacao: z.string().max(200).describe('Observação do item (até 200 caracteres).').optional(),
});

/** A rota aceita dois formatos de item; aqui cada item é montado no formato que ele pede. */
function montarItensMaterial(itens: z.infer<typeof itemSolicitacaoMaterial>[]) {
  return itens.map((i) =>
    i.obraItemId
      ? { obraItemId: i.obraItemId, eapNoId: i.eapNoId ?? null, quantidade: i.quantidade, unidade: i.unidade, dataNecessaria: i.dataNecessaria, observacao: i.observacao }
      : { necessidadeId: i.necessidadeId, quantidade: i.quantidade, observacao: i.observacao },
  );
}

const itemSolicitacaoServico = z.object({
  obraItemId: uuid('Id do serviço na planilha da obra (item do tipo composição, módulo Engenharia).'),
  eapNoId: uuid('Id do nó da EAP da obra, no nível de apropriação da obra (etapa, subetapa ou tarefa). Omita apenas se a obra apropria no nível "obra".').optional(),
  quantidade: z.number().positive().describe('Quantidade do serviço, maior que zero, na unidade do serviço na planilha.'),
  observacao: z.string().max(200).describe('Observação do item (até 200 caracteres).').optional(),
});

const camposSolicitacao = {
  obraId: uuid('Id da obra (de `listar_obras`). A obra precisa estar ativa.'),
  data: dia('Data da solicitação (AAAA-MM-DD). Se omitida ao criar, vale hoje; ao atualizar, mantém a atual.').optional(),
  necessidade: dia('Data limite em que o material ou serviço é necessário (AAAA-MM-DD).').optional(),
  observacao: z.string().max(500).describe('Observação geral da solicitação (até 500 caracteres).').optional(),
};

const camposServico = {
  planoContaId: uuid('Id da categoria do plano de contas do serviço (módulo Financeiro, plano de contas).'),
  escopo: z
    .enum(ESCOPOS_SERVICO)
    .describe('O que o prestador fornece: mo = mão de obra, eq = equipamento, mat = material, e as combinações mat_mo, mat_mo_eq, mo_eq, mat_eq.'),
};

const retencoesPercentuais = z
  .object({
    caucao: z.number().min(0).max(30).describe('Caução retida em cada medição, em % (0 a 30).'),
    iss: z.number().min(0).max(10).describe('ISS retido, em % (0 a 10).'),
    inss: z.number().min(0).max(20).describe('INSS retido, em % (0 a 20).'),
    ir: z.number().min(0).max(10).describe('IR retido, em % (0 a 10).'),
    pcc: z.number().min(0).max(10).describe('PIS/COFINS/CSLL retidos, em % (0 a 10).'),
  })
  .describe('Retenções do contrato em percentual sobre o valor bruto de cada medição. Se enviar, informe os cinco campos; se omitir, todas ficam em 0.');

const camposContrato = {
  fornecedorId: uuid('Id do prestador (de `listar_fornecedores`).'),
  objeto: z.string().min(3).max(300).describe('Objeto do contrato: o que está sendo contratado (3 a 300 caracteres).'),
  tipo: z.enum(['itens', 'global']).describe('`itens`: contrato por serviços com quantidade e preço unitário (exige `itens`). `global`: preço fechado (exige `valorGlobal`).'),
  dataAssinatura: dia('Data de assinatura (AAAA-MM-DD).').optional(),
  inicio: dia('Início da vigência (AAAA-MM-DD).'),
  fim: dia('Fim da vigência (AAAA-MM-DD); não pode ser antes do início.').optional(),
  valorGlobal: z.number().positive().describe('Valor global do contrato em reais. Obrigatório quando `tipo` é `global`; ignorado quando é `itens`.').optional(),
  planoContaId: uuid('Id da categoria de despesa do plano de contas onde o contrato é apropriado (módulo Financeiro). Precisa ser de despesa e aceitar lançamento (não pode ser grupo).'),
  centroCustoId: uuid('Id do centro de custo (módulo Financeiro). Obrigatório para o perfil engenheiro de obra, que só usa o centro das obras dele.').optional(),
  prazoPagamentoDias: z.number().int().min(0).max(180).describe('Prazo de pagamento em dias após a autorização (0 a 180). Padrão 15.').optional(),
  formaPagamento: z.enum(FORMAS_PAGAMENTO).describe('Forma de pagamento padrão do contrato.').optional(),
  prazoCorrecaoDias: z.number().int().min(1).max(365).describe('Prazo, em dias, para o prestador corrigir defeitos (1 a 365).').optional(),
  garantiaMeses: z.number().int().min(1).max(120).describe('Garantia do serviço em meses (1 a 120).').optional(),
  retencoes: retencoesPercentuais.optional(),
  observacao: z.string().max(1000).describe('Observações do contrato (até 1000 caracteres).').optional(),
  itens: z
    .array(
      z.object({
        id: uuid('Id do item já existente no contrato (de `buscar_contrato_fornecedor`), para mantê-lo ao atualizar. Omita para criar um item novo.').optional(),
        descricao: z.string().min(1).max(1000).describe('Descrição do serviço.'),
        unidade: z.string().min(1).max(10).describe('Unidade de medida (ex.: m2, m3, un, vb).'),
        quantidade: z.number().positive().describe('Quantidade contratada, maior que zero.'),
        precoUnitario: z.number().min(0).describe('Preço unitário em reais.'),
      }),
    )
    .max(200)
    .describe('Itens do contrato. Obrigatório (ao menos um) quando `tipo` é `itens`; ignorado quando é `global`.')
    .optional(),
};

// ---------------------------------------------------------------- catálogo

export const ferramentasSuprimentos = colecao(
  // ============================================================== Estoque

  ferramenta({
    name: 'listar_saldo_estoque',
    description:
      'Saldo de material em estoque, por insumo da obra. Devolve `itens` (obraItemId, código, descrição, unidade, saldo total e `apropriacoes`: quanto há em cada obra, estoque e etapa da EAP, com obraId, estoqueId e eapNoId) e `unidadesCompra` (fator de conversão das unidades de compra). Só aparecem saldos diferentes de zero. Os ids de `apropriacoes` servem para `registrar_transferencia_estoque`.',
    inputSchema: z.object({
      obraId: uuid('Id da obra (de `listar_obras`) para ver só o estoque dela. Sem ele, traz todas as obras.').optional(),
    }),
    handler: async (args, api) => ({ success: true, data: await api.get('/sup/estoque', { obraId: args.obraId }) }),
  }),

  ferramenta({
    name: 'listar_estoques',
    description:
      'Lista os estoques (almoxarifados) cadastrados: id, código, nome, se é o de recebimento (onde entram as notas de compra), se está ativo e a obra (obraId, obraCodigo, obraNome; nulos em estoque geral). Com `obraId`, devolve os estoques daquela obra e também os gerais, sem obra. Use para achar os ids de origem e destino de `registrar_transferencia_estoque`.',
    inputSchema: z.object({
      obraId: uuid('Id da obra (de `listar_obras`). Sem ele, lista os estoques de todas as obras.').optional(),
    }),
    handler: async (args, api) => ({ success: true, data: await api.get('/sup/estoques', { obraId: args.obraId }) }),
  }),

  ferramenta({
    name: 'listar_etiquetas_estoque',
    description:
      'Lista as entradas de material no estoque (cada entrada é uma "etiqueta"): id, data, quantidade que entrou, saldo que resta, insumo (código, descrição, unidade), obra, etapa da EAP (eapNoId) e estoque. Por padrão só as que ainda têm saldo; no máximo 300, das mais recentes para as mais antigas. O `id` de cada entrada é o `etiquetaId` de `registrar_saida_material`.',
    inputSchema: z.object({
      obraId: uuid('Id da obra (de `listar_obras`).').optional(),
      estoqueId: uuid('Id do estoque (de `listar_estoques`).').optional(),
      apenasComSaldo: z.boolean().describe('Padrão true: só entradas com saldo. Envie false para incluir as que já foram totalmente consumidas.').optional(),
    }),
    handler: async (args, api) => ({
      success: true,
      data: await api.get('/sup/etiquetas', { obraId: args.obraId, estoqueId: args.estoqueId, saldo: args.apenasComSaldo === false ? '0' : undefined }),
    }),
  }),

  ferramenta({
    name: 'listar_colaboradores_estoque',
    description:
      'Lista os colaboradores ativos que podem retirar material do estoque (id, nome, função, cargo). É o mesmo cadastro de colaboradores do Administrativo. O `id` é o `colaboradorId` de `registrar_saida_material`.',
    inputSchema: z.object({}),
    handler: async (_args, api) => ({ success: true, data: await api.get('/sup/colaboradores') }),
  }),

  ferramenta({
    name: 'listar_saidas_material',
    description:
      'Lista as últimas 200 saídas de material do estoque (requisições): id, número (SAI-0001), data, obra, etapa da EAP, colaborador que retirou, quem entregou, quantidade de itens e observação. Não tem filtros.',
    inputSchema: z.object({}),
    handler: async (_args, api) => ({ success: true, data: await api.get('/sup/saidas-material') }),
  }),

  ferramenta({
    name: 'registrar_saida_material',
    description:
      'Registra a saída de material do estoque para um colaborador, baixando o saldo. Cada item aponta uma entrada de estoque (`etiquetaId`, de `listar_etiquetas_estoque`) e a quantidade retirada. Todas as etiquetas precisam ser da obra e da etapa da EAP informadas, e a quantidade não pode passar do saldo da etiqueta nem do saldo do estoque naquela etapa; a mesma etiqueta não pode repetir. A rota só aceita etiquetas de entradas vindas de nota fiscal. Devolve `id` e `numero` da saída.',
    inputSchema: z.object({
      obraId: uuid('Id da obra (de `listar_obras`); a mesma das etiquetas.'),
      eapNoId: uuid('Id da etapa da EAP a que os insumos estão apropriados (campo `eapNoId` das etiquetas em `listar_etiquetas_estoque`).'),
      colaboradorId: uuid('Id do colaborador que retira o material (de `listar_colaboradores_estoque`).'),
      data: dia('Data da saída (AAAA-MM-DD).'),
      observacao: z.string().max(500).describe('Observação da saída (até 500 caracteres).').optional(),
      itens: z
        .array(
          z.object({
            etiquetaId: uuid('Id da entrada de estoque (campo `id` em `listar_etiquetas_estoque`).'),
            quantidade: z.number().positive().max(10_000_000).describe('Quantidade retirada, na unidade do insumo; maior que zero e até o saldo da etiqueta.'),
          }),
        )
        .min(1)
        .max(200)
        .describe('Insumos retirados (1 a 200), um por etiqueta.'),
    }),
    handler: async (args, api) => ({ success: true, data: await api.post('/sup/saidas-material', args) }),
  }),

  ferramenta({
    name: 'registrar_transferencia_estoque',
    description:
      'Transfere material entre dois estoques da MESMA obra, mantendo a etapa da EAP: grava uma saída na origem e uma entrada no destino. Os dois estoques precisam ser da obra e estar ativos, e a quantidade não pode passar do saldo do insumo na origem naquela etapa (veja `listar_saldo_estoque`). Devolve `transferenciaId`.',
    inputSchema: z.object({
      obraId: uuid('Id da obra (de `listar_obras`).'),
      obraItemId: uuid('Id do insumo da obra (campo `obraItemId` de `listar_saldo_estoque`).'),
      eapNoId: uuid('Id da etapa da EAP onde o saldo está apropriado (campo `apropriacoes[].eapNoId` de `listar_saldo_estoque`).'),
      origemId: uuid('Id do estoque de origem (de `listar_estoques` com a obra, ou `apropriacoes[].estoqueId`).'),
      destinoId: uuid('Id do estoque de destino (de `listar_estoques` com a obra); diferente da origem.'),
      data: dia('Data da transferência (AAAA-MM-DD).'),
      quantidade: z.number().positive().max(10_000_000).describe('Quantidade a transferir, na unidade do insumo; maior que zero.'),
      observacao: z.string().max(300).describe('Observação (até 300 caracteres).').optional(),
    }),
    handler: async (args, api) => ({ success: true, data: await api.post('/sup/estoque/transferencias', args) }),
  }),

  // ============================================================== Solicitações de compra

  ferramenta({
    name: 'listar_solicitacoes_compra',
    description:
      'Lista as solicitações de compra (de material e de serviço): id, número, tipo, data, data de necessidade, obra, status, solicitante, quantidade de itens, resumo dos itens, dias em aberto e se é urgente. Sem `status`, devolve todas as que estão em andamento (aberta, finalizada, em_cotacao) mais as atendidas e canceladas dos últimos 120 dias; máximo 500. O filtro `status` não aceita "finalizada" (pronta para cotar): para achá-las, liste sem status e olhe o campo `status` de cada uma.',
    inputSchema: z.object({
      status: z.enum(['aberta', 'finalizada', 'em_cotacao', 'atendida', 'cancelada']).describe('Filtra por situação.').optional(),
      obraId: uuid('Id da obra (de `listar_obras`).').optional(),
      tipo: z.enum(['insumo', 'servico']).describe('`insumo`: solicitações de material. `servico`: solicitações de serviço (viram contrato).').optional(),
    }),
    handler: async (args, api) => ({ success: true, data: await api.get('/sup/solicitacoes', { status: args.status, obraId: args.obraId, tipo: args.tipo }) }),
  }),

  ferramenta({
    name: 'buscar_solicitacao_compra',
    description:
      'Detalha uma solicitação de compra: cabeçalho (número, tipo, obra, datas, status, solicitante, categoria e escopo quando é de serviço), `itens` (id, necessidadeId, obraItemId, eapNoId, código, descrição, unidade, quantidade) e as cotações e pedidos já gerados a partir dela (id, número, status). O id vem de `listar_solicitacoes_compra`.',
    inputSchema: z.object({ id: uuid('Id da solicitação (de `listar_solicitacoes_compra`).') }),
    handler: async (args, api) => ({ success: true, data: await api.get(`/sup/solicitacoes/${args.id}`) }),
  }),

  ferramenta({
    name: 'criar_solicitacao_compra',
    description:
      'Cria uma solicitação de compra de MATERIAL para uma obra, com status "aberta" (ainda editável). Cada item é uma necessidade de insumo já apropriada e pendente (`necessidadeId`) ou um insumo da planilha da obra (`obraItemId` + `eapNoId` + `quantidade`), que gera a necessidade na hora. Dá erro se o insumo não for da obra, se a necessidade já estiver em outra solicitação ou comprada, ou se o mesmo insumo repetir. Depois use `finalizar_solicitacao_compra` para liberar a cotação. Devolve a solicitação completa. Para serviço, use `criar_solicitacao_servico`.',
    inputSchema: z.object({
      ...camposSolicitacao,
      itens: z.array(itemSolicitacaoMaterial).min(1).max(200).describe('Insumos solicitados (1 a 200).'),
    }),
    handler: async (args, api) => ({
      success: true,
      data: await api.post('/sup/solicitacoes', { obraId: args.obraId, data: args.data, necessidade: args.necessidade, observacao: args.observacao, itens: montarItensMaterial(args.itens) }),
    }),
  }),

  ferramenta({
    name: 'criar_solicitacao_servico',
    description:
      'Cria uma solicitação de SERVIÇO (empreitada) para uma obra, com status "aberta". Os itens são serviços (composições) da planilha da obra, apropriados a um nó da EAP no nível de apropriação da obra. Exige a categoria do plano de contas e o escopo (quem fornece mão de obra, material e equipamento). Depois de finalizada e cotada, a conclusão da cotação gera contratos em rascunho, não pedidos. Devolve a solicitação completa.',
    inputSchema: z.object({
      ...camposSolicitacao,
      ...camposServico,
      itens: z.array(itemSolicitacaoServico).min(1).max(200).describe('Serviços solicitados (1 a 200).'),
    }),
    handler: async (args, api) => ({ success: true, data: await api.post('/sup/solicitacoes', { ...args, tipo: 'servico' }) }),
  }),

  ferramenta({
    name: 'atualizar_solicitacao_compra',
    description:
      'Altera uma solicitação de compra de MATERIAL. Só funciona com status "aberta" (não finalizada e sem cotação); se já foi finalizada, use antes `reabrir_solicitacao_compra`. Substitui o registro inteiro: envie a obra e a lista completa de itens; `necessidade` e `observacao` omitidas são apagadas. Para manter um item que já estava, reenvie pelo `necessidadeId` dele (de `buscar_solicitacao_compra`); item enviado por `obraItemId` cria uma necessidade nova. Devolve a solicitação atualizada.',
    inputSchema: z.object({
      id: uuid('Id da solicitação de material (de `listar_solicitacoes_compra`).'),
      ...camposSolicitacao,
      itens: z.array(itemSolicitacaoMaterial).min(1).max(200).describe('Lista completa dos insumos (1 a 200); substitui a anterior.'),
    }),
    handler: async (args, api) => ({
      success: true,
      data: await api.put(`/sup/solicitacoes/${args.id}`, { obraId: args.obraId, data: args.data, necessidade: args.necessidade, observacao: args.observacao, itens: montarItensMaterial(args.itens) }),
    }),
  }),

  ferramenta({
    name: 'atualizar_solicitacao_servico',
    description:
      'Altera uma solicitação de SERVIÇO. Só funciona com status "aberta"; se já foi finalizada, use antes `reabrir_solicitacao_compra`. Substitui o registro inteiro: envie obra, categoria, escopo e a lista completa de serviços; `necessidade` e `observacao` omitidas são apagadas. Devolve a solicitação atualizada.',
    inputSchema: z.object({
      id: uuid('Id da solicitação de serviço (de `listar_solicitacoes_compra` com tipo servico).'),
      ...camposSolicitacao,
      ...camposServico,
      itens: z.array(itemSolicitacaoServico).min(1).max(200).describe('Lista completa dos serviços (1 a 200); substitui a anterior.'),
    }),
    handler: async ({ id, ...corpo }, api) => ({ success: true, data: await api.put(`/sup/solicitacoes/${id}`, { ...corpo, tipo: 'servico' }) }),
  }),

  ferramenta({
    name: 'finalizar_solicitacao_compra',
    description:
      'Finaliza uma solicitação de compra "aberta": o status passa a "finalizada" e ela fica disponível para cotação (`criar_cotacao`). Dá erro se já foi finalizada ou está em cotação, ou se não tem itens. Devolve a solicitação.',
    inputSchema: z.object({ id: uuid('Id da solicitação (de `listar_solicitacoes_compra`).') }),
    handler: async (args, api) => ({ success: true, data: await api.post(`/sup/solicitacoes/${args.id}/finalizar`) }),
  }),

  ferramenta({
    name: 'reabrir_solicitacao_compra',
    description:
      'Reabre uma solicitação de compra "finalizada", voltando o status para "aberta" para poder ser alterada. Só vale para a que está finalizada e ainda sem cotação em andamento. Devolve a solicitação.',
    inputSchema: z.object({ id: uuid('Id da solicitação (de `listar_solicitacoes_compra`).') }),
    handler: async (args, api) => ({ success: true, data: await api.post(`/sup/solicitacoes/${args.id}/reabrir`) }),
  }),

  ferramenta({
    name: 'cancelar_solicitacao_compra',
    description:
      'Cancela uma solicitação de compra aberta, finalizada ou em cotação; os insumos dela voltam a ficar pendentes para uma nova solicitação. Dá erro se já foi atendida ou cancelada, ou se há cotação aberta ligada a ela (cancele antes com `cancelar_cotacao`). Devolve a solicitação.',
    inputSchema: z.object({ id: uuid('Id da solicitação (de `listar_solicitacoes_compra`).') }),
    handler: async (args, api) => ({ success: true, data: await api.post(`/sup/solicitacoes/${args.id}/cancelar`) }),
  }),

  // ============================================================== Cotações

  ferramenta({
    name: 'listar_cotacoes',
    description:
      'Lista as cotações de compra: id, número, data, prazo de resposta, status (aberta, concluida, cancelada), número da solicitação, quantidade de itens, de fornecedores convidados, de fornecedores que já responderam e de pedidos gerados, e um resumo dos itens. Sem `status`, devolve as abertas mais as dos últimos 120 dias; máximo 500.',
    inputSchema: z.object({
      status: z.enum(['aberta', 'concluida', 'cancelada']).describe('Filtra por situação.').optional(),
    }),
    handler: async (args, api) => ({ success: true, data: await api.get('/sup/cotacoes', { status: args.status }) }),
  }),

  ferramenta({
    name: 'buscar_cotacao',
    description:
      'Devolve o mapa de cotação completo: `fornecedores` (id = id do fornecedor DENTRO da cotação, usado como `cotacaoFornecedorId`; fornecedorId; prazo, condição, frete, desconto, subtotal e total em reais), `itens` (id, descrição, unidade, quantidade, `ofertas` com preço unitário e total de cada fornecedor, `menorPrecoId`, `vencedorId`, justificativa), `pedidos` gerados e `resumo` (total escolhido, economia, melhor fornecedor que cotou tudo). O id vem de `listar_cotacoes`.',
    inputSchema: z.object({ id: uuid('Id da cotação (de `listar_cotacoes`).') }),
    handler: async (args, api) => ({ success: true, data: await api.get(`/sup/cotacoes/${args.id}`) }),
  }),

  ferramenta({
    name: 'criar_cotacao',
    description:
      'Abre uma cotação a partir de uma solicitação de compra com status "finalizada" (use `finalizar_solicitacao_compra` antes); os itens são copiados da solicitação, que passa a "em_cotacao". Pode já convidar até 10 fornecedores. Em solicitação de serviço, o fornecedor precisa ter atuação compatível com o escopo no cadastro. Devolve o mapa de cotação (mesmo formato de `buscar_cotacao`).',
    inputSchema: z.object({
      solicitacaoId: uuid('Id da solicitação finalizada (de `listar_solicitacoes_compra`).'),
      data: dia('Data da cotação (AAAA-MM-DD). Padrão: hoje.').optional(),
      prazoResposta: dia('Data limite para os fornecedores responderem (AAAA-MM-DD).').optional(),
      observacao: z.string().max(500).describe('Observação da cotação (até 500 caracteres).').optional(),
      fornecedorIds: z.array(uuid('Id do fornecedor (de `listar_fornecedores`).')).max(10).describe('Fornecedores convidados a cotar (até 10). Pode ficar vazio e ser definido depois.').optional(),
    }),
    handler: async (args, api) => ({ success: true, data: await api.post('/sup/cotacoes', args) }),
  }),

  ferramenta({
    name: 'atualizar_fornecedores_cotacao',
    description:
      'Define a lista de fornecedores convidados de uma cotação aberta. A lista enviada substitui a atual: quem não estiver nela sai da cotação, quem é novo entra. Só em cotação com status "aberta"; até 10 fornecedores. Devolve o mapa de cotação, onde cada fornecedor ganha o `id` usado em `registrar_precos_cotacao`.',
    inputSchema: z.object({
      id: uuid('Id da cotação (de `listar_cotacoes`).'),
      fornecedorIds: z.array(uuid('Id do fornecedor (de `listar_fornecedores`).')).max(10).describe('Lista completa dos fornecedores que ficam na cotação (até 10).'),
    }),
    handler: async (args, api) => ({ success: true, data: await api.put(`/sup/cotacoes/${args.id}/fornecedores`, { fornecedorIds: args.fornecedorIds }) }),
  }),

  ferramenta({
    name: 'registrar_precos_cotacao',
    description:
      'Registra a proposta de um fornecedor numa cotação aberta: condições (prazo, pagamento, frete, desconto, validade) e o preço unitário de cada item. As condições são regravadas por inteiro a cada chamada (o que for omitido fica vazio; frete e desconto viram 0). Os preços são gravados só para os itens enviados; `precoUnitario: null` apaga o preço daquele item. Valores em reais. Devolve o mapa de cotação atualizado.',
    inputSchema: z.object({
      id: uuid('Id da cotação (de `listar_cotacoes`).'),
      cotacaoFornecedorId: uuid('Id do fornecedor dentro da cotação: campo `fornecedores[].id` de `buscar_cotacao` (não é o `fornecedorId` do cadastro).'),
      prazoEntregaDias: z.number().int().min(0).max(365).describe('Prazo de entrega em dias (0 a 365).').optional(),
      condicaoPagamento: z.string().max(120).describe('Condição de pagamento (ex.: "28 dias", "à vista").').optional(),
      frete: z.number().min(0).describe('Frete da proposta em reais. Padrão 0.').optional(),
      desconto: z.number().min(0).describe('Desconto total da proposta em reais (não percentual). Padrão 0.').optional(),
      validade: dia('Validade da proposta (AAAA-MM-DD).').optional(),
      observacao: z.string().max(300).describe('Observação da proposta (até 300 caracteres).').optional(),
      precos: z
        .array(
          z.object({
            itemId: uuid('Id do item da cotação (campo `itens[].id` de `buscar_cotacao`).'),
            precoUnitario: z.number().min(0).nullable().describe('Preço unitário em reais, na unidade do item. Envie null para apagar o preço deste fornecedor para o item.'),
          }),
        )
        .max(100)
        .describe('Preços por item (até 100). Envie lista vazia para mudar só as condições.'),
    }),
    handler: async ({ id, cotacaoFornecedorId, ...corpo }, api) => ({ success: true, data: await api.put(`/sup/cotacoes/${id}/respostas/${cotacaoFornecedorId}`, corpo) }),
  }),

  ferramenta({
    name: 'registrar_vencedores_cotacao',
    description:
      'Escolhe o fornecedor vencedor de cada item de uma cotação aberta. Com `menorPreco: true`, aplica o menor preço em todos os itens (e ignora `itens`). Senão, envie em `itens` a escolha de cada item; só os itens enviados mudam. Escolher um fornecedor que não cotou o item dá erro, e escolher um que não é o de menor preço exige `justificativa` no item. Não gera pedido: depois use `concluir_cotacao`. Devolve o mapa atualizado.',
    inputSchema: z.object({
      id: uuid('Id da cotação (de `listar_cotacoes`).'),
      menorPreco: z.boolean().describe('true = escolher o fornecedor de menor preço em todos os itens.').optional(),
      itens: z
        .array(
          z.object({
            itemId: uuid('Id do item da cotação (campo `itens[].id` de `buscar_cotacao`).'),
            vencedorId: uuid('Id do fornecedor dentro da cotação (campo `fornecedores[].id` de `buscar_cotacao`).').nullable().describe('Fornecedor vencedor do item: `fornecedores[].id` de `buscar_cotacao`. Envie null para tirar a escolha.'),
            justificativa: z.string().max(300).describe('Por que não comprar pelo menor preço. Obrigatória quando o vencedor não é o mais barato.').optional(),
          }),
        )
        .max(100)
        .describe('Escolha por item (até 100). Ignorado quando `menorPreco` é true.')
        .optional(),
      justificativa: z.string().max(1000).describe('Justificativa geral da cotação (até 1000 caracteres). Se omitida, mantém a atual.').optional(),
    }),
    handler: async ({ id, ...corpo }, api) => ({ success: true, data: await api.put(`/sup/cotacoes/${id}/vencedores`, corpo) }),
  }),

  ferramenta({
    name: 'concluir_cotacao',
    description:
      'Conclui uma cotação aberta com os vencedores já escolhidos (`registrar_vencedores_cotacao`); exige ao menos um item com vencedor. Em cotação de material, gera um pedido de compra em rascunho para cada fornecedor vencedor; em cotação de serviço, gera um contrato em rascunho por fornecedor. A solicitação passa a "atendida" e os itens sem vencedor voltam a ficar pendentes para nova compra. Não dá para desfazer a conclusão. Devolve `pedidos` e `contratos` criados (id e número) e o mapa final.',
    inputSchema: z.object({ id: uuid('Id da cotação (de `listar_cotacoes`).') }),
    handler: async (args, api) => ({ success: true, data: await api.post(`/sup/cotacoes/${args.id}/concluir`) }),
  }),

  ferramenta({
    name: 'cancelar_cotacao',
    description:
      'Cancela uma cotação com status "aberta". A solicitação de origem volta para "finalizada" (pronta para nova cotação) se não houver outra cotação aberta para ela. Cotação concluída ou já cancelada dá erro. Devolve o mapa de cotação.',
    inputSchema: z.object({ id: uuid('Id da cotação (de `listar_cotacoes`).') }),
    handler: async (args, api) => ({ success: true, data: await api.post(`/sup/cotacoes/${args.id}/cancelar`) }),
  }),

  // ============================================================== Pedidos de compra

  ferramenta({
    name: 'listar_pedidos_compra',
    description:
      'Lista os pedidos de compra: id, número, data, status, fornecedor, total em reais, previsão de entrega, se está atrasado e há quantos dias, número da cotação, quem aprovou, resumo dos itens e quantidade de notas ligadas. Sem `status`, devolve todos menos os cancelados (recebidos e encerrados só dos últimos 180 dias); máximo 500. Status possíveis de um pedido: rascunho, aguardando_aprovacao, aprovado, reprovado, enviado, parcial, recebido, encerrado, cancelado. O perfil almoxarife só vê pedidos já aprovados das obras dele.',
    inputSchema: z.object({
      status: z
        .enum(['abertos', 'aprovacao', 'receber', 'atrasados', 'concluidos', 'cancelados'])
        .describe(
          'Grupo de situação: abertos (rascunho até parcial, mais reprovados), aprovacao (aguardando aprovação), receber (aprovado, enviado ou parcial), atrasados (a receber com previsão vencida), concluidos (recebido ou encerrado), cancelados (cancelado ou reprovado).',
        )
        .optional(),
    }),
    handler: async (args, api) => ({ success: true, data: await api.get('/sup/pedidos', { status: args.status }) }),
  }),

  ferramenta({
    name: 'buscar_pedido_compra',
    description:
      'Detalha um pedido de compra: fornecedor, cotação e solicitação de origem, obra de entrega, condição de pagamento, frete, subtotal e total em reais, dados da aprovação, `itens` (id, descrição, unidade, quantidade, preço unitário, total, recebido, saldo, diferença de preço e de quantidade em relação à nota), `notas` fiscais ligadas, `podeAprovar` (se o usuário tem alçada) e `regrasAprovacao`. O id vem de `listar_pedidos_compra`.',
    inputSchema: z.object({ id: uuid('Id do pedido (de `listar_pedidos_compra`).') }),
    handler: async (args, api) => ({ success: true, data: await api.get(`/sup/pedidos/${args.id}`) }),
  }),

  ferramenta({
    name: 'atualizar_pedido_compra',
    description:
      'Altera o cabeçalho de um pedido de compra em rascunho ou reprovado (o pedido volta para rascunho). Os pedidos nascem de `concluir_cotacao` e os itens não são editáveis aqui. É parcial: o que não for enviado continua como está (a ferramenta lê o pedido atual e completa o resto). Para limpar um campo, envie string vazia. O fornecedor de pedido vindo de cotação não muda (409): refaça a escolha na cotação. Devolve o pedido atualizado.',
    inputSchema: z.object({
      id: uuid('Id do pedido (de `listar_pedidos_compra`).'),
      fornecedorId: uuid('Id do fornecedor do pedido (de `listar_fornecedores`). Omita para manter o atual; pedido de cotação não troca de fornecedor.').optional(),
      data: dia('Data do pedido (AAAA-MM-DD). Se omitida, mantém a atual.').optional(),
      previsaoEntrega: dia('Previsão de entrega (AAAA-MM-DD).').optional(),
      condicaoPagamento: z.string().max(120).describe('Condição de pagamento (até 120 caracteres).').optional(),
      localEntrega: z.string().max(200).describe('Local de entrega (até 200 caracteres).').optional(),
      frete: z.number().min(0).describe('Valor do frete em reais; entra no total do pedido. Padrão 0.').optional(),
      freteTipo: z.enum(['transportadora', 'proprio']).describe('`transportadora` exige `transportadoraId`; `proprio` é transporte próprio. Omita para "sem frete".').optional(),
      transportadoraId: uuid('Id do fornecedor de transporte (de `listar_fornecedores`). Só é gravado quando `freteTipo` é `transportadora`.').optional(),
      centroCustoId: uuid('Id do centro de custo (módulo Financeiro).').optional(),
      observacao: z.string().max(1000).describe('Observação do pedido (até 1000 caracteres).').optional(),
    }),
    // A API exige o cabeçalho inteiro no PUT (D7): completa com o que já está gravado o que não veio.
    handler: async ({ id, ...corpo }, api) => {
      const p = ((await api.get(`/sup/pedidos/${id}`)) as { pedido: Record<string, any> }).pedido;
      const v = corpo as Record<string, unknown>;
      const ou = (campo: string, atual: unknown) => (v[campo] === undefined ? atual : v[campo] === '' ? null : v[campo]);
      const completo = {
        fornecedorId: ou('fornecedorId', p.fornecedorId), data: ou('data', p.data), previsaoEntrega: ou('previsaoEntrega', p.previsaoEntrega),
        condicaoPagamento: ou('condicaoPagamento', p.condicaoPagamento), localEntrega: ou('localEntrega', p.localEntrega), frete: ou('frete', p.frete ?? 0),
        freteTipo: ou('freteTipo', p.freteTipo ?? null), transportadoraId: ou('transportadoraId', p.transportadora?.id ?? null),
        centroCustoId: ou('centroCustoId', p.centroCustoId ?? null), observacao: ou('observacao', p.observacao ?? null),
      };
      return { success: true, data: await api.put(`/sup/pedidos/${id}`, completo) };
    },
  }),

  ferramenta({
    name: 'enviar_pedido_compra_para_aprovacao',
    description:
      'Envia para aprovação um pedido de compra em rascunho ou reprovado. Se o valor estiver dentro do limite de dispensa da empresa, o pedido já sai "aprovado" (aprovação automática); senão fica "aguardando_aprovacao" e entra em `listar_aprovacoes_pendentes`. Dá erro se o pedido não tem itens ou já foi enviado. Devolve o pedido.',
    inputSchema: z.object({ id: uuid('Id do pedido (de `listar_pedidos_compra`).') }),
    handler: async (args, api) => ({ success: true, data: await api.post(`/sup/pedidos/${args.id}/enviar-aprovacao`) }),
  }),

  ferramenta({
    name: 'aprovar_pedido_compra',
    description:
      'Aprova um pedido de compra que está "aguardando_aprovacao". Só quem tem alçada aprova (o dono sempre; administradores até o limite configurado): sem alçada a API responde 403. O campo `podeAprovar` de `buscar_pedido_compra` e de `listar_aprovacoes_pendentes` diz se o usuário pode. Devolve o pedido aprovado.',
    inputSchema: z.object({ id: uuid('Id do pedido (de `listar_aprovacoes_pendentes` ou `listar_pedidos_compra`).') }),
    handler: async (args, api) => ({ success: true, data: await api.post(`/sup/pedidos/${args.id}/aprovar`) }),
  }),

ferramenta({
    name: 'reprovar_pedido_compra',
    description:
      'Reprova um pedido de compra que está "aguardando_aprovacao", com o motivo. Só quem tem alçada reprova (403 caso contrário). Reprovado, volta para quem lançou corrigir e reenviar. Devolve o registro atualizado.',
    inputSchema: z.object({ id: uuid('Id do pedido (de `listar_aprovacoes_pendentes` ou `listar_pedidos_compra`).'), motivo: z.string().min(3).max(500).describe('Motivo, que fica registrado e aparece para quem lançou.') }),
    handler: async ({ id, motivo }, api) => ({ success: true, data: await api.post(`/sup/pedidos/${id}/reprovar`, { motivo }) }),
  }),

  ferramenta({
    name: 'encerrar_pedido_compra',
    description:
      'Encerra um pedido aprovado, enviado ou recebido em parte, quando o saldo não vai mais ser entregue. Exige o motivo. Sem isso, um pedido recebido em parte fica aberto para sempre. Devolve o pedido encerrado.',
    inputSchema: z.object({ id: uuid('Id do pedido (de `listar_pedidos_compra`).'), motivo: z.string().min(3).max(500).describe('Por que o saldo não será entregue.') }),
    handler: async ({ id, motivo }, api) => ({ success: true, data: await api.post(`/sup/pedidos/${id}/encerrar`, { motivo }) }),
  }),

  ferramenta({
    name: 'registrar_envio_pedido_compra',
    description:
      'Marca um pedido de compra aprovado como enviado ao fornecedor (status "enviado", com a data e hora do envio). Só vale para pedido com status "aprovado". Não envia e-mail nem mensagem: apenas registra. Devolve o pedido.',
    inputSchema: z.object({ id: uuid('Id do pedido (de `listar_pedidos_compra`).') }),
    handler: async (args, api) => ({ success: true, data: await api.post(`/sup/pedidos/${args.id}/enviado`) }),
  }),

  ferramenta({
    name: 'cancelar_pedido_compra',
    description:
      'Cancela um pedido de compra que ainda não recebeu nada. Dá erro se o pedido está parcial, recebido, encerrado ou já cancelado, ou se há nota fiscal ligada a ele. Os insumos voltam a ficar pendentes de compra e, se não restar outro pedido ativo, a solicitação volta para "finalizada" (pronta para nova cotação). Pode ser desfeito com `reabrir_pedido_compra`. Devolve o pedido.',
    inputSchema: z.object({
      id: uuid('Id do pedido (de `listar_pedidos_compra`).'),
      motivo: z.string().max(500).describe('Motivo do cancelamento (até 500 caracteres).').optional(),
    }),
    handler: async (args, api) => ({ success: true, data: await api.post(`/sup/pedidos/${args.id}/cancelar`, { motivo: args.motivo }) }),
  }),

  ferramenta({
    name: 'reabrir_pedido_compra',
    description:
      'Reabre um pedido de compra cancelado, que volta para "rascunho". Dá erro se há nota fiscal ligada ao pedido, se a solicitação dele está sendo cotada de novo ou se ela já tem outro pedido ativo. Devolve o pedido.',
    inputSchema: z.object({ id: uuid('Id do pedido cancelado (de `listar_pedidos_compra` com status cancelados).') }),
    handler: async (args, api) => ({ success: true, data: await api.post(`/sup/pedidos/${args.id}/reabrir`) }),
  }),

  ferramenta({
    name: 'listar_notas_candidatas_pedido',
    description:
      'Lista as notas fiscais de entrada que podem ser usadas para receber um pedido de compra: até 30 notas do mesmo fornecedor, não canceladas, ainda sem pedido (ou já ligadas a este), emitidas a partir de 30 dias antes da data do pedido. Cada nota traz número, emissão, total em reais, `ligada` e `itens` (id, descrição, unidade, quantidade, valor) com a sugestão de `pedidoItemId` e `quantidadePedido`. Use antes de `registrar_recebimento_pedido`.',
    inputSchema: z.object({ id: uuid('Id do pedido (de `listar_pedidos_compra`).') }),
    handler: async (args, api) => ({ success: true, data: await api.get(`/sup/pedidos/${args.id}/notas-candidatas`) }),
  }),

  ferramenta({
    name: 'registrar_recebimento_pedido',
    description:
      'Registra o recebimento de um pedido de compra ligando uma nota fiscal de entrada a ele, item a item. O pedido precisa estar aprovado, enviado, parcial ou recebido; a nota precisa ser do mesmo fornecedor e não estar ligada a outro pedido. Para cada item da nota, informe o item do pedido e a quantidade recebida na unidade do pedido (ou `pedidoItemId: null` para não ligar); ao menos um item precisa ser ligado. O status do pedido é recalculado (parcial ou recebido). Devolve o pedido.',
    inputSchema: z.object({
      id: uuid('Id do pedido (de `listar_pedidos_compra`).'),
      notaId: uuid('Id da nota fiscal de entrada (de `listar_notas_candidatas_pedido`).'),
      itens: z
        .array(
          z.object({
            notaItemId: uuid('Id do item da nota (campo `itens[].id` da nota em `listar_notas_candidatas_pedido`).'),
            pedidoItemId: uuid('Id do item do pedido (campo `itens[].id` de `buscar_pedido_compra`).').nullable().describe('Item do pedido que este item da nota atende (`itens[].id` de `buscar_pedido_compra`). Envie null para deixar o item da nota sem ligação.'),
            quantidade: z.number().positive().nullable().describe('Quantidade recebida na unidade do pedido. Obrigatória quando `pedidoItemId` é informado; null quando não liga.'),
          }),
        )
        .max(300)
        .describe('Ligação de cada item da nota com o pedido (até 300).'),
    }),
    handler: async ({ id, ...corpo }, api) => ({ success: true, data: await api.put(`/sup/pedidos/${id}/recebimento`, corpo) }),
  }),

  ferramenta({
    name: 'relatorio_compras',
    description:
      'Relatório de compras do período (padrão: últimos 90 dias; no máximo 13 meses). Devolve `resumo` (pedidos, total comprado, pedidos em aberto, saldo a receber, atrasados, economia das cotações, divergências, solicitações pendentes), `porFornecedor`, `porItem` (quantidade, valor, preço médio, menor e maior), `emAberto` (pedidos a receber, de qualquer data), `economia` (por cotação concluída), `divergencias` (preço da nota diferente do pedido) e `pendentes` (solicitações ainda não atendidas). Valores em reais. Só contam pedidos aprovados em diante.',
    inputSchema: z.object({
      de: dia('Início do período (AAAA-MM-DD). Padrão: 90 dias atrás.').optional(),
      ate: dia('Fim do período (AAAA-MM-DD). Padrão: hoje.').optional(),
    }),
    handler: async (args, api) => ({ success: true, data: await api.get('/sup/relatorios', { de: args.de, ate: args.ate }) }),
  }),

  // ============================================================== Contratos com prestadores

  ferramenta({
    name: 'listar_contratos_fornecedor',
    description:
      'Lista os contratos com prestadores de serviço (empreiteiros): id, número, status, fornecedor, objeto, tipo (itens ou global), vigência, se está vencido, valor, medido, saldo e pago em reais, percentual medido, medições pendentes, medições aprovadas sem autorização de pagamento e caução a liberar. Sem `status`, devolve os em andamento (rascunho, aguardando_aprovacao, reprovado e vigente); máximo 300. O perfil engenheiro de obra só vê contratos do centro de custo das obras dele.',
    inputSchema: z.object({
      status: z.enum(['rascunho', 'aguardando_aprovacao', 'reprovado', 'vigente', 'encerrado', 'cancelado']).describe('Filtra por situação. Encerrados e cancelados só aparecem com o filtro.').optional(),
    }),
    handler: async (args, api) => ({ success: true, data: await api.get('/sup/contratos', { status: args.status }) }),
  }),

  ferramenta({
    name: 'buscar_contrato_fornecedor',
    description:
      'Detalha um contrato com prestador: fornecedor, objeto, tipo, vigência, categoria e centro de custo, prazo e forma de pagamento, `retencoes` (% de caução, ISS, INSS, IR e PIS/COFINS/CSLL), `itens` (id, descrição, unidade, quantidade, preço unitário, total, medido, pendente, saldo), `medicoes`, `autorizacoes` de pagamento e `resumo` em reais (valor do contrato, medido, saldo, autorizado, pago, impostos retidos, caução retida e a liberar). Traz também `podeAprovar`. O id vem de `listar_contratos_fornecedor`.',
    inputSchema: z.object({ id: uuid('Id do contrato (de `listar_contratos_fornecedor`).') }),
    handler: async (args, api) => ({ success: true, data: await api.get(`/sup/contratos/${args.id}`) }),
  }),

  ferramenta({
    name: 'criar_contrato_fornecedor',
    description:
      'Cria um contrato com prestador de serviço, em rascunho. Tipo `itens` exige a lista de serviços (descrição, unidade, quantidade, preço unitário); tipo `global` exige `valorGlobal`. Valores em reais, retenções em percentual. A categoria precisa ser de despesa e aceitar lançamento. Depois use `enviar_contrato_fornecedor_para_aprovacao`: só contrato vigente recebe medição. Devolve o contrato completo.',
    inputSchema: z.object(camposContrato),
    handler: async (args, api) => ({ success: true, data: await api.post('/sup/contratos', args) }),
  }),

  ferramenta({
    name: 'atualizar_contrato_fornecedor',
    description:
      'Altera um contrato em rascunho, reprovado (volta a rascunho) ou vigente (aditivo). Substitui o contrato inteiro: envie todos os campos e a lista completa de itens; o que for omitido é apagado ou volta ao padrão. Para manter um item existente, reenvie com o `id` dele (de `buscar_contrato_fornecedor`); item sem `id` é criado e os que ficarem fora da lista são removidos. Com medição lançada, prestador e tipo não mudam, item medido não sai nem fica abaixo do medido, e o valor global não fica abaixo do medido. Contrato aguardando aprovação, encerrado ou cancelado dá erro.',
    inputSchema: z.object({
      id: uuid('Id do contrato (de `listar_contratos_fornecedor`).'),
      ...camposContrato,
    }),
    handler: async ({ id, ...corpo }, api) => ({ success: true, data: await api.put(`/sup/contratos/${id}`, corpo) }),
  }),

  ferramenta({
    name: 'enviar_contrato_fornecedor_para_aprovacao',
    description:
      'Envia para aprovação um contrato em rascunho ou reprovado. Se o valor estiver dentro do limite de dispensa da empresa, o contrato já fica "vigente"; senão fica "aguardando_aprovacao" e entra em `listar_aprovacoes_pendentes`. Dá erro se o contrato não tem valor ou já foi enviado. Devolve o contrato.',
    inputSchema: z.object({ id: uuid('Id do contrato (de `listar_contratos_fornecedor`).') }),
    handler: async (args, api) => ({ success: true, data: await api.post(`/sup/contratos/${args.id}/enviar-aprovacao`) }),
  }),

  ferramenta({
    name: 'aprovar_contrato_fornecedor',
    description:
      'Aprova um contrato que está "aguardando_aprovacao"; ele passa a "vigente" e pode receber medições. Só quem tem alçada para o valor aprova (403 caso contrário); veja `podeAprovar` em `buscar_contrato_fornecedor` ou `listar_aprovacoes_pendentes`. Devolve o contrato.',
    inputSchema: z.object({ id: uuid('Id do contrato (de `listar_aprovacoes_pendentes` ou `listar_contratos_fornecedor`).') }),
    handler: async (args, api) => ({ success: true, data: await api.post(`/sup/contratos/${args.id}/aprovar`) }),
  }),

ferramenta({
    name: 'reprovar_contrato_fornecedor',
    description:
      'Reprova um contrato com prestador que está "aguardando_aprovacao", com o motivo. Só quem tem alçada reprova (403 caso contrário). Reprovado, volta para quem lançou corrigir e reenviar. Devolve o registro atualizado.',
    inputSchema: z.object({ id: uuid('Id do contrato (de `listar_aprovacoes_pendentes` ou `listar_contratos_fornecedor`).'), motivo: z.string().min(3).max(500).describe('Motivo, que fica registrado e aparece para quem lançou.') }),
    handler: async ({ id, motivo }, api) => ({ success: true, data: await api.post(`/sup/contratos/${id}/reprovar`, { motivo }) }),
  }),

  ferramenta({
    name: 'encerrar_contrato_fornecedor',
    description:
      'Encerra um contrato vigente (status "encerrado", com a data de hoje). Dá erro se houver medição em rascunho ou aguardando aprovação: conclua ou cancele antes. Só depois de encerrado a caução retida pode ser liberada, com `criar_autorizacao_pagamento` do tipo caucao. Devolve o contrato.',
    inputSchema: z.object({ id: uuid('Id do contrato (de `listar_contratos_fornecedor`).') }),
    handler: async (args, api) => ({ success: true, data: await api.post(`/sup/contratos/${args.id}/encerrar`) }),
  }),

  ferramenta({
    name: 'cancelar_contrato_fornecedor',
    description:
      'Cancela um contrato em rascunho, reprovado, aguardando aprovação ou vigente. Contrato que já tem medição (em rascunho, aguardando aprovação ou aprovada) não pode ser cancelado: use `encerrar_contrato_fornecedor`. Contrato encerrado ou já cancelado dá erro. Devolve o contrato.',
    inputSchema: z.object({ id: uuid('Id do contrato (de `listar_contratos_fornecedor`).') }),
    handler: async (args, api) => ({ success: true, data: await api.post(`/sup/contratos/${args.id}/cancelar`) }),
  }),

  // ============================================================== Medições de contrato

  ferramenta({
    name: 'listar_medicoes_contrato',
    description:
      'Lista as medições de contratos com prestadores: id, número, sequência dentro do contrato, período medido, data, valor em reais, status (rascunho, aguardando_aprovacao, aprovada, reprovada, cancelada), número e objeto do contrato, fornecedor e a autorização de pagamento ligada, se houver. Sem `status`, devolve todas menos as canceladas (aprovadas só dos últimos 180 dias); máximo 500.',
    inputSchema: z.object({
      status: z
        .enum(['aprovacao', 'autorizar', 'aprovadas', 'canceladas'])
        .describe('aprovacao: aguardando aprovação. autorizar: aprovadas ainda sem autorização de pagamento. aprovadas: todas as aprovadas. canceladas: canceladas ou reprovadas.')
        .optional(),
    }),
    handler: async (args, api) => ({ success: true, data: await api.get('/sup/medicoes', { status: args.status }) }),
  }),

  ferramenta({
    name: 'buscar_medicao_contrato',
    description:
      'Detalha uma medição: contrato (número, objeto, fornecedor, retenções), período, valor em reais, base (quantidades, percentual ou valor), `itens` do contrato com quantidade anterior, atual, acumulada e saldo, `descontos`, `totais` (contrato, anterior, atual, acumulado, saldo), `retencoesPrevistas` com o líquido a pagar, a autorização de pagamento ligada e `podeAprovar`. O id vem de `listar_medicoes_contrato` ou de `buscar_contrato_fornecedor`.',
    inputSchema: z.object({ id: uuid('Id da medição (de `listar_medicoes_contrato`).') }),
    handler: async (args, api) => ({ success: true, data: await api.get(`/sup/medicoes/${args.id}`) }),
  }),

  ferramenta({
    name: 'criar_medicao_contrato',
    description:
      'Lança uma medição (o que foi executado no período) num contrato vigente, em rascunho. Contrato por itens: informe `itens` com a quantidade executada de cada serviço OU `percentual`, aplicado sobre a quantidade contratada de cada item. Contrato global: informe `valor` em reais OU `percentual` do valor global. A medição não pode passar do saldo do contrato (faça um aditivo com `atualizar_contrato_fornecedor`) e precisa ter valor maior que zero. Depois use `enviar_medicao_contrato_para_aprovacao`. Devolve a medição completa.',
    inputSchema: z.object({
      contratoId: uuid('Id do contrato vigente (de `listar_contratos_fornecedor`).'),
      periodoInicio: dia('Início do período medido (AAAA-MM-DD).'),
      periodoFim: dia('Fim do período medido (AAAA-MM-DD); não pode ser antes do início.'),
      data: dia('Data da medição (AAAA-MM-DD). Padrão: hoje.').optional(),
      observacao: z.string().max(1000).describe('Observação da medição (até 1000 caracteres).').optional(),
      itens: z
        .array(
          z.object({
            contratoItemId: uuid('Id do item do contrato (campo `itens[].id` de `buscar_contrato_fornecedor`).'),
            quantidade: z.number().min(0).describe('Quantidade executada no período, na unidade do item; até o saldo do item.'),
          }),
        )
        .max(200)
        .describe('Só em contrato por itens, quando não usar `percentual`: quantidades executadas por item.')
        .optional(),
      valor: z.number().positive().describe('Só em contrato global: valor medido no período, em reais.').optional(),
      percentual: z.number().positive().describe('Percentual executado no período (ex.: 25 para 25%). Em contrato por itens vale para todos os itens e tem prioridade sobre `itens`; em contrato global só é usado se `valor` não for enviado.').optional(),
      descontos: z
        .array(
          z.object({
            descricao: z.string().min(1).max(120).describe('O que é o desconto (ex.: adiantamento, alimentação, EPI).'),
            valor: z.number().positive().describe('Valor do desconto em reais.'),
          }),
        )
        .max(50)
        .describe('Valores a deduzir do pagamento ao prestador (até 50). A soma não pode passar do valor da medição.')
        .optional(),
    }),
    handler: async (args, api) => ({ success: true, data: await api.post('/sup/medicoes', args) }),
  }),

  ferramenta({
    name: 'enviar_medicao_contrato_para_aprovacao',
    description:
      'Envia para aprovação uma medição em rascunho ou reprovada. Se o valor estiver dentro do limite de dispensa da empresa, a medição já fica "aprovada"; senão fica "aguardando_aprovacao" e entra em `listar_aprovacoes_pendentes`. Devolve a medição.',
    inputSchema: z.object({ id: uuid('Id da medição (de `listar_medicoes_contrato`).') }),
    handler: async (args, api) => ({ success: true, data: await api.post(`/sup/medicoes/${args.id}/enviar-aprovacao`) }),
  }),

  ferramenta({
    name: 'aprovar_medicao_contrato',
    description:
      'Aprova uma medição que está "aguardando_aprovacao". Só quem tem alçada para o valor aprova (403 caso contrário); veja `podeAprovar` em `buscar_medicao_contrato` ou `listar_aprovacoes_pendentes`. Aprovada, a medição pode receber autorização de pagamento (`criar_autorizacao_pagamento`). Devolve a medição.',
    inputSchema: z.object({ id: uuid('Id da medição (de `listar_aprovacoes_pendentes` ou `listar_medicoes_contrato`).') }),
    handler: async (args, api) => ({ success: true, data: await api.post(`/sup/medicoes/${args.id}/aprovar`) }),
  }),

ferramenta({
    name: 'reprovar_medicao_contrato',
    description:
      'Reprova uma medição de contrato que está "aguardando_aprovacao", com o motivo. Só quem tem alçada reprova (403 caso contrário). Reprovado, volta para quem lançou corrigir e reenviar. Devolve o registro atualizado.',
    inputSchema: z.object({ id: uuid('Id da medição (de `listar_aprovacoes_pendentes` ou `listar_medicoes_contrato`).'), motivo: z.string().min(3).max(500).describe('Motivo, que fica registrado e aparece para quem lançou.') }),
    handler: async ({ id, motivo }, api) => ({ success: true, data: await api.post(`/sup/medicoes/${id}/reprovar`, { motivo }) }),
  }),

  ferramenta({
    name: 'cancelar_medicao_contrato',
    description:
      'Cancela uma medição em qualquer status, exceto já cancelada; o que ela mediu volta ao saldo do contrato. Dá erro se houver autorização de pagamento aguardando aprovação ou aprovada para ela: cancele antes com `cancelar_autorizacao_pagamento`. Devolve a medição.',
    inputSchema: z.object({ id: uuid('Id da medição (de `listar_medicoes_contrato`).') }),
    handler: async (args, api) => ({ success: true, data: await api.post(`/sup/medicoes/${args.id}/cancelar`) }),
  }),

  // ============================================================== Autorizações de pagamento

  ferramenta({
    name: 'listar_autorizacoes_pagamento',
    description:
      'Lista as autorizações de pagamento de contratos: id, número, tipo (medicao ou caucao), data, vencimento, valor bruto e líquido em reais, status (aguardando_aprovacao, aprovada, reprovada, cancelada), contrato, fornecedor, sequência da medição e se já foi paga. Sem `status`, devolve todas menos as canceladas (aprovadas só dos últimos 180 dias); máximo 500.',
    inputSchema: z.object({
      status: z.enum(['aprovacao', 'aprovadas', 'canceladas']).describe('aprovacao: aguardando aprovação. aprovadas: aprovadas. canceladas: canceladas ou reprovadas.').optional(),
    }),
    handler: async (args, api) => ({ success: true, data: await api.get('/sup/autorizacoes', { status: args.status }) }),
  }),

  ferramenta({
    name: 'buscar_autorizacao_pagamento',
    description:
      'Detalha uma autorização de pagamento: contrato e medição de origem, vencimento, valor bruto, retenções em reais (caução, ISS, INSS, IR, PIS/COFINS/CSLL), descontos, líquido, documento, forma de pagamento, dados da aprovação, as `parcelas` da conta a pagar do prestador e as dos impostos retidos (com status de pagamento), `pago` e `podeAprovar`. O id vem de `listar_autorizacoes_pagamento`.',
    inputSchema: z.object({ id: uuid('Id da autorização (de `listar_autorizacoes_pagamento`).') }),
    handler: async (args, api) => ({ success: true, data: await api.get(`/sup/autorizacoes/${args.id}`) }),
  }),

  ferramenta({
    name: 'criar_autorizacao_pagamento',
    description:
      'Cria uma autorização de pagamento. Tipo `medicao` (padrão): exige `medicaoId` de uma medição aprovada que ainda não tenha autorização; o líquido é o valor da medição menos as retenções do contrato e os descontos da medição. Tipo `caucao`: exige `contratoId` de um contrato encerrado com caução retida a liberar. Já nasce "aguardando_aprovacao" (ou aprovada, se o valor estiver na dispensa); ao ser aprovada, gera a conta a pagar do prestador e a dos impostos retidos no Financeiro. Devolve a autorização completa.',
    inputSchema: z.object({
      tipo: z.enum(['medicao', 'caucao']).describe('`medicao`: pagar uma medição aprovada (padrão). `caucao`: liberar a caução retida de um contrato encerrado.').optional(),
      medicaoId: uuid('Id da medição aprovada (de `listar_medicoes_contrato` com status autorizar). Obrigatório no tipo medicao.').optional(),
      contratoId: uuid('Id do contrato encerrado (de `listar_contratos_fornecedor` com status encerrado). Obrigatório no tipo caucao.').optional(),
      vencimento: dia('Vencimento do pagamento (AAAA-MM-DD). Padrão: hoje mais o prazo de pagamento do contrato.').optional(),
      documento: z.string().max(80).describe('Número da nota de serviço ou outro documento (até 80 caracteres).').optional(),
      formaPagamento: z.enum(FORMAS_PAGAMENTO).describe('Forma de pagamento. Padrão: a do contrato.').optional(),
      observacao: z.string().max(500).describe('Observação (até 500 caracteres).').optional(),
      retencoes: z
        .object({
          caucao: z.number().min(0).describe('Caução retida, em reais.'),
          iss: z.number().min(0).describe('ISS retido, em reais.'),
          inss: z.number().min(0).describe('INSS retido, em reais.'),
          ir: z.number().min(0).describe('IR retido, em reais.'),
          pcc: z.number().min(0).describe('PIS/COFINS/CSLL retidos, em reais.'),
        })
        .describe('Só no tipo medicao: ajuste manual das retenções em REAIS (não em %), quando a nota de serviço trouxer valores diferentes do cálculo pelo contrato. Se enviar, informe os cinco campos; se omitir, vale o percentual do contrato.')
        .optional(),
    }),
    handler: async (args, api) => ({ success: true, data: await api.post('/sup/autorizacoes', args) }),
  }),

  ferramenta({
    name: 'aprovar_autorizacao_pagamento',
    description:
      'Aprova uma autorização de pagamento que está "aguardando_aprovacao" e gera no Financeiro a conta a pagar do prestador (valor líquido, no vencimento da autorização) e, se houver, a dos impostos retidos. Só quem tem alçada para o valor bruto aprova (403 caso contrário); veja `podeAprovar` em `buscar_autorizacao_pagamento` ou `listar_aprovacoes_pendentes`. Devolve a autorização.',
    inputSchema: z.object({ id: uuid('Id da autorização (de `listar_aprovacoes_pendentes` ou `listar_autorizacoes_pagamento`).') }),
    handler: async (args, api) => ({ success: true, data: await api.post(`/sup/autorizacoes/${args.id}/aprovar`) }),
  }),

ferramenta({
    name: 'reprovar_autorizacao_pagamento',
    description:
      'Reprova uma autorização de pagamento que está "aguardando_aprovacao", com o motivo. Só quem tem alçada reprova (403 caso contrário). Reprovado, volta para quem lançou corrigir e reenviar. Devolve o registro atualizado.',
    inputSchema: z.object({ id: uuid('Id da autorização (de `listar_aprovacoes_pendentes` ou `listar_autorizacoes_pagamento`).'), motivo: z.string().min(3).max(500).describe('Motivo, que fica registrado e aparece para quem lançou.') }),
    handler: async ({ id, motivo }, api) => ({ success: true, data: await api.post(`/sup/autorizacoes/${id}/reprovar`, { motivo }) }),
  }),

  ferramenta({
    name: 'cancelar_autorizacao_pagamento',
    description:
      'Cancela uma autorização de pagamento aguardando aprovação ou aprovada. Se já estava aprovada, cancela também as contas a pagar que ela gerou; dá erro se alguma parcela já foi paga (estorne o pagamento no Financeiro antes). Autorização já cancelada ou reprovada dá erro. Devolve a autorização.',
    inputSchema: z.object({ id: uuid('Id da autorização (de `listar_autorizacoes_pagamento`).') }),
    handler: async (args, api) => ({ success: true, data: await api.post(`/sup/autorizacoes/${args.id}/cancelar`) }),
  }),

  ferramenta({
    name: 'relatorio_contratos_fornecedor',
    description:
      'Relatório de contratos com prestadores no período (padrão: últimos 90 dias). Devolve `posicao` (cada contrato não cancelado: valor, medido, percentual, saldo, pago, caução retida e impostos, em reais), `saldos` (cada item contratado com quantidade e valor contratado, medido e saldo), `medicoes` com fim de período dentro do intervalo e `pagamentos` (autorizações aguardando aprovação ou aprovadas, com bruto, retenções e líquido).',
    inputSchema: z.object({
      de: dia('Início do período (AAAA-MM-DD). Padrão: 90 dias atrás.').optional(),
      ate: dia('Fim do período (AAAA-MM-DD). Padrão: hoje.').optional(),
    }),
    handler: async (args, api) => ({ success: true, data: await api.get('/sup/relatorios/contratos', { de: args.de, ate: args.ate }) }),
  }),

  // ============================================================== Aprovações

  ferramenta({
    name: 'listar_aprovacoes_pendentes',
    description:
      'Fila única do que aguarda aprovação na empresa, do mais antigo para o mais novo: `itens` com tipo (pedido, contrato, medicao, autorizacao ou venda), id, número, título, pessoa (fornecedor ou cliente), resumo, valor em reais, quando foi enviado, quem criou e `podeAprovar` (se o usuário tem alçada). Devolve também `regras` (limites de alçada e de dispensa, em reais, e o texto da regra). Para decidir, use `aprovar_pedido_compra`, `aprovar_contrato_fornecedor`, `aprovar_medicao_contrato` ou `aprovar_autorizacao_pagamento` com o `id` do item; itens do tipo venda são do módulo Comercial.',
    inputSchema: z.object({}),
    handler: async (_args, api) => ({ success: true, data: await api.get('/ger/aprovacoes') }),
  }),

  // ============================================================== Patrimônio e permutas (só leitura)

  ferramenta({
    name: 'listar_patrimonio',
    description:
      'Lista os bens do patrimônio da construtora (ferramentas e equipamentos próprios): id, código (PAT-0001), nome, marca, série, data e valor de aquisição, valor residual, vida útil em meses, status (disponivel, em_uso, manutencao, baixado), obra e responsável quando em uso, e a depreciação linear (mensal, acumulada e valor contábil, em reais). Não tem filtros.',
    inputSchema: z.object({}),
    handler: async (_args, api) => ({ success: true, data: await api.get('/sup/patrimonio') }),
  }),

  ferramenta({
    name: 'buscar_bem_patrimonio',
    description:
      'Detalha um bem do patrimônio (mesmos campos de `listar_patrimonio`) e devolve os últimos 100 `movimentos` dele: retiradas e devoluções, com data, obra, responsável, estado na devolução, observação e quem registrou. O id vem de `listar_patrimonio`.',
    inputSchema: z.object({ id: uuid('Id do bem (de `listar_patrimonio`).') }),
    handler: async (args, api) => ({ success: true, data: await api.get(`/sup/patrimonio/${args.id}`) }),
  }),

  ferramenta({
    name: 'listar_permutas',
    description:
      'Lista as permutas por material (o fornecedor entrega material e a construtora paga com serviços): id, número, data, status (aberta, compensada, cancelada), se a nota fiscal já foi emitida, código da obra, fornecedor e os totais de material e de serviço em reais. Máximo 300, das mais novas para as mais antigas. Somente leitura: este servidor não cria nem altera permutas.',
    inputSchema: z.object({
      obraId: uuid('Id da obra (de `listar_obras`).').optional(),
    }),
    handler: async (args, api) => ({ success: true, data: await api.get('/sup/permutas', { obraId: args.obraId }) }),
  }),

  ferramenta({
    name: 'buscar_permuta',
    description:
      'Detalha uma permuta: obra, fornecedor, data, status, `itens` (lado material ou servico, descrição, unidade, quantidade, preço unitário e total em reais), `totais` (material, serviço, diferença e a torna: quem paga a diferença e quanto) e `pendencias` (como a nota fiscal ainda não emitida). O id vem de `listar_permutas`.',
    inputSchema: z.object({ id: uuid('Id da permuta (de `listar_permutas`).') }),
    handler: async (args, api) => ({ success: true, data: await api.get(`/sup/permutas/${args.id}`) }),
  }),
);
