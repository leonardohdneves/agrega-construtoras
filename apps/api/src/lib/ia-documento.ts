// Chamada à API da Anthropic para ler um documento (PDF ou foto) e devolver os dados por uma ferramenta.
// Usada pela leitura de cadastros e pela leitura de cotações. Só funciona com ANTHROPIC_API_KEY definida.
import { ErroIa } from './ia-nota.ts';

export type BlocoDocumento = Record<string, unknown>;

/** Monta o bloco do documento para a API: PDF vai como document, foto como image. */
export function blocoDocumento(arquivo: Buffer, tipoArquivo: string): BlocoDocumento {
  const base64 = arquivo.toString('base64');
  return tipoArquivo === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: tipoArquivo, data: base64 } };
}

/**
 * Envia o documento e a instrução; a IA deve responder chamando a ferramenta `nome`.
 * Devolve o objeto `input` da chamada. Erros viram ErroIa com mensagem para o usuário (nunca inclui a chave).
 */
export async function chamarIaComFerramenta(opcoes: {
  bloco: BlocoDocumento;
  instrucao: string;
  ferramenta: { name: string; description: string; input_schema: unknown };
  maxTokens?: number;
}): Promise<Record<string, unknown>> {
  const chave = process.env.ANTHROPIC_API_KEY?.trim();
  if (!chave) throw new ErroIa('A leitura por IA não está configurada.');
  const modelo = process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5-5';
  const pedido = {
    model: modelo,
    max_tokens: opcoes.maxTokens ?? 2000,
    tools: [opcoes.ferramenta],
    // O modelo atual não aceita tool_choice "tool" nem "any"; "auto" com uma única ferramenta funciona.
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: [opcoes.bloco, { type: 'text', text: opcoes.instrucao }] }],
  };
  let resp: Response;
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(pedido),
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    throw new ErroIa('Não consegui falar com o serviço de IA agora. Tente de novo em instantes.');
  }
  if (!resp.ok) {
    // A mensagem da API diz o motivo (crédito, modelo, pedido inválido); nunca inclui a chave.
    const detalhe = await resp
      .json()
      .then((j: { error?: { message?: string } }) => j?.error?.message ?? '')
      .catch(() => '');
    console.error(`[ia-documento] Anthropic ${resp.status}: ${detalhe}`);
    if (/credit balance/i.test(detalhe)) throw new ErroIa('A conta da IA está sem créditos. Adicione saldo em console.anthropic.com › Billing e tente de novo.');
    if (resp.status === 401 || resp.status === 403) throw new ErroIa('A chave da IA foi recusada. Confira a variável ANTHROPIC_API_KEY.');
    if (resp.status === 429 || resp.status === 529) throw new ErroIa('O serviço de IA está ocupado. Tente de novo em instantes.');
    if (resp.status === 413) throw new ErroIa('O arquivo é grande demais para a leitura por IA.');
    throw new ErroIa(`A leitura por IA falhou (código ${resp.status}${detalhe ? `: ${detalhe}` : ''}).`);
  }
  const corpo = (await resp.json()) as { content?: { type: string; name?: string; input?: Record<string, unknown> }[] };
  const uso = corpo.content?.find((b) => b.type === 'tool_use' && b.name === opcoes.ferramenta.name);
  if (!uso?.input) throw new ErroIa('A IA não devolveu os dados. Tente de novo.');
  return uso.input;
}
