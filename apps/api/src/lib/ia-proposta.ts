// Redação da proposta comercial pela IA (API da Anthropic). Sem ANTHROPIC_API_KEY, o sistema usa um texto-modelo.
import { ErroIa } from './ia-nota.ts';

export type DadosProposta = {
  empresa: string;
  cliente: string;
  obra: string | null;
  endereco: string | null;
  traco: string;
  fck: number | null;
  slump: number | null;
  volume: number;
  precoM3: number;
  condicoes: string | null;
  validadeDias: number;
  historico: { preco: number; data: string }[];
};

const reais = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Texto-modelo para quando a IA não está configurada: mesmos dados, sem redação. */
export function textoModelo(d: DadosProposta): string {
  const local = [d.obra, d.endereco].filter(Boolean).join(' · ');
  return [
    `Prezado(a) ${d.cliente},`,
    '',
    `A ${d.empresa} apresenta proposta de fornecimento de concreto ${d.traco}${d.fck ? ` (fck ${d.fck} MPa)` : ''}${d.slump ? `, slump ${d.slump} cm` : ''}` +
      `${local ? `, para a obra ${local}` : ''}.`,
    '',
    `Volume estimado: ${d.volume.toLocaleString('pt-BR')} m³ ao preço de ${reais(d.precoM3)} por m³, totalizando ${reais(d.volume * d.precoM3)}.`,
    d.condicoes ? `Condições de pagamento: ${d.condicoes}.` : '',
    `Esta proposta é válida por ${d.validadeDias} ${d.validadeDias === 1 ? 'dia' : 'dias'}.`,
    '',
    'Permanecemos à disposição para esclarecimentos.',
    '',
    d.empresa,
  ]
    .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
    .join('\n');
}

/** Pede à IA o texto da proposta, com tom comercial e os dados e o histórico de preço. */
export async function redigirPropostaIa(d: DadosProposta): Promise<string> {
  const chave = process.env.ANTHROPIC_API_KEY?.trim();
  if (!chave) throw new ErroIa('A IA não está configurada.');
  const modelo = process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5-5';
  const historico = d.historico.length
    ? d.historico.map((h) => `- ${reais(h.preco)}/m³ em ${h.data}`).join('\n')
    : '- sem vendas anteriores deste traço para este cliente';
  const pedido = {
    model: modelo,
    max_tokens: 1200,
    messages: [
      {
        role: 'user',
        content:
          'Redija em português do Brasil o texto de uma proposta comercial de fornecimento de concreto usinado, para enviar ao cliente. ' +
          'Seja direto, cordial e profissional, em até 12 linhas, sem títulos nem markdown, sem inventar prazos, descontos ou garantias que não estejam nos dados. ' +
          'Inclua o traço, o volume, o preço por m³, o total estimado, as condições de pagamento e a validade. ' +
          'Não faça negociação nem cite a concorrência. Responda somente com o texto da proposta.\n\n' +
          `Empresa: ${d.empresa}\nCliente: ${d.cliente}\nObra: ${d.obra ?? '—'}\nEndereço: ${d.endereco ?? '—'}\n` +
          `Traço: ${d.traco}${d.fck ? ` (fck ${d.fck} MPa)` : ''}${d.slump ? `, slump ${d.slump} cm` : ''}\n` +
          `Volume: ${d.volume} m³\nPreço proposto: ${reais(d.precoM3)}/m³ (total estimado ${reais(d.volume * d.precoM3)})\n` +
          `Condições de pagamento: ${d.condicoes ?? 'a combinar'}\nValidade: ${d.validadeDias} dias\n\n` +
          `Histórico de preço deste cliente neste traço (para contexto):\n${historico}`,
      },
    ],
  };
  let resp: Response;
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(pedido),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new ErroIa('Não consegui falar com o serviço de IA agora. Tente de novo em instantes.');
  }
  if (!resp.ok) {
    const detalhe = await resp.json().then((j: { error?: { message?: string } }) => j?.error?.message ?? '').catch(() => '');
    console.error(`[ia-proposta] Anthropic ${resp.status}: ${detalhe}`);
    if (/credit balance/i.test(detalhe)) throw new ErroIa('A conta da IA está sem créditos. Adicione saldo e tente de novo.');
    if (resp.status === 401 || resp.status === 403) throw new ErroIa('A chave da IA foi recusada. Confira a variável ANTHROPIC_API_KEY.');
    if (resp.status === 429 || resp.status === 529) throw new ErroIa('O serviço de IA está ocupado. Tente de novo em instantes.');
    throw new ErroIa(`A IA não redigiu a proposta (código ${resp.status}).`);
  }
  const corpo = (await resp.json()) as { content?: { type: string; text?: string }[] };
  const texto = (corpo.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n').trim();
  if (!texto) throw new ErroIa('A IA não devolveu o texto. Tente de novo.');
  return texto;
}
