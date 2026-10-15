// Montagem da DRE gerencial a partir dos valores por categoria e mês.
// Sinal: categoria de receita soma, de despesa subtrai. Cada linha mostra o valor com o sinal natural.

import type { LinhaDre } from './financeiro.ts';

export type CategoriaDre = { id: string; codigo: string; nome: string; tipo: 'receita' | 'despesa'; linha: LinhaDre };
export type ValorDre = { mes: string; categoriaId: string; centavos: number };
export type Regime = 'simples' | 'presumido' | 'real';
export type Aliquotas = Partial<Record<'simples' | 'pis' | 'cofins' | 'iss' | 'icms' | 'irpj' | 'csll', number>>;

type PorMes = Record<string, number>;
export type LinhaSaida = {
  chave: string;
  nome: string;
  tipo: 'grupo' | 'subtotal' | 'resultado';
  sinal: 1 | -1; // como a linha é lida: +receita / −custo
  valores: PorMes; // centavos com sinal (receitas positivas, despesas negativas)
  total: number;
  categorias: { id: string; codigo: string; nome: string; valores: PorMes; total: number }[];
  estimado?: boolean;
};

const GRUPOS: { linha: LinhaDre; nome: string; sinal: 1 | -1 }[] = [
  { linha: 'receita_bruta', nome: 'Receita bruta', sinal: 1 },
  { linha: 'deducoes', nome: '(−) Deduções e impostos sobre vendas', sinal: -1 },
  { linha: 'custo_producao', nome: '(−) Custo de produção de obras', sinal: -1 },
  { linha: 'custo_frota', nome: '(−) Custo da frota', sinal: -1 },
  { linha: 'custo_pessoal', nome: '(−) Custo de pessoal operacional', sinal: -1 },
  { linha: 'despesas_pessoal', nome: '(−) Despesas com pessoal administrativo', sinal: -1 },
  { linha: 'despesas_administrativas', nome: '(−) Despesas administrativas', sinal: -1 },
  { linha: 'despesas_comerciais', nome: '(−) Despesas comerciais', sinal: -1 },
  { linha: 'receitas_financeiras', nome: '(+) Receitas financeiras', sinal: 1 },
  { linha: 'despesas_financeiras', nome: '(−) Despesas financeiras', sinal: -1 },
  { linha: 'outras_receitas', nome: '(+) Outras receitas', sinal: 1 },
  { linha: 'outras_despesas', nome: '(−) Outras despesas', sinal: -1 },
  { linha: 'impostos_lucro', nome: '(−) IRPJ e CSLL', sinal: -1 },
];

// Ordem de apresentação: grupos intercalados com subtotais.
const ESTRUTURA: ({ grupo: LinhaDre } | { subtotal: string; nome: string; ate: LinhaDre[]; resultado?: boolean })[] = [
  { grupo: 'receita_bruta' },
  { grupo: 'deducoes' },
  { subtotal: 'receita_liquida', nome: '= Receita líquida', ate: ['receita_bruta', 'deducoes'] },
  { grupo: 'custo_producao' },
  { grupo: 'custo_frota' },
  { grupo: 'custo_pessoal' },
  { subtotal: 'lucro_bruto', nome: '= Lucro bruto', ate: ['receita_bruta', 'deducoes', 'custo_producao', 'custo_frota', 'custo_pessoal'] },
  { grupo: 'despesas_pessoal' },
  { grupo: 'despesas_administrativas' },
  { grupo: 'despesas_comerciais' },
  {
    subtotal: 'resultado_operacional',
    nome: '= Resultado operacional',
    ate: ['receita_bruta', 'deducoes', 'custo_producao', 'custo_frota', 'custo_pessoal', 'despesas_pessoal', 'despesas_administrativas', 'despesas_comerciais'],
  },
  { grupo: 'receitas_financeiras' },
  { grupo: 'despesas_financeiras' },
  { grupo: 'outras_receitas' },
  { grupo: 'outras_despesas' },
  {
    subtotal: 'resultado_antes_ir',
    nome: '= Resultado antes do IR e CSLL',
    ate: [
      'receita_bruta', 'deducoes', 'custo_producao', 'custo_frota', 'custo_pessoal', 'despesas_pessoal', 'despesas_administrativas',
      'despesas_comerciais', 'receitas_financeiras', 'despesas_financeiras', 'outras_receitas', 'outras_despesas',
    ],
  },
  { grupo: 'impostos_lucro' },
  { subtotal: 'resultado_liquido', nome: '= Resultado líquido', ate: GRUPOS.map((g) => g.linha), resultado: true },
];

const pct = (v: number | undefined) => (Number.isFinite(v) ? Number(v) / 100 : 0);

/** Impostos estimados pelo regime (centavos negativos), sobre a receita bruta ou o lucro. */
export function impostosEstimados(regime: Regime, a: Aliquotas, receitaBruta: number, resultadoAntesIr: number) {
  if (regime === 'simples') return { deducoes: -Math.round(receitaBruta * pct(a.simples)), lucro: 0 };
  const sobreVenda = pct(a.pis) + pct(a.cofins) + pct(a.iss) + pct(a.icms);
  const deducoes = -Math.round(receitaBruta * sobreVenda);
  const ir = pct(a.irpj) + pct(a.csll);
  if (regime === 'presumido') return { deducoes, lucro: -Math.round(receitaBruta * ir) };
  const base = resultadoAntesIr + deducoes; // lucro real já depois dos impostos sobre venda
  return { deducoes, lucro: base > 0 ? -Math.round(base * ir) : 0 };
}

export function montarDre(
  meses: string[],
  categorias: CategoriaDre[],
  valores: ValorDre[],
  opcoes: { impostos: 'lancados' | 'estimados'; regime: Regime; aliquotas: Aliquotas },
) {
  const porId = new Map(categorias.map((c) => [c.id, c]));
  const zero = (): PorMes => Object.fromEntries(meses.map((m) => [m, 0]));
  const grupos = new Map<LinhaDre, LinhaSaida>();
  for (const g of GRUPOS) grupos.set(g.linha, { chave: g.linha, nome: g.nome, tipo: 'grupo', sinal: g.sinal, valores: zero(), total: 0, categorias: [] });
  const fora: LinhaSaida = { chave: 'fora_dre', nome: 'Fora da DRE: investimentos, empréstimos e sócios', tipo: 'grupo', sinal: 1, valores: zero(), total: 0, categorias: [] };
  const catLinhas = new Map<string, LinhaSaida['categorias'][number]>();

  for (const v of valores) {
    const c = porId.get(v.categoriaId);
    if (!c || !meses.includes(v.mes) || !v.centavos) continue;
    const assinado = c.tipo === 'receita' ? v.centavos : -v.centavos;
    const destino = c.linha === 'fora_dre' ? fora : grupos.get(c.linha);
    if (!destino) continue;
    destino.valores[v.mes] += assinado;
    let cl = catLinhas.get(`${destino.chave}|${c.id}`);
    if (!cl) {
      cl = { id: c.id, codigo: c.codigo, nome: c.nome, valores: zero(), total: 0 };
      catLinhas.set(`${destino.chave}|${c.id}`, cl);
      destino.categorias.push(cl);
    }
    cl.valores[v.mes] += assinado;
  }

  // Impostos estimados pelo regime substituem os lançados nas duas linhas de imposto.
  if (opcoes.impostos === 'estimados') {
    const ded = grupos.get('deducoes')!;
    const ir = grupos.get('impostos_lucro')!;
    ded.categorias = [];
    ir.categorias = [];
    ded.estimado = true;
    ir.estimado = true;
    for (const m of meses) {
      const rb = grupos.get('receita_bruta')!.valores[m];
      const antesIr = GRUPOS.filter((g) => g.linha !== 'impostos_lucro' && g.linha !== 'deducoes').reduce((s, g) => s + grupos.get(g.linha)!.valores[m], 0);
      const e = impostosEstimados(opcoes.regime, opcoes.aliquotas, Math.max(rb, 0), antesIr);
      ded.valores[m] = e.deducoes;
      ir.valores[m] = e.lucro;
    }
  }

  const fechar = (l: LinhaSaida) => {
    l.total = meses.reduce((s, m) => s + l.valores[m], 0);
    for (const c of l.categorias) c.total = meses.reduce((s, m) => s + c.valores[m], 0);
    l.categorias.sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }));
    return l;
  };

  const linhas: LinhaSaida[] = [];
  for (const e of ESTRUTURA) {
    if ('grupo' in e) linhas.push(fechar(grupos.get(e.grupo)!));
    else {
      const valores = zero();
      for (const m of meses) valores[m] = e.ate.reduce((s, g) => s + grupos.get(g)!.valores[m], 0);
      linhas.push(fechar({ chave: e.subtotal, nome: e.nome, tipo: e.resultado ? 'resultado' : 'subtotal', sinal: 1, valores, total: 0, categorias: [] }));
    }
  }
  return { linhas, fora: fechar(fora) };
}

/** Lista de meses AAAA-MM entre de e ate (inclusive). */
export function mesesEntre(de: string, ate: string, maximo = 24): string[] {
  const r: string[] = [];
  let [a, m] = de.split('-').map(Number);
  const [a2, m2] = ate.split('-').map(Number);
  while ((a < a2 || (a === a2 && m <= m2)) && r.length < maximo) {
    r.push(`${a}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) (m = 1), a++;
  }
  return r;
}
