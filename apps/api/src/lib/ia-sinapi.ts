// Conversão de tabelas de composições (SINAPI ou própria) para o formato padrão, com a IA (API da Anthropic).
// A IA só descobre a estrutura do arquivo (em que coluna está cada campo); os dados são lidos e validados no código.
// Planilhas .xlsx chegam aqui já convertidas em texto pelo navegador (uma aba, colunas separadas por ponto e vírgula).
import { z } from 'zod';
import { ErroIa } from './ia-nota.ts';
import { lerCsvReferencia, numeroBr, type LeituraCsv } from './engenharia.ts';

const CAMPOS = ['tipo', 'codigo', 'descricao', 'unidade', 'preco', 'grupo', 'insumo', 'coeficiente'] as const;
const LIMITE_AMOSTRA = 40;
const LIMITE_CARACTERES = 20_000;

const indice = z.number().int().min(0).max(500).nullable();
const valorTipo = z.string().trim().nullable();

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
  tipoUnico: z.enum(['insumo', 'composicao']).nullable(),
  valoresTipo: z.object({ insumo: valorTipo, composicao: valorTipo, componente: valorTipo }).nullable(),
});
export type MapaColunas = z.infer<typeof esquemaMapa>;

export type Contexto = { uf: string | null; desonerado: boolean };
export type Conversao = { csv: string; ignoradas: number; semPreco: number; componentesDescartados: number };
export type ResultadoConversao = Conversao & { mapa: MapaColunas; leitura: LeituraCsv };

const linhasUteis = (texto: string) => texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.replace(/[;,\t|]/g, '').trim() !== '');

/** Primeiras linhas do arquivo, com limite de tamanho, para a IA entender a estrutura. */
function amostra(texto: string): string {
  return linhasUteis(texto)
    .slice(0, LIMITE_AMOSTRA)
    .map((l, i) => `${i + 1}: ${l}`)
    .join('\n')
    .slice(0, LIMITE_CARACTERES);
}

function prompt(ctx: Contexto): string {
  return (
    'Você recebe as primeiras linhas (numeradas) de um arquivo de insumos e/ou composições de engenharia (SINAPI da Caixa ou tabela própria). ' +
    'Descubra a estrutura e responda somente com JSON, sem texto em volta, neste formato:\n' +
    '{"separador": ";" | "," | "\\t" | "|", "linhaInicial": número da linha do cabeçalho de colunas (use 1 se não houver cabeçalho; os dados começam na linha seguinte), ' +
    '"colunas": {"tipo": índice ou null, "codigo": índice, "descricao": índice, "unidade": índice, "preco": índice ou null, "grupo": índice ou null, "insumo": índice ou null, "coeficiente": índice ou null}, ' +
    '"tipoUnico": "insumo" | "composicao" | null, ' +
    '"valoresTipo": {"insumo": texto ou null, "composicao": texto ou null, "componente": texto ou null} ou null}\n\n' +
    'Regras:\n' +
    '- Os índices de coluna começam em 0, contando as colunas pelo separador.\n' +
    '- Se o arquivo não tem coluna de tipo porque todas as linhas são do mesmo tipo (por exemplo, uma planilha só de insumos), use "tipo": null, "tipoUnico" com esse tipo e "valoresTipo": null.\n' +
    '- Se há coluna de tipo, use "tipoUnico": null e informe em "valoresTipo" o texto exato da coluna para cada tipo; use "" quando o tipo é identificado pela célula vazia, e null quando o tipo não aparece.\n' +
    '- "componente" é a linha de um insumo dentro de uma composição: o código da composição vai em "codigo", o código do insumo em "insumo" e a quantidade em "coeficiente".\n' +
    '- "grupo" é a classificação ou família do item, se existir.\n' +
    `- Se houver uma coluna de preço por UF, use a coluna da UF ${ctx.uf ?? '(não informada: escolha a primeira)'}.` +
    ` Se houver preço com e sem desoneração na mesma linha, use o ${ctx.desonerado ? 'desonerado' : 'não desonerado'}.\n` +
    '- Não invente colunas: use null quando a coluna não existir.'
  );
}

/** Pede à IA o mapeamento de colunas. */
export async function mapearColunasIa(texto: string, ctx: Contexto): Promise<MapaColunas> {
  const chave = process.env.ANTHROPIC_API_KEY?.trim();
  if (!chave) throw new ErroIa('A IA não está configurada. Use o formato padrão do arquivo.');
  const modelo = process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5-5';
  const pedido = {
    model: modelo,
    max_tokens: 800,
    messages: [{ role: 'user', content: `${prompt(ctx)}\n\nLinhas do arquivo:\n${amostra(texto)}` }],
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
  const falha = 'A IA não entendeu a estrutura do arquivo. Confira se escolheu a aba certa ou use o formato padrão.';
  if (ini < 0 || fim < ini) {
    console.error(`[ia-sinapi] resposta sem JSON: ${resposta.slice(0, 500)}`);
    throw new ErroIa(falha);
  }
  let json: unknown;
  try {
    json = JSON.parse(resposta.slice(ini, fim + 1));
  } catch {
    console.error(`[ia-sinapi] JSON inválido: ${resposta.slice(0, 500)}`);
    throw new ErroIa(falha);
  }
  const mapa = esquemaMapa.safeParse(json);
  if (!mapa.success) {
    console.error(`[ia-sinapi] mapa fora do esquema: ${JSON.stringify(json).slice(0, 500)} · ${mapa.error.message.slice(0, 300)}`);
    throw new ErroIa(falha);
  }
  const m = mapa.data;
  if (m.colunas.codigo === null || m.colunas.descricao === null || m.colunas.unidade === null) {
    throw new ErroIa('A IA não encontrou as colunas de código, descrição ou unidade nesta aba.');
  }
  if (m.colunas.tipo === null && !m.tipoUnico) throw new ErroIa('A IA não identificou se as linhas são insumos ou composições.');
  if (m.colunas.tipo !== null && !m.valoresTipo) throw new ErroIa('A IA não identificou os valores da coluna de tipo.');
  return m;
}

type Tipo = 'insumo' | 'composicao' | 'componente';

/**
 * Aplica o mapeamento ao arquivo inteiro e gera o CSV padrão.
 * Linhas que não são dados (títulos, totais, rodapés) e insumos sem preço são ignorados e contados.
 * Componentes que apontam para insumo ou composição fora do arquivo são descartados e contados.
 */
export function aplicarMapa(texto: string, mapa: MapaColunas): Conversao {
  const linhas = linhasUteis(texto).slice(mapa.linhaInicial);
  const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
  const vt = mapa.valoresTipo;
  const tipoDe = (bruto: string): Tipo | null => {
    if (mapa.colunas.tipo === null) return mapa.tipoUnico;
    const b = norm(bruto);
    if (vt?.insumo != null && b === norm(vt.insumo)) return 'insumo';
    if (vt?.composicao != null && b === norm(vt.composicao)) return 'composicao';
    if (vt?.componente != null && b === norm(vt.componente)) return 'componente';
    return null;
  };

  type Registro = { tipo: Tipo; codigo: string; descricao: string; unidade: string; preco: string; grupo: string; insumo: string; coeficiente: string };
  const registros: Registro[] = [];
  let ignoradas = 0;
  let semPreco = 0;
  for (const linha of linhas) {
    const celulas = linha.split(mapa.separador).map((c) => c.trim().replace(/[;\r\n]/g, ','));
    const valor = (campo: (typeof CAMPOS)[number]) => {
      const idx = mapa.colunas[campo];
      return idx === null ? '' : (celulas[idx] ?? '').trim();
    };
    const tipo = tipoDe(valor('tipo'));
    const r: Registro = { tipo: tipo ?? 'insumo', codigo: valor('codigo'), descricao: valor('descricao'), unidade: valor('unidade'), preco: valor('preco'), grupo: valor('grupo'), insumo: valor('insumo'), coeficiente: valor('coeficiente') };
    if (!tipo || !r.codigo) {
      ignoradas++;
      continue;
    }
    if (tipo === 'componente') {
      if (!r.insumo || numeroBr(r.coeficiente) === null) {
        ignoradas++;
        continue;
      }
    } else {
      if (!r.descricao || !r.unidade) {
        ignoradas++;
        continue;
      }
      if (tipo === 'insumo') {
        const p = numeroBr(r.preco);
        if (p === null || p < 0) {
          semPreco++;
          continue;
        }
      }
    }
    registros.push(r);
  }

  // Sem códigos repetidos (o primeiro vale) e sem componentes órfãos.
  const vistos = new Set<string>();
  const unicos = registros.filter((r) => {
    if (r.tipo === 'componente') return true;
    const chave = `${r.tipo}:${r.codigo}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
  const insumos = new Set(unicos.filter((r) => r.tipo === 'insumo').map((r) => r.codigo));
  const composicoes = new Set(unicos.filter((r) => r.tipo === 'composicao').map((r) => r.codigo));
  let componentesDescartados = 0;
  const finais = unicos.filter((r) => {
    if (r.tipo !== 'componente') return true;
    if (insumos.has(r.insumo) && composicoes.has(r.codigo)) return true;
    componentesDescartados++;
    return false;
  });

  const saida = [CAMPOS.join(';')];
  for (const r of finais) {
    const preco = r.tipo === 'insumo' ? r.preco : '';
    saida.push([r.tipo, r.codigo, r.descricao, r.unidade, preco, r.grupo, r.tipo === 'componente' ? r.insumo : '', r.tipo === 'componente' ? r.coeficiente : ''].join(';'));
  }
  return { csv: saida.join('\n'), ignoradas, semPreco, componentesDescartados };
}

/** Converte o arquivo com a IA. Sem IA configurada, lança ErroIa. */
export async function converterTabelaComIa(texto: string, ctx: Contexto): Promise<ResultadoConversao> {
  const mapa = await mapearColunasIa(texto, ctx);
  const conv = aplicarMapa(texto, mapa);
  const leitura = lerCsvReferencia(conv.csv);
  return { ...conv, mapa, leitura };
}
