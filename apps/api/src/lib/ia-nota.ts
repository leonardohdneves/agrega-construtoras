// Leitura da nota pela IA (API da Anthropic), usada quando o leitor próprio não consegue:
// PDF escaneado, foto da nota ou layout que o leitor não entende. Só funciona com ANTHROPIC_API_KEY definida.
import { chaveAceita } from './code128.ts';
import { notaVazia, type NotaLida, type TipoNota } from './nota-pdf.ts';

export class ErroIa extends Error {}

export function iaDisponivel(): boolean {
  return !!process.env.ANTHROPIC_API_KEY?.trim();
}

const FERRAMENTA = {
  name: 'registrar_nota',
  description: 'Registra os dados lidos do documento fiscal (nota, NFS-e, recibo ou cupom).',
  input_schema: {
    type: 'object',
    properties: {
      legivel: { type: 'boolean', description: 'false se o arquivo não for um documento fiscal ou estiver ilegível.' },
      tipo: { type: 'string', enum: ['nfe', 'nfce', 'nfse', 'cte', 'recibo', 'cupom', 'outro'], description: 'nfe = DANFE de NF-e (modelo 55); nfce = cupom NFC-e; nfse = nota de serviço.' },
      chave_acesso: { type: ['string', 'null'], description: 'Chave de acesso, só números: 44 dígitos (NF-e) ou 50 (NFS-e nacional).' },
      numero: { type: ['string', 'null'] },
      serie: { type: ['string', 'null'] },
      data_emissao: { type: ['string', 'null'], description: 'AAAA-MM-DD' },
      emitente_documento: { type: ['string', 'null'], description: 'CNPJ ou CPF do emitente/prestador, só números.' },
      emitente_nome: { type: ['string', 'null'], description: 'Razão social do emitente/prestador.' },
      destinatario_documento: { type: ['string', 'null'], description: 'CNPJ ou CPF do destinatário/tomador, só números.' },
      destinatario_nome: { type: ['string', 'null'] },
      natureza_operacao: { type: ['string', 'null'] },
      valor_produtos: { type: ['number', 'null'], description: 'Valor total dos produtos ou serviços (bruto), em reais.' },
      frete: { type: ['number', 'null'] },
      seguro: { type: ['number', 'null'] },
      desconto: { type: ['number', 'null'] },
      outras_despesas: { type: ['number', 'null'] },
      ipi: { type: ['number', 'null'] },
      icms_st: { type: ['number', 'null'] },
      retencoes: { type: ['number', 'null'], description: 'NFS-e: soma das retenções (ISS retido, IR, INSS, PIS, COFINS, CSLL) descontadas do valor líquido.' },
      valor_total: { type: ['number', 'null'], description: 'Valor total da nota (NF-e) ou valor líquido a pagar (NFS-e), em reais.' },
      itens: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            codigo: { type: ['string', 'null'] },
            descricao: { type: 'string' },
            ncm: { type: ['string', 'null'] },
            cfop: { type: ['string', 'null'] },
            unidade: { type: ['string', 'null'] },
            quantidade: { type: 'number' },
            valor_total: { type: 'number', description: 'Valor total do item em reais.' },
          },
          required: ['descricao', 'quantidade', 'valor_total'],
        },
      },
      duplicatas: {
        type: 'array',
        items: {
          type: 'object',
          properties: { numero: { type: ['string', 'null'] }, vencimento: { type: 'string', description: 'AAAA-MM-DD' }, valor: { type: 'number' } },
          required: ['vencimento', 'valor'],
        },
      },
      informacoes: { type: ['string', 'null'], description: 'Informações complementares relevantes (pedido, obra), curtas.' },
      duvidas: { type: 'array', items: { type: 'string', enum: ['dataEmissao', 'fornecedor', 'itens', 'total'] }, description: 'Campos que ficaram duvidosos na leitura.' },
    },
    required: ['legivel', 'tipo', 'itens'],
  },
};

const c = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) : 0);
const cn = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) : null);
const txt = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const doc = (v: unknown) => {
  const d = typeof v === 'string' ? v.replace(/\D/g, '') : '';
  return d.length === 14 || d.length === 11 ? d : null;
};
const data = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** Converte a resposta da ferramenta em NotaLida (valores em centavos). Exportada para testes. */
export function notaDaIa(r: Record<string, any>): NotaLida {
  const n = notaVazia();
  n.textoUtil = !!r.legivel;
  if (!r.legivel) return n;
  n.tipo = (['nfe', 'nfce', 'nfse', 'cte', 'recibo', 'cupom', 'outro'].includes(r.tipo) ? r.tipo : 'outro') as TipoNota;
  const chave = typeof r.chave_acesso === 'string' ? r.chave_acesso.replace(/\D/g, '') : '';
  if (chaveAceita(chave)) {
    n.chaveAcesso = chave;
    n.chaveVia = 'ia';
  }
  n.numero = txt(r.numero, 20);
  n.serie = txt(r.serie, 5);
  n.dataEmissao = data(r.data_emissao);
  n.emitente = { documento: doc(r.emitente_documento), nome: txt(r.emitente_nome) };
  n.destinatario = r.destinatario_documento || r.destinatario_nome ? { documento: doc(r.destinatario_documento), nome: txt(r.destinatario_nome) } : null;
  n.naturezaOperacao = txt(r.natureza_operacao, 120);
  n.totais = {
    produtos: cn(r.valor_produtos),
    frete: c(r.frete),
    seguro: c(r.seguro),
    desconto: c(r.desconto) + (n.tipo === 'nfse' ? c(r.retencoes) : 0),
    outras: c(r.outras_despesas),
    ipi: c(r.ipi),
    icmsSt: c(r.icms_st),
    total: cn(r.valor_total),
  };
  n.itens = (Array.isArray(r.itens) ? r.itens : [])
    .filter((i: any) => typeof i?.descricao === 'string' && typeof i?.valor_total === 'number')
    .slice(0, 300)
    .map((i: any) => ({
      codigo: txt(i.codigo, 60),
      descricao: i.descricao.trim().slice(0, 300) || 'Item',
      ncm: typeof i.ncm === 'string' && /^\d{8}$/.test(i.ncm.replace(/\D/g, '')) ? i.ncm.replace(/\D/g, '') : null,
      cfop: typeof i.cfop === 'string' && /^\d{4}$/.test(i.cfop.replace(/\D/g, '')) ? i.cfop.replace(/\D/g, '') : null,
      unidade: txt(i.unidade, 10),
      quantidade: typeof i.quantidade === 'number' && i.quantidade > 0 ? i.quantidade : 1,
      valor: c(i.valor_total),
    }));
  n.duplicatas = (Array.isArray(r.duplicatas) ? r.duplicatas : [])
    .filter((d: any) => data(d?.vencimento) && typeof d?.valor === 'number')
    .slice(0, 120)
    .map((d: any) => ({ numero: txt(d.numero, 30), vencimento: d.vencimento, valor: c(d.valor) }));
  n.informacoes = txt(r.informacoes, 1000);
  n.conferir = Array.isArray(r.duvidas) ? r.duvidas.filter((x: unknown) => typeof x === 'string') : [];
  return n;
}

/** Envia o arquivo (PDF ou foto) para a IA e devolve os dados lidos. */
export async function lerNotaComIa(arquivo: Buffer, tipoArquivo: string, contexto: { cnpjEmpresa: string | null; razaoEmpresa: string | null }): Promise<NotaLida> {
  const chave = process.env.ANTHROPIC_API_KEY?.trim();
  if (!chave) throw new ErroIa('A leitura por IA não está configurada.');
  const modelo = process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5-5';
  const bloco =
    tipoArquivo === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: arquivo.toString('base64') } }
      : { type: 'image', source: { type: 'base64', media_type: tipoArquivo, data: arquivo.toString('base64') } };
  const pedido = {
    model: modelo,
    max_tokens: 8000,
    tools: [FERRAMENTA],
    tool_choice: { type: 'tool', name: 'registrar_nota' },
    messages: [
      {
        role: 'user',
        content: [
          bloco,
          {
            type: 'text',
            text:
              'Leia este documento fiscal brasileiro e registre os dados com a ferramenta. ' +
              `A empresa que está lançando a nota é ${contexto.razaoEmpresa ?? 'a concreteira'}${contexto.cnpjEmpresa ? ` (CNPJ ${contexto.cnpjEmpresa})` : ''}. ` +
              'Valores em reais, como número (ex.: 1234.56). Datas no formato AAAA-MM-DD. Copie os números exatamente como impressos; ' +
              'se não conseguir ler um campo, deixe null e inclua-o em "duvidas". Não invente dados.',
          },
        ],
      },
    ],
  };
  let resp: Response;
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(pedido),
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new ErroIa('Não consegui falar com o serviço de IA agora. Tente de novo em instantes.');
  }
  if (!resp.ok) {
    // A mensagem da API diz o motivo (crédito, modelo, pedido inválido); nunca inclui a chave.
    const detalhe = await resp
      .json()
      .then((j: { error?: { type?: string; message?: string } }) => j?.error?.message ?? '')
      .catch(() => '');
    console.error(`[ia-nota] Anthropic ${resp.status}: ${detalhe}`);
    if (/credit balance/i.test(detalhe)) throw new ErroIa('A conta da IA está sem créditos. Adicione saldo em console.anthropic.com › Billing e tente de novo.');
    if (/model/i.test(detalhe) && (resp.status === 400 || resp.status === 404)) throw new ErroIa(`O modelo de IA configurado não está disponível para esta chave (${detalhe}).`);
    if (resp.status === 401 || resp.status === 403) throw new ErroIa('A chave da IA foi recusada. Confira a variável ANTHROPIC_API_KEY.');
    if (resp.status === 429 || resp.status === 529) throw new ErroIa('O serviço de IA está ocupado. Tente de novo em instantes.');
    if (resp.status === 413) throw new ErroIa('O arquivo é grande demais para a leitura por IA.');
    throw new ErroIa(`A leitura por IA falhou (código ${resp.status}${detalhe ? `: ${detalhe}` : ''}).`);
  }
  const corpo = (await resp.json()) as { content?: { type: string; name?: string; input?: Record<string, unknown> }[] };
  const uso = corpo.content?.find((b) => b.type === 'tool_use' && b.name === 'registrar_nota');
  if (!uso?.input) throw new ErroIa('A IA não devolveu os dados da nota.');
  return notaDaIa(uso.input);
}
