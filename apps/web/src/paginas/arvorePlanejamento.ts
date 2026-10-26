// Planejamento · funções puras da árvore da EAP (sem React), para as abas e para os testes.
// Etapas e subetapas são resumos: o início e o fim vêm das tarefas abaixo delas.
import type { No } from './EngObras';

export type Atividade = {
  id: string; numero: number; ordem: number; descricao: string; descricaoResumida: string; predecessoraNumero: number | null;
  /** No caminho crítico (folga zero) e quantos dias ela pode atrasar sem atrasar a obra. */
  critica?: boolean; folgaDias?: number;
  eapNoId: string | null; eapCodigo: string | null; eapDescricao: string | null;
  inicioInformado: string; duracaoDias: number; predecessoraId: string | null; inicio: string; fim: string;
  /** Atividade ligada a uma etapa ou subetapa (lançamento antigo): a etapa mostra as datas das tarefas abaixo dela. */
  resumo: boolean;
};

export const dataBr = (iso: string) => iso.split('-').reverse().join('/');
export const DIA_MS = 86_400_000;
export const paraMs = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
export const diasEntre = (a: string, b: string) => Math.round((paraMs(b) - paraMs(a)) / DIA_MS);
export const somarDias = (iso: string, n: number) => new Date(paraMs(iso) + n * DIA_MS).toISOString().slice(0, 10);
export const NOMES_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Meses do intervalo, cada um com os dias que tem dentro dele (a largura na barra é proporcional aos dias). */
export function mesesEntre(ini: string, fim: string) {
  const saida: { rotulo: string; dias: number }[] = [];
  let atual = ini;
  while (atual <= fim) {
    const ano = Number(atual.slice(0, 4));
    const mes = Number(atual.slice(5, 7));
    const ultimo = new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10);
    const f = ultimo < fim ? ultimo : fim;
    saida.push({ rotulo: `${NOMES_MES[mes - 1]}/${String(ano).slice(2)}`, dias: diasEntre(atual, f) + 1 });
    atual = somarDias(f, 1);
  }
  return saida;
}

export const ordemEap = (codigo: string) => codigo.split('.').map(Number);
export function compararEap(a: No, b: No) {
  const x = ordemEap(a.codigo);
  const y = ordemEap(b.codigo);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? -1) - (y[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

export type Linha = {
  chave: string; profundidade: number; codigo: string | null; descricao: string;
  /** Etapa ou subetapa: as datas são as das tarefas abaixo dela. */
  resumo: boolean; temFilhos: boolean; aberta: boolean; noId: string | null;
  atividade: Atividade | null; inicio: string | null; fim: string | null; dias: number | null;
};

/** Linhas do planejamento na ordem da EAP. Etapas e subetapas são resumos, e só mostram as linhas abaixo delas se estiverem abertas. */
export function montarLinhas(nos: No[], atividades: Atividade[], fechados: Set<string>): Linha[] {
  const porId = new Map(nos.map((n) => [n.id, n]));
  const filhosDe = new Map<string, No[]>();
  for (const n of nos) if (n.paiId && porId.has(n.paiId)) filhosDe.set(n.paiId, [...(filhosDe.get(n.paiId) ?? []), n]);
  for (const lista of filhosDe.values()) lista.sort(compararEap);
  const raizes = nos.filter((n) => !n.paiId || !porId.has(n.paiId)).sort(compararEap);
  const atPorNo = new Map<string, Atividade>();
  for (const a of atividades) if (a.eapNoId && !atPorNo.has(a.eapNoId)) atPorNo.set(a.eapNoId, a);

  // Início e fim de tudo que está abaixo do nó (inclusive a atividade dele, se houver).
  const intervalo = (noId: string) => {
    let inicio: string | null = null;
    let fim: string | null = null;
    const pilha = [noId];
    while (pilha.length) {
      const id = pilha.pop()!;
      const a = atPorNo.get(id);
      if (a) {
        if (!inicio || a.inicio < inicio) inicio = a.inicio;
        if (!fim || a.fim > fim) fim = a.fim;
      }
      for (const f of filhosDe.get(id) ?? []) pilha.push(f.id);
    }
    return inicio && fim ? { inicio, fim } : null;
  };

  const linhas: Linha[] = [];
  const visitar = (no: No, profundidade: number) => {
    const filhos = filhosDe.get(no.id) ?? [];
    const atividade = atPorNo.get(no.id) ?? null;
    if (filhos.length) {
      const aberta = !fechados.has(no.id);
      const iv = intervalo(no.id);
      linhas.push({
        chave: no.id, profundidade, codigo: no.codigo, descricao: no.descricao, resumo: true, temFilhos: true, aberta, noId: no.id,
        atividade: null, inicio: iv?.inicio ?? null, fim: iv?.fim ?? null, dias: iv ? diasEntre(iv.inicio, iv.fim) + 1 : null,
      });
      if (!aberta) return;
      // Atividade lançada direto numa etapa (lançamento antigo): aparece como uma tarefa a mais dentro dela.
      if (atividade) {
        linhas.push({
          chave: atividade.id, profundidade: profundidade + 1, codigo: null, descricao: atividade.descricaoResumida, resumo: false, temFilhos: false,
          aberta: true, noId: no.id, atividade, inicio: atividade.inicio, fim: atividade.fim, dias: atividade.duracaoDias,
        });
      }
      for (const f of filhos) visitar(f, profundidade + 1);
      return;
    }
    linhas.push({
      chave: no.id, profundidade, codigo: no.codigo, descricao: atividade ? atividade.descricaoResumida : no.descricao, resumo: false, temFilhos: false,
      aberta: true, noId: no.id, atividade, inicio: atividade?.inicio ?? null, fim: atividade?.fim ?? null, dias: atividade ? atividade.duracaoDias : null,
    });
  };
  for (const r of raizes) visitar(r, 0);
  for (const a of atividades.filter((x) => !x.eapNoId)) {
    linhas.push({
      chave: a.id, profundidade: 0, codigo: null, descricao: a.descricaoResumida, resumo: false, temFilhos: false, aberta: true, noId: null,
      atividade: a, inicio: a.inicio, fim: a.fim, dias: a.duracaoDias,
    });
  }
  return linhas;
}

