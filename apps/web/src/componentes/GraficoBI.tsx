// Gráficos do painel gerencial no padrão de BI: linhas com cursor (crosshair) e dica com todas as séries no mesmo ponto,
// e barras com dica por barra. Os textos vêm como dados e são exibidos com React (sem innerHTML).
import { useMemo, useRef, useState, type PointerEvent } from 'react';

export type SerieBI = { id: string; nome: string; cor: string; tracejada?: boolean };
export type PontoBI = { rotulo: string; valores: Record<string, number | null> };

/** Gráfico de linhas com cursor: a dica mostra o valor de cada série no ponto mais próximo do cursor. */
export function GraficoLinhasBI({ pontos, series, formatar, titulo }: { pontos: PontoBI[]; series: SerieBI[]; formatar: (v: number) => string; titulo: string }) {
  const L = 800, A = 320, M = { t: 16, r: 18, b: 34, l: 74 };
  const [ativo, setAtivo] = useState<number | null>(null);
  const area = useRef<SVGSVGElement>(null);
  const n = pontos.length;
  const maximo = useMemo(() => {
    const todos = pontos.flatMap((p) => series.map((s) => p.valores[s.id] ?? 0));
    const m = Math.max(1, ...todos);
    const potencia = Math.pow(10, Math.floor(Math.log10(m)));
    return Math.ceil(m / potencia) * potencia;
  }, [pontos, series]);

  const x = (i: number) => M.l + (n <= 1 ? (L - M.l - M.r) / 2 : (i / (n - 1)) * (L - M.l - M.r));
  const y = (v: number) => A - M.b - (v / maximo) * (A - M.t - M.b);
  const rotulosY = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maximo);
  const passo = Math.max(1, Math.ceil(n / 8));

  function aoMover(e: PointerEvent<SVGSVGElement>) {
    const el = area.current;
    if (!el || n === 0) return;
    const r = el.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * L;
    const f = (px - M.l) / (L - M.l - M.r);
    setAtivo(Math.min(n - 1, Math.max(0, Math.round(f * (n - 1)))));
  }

  const caminho = (id: string) => {
    const partes: string[] = [];
    pontos.forEach((p, i) => {
      const v = p.valores[id];
      if (v !== null && v !== undefined) partes.push(`${partes.length ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    });
    return partes.join(' ');
  };

  const pontoAtivo = ativo !== null ? pontos[ativo] : null;
  const posicaoDica = ativo !== null ? x(ativo) / L : 0;

  return (
    <div className="grafico-bi">
      <div className="grafico-legenda" aria-hidden="true">
        {series.map((s) => (
          <span key={s.id} className="grafico-legenda-item">
            <svg width="22" height="8" aria-hidden="true"><line x1="0" y1="4" x2="22" y2="4" stroke={s.cor} strokeWidth="3" strokeDasharray={s.tracejada ? '5 4' : undefined} strokeLinecap="round" /></svg>
            {s.nome}
          </span>
        ))}
      </div>
      <div className="grafico-area">
        <svg ref={area} viewBox={`0 0 ${L} ${A}`} role="img" aria-label={titulo} onPointerMove={aoMover} onPointerDown={aoMover} onPointerLeave={() => setAtivo(null)} style={{ width: '100%', height: 'auto', display: 'block', touchAction: 'pan-y' }}>
          {rotulosY.map((v) => (
            <g key={v}>
              <line x1={M.l} x2={L - M.r} y1={y(v)} y2={y(v)} stroke="var(--borda, #e4e4e7)" strokeWidth="1" />
              <text x={M.l - 10} y={y(v) + 4} textAnchor="end" fontSize="12" fill="var(--ink-muted, #6b7280)">{formatar(v)}</text>
            </g>
          ))}
          {pontos.map((p, i) => (i % passo === 0 ? (
            <text key={i} x={x(i)} y={A - 10} textAnchor="middle" fontSize="12" fill="var(--ink-muted, #6b7280)">{p.rotulo}</text>
          ) : null))}
          {series.map((s) => (
            <path key={s.id} d={caminho(s.id)} fill="none" stroke={s.cor} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.tracejada ? '6 5' : undefined} />
          ))}
          {pontoAtivo && (
            <g>
              <line x1={x(ativo!)} x2={x(ativo!)} y1={M.t} y2={A - M.b} stroke="var(--ink-muted, #6b7280)" strokeWidth="1" strokeDasharray="3 3" />
              {series.map((s) => {
                const v = pontoAtivo.valores[s.id];
                return v === null || v === undefined ? null : <circle key={s.id} cx={x(ativo!)} cy={y(v)} r="5" fill={s.cor} stroke="var(--surface-card, #fff)" strokeWidth="2" />;
              })}
            </g>
          )}
        </svg>
        {pontoAtivo && (
          <div
            className="grafico-dica"
            style={{ left: `${posicaoDica * 100}%`, transform: posicaoDica > 0.6 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)' }}
            role="status"
          >
            <div className="grafico-dica-titulo">{pontoAtivo.rotulo}</div>
            {series.map((s) => {
              const v = pontoAtivo.valores[s.id];
              return (
                <div key={s.id} className="grafico-dica-linha">
                  <span className="grafico-dica-chave" style={{ background: s.cor }} aria-hidden="true" />
                  <span className="grafico-dica-nome">{s.nome}</span>
                  <b>{v === null || v === undefined ? '—' : formatar(v)}</b>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** Barras horizontais de duas séries (ex.: previsto e executado por etapa). A dica mostra os dois valores e o percentual. */
export function BarrasComparativasBI({ itens, formatar, rotuloPrimeira, rotuloSegunda, corPrimeira, corSegunda }: {
  itens: { id: string; rotulo: string; primeira: number; segunda: number }[];
  formatar: (v: number) => string;
  rotuloPrimeira: string; rotuloSegunda: string; corPrimeira: string; corSegunda: string;
}) {
  const maximo = Math.max(1, ...itens.flatMap((i) => [i.primeira, i.segunda]));
  const [ativo, setAtivo] = useState<string | null>(null);
  const item = itens.find((i) => i.id === ativo);
  return (
    <div className="barras-bi">
      <div className="grafico-legenda" aria-hidden="true">
        <span className="grafico-legenda-item"><span className="grafico-dica-chave" style={{ background: corPrimeira }} />{rotuloPrimeira}</span>
        <span className="grafico-legenda-item"><span className="grafico-dica-chave" style={{ background: corSegunda }} />{rotuloSegunda}</span>
      </div>
      {itens.map((i) => (
        <div key={i.id} className={`barras-bi-linha${ativo === i.id ? ' ativa' : ''}`} onPointerEnter={() => setAtivo(i.id)} onPointerLeave={() => setAtivo(null)} onFocus={() => setAtivo(i.id)} onBlur={() => setAtivo(null)} tabIndex={0}>
          <div className="barras-bi-rotulo" title={i.rotulo}>{i.rotulo}</div>
          <div className="barras-bi-trilhas">
            <div className="barras-bi-barra" style={{ width: `${(i.primeira / maximo) * 100}%`, background: corPrimeira }} />
            <div className="barras-bi-barra" style={{ width: `${(i.segunda / maximo) * 100}%`, background: corSegunda }} />
          </div>
        </div>
      ))}
      {item ? (
        <div className="grafico-dica grafico-dica-fixa" role="status">
          <div className="grafico-dica-titulo">{item.rotulo}</div>
          <div className="grafico-dica-linha"><span className="grafico-dica-chave" style={{ background: corPrimeira }} /><span className="grafico-dica-nome">{rotuloPrimeira}</span><b>{formatar(item.primeira)}</b></div>
          <div className="grafico-dica-linha"><span className="grafico-dica-chave" style={{ background: corSegunda }} /><span className="grafico-dica-nome">{rotuloSegunda}</span><b>{formatar(item.segunda)}</b></div>
          <div className="grafico-dica-linha"><span className="grafico-dica-nome">Diferença</span><b>{formatar(item.segunda - item.primeira)}</b></div>
        </div>
      ) : (
        <p className="small muted" style={{ margin: "8px 0 0" }}>Passe o cursor sobre uma etapa para ver os valores.</p>
      )}
    </div>
  );
}
