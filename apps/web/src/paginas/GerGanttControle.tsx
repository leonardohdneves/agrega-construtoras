// Gerencial · Gantt de controle: a mesma árvore da EAP do planejamento (etapas, subetapas e atividades).
// Cada atividade mostra o planejado (barra azul) e, logo abaixo, o realizado (barra cinza), que é o percentual executado
// da linha da EAP ligada à atividade. Etapas e subetapas somam as atividades abaixo delas (média ponderada pelos dias).
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { SecaoObra } from './EngSecoes';
import type { No } from './EngObras';
import { type Atividade, dataBr, diasEntre, mesesEntre, montarLinhas } from './arvorePlanejamento';

type LinhaRealizado = { codigo: string; percentualExecutado: number };
type PrevistoRealizado = { dataRef: string; linhas: LinhaRealizado[] };

export function GerGanttControle() {
  return (
    <SecaoObra titulo="Gantt de controle" ajuda="Etapas e subetapas agrupam as atividades da EAP. Planejado em azul; realizado em cinza, pelo percentual executado de cada linha da EAP.">
      {(c) => <GanttComControle obraId={c.obra.id} nos={c.nos} setErro={c.setErro} />}
    </SecaoObra>
  );
}

function GanttComControle({ obraId, nos, setErro }: { obraId: string; nos: No[]; setErro: (m: string) => void }) {
  const [lista, setLista] = useState<Atividade[] | null>(null);
  const [real, setReal] = useState<PrevistoRealizado | null>(null);
  const [fechados, setFechados] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setLista(null);
    Promise.all([
      api<{ atividades: Atividade[] }>(`/eng/obras/${obraId}/planejamento`),
      api<PrevistoRealizado>(`/eng/obras/${obraId}/relatorios-gerenciais/previsto-realizado`),
    ])
      .then(([p, r]) => {
        setLista(p.atividades);
        setReal(r);
      })
      .catch((e) => setErro((e as Error).message));
  }, [obraId]);

  const pctPorCodigo = useMemo(() => new Map((real?.linhas ?? []).map((l) => [l.codigo, l.percentualExecutado])), [real]);
  // Árvore completa (tudo aberto) para calcular o realizado de cada etapa; a exibição usa `fechados`.
  const arvoreCompleta = useMemo(() => (lista ? montarLinhas(nos, lista, new Set()) : []), [nos, lista]);
  const linhas = useMemo(() => (lista ? montarLinhas(nos, lista, fechados) : []), [nos, lista, fechados]);

  if (!lista) return <p className="muted">Carregando…</p>;
  const comData = arvoreCompleta.filter((l) => l.inicio && l.fim);
  if (!comData.length) return <div className="card"><p className="muted" style={{ margin: 0 }}>Não há atividades com datas. Monte o planejamento em Planejamento.</p></div>;

  const ini = comData.reduce((m, l) => (l.inicio! < m ? l.inicio! : m), comData[0].inicio!);
  const fim = comData.reduce((m, l) => (l.fim! > m ? l.fim! : m), comData[0].fim!);
  const total = diasEntre(ini, fim) + 1;
  const meses = mesesEntre(ini, fim);
  const largura = Math.max(900, total * 4);
  const pctDe = (codigo: string | null) => (codigo ? pctPorCodigo.get(codigo) ?? 0 : 0);

  // Realizado de cada linha: atividade = % da EAP; etapa/subetapa = média das atividades abaixo, ponderada pelos dias.
  // Como montarLinhas devolve a árvore em ordem, a linha de resumo cobre as linhas seguintes com profundidade maior.
  const realizadoDe = (indice: number): number => {
    const l = arvoreCompleta[indice];
    if (!l.resumo) return l.atividade ? pctDe(l.atividade.eapCodigo) : 0;
    let soma = 0;
    let dias = 0;
    for (let j = indice + 1; j < arvoreCompleta.length && arvoreCompleta[j].profundidade > l.profundidade; j++) {
      const f = arvoreCompleta[j];
      if (!f.resumo && f.atividade && f.dias) {
        soma += pctDe(f.atividade.eapCodigo) * f.dias;
        dias += f.dias;
      }
    }
    return dias ? soma / dias : 0;
  };
  const indicePorChave = new Map(arvoreCompleta.map((l, i) => [l.chave, i]));

  const marcaHoje = real?.dataRef && real.dataRef >= ini && real.dataRef <= fim ? diasEntre(ini, real.dataRef) / total : null;

  return (
    <div className="card">
      <div className="acoes" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
        <p className="small muted" style={{ margin: 0 }}>
          Projeto de {dataBr(ini)} a {dataBr(fim)} · {total} dias corridos · realizado até {real ? dataBr(real.dataRef) : '—'}
        </p>
        <div className="grafico-legenda" style={{ margin: 0 }}>
          <span className="grafico-legenda-item"><span className="grafico-dica-chave" style={{ background: '#2a78d6' }} />Planejado</span>
          <span className="grafico-legenda-item"><span className="grafico-dica-chave" style={{ background: '#8b8a85' }} />Realizado</span>
          <button className="btn btn-secundario" type="button" onClick={() => setFechados(new Set())}>Expandir tudo</button>
          <button className="btn btn-secundario" type="button" onClick={() => setFechados(new Set(arvoreCompleta.filter((l) => l.temFilhos).map((l) => l.noId!)))}>Recolher tudo</button>
        </div>
      </div>

      <div style={{ overflowX: 'auto', marginTop: 8 }}>
        <div style={{ minWidth: largura + 320, position: 'relative' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
            <div className="small muted" style={{ flex: '0 0 320px', padding: '4px 8px 4px 0' }}>Atividade</div>
            <div style={{ flex: 1, display: 'flex' }}>
              {meses.map((m, i) => (
                <div key={i} className="gantt-mes" style={{ flex: `${m.dias} 1 0` }}>{m.rotulo}</div>
              ))}
            </div>
          </div>
          {linhas.map((l) => {
            const idx = indicePorChave.get(l.chave) ?? 0;
            const pct = Math.min(100, realizadoDe(idx));
            const temBarra = !!(l.inicio && l.fim);
            const esquerda = temBarra ? (diasEntre(ini, l.inicio!) / total) * 100 : 0;
            const largBarra = temBarra ? Math.max(0.5, ((diasEntre(l.inicio!, l.fim!) + 1) / total) * 100) : 0;
            return (
              <div key={l.chave} className={l.resumo ? 'arv-resumo' : undefined} style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)', minHeight: 40 }}>
                <div style={{ flex: '0 0 320px', padding: '4px 8px 4px 0', fontSize: 12, paddingLeft: 4 + l.profundidade * 14 }}>
                  {l.temFilhos ? (
                    <button
                      className="arv-botao"
                      type="button"
                      aria-expanded={l.aberta}
                      aria-label={`${l.aberta ? 'Recolher' : 'Expandir'} ${l.descricao}`}
                      onClick={() => {
                        const proximo = new Set(fechados);
                        if (proximo.has(l.noId!)) proximo.delete(l.noId!);
                        else proximo.add(l.noId!);
                        setFechados(proximo);
                      }}
                    >
                      {l.aberta ? '▾' : '▸'}
                    </button>
                  ) : null}
                  <span style={{ fontWeight: l.resumo ? 700 : 400 }}>{l.codigo ? `${l.codigo} ` : ''}{l.descricao}</span>
                  {temBarra && <div className="small muted">{Math.round(pct)}% executado · {dataBr(l.inicio!)} a {dataBr(l.fim!)}</div>}
                </div>
                <div style={{ flex: 1, position: 'relative', height: 30 }} title={temBarra ? `${l.descricao}: ${Math.round(pct)}% executado` : undefined}>
                  {temBarra && (
                    <>
                      <div style={{ position: 'absolute', top: 2, height: l.resumo ? 8 : 12, borderRadius: 3, background: '#2a78d6', opacity: l.resumo ? 0.55 : 1, left: `${esquerda}%`, width: `${largBarra}%` }} />
                      <div style={{ position: 'absolute', top: 16, height: 8, borderRadius: 3, background: '#8b8a85', left: `${esquerda}%`, width: `${(largBarra * pct) / 100}%`, minWidth: pct > 0 ? 2 : 0 }} />
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {marcaHoje !== null && (
            <div aria-hidden="true" style={{ position: 'absolute', top: 0, bottom: 0, left: `calc(320px + (100% - 320px) * ${marcaHoje})`, borderLeft: '1px dashed var(--ink-muted, #6b7280)', pointerEvents: 'none' }} />
          )}
        </div>
      </div>
    </div>
  );
}
