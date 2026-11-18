// Ferramentas dos cadastros do módulo Administrativo: fornecedores (e credores) e clientes.
import { z } from 'zod';
import { colecao, ferramenta } from './tipos.ts';

const mes = (descricao: string) => z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).describe(descricao);

// Campos comuns a fornecedor e cliente. Cliente não tem categoria, atuação nem endereço.
const camposPessoa = {
  tipoPessoa: z.enum(['PJ', 'PF']).optional().describe('"PJ" (pessoa jurídica, padrão na criação) ou "PF" (pessoa física). Define se cnpjCpf é validado como CNPJ ou como CPF.'),
  cnpjCpf: z.string().max(20).optional().describe('CNPJ (PJ) ou CPF (PF), com ou sem pontuação. A API confere os dígitos verificadores e devolve erro 400 se for inválido.'),
  nomeFantasia: z.string().max(200).optional().describe('Nome fantasia ou apelido: quando existe, é o nome mostrado nas listas e relatórios.'),
  ramo: z.string().max(200).optional().describe('Ramo de atividade, texto livre (ex.: "Concreto usinado", "Locação de equipamentos").'),
  telefone: z.string().max(200).optional().describe('Telefone de contato.'),
  email: z.string().email().optional().describe('E-mail de contato. Precisa ser um e-mail válido.'),
  cidade: z.string().max(200).optional().describe('Cidade.'),
  uf: z.string().length(2).optional().describe('Sigla do estado com 2 letras (ex.: "SP").'),
  chavePix: z.string().max(200).optional().describe('Chave Pix.'),
  observacoes: z.string().max(1000).optional().describe('Observações livres.'),
};

const camposSoFornecedor = {
  categoria: z.enum(['fornecedor', 'credor']).optional().describe('"fornecedor" (padrão na criação: vende material ou serviço) ou "credor" (outros a quem se paga: banco, locador, órgão público, funcionário).'),
  atuacao: z.array(z.enum(['mat', 'mo', 'eq'])).max(3).optional().describe('O que o fornecedor fornece: "mat" (material), "mo" (mão de obra), "eq" (equipamento). Lista com até 3 valores.'),
  endereco: z.string().max(200).optional().describe('Endereço (rua, número, bairro).'),
};

export const ferramentasCadastros = colecao(
  ferramenta({
    name: 'listar_fornecedores',
    description:
      'Lista todos os fornecedores e credores da construtora, ativos primeiro e em ordem de nome: id, categoria (fornecedor ou credor), tipoPessoa, cnpjCpf (só dígitos), razaoSocial, nomeFantasia, ramo, atuacao, telefone, email, endereco, cidade, uf, chavePix, observacoes, ativo e criadoAutomaticamente. O id é o fornecedorId pedido por outras ferramentas (lançamentos, compras, contratos). A rota não tem busca por nome nem paginação: devolve a lista inteira; procure o nome ou o CNPJ no resultado.',
    inputSchema: z.object({
      categoria: z.enum(['fornecedor', 'credor']).optional().describe('Filtra só fornecedores ou só credores. Opcional: sem ele, vêm os dois.'),
    }),
    handler: async (args, api) => ({ success: true, data: await api.get('/adm/fornecedores', args) }),
  }),
  ferramenta({
    name: 'criar_fornecedor',
    description:
      'Cadastra um fornecedor ou credor e devolve o cadastro criado, com o id. Só razaoSocial é obrigatória. Antes de criar, confira em listar_fornecedores se já não existe cadastro com o mesmo CNPJ/CPF ou nome. CNPJ ou CPF com dígito verificador inválido devolve erro 400.',
    inputSchema: z.object({
      razaoSocial: z.string().min(2).max(200).describe('Razão social (PJ) ou nome completo (PF). Obrigatório.'),
      ...camposSoFornecedor,
      ...camposPessoa,
      ativo: z.boolean().optional().describe('false cria o cadastro já desativado. O padrão é true.'),
    }),
    handler: async (args, api) => ({ success: true, data: await api.post('/adm/fornecedores', args) }),
  }),
  ferramenta({
    name: 'atualizar_fornecedor',
    description:
      'Altera o cadastro de um fornecedor ou credor. Aceita parcial: envie só os campos que mudam; os demais ficam como estão. Em campo de texto livre (menos razaoSocial, email e uf), enviar texto vazio apaga o valor. Use ativo = false para desativar (o MCP não exclui cadastros). Devolve o cadastro atualizado; o id vem de listar_fornecedores.',
    inputSchema: z.object({
      fornecedorId: z.string().uuid().describe('Id do fornecedor ou credor (de listar_fornecedores).'),
      razaoSocial: z.string().min(2).max(200).optional().describe('Nova razão social ou nome completo.'),
      ...camposSoFornecedor,
      ...camposPessoa,
      ativo: z.boolean().optional().describe('false desativa o cadastro; true reativa.'),
    }),
    handler: async ({ fornecedorId, ...corpo }, api) => ({ success: true, data: await api.patch(`/adm/fornecedores/${fornecedorId}`, corpo) }),
  }),
  ferramenta({
    name: 'listar_clientes',
    description:
      'Lista todos os clientes da construtora, ativos primeiro e em ordem de nome: id, tipoPessoa, cnpjCpf (só dígitos), razaoSocial, nomeFantasia, ramo, telefone, email, cidade, uf, chavePix, observacoes e ativo. O id é o clienteId pedido por outras ferramentas (receitas, contratos, propostas). A rota não tem filtro, busca nem paginação: devolve a lista inteira; procure o nome ou o CNPJ/CPF no resultado.',
    inputSchema: z.object({}),
    handler: async (_args, api) => ({ success: true, data: await api.get('/adm/clientes') }),
  }),
  ferramenta({
    name: 'criar_cliente',
    description:
      'Cadastra um cliente e devolve o cadastro criado, com o id. Só razaoSocial é obrigatória. O cadastro de cliente não guarda endereço (só cidade e UF). Antes de criar, confira em listar_clientes se já não existe cadastro com o mesmo CNPJ/CPF ou nome. CNPJ ou CPF com dígito verificador inválido devolve erro 400.',
    inputSchema: z.object({
      razaoSocial: z.string().min(2).max(200).describe('Razão social (PJ) ou nome completo (PF). Obrigatório.'),
      ...camposPessoa,
      ativo: z.boolean().optional().describe('false cria o cadastro já desativado. O padrão é true.'),
    }),
    handler: async (args, api) => ({ success: true, data: await api.post('/adm/clientes', args) }),
  }),
  ferramenta({
    name: 'atualizar_cliente',
    description:
      'Altera o cadastro de um cliente. Aceita parcial: envie só os campos que mudam; os demais ficam como estão. Em campo de texto livre (menos razaoSocial, email e uf), enviar texto vazio apaga o valor. Use ativo = false para desativar (o MCP não exclui cadastros). O cadastro de cliente não tem endereço nem atuação. Devolve o cadastro atualizado; o id vem de listar_clientes.',
    inputSchema: z.object({
      clienteId: z.string().uuid().describe('Id do cliente (de listar_clientes).'),
      razaoSocial: z.string().min(2).max(200).optional().describe('Nova razão social ou nome completo.'),
      ...camposPessoa,
      ativo: z.boolean().optional().describe('false desativa o cadastro; true reativa.'),
    }),
    handler: async ({ clienteId, ...corpo }, api) => ({ success: true, data: await api.patch(`/adm/clientes/${clienteId}`, corpo) }),
  }),
  ferramenta({
    name: 'relatorio_cadastros',
    description:
      'Relatório dos cadastros com movimento financeiro, em reais: fornecedores (id, nome, categoria, ramo, documento, ativo, notas confirmadas e comprado no período, data da última compra, aPagar em aberto), clientes (id, nome, documento, cidade, ativo, vendido no período, última venda, aReceber e vencido) e colaboradores. Fornecedores vêm em ordem de maior valor comprado e clientes, de maior valor vendido. Para quem não é dono nem perfil Financeiro, aPagar, aReceber e vencido vêm null. O período é em meses inteiros (AAAA-MM), no máximo 24; sem datas, os últimos 3 meses.',
    inputSchema: z.object({
      de: mes('Primeiro mês do período, no formato AAAA-MM. Opcional.').optional(),
      ate: mes('Último mês do período (incluído), no formato AAAA-MM. Opcional: o padrão é o mês atual.').optional(),
    }),
    handler: async (args, api) => ({ success: true, data: await api.get('/rel/administrativo', args) }),
  }),
);
