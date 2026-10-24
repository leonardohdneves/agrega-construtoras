// Leitura por IA de um lançamento (despesa ou receita) a partir de foto ou PDF do documento:
// nota fiscal, boleto, fatura, recibo ou comprovante. Só funciona com ANTHROPIC_API_KEY definida.
// Quem chama deve mostrar os dados no formulário para conferência antes de salvar.
import { blocoDocumento, chamarIaComFerramenta } from './ia-documento.ts';

export type TipoLancamentoLido = 'receita' | 'despesa';

export type LancamentoLido = {
  descricao: string | null;
  documento: string | null;
  competencia: string | null;
  vencimento: string | null;
  valorTotal: number | null;
  pessoaNome: string | null;
  pessoaCnpjCpf: string | null;
  parcelas: number | null;
  duvidas: string[];
};

const FERRAMENTA = {
  name: 'registrar_lancamento',
  description: 'Registra os dados financeiros do documento lido: valor, datas, número e a pessoa envolvida.',
  input_schema: {
    type: 'object',
    properties: {
      descricao: { type: 'string', description: 'O que o pagamento ou recebimento se refere, em poucas palavras (ex.: "Cimento CP-II, nota 1234" ou "Energia elétrica, 09/2026").' },
      documento: { type: 'string', description: 'Número do documento: nota fiscal, boleto, fatura, recibo ou título, como impresso.' },
      dataEmissao: { type: 'string', description: 'Data de emissão do documento no formato AAAA-MM-DD.' },
      vencimento: { type: 'string', description: 'Vencimento da parcela única ou da primeira parcela, no formato AAAA-MM-DD.' },
      valorTotal: { type: 'number', description: 'Valor total do documento em reais, com ponto decimal (ex.: 1234.56).' },
      parcelas: { type: 'integer', description: 'Quantas parcelas o documento mostra. 1 se for à vista ou parcela única.' },
      pessoaNome: { type: 'string', description: 'Nome ou razão social da outra parte: quem recebe o pagamento (despesa) ou quem paga a construtora (receita).' },
      pessoaCnpjCpf: { type: 'string', description: 'CNPJ ou CPF dessa outra parte, só com números ou como impresso.' },
      duvidas: { type: 'array', items: { type: 'string' }, description: 'Campos que não deu para ler com segurança.' },
    },
  },
};

const data = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null);
const texto = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** Converte o valor lido em reais. Aceita número ou texto no padrão brasileiro ("1.234,56") ou com ponto. */
export function valorDaIa(v: unknown): number | null {
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string') {
    const s = v.trim().replace(/[R$\s]/g, '');
    n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s);
  } else return null;
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

/** Limpa o que veio da IA. Nunca inventa dado: campo inválido vira null. */
export function lancamentoDaIa(bruto: Record<string, unknown>): LancamentoLido {
  const duvidas = Array.isArray(bruto.duvidas) ? bruto.duvidas.filter((x): x is string => typeof x === 'string').slice(0, 20) : [];
  const parcelas = typeof bruto.parcelas === 'number' && Number.isInteger(bruto.parcelas) && bruto.parcelas >= 1 && bruto.parcelas <= 120 ? bruto.parcelas : null;
  const doc = texto(bruto.pessoaCnpjCpf, 20)?.replace(/\D/g, '') ?? '';
  return {
    descricao: texto(bruto.descricao, 200),
    documento: texto(bruto.documento, 60),
    competencia: data(bruto.dataEmissao),
    vencimento: data(bruto.vencimento),
    valorTotal: valorDaIa(bruto.valorTotal),
    pessoaNome: texto(bruto.pessoaNome, 200),
    pessoaCnpjCpf: doc.length === 11 || doc.length === 14 ? doc : null,
    parcelas,
    duvidas,
  };
}

/** Envia a foto ou o PDF do documento financeiro para a IA e devolve os campos do lançamento. */
export async function lerLancamentoComIa(arquivo: Buffer, tipoArquivo: string, tipo: TipoLancamentoLido): Promise<LancamentoLido> {
  const papel = tipo === 'receita' ? 'Trata-se de uma RECEITA: a outra parte é o cliente que paga a construtora.' : 'Trata-se de uma DESPESA: a outra parte é o fornecedor ou credor que recebe o pagamento.';
  const entrada = await chamarIaComFerramenta({
    bloco: blocoDocumento(arquivo, tipoArquivo),
    ferramenta: FERRAMENTA,
    instrucao:
      'Este documento brasileiro é uma nota fiscal, boleto, fatura, recibo ou comprovante de valor. ' + papel + ' ' +
      'Registre os dados chamando a ferramenta registrar_lancamento. Copie números, nomes e valores exatamente como impressos. ' +
      'Se um campo estiver ausente ou ilegível, deixe-o vazio e inclua-o em "duvidas". Não invente dados. Datas no formato AAAA-MM-DD.',
  });
  return lancamentoDaIa(entrada);
}
