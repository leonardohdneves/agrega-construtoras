// Leitura por IA da proposta de um fornecedor (PDF ou foto) para preencher a resposta de uma cotação.
// A IA só sugere preços; quem salva é o usuário, depois de conferir a tela.
import { blocoDocumento, chamarIaComFerramenta } from './ia-documento.ts';

export type ItemCotacaoLeitura = { id: string; codigo: string | null; descricao: string; unidade: string; quantidade: number };

export type RespostaLida = {
  precos: { itemId: string; precoUnitario: number }[];
  prazoEntregaDias: number | null;
  condicaoPagamento: string | null;
  frete: number | null;
  validade: string | null;
  observacao: string | null;
  duvidas: string[];
};

const texto = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const data = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null);
const numero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

function ferramenta(itens: ItemCotacaoLeitura[]) {
  const ids = itens.map((i) => i.id);
  return {
    name: 'registrar_proposta',
    description: 'Registra os preços e as condições da proposta do fornecedor.',
    input_schema: {
      type: 'object',
      properties: {
        precos: {
          type: 'array',
          description: 'Um registro por item da cotação que aparece na proposta com preço. Não inclua itens sem preço.',
          items: {
            type: 'object',
            properties: {
              itemId: { type: 'string', enum: ids, description: 'Id do item da cotação ao qual o preço corresponde.' },
              precoUnitario: { type: 'number', description: 'Preço unitário em reais, como impresso (ex.: 12.5 para R$ 12,50).' },
            },
            required: ['itemId', 'precoUnitario'],
          },
        },
        prazoEntregaDias: { type: 'integer', description: 'Prazo de entrega em dias, se estiver na proposta.' },
        condicaoPagamento: { type: 'string', description: 'Condição de pagamento, como escrita (ex.: 30/60 dias boleto).' },
        frete: { type: 'number', description: 'Valor do frete em reais, se houver. 0 se a proposta disser que é grátis (CIF).' },
        validade: { type: 'string', description: 'Validade da proposta no formato AAAA-MM-DD.' },
        observacao: { type: 'string', description: 'Outras condições relevantes (marca, mínimo de pedido, exclusões).' },
        duvidas: { type: 'array', items: { type: 'string' }, description: 'O que não deu para ler com segurança.' },
      },
    },
  };
}

/** Lista os itens da cotação para a IA e interpreta a resposta: id fora da lista ou preço inválido é descartado. */
export async function lerPropostaComIa(arquivo: Buffer, tipoArquivo: string, itens: ItemCotacaoLeitura[]): Promise<RespostaLida> {
  const lista = itens.map((i) => `- id ${i.id} | código ${i.codigo ?? '—'} | ${i.descricao} | ${i.unidade} | quantidade ${i.quantidade}`).join('\n');
  const bruto = await chamarIaComFerramenta({
    bloco: blocoDocumento(arquivo, tipoArquivo),
    ferramenta: ferramenta(itens),
    maxTokens: 4000,
    instrucao:
      'Este documento é a proposta comercial de um fornecedor para uma cotação de compra. Registre os preços chamando a ferramenta registrar_proposta.\n' +
      'Itens da cotação:\n' +
      lista +
      '\n\nAssocie cada preço ao item da cotação pelo código, pela descrição e pela unidade. Use exatamente o id do item. ' +
      'Preço é o unitário (não o total). Se um item não aparecer na proposta, não o inclua e registre-o em "duvidas". ' +
      'Não invente preços nem complete a partir de suposições.',
  });

  const validos = new Set(itens.map((i) => i.id));
  const vistos = new Set<string>();
  const precos: RespostaLida['precos'] = [];
  for (const p of Array.isArray(bruto.precos) ? (bruto.precos as Record<string, unknown>[]) : []) {
    const id = typeof p.itemId === 'string' ? p.itemId : '';
    const preco = numero(p.precoUnitario);
    if (!validos.has(id) || preco === null || vistos.has(id)) continue;
    vistos.add(id);
    precos.push({ itemId: id, precoUnitario: preco });
  }
  const duvidas = Array.isArray(bruto.duvidas) ? bruto.duvidas.filter((x): x is string => typeof x === 'string').slice(0, 20) : [];
  const semPreco = itens.filter((i) => !vistos.has(i.id));
  if (semPreco.length) duvidas.push(`Sem preço na proposta: ${semPreco.slice(0, 15).map((i) => i.descricao).join('; ')}${semPreco.length > 15 ? '…' : ''}`);

  return {
    precos,
    prazoEntregaDias: typeof bruto.prazoEntregaDias === 'number' && Number.isInteger(bruto.prazoEntregaDias) && bruto.prazoEntregaDias >= 0 && bruto.prazoEntregaDias <= 365 ? bruto.prazoEntregaDias : null,
    condicaoPagamento: texto(bruto.condicaoPagamento, 120),
    frete: numero(bruto.frete),
    validade: data(bruto.validade),
    observacao: texto(bruto.observacao, 300),
    duvidas,
  };
}
