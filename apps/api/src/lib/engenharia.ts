// Engenharia (Fase 1): regras puras de níveis da EAP, códigos e leitura do CSV das tabelas de referência.
// Formato do CSV (separador ;, primeira linha é o cabeçalho):
//   tipo;codigo;descricao;unidade;preco;grupo;insumo;coeficiente
//   insumo;CODIGO;descricao;unidade;preco;grupo;;
//   composicao;CODIGO;descricao;unidade;;grupo;;
//   componente;CODIGO_DA_COMPOSICAO;;;;;CODIGO_DO_INSUMO;coeficiente

export const NIVEIS_OBRA = ['obra', 'etapa', 'subetapa', 'tarefa'] as const;
export type NivelObra = (typeof NIVEIS_OBRA)[number];
export type NivelEap = Exclude<NivelObra, 'obra'>;

const POSICAO: Record<NivelEap, number> = { etapa: 1, subetapa: 2, tarefa: 3 };

/** Parâmetros do BDI calculado, em %: administração central, seguros, riscos, garantias, despesas financeiras, lucro e impostos. */
export const CAMPOS_BDI = ['ac', 's', 'r', 'g', 'df', 'l', 'i'] as const;
export type ParametrosBdi = Record<(typeof CAMPOS_BDI)[number], number>;

/** BDI = [(1+AC+S+R+G) x (1+DF) x (1+L)] / (1-I) - 1 (fórmula do TCU, Acórdão 2622/2013). Retorna % com duas casas. */
export function bdiCalculado(p: Partial<ParametrosBdi>): number {
  const f = (k: keyof ParametrosBdi) => (p[k] ?? 0) / 100;
  const bdi = ((1 + f('ac') + f('s') + f('r') + f('g')) * (1 + f('df')) * (1 + f('l'))) / (1 - f('i')) - 1;
  return Math.round(bdi * 10000) / 100;
}

/** Nível do nó novo na EAP, dado o pai e o nível de apropriação da obra. null = não é permitido. */
export function nivelDoNovoNo(apropriacao: NivelObra, pai: NivelEap | null): NivelEap | null {
  if (apropriacao === 'obra') return null;
  const proximo: Record<NivelEap, NivelEap | null> = { etapa: 'subetapa', subetapa: 'tarefa', tarefa: null };
  const nivel: NivelEap | null = pai === null ? 'etapa' : proximo[pai];
  if (!nivel) return null;
  return POSICAO[nivel] <= POSICAO[apropriacao as NivelEap] ? nivel : null;
}

/** Código hierárquico: 1, 1.2, 1.2.3. */
export function codigoDoNo(codigoPai: string | null, irmaos: number): string {
  return codigoPai ? `${codigoPai}.${irmaos + 1}` : `${irmaos + 1}`;
}

/** Número em pt-BR ("1.234,56") ou em formato com ponto ("1234.56"). */
export function numeroBr(texto: string | undefined): number | null {
  const s = (texto ?? '').trim();
  if (!s) return null;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : null;
}

// Planejamento (fase 2): datas em dias corridos. Uma atividade começa no seu início informado ou no dia seguinte ao fim da predecessora, o que for depois.
export type AtividadeCalc = { id: string; inicio: string; duracaoDias: number; predecessoraId: string | null };
const DIA_MS = 86_400_000;
const paraMs = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const paraIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Verdadeiro se alguma atividade depende de si mesma, direta ou indiretamente. */
export function temCiclo(atividades: AtividadeCalc[]): boolean {
  const predecessora = new Map(atividades.map((a) => [a.id, a.predecessoraId]));
  for (const a of atividades) {
    const vistos = new Set<string>();
    let atual: string | null = a.id;
    while (atual) {
      if (vistos.has(atual)) return true;
      vistos.add(atual);
      atual = predecessora.get(atual) ?? null;
    }
  }
  return false;
}

export function calcularDatas(atividades: AtividadeCalc[]): Map<string, { inicio: string; fim: string }> {
  const porId = new Map(atividades.map((a) => [a.id, a]));
  const prontas = new Map<string, { ini: number; fim: number }>();
  const calcular = (a: AtividadeCalc, pilha: Set<string>): { ini: number; fim: number } => {
    const pronta = prontas.get(a.id);
    if (pronta) return pronta;
    if (pilha.has(a.id)) throw new Error('Dependência circular no planejamento.');
    pilha.add(a.id);
    let ini = paraMs(a.inicio);
    const p = a.predecessoraId ? porId.get(a.predecessoraId) : undefined;
    if (p) ini = Math.max(ini, calcular(p, pilha).fim + DIA_MS);
    const r = { ini, fim: ini + (a.duracaoDias - 1) * DIA_MS };
    prontas.set(a.id, r);
    pilha.delete(a.id);
    return r;
  };
  const saida = new Map<string, { inicio: string; fim: string }>();
  for (const a of atividades) {
    const r = calcular(a, new Set());
    saida.set(a.id, { inicio: paraIso(r.ini), fim: paraIso(r.fim) });
  }
  return saida;
}

export type LinhaInsumo ={ codigo: string; descricao: string; unidade: string; precoCentavos: number; grupo: string | null };
export type LinhaComposicao = { codigo: string; descricao: string; unidade: string; grupo: string | null };
export type LinhaComponente = { composicao: string; insumo: string; coeficiente: number };
/** Estrutura original da composição (para conferência): itens diretos, insumos ou serviços auxiliares, com o multiplicador. */
export type LinhaEstrutura = { composicao: string; item: string; tipoItem: 'insumo' | 'composicao'; coeficiente: number };
export type LeituraCsv = { insumos: LinhaInsumo[]; composicoes: LinhaComposicao[]; componentes: LinhaComponente[]; estrutura: LinhaEstrutura[]; erros: string[] };

const COLUNAS = ['tipo', 'codigo', 'descricao', 'unidade', 'preco', 'grupo', 'insumo', 'coeficiente'] as const;

/** insumosExternos: códigos de insumos que já estão na tabela de destino (importação para tabela existente). */
export function lerCsvReferencia(texto: string, insumosExternos: Set<string> = new Set()): LeituraCsv {
  const leitura: LeituraCsv = { insumos: [], composicoes: [], componentes: [], estrutura: [], erros: [] };
  const linhas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!linhas.length) {
    leitura.erros.push('O arquivo está vazio.');
    return leitura;
  }
  const cab = linhas[0].split(';').map((c) => c.trim().toLowerCase());
  if (!COLUNAS.every((c) => cab.includes(c))) {
    leitura.erros.push(`O cabeçalho precisa ter as colunas: ${COLUNAS.join(';')}.`);
    return leitura;
  }
  const idx = Object.fromEntries(COLUNAS.map((c) => [c, cab.indexOf(c)])) as Record<(typeof COLUNAS)[number], number>;
  const vistos = new Set<string>();
  linhas.slice(1).forEach((linha, i) => {
    const n = i + 2;
    const c = linha.split(';').map((x) => x.trim());
    const v = (k: (typeof COLUNAS)[number]) => c[idx[k]] ?? '';
    const tipo = v('tipo').toLowerCase();
    const codigo = v('codigo');
    if (tipo === 'insumo' || tipo === 'composicao') {
      if (!codigo) return leitura.erros.push(`Linha ${n}: falta o código.`);
      if (!v('descricao')) return leitura.erros.push(`Linha ${n}: falta a descrição.`);
      if (!v('unidade')) return leitura.erros.push(`Linha ${n}: falta a unidade.`);
      const chave = `${tipo}:${codigo}`;
      if (vistos.has(chave)) return leitura.erros.push(`Linha ${n}: código ${codigo} repetido.`);
      vistos.add(chave);
      const base = { codigo, descricao: v('descricao'), unidade: v('unidade'), grupo: v('grupo') || null };
      if (tipo === 'insumo') {
        const preco = numeroBr(v('preco'));
        if (preco === null || preco < 0) return leitura.erros.push(`Linha ${n}: preço inválido para o insumo ${codigo}.`);
        leitura.insumos.push({ ...base, precoCentavos: Math.round(preco * 100) });
      } else {
        leitura.composicoes.push(base);
      }
    } else if (tipo === 'componente') {
      const coeficiente = numeroBr(v('coeficiente'));
      if (!codigo || !v('insumo')) return leitura.erros.push(`Linha ${n}: o componente precisa de composição e insumo.`);
      if (coeficiente === null || coeficiente < 0) return leitura.erros.push(`Linha ${n}: coeficiente inválido.`);
      leitura.componentes.push({ composicao: codigo, insumo: v('insumo'), coeficiente });
    } else if (tipo === 'item_insumo' || tipo === 'item_composicao') {
      // Estrutura da composição para conferência; o preço continua vindo dos componentes (insumos desdobrados).
      const coeficiente = numeroBr(v('coeficiente'));
      if (!codigo || !v('insumo') || coeficiente === null || coeficiente < 0) return leitura.erros.push(`Linha ${n}: item da estrutura inválido.`);
      leitura.estrutura.push({ composicao: codigo, item: v('insumo'), tipoItem: tipo === 'item_insumo' ? 'insumo' : 'composicao', coeficiente });
    } else {
      leitura.erros.push(`Linha ${n}: tipo "${tipo || '(vazio)'}" desconhecido (use insumo, composicao ou componente).`);
    }
  });
  // Componentes precisam apontar para insumos e composições do próprio arquivo.
  const insumos = new Set(leitura.insumos.map((x) => x.codigo));
  const composicoes = new Set(leitura.composicoes.map((x) => x.codigo));
  for (const k of leitura.componentes) {
    if (!composicoes.has(k.composicao)) leitura.erros.push(`Componente: a composição ${k.composicao} não existe no arquivo.`);
    if (!insumos.has(k.insumo) && !insumosExternos.has(k.insumo)) leitura.erros.push(`Componente: o insumo ${k.insumo} não existe no arquivo nem na tabela.`);
  }
  return leitura;
}

/**
 * Orçamento: só entram serviços (composições) que estão na obra. Insumo isolado não é orçado;
 * ele entra pelos serviços ou é apropriado em "Apropriação de insumos".
 * Devolve a mensagem de erro, ou null quando o item pode ser orçado.
 */
export function erroItemOrcamento(item: { tipo: string; obraId: string } | null | undefined, obraId: string): string | null {
  if (!item || item.obraId !== obraId) return 'Este serviço não está na obra. Copie-o em Serviços antes de orçar.';
  if (item.tipo !== 'composicao') return 'Só serviços (composições) da obra entram no orçamento. Insumos são lançados em Apropriação de insumos.';
  return null;
}

// ---------------------------------------------------------------- planilha orçamentária (EAP e orçamento juntos)

/** Níveis da planilha: 1 Obra, 2 Etapa, 3 Sub Etapa, 4 Tarefa. Serviço só na Tarefa. */
export const NIVEIS_PLANILHA = ['obra', 'etapa', 'subetapa', 'tarefa'] as const;
export type NivelPlanilha = (typeof NIVEIS_PLANILHA)[number];
export const POSICAO_PLANILHA: Record<NivelPlanilha, number> = { obra: 1, etapa: 2, subetapa: 3, tarefa: 4 };
export const ROTULO_PLANILHA: Record<NivelPlanilha, string> = { obra: 'Obra', etapa: 'Etapa', subetapa: 'Sub Etapa', tarefa: 'Tarefa' };

/** Compara códigos hierárquicos numericamente (1.2 antes de 1.10). */
export function compararCodigo(a: string, b: string): number {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? -1) - (y[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

/**
 * Folhas da EAP (linhas sem nenhuma linha abaixo delas), na ordem da planilha.
 * O planejamento gera uma atividade por folha: é onde os serviços da obra ficam.
 */
export function folhasDaEap<T extends { id: string; paiId: string | null; codigo: string }>(linhas: T[]): T[] {
  const pais = new Set(linhas.map((l) => l.paiId).filter((x): x is string => !!x));
  return [...linhas].sort((a, b) => compararCodigo(a.codigo, b.codigo)).filter((l) => !pais.has(l.id));
}

/**
 * Pai de uma linha acrescentada no fim da planilha: a última linha (na ordem da planilha) de nível acima do da nova.
 * Sem nenhuma, a linha fica na raiz. Ex.: depois de "1 Obra / 1.1 Etapa / 1.1.1 Tarefa", uma Etapa vai para dentro de "1".
 */
export function paiAutomatico(linhas: { id: string; nivel: NivelPlanilha; codigo: string }[], nivel: NivelPlanilha): string | null {
  const ordenadas = [...linhas].sort((a, b) => compararCodigo(a.codigo, b.codigo));
  for (let i = ordenadas.length - 1; i >= 0; i--) if (POSICAO_PLANILHA[ordenadas[i].nivel] < POSICAO_PLANILHA[nivel]) return ordenadas[i].id;
  return null;
}

/** O pai precisa ser de nível acima (Obra › Etapa › Sub Etapa › Tarefa); pode pular níveis. Devolve o erro ou null. */
export function erroPaiPlanilha(nivelPai: NivelPlanilha | null, nivel: NivelPlanilha): string | null {
  if (!nivelPai) return null;
  if (POSICAO_PLANILHA[nivelPai] >= POSICAO_PLANILHA[nivel]) {
    return `Uma linha de ${ROTULO_PLANILHA[nivel]} não pode ficar dentro de uma ${ROTULO_PLANILHA[nivelPai]}.`;
  }
  return null;
}

/** Serviço só entra em linha de Tarefa. Devolve o erro ou null. */
export function erroServicoNaLinha(nivel: NivelPlanilha, temServico: boolean): string | null {
  return temServico && nivel !== 'tarefa' ? 'Serviço só pode ser lançado numa linha de Tarefa.' : null;
}

/** Total de cada linha: o valor dela (serviço da tarefa) mais o de todas as linhas abaixo dela. */
export function totaisPlanilha(linhas: { id: string; paiId: string | null; valor: number }[]): Map<string, number> {
  const filhos = new Map<string | null, string[]>();
  for (const l of linhas) filhos.set(l.paiId, [...(filhos.get(l.paiId) ?? []), l.id]);
  const valor = new Map(linhas.map((l) => [l.id, l.valor]));
  const total = new Map<string, number>();
  const somar = (id: string, pilha: Set<string>): number => {
    const pronto = total.get(id);
    if (pronto !== undefined) return pronto;
    if (pilha.has(id)) return 0;
    pilha.add(id);
    let t = valor.get(id) ?? 0;
    for (const f of filhos.get(id) ?? []) t += somar(f, pilha);
    t = Math.round(t * 100) / 100;
    total.set(id, t);
    return t;
  };
  for (const l of linhas) somar(l.id, new Set());
  return total;
}

// ---------------------------------------------------------------- relatório de orçamento (sintético e analítico)

export type LinhaPlanilhaRel = {
  id: string;
  paiId: string | null;
  nivel: NivelPlanilha;
  codigo: string;
  descricao: string;
  servico: { codigo: string; unidade: string; quantidade: number; custoUnitario: number; itemId: string; descricaoServico?: string } | null;
};
export type InsumoComposicaoRel = { codigo: string; descricao: string; unidade: string; coeficiente: number; precoUnitario: number; grupo?: string | null };
export type LinhaRelatorio =
  | { tipo: 'grupo'; nivel: NivelPlanilha; item: string; descricao: string; total: number; peso: number }
  | { tipo: 'servico'; nivel: 'tarefa'; item: string; codigo: string; descricao: string; unidade: string; quantidade: number; custoUnitario: number; precoUnitario: number; total: number; peso: number }
  | { tipo: 'insumo'; codigo: string; descricao: string; unidade: string; coeficiente: number; quantidade: number; custoUnitario: number; custoTotal: number }
  | { tipo: 'tarefa'; nivel: 'tarefa'; item: string; descricao: string };

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Monta o relatório de orçamento, como nos modelos de mercado (SIENGE, planilhas do TCU):
 * linhas da EAP com o total de cada grupo, serviços com custo unitário, preço unitário com BDI e preço total, e o peso (%).
 * No analítico, abaixo de cada serviço, os insumos da composição com coeficiente, quantidade (coeficiente × quantidade do
 * serviço), custo unitário e custo total.
 */
export function montarRelatorioOrcamento(
  linhas: LinhaPlanilhaRel[],
  bdiPercentual: number,
  analitico: boolean,
  composicoes: Map<string, InsumoComposicaoRel[]> = new Map(),
): { linhas: LinhaRelatorio[]; custoTotal: number; precoTotal: number; bdiValor: number } {
  const fator = 1 + bdiPercentual / 100;
  const ordenadas = [...linhas].sort((a, b) => compararCodigo(a.codigo, b.codigo));
  const precoLinha = new Map<string, number>();
  let custoTotal = 0;
  for (const l of ordenadas) {
    if (!l.servico) continue;
    const precoUnit = r2(l.servico.custoUnitario * fator);
    precoLinha.set(l.id, r2(l.servico.quantidade * precoUnit));
    custoTotal += r2(l.servico.quantidade * l.servico.custoUnitario);
  }
  const totais = totaisPlanilha(ordenadas.map((l) => ({ id: l.id, paiId: l.paiId, valor: precoLinha.get(l.id) ?? 0 })));
  const precoTotal = r2([...ordenadas].filter((l) => !l.paiId || !ordenadas.some((o) => o.id === l.paiId)).reduce((s, l) => s + (totais.get(l.id) ?? 0), 0));
  const peso = (v: number) => (precoTotal > 0 ? Math.round((v / precoTotal) * 10000) / 100 : 0);

  const saida: LinhaRelatorio[] = [];
  for (const l of ordenadas) {
    if (l.servico) {
      const precoUnit = r2(l.servico.custoUnitario * fator);
      const total = precoLinha.get(l.id) ?? 0;
      saida.push({ tipo: 'servico', nivel: 'tarefa', item: l.codigo, codigo: l.servico.codigo, descricao: l.descricao, unidade: l.servico.unidade, quantidade: l.servico.quantidade, custoUnitario: l.servico.custoUnitario, precoUnitario: precoUnit, total, peso: peso(total) });
      if (analitico) {
        for (const k of composicoes.get(l.servico.itemId) ?? []) {
          const quantidade = Math.round(k.coeficiente * l.servico.quantidade * 1e6) / 1e6;
          saida.push({ tipo: 'insumo', codigo: k.codigo, descricao: k.descricao, unidade: k.unidade, coeficiente: k.coeficiente, quantidade, custoUnitario: k.precoUnitario, custoTotal: r2(quantidade * k.precoUnitario) });
        }
      }
    } else if (l.nivel === 'tarefa') {
      saida.push({ tipo: 'tarefa', nivel: 'tarefa', item: l.codigo, descricao: l.descricao });
    } else {
      const total = totais.get(l.id) ?? 0;
      saida.push({ tipo: 'grupo', nivel: l.nivel, item: l.codigo, descricao: l.descricao, total, peso: peso(total) });
    }
  }
  custoTotal = r2(custoTotal);
  return { linhas: saida, custoTotal, precoTotal, bdiValor: r2(precoTotal - custoTotal) };
}

/**
 * Troca do nível de uma linha da planilha. O novo nível precisa ficar abaixo do da linha de cima e acima do das linhas
 * de baixo; linha com serviço continua Tarefa. Devolve o erro ou null.
 */
export function erroMudarNivel(nivelPai: NivelPlanilha | null, novo: NivelPlanilha, niveisFilhos: NivelPlanilha[], temServico: boolean): string | null {
  const erroPai = erroPaiPlanilha(nivelPai, novo);
  if (erroPai) return erroPai;
  const filho = niveisFilhos.find((f) => POSICAO_PLANILHA[f] <= POSICAO_PLANILHA[novo]);
  if (filho) return `Esta linha tem ${ROTULO_PLANILHA[filho]} abaixo dela; ela não pode virar ${ROTULO_PLANILHA[novo]}.`;
  if (temServico && novo !== 'tarefa') return 'Esta linha tem serviço lançado. Retire o serviço antes de mudar o nível.';
  return null;
}

// ---------------------------------------------------------------- curva ABC (serviços e insumos)

export type ItemAbc = { codigo: string; descricao: string; unidade: string; quantidade: number; precoUnitario: number; total: number };
export type LinhaAbc = ItemAbc & { posicao: number; percentual: number; acumulado: number; classe: 'A' | 'B' | 'C' };

/** Limites usuais da curva ABC: classe A até 80% do valor acumulado, B até 95%, C o restante. */
export const LIMITES_ABC = { A: 80, B: 95 } as const;

/**
 * Curva ABC: ordena do maior para o menor valor, com percentual e acumulado. A classe é decidida pelo acumulado
 * antes do item: quem começa abaixo de 80% é A (o item que cruza os 80% ainda é A), abaixo de 95% é B, o resto C.
 */
export function curvaAbc(itens: ItemAbc[]): { linhas: LinhaAbc[]; total: number; classes: Record<'A' | 'B' | 'C', { itens: number; valor: number; percentual: number }> } {
  const ordenados = itens.filter((i) => i.total > 0).sort((a, b) => b.total - a.total || a.codigo.localeCompare(b.codigo));
  const total = r2(ordenados.reduce((s, i) => s + i.total, 0));
  const classes = { A: { itens: 0, valor: 0, percentual: 0 }, B: { itens: 0, valor: 0, percentual: 0 }, C: { itens: 0, valor: 0, percentual: 0 } };
  let acumuladoValor = 0;
  const linhas = ordenados.map((i, n) => {
    const antes = total > 0 ? (acumuladoValor / total) * 100 : 0;
    acumuladoValor += i.total;
    const classe: 'A' | 'B' | 'C' = antes < LIMITES_ABC.A ? 'A' : antes < LIMITES_ABC.B ? 'B' : 'C';
    classes[classe].itens++;
    classes[classe].valor += i.total;
    return {
      ...i,
      posicao: n + 1,
      percentual: total > 0 ? Math.round((i.total / total) * 10000) / 100 : 0,
      acumulado: total > 0 ? Math.round((acumuladoValor / total) * 10000) / 100 : 0,
      classe,
    };
  });
  for (const k of ['A', 'B', 'C'] as const) {
    classes[k].valor = r2(classes[k].valor);
    classes[k].percentual = total > 0 ? Math.round((classes[k].valor / total) * 10000) / 100 : 0;
  }
  return { linhas, total, classes };
}

/** Serviços do orçamento somados por serviço (o mesmo serviço em várias Tarefas vira uma linha), com preço com BDI. */
export function abcServicos(linhas: LinhaPlanilhaRel[], bdiPercentual: number): ItemAbc[] {
  const fator = 1 + bdiPercentual / 100;
  const porServico = new Map<string, ItemAbc>();
  for (const l of linhas) {
    if (!l.servico) continue;
    const precoUnitario = r2(l.servico.custoUnitario * fator);
    const atual = porServico.get(l.servico.itemId);
    const total = r2(l.servico.quantidade * precoUnitario);
    if (atual) {
      atual.quantidade += l.servico.quantidade;
      atual.total = r2(atual.total + total);
    } else {
      porServico.set(l.servico.itemId, { codigo: l.servico.codigo, descricao: l.servico.descricaoServico ?? l.descricao, unidade: l.servico.unidade, quantidade: l.servico.quantidade, precoUnitario, total });
    }
  }
  return [...porServico.values()];
}

/** Insumos de todos os serviços: quantidade = coeficiente × quantidade do serviço, somada por insumo; valor em custo direto. */
export function abcInsumos(linhas: LinhaPlanilhaRel[], composicoes: Map<string, InsumoComposicaoRel[]>): ItemAbc[] {
  const porInsumo = new Map<string, ItemAbc>();
  for (const l of linhas) {
    if (!l.servico) continue;
    for (const k of composicoes.get(l.servico.itemId) ?? []) {
      const quantidade = k.coeficiente * l.servico.quantidade;
      const atual = porInsumo.get(k.codigo);
      if (atual) atual.quantidade += quantidade;
      else porInsumo.set(k.codigo, { codigo: k.codigo, descricao: k.descricao, unidade: k.unidade, quantidade, precoUnitario: k.precoUnitario, total: 0 });
    }
  }
  for (const i of porInsumo.values()) {
    i.quantidade = Math.round(i.quantidade * 1e6) / 1e6;
    i.total = r2(i.quantidade * i.precoUnitario);
  }
  return [...porInsumo.values()];
}

// ---------------------------------------------------------------- planilha: mover linhas e renumerar

type NoOrdem = { id: string; paiId: string | null; codigo: string };

/**
 * Numeração da planilha a partir da ordem atual: irmãos em ordem de código, numerados 1, 2, 3… e os filhos herdam o
 * código do pai (1.2, 1.2.1…). Fecha buracos deixados por exclusões. Devolve o novo código de cada linha.
 */
export function renumerar(nos: NoOrdem[], ordem?: Map<string | null, string[]>): Map<string, string> {
  const filhos = ordem ?? new Map<string | null, string[]>();
  if (!ordem) {
    for (const n of [...nos].sort((a, b) => compararCodigo(a.codigo, b.codigo))) filhos.set(n.paiId, [...(filhos.get(n.paiId) ?? []), n.id]);
  }
  const codigos = new Map<string, string>();
  const visitar = (pai: string | null, prefixo: string) => {
    (filhos.get(pai) ?? []).forEach((id, i) => {
      const codigo = prefixo ? `${prefixo}.${i + 1}` : `${i + 1}`;
      codigos.set(id, codigo);
      visitar(id, codigo);
    });
  };
  visitar(null, '');
  return codigos;
}

/**
 * Sobe ou desce uma linha entre as irmãs (mesma linha de cima), levando junto tudo o que está abaixo dela,
 * e renumera a planilha. Devolve null quando não há para onde mover.
 */
export function moverLinha(nos: NoOrdem[], id: string, direcao: 'cima' | 'baixo'): Map<string, string> | null {
  const alvo = nos.find((n) => n.id === id);
  if (!alvo) return null;
  const filhos = new Map<string | null, string[]>();
  for (const n of [...nos].sort((a, b) => compararCodigo(a.codigo, b.codigo))) filhos.set(n.paiId, [...(filhos.get(n.paiId) ?? []), n.id]);
  const irmaos = filhos.get(alvo.paiId)!;
  const i = irmaos.indexOf(id);
  const j = direcao === 'cima' ? i - 1 : i + 1;
  if (j < 0 || j >= irmaos.length) return null;
  [irmaos[i], irmaos[j]] = [irmaos[j], irmaos[i]];
  return renumerar(nos, filhos);
}

// Formação do preço: administração, imprevistos e custo financeiro incidem sobre custo direto + indireto;
// impostos e lucratividade incidem sobre essa base somada àqueles três.
export type PercentuaisPreco = { administracao: number; imprevistos: number; financeiro: number; lucro: number };
export function formacaoPreco(direto: number, indiretos: number, pct: PercentuaisPreco, impostos: number[]) {
  const r = (n: number) => Math.round(n * 100) / 100;
  const base1 = direto + indiretos;
  const administracao = r((base1 * pct.administracao) / 100);
  const imprevistos = r((base1 * pct.imprevistos) / 100);
  const financeiro = r((base1 * pct.financeiro) / 100);
  const base2 = r(base1 + administracao + imprevistos + financeiro);
  const percImpostos = impostos.reduce((s, p) => s + p, 0);
  const valorImpostos = r((base2 * percImpostos) / 100);
  const lucro = r((base2 * pct.lucro) / 100);
  const precoVenda = r(base2 + valorImpostos + lucro);
  // BDI calculado: preço de venda sobre custo direto, menos 1, em percentual.
  const bdi = direto > 0 ? Math.round((precoVenda / direto - 1) * 10000) / 100 : 0;
  return { base1: r(base1), administracao, imprevistos, financeiro, base2, impostos: valorImpostos, lucro, precoVenda, bdi };
}

// Simples Nacional (LC 123/2006): alíquota nominal de cada faixa (1 a 6) por anexo.
export const ANEXOS_SIMPLES = ['I', 'II', 'III', 'IV', 'V'] as const;
export type AnexoSimples = (typeof ANEXOS_SIMPLES)[number];
const ALIQUOTAS_SIMPLES: Record<AnexoSimples, number[]> = {
  I: [4, 7.3, 9.5, 10.7, 14.3, 19],
  II: [4.5, 7.8, 10, 11.2, 14.7, 30],
  III: [6, 11.2, 13.5, 16, 21, 33],
  IV: [4.5, 9, 10.2, 14, 22, 33],
  V: [15.5, 18, 19.5, 20.5, 23, 30.5],
};
/** Alíquota nominal (%) da faixa escolhida no cadastro da empresa; null se não houver enquadramento. */
export function aliquotaSimples(anexo: string | null | undefined, faixa: number | null | undefined): number | null {
  if (!anexo || !faixa) return null;
  const lista = ALIQUOTAS_SIMPLES[anexo as AnexoSimples];
  return lista && faixa >= 1 && faixa <= 6 ? lista[faixa - 1] : null;
}

/** Nós da EAP que têm filhos (etapas e subetapas). */
export function resumosDaEap(nos: { id: string; paiId: string | null }[]): Set<string> {
  return new Set(nos.filter((n) => n.paiId).map((n) => n.paiId as string));
}

/**
 * Atividade ligada a uma etapa ou subetapa é um resumo: início e fim são os das atividades abaixo dela na EAP.
 * O custo não é somado aqui (ele continua vindo só dos itens lançados em cada nó), então não há duplicidade.
 */
export function datasComResumos(
  datas: Map<string, { inicio: string; fim: string }>,
  atividades: { id: string; eapNoId: string | null }[],
  nos: { id: string; paiId: string | null }[],
): Map<string, { inicio: string; fim: string }> {
  const filhos = new Map<string, string[]>();
  for (const n of nos) if (n.paiId) filhos.set(n.paiId, [...(filhos.get(n.paiId) ?? []), n.id]);
  const atividadePorNo = new Map<string, string>();
  for (const a of atividades) if (a.eapNoId) atividadePorNo.set(a.eapNoId, a.id);
  const saida = new Map(datas);
  for (const a of atividades) {
    if (!a.eapNoId || !filhos.has(a.eapNoId)) continue;
    const abaixo: { inicio: string; fim: string }[] = [];
    const pilha = [...(filhos.get(a.eapNoId) ?? [])];
    while (pilha.length) {
      const no = pilha.pop()!;
      // Só as tarefas (nós sem filhos) contam: resumos intermediários não têm datas próprias confiáveis.
      const d = !filhos.has(no) && atividadePorNo.get(no) ? datas.get(atividadePorNo.get(no)!) : undefined;
      if (d) abaixo.push(d);
      pilha.push(...(filhos.get(no) ?? []));
    }
    if (!abaixo.length) continue;
    saida.set(a.id, {
      inicio: abaixo.reduce((m, d) => (d.inicio < m ? d.inicio : m), abaixo[0].inicio),
      fim: abaixo.reduce((m, d) => (d.fim > m ? d.fim : m), abaixo[0].fim),
    });
  }
  return saida;
}

export type ClasseCusto = 'material' | 'mao_obra' | 'equipamento' | 'outros';
export const ROTULO_CLASSE_CUSTO: Record<ClasseCusto, string> = {
  material: 'Material',
  mao_obra: 'Mão de obra',
  equipamento: 'Equipamento',
  outros: 'Outros (terceirizados e sem classe)',
};

/** Classe do insumo a partir do grupo da tabela (ex.: Material, Mao_obra, Equipamento, Terceirizados). */
export function classeDoGrupo(grupo: string | null | undefined): ClasseCusto {
  const g = (grupo ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (g.includes('equip')) return 'equipamento';
  if (g.includes('mao')) return 'mao_obra';
  if (g.includes('material')) return 'material';
  return 'outros';
}

export type LinhaCustoServico = {
  item: string; codigo: string; descricao: string; unidade: string; quantidade: number; precoUnitario: number;
  material: number; mao_obra: number; equipamento: number; outros: number; total: number;
};
export type RelatorioCustos = {
  classes: { classe: ClasseCusto; rotulo: string; valor: number; peso: number }[];
  servicos: LinhaCustoServico[];
  precoTotal: number;
  bdiValor: number;
};

/**
 * Custos por classe (material, mão de obra, equipamento) com base no preço de venda: o preço de cada serviço
 * (custo com BDI) é dividido entre as classes na proporção do custo dos insumos da composição. Os totais batem
 * com o orçamento sintético.
 */
export function montarRelatorioCustos(
  linhas: LinhaPlanilhaRel[],
  bdiPercentual: number,
  composicoes: Map<string, InsumoComposicaoRel[]>,
): RelatorioCustos {
  const fator = 1 + bdiPercentual / 100;
  const servicos: LinhaCustoServico[] = [];
  const somaClasse: Record<ClasseCusto, number> = { material: 0, mao_obra: 0, equipamento: 0, outros: 0 };
  const ordenadas = linhas.filter((l) => l.servico).sort((a, b) => compararCodigo(a.codigo, b.codigo));
  for (const l of ordenadas) {
    const sv = l.servico!;
    const precoUnitario = r2(sv.custoUnitario * fator);
    const total = r2(sv.quantidade * precoUnitario);
    const custo: Record<ClasseCusto, number> = { material: 0, mao_obra: 0, equipamento: 0, outros: 0 };
    for (const i of composicoes.get(sv.itemId) ?? []) custo[classeDoGrupo(i.grupo)] += i.coeficiente * i.precoUnitario;
    const base = custo.material + custo.mao_obra + custo.equipamento + custo.outros;
    const parte = (k: ClasseCusto) => (base > 0 ? r2((total * custo[k]) / base) : 0);
    const material = parte('material');
    const mao_obra = parte('mao_obra');
    const equipamento = parte('equipamento');
    // Sem composição, todo o preço vai para "outros"; o arredondamento também cai em "outros" para o total bater.
    const outros = r2(total - material - mao_obra - equipamento);
    servicos.push({ item: l.codigo, codigo: sv.codigo, descricao: l.descricao, unidade: sv.unidade, quantidade: sv.quantidade, precoUnitario, material, mao_obra, equipamento, outros, total });
    somaClasse.material += material;
    somaClasse.mao_obra += mao_obra;
    somaClasse.equipamento += equipamento;
    somaClasse.outros += outros;
  }
  const precoTotal = r2(Object.values(somaClasse).reduce((s, v) => s + v, 0));
  const classes = (Object.keys(somaClasse) as ClasseCusto[]).map((classe) => ({
    classe,
    rotulo: ROTULO_CLASSE_CUSTO[classe],
    valor: r2(somaClasse[classe]),
    peso: precoTotal > 0 ? Math.round((somaClasse[classe] / precoTotal) * 10000) / 100 : 0,
  }));
  const custoDireto = r2(ordenadas.reduce((s, l) => s + r2(l.servico!.quantidade * l.servico!.custoUnitario), 0));
  return { classes, servicos, precoTotal, bdiValor: r2(precoTotal - custoDireto) };
}
