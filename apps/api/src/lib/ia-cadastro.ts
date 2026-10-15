// Leitura por IA de cadastros (fornecedor, credor, cliente e colaborador) a partir de foto ou PDF do documento:
// cartão de CNPJ, contrato social, ficha, CNH, RG, carteira de trabalho, cartão de visita etc.
// Só funciona com ANTHROPIC_API_KEY definida. Quem chama deve mostrar os dados para conferência antes de salvar.
import { blocoDocumento, chamarIaComFerramenta } from './ia-documento.ts';

export type EntidadeCadastro = 'fornecedor' | 'credor' | 'cliente' | 'colaborador';
export type DadosCadastro = Record<string, string | number | null>;

const FUNCOES_COLAB = ['motorista', 'operador_bomba', 'motorista_operador', 'operador_usina', 'mecanico', 'laboratorista', 'administrativo', 'vendedor', 'gestor_patio', 'outro'];

const CAMPOS_EMPRESA: Record<string, unknown> = {
  tipoPessoa: { type: 'string', enum: ['PJ', 'PF'], description: 'PJ = pessoa jurídica (CNPJ); PF = pessoa física (CPF).' },
  cnpjCpf: { type: 'string', description: 'CNPJ ou CPF, só com números ou como impresso.' },
  razaoSocial: { type: 'string', description: 'Razão social (PJ) ou nome completo (PF).' },
  nomeFantasia: { type: 'string', description: 'Nome fantasia, se houver.' },
  ramo: { type: 'string', description: 'Atividade principal (CNAE) ou ramo, em poucas palavras.' },
  telefone: { type: 'string' },
  email: { type: 'string' },
  cidade: { type: 'string' },
  uf: { type: 'string', description: 'Sigla do estado com 2 letras.' },
  chavePix: { type: 'string', description: 'Chave PIX, se estiver no documento.' },
  observacoes: { type: 'string', description: 'Outras informações úteis que não cabem nos outros campos.' },
};

const CAMPOS_COLAB: Record<string, unknown> = {
  nome: { type: 'string', description: 'Nome completo.' },
  cpf: { type: 'string', description: 'CPF, só com números ou como impresso.' },
  telefone: { type: 'string' },
  email: { type: 'string' },
  dataNascimento: { type: 'string', description: 'Data de nascimento no formato AAAA-MM-DD.' },
  dataAdmissao: { type: 'string', description: 'Data de admissão no formato AAAA-MM-DD (carteira de trabalho).' },
  cargo: { type: 'string', description: 'Cargo ou função como escrito no documento.' },
  funcao: { type: 'string', enum: FUNCOES_COLAB, description: 'Função mais próxima do cargo. Use "outro" se nenhuma servir.' },
  cnhNumero: { type: 'string', description: 'Número de registro da CNH, se houver.' },
  cnhCategoria: { type: 'string', description: 'Categoria da CNH (A, B, C, D, E, AB, AC, AD, AE).' },
  cnhVencimento: { type: 'string', description: 'Validade da CNH no formato AAAA-MM-DD.' },
};

const DESCRICAO: Record<EntidadeCadastro, string> = {
  fornecedor: 'um fornecedor (quem vende para a construtora)',
  credor: 'um credor (banco, financiamento, consórcio, imposto ou locador)',
  cliente: 'um cliente (quem compra da construtora)',
  colaborador: 'um colaborador (funcionário ou operador)',
};

function ferramenta(entidade: EntidadeCadastro) {
  const propriedades = entidade === 'colaborador' ? CAMPOS_COLAB : CAMPOS_EMPRESA;
  return {
    name: 'registrar_cadastro',
    description: `Registra os dados de ${DESCRICAO[entidade]} lidos no documento.`,
    input_schema: {
      type: 'object',
      properties: { ...propriedades, duvidas: { type: 'array', items: { type: 'string' }, description: 'Campos que não deu para ler com segurança.' } },
    },
  };
}

const data = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null);
const texto = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** Limpa o que veio da IA: formatos, tamanhos e valores fora da lista. Nunca inventa dado. */
export function cadastroDaIa(entidade: EntidadeCadastro, bruto: Record<string, unknown>): { dados: DadosCadastro; duvidas: string[] } {
  const d: DadosCadastro = {};
  const duvidas = Array.isArray(bruto.duvidas) ? bruto.duvidas.filter((x): x is string => typeof x === 'string').slice(0, 20) : [];
  if (entidade === 'colaborador') {
    d.nome = texto(bruto.nome);
    d.cpf = texto(bruto.cpf, 14)?.replace(/\D/g, '') || null;
    d.telefone = texto(bruto.telefone, 30);
    d.email = texto(bruto.email, 200);
    d.dataNascimento = data(bruto.dataNascimento);
    d.dataAdmissao = data(bruto.dataAdmissao);
    d.cargo = texto(bruto.cargo, 120);
    d.funcao = FUNCOES_COLAB.includes(String(bruto.funcao)) ? String(bruto.funcao) : null;
    d.cnhNumero = texto(bruto.cnhNumero, 20)?.replace(/\D/g, '') || null;
    const cat = texto(bruto.cnhCategoria, 3)?.toUpperCase() ?? null;
    d.cnhCategoria = cat && /^(A|B|C|D|E|AB|AC|AD|AE)$/.test(cat) ? cat : null;
    d.cnhVencimento = data(bruto.cnhVencimento);
  } else {
    const pessoa = bruto.tipoPessoa === 'PF' ? 'PF' : bruto.tipoPessoa === 'PJ' ? 'PJ' : null;
    d.tipoPessoa = pessoa;
    const doc = texto(bruto.cnpjCpf, 20)?.replace(/\D/g, '') ?? '';
    d.cnpjCpf = doc.length === 11 || doc.length === 14 ? doc : null;
    if (d.cnpjCpf && !pessoa) d.tipoPessoa = d.cnpjCpf.length === 14 ? 'PJ' : 'PF';
    d.razaoSocial = texto(bruto.razaoSocial);
    d.nomeFantasia = texto(bruto.nomeFantasia);
    d.ramo = texto(bruto.ramo, 120);
    d.telefone = texto(bruto.telefone, 30);
    d.email = texto(bruto.email, 200);
    d.cidade = texto(bruto.cidade, 120);
    const uf = texto(bruto.uf, 30)?.toUpperCase() ?? null;
    d.uf = uf && /^[A-Z]{2}$/.test(uf) ? uf : null;
    d.chavePix = texto(bruto.chavePix, 120);
    d.observacoes = texto(bruto.observacoes, 1000);
  }
  // Campos vazios saem do resultado, para não sobrescrever o que o usuário já digitou.
  for (const k of Object.keys(d)) if (d[k] === null) delete d[k];
  return { dados: d, duvidas };
}

/** Envia a foto ou o PDF do documento para a IA e devolve os campos do cadastro. */
export async function lerCadastroComIa(arquivo: Buffer, tipoArquivo: string, entidade: EntidadeCadastro) {
  const entrada = await chamarIaComFerramenta({
    bloco: blocoDocumento(arquivo, tipoArquivo),
    ferramenta: ferramenta(entidade),
    instrucao:
      `Este documento brasileiro traz os dados de ${DESCRICAO[entidade]}. Registre os dados chamando a ferramenta registrar_cadastro. ` +
      'Copie os dados exatamente como impressos. Se um campo não aparecer ou estiver ilegível, deixe-o vazio e inclua-o em "duvidas". ' +
      'Não invente dados e não complete campos a partir de suposições. Datas no formato AAAA-MM-DD.',
  });
  return cadastroDaIa(entidade, entrada);
}
