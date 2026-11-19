// Pacote SINAPI da Caixa (arquivos CSV separados por ';') → CSV de tabela de referência do sistema.
// Um regime por chamada (COM ou SEM desoneração). Composição que usa auxiliar é achatada nos insumos.
// Composição com algum insumo sem preço no regime fica de fora (sem preço fictício) e entra no relatório com o motivo.
// Puro: não toca em banco nem em rede.

export const REGIMES = ['COM_DESONERACAO', 'SEM_DESONERACAO'] as const;
export type Regime = (typeof REGIMES)[number];

export type ArquivosPacote = { insumos: string; composicoes: string; composicaoItens: string; precos: string; custos?: string | null };

export type Excluida = { codigo: string; descricao: string; motivo: string };
export type Divergencia = { codigo: string; calculado: number; fonte: number; diferencaPct: number };

export type ResultadoRegime = {
  regime: Regime;
  desonerado: boolean;
  insumos: number;
  composicoes: number;
  componentes: number;
  semPrecoInsumos: number;
  excluidas: Excluida[];
  /** Excluídas que a própria fonte ainda traz com custo (parte do custo atribuída a preço de São Paulo). */
  excluidasComCustoFonte: number;
  divergencias: Divergencia[];
  csv: string;
  /** Preço por código de insumo e conjunto de composições, para comparar com a tabela anterior. */
  precosInsumos: Map<string, number>;
  codigosComposicoes: Set<string>;
  /** Descrição de cada insumo e composição incluídos, para o resumo. */
  descricoes: Map<string, string>;
};

/** CSV com aspas (campo pode conter ';' entre aspas). Devolve linhas de campos, sem linhas vazias. */
export function linhasCsv(texto: string, sep = ';'): string[][] {
  const t = texto.replace(/^﻿/, '');
  const out: string[][] = [];
  let campo = '';
  let linha: string[] = [];
  let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          campo += '"';
          i++;
        } else aspas = false;
      } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) {
      linha.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      linha.push(campo);
      campo = '';
      if (linha.some((x) => x.trim() !== '')) out.push(linha);
      linha = [];
    } else campo += c;
  }
  linha.push(campo);
  if (linha.some((x) => x.trim() !== '')) out.push(linha);
  return out;
}

/** Linhas como objetos, com o cabeçalho em minúsculas. */
export function registros(texto: string): Record<string, string>[] {
  const [cab, ...corpo] = linhasCsv(texto);
  if (!cab) return [];
  const nomes = cab.map((c) => c.trim().toLowerCase());
  return corpo.map((l) => Object.fromEntries(nomes.map((n, i) => [n, (l[i] ?? '').trim()])));
}

const numero = (s: string | undefined): number | null => {
  const t = (s ?? '').trim();
  if (!t) return null;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : null;
};

/** Texto seguro para o CSV do sistema: sem ';' nem aspas nem quebra de linha. */
const limpo = (s: string) => s.replace(/[;"\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

type Item = { tipo: 'INSUMO' | 'COMPOSICAO'; codigo: string; coeficiente: number };
type Expansao = { ok: true; comps: Map<string, number> } | { ok: false; motivo: string };

export function converterPacote(p: ArquivosPacote, uf: string, regime: Regime): ResultadoRegime {
  const insumosMeta = new Map<string, { descricao: string; unidade: string; classificacao: string }>();
  for (const r of registros(p.insumos)) {
    if (r.codigo) insumosMeta.set(r.codigo, { descricao: r.descricao, unidade: r.unidade, classificacao: r.classificacao });
  }
  const composicoesMeta = new Map<string, { descricao: string; unidade: string; grupo: string }>();
  for (const r of registros(p.composicoes)) {
    if (r.codigo) composicoesMeta.set(r.codigo, { descricao: r.descricao, unidade: r.unidade, grupo: r.grupo });
  }
  // Preço por insumo no regime; null = o arquivo traz o insumo sem preço nesse regime.
  const precos = new Map<string, number | null>();
  for (const r of registros(p.precos)) {
    if (r.regime !== regime) continue;
    if (r.uf && r.uf !== uf) continue;
    precos.set(r.codigo_insumo, numero(r.preco));
  }
  const itens = new Map<string, Item[]>();
  for (const r of registros(p.composicaoItens)) {
    const tipo = r.tipo_item.toUpperCase() === 'INSUMO' ? 'INSUMO' : 'COMPOSICAO';
    const coef = numero(r.coeficiente) ?? 0;
    itens.set(r.composicao_codigo, [...(itens.get(r.composicao_codigo) ?? []), { tipo, codigo: r.item_codigo, coeficiente: coef }]);
  }
  const custosFonte = new Map<string, number | null>();
  if (p.custos) {
    for (const r of registros(p.custos)) {
      if (r.regime === regime && (!r.uf || r.uf === uf)) custosFonte.set(r.codigo_composicao, numero(r.custo));
    }
  }

  const memo = new Map<string, Expansao>();
  function expandir(codigo: string, pilha: Set<string>): Expansao {
    const pronta = memo.get(codigo);
    if (pronta) return pronta;
    if (pilha.has(codigo)) return { ok: false, motivo: `composição ${codigo} aparece dentro dela mesma` };
    if (!composicoesMeta.has(codigo)) return { ok: false, motivo: `composição ${codigo} não está no arquivo de composições` };
    const lista = itens.get(codigo) ?? [];
    if (!lista.length) return { ok: false, motivo: 'composição sem itens' };
    pilha.add(codigo);
    const comps = new Map<string, number>();
    let resultado: Expansao = { ok: true, comps };
    for (const it of lista) {
      if (it.tipo === 'INSUMO') {
        const preco = precos.get(it.codigo);
        if (preco === undefined || preco === null) {
          resultado = { ok: false, motivo: `insumo ${it.codigo} sem preço neste regime` };
          break;
        }
        comps.set(it.codigo, (comps.get(it.codigo) ?? 0) + it.coeficiente);
      } else {
        const sub = expandir(it.codigo, pilha);
        if (!sub.ok) {
          resultado = { ok: false, motivo: `${sub.motivo} (auxiliar ${it.codigo})` };
          break;
        }
        for (const [insumo, c] of sub.comps) comps.set(insumo, (comps.get(insumo) ?? 0) + c * it.coeficiente);
      }
    }
    pilha.delete(codigo);
    memo.set(codigo, resultado);
    return resultado;
  }

  const excluidas: Excluida[] = [];
  const divergencias: Divergencia[] = [];
  const incluidas: { codigo: string; comps: Map<string, number>; custoCalculado: number }[] = [];
  for (const codigo of [...composicoesMeta.keys()].sort()) {
    const r = expandir(codigo, new Set());
    const descricao = composicoesMeta.get(codigo)!.descricao;
    if (!r.ok) {
      excluidas.push({ codigo, descricao, motivo: r.motivo });
      continue;
    }
    if (!r.comps.size) {
      excluidas.push({ codigo, descricao, motivo: 'sem insumos após o desdobramento' });
      continue;
    }
    let custo = 0;
    for (const [insumo, c] of r.comps) custo += c * (precos.get(insumo) ?? 0);
    incluidas.push({ codigo, comps: r.comps, custoCalculado: custo });
    const fonte = custosFonte.get(codigo);
    if (fonte !== undefined && fonte !== null && fonte > 0) {
      const diferencaPct = (custo - fonte) / fonte;
      // Só conta diferença relevante: acima de 1% e de 5 centavos (arredondamento da fonte não conta).
      if (Math.abs(diferencaPct) > 0.01 && Math.abs(custo - fonte) > 0.05) divergencias.push({ codigo, calculado: round(custo, 2), fonte, diferencaPct: round(diferencaPct * 100, 2) });
    }
  }

  // Só entram insumos com preço neste regime e que existem no catálogo. Os demais ficam como "sem preço" no resumo.
  const insumosComPreco = [...insumosMeta.keys()].filter((c) => {
    const preco = precos.get(c);
    return preco !== undefined && preco !== null;
  });
  const precosInsumos = new Map<string, number>();
  for (const c of insumosComPreco) precosInsumos.set(c, precos.get(c)!);
  const semPrecoInsumos = [...insumosMeta.keys()].filter((c) => !precosInsumos.has(c)).length;
  const excluidasComCustoFonte = excluidas.filter((e) => {
    const c = custosFonte.get(e.codigo);
    return c !== undefined && c !== null;
  }).length;

  const linhas: string[] = ['tipo;codigo;descricao;unidade;preco;grupo;insumo;coeficiente'];
  for (const c of insumosComPreco.sort()) {
    const m = insumosMeta.get(c)!;
    linhas.push(`insumo;${c};${limpo(m.descricao)};${limpo(m.unidade)};${round(precosInsumos.get(c)!, 2).toFixed(2)};${limpo(m.classificacao)};;`);
  }
  let componentes = 0;
  for (const c of incluidas) {
    const m = composicoesMeta.get(c.codigo)!;
    linhas.push(`composicao;${c.codigo};${limpo(m.descricao)};${limpo(m.unidade)};;${limpo(m.grupo)};;`);
  }
  for (const c of incluidas) {
    for (const [insumo, coef] of c.comps) {
      componentes++;
      linhas.push(`componente;${c.codigo};;;;;${insumo};${round(coef, 6)}`);
    }
  }

  return {
    regime,
    desonerado: regime === 'COM_DESONERACAO',
    insumos: insumosComPreco.length,
    composicoes: incluidas.length,
    componentes,
    semPrecoInsumos,
    excluidas,
    excluidasComCustoFonte,
    divergencias: divergencias.sort((a, b) => Math.abs(b.diferencaPct) - Math.abs(a.diferencaPct)),
    csv: linhas.join('\n') + '\n',
    precosInsumos,
    codigosComposicoes: new Set(incluidas.map((c) => c.codigo)),
    descricoes: new Map([
      ...insumosComPreco.map((c) => [c, insumosMeta.get(c)!.descricao] as [string, string]),
      ...incluidas.map((c) => [c.codigo, composicoesMeta.get(c.codigo)!.descricao] as [string, string]),
    ]),
  };
}

const round = (n: number, casas: number) => Math.round(n * 10 ** casas) / 10 ** casas;
