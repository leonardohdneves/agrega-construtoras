// Engenharia · Relatórios: orçamento sintético e analítico, no formato usual de mercado (SIENGE, planilhas do TCU).
// Sintético: EAP com o total de cada grupo e os serviços com quantidade, custo unitário, preço unitário com BDI,
// preço total e peso (%). Analítico: o mesmo, com os insumos de cada composição abaixo do serviço.
import { useEffect, useState } from 'react';
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
type Tipo = 'sintetico' | 'analitico' | 'abc-servicos' | 'abc-insumos';
const TIPOS: { id: Tipo; texto: string; titulo: string }[] = [
  { id: 'sintetico', texto: 'Orçamento sintético', titulo: 'Orçamento sintético' },
  { id: 'analitico', texto: 'Orçamento analítico', titulo: 'Orçamento analítico' },
  { id: 'abc-servicos', texto: 'Curva ABC de serviços', titulo: 'Curva ABC de serviços' },
  { id: 'abc-insumos', texto: 'Curva ABC de insumos', titulo: 'Curva ABC de insumos' },
];

const num = (n: number, casas = 4) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: casas });
const pct = (n: number) => `${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

export function EngRelatorios() {
  const [params, setParams] = useSearchParams();
  const [obras, setObras] = useState<Obra[] | null>(null);
  const [rel, setRel] = useState<Relatorio | null>(null);
  const [abc, setAbc] = useState<RelatorioAbc | null>(null);
  const [erro, setErro] = useState('');
  const obraId = params.get('obra') ?? obras?.[0]?.id ?? '';
  const tipo: Tipo = TIPOS.find((t) => t.id === params.get('tipo'))?.id ?? 'sintetico';
  const ehAbc = tipo.startsWith('abc-');

  useEffect(() => {
    api<{ obras: Obra[] }>('/eng/obras')
      .then((r) => setObras(r.obras))
      .catch((e) => setErro((e as Error).message));
  }, []);
  useEffect(() => {
    if (!obraId) return;
    setRel(null);
    setAbc(null);
    setErro('');
    const pedido = ehAbc
      ? api<RelatorioAbc>(`/eng/obras/${obraId}/relatorio-abc?tipo=${tipo === 'abc-insumos' ? 'insumos' : 'servicos'}`).then(setAbc)
      : api<Relatorio>(`/eng/obras/${obraId}/relatorio-orcamento?tipo=${tipo}`).then(setRel);
    pedido.catch((e) => setErro((e as Error).message));
  }, [obraId, tipo]);

  const mudar = (p: Record<string, string>) => setParams({ obra: obraId, tipo, ...p }, { replace: true });
  const obraRel = rel?.obra ?? abc?.obra;
  const local = obraRel ? [obraRel.endereco, [obraRel.cidade, obraRel.uf].filter(Boolean).join('/')].filter(Boolean).join(' · ') : '';

  return (
    <div className="relatorio">
      <CabecalhoDocumento
        modulo="Engenharia"
        titulo={TIPOS.find((t) => t.id === tipo)!.titulo}
        descricao={obraRel ? `Obra ${obraRel.codigo} · ${obraRel.nome}` : undefined}
        filtros={obraRel ? [local, obraRel.responsavel ? `Responsável técnico: ${obraRel.responsavel}` : '', `BDI: ${pct(obraRel.bdiPercentual)}`] : []}
      />

      <div className="card nao-imprimir" style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
        <div className="campo" style={{ minWidth: 280 }}>
          <label htmlFor="rel-obra">Obra</label>
          <select id="rel-obra" value={obraId} onChange={(e) => mudar({ obra: e.target.value })}>
            {(obras ?? []).map((o) => <option key={o.id} value={o.id}>{o.codigo} · {o.nome}</option>)}
          </select>
        </div>
        <div className="campo">
          <span className="rotulo">Relatório</span>
          <div className="segmentado" role="group" aria-label="Relatório">
            {TIPOS.map((t) => (
              <button key={t.id} type="button" aria-pressed={tipo === t.id} className={tipo === t.id ? 'ativo' : ''} onClick={() => mudar({ tipo: t.id })}>{t.texto}</button>
            ))}
          </div>
        </div>
      </div>

      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {obras?.length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>Nenhuma obra cadastrada.</p></div>}
      {obraId && !rel && !abc && !erro && <p className="muted">Carregando…</p>}
      {abc && (abc.linhas.length === 0 ? <div className="card"><p className="muted" style={{ margin: 0 }}>Não há {abc.tipo === 'insumos' ? 'insumos' : 'serviços'} com valor no orçamento desta obra.</p></div> : <CurvaAbc rel={abc} />)}
      {rel && rel.linhas.length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>A planilha desta obra está vazia. Monte-a em EAP e orçamento.</p></div>}
      {rel && rel.linhas.length > 0 && (rel.tipo === 'sintetico' ? <Sintetico rel={rel} /> : <Analitico rel={rel} />)}
    </div>
  );
}

function Rodape({ rel, colunas }: { rel: Relatorio; colunas: number }) {
  return (
    <tfoot>
      <tr>
        <td colSpan={colunas - 1} className="num">Custo direto total</td>
        <td className="num">{formatarMoeda(rel.custoTotal)}</td>
      </tr>
      <tr>
        <td colSpan={colunas - 1} className="num">BDI ({pct(rel.obra.bdiPercentual)})</td>
        <td className="num">{formatarMoeda(rel.bdiValor)}</td>
      </tr>
      <tr>
        <td colSpan={colunas - 1} className="num"><b>Preço total do orçamento</b></td>
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
            <th className="num">Custo unit.</th>
            <th className="num">Preço unit. c/ BDI</th>
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
                <td colSpan={5}>{l.descricao}</td>
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
                <td className="num">{formatarMoeda(l.custoUnitario)}</td>
                <td className="num">{formatarMoeda(l.precoUnitario)}</td>
                <td className="num">{pct(l.peso)}</td>
                <td className="num">{formatarMoeda(l.total)}</td>
              </tr>
            ) : l.tipo === 'tarefa' ? (
              <tr key={i}>
                <td className="mono">{l.item}</td>
                <td />
                <td>{l.descricao}</td>
                <td colSpan={6} className="small muted">sem serviço</td>
              </tr>
            ) : null,
          )}
        </tbody>
        <Rodape rel={rel} colunas={9} />
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
            <th className="num">Preço unit. c/ BDI</th>
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
                <td className="num">{formatarMoeda(l.custoUnitario)}</td>
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
        Nos insumos: quantidade = coeficiente × quantidade do serviço; total = custo direto do insumo (sem BDI). Na linha do serviço, total com BDI.
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
          <div className="small">{rel.linhas.length} {insumos ? 'insumos' : 'serviços'} · {insumos ? 'custo direto' : 'preço com BDI'}</div>
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
              <th className="num">{insumos ? 'Custo unit.' : 'Preço unit. c/ BDI'}</th>
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
        {insumos ? 'Quantidade de cada insumo = coeficiente × quantidade dos serviços que o usam; valores sem BDI.' : 'O mesmo serviço lançado em várias tarefas aparece somado.'}
      </p>
    </>
  );
}
