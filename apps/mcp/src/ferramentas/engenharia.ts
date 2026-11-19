import { z } from 'zod';
import { colecao, ferramenta } from './tipos.ts';

// Módulo Engenharia (/api/eng): obras, tabelas de referência, insumos e serviços da obra, planilha orçamentária (EAP + orçamento),
// planejamento, acompanhamento físico, RDO e visitas. O MCP não exclui registros principais nem envia arquivos.

const id = (descricao: string) => z.string().uuid().describe(descricao);
const data = (descricao: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe(descricao);
const obraId = () => id('Id da obra (vem de listar_obras).');

const NIVEIS = ['obra', 'etapa', 'subetapa', 'tarefa'] as const;
const STATUS_OBRA = ['orcamento', 'planejamento', 'em_andamento', 'suspensa', 'concluida'] as const;
const GRANULARIDADES = ['dia', 'semana', 'quinzena', 'mes'] as const;
const CLIMAS = ['bom', 'nublado', 'chuva', 'impraticavel'] as const;
const OCORRENCIAS = ['falta_material', 'falta_mao_obra', 'clima', 'acidente', 'paralisacao', 'visita', 'outra'] as const;

const percentualBdi = (descricao: string) => z.number().min(0).max(99.99).optional().describe(descricao);
const parametrosBdi = z
  .object({
    ac: percentualBdi('Administração central, em %.'),
    s: percentualBdi('Seguros, em %.'),
    r: percentualBdi('Riscos, em %.'),
    g: percentualBdi('Garantias, em %.'),
    df: percentualBdi('Despesas financeiras, em %.'),
    l: percentualBdi('Lucro, em %.'),
    i: percentualBdi('Impostos, em %.'),
  })
  .optional()
  .describe('Parâmetros do BDI calculado pela fórmula do TCU: BDI = [(1+AC+S+R+G) x (1+DF) x (1+L)] / (1-I) - 1. Só valem com bdiModo "calculado"; os informados são mesclados aos já salvos.');

const unidadesCompra = z
  .array(
    z.object({
      unidade: z.string().min(1).max(20).describe('Unidade em que o insumo é comprado (ex.: "saco", "m3").'),
      fator: z.number().describe('Quantas unidades base cabem em uma unidade de compra (ex.: saco de 50 kg com unidade base kg = 50).'),
    }),
  )
  .max(10);

const granularidade = z.enum(GRANULARIDADES).optional().describe('Tamanho dos períodos: dia, semana, quinzena ou mes. Sem informar, a API usa semana.');

export const ferramentasEngenharia = colecao(
  // ------------------------------------------------------------------ obras
  ferramenta({
    name: 'listar_obras',
    description:
      'Lista as obras ativas da construtora (as arquivadas ficam de fora). Devolve { obras: [...] } com id, codigo, nome, status (orcamento, planejamento, em_andamento, suspensa, concluida), endereço, dataInicio e dataPrevisao (AAAA-MM-DD), bdiPercentual, quantidade de linhas do orçamento e total orçado em reais (com BDI). Engenheiro de obra, mestre de obra e almoxarife só recebem as obras atribuídas a eles. O id devolvido aqui é o obraId das demais ferramentas de engenharia.',
    inputSchema: z.object({
      tipo: z
        .enum(['execucao', 'acompanhamento'])
        .optional()
        .describe('execucao (padrão): obras com EAP, orçamento, planejamento e estoque. acompanhamento: obras que a construtora só acompanha por visitas.'),
    }),
    handler: async (args, api) => ({ success: true, data: await api.get('/eng/obras', { tipo: args.tipo }) }),
  }),
  ferramenta({
    name: 'resumo_panorama_obras',
    description:
      'Panorama de todas as obras ativas da construtora, numa única chamada. Devolve { hoje, resumo: { obras, ativas, emAndamento, orcadoTotal, atrasadas, necessidadesPendentes }, obras: [...] }; cada obra traz status, dataInicio, dataPrevisao, orcado (reais, com BDI), quantidade de atividades, fimPlanejado (fim da última atividade do planejamento), atrasada (previsão já passou e a obra não foi concluída), estourandoPrazo (planejamento termina depois da previsão) e necessidades de insumo pendentes (quantidade e valor em reais). Use para perguntas como "quais obras estão atrasadas" ou "quanto temos orçado no total".',
    inputSchema: z.object({}),
    handler: async (_args, api) => ({ success: true, data: await api.get('/eng/panorama') }),
  }),
  ferramenta({
    name: 'buscar_obra',
    description:
      'Devolve o cadastro completo de uma obra: { obra: { id, tipo, codigo, nome, endereco, cidade, uf, responsavel, contato e referência de entrega, status, dataInicio, dataPrevisao, nivelApropriacao, bdiModo, bdiPercentual, bdiParametros, horasDia, empresaGrupoId/Nome, centroCustoId/Nome, responsaveis: [{ id, nome }] } }. O obraId vem de listar_obras. Não traz orçamento nem planejamento: para isso use listar_planilha_orcamentaria e listar_atividades_planejamento.',
    inputSchema: z.object({ obraId: obraId() }),
    handler: async (args, api) => ({ success: true, data: await api.get(`/eng/obras/${args.obraId}`) }),
  }),
  ferramenta({
    name: 'listar_engenheiros_obra',
    description:
      'Lista os usuários que podem ser responsáveis por obras: perfis engenheiro de obra, mestre de obra e almoxarife. Devolve { engenheiros: [{ id, nome, email, ativo, perfil }] }. Os ids servem para o campo responsaveis de criar_obra e atualizar_obra. Restrita a dono, gestor e orçamentista.',
    inputSchema: z.object({}),
    handler: async (_args, api) => ({ success: true, data: await api.get('/eng/engenheiros') }),
  }),
  ferramenta({
    name: 'criar_obra',
    description:
      'Cria uma obra e, junto com ela, o centro de custo "Obra CODIGO - nome". Só o nome é obrigatório: sem codigo a API gera o próximo "OB-0001"; sem status fica "planejamento"; sem nivelApropriacao fica "etapa". Devolve { obra } com o cadastro completo (mesmo formato de buscar_obra). Erros: 409 se o código já existir e 403 se o contrato da construtora atingiu o limite de obras ativas. Restrita a dono, gestor e orçamentista.',
    inputSchema: z.object({
      nome: z.string().min(2).max(160).describe('Nome da obra.'),
      codigo: z.string().max(20).optional().describe('Código da obra, único na construtora. Sem informar, a API gera OB-0001, OB-0002...'),
      tipo: z.enum(['execucao', 'acompanhamento']).optional().describe('execucao (padrão) ou acompanhamento (obra só visitada, sem EAP, orçamento nem estoque). Só pode ser escolhido na criação.'),
      eapPadrao: z.boolean().optional().describe('true: a planilha da obra já nasce com a EAP padrão de etapas. Só vale em obra de execução.'),
      status: z.enum(STATUS_OBRA).optional().describe('Situação da obra. Padrão: planejamento. Obra criada como "orcamento" nasce com o centro de custo inativo.'),
      endereco: z.string().max(200).optional().describe('Endereço da obra.'),
      cidade: z.string().max(80).optional().describe('Cidade.'),
      uf: z.string().regex(/^[A-Za-z]{2}$/).optional().describe('Sigla do estado, 2 letras (ex.: SC).'),
      responsavel: z.string().max(120).optional().describe('Nome do responsável técnico (texto livre).'),
      contatoObraNome: z.string().max(120).optional().describe('Nome do contato no canteiro, para entregas.'),
      contatoObraTelefone: z.string().max(30).optional().describe('Telefone do contato no canteiro.'),
      referenciaEntrega: z.string().max(200).optional().describe('Ponto de referência para entregas.'),
      dataInicio: data('Data de início da obra, AAAA-MM-DD.').optional(),
      dataPrevisao: data('Data prevista de término, AAAA-MM-DD.').optional(),
      nivelApropriacao: z.enum(NIVEIS).optional().describe('Nível da EAP em que os insumos são apropriados: obra, etapa, subetapa ou tarefa. Padrão: etapa.'),
      bdiModo: z.enum(['calculado', 'informado']).optional().describe('informado (padrão): vale bdiPercentual. calculado: o BDI sai de bdiParametros.'),
      bdiPercentual: z.number().min(0).max(99.99).optional().describe('BDI em % (ex.: 25 para 25%). Usado só com bdiModo "informado".'),
      bdiParametros: parametrosBdi,
      horasDia: z.number().min(1).max(24).optional().describe('Jornada da obra em horas por dia, usada para dimensionar equipes. Padrão: 8.'),
      empresaGrupoId: z.string().uuid().optional().describe('Id da empresa do grupo que executa a obra (define o regime de impostos). Sem informar, vale a própria construtora.'),
      responsaveis: z.array(z.string().uuid()).max(30).optional().describe('Ids dos usuários responsáveis pela obra (vêm de listar_engenheiros_obra). Só eles, além de dono, gestor e orçamentista, enxergam a obra.'),
    }),
    handler: async (args, api) => ({ success: true, data: await api.post('/eng/obras', args) }),
  }),
  ferramenta({
    name: 'atualizar_obra',
    description:
      'Altera o cadastro de uma obra. É parcial: envie só o que muda; campo ausente mantém o valor atual, e texto vazio ou data null limpam o campo. A lista responsaveis, quando enviada, substitui a anterior. Código e tipo da obra não mudam por aqui. Erro 409 ao trocar nivelApropriacao em obra que já tem necessidades de insumo ou atividades no planejamento. Atenção ao BDI: com bdiModo "calculado" o bdiPercentual enviado é ignorado, e quando a obra tem composição do preço (ver obter_composicao_preco) é o BDI dela que vale no orçamento. Devolve { obra } atualizada. Restrita a dono, gestor e orçamentista.',
    inputSchema: z.object({
      obraId: obraId(),
      nome: z.string().min(2).max(160).optional().describe('Novo nome da obra (também renomeia o centro de custo dela).'),
      status: z.enum(STATUS_OBRA).optional().describe('Nova situação: orcamento, planejamento, em_andamento, suspensa ou concluida.'),
      endereco: z.string().max(200).optional().describe('Endereço. Texto vazio limpa.'),
      cidade: z.string().max(80).optional().describe('Cidade. Texto vazio limpa.'),
      uf: z.string().regex(/^[A-Za-z]{2}$/).nullable().optional().describe('Sigla do estado, 2 letras. null limpa.'),
      responsavel: z.string().max(120).optional().describe('Nome do responsável técnico (texto livre). Texto vazio limpa.'),
      contatoObraNome: z.string().max(120).optional().describe('Nome do contato no canteiro. Texto vazio limpa.'),
      contatoObraTelefone: z.string().max(30).optional().describe('Telefone do contato no canteiro. Texto vazio limpa.'),
      referenciaEntrega: z.string().max(200).optional().describe('Ponto de referência para entregas. Texto vazio limpa.'),
      dataInicio: data('Data de início, AAAA-MM-DD. null limpa.').nullable().optional(),
      dataPrevisao: data('Data prevista de término, AAAA-MM-DD. null limpa.').nullable().optional(),
      nivelApropriacao: z.enum(NIVEIS).optional().describe('Nível da EAP em que os insumos são apropriados: obra, etapa, subetapa ou tarefa.'),
      bdiModo: z.enum(['calculado', 'informado']).optional().describe('informado: vale bdiPercentual. calculado: o BDI sai de bdiParametros.'),
      bdiPercentual: z.number().min(0).max(99.99).optional().describe('BDI em % (ex.: 25). Só é gravado com bdiModo "informado".'),
      bdiParametros: parametrosBdi,
      horasDia: z.number().min(1).max(24).optional().describe('Jornada da obra em horas por dia.'),
      empresaGrupoId: z.string().uuid().nullable().optional().describe('Id da empresa do grupo que executa a obra. null volta para a própria construtora.'),
      responsaveis: z.array(z.string().uuid()).max(30).optional().describe('Ids dos usuários responsáveis (de listar_engenheiros_obra). Substitui a lista inteira; lista vazia retira todos.'),
    }),
    handler: async ({ obraId, ...corpo }, api) => ({ success: true, data: await api.put(`/eng/obras/${obraId}`, corpo) }),
  }),

  // ------------------------------------------------------------------ tabelas de referência (SINAPI e próprias)
  ferramenta({
    name: 'listar_tabelas_referencia',
    description:
      'Lista as tabelas de referência de preços da construtora: SINAPI importadas e tabelas próprias. Devolve { tabelas: [{ id, fonte (sinapi | proprio), nome, uf, mesReferencia, desonerado, insumos, composicoes, editavel }] }, onde insumos e composicoes são as quantidades de itens. O id é o tabelaId de listar_itens_tabela_referencia e de adicionar_itens_tabela_na_obra.',
    inputSchema: z.object({}),
    handler: async (_args, api) => ({ success: true, data: await api.get('/eng/tabelas') }),
  }),
  ferramenta({
    name: 'listar_itens_tabela_referencia',
    description:
      'Busca insumos e composições (serviços) numa tabela de referência. Devolve { itens: [{ id, tipo (insumo | composicao), codigo, descricao, unidade, grupo, preco, componentes, unidadesCompra }] }: preco é o custo unitário em reais (na composição, a soma dos insumos x coeficiente) e componentes é a quantidade de insumos da composição. A API devolve no máximo 500 itens, ordenados por tipo e código: use sempre busca e tipo para afinar, porque uma tabela SINAPI tem milhares de itens. O tabelaId vem de listar_tabelas_referencia.',
    inputSchema: z.object({
      tabelaId: id('Id da tabela de referência (vem de listar_tabelas_referencia).'),
      tipo: z.enum(['insumo', 'composicao']).optional().describe('Filtra só insumos ou só composições (serviços). Sem informar, vêm os dois.'),
      busca: z.string().optional().describe('Texto procurado: começo do código ou qualquer trecho da descrição (ex.: "alvenaria", "8848").'),
    }),
    handler: async ({ tabelaId, ...consulta }, api) => ({ success: true, data: await api.get(`/eng/tabelas/${tabelaId}/itens`, consulta) }),
  }),
  ferramenta({
    name: 'buscar_item_tabela_referencia',
    description:
      'Detalha um item de uma tabela de referência. Devolve { item: { id, tipo, codigo, descricao, unidade, grupo, preco, precoOrigem, unidadesCompra }, componentes, estrutura }. Para composição, componentes lista os insumos já desdobrados (codigo, descricao, unidade, coeficiente, precoUnitario em reais) e estrutura lista os itens diretos da composição original, incluindo serviços auxiliares. Os ids vêm de listar_itens_tabela_referencia.',
    inputSchema: z.object({
      tabelaId: id('Id da tabela de referência (vem de listar_tabelas_referencia).'),
      itemId: id('Id do item da tabela (vem de listar_itens_tabela_referencia).'),
    }),
    handler: async (args, api) => ({ success: true, data: await api.get(`/eng/tabelas/${args.tabelaId}/itens/${args.itemId}`) }),
  }),

  // ------------------------------------------------------------------ insumos e serviços da obra
  ferramenta({
    name: 'listar_itens_obra',
    description:
      'Lista os insumos e serviços (composições) que já foram copiados para a obra; é deles que o orçamento e as necessidades de insumo se alimentam. Devolve { itens: [{ id, tipo, codigo, descricao, unidade, grupo, preco, precoReferencia, editado, origem, componentes, noOrcamento, unidadesCompra }] }, com preços em reais (custo, sem BDI); a API devolve no máximo 1000 itens. Com tipo "composicao" vem também linhas: os serviços lançados no orçamento com o nó da EAP de apropriação (eapNoId, eapCodigo, eapCaminho). O id do item é o itemId de adicionar_linha_planilha (serviço) e de registrar_necessidade_insumo (insumo).',
    inputSchema: z.object({
      obraId: obraId(),
      tipo: z.enum(['insumo', 'composicao']).optional().describe('Filtra só insumos ou só serviços (composições). Sem informar, vêm os dois.'),
      busca: z.string().optional().describe('Texto procurado: começo do código ou qualquer trecho da descrição.'),
    }),
    handler: async ({ obraId, ...consulta }, api) => ({ success: true, data: await api.get(`/eng/obras/${obraId}/itens`, consulta) }),
  }),
  ferramenta({
    name: 'buscar_item_obra',
    description:
      'Detalha um insumo ou serviço da obra. Devolve { item, componentes }: item no mesmo formato de listar_itens_obra e, para serviço, componentes com os insumos da composição (id, tipo, classe: insumo | equipamento | servico, codigo, descricao, unidade, coeficiente, precoUnitario em reais). Use para explicar como o custo unitário de um serviço é formado. O itemId vem de listar_itens_obra.',
    inputSchema: z.object({
      obraId: obraId(),
      itemId: id('Id do insumo ou serviço da obra (vem de listar_itens_obra).'),
    }),
    handler: async (args, api) => ({ success: true, data: await api.get(`/eng/obras/${args.obraId}/itens/${args.itemId}`) }),
  }),
  ferramenta({
    name: 'adicionar_itens_tabela_na_obra',
    description:
      'Copia composições (serviços) e insumos de uma tabela de referência para a obra. É o passo obrigatório antes de orçar: só serviço que está na obra pode entrar na planilha. Cada composição leva junto os insumos dela; item que já existe na obra (mesmo tipo e código) é preservado, sem sobrescrever preço editado. Devolve { importados: { insumos, composicoes }, jaExistiam }. Os ids dos itens vêm de listar_itens_tabela_referencia; depois, use listar_itens_obra para obter os ids dos itens já na obra.',
    inputSchema: z.object({
      obraId: obraId(),
      tabelaId: id('Id da tabela de referência de onde os itens saem (vem de listar_tabelas_referencia).'),
      composicaoIds: z.array(z.string().uuid()).optional().describe('Ids das composições (serviços) da tabela a copiar, com os insumos de cada uma.'),
      insumoIds: z.array(z.string().uuid()).optional().describe('Ids de insumos avulsos da tabela a copiar.'),
    }),
    handler: async ({ obraId, ...corpo }, api) => ({ success: true, data: await api.post(`/eng/obras/${obraId}/importar`, corpo) }),
  }),
  ferramenta({
    name: 'atualizar_item_obra',
    description:
      'Altera um insumo ou serviço dentro da obra, sem mexer na tabela de referência; o item fica marcado como editado. É parcial: envie só o que muda. O preço só é gravado em insumo: o custo do serviço é sempre a soma dos insumos dele x coeficiente, então para mudar o custo de um serviço altere o preço dos insumos (ver buscar_item_obra). Mudar o preço de um insumo muda o custo de todos os serviços e o total do orçamento da obra. Devolve { ok: true }.',
    inputSchema: z.object({
      obraId: obraId(),
      itemId: id('Id do insumo ou serviço da obra (vem de listar_itens_obra).'),
      descricao: z.string().min(2).max(300).optional().describe('Nova descrição.'),
      unidade: z.string().min(1).max(20).optional().describe('Nova unidade base (ex.: m2, kg, h).'),
      preco: z.number().min(0).optional().describe('Novo preço unitário do insumo, em reais, na unidade base. Ignorado em serviço.'),
      unidadesCompra: unidadesCompra.optional().describe('Unidades de compra do insumo. Quando enviada, substitui a lista anterior. Ignorada em serviço.'),
    }),
    handler: async ({ obraId, itemId, ...corpo }, api) => ({ success: true, data: await api.patch(`/eng/obras/${obraId}/itens/${itemId}`, corpo) }),
  }),

  // ------------------------------------------------------------------ planilha orçamentária (EAP + orçamento)
  ferramenta({
    name: 'listar_planilha_orcamentaria',
    description:
      'Devolve a planilha orçamentária inteira da obra, que é a EAP e o orçamento juntos: { precoTotal, linhas: [{ id, paiId, nivel (obra | etapa | subetapa | tarefa), codigo (ex.: 1.2.3), descricao, servico, precoTotal }] }. Em linha de tarefa com serviço, servico traz { linhaId, itemId, codigo, descricaoServico, unidade, quantidade, custoUnitario (reais, sem BDI), precoUnitario (reais, com BDI) }; precoTotal de cada linha soma as linhas abaixo dela, já com BDI. O id da linha é o noId de atualizar_linha_planilha e remover_linha_planilha e o eapNoId de atividades, medições e necessidades. A rota não tem filtro: em obra grande a resposta é longa; para totais por etapa prefira relatorio_orcamento.',
    inputSchema: z.object({ obraId: obraId() }),
    handler: async (args, api) => ({ success: true, data: await api.get(`/eng/obras/${args.obraId}/planilha`) }),
  }),
  ferramenta({
    name: 'listar_itens_orcamento',
    description:
      'Lista só os serviços lançados no orçamento da obra, a custo direto, com o fechamento do BDI. Devolve { nivelApropriacao, bdiPercentual, subtotal, bdi, total, linhas: [{ id, eapNoId, eapCodigo, eapDescricao, eapNivel, itemId, tipo, codigo, descricao, unidade, editado, quantidade, precoUnitario, total }] }. Valores em reais: precoUnitario e total das linhas são custo sem BDI; subtotal é a soma, bdi é o valor do BDI e total é subtotal + bdi. Para a árvore completa da EAP com preços de venda use listar_planilha_orcamentaria.',
    inputSchema: z.object({ obraId: obraId() }),
    handler: async (args, api) => ({ success: true, data: await api.get(`/eng/obras/${args.obraId}/orcamento`) }),
  }),
  ferramenta({
    name: 'adicionar_linha_planilha',
    description:
      'Inclui uma linha na planilha orçamentária da obra (um nó da EAP): etapa, subetapa ou tarefa. Serviço só entra em linha de tarefa e exige quantidade; o serviço precisa estar na obra (itemId de listar_itens_obra com tipo composicao; se não estiver, use antes adicionar_itens_tabela_na_obra). Sem paiId, a linha vai para dentro da última linha de nível acima; a linha de cima precisa ser de nível superior (obra > etapa > subetapa > tarefa). A descrição é obrigatória, exceto quando há serviço: aí vale a descrição dele. Devolve { id } da linha criada; o código (1.2.3) é numerado pela API.',
    inputSchema: z.object({
      obraId: obraId(),
      nivel: z.enum(NIVEIS).describe('Nível da linha: obra, etapa, subetapa ou tarefa.'),
      paiId: z.string().uuid().nullable().optional().describe('Id da linha de cima (vem de listar_planilha_orcamentaria). Ausente: automático (última linha de nível acima). null: linha na raiz.'),
      descricao: z.string().max(200).optional().describe('Descrição da linha, de 2 a 200 caracteres. Pode ser omitida quando há serviço.'),
      itemId: z.string().uuid().optional().describe('Id do serviço da obra lançado na tarefa (vem de listar_itens_obra, tipo composicao). Só em linha de nível tarefa.'),
      quantidade: z.number().positive().optional().describe('Quantidade do serviço, na unidade dele. Obrigatória quando itemId é informado.'),
    }),
    handler: async ({ obraId, ...corpo }, api) => ({ success: true, data: await api.post(`/eng/obras/${obraId}/planilha`, corpo) }),
  }),
  ferramenta({
    name: 'atualizar_linha_planilha',
    description:
      'Altera uma linha da planilha orçamentária. É parcial: envie só o que muda. Use para renomear a linha, mudar a quantidade do serviço (só quantidade), trocar ou lançar o serviço da tarefa (itemId; sem quantidade mantém a atual, e em linha sem serviço a quantidade é obrigatória) ou retirar o serviço (itemId null). Erros 400: quantidade em linha sem serviço, serviço em linha que não é tarefa, serviço que não está na obra, ou mudança de nível incompatível com a linha de cima, com as de baixo ou com serviço lançado. O preço unitário não é alterado aqui: ele vem dos insumos do serviço (atualizar_item_obra). Devolve { ok: true }.',
    inputSchema: z.object({
      obraId: obraId(),
      noId: id('Id da linha da planilha (campo id de listar_planilha_orcamentaria).'),
      descricao: z.string().min(2).max(200).optional().describe('Nova descrição da linha.'),
      nivel: z.enum(NIVEIS).optional().describe('Novo nível da linha: obra, etapa, subetapa ou tarefa.'),
      itemId: z.string().uuid().nullable().optional().describe('Id do serviço da obra a lançar ou trocar na tarefa (de listar_itens_obra, tipo composicao). null retira o serviço da linha.'),
      quantidade: z.number().positive().optional().describe('Nova quantidade do serviço, na unidade dele.'),
    }),
    handler: async ({ obraId, noId, ...corpo }, api) => ({ success: true, data: await api.put(`/eng/obras/${obraId}/planilha/${noId}`, corpo) }),
  }),
  ferramenta({
    name: 'remover_linha_planilha',
    description:
      'Exclui uma linha da planilha orçamentária (nó da EAP); o serviço lançado nela sai junto e as linhas seguintes são renumeradas. Não tem volta. Erro 409 se a linha tiver linhas abaixo dela, necessidades de insumo apropriadas ou atividades no planejamento: retire-as antes. Para só tirar o serviço e manter a linha, use atualizar_linha_planilha com itemId null. Devolve { ok: true }.',
    inputSchema: z.object({
      obraId: obraId(),
      noId: id('Id da linha da planilha a excluir (campo id de listar_planilha_orcamentaria).'),
    }),
    handler: async (args, api) => ({ success: true, data: await api.delete(`/eng/obras/${args.obraId}/planilha/${args.noId}`) }),
  }),
  ferramenta({
    name: 'obter_composicao_preco',
    description:
      'Devolve a formação do preço de venda (BDI) da obra: { direto (custo direto do orçamento, em reais), percentuais: { administracao, imprevistos, cdi, lucro } em %, indiretos: [{ descricao, valor em reais }], impostos: [{ descricao, percentual, automatico }], formacao } — formacao traz o resultado do cálculo, incluindo o bdi em %. Em empresa do Simples Nacional o DAS entra sozinho (automatico: true), pela faixa cadastrada na empresa. Quando a obra tem composição do preço salva, é este BDI que vale no orçamento; senão vale o bdiPercentual do cadastro da obra.',
    inputSchema: z.object({ obraId: obraId() }),
    handler: async (args, api) => ({ success: true, data: await api.get(`/eng/obras/${args.obraId}/composicao`) }),
  }),

  // ------------------------------------------------------------------ relatórios e versões do orçamento
  ferramenta({
    name: 'relatorio_orcamento',
    description:
      'Relatório de orçamento da obra na estrutura da EAP. Devolve { tipo, obra, linhas, custoTotal, precoTotal, bdiValor } em reais. Linhas do tipo "grupo" (etapas e subetapas) trazem total e peso (% do preço total); as do tipo "servico" trazem codigo, unidade, quantidade, custoUnitario (sem BDI), precoUnitario (com BDI), total e peso. No analítico, abaixo de cada serviço vêm linhas "insumo" com coeficiente, quantidade, custoUnitario e custoTotal. Use o sintético para totais por etapa; o analítico é bem maior.',
    inputSchema: z.object({
      obraId: obraId(),
      tipo: z.enum(['sintetico', 'analitico']).optional().describe('sintetico (padrão): etapas e serviços. analitico: inclui os insumos de cada serviço.'),
    }),
    handler: async ({ obraId, ...consulta }, api) => ({ success: true, data: await api.get(`/eng/obras/${obraId}/relatorio-orcamento`, consulta) }),
  }),
  ferramenta({
    name: 'relatorio_curva_abc',
    description:
      'Curva ABC do orçamento da obra, do maior para o menor valor. Devolve { tipo, obra, limites: { A: 80, B: 95 }, linhas: [{ posicao, codigo, descricao, unidade, quantidade, precoUnitario, total, percentual, acumulado, classe (A | B | C) }], total, classes: { A, B, C } com itens, valor e percentual }. Por serviços os valores são preço de venda (com BDI); por insumos são custo direto (sem BDI). Valores em reais. Use para responder "quais itens pesam mais no orçamento".',
    inputSchema: z.object({
      obraId: obraId(),
      tipo: z.enum(['servicos', 'insumos']).optional().describe('servicos (padrão): curva dos serviços do orçamento. insumos: curva dos insumos somados de todos os serviços.'),
    }),
    handler: async ({ obraId, ...consulta }, api) => ({ success: true, data: await api.get(`/eng/obras/${obraId}/relatorio-abc`, consulta) }),
  }),
  ferramenta({
    name: 'relatorio_custos_por_classe',
    description:
      'Divide o preço de venda do orçamento (com BDI) entre material, mão de obra, equipamento e outros, na estrutura da EAP. Devolve { obra, classes: [{ classe, rotulo, valor, peso }], linhas, precoTotal, bdiValor } em reais; cada linha de grupo ou serviço traz material, mao_obra, equipamento, outros, total e peso (%). O preço de cada serviço é rateado entre as classes na proporção do custo dos insumos; serviço sem composição cai inteiro em "outros".',
    inputSchema: z.object({ obraId: obraId() }),
    handler: async (args, api) => ({ success: true, data: await api.get(`/eng/obras/${args.obraId}/relatorio-custos`) }),
  }),
  ferramenta({
    name: 'listar_versoes_orcamento',
    description:
      'Lista as versões salvas do orçamento da obra, da mais nova para a mais antiga. Devolve { versoes: [{ id, numero, nome, observacao, criadoPor, criadoEm, precoTotal (reais, com BDI), bdiPercentual }] }. Cada versão é um retrato congelado: preços e BDI do momento em que foi salva. O id serve para relatorio_comparacao_versoes.',
    inputSchema: z.object({ obraId: obraId() }),
    handler: async (args, api) => ({ success: true, data: await api.get(`/eng/obras/${args.obraId}/versoes`) }),
  }),
  ferramenta({
    name: 'relatorio_comparacao_versoes',
    description:
      'Compara duas versões do orçamento da obra, ou uma versão salva com o orçamento de agora. Devolve { rotuloA, rotuloB, obra, a e b: { bdiPercentual, precoTotal, custoTotal }, resumo: { delta, percentual, incluidas, removidas, alteradas, iguais }, etapas: [{ codigo, descricao, nivel, totalA, totalB, delta, situacao }], tarefas: [{ codigo, descricao, situacao (igual | alterada | incluida | removida), mudancas, a, b, delta }] }. Valores em reais; delta é B menos A. Erro 400 se a e b forem iguais.',
    inputSchema: z.object({
      obraId: obraId(),
      a: z.string().describe('Versão base: id de uma versão (de listar_versoes_orcamento) ou o texto "atual" para o orçamento de agora.'),
      b: z.string().describe('Versão comparada: id de uma versão (de listar_versoes_orcamento) ou o texto "atual". Tem de ser diferente de a.'),
    }),
    handler: async ({ obraId, ...consulta }, api) => ({ success: true, data: await api.get(`/eng/obras/${obraId}/comparacao`, consulta) }),
  }),

  // ------------------------------------------------------------------ planejamento
  ferramenta({
    name: 'listar_atividades_planejamento',
    description:
      'Lista as atividades do planejamento (cronograma) da obra, na ordem da EAP. Devolve { atividades: [{ id, numero, descricao, descricaoResumida, eapNoId, eapCodigo, eapDescricao, inicioInformado, duracaoDias, predecessoraId, predecessoraNumero, inicio, fim, resumo, critica, folgaDias }] }. inicio e fim (AAAA-MM-DD) são as datas calculadas, já considerando a predecessora; inicioInformado é a data digitada. resumo indica atividade em etapa ou subetapa (vai do início ao fim das atividades abaixo dela); critica e folgaDias vêm do caminho crítico. O id é o atividadeId de atualizar_atividade_planejamento.',
    inputSchema: z.object({ obraId: obraId() }),
    handler: async (args, api) => ({ success: true, data: await api.get(`/eng/obras/${args.obraId}/planejamento`) }),
  }),
  ferramenta({
    name: 'criar_atividade_planejamento',
    description:
      'Cria uma atividade no planejamento da obra, sempre ligada a uma linha da EAP (de qualquer nível). Com predecessora, as datas calculadas da atividade passam a depender dela (confira em listar_atividades_planejamento). Devolve { id }. Erros: 400 sem eapNoId e 404 se a linha da EAP ou a predecessora não forem desta obra. Para criar de uma vez uma atividade por tarefa da EAP, use criar_atividades_planejamento_da_eap.',
    inputSchema: z.object({
      obraId: obraId(),
      descricao: z.string().min(2).max(200).describe('Descrição da atividade.'),
      eapNoId: id('Id da linha da EAP da atividade (campo id de listar_planilha_orcamentaria).'),
      inicio: data('Data de início, AAAA-MM-DD.'),
      duracaoDias: z.number().int().min(1).max(3650).describe('Duração em dias inteiros (mínimo 1).'),
      predecessoraId: z.string().uuid().optional().describe('Id da atividade predecessora, da mesma obra (vem de listar_atividades_planejamento).'),
    }),
    handler: async ({ obraId, ...corpo }, api) => ({ success: true, data: await api.post(`/eng/obras/${obraId}/planejamento`, corpo) }),
  }),
  ferramenta({
    name: 'atualizar_atividade_planejamento',
    description:
      'Altera uma atividade do planejamento: descrição, linha da EAP, data de início, duração ou predecessora. É parcial: envie só o que muda. predecessoraId null retira a predecessora. Erro 409 se a predecessora criar um ciclo (a atividade passaria a depender dela mesma). Devolve { ok: true }; para ver as novas datas calculadas, chame listar_atividades_planejamento.',
    inputSchema: z.object({
      obraId: obraId(),
      atividadeId: id('Id da atividade (vem de listar_atividades_planejamento).'),
      descricao: z.string().min(2).max(200).optional().describe('Nova descrição.'),
      eapNoId: z.string().uuid().optional().describe('Id da nova linha da EAP da atividade (campo id de listar_planilha_orcamentaria).'),
      inicio: data('Nova data de início, AAAA-MM-DD.').optional(),
      duracaoDias: z.number().int().min(1).max(3650).optional().describe('Nova duração em dias inteiros.'),
      predecessoraId: z.string().uuid().nullable().optional().describe('Id da atividade predecessora (de listar_atividades_planejamento). null retira a predecessora.'),
    }),
    handler: async ({ obraId, atividadeId, ...corpo }, api) => ({ success: true, data: await api.put(`/eng/obras/${obraId}/planejamento/${atividadeId}`, corpo) }),
  }),
  ferramenta({
    name: 'criar_atividades_planejamento_da_eap',
    description:
      'Gera o planejamento a partir da planilha: cria uma atividade para cada linha da EAP sem linhas abaixo (folha) que ainda não tem atividade. Cada atividade nasce com 1 dia de duração, sem predecessora e com início na data de início da obra (ou hoje, se a obra não tiver data); depois ajuste com atualizar_atividade_planejamento. Pode ser chamada de novo após incluir linhas: só cria o que falta. Devolve { criadas } com a quantidade.',
    inputSchema: z.object({ obraId: obraId() }),
    handler: async (args, api) => ({ success: true, data: await api.post(`/eng/obras/${args.obraId}/planejamento/gerar-da-eap`) }),
  }),
  ferramenta({
    name: 'relatorio_gantt',
    description:
      'Cronograma (Gantt) da obra. Devolve { granularidade, inicio, fim, totalDias, periodos: [{ rotulo, inicio, fim, dias }], atividades: [{ id, descricao, eapCodigo, inicio, fim, duracaoDias, predecessoraId, deslocamentoDias }], atividadesSemEap }. inicio e fim do projeto e de cada atividade em AAAA-MM-DD; deslocamentoDias é a distância em dias do início do projeto. Sem atividades, vem tudo vazio.',
    inputSchema: z.object({ obraId: obraId(), granularidade }),
    handler: async ({ obraId, ...consulta }, api) => ({ success: true, data: await api.get(`/eng/obras/${obraId}/relatorios-planejamento/gantt`, consulta) }),
  }),
  ferramenta({
    name: 'relatorio_equipes_planejamento',
    description:
      'Dimensionamento de equipes: quantos trabalhadores de cada mão de obra são necessários por período para cumprir o planejamento. Devolve { granularidade, horasDia, inicio, fim, periodos, porTipo: [{ codigo, descricao, pico, periodos: [{ rotulo, trabalhadores }] }], porAtividade: [{ id, descricao, eapCodigo, inicio, fim, duracaoDias, resumo, recursos: [{ codigo, descricao, horas, trabalhadores }] }], pico, mensalistasNaoCalculados, atividadesSemOrcamento }. O cálculo usa as horas de mão de obra horista (unidade h) dos serviços orçados na linha da EAP de cada atividade, divididas pela duração e pela jornada da obra; mão de obra em outra unidade fica de fora e é listada em mensalistasNaoCalculados.',
    inputSchema: z.object({ obraId: obraId(), granularidade }),
    handler: async ({ obraId, ...consulta }, api) => ({ success: true, data: await api.get(`/eng/obras/${obraId}/relatorios-planejamento/equipes`, consulta) }),
  }),
  ferramenta({
    name: 'relatorio_calendario_producao',
    description:
      'Calendário de produção: as atividades programadas em cada período do planejamento. Devolve { granularidade, inicio, fim, blocos: [{ rotulo, inicio, fim, dias, linhas: [{ id, descricao, eapCodigo, marcas }] }] }, onde marcas indica, para cada dia (AAAA-MM-DD), se a atividade está em inicio, continua, fim ou unico (começa e termina no mesmo dia). Períodos sem atividade não aparecem. Use para responder "o que está programado para esta semana".',
    inputSchema: z.object({ obraId: obraId(), granularidade }),
    handler: async ({ obraId, ...consulta }, api) => ({ success: true, data: await api.get(`/eng/obras/${obraId}/relatorios-planejamento/calendario`, consulta) }),
  }),
  ferramenta({
    name: 'relatorio_compras_planejamento',
    description:
      'Lista os insumos que o planejamento pede e quando: quantidade total de cada um (orçamento x coeficiente) e a data da primeira atividade que o usa, que é o prazo para a entrega. Devolve { itens: [{ codigo, descricao, unidade, grupo, total, primeira (AAAA-MM-DD), usos: [{ atividade, inicio, quantidade }] }], semClasse, atividadesSemOrcamento }. Sem classe, vem a lista de compras: tudo menos mão de obra, equipamento e terceirizados. É uma previsão calculada, sem preços; não cria solicitação de compra.',
    inputSchema: z.object({
      obraId: obraId(),
      classe: z.enum(['material', 'equipamento']).optional().describe('material: só materiais. equipamento: só equipamentos. Sem informar: lista de compras completa.'),
    }),
    handler: async ({ obraId, ...consulta }, api) => ({ success: true, data: await api.get(`/eng/obras/${obraId}/relatorios-planejamento/compras`, consulta) }),
  }),

  // ------------------------------------------------------------------ acompanhamento físico (medições e relatórios gerenciais)
  ferramenta({
    name: 'obter_planilha_acompanhamento',
    description:
      'Devolve o avanço físico atual da obra por linha da EAP e a lista de medições já lançadas: { hoje, ultimaData, linhas: [{ id, paiId, nivel, codigo, descricao, folha, unidade, quantidadeOrcada, custoDireto, percentualAtual }], medicoes: [{ id, data, descricao, linhas }] }. percentualAtual é o % executado acumulado (0 a 100; null em linha sem custo): nas folhas é o último valor medido, nas linhas de cima é a média ponderada pelo custo. custoDireto vem em reais, a custo direto (sem BDI). unidade e quantidadeOrcada só vêm em linha com exatamente um serviço. Use antes de registrar_medicao_fisica para pegar os ids das folhas e o percentual anterior.',
    inputSchema: z.object({ obraId: obraId() }),
    handler: async (args, api) => ({ success: true, data: await api.get(`/eng/obras/${args.obraId}/acompanhamento/planilha`) }),
  }),
  ferramenta({
    name: 'buscar_medicao_fisica',
    description:
      'Devolve uma medição física da obra: { id, data (AAAA-MM-DD), descricao, itens: [{ eapNoId, percentual, quantidade }] }. percentual é o % acumulado da linha da EAP naquela data (0 a 100); quantidade só vem quando a medição foi lançada em quantidade. O medicaoId vem da lista medicoes de obter_planilha_acompanhamento.',
    inputSchema: z.object({
      obraId: obraId(),
      medicaoId: id('Id da medição (vem de obter_planilha_acompanhamento, lista medicoes).'),
    }),
    handler: async (args, api) => ({ success: true, data: await api.get(`/eng/obras/${args.obraId}/acompanhamento/medicoes/${args.medicaoId}`) }),
  }),
  ferramenta({
    name: 'registrar_medicao_fisica',
    description:
      'Lança uma medição de avanço físico da obra numa data. Cada item informa o percentual ACUMULADO até a data (0 a 100, não o incremento do período) de uma linha folha da EAP, ou a quantidade acumulada executada, que a API converte em % pela quantidade orçada (limitado a 100). Só existe uma medição por data: lançar de novo na mesma data SUBSTITUI a medição anterior inteira, então envie todas as linhas daquela data. Erros 400: linha agrupadora (com linhas abaixo), quantidade em linha que não tem exatamente um serviço, ou nenhum item com percentual ou quantidade. Devolve { id }. Os ids e o avanço anterior vêm de obter_planilha_acompanhamento.',
    inputSchema: z.object({
      obraId: obraId(),
      data: data('Data da medição, AAAA-MM-DD.'),
      descricao: z.string().max(200).optional().describe('Descrição da medição (ex.: "Medição 3 - março").'),
      itens: z
        .array(
          z.object({
            eapNoId: z.string().uuid().describe('Id da linha folha da EAP medida (campo id de obter_planilha_acompanhamento, com folha: true).'),
            percentual: z.number().min(0).max(100).optional().describe('Percentual executado acumulado até a data, de 0 a 100.'),
            quantidade: z.number().min(0).optional().describe('Quantidade executada acumulada, na unidade do serviço. Alternativa ao percentual; quando informada, prevalece sobre ele.'),
          }),
        )
        .min(1)
        .describe('Linhas medidas. Cada uma precisa de percentual ou quantidade; item sem nenhum dos dois é ignorado.'),
    }),
    handler: async ({ obraId, ...corpo }, api) => ({ success: true, data: await api.post(`/eng/obras/${obraId}/acompanhamento/medicoes`, corpo) }),
  }),
  ferramenta({
    name: 'curva_s_obra',
    description:
      'Curva S mensal da obra, com os índices de desempenho. Devolve { pontos: [{ data (último dia do mês), previsto, executado, realizado }], hoje, custoTotal, dataUltimaMedicao, indices: { cpi, spi } }. previsto é o custo das atividades do planejamento distribuído no tempo; executado é o valor agregado (% medido x custo direto); realizado são as despesas confirmadas apropriadas ao centro de custo da obra; os três são acumulados, e executado e realizado ficam null em meses futuros. Os valores vêm em reais, a custo direto (sem BDI). cpi = executado / realizado e spi = executado / previsto (abaixo de 1 é desempenho ruim; null sem base de cálculo). Sem planejamento ligado à EAP, pontos vem vazio com a explicação no campo vazio.',
    inputSchema: z.object({ obraId: obraId() }),
    handler: async (args, api) => ({ success: true, data: await api.get(`/eng/obras/${args.obraId}/relatorios-gerenciais/curva-s`) }),
  }),
  ferramenta({
    name: 'relatorio_previsto_realizado',
    description:
      'Previsto x executado por linha da EAP numa data de referência. Devolve { dataRef, linhas: [{ id, codigo, descricao, nivel, custoPrevisto, previstoAte, executado, percentualExecutado, saldo, spi }], totais: { custoPrevisto, previstoAte, executado, realizado, saldo, cpi, spi }, observacao }. custoPrevisto é o custo direto orçado da linha, previstoAte o que o planejamento previa até a data, executado o valor agregado pelas medições e saldo o que falta executar. Os valores vêm em reais, sem BDI; percentualExecutado vai de 0 a 100. O realizado (despesas confirmadas da obra) só existe no total, não por etapa.',
    inputSchema: z.object({
      obraId: obraId(),
      data: data('Data de referência, AAAA-MM-DD. Sem informar, a API usa a data da última medição (ou hoje, se não houver medição).').optional(),
    }),
    handler: async ({ obraId, ...consulta }, api) => ({ success: true, data: await api.get(`/eng/obras/${obraId}/relatorios-gerenciais/previsto-realizado`, consulta) }),
  }),

  // ------------------------------------------------------------------ necessidades de insumo (apropriação)
  ferramenta({
    name: 'listar_necessidades_insumos',
    description:
      'Lista as necessidades de insumo da obra (apropriação de insumos): o que a engenharia pediu, para qual linha da EAP e para quando. Devolve { necessidades: [{ id, itemId, codigo, descricao, unidade, eapNoId, eapCodigo, eapDescricao, quantidade, dataNecessaria (AAAA-MM-DD), observacao, unidadeCompra, quantidadeCompra, status, precoUnitario, total }] }, com precoUnitario e total em reais, a preço de orçamento. O status começa em pendente e pode ser cancelada; solicitada e comprada indicam que a necessidade já entrou em solicitação de compra.',
    inputSchema: z.object({ obraId: obraId() }),
    handler: async (args, api) => ({ success: true, data: await api.get(`/eng/obras/${args.obraId}/necessidades`) }),
  }),
  ferramenta({
    name: 'registrar_necessidade_insumo',
    description:
      'Registra uma necessidade de insumo da obra, com status pendente, para depois virar solicitação de compra. O insumo precisa estar na obra (itemId de listar_itens_obra com tipo insumo; serviço não é aceito). A linha da EAP tem de ser do nível de apropriação da obra (campo nivelApropriacao de buscar_obra): se o nível for "obra", não envie eapNoId; nos demais, eapNoId é obrigatório e precisa ser uma linha exatamente desse nível. Devolve { id }.',
    inputSchema: z.object({
      obraId: obraId(),
      itemId: id('Id do insumo da obra (vem de listar_itens_obra, tipo insumo).'),
      eapNoId: z.string().uuid().optional().describe('Id da linha da EAP onde o insumo é apropriado (campo id de listar_planilha_orcamentaria), no nível de apropriação da obra. Omitir quando o nível de apropriação é "obra".'),
      quantidade: z.number().positive().describe('Quantidade necessária, na unidade base do insumo.'),
      dataNecessaria: data('Data em que o insumo precisa estar na obra, AAAA-MM-DD.').optional(),
      observacao: z.string().max(300).optional().describe('Observação livre.'),
    }),
    handler: async ({ obraId, ...corpo }, api) => ({ success: true, data: await api.post(`/eng/obras/${obraId}/necessidades`, corpo) }),
  }),
  ferramenta({
    name: 'atualizar_necessidade_insumo',
    description:
      'Altera uma necessidade de insumo da obra: quantidade, data, observação, linha da EAP ou status. É parcial: envie só o que muda. Para cancelar, envie status "cancelada"; para reabrir, "pendente". O insumo não pode ser trocado. Erro 409 se a necessidade já estiver solicitada ou comprada: nesse caso a solicitação de compra precisa ser cancelada antes. Devolve { ok: true }.',
    inputSchema: z.object({
      obraId: obraId(),
      necessidadeId: id('Id da necessidade (vem de listar_necessidades_insumos).'),
      quantidade: z.number().positive().optional().describe('Nova quantidade, na unidade base do insumo.'),
      dataNecessaria: data('Nova data em que o insumo precisa estar na obra, AAAA-MM-DD. null limpa.').nullable().optional(),
      observacao: z.string().max(300).nullable().optional().describe('Nova observação. null limpa.'),
      eapNoId: z.string().uuid().optional().describe('Id da nova linha da EAP, no nível de apropriação da obra (campo id de listar_planilha_orcamentaria).'),
      status: z.enum(['pendente', 'cancelada']).optional().describe('cancelada: cancela a necessidade. pendente: reabre.'),
    }),
    handler: async ({ obraId, necessidadeId, ...corpo }, api) => ({ success: true, data: await api.put(`/eng/obras/${obraId}/necessidades/${necessidadeId}`, corpo) }),
  }),

  // ------------------------------------------------------------------ RDO (relatório diário de obra)
  ferramenta({
    name: 'listar_rdos',
    description:
      'Lista os RDOs (relatórios diários de obra) de uma obra, do mais recente para o mais antigo. Devolve { obra: { id, codigo, nome }, rdos: [{ id, numero, data (AAAA-MM-DD), climaManha, climaTarde, climaNoite, responsavel, efetivo, ocorrencias }] }, onde efetivo é o total de pessoas na mão de obra do dia e ocorrencias a quantidade de ocorrências. A rota não filtra por período: vêm todos. Para o conteúdo do dia, use buscar_rdo.',
    inputSchema: z.object({ obraId: obraId() }),
    handler: async (args, api) => ({ success: true, data: await api.get(`/eng/obras/${args.obraId}/rdos`) }),
  }),
  ferramenta({
    name: 'buscar_rdo',
    description:
      'Devolve um RDO completo: { obra, rdo: { id, numero, data, climaManha, climaTarde, climaNoite, responsavel, observacoes, atualizadoEm, maoDeObra: [{ funcao, empresa, quantidade, horas }], equipamentos: [{ descricao, quantidade, horas }], atividades: [{ local, descricao, equipe, percentual }], ocorrencias: [{ tipo, descricao }], fotos: [{ id, legenda, ordem }] } }. As fotos vêm só com id e legenda, sem a imagem. Chame sempre antes de atualizar_rdo, porque a atualização regrava o RDO inteiro. O rdoId vem de listar_rdos.',
    inputSchema: z.object({
      obraId: obraId(),
      rdoId: id('Id do RDO (vem de listar_rdos).'),
    }),
    handler: async (args, api) => ({ success: true, data: await api.get(`/eng/obras/${args.obraId}/rdos/${args.rdoId}`) }),
  }),
  ferramenta({
    name: 'criar_rdo',
    description:
      'Abre o RDO de uma obra numa data. O RDO nasce vazio e numerado em sequência; o conteúdo (clima, mão de obra, equipamentos, atividades, ocorrências) é preenchido depois com atualizar_rdo. Só existe um RDO por obra e data: erro 409 se já houver um nessa data (encontre-o em listar_rdos). Devolve { id }.',
    inputSchema: z.object({
      obraId: obraId(),
      data: data('Data do RDO, AAAA-MM-DD.'),
    }),
    handler: async ({ obraId, ...corpo }, api) => ({ success: true, data: await api.post(`/eng/obras/${obraId}/rdos`, corpo) }),
  }),
  ferramenta({
    name: 'atualizar_rdo',
    description:
      'Grava o conteúdo de um RDO. NÃO é parcial: a rota regrava o RDO inteiro. Campo de texto ou clima omitido fica vazio, e cada lista (maoDeObra, equipamentos, atividades, ocorrencias) substitui a anterior — lista omitida apaga as linhas que existiam. Para acrescentar ou corrigir algo, leia antes com buscar_rdo e reenvie tudo com a mudança. As fotos não são afetadas. Erro 409 se a data for trocada para um dia que já tem RDO nesta obra. Devolve { ok: true }.',
    inputSchema: z.object({
      obraId: obraId(),
      rdoId: id('Id do RDO (vem de listar_rdos ou criar_rdo).'),
      data: data('Data do RDO, AAAA-MM-DD. Obrigatória: reenvie a data atual se ela não muda.'),
      climaManha: z.enum(CLIMAS).optional().describe('Clima pela manhã: bom, nublado, chuva ou impraticavel.'),
      climaTarde: z.enum(CLIMAS).optional().describe('Clima à tarde: bom, nublado, chuva ou impraticavel.'),
      climaNoite: z.enum(CLIMAS).optional().describe('Clima à noite: bom, nublado, chuva ou impraticavel.'),
      responsavel: z.string().max(120).optional().describe('Nome de quem responde pelo diário.'),
      observacoes: z.string().max(4000).optional().describe('Observações gerais do dia.'),
      maoDeObra: z
        .array(
          z.object({
            funcao: z.string().min(1).max(120).describe('Função (ex.: pedreiro, servente).'),
            empresa: z.string().max(120).optional().describe('Empresa ou empreiteiro da equipe; vazio para equipe própria.'),
            quantidade: z.number().int().min(0).max(100000).describe('Quantidade de pessoas nessa função no dia.'),
            horas: z.number().min(0).optional().describe('Horas trabalhadas.'),
          }),
        )
        .max(200)
        .optional()
        .describe('Efetivo do dia, por função. Substitui a lista anterior.'),
      equipamentos: z
        .array(
          z.object({
            descricao: z.string().min(1).max(160).describe('Equipamento (ex.: betoneira 400 L).'),
            quantidade: z.number().int().min(0).max(100000).describe('Quantidade de equipamentos.'),
            horas: z.number().min(0).optional().describe('Horas de uso.'),
          }),
        )
        .max(200)
        .optional()
        .describe('Equipamentos usados no dia. Substitui a lista anterior.'),
      atividades: z
        .array(
          z.object({
            descricao: z.string().min(1).max(1000).describe('O que foi executado.'),
            local: z.string().max(120).optional().describe('Local da obra (ex.: 2º pavimento, bloco B).'),
            equipe: z.string().max(120).optional().describe('Equipe que executou.'),
            percentual: z.number().min(0).max(100).optional().describe('Percentual concluído da atividade, de 0 a 100. É só um registro do diário: não lança medição física.'),
          }),
        )
        .max(300)
        .optional()
        .describe('Atividades executadas no dia. Substitui a lista anterior.'),
      ocorrencias: z
        .array(
          z.object({
            tipo: z.enum(OCORRENCIAS).describe('Tipo: falta_material, falta_mao_obra, clima, acidente, paralisacao, visita ou outra.'),
            descricao: z.string().max(500).optional().describe('Descrição da ocorrência.'),
          }),
        )
        .max(200)
        .optional()
        .describe('Ocorrências do dia. Substitui a lista anterior.'),
    }),
    handler: async ({ obraId, rdoId, ...corpo }, api) => ({ success: true, data: await api.put(`/eng/obras/${obraId}/rdos/${rdoId}`, corpo) }),
  }),

  // ------------------------------------------------------------------ visitas de acompanhamento (só leitura)
  ferramenta({
    name: 'listar_visitas_obra',
    description:
      'Lista as visitas de uma obra de acompanhamento, da mais recente para a mais antiga. Devolve { visitas: [{ id, numero, data (AAAA-MM-DD), responsavel, observacoes, fotos }] }, com o texto completo das anotações de cada visita em observacoes e a quantidade de fotos em fotos. Só funciona em obra do tipo acompanhamento (use listar_obras com tipo "acompanhamento" para achá-las): em obra de execução a API responde 409.',
    inputSchema: z.object({ obraId: id('Id de uma obra do tipo acompanhamento (vem de listar_obras com tipo "acompanhamento").') }),
    handler: async (args, api) => ({ success: true, data: await api.get(`/eng/obras/${args.obraId}/visitas`) }),
  }),
  // ------------------------------------------------------------------ tabela própria (insumos e serviços da construtora)
  ferramenta({
    name: 'criar_tabela_propria',
    description:
      'Cria uma tabela de referência própria da construtora, vazia, para cadastrar insumos e composições (serviços) que depois entram nas obras. Devolve { tabela } com o id. Tabelas SINAPI não são criadas por aqui (vêm de importação de arquivo, feita na tela). Antes de criar, confira com listar_tabelas_referencia se já existe uma tabela própria: normalmente a construtora usa uma só.',
    inputSchema: z.object({
      nome: z.string().min(2).max(120).describe('Nome da tabela (ex.: "Tabela própria 2026").'),
    }),
    handler: async (args, api) => ({ success: true, data: await api.post('/eng/tabelas', { fonte: 'proprio', nome: args.nome }) }),
  }),
  ferramenta({
    name: 'criar_item_tabela_referencia',
    description:
      'Cadastra um insumo ou uma composição (serviço) numa tabela PRÓPRIA; tabelas SINAPI são imutáveis e respondem erro. Insumo: informe unidade e preço em reais. Composição: informe os componentes, cada um com o código de um insumo que já exista na mesma tabela e o coeficiente por unidade do serviço; o preço da composição é calculado. O código é gerado pela API, na sequência da tabela: a resposta é { ok, id, codigo }, e é esse codigo que se usa nos componentes de uma composição. Para usar o item numa obra, chame adicionar_itens_tabela_na_obra. O tabelaId vem de listar_tabelas_referencia ou criar_tabela_propria.',
    inputSchema: z.object({
      tabelaId: id('Id da tabela própria (vem de listar_tabelas_referencia ou criar_tabela_propria).'),
      tipo: z.enum(['insumo', 'composicao']).describe('insumo (material, mão de obra, equipamento) ou composicao (serviço formado por insumos).'),
      descricao: z.string().min(2).max(300).describe('Descrição do item.'),
      unidade: z.string().min(1).max(20).describe('Unidade de medida (ex.: "kg", "m2", "h", "un").'),
      grupo: z.string().max(80).optional().describe('Grupo ou classe do item (ex.: "Materiais", "Mão de obra", "Estrutura").'),
      preco: z.number().min(0).optional().describe('Preço unitário em reais. Só para insumo; em composição o preço vem dos componentes.'),
      componentes: z
        .array(
          z.object({
            insumoCodigo: z.string().min(1).describe('Código de um insumo da mesma tabela (o devolvido ao criar o insumo, ou veja em listar_itens_tabela_referencia).'),
            coeficiente: z.number().min(0).describe('Quantidade do insumo consumida por unidade do serviço.'),
          }),
        )
        .optional()
        .describe('Só para composição: insumos que formam o serviço.'),
    }),
    handler: async ({ tabelaId, ...corpo }, api) => ({ success: true, data: await api.post(`/eng/tabelas/${tabelaId}/itens`, corpo) }),
  }),
);
