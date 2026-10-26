// Engenharia · Relatórios: orçamento sintético e analítico, no formato usual de mercado (SIENGE, planilhas do TCU).
// Sintético: EAP com o total de cada grupo e os serviços com quantidade, preço unitário (já com BDI),
// preço total e peso (%). Analítico: o mesmo, com os insumos de cada composição abaixo do serviço.
import { Component, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, formatarMoeda } from '../api';
import { CabecalhoDocumento } from '../componentes/Documento';
import type { Obra } from './EngObras';
import { ROTULO, type NivelPlanilha } from './EngPlanilha';

type LinhaRel =
  | { tipo: 'grupo'; nivel: NivelPlanilha; item: string; descricao: string; total: number; peso: number }
  | { tipo: 'servico'; nivel: 'tarefa'; item: string; codigo: string; descricao: string; unidade: string; quantidade: number; custoUnitario: number; precoUnitario: number; total: number; peso: number }
  | { tipo: 'insumo'; codigo: string; descricao: string; unidade: string; coeficiente: number; quantidade: number; custoUnitario: number; custoTotal: number }
  | { tipo: 'tarefa'; nivel: 'tarefa'; item: string; descricao: string };
type Relatorio = {
  tipo: 'sintetico' | 'analitico';
  obra: { id: string; codigo: string; nome: string; endereco: string | null; cidade: string | null; uf: string | null; responsavel: string | null; bdiPercentual: number };
  linhas: LinhaRel[];
  custoTotal: number;
  precoTotal: number;
  bdiValor: number;
};

type LinhaAbc = { posicao: number; classe: 'A' | 'B' | 'C'; codigo: string; descricao: string; unidade: string; quantidade: number; precoUnitario: number; total: number; percentual: number; acumulado: number };
type RelatorioAbc = {
  tipo: 'servicos' | 'insumos';
  obra: Relatorio['obra'];
  limites: { A: number; B: number };
  linhas: LinhaAbc[];
  total: number;
  classes: Record<'A' | 'B' | 'C', { itens: number; valor: number; percentual: number }>;
};
export type Gran = 'dia' | 'semana' | 'quinzena' | 'mes';
export const GRANULARIDADES: { id: Gran; texto: string }[] = [
  { id: 'dia', texto: 'Diário' },
  { id: 'semana', texto: 'Semanal' },
  { id: 'quinzena', texto: 'Quinzenal' },
  { id: 'mes', texto: 'Mensal' },
];
type PeriodoRel = { rotulo: string; inicio: string; fim: string; dias: number };
type GanttRel = {
  granularidade: Gran; inicio: string; fim: string; totalDias: number; periodos: PeriodoRel[];
  atividades: { id: string; descricao: string; eapCodigo: string | null; inicio: string; fim: string; duracaoDias: number; deslocamentoDias: number }[];
  atividadesSemEap: number;
};
export type CalendarioRel = {
  granularidade: Gran; inicio: string | null; fim: string | null;
  blocos: { rotulo: string; inicio: string; fim: string; dias: string[]; linhas: { id: string; descricao: string; eapCodigo: string | null; marcas: Record<string, 'inicio' | 'continua' | 'fim' | 'unico'> }[] }[];
};
export type EquipesRel = {
  granularidade: Gran; horasDia: number; inicio: string; fim: string; periodos: string[];
  porTipo: { codigo: string; descricao: string; pico: number; periodos: { rotulo: string; trabalhadores: number }[] }[];
  porAtividade: {
    id: string; descricao: string; inicio: string; fim: string; duracaoDias: number;
    /** Etapa ou subetapa: totaliza as atividades subordinadas, listadas logo abaixo dela. */
    resumo?: boolean; eapCodigo?: string | null; nivel?: number;
    recursos: { codigo: string; descricao: string; horas: number; trabalhadores: number }[];
  }[];
  mensalistasNaoCalculados: string[]; atividadesSemOrcamento: number;
};
export type ComprasRel = {
  itens: { codigo: string; descricao: string; unidade: string; grupo: string | null; total: number; primeira: string; usos: { atividade: string; inicio: string; quantidade: number }[] }[];
  semClasse: number; atividadesSemOrcamento: number;
};
type ValoresCusto = { material: number; mao_obra: number; equipamento: number; outros: number; total: number; peso: number };
export type RelatorioCustos = {
  obra: Relatorio['obra'];
  classes: { classe: string; rotulo: string; valor: number; peso: number }[];
  linhas: (
    | ({ tipo: 'grupo'; nivel: NivelPlanilha; item: string; descricao: string } & ValoresCusto)
    | ({ tipo: 'servico'; item: string; codigo: string; descricao: string; unidade: string; quantidade: number; precoUnitario: number } & ValoresCusto)
    | { tipo: 'tarefa'; item: string; descricao: string }
  )[];
  precoTotal: number;
  bdiValor: number;
};
type Tipo = 'sintetico' | 'analitico' | 'custos' | 'abc-servicos' | 'abc-insumos' | 'comparacao' | 'equipes' | 'compras' | 'calendario';
const TIPOS: { id: Tipo; texto: string; titulo: string }[] = [
  { id: 'sintetico', texto: 'Orçamento sintético', titulo: 'Orçamento sintético' },
  { id: 'analitico', texto: 'Orçamento analítico', titulo: 'Orçamento analítico' },
  { id: 'custos', texto: 'Custos por classe', titulo: 'Custos por classe (preço de venda)' },
  { id: 'abc-servicos', texto: 'Curva ABC de serviços', titulo: 'Curva ABC de serviços' },
  { id: 'abc-insumos', texto: 'Curva ABC de insumos', titulo: 'Curva ABC de insumos' },
  { id: 'comparacao', texto: 'Comparar versões', titulo: 'Comparação de versões' },
  { id: 'equipes', texto: 'Equipes necessárias', titulo: 'Equipes necessárias' },
  { id: 'compras', texto: 'Materiais necessários', titulo: 'Materiais necessários' },
  { id: 'calendario', texto: 'Calendário de produção', titulo: 'Calendário de produção' },
];
const ehPlanejamento = (t: Tipo) => t === 'equipes' || t === 'compras' || t === 'calendario';
const dataCurta = (iso: string) => iso.split('-').reverse().join('/');

const num = (n: number, casas = 4) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: casas });
const pct = (n: number) => `${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

export function EngRelatorios() {
  const [params, setParams] = useSearchParams();
  const [obras, setObras] = useState<Obra[] | null>(null);
  const [rel, setRel] = useState<Relatorio | null>(null);
  const [abc, setAbc] = useState<RelatorioAbc | null>(null);
  const [custos, setCustos] = useState<RelatorioCustos | null>(null);
  // O relatório de planejamento guarda o tipo a que pertence: ao trocar de aba, os dados antigos não chegam à tela nova.
  const [planEstado, setPlanEstado] = useState<{ tipo: Tipo; gran: Gran; dados: GanttRel | EquipesRel | ComprasRel | CalendarioRel } | null>(null);
  const [erro, setErro] = useState('');
  const obraId = params.get('obra') ?? obras?.[0]?.id ?? '';
  const tipo: Tipo = TIPOS.find((t) => t.id === params.get('tipo'))?.id ?? 'sintetico';
  const ehAbc = tipo.startsWith('abc-');
  const gran: Gran = GRANULARIDADES.find((g) => g.id === params.get('gran'))?.id ?? 'semana';
  const plan = planEstado && planEstado.tipo === tipo && (tipo === 'compras' || planEstado.gran === gran) ? planEstado.dados : null;

  useEffect(() => {
    api<{ obras: Obra[] }>('/eng/obras')
      .then((r) => setObras(r.obras))
      .catch((e) => setErro((e as Error).message));
  }, []);
  useEffect(() => {
    if (!obraId || tipo === 'comparacao') return;
    // Resposta que chega depois de o usuário trocar de relatório é descartada.
    let ativo = true;
    setRel(null);
    setAbc(null);
    setCustos(null);
    setPlanEstado(null);
    setErro('');
    const pedido = ehPlanejamento(tipo)
      ? api<GanttRel | EquipesRel | ComprasRel | CalendarioRel>(
          tipo === 'compras'
            ? `/eng/obras/${obraId}/relatorios-planejamento/compras?classe=material`
            : `/eng/obras/${obraId}/relatorios-planejamento/${tipo}?granularidade=${gran}`,
        ).then((dados) => { if (ativo) setPlanEstado({ tipo, gran, dados }); })
      : ehAbc
        ? api<RelatorioAbc>(`/eng/obras/${obraId}/relatorio-abc?tipo=${tipo === 'abc-insumos' ? 'insumos' : 'servicos'}`).then((r) => { if (ativo) setAbc(r); })
        : tipo === 'custos'
          ? api<RelatorioCustos>(`/eng/obras/${obraId}/relatorio-custos`).then((r) => { if (ativo) setCustos(r); })
        : api<Relatorio>(`/eng/obras/${obraId}/relatorio-orcamento?tipo=${tipo}`).then((r) => { if (ativo) setRel(r); });
    pedido.catch((e) => { if (ativo) setErro((e as Error).message); });
    return () => { ativo = false; };
  }, [obraId, tipo, gran]);

  const mudar = (p: Record<string, string>) => setParams({ obra: obraId, tipo, ...(p.tipo && ehPlanejamento(p.tipo as Tipo) ? { gran } : {}), ...p }, { replace: true });
  // Mesma proteção para orçamento e curva ABC: só mostra o que pertence ao relatório escolhido.
  const relAtual = rel && rel.tipo === tipo ? rel : null;
  const abcAtual = abc && ehAbc && abc.tipo === (tipo === 'abc-insumos' ? 'insumos' : 'servicos') ? abc : null;
  const custosAtual = custos && tipo === 'custos' ? custos : null;
  const obraRel = relAtual?.obra ?? abcAtual?.obra ?? custosAtual?.obra;
  const obraAtual = obras?.find((o) => o.id === obraId);
  const local =obraRel ? [obraRel.endereco, [obraRel.cidade, obraRel.uf].filter(Boolean).join('/')].filter(Boolean).join(' · ') : '';

  return (
    <div className={`relatorio${tipo === 'sintetico' || tipo === 'analitico' ? ' relatorio-retrato' : ''}`}>
      <CabecalhoDocumento
        modulo="Engenharia"
        titulo={TIPOS.find((t) => t.id === tipo)!.titulo}
        descricao={obraRel ? `Obra ${obraRel.codigo} · ${obraRel.nome}` : obraAtual ? `Obra ${obraAtual.codigo} · ${obraAtual.nome}` : undefined}
        filtros={obraRel ? [local, obraRel.responsavel ? `Responsável técnico: ${obraRel.responsavel}` : ''] : []}
      />

      <div className="card nao-imprimir" style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
        <div className="campo" style={{ minWidth: 280 }}>
          <label htmlFor="rel-obra">Obra</label>
          <select id="rel-obra" value={obraId} onChange={(e) => mudar({ obra: e.target.value })}>
            {(obras ?? []).map((o) => <option key={o.id} value={o.id}>{o.codigo} · {o.nome}</option>)}
          </select>
        </div>
        <div className="campo" style={{ flex: '1 1 100%', width: '100%' }}>
          <span className="rotulo">Relatório</span>
          <div className="segmentado quatro-opcoes" role="group" aria-label="Relatório">
            {TIPOS.map((t) => (
              <button key={t.id} type="button" aria-pressed={tipo === t.id} className={tipo === t.id ? 'ativo' : ''} onClick={() => mudar({ tipo: t.id })}>{t.texto}</button>
            ))}
          </div>
        </div>
      </div>

      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {obras?.length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>Nenhuma obra cadastrada.</p></div>}
      {tipo === 'comparacao' && obraId && <ComparacaoVersoes key={obraId} obraId={obraId} />}
      {tipo === 'equipes' || tipo === 'calendario' ? (
        <div className="card nao-imprimir" style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <div className="campo">
            <span className="rotulo">Período</span>
            <div className="segmentado" role="group" aria-label="Período">
              {GRANULARIDADES.map((g) => (
                <button key={g.id} type="button" aria-pressed={gran === g.id} className={gran === g.id ? 'ativo' : ''} onClick={() => mudar({ gran: g.id })}>{g.texto}</button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      <ProtecaoRelatorio chave={`${obraId}|${tipo}|${gran}`}>
        {obraId && tipo !== 'comparacao' && !relAtual && !abcAtual && !plan && !erro && <p className="muted">Carregando…</p>}
        {plan && tipo === 'equipes' && <EquipesView e={plan as EquipesRel} />}
        {plan && tipo === 'compras' && <ComprasView c={plan as ComprasRel} classe="material" />}
        {plan && tipo === 'calendario' && <CalendarioView c={plan as CalendarioRel} />}
        {abcAtual && (abcAtual.linhas.length === 0 ? <div className="card"><p className="muted" style={{ margin: 0 }}>Não há {abcAtual.tipo === 'insumos' ? 'insumos' : 'serviços'} com valor no orçamento desta obra.</p></div> : <CurvaAbc rel={abcAtual} />)}
        {relAtual && relAtual.linhas.length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>A planilha desta obra está vazia. Monte-a em EAP e orçamento.</p></div>}
        {relAtual && relAtual.linhas.length > 0 && (relAtual.tipo === 'sintetico' ? <Sintetico rel={relAtual} /> : <Analitico rel={relAtual} />)}
        {custosAtual && (custosAtual.linhas.length === 0 ? <div className="card"><p className="muted" style={{ margin: 0 }}>A planilha desta obra está vazia. Monte-a em EAP e orçamento.</p></div> : <CustosPorClasse rel={custosAtual} />)}
      </ProtecaoRelatorio>
    </div>
  );
}

/** Custos por classe no preço de venda (com BDI): resumo por classe e o detalhe de cada serviço. */
function CustosPorClasse({ rel }: { rel: RelatorioCustos }) {
  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <table className="tabela relatorio-orcamento">
          <thead>
            <tr><th>Classe</th><th className="num">Preço de venda</th><th className="num">Peso</th></tr>
          </thead>
          <tbody>
            {rel.classes.map((c) => (
              <tr key={c.classe}><td>{c.rotulo}</td><td className="num">{formatarMoeda(c.valor)}</td><td className="num">{pct(c.peso)}</td></tr>
            ))}
            <tr style={{ fontWeight: 700 }}><td>Total</td><td className="num">{formatarMoeda(rel.precoTotal)}</td><td className="num">100,00%</td></tr>
          </tbody>
        </table>
        <p className="small muted" style={{ marginBottom: 0 }}>BDI de {pct(rel.obra.bdiPercentual)} incluído. Cada serviço é dividido entre as classes na proporção do custo dos seus insumos.</p>
      </div>
      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table className="tabela relatorio-orcamento">
            <thead>
              <tr>
                <th>Item</th><th>Código</th><th>Serviço</th><th>Un.</th><th className="num">Qtd.</th><th className="num">Preço unit.</th>
                <th className="num">Material</th><th className="num">Mão de obra</th><th className="num">Equipamento</th><th className="num">Outros</th><th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {rel.linhas.map((l, i) =>
                l.tipo === 'grupo' ? (
                  <tr key={i} style={estiloGrupo(l.nivel)}>
                    <td className="mono">{l.item}</td><td className="small">{ROTULO[l.nivel]}</td><td colSpan={4}>{l.descricao}</td>
                    <td className="num">{formatarMoeda(l.material)}</td><td className="num">{formatarMoeda(l.mao_obra)}</td><td className="num">{formatarMoeda(l.equipamento)}</td><td className="num">{formatarMoeda(l.outros)}</td>
                    <td className="num">{formatarMoeda(l.total)}</td>
                  </tr>
                ) : l.tipo === 'servico' ? (
                  <tr key={i}>
                    <td className="mono">{l.item}</td><td className="mono">{l.codigo}</td><td>{l.descricao}</td><td>{l.unidade}</td>
                    <td className="num">{num(l.quantidade)}</td><td className="num">{formatarMoeda(l.precoUnitario)}</td>
                    <td className="num">{formatarMoeda(l.material)}</td><td className="num">{formatarMoeda(l.mao_obra)}</td><td className="num">{formatarMoeda(l.equipamento)}</td><td className="num">{formatarMoeda(l.outros)}</td>
                    <td className="num">{formatarMoeda(l.total)}</td>
                  </tr>
                ) : (
                  <tr key={i}>
                    <td className="mono">{l.item}</td><td /><td colSpan={9}>{l.descricao}</td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/** Se um relatório quebrar ao montar a tela, mostra um aviso no lugar dele em vez de derrubar o aplicativo. */
class ProtecaoRelatorio extends Component<{ chave: string; children: ReactNode }, { falha: string | null; chave: string }> {
  state = { falha: null as string | null, chave: this.props.chave };
  static getDerivedStateFromError(e: Error) { return { falha: e.message || 'erro desconhecido' }; }
  static getDerivedStateFromProps(p: { chave: string }, s: { falha: string | null; chave: string }) {
    return p.chave !== s.chave ? { falha: null, chave: p.chave } : null;
  }
  componentDidCatch(e: Error) { console.error('Relatório de engenharia:', e); }
  render() {
    if (this.state.falha) return <div className="alerta alerta-erro" role="alert">Não foi possível montar este relatório ({this.state.falha}). Troque de relatório ou recarregue a página.</div>;
    return this.props.children;
  }
}

/** Rodapé: só o preço de venda. O BDI já está embutido nos preços unitários e nos totais, sem linha própria. */
function Rodape({ rel, colunas }: { rel: Relatorio; colunas: number }) {
  return (
    <tfoot>
      <tr>
        <td colSpan={colunas - 1} className="num"><b>Preço de venda do orçamento</b></td>
        <td className="num"><b>{formatarMoeda(rel.precoTotal)}</b></td>
      </tr>
    </tfoot>
  );
}

const estiloGrupo = (nivel: NivelPlanilha) => ({ fontWeight: nivel === 'obra' ? 800 : 700, background: nivel === 'obra' ? 'var(--surface-sunken)' : undefined });

function Sintetico({ rel }: { rel: Relatorio }) {
  return (
    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
      <table className="tabela relatorio-orcamento">
        <thead>
          <tr>
            <th>Item</th>
            <th>Código</th>
            <th>Descrição</th>
            <th>Unid.</th>
            <th className="num">Quant.</th>
            <th className="num">Preço unit.</th>
            <th className="num">Peso</th>
            <th className="num">Preço total</th>
          </tr>
        </thead>
        <tbody>
          {rel.linhas.map((l, i) =>
            l.tipo === 'grupo' ? (
              <tr key={i} style={estiloGrupo(l.nivel)}>
                <td className="mono">{l.item}</td>
                <td className="small">{ROTULO[l.nivel]}</td>
                <td colSpan={4}>{l.descricao}</td>
                <td className="num">{pct(l.peso)}</td>
                <td className="num">{formatarMoeda(l.total)}</td>
              </tr>
            ) : l.tipo === 'servico' ? (
              <tr key={i}>
                <td className="mono">{l.item}</td>
                <td className="mono">{l.codigo}</td>
                <td>{l.descricao}</td>
                <td>{l.unidade}</td>
                <td className="num">{num(l.quantidade)}</td>
                <td className="num">{formatarMoeda(l.precoUnitario)}</td>
                <td className="num">{pct(l.peso)}</td>
                <td className="num">{formatarMoeda(l.total)}</td>
              </tr>
            ) : l.tipo === 'tarefa' ? (
              <tr key={i}>
                <td className="mono">{l.item}</td>
                <td />
                <td>{l.descricao}</td>
                <td colSpan={5} className="small muted">sem serviço</td>
              </tr>
            ) : null,
          )}
        </tbody>
        <Rodape rel={rel} colunas={8} />
      </table>
    </div>
  );
}

function Analitico({ rel }: { rel: Relatorio }) {
  return (
    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
      <table className="tabela relatorio-orcamento">
        <thead>
          <tr>
            <th>Item</th>
            <th>Código</th>
            <th>Descrição</th>
            <th>Unid.</th>
            <th className="num">Coef.</th>
            <th className="num">Quant.</th>
            <th className="num">Custo unit.</th>
            <th className="num">Preço unit.</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {rel.linhas.map((l, i) =>
            l.tipo === 'grupo' ? (
              <tr key={i} style={estiloGrupo(l.nivel)}>
                <td className="mono">{l.item}</td>
                <td className="small">{ROTULO[l.nivel]}</td>
                <td colSpan={6}>{l.descricao}</td>
                <td className="num">{formatarMoeda(l.total)}</td>
              </tr>
            ) : l.tipo === 'servico' ? (
              <tr key={i} style={{ fontWeight: 600, borderTop: '1.5px solid var(--border)' }}>
                <td className="mono">{l.item}</td>
                <td className="mono">{l.codigo}</td>
                <td>{l.descricao}</td>
                <td>{l.unidade}</td>
                <td />
                <td className="num">{num(l.quantidade)}</td>
                <td />
                <td className="num">{formatarMoeda(l.precoUnitario)}</td>
                <td className="num">{formatarMoeda(l.total)}</td>
              </tr>
            ) : l.tipo === 'insumo' ? (
              <tr key={i} className="small">
                <td />
                <td className="mono">{l.codigo}</td>
                <td style={{ paddingLeft: 20 }}>{l.descricao}</td>
                <td>{l.unidade}</td>
                <td className="num">{num(l.coeficiente, 7)}</td>
                <td className="num">{num(l.quantidade)}</td>
                <td className="num">{formatarMoeda(l.custoUnitario)}</td>
                <td />
                <td className="num">{formatarMoeda(l.custoTotal)}</td>
              </tr>
            ) : (
              <tr key={i}>
                <td className="mono">{l.item}</td>
                <td />
                <td>{l.descricao}</td>
                <td colSpan={6} className="small muted">sem serviço</td>
              </tr>
            ),
          )}
        </tbody>
        <Rodape rel={rel} colunas={9} />
      </table>
      <p className="small muted" style={{ padding: '0 12px' }}>
        Nos insumos: quantidade = coeficiente × quantidade do serviço; total = custo do insumo. Na linha do serviço, o preço unitário e o total já são o preço de venda.
      </p>
    </div>
  );
}

const COR_CLASSE: Record<'A' | 'B' | 'C', string> = { A: 'var(--status-danger-ink)', B: 'var(--status-warn-ink)', C: 'var(--ink-muted)' };

/** Curva ABC: classes com quantidade de itens e valor, e a lista do maior para o menor valor com o acumulado. */
function CurvaAbc({ rel }: { rel: RelatorioAbc }) {
  const insumos = rel.tipo === 'insumos';
  return (
    <>
      <div className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        {(['A', 'B', 'C'] as const).map((k) => (
          <div key={k}>
            <div className="small muted">
              Classe {k} · {k === 'A' ? `até ${rel.limites.A}%` : k === 'B' ? `${rel.limites.A}% a ${rel.limites.B}%` : `acima de ${rel.limites.B}%`}
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: COR_CLASSE[k] }}>{pct(rel.classes[k].percentual)}</div>
            <div className="small">
              {rel.classes[k].itens} {rel.classes[k].itens === 1 ? 'item' : 'itens'} · {formatarMoeda(rel.classes[k].valor)}
            </div>
          </div>
        ))}
        <div>
          <div className="small muted">Total</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{formatarMoeda(rel.total)}</div>
          <div className="small">{rel.linhas.length} {insumos ? 'insumos' : 'serviços'} · {insumos ? 'custo direto' : 'preço de venda'}</div>
        </div>
      </div>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="tabela relatorio-orcamento">
          <thead>
            <tr>
              <th className="num">Pos.</th>
              <th>Classe</th>
              <th>Código</th>
              <th>Descrição</th>
              <th>Unid.</th>
              <th className="num">Quant.</th>
              <th className="num">{insumos ? 'Custo unit.' : 'Preço unit.'}</th>
              <th className="num">Total</th>
              <th className="num">%</th>
              <th className="num">% acum.</th>
            </tr>
          </thead>
          <tbody>
            {rel.linhas.map((l) => (
              <tr key={l.codigo}>
                <td className="num">{l.posicao}</td>
                <td><b style={{ color: COR_CLASSE[l.classe] }}>{l.classe}</b></td>
                <td className="mono">{l.codigo}</td>
                <td>{l.descricao}</td>
                <td>{l.unidade}</td>
                <td className="num">{num(l.quantidade)}</td>
                <td className="num">{formatarMoeda(l.precoUnitario)}</td>
                <td className="num">{formatarMoeda(l.total)}</td>
                <td className="num">{pct(l.percentual)}</td>
                <td className="num">{pct(l.acumulado)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={7} className="num"><b>Total</b></td>
              <td className="num"><b>{formatarMoeda(rel.total)}</b></td>
              <td className="num">100,00%</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="small muted">
        Classe pelo valor acumulado antes de cada item: A até {rel.limites.A}%, B até {rel.limites.B}%, C o restante.{' '}
        {insumos ? 'Quantidade de cada insumo = coeficiente × quantidade dos serviços que o usam; valores de custo.' : 'O mesmo serviço lançado em várias tarefas aparece somado.'}
      </p>
    </>
  );
}

// ---------------------------------------------------------------- versões do orçamento e comparação

type VersaoResumo = { id: string; numero: number; nome: string; observacao: string | null; criadoPor: string; criadoEm: string; precoTotal: number; bdiPercentual: number };
type Situacao = 'igual' | 'alterada' | 'incluida' | 'removida';
type ResumoServico = { codigo: string; descricao: string; quantidade: number; precoUnitario: number; total: number };
type Comparacao = {
  rotuloA: string;
  rotuloB: string;
  a: { bdiPercentual: number; precoTotal: number; custoTotal: number };
  b: { bdiPercentual: number; precoTotal: number; custoTotal: number };
  resumo: { delta: number; percentual: number; incluidas: number; removidas: number; alteradas: number; iguais: number };
  etapas: { codigo: string; descricao: string; nivel: string; totalA: number; totalB: number; delta: number; situacao: Situacao }[];
  tarefas: { codigo: string; descricao: string; situacao: Situacao; mudancas: string[]; a: ResumoServico | null; b: ResumoServico | null; delta: number }[];
};
const ROTULO_SITUACAO: Record<Situacao, string> = { igual: 'Igual', alterada: 'Alterada', incluida: 'Incluída', removida: 'Removida' };
const sinal = (n: number) => (n > 0 ? '+' : '');

/** Salva versões da obra, lista as salvas e compara duas delas (ou uma com o orçamento atual). */
function ComparacaoVersoes({ obraId }: { obraId: string }) {
  const [versoes, setVersoes] = useState<VersaoResumo[] | null>(null);
  const [nome, setNome] = useState('');
  const [observacao, setObservacao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [a, setA] = useState('');
  const [b, setB] = useState('atual');
  const [comp, setComp] = useState<Comparacao | null>(null);
  const [soMudancas, setSoMudancas] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  async function carregarVersoes() {
    const r = await api<{ versoes: VersaoResumo[] }>(`/eng/obras/${obraId}/versoes`);
    setVersoes(r.versoes);
    return r.versoes;
  }

  useEffect(() => {
    carregarVersoes()
      .then((lista) => setA(lista[0]?.id ?? ''))
      .catch((e) => setErro((e as Error).message));
  }, [obraId]);

  useEffect(() => {
    setComp(null);
    if (!a || !b) return;
    if (a === b) return setErro('Escolha duas versões diferentes para comparar.');
    setErro('');
    api<Comparacao>(`/eng/obras/${obraId}/comparacao?a=${a}&b=${b}`)
      .then(setComp)
      .catch((e) => setErro((e as Error).message));
  }, [obraId, a, b]);

  async function salvarVersao() {
    setErro('');
    setAviso('');
    if (nome.trim().length < 2) return setErro('Dê um nome à versão.');
    setSalvando(true);
    try {
      const r = await api<{ versao: { numero: number } }>(`/eng/obras/${obraId}/versoes`, { metodo: 'POST', corpo: { nome: nome.trim(), observacao: observacao.trim() } });
      await carregarVersoes();
      setNome('');
      setObservacao('');
      setAviso(`Versão V${r.versao.numero} salva. Ela guarda os quantitativos, preços e BDI de agora; mudanças futuras não a alteram.`);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function excluirVersao(v: VersaoResumo) {
    if (!window.confirm(`Excluir a versão V${v.numero} · ${v.nome}? Isso não pode ser desfeito.`)) return;
    setErro('');
    setAviso('');
    try {
      await api(`/eng/obras/${obraId}/versoes/${v.id}`, { metodo: 'DELETE' });
      const lista = await carregarVersoes();
      if (a === v.id) setA(lista[0]?.id ?? '');
      if (b === v.id) setB('atual');
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  const opcoes = versoes ?? [];
  return (
    <>
      <div className="card nao-imprimir">
        <h2 style={{ marginTop: 0 }}>Versões salvas</h2>
        <span className="ajuda">Cada versão guarda o orçamento como está: planilha, serviços, insumos, preços e BDI.</span>
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap', margin: '12px 0' }}>
          <div className="campo" style={{ minWidth: 240 }}>
            <label htmlFor="vs-nome">Nome da versão</label>
            <input id="vs-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Proposta inicial" />
          </div>
          <div className="campo" style={{ minWidth: 240 }}>
            <label htmlFor="vs-obs">Observação (opcional)</label>
            <input id="vs-obs" value={observacao} onChange={(e) => setObservacao(e.target.value)} />
          </div>
          <button className="btn btn-primario" type="button" onClick={salvarVersao} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar versão atual'}
          </button>
        </div>
        {aviso && <div className="alerta alerta-ok" role="status" style={{ marginBottom: 12 }}>{aviso}</div>}
        {versoes === null ? (
          <p className="muted">Carregando versões…</p>
        ) : versoes.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nenhuma versão salva ainda. Salve a versão atual para começar a comparar.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tabela">
              <thead>
                <tr>
                  <th>Versão</th>
                  <th>Nome</th>
                  <th>Salva em</th>
                  <th>Por</th>
                  <th className="num">BDI</th>
                  <th className="num">Preço de venda</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {versoes.map((v) => (
                  <tr key={v.id}>
                    <td>V{v.numero}</td>
                    <td>
                      {v.nome}
                      {v.observacao && <div className="small muted">{v.observacao}</div>}
                    </td>
                    <td>{new Date(v.criadoEm).toLocaleString('pt-BR')}</td>
                    <td>{v.criadoPor}</td>
                    <td className="num">{pct(v.bdiPercentual)}</td>
                    <td className="num">{formatarMoeda(v.precoTotal)}</td>
                    <td className="acoes">
                      <button className="btn" type="button" onClick={() => excluirVersao(v)}>Excluir</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card nao-imprimir" style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
        <div className="campo" style={{ minWidth: 240 }}>
          <label htmlFor="vs-a">Versão A (base)</label>
          <select id="vs-a" value={a} onChange={(e) => setA(e.target.value)}>
            {opcoes.length === 0 && <option value="">Salve uma versão primeiro</option>}
            {opcoes.map((v) => <option key={v.id} value={v.id}>V{v.numero} · {v.nome}</option>)}
            <option value="atual">Orçamento atual</option>
          </select>
        </div>
        <div className="campo" style={{ minWidth: 240 }}>
          <label htmlFor="vs-b">Versão B (comparada)</label>
          <select id="vs-b" value={b} onChange={(e) => setB(e.target.value)}>
            {opcoes.map((v) => <option key={v.id} value={v.id}>V{v.numero} · {v.nome}</option>)}
            <option value="atual">Orçamento atual</option>
          </select>
        </div>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={soMudancas} onChange={(e) => setSoMudancas(e.target.checked)} />
          Mostrar só o que mudou
        </label>
        <button className="btn" type="button" onClick={() => window.print()} disabled={!comp}>Imprimir / salvar em PDF</button>
      </div>

      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {comp && <ResultadoComparacao comp={comp} soMudancas={soMudancas} />}
    </>
  );
}

function ResultadoComparacao({ comp, soMudancas }: { comp: Comparacao; soMudancas: boolean }) {
  const r = comp.resumo;
  const tarefas = soMudancas ? comp.tarefas.filter((t) => t.situacao !== 'igual') : comp.tarefas;
  const etapas = soMudancas ? comp.etapas.filter((g) => g.situacao !== 'igual') : comp.etapas;
  const semDiferenca = r.alteradas + r.incluidas + r.removidas === 0;
  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>{comp.rotuloA} × {comp.rotuloB}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <div>
            <span className="rotulo">Preço de venda A</span>
            <strong>{formatarMoeda(comp.a.precoTotal)}</strong>
            <div className="small muted">BDI {pct(comp.a.bdiPercentual)}</div>
          </div>
          <div>
            <span className="rotulo">Preço de venda B</span>
            <strong>{formatarMoeda(comp.b.precoTotal)}</strong>
            <div className="small muted">BDI {pct(comp.b.bdiPercentual)}</div>
          </div>
          <div>
            <span className="rotulo">Diferença (B − A)</span>
            <strong>{sinal(r.delta)}{formatarMoeda(r.delta)} ({sinal(r.percentual)}{pct(r.percentual)})</strong>
          </div>
          <div>
            <span className="rotulo">Tarefas</span>
            <div className="small">
              {r.alteradas} alterada(s) · {r.incluidas} incluída(s) · {r.removidas} removida(s) · {r.iguais} igual(is)
            </div>
          </div>
        </div>
      </div>

      {semDiferenca && <div className="card"><p className="muted" style={{ margin: 0 }}>As duas versões têm os mesmos quantitativos e preços.</p></div>}

      {etapas.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Etapas</h2>
          <div style={{ overflowX: 'auto' }}>
            <table className="tabela">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Descrição</th>
                  <th>Situação</th>
                  <th className="num">Total A</th>
                  <th className="num">Total B</th>
                  <th className="num">Diferença</th>
                </tr>
              </thead>
              <tbody>
                {etapas.map((g) => (
                  <tr key={g.codigo}>
                    <td>{g.codigo}</td>
                    <td>{g.descricao}</td>
                    <td>{ROTULO_SITUACAO[g.situacao]}</td>
                    <td className="num">{formatarMoeda(g.totalA)}</td>
                    <td className="num">{formatarMoeda(g.totalB)}</td>
                    <td className="num">{sinal(g.delta)}{formatarMoeda(g.delta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tarefas.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Tarefas</h2>
          <div style={{ overflowX: 'auto' }}>
            <table className="tabela">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Descrição</th>
                  <th>Situação</th>
                  <th>O que mudou</th>
                  <th className="num">Quantidade A → B</th>
                  <th className="num">Preço unit. A → B</th>
                  <th className="num">Total A</th>
                  <th className="num">Total B</th>
                  <th className="num">Diferença</th>
                </tr>
              </thead>
              <tbody>
                {tarefas.map((t) => (
                  <tr key={t.codigo}>
                    <td>{t.codigo}</td>
                    <td>
                      {t.descricao}
                      {t.a && t.b && t.a.codigo !== t.b.codigo && <div className="small muted">{t.a.codigo} → {t.b.codigo}</div>}
                    </td>
                    <td>{ROTULO_SITUACAO[t.situacao]}</td>
                    <td>{t.mudancas.join(', ') || '—'}</td>
                    <td className="num">{t.a ? num(t.a.quantidade, 2) : '—'} → {t.b ? num(t.b.quantidade, 2) : '—'}</td>
                    <td className="num">{t.a ? formatarMoeda(t.a.precoUnitario) : '—'} → {t.b ? formatarMoeda(t.b.precoUnitario) : '—'}</td>
                    <td className="num">{t.a ? formatarMoeda(t.a.total) : '—'}</td>
                    <td className="num">{t.b ? formatarMoeda(t.b.total) : '—'}</td>
                    <td className="num">{sinal(t.delta)}{formatarMoeda(t.delta)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

/** Equipes: trabalhadores por dia em cada tipo de mão de obra, no pico de cada período. */
export function EquipesView({ e }: { e: EquipesRel }) {
  if (!e.porTipo.length) return <div className="card"><p className="muted" style={{ margin: 0 }}>Nenhuma mão de obra horista encontrada no orçamento das atividades.</p></div>;
  return (
    <>
      <div className="card">
        <p className="small muted" style={{ marginTop: 0 }}>
          Jornada de {num(e.horasDia, 2)} h por dia (ajustável no cadastro da obra). Trabalhadores = horas da atividade ÷ dias ÷ jornada.
          Em cada período aparece o pico diário, arredondado para cima.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table className="tabela">
            <thead>
              <tr>
                <th>Mão de obra</th>
                <th className="num">Pico</th>
                {e.periodos.map((p) => <th key={p} className="num">{p}</th>)}
              </tr>
            </thead>
            <tbody>
              {e.porTipo.map((t) => (
                <tr key={t.codigo}>
                  <td>{t.descricao}</td>
                  <td className="num"><b>{t.pico}</b></td>
                  {t.periodos.map((p) => <td key={p.rotulo} className="num">{p.trabalhadores || '—'}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Atividades</h2>
        <p className="small muted" style={{ marginTop: 0 }}>
          Etapas e subetapas (em destaque) agrupam as atividades abaixo delas, com o período de cada uma.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table className="tabela">
            <thead>
              <tr>
                <th>Atividade</th>
                <th>Período</th>
                <th className="num">Dias</th>
                <th>Trabalhadores necessários</th>
              </tr>
            </thead>
            <tbody>
              {e.porAtividade.map((a) => {
                const recuo = Math.max(0, (a.nivel ?? 1) - 1) * 16;
                return (
                  <tr key={a.id} style={a.resumo ? { background: 'var(--surface-sunken)', fontWeight: 600 } : undefined}>
                    <td style={{ paddingLeft: 12 + recuo }}>
                      {a.eapCodigo && <span className="small muted" style={{ marginRight: 6 }}>{a.eapCodigo}</span>}
                      {a.descricao}
                    </td>
                    <td className="small">{dataCurta(a.inicio)} a {dataCurta(a.fim)}</td>
                    <td className="num">{a.duracaoDias}</td>
                    <td className="small">
                      {a.resumo
                        ? null
                        : a.recursos.length
                          ? a.recursos.map((r) => `${r.descricao}: ${r.trabalhadores}`).join(' · ')
                          : <span className="muted">sem mão de obra no orçamento</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {e.mensalistasNaoCalculados.length > 0 && (
          <p className="small muted">
            Fora do cálculo, por serem mensalistas (sem horas): {e.mensalistasNaoCalculados.join(', ')}.
          </p>
        )}
        {e.atividadesSemOrcamento > 0 && <p className="small muted">{e.atividadesSemOrcamento} atividade(s) sem orçamento vinculado: não entram nos cálculos.</p>}
      </div>
    </>
  );
}

/** Compras: materiais a entregar, com a data da primeira atividade que usa cada insumo. Mão de obra, equipamentos e terceirizados ficam de fora. */
/** Materiais ou equipamentos necessários. `classe` diz o que a lista traz: a quantidade e a data de entrega valem para os dois. */
export function ComprasView({ c, classe = 'material' }: { c: ComprasRel; classe?: 'material' | 'equipamento' }) {
  const rotulo = classe === 'material' ? 'Material' : 'Equipamento';
  if (!c.itens.length) return <div className="card"><p className="muted" style={{ margin: 0 }}>Nenhum {classe === 'material' ? 'material' : 'equipamento'} encontrado para as atividades do planejamento.</p></div>;
  return (
    <div className="card">
      <p className="small muted" style={{ marginTop: 0 }}>
        {classe === 'material'
          ? 'Quantidade total de cada material, com a data em que ele deve estar na obra (início da primeira atividade que o usa). Ficam de fora mão de obra, equipamentos e serviços terceirizados.'
          : 'Quantidade total de cada equipamento, com a data em que ele deve estar na obra (início da primeira atividade que o usa). Ficam de fora materiais, mão de obra e serviços terceirizados.'}
      </p>
      <div style={{ overflowX: 'auto' }}>
        <table className="tabela">
          <thead>
            <tr>
              <th>{rotulo}</th>
              <th>Un.</th>
              <th className="num">Quantidade</th>
              <th>Entregar até</th>
              <th>Usado em</th>
            </tr>
          </thead>
          <tbody>
            {c.itens.map((i) => (
              <tr key={i.codigo}>
                <td>{i.descricao}{!i.grupo && <span className="small muted"> · classe não identificada</span>}</td>
                <td>{i.unidade}</td>
                <td className="num">{num(i.total, 3)}</td>
                <td>{dataCurta(i.primeira)}</td>
                <td className="small" title={i.usos.map((u) => `${u.atividade} (${dataCurta(u.inicio)}): ${num(u.quantidade, 3)}`).join('\n')}>
                  {i.usos.length} atividade(s)
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {c.semClasse > 0 && <p className="small muted">{c.semClasse} item(ns) sem classe identificada: conferir antes de comprar.</p>}
      {c.atividadesSemOrcamento > 0 && <p className="small muted">{c.atividadesSemOrcamento} atividade(s) sem orçamento vinculado: não entram na lista.</p>}
    </div>
  );
}

/** Calendário de produção: um bloco por período (dia, semana, quinzena ou mês). Cada atividade marca o dia de início, a continuação e o término. */
function CalendarioView({ c }: { c: CalendarioRel }) {
  if (!c.blocos.length) return <div className="card"><p className="muted" style={{ margin: 0 }}>Não há atividades programadas. Monte o planejamento em Planejamento.</p></div>;
  const letra = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  const diaSemana = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();
  const simbolo = { inicio: '▶', continua: '', fim: '■', unico: '◆' } as const;
  const titulo = { inicio: 'Início', continua: 'Continuação', fim: 'Término', unico: 'Início e término no mesmo dia' } as const;
  return (
    <>
      <div className="card">
        <p className="small muted" style={{ marginTop: 0 }}>
          Programação de {c.inicio ? dataCurta(c.inicio) : '—'} a {c.fim ? dataCurta(c.fim) : '—'}. Cada linha é uma atividade (tarefa da EAP) e cada coluna é um dia.
        </p>
        <div className="cal-legenda small">
          <span><b className="cal-celula cal-inicio">▶</b> início</span>
          <span><b className="cal-celula cal-continua" /> continuação</span>
          <span><b className="cal-celula cal-fim">■</b> término</span>
          <span><b className="cal-celula cal-unico">◆</b> início e término no mesmo dia</span>
        </div>
      </div>
      {c.blocos.map((b) => (
        <div className="card cal-bloco" key={`${b.inicio}-${b.rotulo}`}>
          <h2 style={{ marginTop: 0 }}>{b.rotulo} <span className="small muted">· {dataCurta(b.inicio)} a {dataCurta(b.fim)}</span></h2>
          <div style={{ overflowX: 'auto' }}>
            <table className="tabela cal-tabela">
              <thead>
                <tr>
                  <th className="cal-atividade">Atividade</th>
                  {b.dias.map((d) => (
                    <th key={d} className={`cal-dia${diaSemana(d) === 0 || diaSemana(d) === 6 ? ' fds' : ''}`} title={dataCurta(d)}>
                      <div>{letra[diaSemana(d)]}</div>
                      <div>{d.slice(8, 10)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.linhas.map((l) => (
                  <tr key={l.id}>
                    <td className="cal-atividade">
                      {l.eapCodigo && <span className="mono small muted">{l.eapCodigo} </span>}
                      {l.descricao}
                    </td>
                    {b.dias.map((d) => {
                      const m = l.marcas[d];
                      return (
                        <td key={d} className={`cal-celula${m ? ` cal-${m}` : ''}`} title={m ? `${l.descricao}: ${titulo[m]} · ${dataCurta(d)}` : undefined}>
                          {m ? simbolo[m] : ''}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <p className="small muted">Períodos sem atividades não aparecem. Os dias são corridos.</p>
    </>
  );
}
