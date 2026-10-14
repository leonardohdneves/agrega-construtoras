// Gerencial · Acompanhamento de obra: Curva S (previsto, executado e realizado) e previsto x realizado por etapa.
// Acesso só para dono e gestor (o módulo gerencial e as rotas de engenharia já exigem esses perfis).
import { useEffect, useMemo, useState } from 'react';
import { api, formatarMoeda } from '../api';
import { SecaoObra } from './EngSecoes';

type PontoCurva = { data: string; previsto: number; executado: number | null; realizado: number | null };
type Curva = { pontos: PontoCurva[]; hoje: string; custoTotal: number; dataUltimaMedicao: string | null; vazio?: string; indices: { cpi: number | null; spi: number | null } };
type LinhaPR = { id: string; codigo: string; descricao: string; nivel: string; custoPrevisto: number; previstoAte: number; executado: number; percentualExecutado: number; saldo: number; spi: number | null };
type PrevistoRealizado = {
  dataRef: string; linhas: LinhaPR[];
  totais: { custoPrevisto: number; previstoAte: number; executado: number; realizado: number; saldo: number; cpi: number | null; spi: number | null };
  observacao: string;
};

const dataBr = (iso: string) => iso.split('-').reverse().join('/');
const reais = (centavos: number) => formatarMoeda(centavos / 100);
const indice = (n: number | null) => (n === null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
const profundidade = (codigo: string) => codigo.split('.').length - 1;

export function GerAcompanhamento() {
  return (
    <SecaoObra titulo="Acompanhamento de obra" ajuda="Análise da obra a partir das medições físicas, do planejamento e das despesas confirmadas.">
      {(c) => <PainelGerencial obraId={c.obra.id} setErro={c.setErro} />}
    </SecaoObra>
  );
}

function PainelGerencial({ obraId, setErro }: { obraId: string; setErro: (m: string) => void }) {
  const [aba, setAba] = useState<'curva' | 'pr'>('curva');
  return (
    <>
      <div className="segmentado" role="group" aria-label="Relatório" style={{ marginBottom: 12 }}>
        <button type="button" aria-pressed={aba === 'curva'} className={aba === 'curva' ? 'ativo' : ''} onClick={() => setAba('curva')}>Curva S</button>
        <button type="button" aria-pressed={aba === 'pr'} className={aba === 'pr' ? 'ativo' : ''} onClick={() => setAba('pr')}>Previsto x realizado</button>
      </div>
      {aba === 'curva' ? <CurvaS obraId={obraId} setErro={setErro} /> : <PrevistoRealizadoView obraId={obraId} setErro={setErro} />}
    </>
  );
}

function CurvaS({ obraId, setErro }: { obraId: string; setErro: (m: string) => void }) {
  const [dados, setDados] = useState<Curva | null>(null);
  useEffect(() => {
    setDados(null);
    api<Curva>(`/eng/obras/${obraId}/relatorios-gerenciais/curva-s`).then(setDados).catch((e) => setErro((e as Error).message));
  }, [obraId]);

  if (!dados) return <p className="muted">Carregando…</p>;
  if (dados.vazio || !dados.pontos.length) return <div className="card"><p className="muted" style={{ margin: 0 }}>{dados.vazio ?? 'Sem dados para a Curva S.'}</p></div>;

  return (
    <>
      <div className="card">
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 8 }}>
          <div><div className="small muted">Custo direto orçado</div><b>{reais(dados.custoTotal)}</b></div>
          <div><div className="small muted">Última medição</div><b>{dados.dataUltimaMedicao ? dataBr(dados.dataUltimaMedicao) : '—'}</b></div>
          <div><div className="small muted">SPI (executado ÷ previsto)</div><b>{indice(dados.indices.spi)}</b></div>
          <div><div className="small muted">CPI (executado ÷ realizado)</div><b>{indice(dados.indices.cpi)}</b></div>
        </div>
        <GraficoCurva pontos={dados.pontos} />
        <p className="small muted">
          Previsto: custo das atividades do planejamento no tempo. Executado: valor das medições. Realizado: despesas confirmadas apropriadas ao centro de custo da obra.
          SPI abaixo de 1 indica atraso; CPI abaixo de 1 indica custo acima do executado.
        </p>
      </div>
      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table className="tabela">
            <thead>
              <tr><th>Mês</th><th className="num">Previsto</th><th className="num">Executado</th><th className="num">Realizado</th></tr>
            </thead>
            <tbody>
              {dados.pontos.map((p) => (
                <tr key={p.data}>
                  <td>{dataBr(p.data)}</td>
                  <td className="num">{reais(p.previsto)}</td>
                  <td className="num">{p.executado === null ? '—' : reais(p.executado)}</td>
                  <td className="num">{p.realizado === null ? '—' : reais(p.realizado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/** Gráfico em SVG: previsto (cinza), executado (azul) e realizado (laranja), acumulados por mês. */
function GraficoCurva({ pontos }: { pontos: PontoCurva[] }) {
  const L = 760, A = 300, M = 40;
  const maximo = useMemo(() => Math.max(1, ...pontos.flatMap((p) => [p.previsto, p.executado ?? 0, p.realizado ?? 0])), [pontos]);
  const x = (i: number) => M + (pontos.length <= 1 ? 0 : (i / (pontos.length - 1)) * (L - 2 * M));
  const y = (v: number) => A - M - (v / maximo) * (A - 2 * M);
  const linha = (valor: (p: PontoCurva) => number | null) => {
    const partes: string[] = [];
    pontos.forEach((p, i) => {
      const v = valor(p);
      if (v !== null) partes.push(`${partes.length ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    });
    return partes.join(' ');
  };
  const series = [
    { nome: 'Previsto', cor: '#8a8f98', d: linha((p) => p.previsto) },
    { nome: 'Executado', cor: '#1d4ed8', d: linha((p) => p.executado) },
    { nome: 'Realizado', cor: '#d97706', d: linha((p) => p.realizado) },
  ];
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${L} ${A}`} width="100%" role="img" aria-label="Curva S: previsto, executado e realizado" style={{ minWidth: 560 }}>
        <line x1={M} y1={A - M} x2={L - M} y2={A - M} stroke="#c9ccd1" />
        <line x1={M} y1={M} x2={M} y2={A - M} stroke="#c9ccd1" />
        <text x={M - 6} y={M + 4} fontSize="11" textAnchor="end">{formatarMoeda(maximo / 100)}</text>
        <text x={M - 6} y={A - M + 4} fontSize="11" textAnchor="end">0</text>
        {pontos.map((p, i) => (i % Math.ceil(pontos.length / 8) === 0 || i === pontos.length - 1) && (
          <text key={p.data} x={x(i)} y={A - M + 16} fontSize="10" textAnchor="middle">{dataBr(p.data).slice(3)}</text>
        ))}
        {series.map((s) => s.d && <path key={s.nome} d={s.d} fill="none" stroke={s.cor} strokeWidth={2.5} />)}
      </svg>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }} className="small">
        {series.map((s) => (
          <span key={s.nome} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 14, height: 3, background: s.cor, display: 'inline-block' }} />{s.nome}
          </span>
        ))}
      </div>
    </div>
  );
}

function PrevistoRealizadoView({ obraId, setErro }: { obraId: string; setErro: (m: string) => void }) {
  const [dados, setDados] = useState<PrevistoRealizado | null>(null);
  const [data, setData] = useState('');
  useEffect(() => {
    setDados(null);
    const q = data ? `?data=${data}` : '';
    api<PrevistoRealizado>(`/eng/obras/${obraId}/relatorios-gerenciais/previsto-realizado${q}`)
      .then((r) => { setDados(r); if (!data) setData(r.dataRef); })
      .catch((e) => setErro((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obraId, data]);

  if (!dados) return <p className="muted">Carregando…</p>;
  const t = dados.totais;
  return (
    <>
      <div className="card" style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'end' }}>
        <div className="campo">
          <label htmlFor="pr-data">Data de referência</label>
          <input id="pr-data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </div>
        <div><div className="small muted">Custo previsto (total)</div><b>{reais(t.custoPrevisto)}</b></div>
        <div><div className="small muted">Previsto até a data</div><b>{reais(t.previstoAte)}</b></div>
        <div><div className="small muted">Executado (valor)</div><b>{reais(t.executado)}</b></div>
        <div><div className="small muted">Realizado (despesas)</div><b>{reais(t.realizado)}</b></div>
        <div><div className="small muted">SPI</div><b>{indice(t.spi)}</b></div>
        <div><div className="small muted">CPI</div><b>{indice(t.cpi)}</b></div>
        <p className="small muted" style={{ flexBasis: '100%', margin: 0 }}>{dados.observacao}</p>
      </div>
      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table className="tabela">
            <thead>
              <tr>
                <th>EAP</th>
                <th>Descrição</th>
                <th className="num">Previsto</th>
                <th className="num">Previsto até a data</th>
                <th className="num">Executado</th>
                <th className="num">% executado</th>
                <th className="num">Saldo a executar</th>
                <th className="num">SPI</th>
              </tr>
            </thead>
            <tbody>
              {dados.linhas.map((l) => (
                <tr key={l.id} style={l.nivel === 'etapa' ? { fontWeight: 600 } : undefined}>
                  <td className="mono small" style={{ paddingLeft: 12 + profundidade(l.codigo) * 14 }}>{l.codigo}</td>
                  <td>{l.descricao}</td>
                  <td className="num">{reais(l.custoPrevisto)}</td>
                  <td className="num">{reais(l.previstoAte)}</td>
                  <td className="num">{reais(l.executado)}</td>
                  <td className="num">{indice(l.percentualExecutado)}%</td>
                  <td className="num">{reais(l.saldo)}</td>
                  <td className="num">{indice(l.spi)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">SPI abaixo de 1 indica que a etapa está atrasada em relação ao previsto na data de referência.</p>
      </div>
    </>
  );
}
