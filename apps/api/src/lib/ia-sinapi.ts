// Conversão de tabelas de composições (SINAPI ou própria) para o formato padrão, com a IA (API da Anthropic).
// A IA só descobre a estrutura do arquivo (em que coluna está cada campo); os dados são lidos e validados no código.
import { z } from 'zod';
import { ErroIa } from './ia-nota.ts';
import { lerCsvReferencia, type LeituraCsv } from './engenharia.ts';

const CAMPOS = ['tipo', 'codigo', 'descricao', 'unidade', 'preco', 'grupo', 'insumo', 'coeficiente'] as const;
const LIMITE_AMOSTRA = 40;
const LIMITE_CARACTERES = 8000;

const indice = z.number().int().min(0).max(200).nullable();

const esquemaMapa = z.object({
  separador: z.enum([';', ',', '\t', '|']),
  linhaInicial: z.number().int().min(1).max(200),
  colunas: z.object({
    tipo: indice,
    codigo: indice,
    descricao: indice,
    unidade: indice,
    preco: indice,
    grupo: indice,
    insumo: indice,
    coeficiente: indice,
  }),
  valoresTipo: z.object({ insumo: z.string().trim().min(1), composicao: z.string().trim().min(1), componente: z.string().trim().min(1) }),
});
export type MapaColunas = z.infer<typeof esquemaMapa>;

export type ResultadoConversao = { csv: string; mapa: MapaColunas; ignoradas: number; leitura: LeituraCsv };

/** Primeiras linhas do arquivo, com limite de tamanho, para a IA entender a estrutura. */
function amostra(texto: string): string {
  const linhas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, LIMITE_AMOSTRA);
  return linhas.join('\n').slice(0, LIMITE_CARACTERES);
}

const PROMPT =
  'Você recebe as primeiras linhas de um arquivo de composições e insumos de engenharia (SINAPI ou tabela própria). ' +
  'Descubra a estrutura e responda somente com JSON, sem texto em volta, neste formato: ' +
  '{"separador": ";" | "," | "\\t" | "|", "linhaInicial": número da linha do cabeçalho de colunas (começa em 1; use 1 se não houver cabeçalho), ' +
  '"colunas": {"tipo": índice, "codigo": índice, "descricao": índice, "unidade": índice, "preco": índice, "grupo": índice ou null, "insumo": índice ou null, "coeficiente": índice ou null}, ' +
  '"valoresTipo": {"insumo": "texto que identifica um insumo na coluna tipo", "composicao": "texto que identifica uma composição", "componente": "texto que identifica uma linha de insumo dentro de uma composição"}}. ' +
  'Os índices de coluna começam em 0. Campos: tipo (insumo, composição ou componente), codigo, descricao, unidade, preco (preço do insumo ou da composição), grupo, ' +
  'insumo (código do insumo dentro de uma composição) e coeficiente (quantidade do insumo por unidade da composição). ' +
  'Use null quando a coluna não existir. Não invente valores.';

/** Pede à IA o mapeamento de colunas. */
export async function mapearColunasIa(texto: string): Promise<MapaColunas> {
  const chave = process.env.ANTHROPIC_API_KEY?.trim();
  if (!chave) throw new ErroIa('A IA não está configurada. Use o formato padrão do arquivo.');
  const modelo = process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5-5';
  const pedido = {
    model: modelo,
    max_tokens: 600,
    messages: [{ role: 'user', content: `${PROMPT}\n\nLinhas do arquivo:\n${amostra(texto)}` }],
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
    console.error(`[ia-sinapi] Anthropic ${resp.status}: ${detalhe}`);
    if (/credit balance/i.test(detalhe)) throw new ErroIa('A conta da IA está sem créditos. Adicione saldo e tente de novo.');
    if (resp.status === 401 || resp.status === 403) throw new ErroIa('A chave da IA foi recusada. Confira a variável ANTHROPIC_API_KEY.');
    if (resp.status === 429 || resp.status === 529) throw new ErroIa('O serviço de IA está ocupado. Tente de novo em instantes.');
    throw new ErroIa(`A IA não leu a estrutura do arquivo (código ${resp.status}).`);
  }
  const corpo = (await resp.json()) as { content?: { type: string; text?: string }[] };
  const resposta = (corpo.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  const ini = resposta.indexOf('{');
  const fim = resposta.lastIndexOf('}');
  if (ini < 0 || fim < ini) throw new ErroIa('A IA não entendeu a estrutura do arquivo. Use o formato padrão.');
  let json: unknown;
  try {
    json = JSON.parse(resposta.slice(ini, fim + 1));
  } catch {
    throw new ErroIa('A IA não entendeu a estrutura do arquivo. Use o formato padrão.');
  }
  const mapa = esquemaMapa.safeParse(json);
  if (!mapa.success) throw new ErroIa('A IA não entendeu a estrutura do arquivo. Use o formato padrão.');
  if (mapa.data.colunas.tipo === null || mapa.data.colunas.codigo === null || mapa.data.colunas.descricao === null || mapa.data.colunas.unidade === null) {
    throw new ErroIa('A IA não encontrou as colunas de tipo, código, descrição ou unidade.');
  }
  return mapa.data;
}

/** Aplica o mapeamento ao arquivo inteiro e gera o CSV padrão, validado pelo mesmo leitor do formato padrão. */
export function aplicarMapa(texto: string, mapa: MapaColunas): { csv: string; ignoradas: number } {
  const linhas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  const cabecalho = CAMPOS.join(';');
  const tipos = { insumo: mapa.valoresTipo.insumo.toLowerCase(), composicao: mapa.valoresTipo.composicao.toLowerCase(), componente: mapa.valoresTipo.componente.toLowerCase() };
  const saida: string[] = [cabecalho];
  let ignoradas = 0;
  for (const linha of linhas.slice(mapa.linhaInicial)) {
    const celulas = linha.split(mapa.separador).map((c) => c.trim().replace(/[;\r\n]/g, ','));
    const valor = (campo: (typeof CAMPOS)[number]) => {
      const idx = mapa.colunas[campo];
      return idx === null ? '' : (celulas[idx] ?? '');
    };
    const tipoBruto = valor('tipo').toLowerCase();
    const tipo = tipoBruto === tipos.insumo ? 'insumo' : tipoBruto === tipos.composicao ? 'composicao' : tipoBruto === tipos.componente ? 'componente' : null;
    if (!tipo) {
      ignoradas++;
      continue;
    }
    saida.push([tipo, valor('codigo'), valor('descricao'), valor('unidade'), tipo === 'insumo' || tipo === 'composicao' ? valor('preco') : '', valor('grupo'), valor('insumo'), valor('coeficiente')].join(';'));
  }
  return { csv: saida.join('\n'), ignoradas };
}

/** Converte o arquivo com a IA. Sem IA configurada, lança ErroIa. */
export async function converterTabelaComIa(texto: string): Promise<ResultadoConversao> {
  const mapa = await mapearColunasIa(texto);
  const { csv, ignoradas } = aplicarMapa(texto, mapa);
  const leitura = lerCsvReferencia(csv);
  return { csv, mapa, ignoradas, leitura };
}
