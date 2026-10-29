import { useEffect, useMemo, useState } from 'react';
import { api, formatarData, formatarMoeda, formatarNumero } from '../api';

// ---------- Tipos das respostas da API (engenharia) ----------
type ObraInfo = {
  id: string; codigo: string; nome: string; endereco: string | null; cidade: string | null; uf: string | null; responsavel: string | null;
  status: string; dataInicio: string | null; dataPrevisao: string | null; bdiPercentual: number | null;
};
type PrevReal = {
  dataRef: string;
  linhas: { id: string; codigo: string; descricao: string; nivel: string; custoPrevisto: number; previstoAte: number; executado: number; percentualExecutado: number; saldo: number; spi: number | null }[];
  totais: { custoPrevisto: number; previstoAte: number; executado: number; realizado: number; saldo: number; cpi: number | null; spi: number | null };
  observacao: string;
};
type CurvaS = {
  pontos: { data: string; previsto: number; executado: number | null; realizado: number | null }[];
  hoje: string;
  custoTotal: number;
  dataUltimaMedicao: string | null;
  indices: { cpi: number | null; spi: number | null };
  vazio?: string;
};
type ObraLista = { id: string; codigo: string; nome: string };

const ROTULO_STATUS: Record<string, string> = { orcamento: 'Em orçamento', planejamento: 'Planejamento', em_andamento: 'Em andamento', suspensa: 'Suspensa', concluida: 'Concluída' };
// A API já devolve o percentual em 0–100.
const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${formatarNumero(n, 1)}%`);
const indice = (n: number | null | undefined) => (n === null || n === undefined ? '—' : formatarNumero(n, 2));
const tomIndice = (n: number | null | undefined) => (n === null || n === undefined ? undefined : n >= 1 ? 'ok' : n >= 0.9 ? 'aviso' : 'perigo');

function Tile({ rotulo, valor, detalhe, tom }: { rotulo: string; valor: string; detalhe?: string; tom?: 'ok' | 'aviso' | 'perigo' }) {
  const cor = tom === 'perigo' ? 'var(--perigo, #b42318)' : tom === 'aviso' ? 'var(--aviso, #b54708)' : tom === 'ok' ? 'var(--ok, #067647)' : 'inherit';
  return (
    <div className="card" style={{ flex: '1 1 160px', minWidth: 0 }}>
      <div className="small muted">{rotulo}</div>
      <div className="mono" style={{ fontSize: 20, fontWeight: 600, color: cor, overflowWrap: 'anywhere' }}>{valor}</div>
      {detalhe && <div className="small muted">{detalhe}</div>}
    </div>
  );
}

/** Curva S: previsto, executado (medições) e realizado (despesas) ao longo do tempo, em SVG. */
function CurvaSGrafico({ pontos, hoje }: { pontos: CurvaS['pontos']; hoje: string }) {
  const W = 640;
  const H = 240;
  const P = { t: 12, r: 12, b: 28, l: 64 };
  const n = pontos.length;
  if (n < 2) return <p className="muted">Sem pontos suficientes para a curva.</p>;
  const max = Math.max(1, ...pontos.map((p) => Math.max(p.previsto, p.executado ?? 0, p.realizado ?? 0)));
  const x = (i: number) => P.l + (i / (n - 1)) * (W - P.l - P.r);
  const y = (v: number) => H - P.b - (v / max) * (H - P.t - P.b);
  const linha = (get: (p: CurvaS['pontos'][number]) => number | null) => {
    let d = '';
    pontos.forEach((p, i) => {
      const v = get(p);
      if (v === null) return;
      d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
    });
    return d;
  };
  const idxHoje = pontos.findIndex((p) => p.data >= hoje);
  const rotulos = [0, Math.floor((n - 1) / 2), n - 1];
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Curva S" style={{ width: '100%', maxWidth: W, height: 'auto' }}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={P.l} x2={W - P.r} y1={y(max * f)} y2={y(max * f)} stroke="currentColor" strokeOpacity={0.12} />
            <text x={P.l - 6} y={y(max * f) + 4} textAnchor="end" fontSize={11} fill="currentColor" opacity={0.7}>
              {formatarNumero(max * f / 1000, 0)}k
            </text>
          </g>
        ))}
        {idxHoje > 0 && <line x1={x(idxHoje)} x2={x(idxHoje)} y1={P.t} y2={H - P.b} stroke="currentColor" strokeDasharray="4 4" opacity={0.4} />}
        <path d={linha((p) => p.previsto)} fill="none" stroke="#2563eb" strokeWidth={2.5} />
        <path d={linha((p) => p.executado)} fill="none" stroke="#059669" strokeWidth={2.5} />
        <path d={linha((p) => p.realizado)} fill="none" stroke="#d97706" strokeWidth={2} strokeDasharray="6 3" />
        {rotulos.map((i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="currentColor" opacity={0.7}>
            {formatarData(pontos[i].data)}
          </text>
        ))}
      </svg>
      <div className="small" style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <span><b style={{ color: '#2563eb' }}>━</b> Previsto</span>
        <span><b style={{ color: '#059669' }}>━</b> Executado (medições)</span>
        <span><b style={{ color: '#d97706' }}>╍</b> Realizado (despesas)</span>
      </div>
    </div>
  );
}

/** Barras horizontais: previsto até a data e executado por etapa. */
function EtapasBarras({ linhas }: { linhas: PrevReal['linhas'] }) {
  const top = useMemo(() => [...linhas].sort((a, b) => b.custoPrevisto - a.custoPrevisto).slice(0, 10), [linhas]);
  const max = Math.max(1, ...top.map((l) => l.custoPrevisto));
  if (!top.length) return <p className="muted">Nenhuma etapa com custo.</p>;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {top.map((l) => (
        <div key={l.id}>
          <div className="small" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{l.codigo} {l.descricao}</span>
            <span className="mono">{formatarMoeda(l.executado)} / {formatarMoeda(l.custoPrevisto)}</span>
          </div>
          <div style={{ position: 'relative', height: 10, background: 'rgba(127,127,127,0.18)', borderRadius: 4 }}>
            <div style={{ position: 'absolute', inset: 0, width: `${(l.custoPrevisto / max) * 100}%`, background: 'rgba(37,99,235,0.35)', borderRadius: 4 }} />
            <div style={{ position: 'absolute', inset: 0, width: `${Math.min(100, (l.executado / max) * 100)}%`, background: '#059669', borderRadius: 4 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PainelObraBI({ obras }: { obras: ObraLista[] }) {
  const [obraId, setObraId] = useState<string>('');
  const [info, setInfo] = useState<ObraInfo | null>(null);
  const [pr, setPr] = useState<PrevReal | null>(null);
  const [curva, setCurva] = useState<CurvaS | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [versao, setVersao] = useState(0);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState('');

  // Obra padrão: a primeira da lista (a ordem é a do código).
  useEffect(() => {
    if (!obraId && obras.length) setObraId(obras[0].id);
  }, [obras, obraId]);

  useEffect(() => {
    if (!obraId) return;
    let ativo = true;
    setCarregando(true);
    setErro('');
    Promise.all([
      api<{ obra: ObraInfo }>(`/eng/obras/${obraId}`),
      api<PrevReal>(`/eng/obras/${obraId}/relatorios-gerenciais/previsto-realizado`),
      api<CurvaS>(`/eng/obras/${obraId}/relatorios-gerenciais/curva-s`),
    ])
      .then(([o, p, c]) => {
        if (!ativo) return;
        setInfo(o.obra);
        setPr(p);
        setCurva(c);
      })
      .catch((e) => ativo && setErro((e as Error).message))
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, [obraId, versao]);

  async function adotarDatas() {
    setErro('');
    setAviso('');
    setOcupado(true);
    try {
      const r = await api<{ dataInicio: string; dataPrevisao: string }>(`/eng/obras/${obraId}/adotar-datas-planejamento`, { metodo: 'POST' });
      setAviso(`Datas da obra atualizadas: início ${formatarData(r.dataInicio)}, previsão ${formatarData(r.dataPrevisao)}.`);
      setVersao((v) => v + 1);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const hoje = curva?.hoje ?? new Date().toISOString().slice(0, 10);
  const diasParaPrevisao = info?.dataPrevisao ? Math.round((new Date(info.dataPrevisao + 'T12:00:00').getTime() - new Date(hoje + 'T12:00:00').getTime()) / 86400000) : null;
  const t = pr?.totais;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
        <label style={{ flex: '1 1 320px', minWidth: 0 }}>
          <span className="small muted">Obra</span>
          <select aria-label="Escolher obra" value={obraId} onChange={(e) => setObraId(e.target.value)} style={{ width: '100%' }}>
            {obras.map((o) => (
              <option key={o.id} value={o.id}>{o.codigo} · {o.nome}</option>
            ))}
          </select>
        </label>
        <button className="btn btn-secundario" type="button" disabled={!obraId || ocupado} onClick={adotarDatas}>
          Adotar datas do planejamento
        </button>
        {info && (
          <div className="small muted" style={{ flex: '2 1 360px', minWidth: 0, overflowWrap: 'anywhere' }}>
            <b>{ROTULO_STATUS[info.status] ?? info.status}</b>
            {info.responsavel ? ` · Responsável: ${info.responsavel}` : ''}
            {info.cidade ? ` · ${info.cidade}${info.uf ? `/${info.uf}` : ''}` : ''}
            <br />
            Início {formatarData(info.dataInicio)} · Previsão {formatarData(info.dataPrevisao)}
            {diasParaPrevisao !== null && ` · ${diasParaPrevisao >= 0 ? `faltam ${diasParaPrevisao} dias` : `atrasada há ${-diasParaPrevisao} dias`}`}
            {info.bdiPercentual !== null && ` · BDI ${formatarNumero(info.bdiPercentual, 1)}%`}
          </div>
        )}
      </div>

      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}
      {carregando && !pr && <p className="muted">Carregando dashboard…</p>}

      {t && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <Tile rotulo="Orçado" valor={formatarMoeda(t.custoPrevisto)} detalhe={info?.bdiPercentual !== null && info?.bdiPercentual !== undefined ? 'Custo previsto da planilha' : undefined} />
            <Tile rotulo="Previsto até a data" valor={formatarMoeda(t.previstoAte)} detalhe={`Referência: ${formatarData(pr!.dataRef)}`} />
            <Tile rotulo="Executado (medições)" valor={formatarMoeda(t.executado)} />
            <Tile rotulo="Realizado (despesas)" valor={formatarMoeda(t.realizado)} detalhe="Lançamentos confirmados no centro de custo" />
            <Tile rotulo="Saldo a executar" valor={formatarMoeda(t.saldo)} tom={t.saldo < 0 ? 'perigo' : undefined} />
            <Tile rotulo="SPI (prazo/avanço)" valor={indice(t.spi)} tom={tomIndice(t.spi)} detalhe="Executado ÷ previsto até a data" />
            <Tile rotulo="CPI (custo)" valor={indice(t.cpi)} tom={tomIndice(t.cpi)} detalhe="Executado ÷ realizado" />
          </div>

          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))' }}>
            <div className="card">
              <h3>Curva S</h3>
              {curva?.vazio ? <p className="muted">{curva.vazio}</p> : curva ? <CurvaSGrafico pontos={curva.pontos} hoje={hoje} /> : null}
              {curva?.dataUltimaMedicao && <p className="small muted">Última medição: {formatarData(curva.dataUltimaMedicao)}</p>}
            </div>
            <div className="card">
              <h3>Etapas: executado × orçado</h3>
              <EtapasBarras linhas={pr!.linhas.filter((l) => l.nivel === 'etapa')} />
            </div>
          </div>

          <div className="card">
            <h3>Etapas</h3>
            <div className="tabela-wrap">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Etapa</th>
                    <th className="n">Previsto</th>
                    <th className="n">Previsto até a data</th>
                    <th className="n">Executado</th>
                    <th className="n">% exec.</th>
                    <th className="n">Saldo</th>
                    <th className="n">SPI</th>
                  </tr>
                </thead>
                <tbody>
                  {pr!.linhas.filter((l) => l.nivel === 'etapa').map((l) => (
                    <tr key={l.id}>
                      <td className="mono">{l.codigo}</td>
                      <td>{l.descricao}</td>
                      <td className="n">{formatarMoeda(l.custoPrevisto)}</td>
                      <td className="n">{formatarMoeda(l.previstoAte)}</td>
                      <td className="n">{formatarMoeda(l.executado)}</td>
                      <td className="n">{pct(l.percentualExecutado)}</td>
                      <td className="n">{formatarMoeda(l.saldo)}</td>
                      <td className="n">{indice(l.spi)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small muted">{pr!.observacao}</p>
          </div>
        </>
      )}
    </div>
  );
}
