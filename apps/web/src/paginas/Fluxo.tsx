import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, formatarData, formatarMoeda } from '../api';
import { ATALHOS, mesCurto, SeletorPeriodo, type Periodo } from '../componentes/Periodo';

type Resp = {
  hoje: string;
  saldoAtual: number;
  realizado: { mes: string; entradas: number; saidas: number; entradasFora: number; saidasFora: number; liquido: number; saldoFinal: number }[];
  atrasadas: { receber: number; pagar: number };
  projecao: { inicio: string; fim: string; receber: number; pagar: number; saldo: number }[];
  menorSaldo: { semana: string; saldo: number } | null;
};

const dm = (d: string) => formatarData(d).slice(0, 5);

function Barra({ valor, maximo }: { valor: number; maximo: number }) {
  const largura = maximo > 0 ? Math.min(100, (Math.abs(valor) / maximo) * 100) : 0;
  return (
    <span className="barra-saldo" aria-hidden="true">
      <span className={valor < 0 ? 'negativa' : ''} style={{ width: `${largura}%` }} />
    </span>
  );
}

export function Fluxo() {
  const [params, setParams] = useSearchParams();
  const padrao = ATALHOS.find((a) => a.id === '6m')!.periodo();
  const periodo: Periodo = { de: params.get('de') ?? padrao.de, ate: params.get('ate') ?? padrao.ate };
  const semanas = Number(params.get('semanas')) === 26 ? 26 : 12;
  const [r, setR] = useState<Resp | null>(null);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    setR(null);
    try {
      setR(await api<Resp>(`/ger/fluxo?de=${periodo.de}&ate=${periodo.ate}&semanas=${semanas}`));
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [periodo.de, periodo.ate, semanas]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  const maxSaldo = r ? Math.max(...r.projecao.map((p) => Math.abs(p.saldo)), Math.abs(r.saldoAtual), 1) : 1;
  const maxReal = r ? Math.max(...r.realizado.map((p) => Math.abs(p.saldoFinal)), 1) : 1;

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Fluxo de caixa</h1>
          <span className="muted">O que vai entrar e sair nas próximas semanas, e o que entrou e saiu em cada mês.</span>
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {!r ? (
        !erro && <p className="muted">Carregando…</p>
      ) : (
        <>
          <div className="kpis">
            <Link to="/fin/contas" className="kpi">
              <span className="kpi-rotulo">Saldo hoje</span>
              <span className="kpi-valor">{formatarMoeda(r.saldoAtual)}</span>
              <span className="kpi-detalhe">bancos e caixa</span>
            </Link>
            <div className={`kpi ${r.menorSaldo && r.menorSaldo.saldo < 0 ? 'kpi-perigo' : ''}`}>
              <span className="kpi-rotulo">Menor saldo previsto</span>
              <span className="kpi-valor">{r.menorSaldo ? formatarMoeda(r.menorSaldo.saldo) : '—'}</span>
              <span className="kpi-detalhe">{r.menorSaldo ? `semana de ${dm(r.menorSaldo.semana)}` : ''}</span>
            </div>
            <Link to="/fin/pagar-receber?tipo=despesa&situacao=vencidas" className={`kpi ${r.atrasadas.pagar ? 'kpi-perigo' : ''}`}>
              <span className="kpi-rotulo">A pagar atrasado</span>
              <span className="kpi-valor">{formatarMoeda(r.atrasadas.pagar)}</span>
            </Link>
            <Link to="/fin/pagar-receber?tipo=receita&situacao=vencidas" className={`kpi ${r.atrasadas.receber ? 'kpi-aviso' : ''}`}>
              <span className="kpi-rotulo">A receber atrasado</span>
              <span className="kpi-valor">{formatarMoeda(r.atrasadas.receber)}</span>
            </Link>
          </div>

          <div className="card tabela-caixa">
            <div className="cartao-topo">
              <h2>Próximas semanas</h2>
              <div className="segmentado" role="group" aria-label="Horizonte" style={{ minWidth: 220 }}>
                <button type="button" aria-pressed={semanas === 12} className={semanas === 12 ? 'ativo' : ''} onClick={() => setParams({ de: periodo.de, ate: periodo.ate }, { replace: true })}>
                  12 semanas
                </button>
                <button type="button" aria-pressed={semanas === 26} className={semanas === 26 ? 'ativo' : ''} onClick={() => setParams({ de: periodo.de, ate: periodo.ate, semanas: '26' }, { replace: true })}>
                  6 meses
                </button>
              </div>
            </div>
            <p className="small muted" style={{ marginTop: 0 }}>
              Parte do saldo de hoje e soma as parcelas em aberto pelo vencimento. As atrasadas entram na primeira semana.
            </p>
            <table className="tabela tabela-compacta">
              <thead>
                <tr>
                  <th>Semana</th>
                  <th style={{ textAlign: 'right' }}>Entradas</th>
                  <th style={{ textAlign: 'right' }}>Saídas</th>
                  <th style={{ textAlign: 'right' }}>Saldo previsto</th>
                  <th className="col-barra"><span style={{ position: 'absolute', left: -9999 }}>Gráfico</span></th>
                </tr>
              </thead>
              <tbody>
                {(r.atrasadas.receber > 0 || r.atrasadas.pagar > 0) && (
                  <tr>
                    <td className="small">Atrasadas</td>
                    <td className="mono num">{r.atrasadas.receber ? formatarMoeda(r.atrasadas.receber) : '—'}</td>
                    <td className="mono num negativo">{r.atrasadas.pagar ? formatarMoeda(-r.atrasadas.pagar) : '—'}</td>
                    <td className="mono num muted">{formatarMoeda(r.saldoAtual + r.atrasadas.receber - r.atrasadas.pagar)}</td>
                    <td className="col-barra" />
                  </tr>
                )}
                {r.projecao.map((p) => (
                  <tr key={p.inicio}>
                    <td className="mono small">
                      {dm(p.inicio)} a {dm(p.fim)}
                    </td>
                    <td className="mono num">{p.receber ? formatarMoeda(p.receber) : <span className="muted">—</span>}</td>
                    <td className="mono num negativo">{p.pagar ? formatarMoeda(-p.pagar) : <span className="muted">—</span>}</td>
                    <td className={`mono num forte ${p.saldo < 0 ? 'negativo' : ''}`}>{formatarMoeda(p.saldo)}</td>
                    <td className="col-barra">
                      <Barra valor={p.saldo} maximo={maxSaldo} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card tabela-caixa">
            <div className="cartao-topo">
              <h2>Realizado por mês</h2>
            </div>
            <SeletorPeriodo valor={periodo} aoMudar={(p) => setParams({ de: p.de, ate: p.ate, ...(semanas === 26 ? { semanas: '26' } : {}) }, { replace: true })} />
            <table className="tabela tabela-compacta" style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>Mês</th>
                  <th style={{ textAlign: 'right' }}>Recebido</th>
                  <th style={{ textAlign: 'right' }}>Pago</th>
                  <th style={{ textAlign: 'right' }} title="Empréstimos recebidos, aportes, compra de veículos, amortizações, retiradas">Fora da DRE</th>
                  <th style={{ textAlign: 'right' }}>Variação</th>
                  <th style={{ textAlign: 'right' }}>Saldo no fim</th>
                  <th className="col-barra"><span style={{ position: 'absolute', left: -9999 }}>Gráfico</span></th>
                </tr>
              </thead>
              <tbody>
                {r.realizado.map((m) => {
                  const fora = m.entradasFora - m.saidasFora;
                  return (
                    <tr key={m.mes}>
                      <td className="mono">{mesCurto(m.mes)}</td>
                      <td className="mono num">{m.entradas ? formatarMoeda(m.entradas) : <span className="muted">—</span>}</td>
                      <td className="mono num negativo">{m.saidas ? formatarMoeda(-m.saidas) : <span className="muted">—</span>}</td>
                      <td className={`mono num ${fora < 0 ? 'negativo' : ''}`}>{fora ? formatarMoeda(fora) : <span className="muted">—</span>}</td>
                      <td className={`mono num ${m.liquido < 0 ? 'negativo' : ''}`}>{formatarMoeda(m.liquido)}</td>
                      <td className={`mono num forte ${m.saldoFinal < 0 ? 'negativo' : ''}`}>{formatarMoeda(m.saldoFinal)}</td>
                      <td className="col-barra">
                        <Barra valor={m.saldoFinal} maximo={maxReal} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="small muted" style={{ margin: '8px 0 0' }}>
              O saldo no fim de cada mês é calculado a partir do saldo de hoje, descontando o que entrou e saiu depois. Transferências entre contas não aparecem porque não mudam o total.
            </p>
          </div>
        </>
      )}
    </>
  );
}
