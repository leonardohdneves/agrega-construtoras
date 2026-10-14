// Versões do orçamento: retrato da obra no momento em que a versão é salva e comparação entre duas versões.
// Tudo aqui é função pura. O retrato guarda os preços e o BDI do momento, então a versão antiga não muda
// quando os preços da obra ou da tabela mudam depois.
import { compararCodigo, montarRelatorioOrcamento, type InsumoComposicaoRel, type LinhaPlanilhaRel, type LinhaRelatorio } from './engenharia.ts';

export type SnapshotVersao = {
  versao: 1;
  obra: { codigo: string; nome: string; endereco: string | null; cidade: string | null; uf: string | null; responsavel: string | null };
  bdiPercentual: number;
  linhas: LinhaPlanilhaRel[];
  composicoes: Record<string, InsumoComposicaoRel[]>;
};

export type SituacaoItem = 'igual' | 'alterada' | 'incluida' | 'removida';

export type ResumoServicoVersao = { codigo: string; descricao: string; quantidade: number; precoUnitario: number; total: number };

export type ItemComparado = {
  codigo: string; // código do nó da EAP (etapa, subetapa ou tarefa)
  descricao: string;
  situacao: SituacaoItem;
  mudancas: string[];
  a: ResumoServicoVersao | null;
  b: ResumoServicoVersao | null;
  delta: number; // total de B menos total de A
};

export type GrupoComparado = { codigo: string; descricao: string; nivel: string; totalA: number; totalB: number; delta: number; situacao: SituacaoItem };

export type Comparacao = {
  a: { bdiPercentual: number; precoTotal: number; custoTotal: number };
  b: { bdiPercentual: number; precoTotal: number; custoTotal: number };
  resumo: { delta: number; percentual: number; incluidas: number; removidas: number; alteradas: number; iguais: number };
  etapas: GrupoComparado[];
  tarefas: ItemComparado[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Retrato da obra: recebe os dados já lidos do banco e devolve o que será guardado. */
export function criarSnapshot(
  obra: SnapshotVersao['obra'],
  bdiPercentual: number,
  linhas: LinhaPlanilhaRel[],
  composicoes: Map<string, InsumoComposicaoRel[]>,
): SnapshotVersao {
  return {
    versao: 1,
    obra,
    bdiPercentual: Number(bdiPercentual),
    linhas: linhas.map((l) => ({ ...l, servico: l.servico && { ...l.servico } })),
    composicoes: Object.fromEntries(composicoes),
  };
}

/** Totais de uma versão, calculados do mesmo jeito que o orçamento atual. */
export function relatorioDaVersao(snap: SnapshotVersao) {
  const linhas = snap.linhas.map((l) => ({ ...l, servico: l.servico && { ...l.servico } }));
  return montarRelatorioOrcamento(linhas, snap.bdiPercentual, false);
}

type LinhaServico = Extract<LinhaRelatorio, { tipo: 'servico' }>;
type LinhaGrupo = Extract<LinhaRelatorio, { tipo: 'grupo' }>;

function resumo(l: LinhaServico): ResumoServicoVersao {
  return { codigo: l.codigo, descricao: l.descricao, quantidade: l.quantidade, precoUnitario: l.precoUnitario, total: l.total };
}

/** Compara duas versões: por etapa, subetapa e tarefa (código da EAP), com o que mudou em cada uma. */
export function compararVersoes(a: SnapshotVersao, b: SnapshotVersao): Comparacao {
  const ra = relatorioDaVersao(a);
  const rb = relatorioDaVersao(b);

  const servicosA = new Map(ra.linhas.filter((l): l is LinhaServico => l.tipo === 'servico').map((l) => [l.item, l]));
  const servicosB = new Map(rb.linhas.filter((l): l is LinhaServico => l.tipo === 'servico').map((l) => [l.item, l]));
  const gruposA = new Map(ra.linhas.filter((l): l is LinhaGrupo => l.tipo === 'grupo').map((l) => [l.item, l]));
  const gruposB = new Map(rb.linhas.filter((l): l is LinhaGrupo => l.tipo === 'grupo').map((l) => [l.item, l]));

  const tarefas: ItemComparado[] = [...new Set([...servicosA.keys(), ...servicosB.keys()])]
    .sort(compararCodigo)
    .map((codigo) => {
      const la = servicosA.get(codigo) ?? null;
      const lb = servicosB.get(codigo) ?? null;
      const a1 = la && resumo(la);
      const b1 = lb && resumo(lb);
      const descricao = (lb ?? la)!.descricao;
      if (!la || !lb) {
        const total = b1?.total ?? 0;
        return { codigo, descricao, situacao: la ? 'removida' : 'incluida', mudancas: [la ? 'tarefa removida' : 'tarefa incluída'], a: a1 ?? null, b: b1 ?? null, delta: r2(total - (a1?.total ?? 0)) };
      }
      const mudancas: string[] = [];
      if (la.descricao !== lb.descricao) mudancas.push('descrição');
      if (la.codigo !== lb.codigo) mudancas.push('serviço trocado');
      if (la.quantidade !== lb.quantidade) mudancas.push('quantidade');
      if (la.precoUnitario !== lb.precoUnitario) mudancas.push('preço unitário');
      return {
        codigo,
        descricao,
        situacao: mudancas.length ? 'alterada' : 'igual',
        mudancas,
        a: a1!,
        b: b1!,
        delta: r2(lb.total - la.total),
      };
    });

  const etapas: GrupoComparado[] = [...new Set([...gruposA.keys(), ...gruposB.keys()])]
    .sort(compararCodigo)
    .map((codigo) => {
      const ga = gruposA.get(codigo);
      const gb = gruposB.get(codigo);
      const g = (gb ?? ga)!;
      const totalA = ga?.total ?? 0;
      const totalB = gb?.total ?? 0;
      const situacao: SituacaoItem = !ga ? 'incluida' : !gb ? 'removida' : totalA !== totalB ? 'alterada' : 'igual';
      return { codigo, descricao: g.descricao, nivel: g.nivel, totalA: r2(totalA), totalB: r2(totalB), delta: r2(totalB - totalA), situacao };
    });

  const contar = (s: SituacaoItem) => tarefas.filter((t) => t.situacao === s).length;
  const delta = r2(rb.precoTotal - ra.precoTotal);
  return {
    a: { bdiPercentual: a.bdiPercentual, precoTotal: ra.precoTotal, custoTotal: ra.custoTotal },
    b: { bdiPercentual: b.bdiPercentual, precoTotal: rb.precoTotal, custoTotal: rb.custoTotal },
    resumo: {
      delta,
      percentual: ra.precoTotal > 0 ? Math.round((delta / ra.precoTotal) * 10000) / 100 : 0,
      incluidas: contar('incluida'),
      removidas: contar('removida'),
      alteradas: contar('alterada'),
      iguais: contar('igual'),
    },
    etapas,
    tarefas,
  };
}
