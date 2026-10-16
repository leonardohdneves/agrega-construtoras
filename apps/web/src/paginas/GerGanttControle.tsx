// Gerencial · Gantt de controle: cada atividade mostra o planejado (barra azul) e, logo abaixo, o realizado (barra cinza),
// que é o percentual executado da linha da EAP ligada à atividade, aplicado sobre o mesmo intervalo.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { SecaoObra } from './EngSecoes';

type Periodo = { rotulo: string; inicio: string; fim: string; dias: number };
type AtividadeGantt = { id: string; descricao: string; eapCodigo: string | null; inicio: string; fim: string; duracaoDias: number; deslocamentoDias: number };
type GanttControle = { granularidade: string; inicio: string; fim: string; totalDias: number; periodos: Periodo[]; atividades: AtividadeGantt[]; atividadesSemEap: number };
type LinhaRealizado = { codigo: string; descricao: string; nivel: string; percentualExecutado: number };
type PrevistoRealizado = { dataRef: string; linhas: LinhaRealizado[] };

const dataCurta = (iso: string) => iso.split('-').reverse().join('/');
const GRANULARIDADES = [
  { id: 'dia', texto: 'Dia' },
  { id: 'semana', texto: 'Semana' },
  { id: 'quinzena', texto: 'Quinzena' },
  { id: 'mes', texto: 'Mês' },
];

export function GerGanttControle() {
  return (
    <SecaoObra titulo="Gantt de controle" ajuda="Planejado (azul) e realizado (cinza) por atividade. O realizado vem do percentual executado da linha da EAP ligada à atividade.">
      {(c) => <GanttComControle obraId={c.obra.id} setErro={c.setErro} />}
    </SecaoObra>
  );
}

function GanttComControle({ obraId, setErro }: { obraId: string; setErro: (m: string) => void }) {
  const [gran, setGran] = useState('semana');
  const [gantt, setGantt] = useState<GanttControle | null>(null);
  const [real, setReal] = useState<PrevistoRealizado | null>(null);
  const [dica, setDica] = useState<AtividadeGantt | null>(null);

  useEffect(() => {
    setGantt(null);
    Promise.all([
      api<GanttControle>(`/eng/obras/${obraId}/relatorios-planejamento/gantt?granularidade=${gran}`),
      api<PrevistoRealizado>(`/eng/obras/${obraId}/relatorios-gerenciais/previsto-realizado`),
    ])
      .then(([g, r]) => {
        setGantt(g);
        setReal(r);
      })
      .catch((e) => setErro((e as Error).message));
  }, [obraId, gran]);

  if (!gantt) return <p className="muted">Carregando…</p>;
  if (!gantt.atividades.length) return <div className="card"><p className="muted" style={{ margin: 0 }}>Não há atividades no planejamento desta obra. Monte-o em Planejamento.</p></div>;

  const pctPorCodigo = new Map((real?.linhas ?? []).map((l) => [l.codigo, l.percentualExecutado]));
  const hojeIso = real?.dataRef ?? null;
  const posicaoDias = (iso: string) => {
    const d = (Date.parse(iso) - Date.parse(gantt.inicio)) / 86400000;
    return d / gantt.totalDias;
  };
  const marcaHoje = hojeIso && hojeIso >= gantt.inicio && hojeIso <= gantt.fim ? posicaoDias(hojeIso) : null;

  return (
    <>
      <div className="card" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <div className="segmentado" role="group" aria-label="Período" style={{ minWidth: 300 }}>
          {GRANULARIDADES.map((g) => (
            <button key={g.id} type="button" aria-pressed={gran === g.id} className={gran === g.id ? 'ativo' : ''} onClick={() => setGran(g.id)}>{g.texto}</button>
          ))}
        </div>
        <div className="grafico-legenda" style={{ margin: 0 }}>
          <span className="grafico-legenda-item"><span className="grafico-dica-chave" style={{ background: '#2a78d6' }} />Planejado</span>
          <span className="grafico-legenda-item"><span className="grafico-dica-chave" style={{ background: '#8b8a85' }} />Realizado</span>
          {marcaHoje !== null && <span className="grafico-legenda-item"><span className="grafico-dica-chave" style={{ background: 'transparent', border: '1px dashed var(--ink-muted, #6b7280)' }} />Data de referência</span>}
        </div>
        <span className="small muted" style={{ marginLeft: 'auto' }}>
          {dataCurta(gantt.inicio)} a {dataCurta(gantt.fim)} · {gantt.totalDias} dias{gantt.atividadesSemEap ? ` · ${gantt.atividadesSemEap} sem linha da EAP` : ''}
        </span>
      </div>

      <div className="card" style={{ overflowX: 'auto', position: 'relative' }}>
        <div style={{ minWidth: 900, position: 'relative' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--borda, #e4e4e7)', position: 'sticky', top: 0, background: 'var(--surface-card, #fff)' }}>
            <div className="small muted" style={{ flex: '0 0 300px', padding: '6px 8px 6px 0' }}>Atividade</div>
            <div style={{ flex: 1, display: 'flex' }}>
              {gantt.periodos.map((p) => (
                <div key={p.inicio} style={{ flex: `${p.dias} 1 0`, fontSize: 11, padding: '6px 2px', borderLeft: '1px solid var(--borda, #e4e4e7)', overflow: 'hidden', whiteSpace: 'nowrap', color: 'var(--ink-muted, #6b7280)' }} title={`${dataCurta(p.inicio)} a ${dataCurta(p.fim)}`}>
                  {p.rotulo}
                </div>
              ))}
            </div>
          </div>
          {gantt.atividades.map((a) => {
            const pct = a.eapCodigo ? pctPorCodigo.get(a.eapCodigo) ?? 0 : 0;
            const esquerda = (a.deslocamentoDias / gantt.totalDias) * 100;
            const largura = Math.max(0.5, (a.duracaoDias / gantt.totalDias) * 100);
            return (
              <div
                key={a.id}
                onPointerEnter={() => setDica(a)}
                onPointerLeave={() => setDica(null)}
                style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--borda, #e4e4e7)', minHeight: 44, background: dica?.id === a.id ? 'var(--surface-sunken, #f4f4f5)' : undefined }}
              >
                <div style={{ flex: '0 0 300px', padding: '6px 8px 6px 0', fontSize: 12 }}>
                  <div>{a.descricao}</div>
                  <div className="small muted">{a.eapCodigo ?? 'sem linha da EAP'} · {Math.round(pct)}% executado</div>
                </div>
                <div style={{ flex: 1, position: 'relative', height: 30 }}>
                  <div style={{ position: 'absolute', top: 2, height: 12, borderRadius: 3, background: '#2a78d6', left: `${esquerda}%`, width: `${largura}%` }} />
                  <div style={{ position: 'absolute', top: 16, height: 8, borderRadius: 3, background: '#8b8a85', left: `${esquerda}%`, width: `${largura * Math.min(100, pct) / 100}%`, minWidth: pct > 0 ? 2 : 0 }} />
                </div>
              </div>
            );
          })}
          {marcaHoje !== null && (
            <div aria-hidden="true" style={{ position: 'absolute', top: 0, bottom: 0, left: `calc(300px + (100% - 300px) * ${marcaHoje})`, borderLeft: '1px dashed var(--ink-muted, #6b7280)', pointerEvents: 'none' }} />
          )}
        </div>
        {dica && (
          <div className="grafico-dica grafico-dica-fixa" role="status" style={{ marginTop: 8 }}>
            <div className="grafico-dica-titulo">{dica.descricao}</div>
            <div className="grafico-dica-linha"><span className="grafico-dica-nome">Início</span><b>{dataCurta(dica.inicio)}</b></div>
            <div className="grafico-dica-linha"><span className="grafico-dica-nome">Término</span><b>{dataCurta(dica.fim)}</b></div>
            <div className="grafico-dica-linha"><span className="grafico-dica-nome">Duração</span><b>{dica.duracaoDias} dias</b></div>
            <div className="grafico-dica-linha"><span className="grafico-dica-nome">Executado</span><b>{Math.round(dica.eapCodigo ? pctPorCodigo.get(dica.eapCodigo) ?? 0 : 0)}%</b></div>
          </div>
        )}
      </div>
    </>
  );
}
