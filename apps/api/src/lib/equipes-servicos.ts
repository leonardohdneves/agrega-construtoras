// Produção da equipe na construtora: cada serviço (folha da EAP) tem uma equipe responsável e um preço por unidade.
// A produção do mês é a quantidade executada no mês (diferença do % acumulado nas medições) vezes o preço unitário.
import type { Medicao } from './acompanhamento.ts';

export type Atribuicao = { eapNoId: string; codigo: string; descricao: string; colaboradorId: string; nome: string; precoCentavos: number };
export type OrcadoServico = { unidade: string | null; quantidade: number | null };

/** % acumulado de um serviço numa data: vale o último % informado até essa data (0 se ainda não houve medição). */
export function percentualEm(medicoes: Medicao[], noId: string, data: string): number {
  let valor = 0;
  let dataValor = '';
  for (const m of medicoes) {
    if (m.data <= data && m.itens.has(noId) && m.data >= dataValor) {
      valor = m.itens.get(noId)!;
      dataValor = m.data;
    }
  }
  return valor;
}

const diaAnterior = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

export type ServicoMes = { eapNoId: string; codigo: string; descricao: string; unidade: string | null; quantidadeMes: number | null; precoCentavos: number | null; valorCentavos: number | null };
export type ColaboradorMes = { id: string; nome: string; valorCentavos: number; servicos: ServicoMes[] };

/**
 * Produção do mês por colaborador. `de` e `ate` são o primeiro e o último dia do mês (AAAA-MM-DD).
 * Serviços sem unidade definida (EAP com mais de uma linha de orçamento) não geram valor; ficam na lista com a quantidade vazia.
 */
export function producaoDoMes(args: {
  atribuicoes: Atribuicao[];
  medicoes: Medicao[];
  orcado: Map<string, OrcadoServico>;
  noEmMedicao: Map<string, { codigo: string; descricao: string }>;
  de: string;
  ate: string;
}) {
  const antes = diaAnterior(args.de);
  const quantidadeNoMes = (noId: string): number | null => {
    const orc = args.orcado.get(noId);
    if (!orc || orc.quantidade === null) return null;
    const pctAte = percentualEm(args.medicoes, noId, args.ate);
    const pctAntes = percentualEm(args.medicoes, noId, antes);
    const acumulada = (pct: number) => orc.quantidade! * Math.min(100, Math.max(0, pct)) / 100;
    const q = acumulada(pctAte) - acumulada(pctAntes);
    return Math.round(q * 10000) / 10000;
  };

  const porColaborador = new Map<string, ColaboradorMes>();
  const atribuidos = new Set<string>();
  for (const a of args.atribuicoes) {
    atribuidos.add(a.eapNoId);
    const quantidade = quantidadeNoMes(a.eapNoId);
    const unidade = args.orcado.get(a.eapNoId)?.unidade ?? null;
    const valor = quantidade === null ? null : Math.round(Math.max(0, quantidade) * a.precoCentavos);
    const c = porColaborador.get(a.colaboradorId) ?? { id: a.colaboradorId, nome: a.nome, valorCentavos: 0, servicos: [] };
    c.servicos.push({ eapNoId: a.eapNoId, codigo: a.codigo, descricao: a.descricao, unidade, quantidadeMes: quantidade, precoCentavos: a.precoCentavos, valorCentavos: valor });
    c.valorCentavos += valor ?? 0;
    porColaborador.set(a.colaboradorId, c);
  }

  // Serviços medidos no mês que não têm equipe: a produção existe, mas ninguém recebe por ela.
  const semEquipe: ServicoMes[] = [];
  for (const [noId, no] of args.noEmMedicao) {
    if (atribuidos.has(noId)) continue;
    const quantidade = quantidadeNoMes(noId);
    if (quantidade === null || quantidade === 0) continue;
    semEquipe.push({ eapNoId: noId, codigo: no.codigo, descricao: no.descricao, unidade: args.orcado.get(noId)?.unidade ?? null, quantidadeMes: quantidade, precoCentavos: null, valorCentavos: null });
  }

  const colaboradores = [...porColaborador.values()].sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'));
  return {
    colaboradores,
    semEquipe,
    totalCentavos: colaboradores.reduce((s, c) => s + c.valorCentavos, 0),
  };
}
