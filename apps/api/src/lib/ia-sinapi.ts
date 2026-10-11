// Conversão de tabelas de insumos e composições (SINAPI ou própria) para o formato padrão, com a IA (API da Anthropic).
// A IA só descobre a estrutura do arquivo (em que coluna está cada campo); os dados são lidos e validados no código.
//
// Fluxo: o navegador manda só as primeiras linhas para a IA (mapearColunasIa); com o mapa, recorta as colunas
// úteis da planilha inteira e manda o texto recortado para a conversão (aplicarMapa), que valida, achata as
// composições auxiliares em insumos e gera o CSV padrão.
import { z } from 'zod';
import { ErroIa } from './ia-nota.ts';
import { numeroBr } from './engenharia.ts';

export const CAMPOS = ['tipo', 'codigo', 'descricao', 'unidade', 'preco', 'grupo', 'insumo', 'coeficiente'] as const;
/** Dados do item na mesma linha da composição (planilhas com uma linha por item). */
export const CAMPOS_ITEM = ['tipoItem', 'descricaoItem', 'unidadeItem', 'precoItem'] as const;
/** Ordem das colunas no texto recortado pelo navegador. */
export const COLUNAS_RECORTE = [...CAMPOS, ...CAMPOS_ITEM] as const;
const LIMITE_CARACTERES = 20_000;

const indice = z.number().int().min(0).max(500).nullable();
const indiceOpcional = indice.optional().transform((v) => v ?? null);
/** Texto exato da coluna de tipo; lista quando mais de um texto indica o mesmo tipo; "" para célula vazia. */
const valorTipo = z.union([z.string(), z.array(z.string())]).nullable().optional().transform((v) => v ?? null);

export const esquemaValoresTipo = z.object({
  insumo: valorTipo,
  composicao: valorTipo,
  componenteInsumo: valorTipo,
  componenteComposicao: valorTipo,
});
export const esquemaMapa = z.object({
  separador: z.enum([';', ',', '\t', '|']),
  linhaInicial: z.number().int().min(0).max(200),
  colunas: z.object({
    tipo: indice,
    codigo: indice,
    descricao: indice,
    unidade: indice,
    preco: indice,
    grupo: indice,
    insumo: indice,
    coeficiente: indice,
    tipoItem: indiceOpcional,
    descricaoItem: indiceOpcional,
    unidadeItem: indiceOpcional,
    precoItem: indiceOpcional,
  }),
  tipoUnico: z.enum(['insumo', 'composicao']).nullable(),
  valoresTipo: esquemaValoresTipo.nullable(),
});
export type MapaColunas = z.infer<typeof esquemaMapa>;
export type ValoresTipo = z.infer<typeof esquemaValoresTipo>;

export type Contexto = { uf: string | null; desonerado: boolean };

/** Itens que já estão na tabela de destino (importação para uma tabela existente). */
export type Externos = { insumos: Set<string>; composicoes: Map<string, { insumo: string; coeficiente: number }[]> };

export type Conversao = {
  csv: string;
  ignoradas: number;
  semPreco: number;
  componentesDescartados: number;
  auxiliaresAchatadas: number;
  composicoesSemInsumos: number;
};

/** Linhas com algum conteúdo (a mesma regra no navegador e aqui, para a numeração bater). */
export const linhasUteis = (texto: string) => texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.replace(/[;,\t|]/g, '').trim() !== '');

function prompt(ctx: Contexto): string {
  return (
    'Você recebe as primeiras linhas (numeradas) de um arquivo de insumos e/ou composições de engenharia (SINAPI da Caixa ou tabela própria). ' +
    'Descubra a estrutura e responda somente com um objeto JSON, sem texto em volta e sem markdown, neste formato:\n' +
    '{"separador": ";", "linhaInicial": 3, ' +
    '"colunas": {"tipo": 0, "codigo": 1, "descricao": 2, "unidade": 3, "preco": null, "grupo": null, "insumo": null, "coeficiente": null}, ' +
    '"tipoUnico": null, ' +
    '"valoresTipo": {"insumo": null, "composicao": "", "componenteInsumo": "INSUMO", "componenteComposicao": "COMPOSICAO"}}\n\n' +
    'Significado:\n' +
    '- separador: ";", ",", "\\t" ou "|".\n' +
    '- linhaInicial: número da linha do cabeçalho de colunas; os dados começam na linha seguinte. Use 0 se não houver cabeçalho.\n' +
    '- colunas: índice de cada campo, começando em 0, contando pelo separador; null quando o campo não existir. ' +
    'Campos: tipo (coluna que diz o tipo da linha), codigo, descricao, unidade, preco, grupo (classificação ou família), ' +
    'insumo (código do item dentro de uma composição) e coeficiente (quantidade do item por unidade da composição).\n' +
    '- tipoUnico: "insumo" ou "composicao" quando todas as linhas são do mesmo tipo e não há coluna de tipo (por exemplo, uma planilha só de insumos); senão null.\n' +
    '- valoresTipo: o texto exato da coluna de tipo para cada tipo de linha, uma lista de textos se houver mais de um, "" se a célula fica vazia, null se o tipo não aparece:\n' +
    '  insumo = linha de cadastro de um insumo com preço; composicao = linha de cabeçalho de uma composição; ' +
    'componenteInsumo = linha de um insumo dentro de uma composição; componenteComposicao = linha de uma composição auxiliar dentro de outra composição.\n' +
    '- Nas linhas de componente, "codigo" é o código da composição a que a linha pertence e "insumo" é o código do item.\n' +
    '- Se cada linha repete a composição (código, descrição, unidade) e traz um item dela na mesma linha (código do item e coeficiente ou multiplicador), ' +
    'use "tipo": null e "tipoUnico": "composicao", e preencha "insumo" e "coeficiente" com as colunas do item. ' +
    'Se a linha também traz o tipo do item (INSUMO ou COMPOSICAO), a descrição, a unidade e o preço do item, preencha "tipoItem", "descricaoItem", "unidadeItem" e "precoItem" ' +
    'e use "valoresTipo": {"insumo": null, "composicao": null, "componenteInsumo": texto do tipo insumo, "componenteComposicao": texto do tipo composição}; senão "valoresTipo": null.\n' +
    '- Linhas de instrução antes do cabeçalho (como "<codigo>", "Obrigatório", títulos de grupo) não são o cabeçalho: o cabeçalho é a linha com os nomes das colunas logo antes dos dados.\n\n' +
    'Exemplo de planilha de importação com uma linha por item: linha 4 = "Código;Descrição;Unidade;Referência;Cód. Referencia;Preço;P.E.;FIC;FIT;Macro serviço;Serviço;Código;Multiplicador;Tabela;Tipo Item;Unidade;Descrição;Preço" ' +
    '→ {"separador": ";", "linhaInicial": 4, "colunas": {"tipo": null, "codigo": 0, "descricao": 1, "unidade": 2, "preco": null, "grupo": 10, "insumo": 11, "coeficiente": 12, ' +
    '"tipoItem": 14, "unidadeItem": 15, "descricaoItem": 16, "precoItem": 17}, "tipoUnico": "composicao", "valoresTipo": {"insumo": null, "composicao": null, "componenteInsumo": "INSUMO", "componenteComposicao": "COMPOSICAO"}}.\n\n' +
    'Exemplo de SINAPI analítico: colunas "Grupo; Código da Composição; Tipo Item; Código do Item; Descrição; Unidade; Coeficiente", ' +
    'com a linha da composição tendo "Tipo Item" vazio e as linhas dos itens com "INSUMO" ou "COMPOSICAO": ' +
    'tipo = coluna Tipo Item, codigo = Código da Composição, insumo = Código do Item, composicao = "", componenteInsumo = "INSUMO", componenteComposicao = "COMPOSICAO".\n\n' +
    `Se houver uma coluna de preço por UF, use a da UF ${ctx.uf ?? '(não informada: escolha a primeira)'}. ` +
    `Se houver preço com e sem desoneração, use o ${ctx.desonerado ? 'desonerado' : 'não desonerado'}. ` +
    'Não invente colunas.'
  );
}

async function chamarIa(chave: string, conteudo: string): Promise<{ texto: string; parada: string }> {
  const modelo = process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-5-5';
  let resp: Response;
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: modelo, max_tokens: 4000, messages: [{ role: 'user', content: conteudo }] }),
      signal: AbortSignal.timeout(120_000),
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
  const corpo = (await resp.json()) as { content?: { type: string; text?: string }[]; stop_reason?: string };
  const texto = (corpo.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  if (!texto.trim()) console.error(`[ia-sinapi] resposta vazia: stop_reason=${corpo.stop_reason} blocos=${(corpo.content ?? []).map((b) => b.type).join(',')}`);
  return { texto, parada: corpo.stop_reason ?? '' };
}

/** Pede à IA o mapeamento de colunas a partir das primeiras linhas do arquivo. */
export async function mapearColunasIa(amostra: string, ctx: Contexto): Promise<MapaColunas> {
  const chave = process.env.ANTHROPIC_API_KEY?.trim();
  if (!chave) throw new ErroIa('A IA não está configurada. Use o formato padrão do arquivo.');
  const linhas = linhasUteis(amostra)
    .slice(0, 40)
    .map((l, i) => `${i + 1}: ${l.length > 700 ? `${l.slice(0, 700)}…` : l}`)
    .join('\n')
    .slice(0, LIMITE_CARACTERES);
  const conteudo = `${prompt(ctx)}\n\nLinhas do arquivo:\n${linhas}`;
  const falha = 'A IA não entendeu a estrutura do arquivo. Confira se escolheu a aba certa ou use o formato padrão.';

  // Uma nova tentativa quando a resposta vem vazia ou sem JSON válido.
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const { texto } = await chamarIa(chave, conteudo);
    const ini = texto.indexOf('{');
    const fim = texto.lastIndexOf('}');
    if (ini < 0 || fim < ini) {
      console.error(`[ia-sinapi] tentativa ${tentativa} sem JSON: ${texto.slice(0, 300)} · início do arquivo: ${linhas.slice(0, 600)}`);
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(texto.slice(ini, fim + 1));
    } catch {
      console.error(`[ia-sinapi] tentativa ${tentativa} JSON inválido: ${texto.slice(0, 300)}`);
      continue;
    }
    const mapa = esquemaMapa.safeParse(json);
    if (!mapa.success) {
      console.error(`[ia-sinapi] tentativa ${tentativa} fora do esquema: ${JSON.stringify(json).slice(0, 500)} · ${mapa.error.message.slice(0, 300)}`);
      continue;
    }
    const m = mapa.data;
    if (m.colunas.codigo === null) throw new ErroIa('A IA não encontrou a coluna de código nesta aba.');
    if (m.colunas.tipo === null && !m.tipoUnico) throw new ErroIa('A IA não identificou se as linhas são insumos ou composições.');
    if (m.colunas.tipo !== null && !m.valoresTipo) throw new ErroIa('A IA não identificou os valores da coluna de tipo.');
    return m;
  }
  throw new ErroIa(falha);
}

type Tipo = 'insumo' | 'composicao' | 'compInsumo' | 'compComposicao';

const norm = (s: string) => s.trim().toLowerCase();
const lista = (v: string | string[] | null) => (v === null ? null : (Array.isArray(v) ? v : [v]).map(norm));
const numeroTexto = (n: number) => String(Number(n.toPrecision(12)));

/**
 * Aplica o mapeamento ao arquivo e gera o CSV padrão.
 * - Linhas que não são dados (títulos, totais, rodapés) e insumos sem preço ficam de fora e são contados.
 * - Composições auxiliares dentro de outras composições são achatadas: viram os insumos delas × coeficiente,
 *   porque a tabela guarda composição como lista de insumos.
 * - Itens de composição que não existem no arquivo nem na tabela de destino são descartados e contados.
 */
export function aplicarMapa(texto: string, mapa: MapaColunas, externos: Externos = { insumos: new Set(), composicoes: new Map() }): Conversao {
  const linhas = linhasUteis(texto).slice(mapa.linhaInicial);
  const vt = mapa.valoresTipo;
  const valores: [Tipo, string[] | null][] = vt
    ? [['insumo', lista(vt.insumo)], ['composicao', lista(vt.composicao)], ['compInsumo', lista(vt.componenteInsumo)], ['compComposicao', lista(vt.componenteComposicao)]]
    : [];
  const tipoDe = (bruto: string): Tipo | null => {
    if (mapa.colunas.tipo === null) return mapa.tipoUnico;
    const b = norm(bruto);
    for (const [tipo, vs] of valores) if (vs?.includes(b)) return tipo;
    return null;
  };

  type Cadastro = { codigo: string; descricao: string; unidade: string; preco: string; grupo: string };
  const insumos = new Map<string, Cadastro>();
  const composicoes = new Map<string, Cadastro>();
  const itens = new Map<string, { tipo: 'compInsumo' | 'compComposicao'; codigo: string; coeficiente: number }[]>();
  let ignoradas = 0;
  let semPreco = 0;

  for (const linha of linhas) {
    const celulas = linha.split(mapa.separador).map((c) => c.trim());
    const valor = (campo: (typeof COLUNAS_RECORTE)[number]) => {
      const idx = mapa.colunas[campo];
      return idx === null || idx === undefined ? '' : (celulas[idx] ?? '').replace(/[;\r\n]/g, ',').trim();
    };
    const tipo = tipoDe(valor('tipo'));
    const codigo = valor('codigo');
    if (!tipo || !codigo) {
      ignoradas++;
      continue;
    }
    if (tipo === 'compInsumo' || tipo === 'compComposicao') {
      const item = valor('insumo');
      const coeficiente = numeroBr(valor('coeficiente'));
      if (!item || coeficiente === null || coeficiente < 0) {
        ignoradas++;
        continue;
      }
      const l = itens.get(codigo) ?? [];
      l.push({ tipo, codigo: item, coeficiente });
      itens.set(codigo, l);
      continue;
    }
    const cad: Cadastro = { codigo, descricao: valor('descricao'), unidade: valor('unidade'), preco: valor('preco'), grupo: valor('grupo') };
    if (!cad.descricao || !cad.unidade) {
      ignoradas++;
      continue;
    }
    // Layout "uma linha por item": cada linha repete a composição e traz um item dela (código e coeficiente).
    if (tipo === 'composicao' && mapa.colunas.insumo !== null) {
      const item = valor('insumo');
      const coeficiente = numeroBr(valor('coeficiente'));
      if (item && coeficiente !== null && coeficiente >= 0) {
        // Tipo do item na mesma linha, quando a planilha traz (INSUMO ou COMPOSICAO); sem ele, decide pelo cadastro.
        const tipoItem = norm(valor('tipoItem'));
        const ehComposicao = !!tipoItem && !!lista(vt?.componenteComposicao ?? null)?.includes(tipoItem);
        const l = itens.get(codigo) ?? [];
        l.push({ tipo: ehComposicao ? 'compComposicao' : 'compInsumo', codigo: item, coeficiente });
        itens.set(codigo, l);
        // A planilha traz descrição, unidade e preço do insumo: cadastra o insumo também (o preço da composição sai dele).
        const ehInsumo = !!tipoItem && !!lista(vt?.componenteInsumo ?? null)?.includes(tipoItem);
        if (ehInsumo && !insumos.has(item)) {
          const ins: Cadastro = { codigo: item, descricao: valor('descricaoItem'), unidade: valor('unidadeItem'), preco: valor('precoItem'), grupo: '' };
          const p = numeroBr(ins.preco);
          if (ins.descricao && ins.unidade && p !== null && p >= 0) insumos.set(item, ins);
        }
      }
    }
    if (tipo === 'insumo') {
      const p = numeroBr(cad.preco);
      if (p === null || p < 0) {
        semPreco++;
        continue;
      }
      if (!insumos.has(codigo)) insumos.set(codigo, cad);
    } else if (!composicoes.has(codigo)) {
      composicoes.set(codigo, cad);
    }
  }

  // Achata cada composição em insumos (com memória e proteção contra ciclo).
  let componentesDescartados = 0;
  let auxiliaresAchatadas = 0;
  const achatadas = new Map<string, Map<string, number>>();
  const existeInsumo = (c: string) => insumos.has(c) || externos.insumos.has(c);
  const achatar = (comp: string, pilha: Set<string>): Map<string, number> => {
    const pronta = achatadas.get(comp);
    if (pronta) return pronta;
    const soma = new Map<string, number>();
    const somar = (insumo: string, coef: number) => soma.set(insumo, (soma.get(insumo) ?? 0) + coef);
    if (!composicoes.has(comp) && externos.composicoes.has(comp)) {
      for (const k of externos.composicoes.get(comp)!) somar(k.insumo, k.coeficiente);
    }
    pilha.add(comp);
    for (const k of itens.get(comp) ?? []) {
      // Item marcado como insumo; ou sem marcação de tipo (arquivo padrão) e que existe como insumo.
      if (k.tipo === 'compInsumo' && existeInsumo(k.codigo)) {
        somar(k.codigo, k.coeficiente);
      } else if ((k.tipo === 'compComposicao' || !existeInsumo(k.codigo)) && (composicoes.has(k.codigo) || externos.composicoes.has(k.codigo)) && !pilha.has(k.codigo)) {
        auxiliaresAchatadas++;
        for (const [ins, coef] of achatar(k.codigo, pilha)) somar(ins, coef * k.coeficiente);
      } else {
        componentesDescartados++;
      }
    }
    pilha.delete(comp);
    achatadas.set(comp, soma);
    return soma;
  };

  const saida = [CAMPOS.join(';')];
  for (const i of insumos.values()) saida.push(['insumo', i.codigo, i.descricao, i.unidade, i.preco, i.grupo, '', ''].join(';'));
  let composicoesSemInsumos = 0;
  for (const c of composicoes.values()) {
    saida.push(['composicao', c.codigo, c.descricao, c.unidade, '', c.grupo, '', ''].join(';'));
    const ins = achatar(c.codigo, new Set());
    if (!ins.size) composicoesSemInsumos++;
    for (const [insumo, coef] of ins) saida.push(['componente', c.codigo, '', '', '', '', insumo, numeroTexto(coef)].join(';'));
  }
  // Itens de composições que não estão no arquivo nem na tabela de destino.
  for (const [comp, l] of itens) if (!composicoes.has(comp)) componentesDescartados += l.length;

  return { csv: saida.join('\n'), ignoradas, semPreco, componentesDescartados, auxiliaresAchatadas, composicoesSemInsumos };
}

/** Mapa para texto já recortado pelo navegador: colunas na ordem de CAMPOS, sem cabeçalho. */
export function mapaRecortado(tipoUnico: MapaColunas['tipoUnico'], valoresTipo: ValoresTipo | null): MapaColunas {
  return {
    separador: ';',
    linhaInicial: 0,
    // Sem coluna de tipo (tipoUnico), a coluna 0 do texto recortado vem vazia e não deve ser lida como tipo.
    colunas: { tipo: tipoUnico ? null : 0, codigo: 1, descricao: 2, unidade: 3, preco: 4, grupo: 5, insumo: 6, coeficiente: 7, tipoItem: 8, descricaoItem: 9, unidadeItem: 10, precoItem: 11 },
    tipoUnico,
    valoresTipo,
  };
}
