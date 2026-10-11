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
