// Leitura de projeto por IA: a IA lista os quantitativos do PDF e o código sugere composições já cadastradas
// nas tabelas da empresa. A IA não escolhe código nem preço: só as candidatas que existem no banco são sugeridas,
// e nada é gravado até o usuário confirmar na planilha.
// Este módulo não importa nada externo, para os testes rodarem sem instalar dependências.

export const SERVICOS_LEITURA = ['forma', 'armacao', 'concreto', 'outro'] as const;
export type ServicoLeitura = (typeof SERVICOS_LEITURA)[number];

export type QuantitativoLido = { servico: ServicoLeitura; descricao: string; unidade: string; quantidade: number; origem: string };

/** Composição cadastrada numa tabela da empresa (SINAPI ou própria). */
export type ComposicaoRef = { id: string; tabelaId: string; tabela: string; fonte: string; codigo: string; descricao: string; unidade: string };
export type Candidata = ComposicaoRef & { pontos: number };

/** Palavras (já sem acento, em minúsculas) que indicam cada tipo de serviço na descrição da composição. */
const PALAVRAS: Record<ServicoLeitura, string[]> = {
  forma: ['forma', 'formas', 'carpintaria'],
  armacao: ['armacao', 'aco', 'vergalhao', 'armadura', 'ca'],
  concreto: ['concreto', 'usinado'],
  outro: [],
};

/** Palavras que, se aparecerem, tiram a composição de outro serviço (ex.: "forma para pilares de concreto" não é concreto). */
const EXCLUIR: Record<ServicoLeitura, string[]> = {
  forma: ['concreto', 'usinado', 'armacao', 'aco', 'vergalhao', 'armadura'],
  armacao: ['forma', 'formas', 'carpintaria', 'concreto', 'usinado'],
  concreto: ['forma', 'formas', 'carpintaria', 'armacao', 'aco', 'vergalhao', 'armadura'],
  outro: [],
};

const STOP = new Set(['para', 'com', 'sem', 'dos', 'das', 'nos', 'nas', 'uma', 'por', 'tipo', 'servico', 'servicos', 'total', 'area', 'volume']);

export function normalizarTexto(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function tokens(t: string): string[] {
  return normalizarTexto(t).split(/[^a-z0-9]+/).filter(Boolean);
}

/** Pontua as composições para um quantitativo: palavra do serviço (3), termos da descrição (1 cada) e mesma unidade (2). */
export function pontuarCandidatas(q: Pick<QuantitativoLido, 'servico' | 'descricao' | 'unidade'>, composicoes: ComposicaoRef[], limite = 5): Candidata[] {
  const palavras = PALAVRAS[q.servico];
  const termos = [...new Set(tokens(q.descricao))].filter((t) => t.length >= 4 && !STOP.has(t));
  const unidade = normalizarTexto(q.unidade).trim();
  const out: Candidata[] = [];
  for (const c of composicoes) {
    const tc = new Set(tokens(c.descricao));
    if (EXCLUIR[q.servico].some((p) => tc.has(p))) continue;
    const temPalavra = palavras.some((p) => tc.has(p));
    const termosIguais = termos.filter((t) => tc.has(t)).length;
    if (q.servico !== 'outro' && !temPalavra) continue;
    if (q.servico === 'outro' && termosIguais < 2) continue;
    const mesmaUnidade = unidade !== '' && normalizarTexto(c.unidade).trim() === unidade;
    const pontos = (temPalavra ? 3 : 0) + termosIguais + (mesmaUnidade ? 2 : 0);
    out.push({ ...c, pontos });
  }
  return out.sort((a, b) => b.pontos - a.pontos || a.descricao.localeCompare(b.descricao, 'pt-BR')).slice(0, limite);
}

/** Confere se o texto base64 é mesmo um PDF (cabeçalho %PDF-). Aceita também o formato data:...;base64,. */
export function ehPdfBase64(texto: string): boolean {
  const limpo = texto.replace(/^data:[^;]*;base64,/, '');
  return Buffer.from(limpo, 'base64').subarray(0, 5).toString('latin1') === '%PDF-';
}

export function base64Puro(texto: string): string {
  return texto.replace(/^data:[^;]*;base64,/, '');
}

export const FERRAMENTA_QUANTITATIVOS = {
  name: 'registrar_quantitativos',
  description: 'Registra os quantitativos dos serviços de estrutura lidos do projeto.',
  input_schema: {
    type: 'object',
    properties: {
      itens: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            servico: { type: 'string', enum: [...SERVICOS_LEITURA] },
            descricao: { type: 'string', description: 'Ex.: Forma das vigas do térreo; Aço CA-50 8,0 mm; Concreto fck 25 MPa' },
            unidade: { type: 'string', description: 'm2 para forma, kg para aço, m3 para concreto' },
            quantidade: { type: 'number' },
            origem: { type: 'string', description: 'Onde o número está no projeto (prancha, quadro, elemento) e como foi somado, se foi somado' },
          },
          required: ['servico', 'descricao', 'unidade', 'quantidade', 'origem'],
        },
      },
      pendencias: { type: 'array', items: { type: 'string' }, description: 'Elementos que existem no projeto mas cujo quantitativo não dá para ler' },
    },
    required: ['itens', 'pendencias'],
  },
};

export function instrucaoQuantitativos(nome?: string): string {
  return (
    `Este é o projeto estrutural de uma obra${nome ? ` (arquivo ${nome})` : ''}. Leia-o e registre os quantitativos chamando a ferramenta registrar_quantitativos. ` +
    'Considere: forma (área de forma em m²), armação (peso de aço em kg, separado por bitola e tipo de aço, quando houver) e concreto (volume em m³). ' +
    'Prefira os quadros de resumo e as tabelas de aço e de concreto do projeto. Quando for preciso somar, diga na origem como somou. ' +
    'Copie os números como estão impressos, sem inventar. Elementos sem quantitativo legível vão em pendencias. ' +
    'Use "outro" para serviço que não seja forma, armação ou concreto.'
  );
}

/** Lê a resposta da IA: descarta itens sem descrição ou sem quantidade válida. */
export function lerQuantitativos(r: Record<string, unknown>): { itens: QuantitativoLido[]; pendencias: string[] } {
  const brutos = Array.isArray(r.itens) ? (r.itens as Record<string, unknown>[]) : [];
  const itens = brutos.flatMap((x): QuantitativoLido[] => {
    const descricao = typeof x.descricao === 'string' ? x.descricao.trim().slice(0, 200) : '';
    const quantidade = Number(String(x.quantidade ?? '').replace(',', '.'));
    if (!descricao || !(quantidade > 0)) return [];
    const servico = (SERVICOS_LEITURA as readonly string[]).includes(String(x.servico)) ? (x.servico as ServicoLeitura) : 'outro';
    return [{ servico, descricao, unidade: String(x.unidade ?? '').trim().slice(0, 20), quantidade, origem: String(x.origem ?? '').trim().slice(0, 300) }];
  });
  const pendencias = Array.isArray(r.pendencias)
    ? r.pendencias.filter((p): p is string => typeof p === 'string' && p.trim() !== '').map((p) => p.trim().slice(0, 300))
    : [];
  return { itens, pendencias };
}
