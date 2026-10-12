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
  servico: { codigo: string; unidade: string; quantidade: number; custoUnitario: number; itemId: string } | null;
};
export type InsumoComposicaoRel = { codigo: string; descricao: string; unidade: string; coeficiente: number; precoUnitario: number };
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
