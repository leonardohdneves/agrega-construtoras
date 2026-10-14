// Acompanhamento de obra: medições físicas e relatórios de análise (Curva S, previsto x realizado, avanço físico).
// Funções puras. Valores em centavos (custo direto, sem BDI). Datas em ISO (AAAA-MM-DD), em UTC.
//
// Conceitos (padrão de gestão de projetos, também usado em ferramentas como o Sienge):
// - PREVISTO (PV): custo das atividades do planejamento distribuído linearmente nos dias de cada atividade.
// - EXECUTADO (EV, valor agregado): % medido de cada linha × custo direto da linha.
// - REALIZADO (AC): despesas confirmadas apropriadas ao centro de custo da obra, pela competência.

const DIA_MS = 86_400_000;
const paraMs = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const paraIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const diasEntre = (a: string, b: string) => Math.round((paraMs(b) - paraMs(a)) / DIA_MS);
export const somarDias = (iso: string, n: number) => paraIso(paraMs(iso) + n * DIA_MS);
const limitar = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** % executado a partir de uma quantidade medida na unidade do serviço (limitado a 100%). */
export function percentualDeQuantidade(executada: number, orcada: number): number {
  if (orcada <= 0) return 0;
  return limitar((executada / orcada) * 100, 0, 100);
}

export type Medicao = { data: string; itens: Map<string, number> }; // linha da EAP (folha) -> % acumulado
export type AtividadePlan = { eapNoId: string | null; inicio: string; fim: string; custo: number };
export type NoEap = { id: string; paiId: string | null; codigo: string; nivel: string; descricao: string };

/** Último % informado de cada folha até a data (medições são acumuladas: o valor mais recente vale). */
export function percentuaisEm(medicoes: Medicao[], data: string): Map<string, number> {
  const saida = new Map<string, { pct: number; data: string }>();
  for (const m of medicoes) {
    if (m.data > data) continue;
    for (const [no, pct] of m.itens) {
      const atual = saida.get(no);
      if (!atual || m.data >= atual.data) saida.set(no, { pct, data: m.data });
    }
  }
  return new Map([...saida].map(([no, v]) => [no, v.pct]));
}

/** Valor executado (EV) até a data: soma de % × custo direto de cada folha. */
export function valorExecutadoEm(custos: Map<string, number>, medicoes: Medicao[], data: string): number {
  const pcts = percentuaisEm(medicoes, data);
  let total = 0;
  for (const [no, pct] of pcts) total += ((custos.get(no) ?? 0) * pct) / 100;
  return total;
}

/** Valor previsto (PV) até a data: cada atividade distribui o custo linearmente nos dias de duração. */
export function valorPrevistoEm(atividades: AtividadePlan[], data: string): number {
  let total = 0;
  for (const a of atividades) {
    const dias = diasEntre(a.inicio, a.fim) + 1;
    if (dias <= 0) continue;
    const passados = limitar(diasEntre(a.inicio, data) + 1, 0, dias);
    total += (a.custo * passados) / dias;
  }
  return total;
}

/** Último dia de cada mês entre duas datas (inclusive). */
export function fimsDeMes(de: string, ate: string): string[] {
  const saida: string[] = [];
  let ano = Number(de.slice(0, 4));
  let mes = Number(de.slice(5, 7));
  for (;;) {
    const fim = paraIso(Date.UTC(ano, mes, 0));
    if (fim >= de) {
      if (fim > ate) break;
      saida.push(fim);
    }
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
    if (ano > 9999) break;
  }
  return saida;
}

export type PontoCurva = { data: string; previsto: number; executado: number | null; realizado: number | null };

/**
 * Curva S mensal. Executado e realizado só aparecem até hoje (depois disso são futuro).
 * Executado: valor agregado até cada mês. Realizado: despesas acumuladas até cada mês.
 */
export function curvaS(args: {
  custos: Map<string, number>; medicoes: Medicao[]; atividades: AtividadePlan[];
  despesas: { data: string; valor: number }[]; de: string; ate: string; hoje: string;
}): PontoCurva[] {
  const { custos, medicoes, atividades, despesas, de, ate, hoje } = args;
  const pontos = fimsDeMes(de, ate);
  const ultimaMedicao = medicoes.reduce((m, x) => (x.data > m ? x.data : m), '');
  return pontos.map((data) => {
    const passado = data <= hoje;
    return {
      data,
      previsto: Math.round(valorPrevistoEm(atividades, data)),
      executado: passado && ultimaMedicao ? Math.round(valorExecutadoEm(custos, medicoes, data)) : null,
      realizado: passado ? Math.round(despesas.filter((d) => d.data <= data).reduce((s, d) => s + d.valor, 0)) : null,
    };
  });
}

export type LinhaPrevistoRealizado = {
  id: string; codigo: string; descricao: string; nivel: string;
  custoPrevisto: number; previstoAte: number; executado: number; percentualExecutado: number; saldo: number; spi: number | null;
};

/**
 * Previsto x executado por nó da EAP, na data de referência (em geral a última medição).
 * Cada nó soma as folhas que estão abaixo dele.
 */
export function previstoXExecutado(args: {
  nos: NoEap[]; custos: Map<string, number>; medicoes: Medicao[]; atividades: AtividadePlan[]; dataRef: string;
}): LinhaPrevistoRealizado[] {
  const { nos, custos, medicoes, atividades, dataRef } = args;
  const filhos = new Map<string, string[]>();
  for (const n of nos) if (n.paiId) filhos.set(n.paiId, [...(filhos.get(n.paiId) ?? []), n.id]);
  // Folhas abaixo de um nó (o próprio nó, se for folha).
  const folhasDe = (id: string): string[] => {
    const f = filhos.get(id);
    if (!f?.length) return [id];
    return f.flatMap((c) => folhasDe(c));
  };
  const pcts = percentuaisEm(medicoes, dataRef);
  return nos
    .map((n) => {
      const folhas = folhasDe(n.id);
      const custoPrevisto = folhas.reduce((s, f) => s + (custos.get(f) ?? 0), 0);
      const conjunto = new Set(folhas);
      const previstoAte = valorPrevistoEm(atividades.filter((a) => a.eapNoId !== null && conjunto.has(a.eapNoId)), dataRef);
      const executado = folhas.reduce((s, f) => s + ((custos.get(f) ?? 0) * (pcts.get(f) ?? 0)) / 100, 0);
      return {
        id: n.id, codigo: n.codigo, descricao: n.descricao, nivel: n.nivel,
        custoPrevisto: Math.round(custoPrevisto),
        previstoAte: Math.round(previstoAte),
        executado: Math.round(executado),
        percentualExecutado: custoPrevisto > 0 ? (executado / custoPrevisto) * 100 : 0,
        saldo: Math.round(custoPrevisto - executado),
        spi: previstoAte > 0 ? executado / previstoAte : null,
      };
    });
}
