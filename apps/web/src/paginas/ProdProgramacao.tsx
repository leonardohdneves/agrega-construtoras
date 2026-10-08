// Produção › Programação de entregas: as vendas aprovadas no Comercial, dia a dia, com o que já saiu da usina.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, dataPorExtenso, formatarNumero, hojeLocal, somarDias, type Venda } from '../api';
import { BarraEntrega } from './Comercial';
import { useSessao } from '../sessao';

const m3 = (n: number) => `${formatarNumero(n, Number.isInteger(n) ? 0 : 1)} m³`;

export function ProdProgramacao() {
  const { usuario } = useSessao();
  const gestao = usuario?.perfil === 'dono' || usuario?.perfil === 'gestor';
  const hoje = hojeLocal();
  const [de, setDe] = useState(hoje);
  const [dados, setDados] = useState<{ de: string; ate: string; vendas: Venda[] } | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [encerrando, setEncerrando] = useState<{ v: Venda; motivo: string } | null>(null);
  const ate = somarDias(de, 6);

  const carregar = useCallback(() => {
    api<{ de: string; ate: string; vendas: Venda[] }>(`/prod/programacao?de=${de}&ate=${ate}`).then(setDados).catch((e) => setErro((e as Error).message));
  }, [de, ate]);
  useEffect(carregar, [carregar]);

  const dias = useMemo(() => {
    const m = new Map<string, Venda[]>();
    for (const v of dados?.vendas ?? []) {
      const dia = v.dataEntrega < de ? 'atrasadas' : v.dataEntrega;
      m.set(dia, [...(m.get(dia) ?? []), v]);
    }
    return [...m.entries()].sort((a, b) => (a[0] === 'atrasadas' ? -1 : b[0] === 'atrasadas' ? 1 : a[0].localeCompare(b[0])));
  }, [dados, de]);
  const totalSaldo = (dados?.vendas ?? []).filter((v) => v.status === 'aprovada').reduce((s, v) => s + v.saldo, 0);
  const deHoje = (dados?.vendas ?? []).filter((v) => v.dataEntrega === hoje);

  async function encerrar() {
    if (!encerrando) return;
    try {
      await api(`/prod/programacao/${encerrando.v.id}/encerrar`, { corpo: { motivo: encerrando.motivo } });
      setAviso(`Entrega da venda nº ${String(encerrando.v.numero).padStart(4, '0')} encerrada com ${m3(encerrando.v.saldo)} sem entregar.`);
      setEncerrando(null);
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Programação de entregas</h1>
          <span className="muted">Vendas aprovadas no Comercial. Registre cada carga a partir da entrega.</span>
        </div>
        <Link className="btn btn-primario" to="/prod/cargas/nova">Registrar carga</Link>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}

      <div className="filtros">
        <div className="navegar-mes">
          <button className="btn btn-secundario" type="button" aria-label="Semana anterior" onClick={() => setDe(somarDias(de, -7))}>‹</button>
          <input type="date" value={de} onChange={(e) => e.target.value && setDe(e.target.value)} aria-label="A partir de" />
          <button className="btn btn-secundario" type="button" aria-label="Próxima semana" onClick={() => setDe(somarDias(de, 7))}>›</button>
          {de !== hoje && <button className="btn btn-link" type="button" onClick={() => setDe(hoje)}>Hoje</button>}
        </div>
        <span className="muted small">7 dias a partir da data escolhida</span>
      </div>

      <div className="grade">
        <div className="card indicador"><span className="rotulo-ind">Entregas hoje</span><span className="valor-ind mono">{dados ? deHoje.length : '—'}</span></div>
        <div className="card indicador"><span className="rotulo-ind">Volume hoje</span><span className="valor-ind mono">{dados ? m3(deHoje.reduce((s, v) => s + v.volume, 0)) : '—'}</span></div>
        <div className="card indicador"><span className="rotulo-ind">A entregar na semana</span><span className="valor-ind mono">{dados ? m3(totalSaldo) : '—'}</span></div>
      </div>

      {encerrando && (
        <div className="alerta alerta-aviso" role="alert" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ flex: '1 1 220px' }}>
            Encerrar a entrega da venda nº {String(encerrando.v.numero).padStart(4, '0')} ({encerrando.v.clienteNome}) com {m3(encerrando.v.saldo)} sem entregar?
          </span>
          <input placeholder="Motivo (opcional)" value={encerrando.motivo} onChange={(e) => setEncerrando({ ...encerrando, motivo: e.target.value })} style={{ flex: '1 1 220px' }} />
          <button className="btn btn-primario" type="button" onClick={encerrar}>Encerrar</button>
          <button className="btn btn-secundario" type="button" onClick={() => setEncerrando(null)}>Voltar</button>
        </div>
      )}

      {!dados ? (
        <p className="muted">Carregando…</p>
      ) : dias.length === 0 ? (
        <div className="card"><p className="muted" style={{ margin: 0 }}>Nenhuma entrega programada nestes dias.</p></div>
      ) : (
        dias.map(([dia, vendas]) => (
          <section key={dia} className="card programa-dia">
            <h2>
              {dia === 'atrasadas' ? <span className="texto-perigo">Atrasadas, com saldo</span> : dia === hoje ? `Hoje · ${dataPorExtenso(dia)}` : dataPorExtenso(dia)}
              <span className="small muted">{m3(vendas.reduce((s, v) => s + v.volume, 0))}</span>
            </h2>
            <div>
              {vendas.map((v) => (
                <div key={v.id} className="entrega">
                  <span className="hora">{dia === 'atrasadas' ? v.dataEntrega.slice(8, 10) + '/' + v.dataEntrega.slice(5, 7) : (v.horaEntrega ?? '—')}</span>
                  <div style={{ minWidth: 0, display: 'grid', gap: 4 }}>
                    <div>
                      <b>{v.clienteNome}</b>
                      {v.obra && <span className="muted"> · {v.obra}</span>}
                    </div>
                    <div className="small">
                      <span className="mono">{v.tracoCodigo}</span> · {m3(v.volume)}
                      {v.bombeamento && <span className="selo selo-aviso" style={{ marginLeft: 6 }}>bomba</span>}
                      {v.status === 'concluida' && <span className="selo selo-neutro" style={{ marginLeft: 6 }}>entregue</span>}
                    </div>
                    {(v.endereco || v.contato) && <div className="small muted">{[v.endereco, v.contato].filter(Boolean).join(' · ')}</div>}
                    {v.observacoes && <div className="small">Obs.: {v.observacoes}</div>}
                    <BarraEntrega v={v} />
                    <div className="small muted">
                      {m3(v.entregue)} entregues em {v.cargas} carga{v.cargas === 1 ? '' : 's'}
                      {v.status === 'aprovada' && <> · faltam <b>{m3(v.saldo)}</b></>} · venda nº {String(v.numero).padStart(4, '0')} · {v.vendedorNome}
                    </div>
                  </div>
                  <div className="acoes-entrega">
                    {v.status === 'aprovada' && (
                      <Link className="btn btn-primario" to={`/prod/cargas/nova?venda=${v.id}`}>Registrar carga</Link>
                    )}
                    {v.status === 'aprovada' && gestao && v.cargas > 0 && (
                      <button className="btn btn-link" type="button" onClick={() => setEncerrando({ v, motivo: '' })}>Encerrar com saldo</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}
