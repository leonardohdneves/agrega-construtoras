// Qualidade: cargas a amostrar (confirmação do laboratório) e rastreabilidade da carga até a resistência.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { agoraLocal, api, formatarDataHora, formatarNumero, hojeLocal, lerNumero, somarDias } from '../api';
import { CabecalhoDocumento } from '../componentes/Documento';
import { useSessao } from '../sessao';

const hora = (iso: string) => agoraLocal(new Date(iso)).slice(11, 16);
const dia = (iso: string) => agoraLocal(new Date(iso)).slice(0, 10).split('-').reverse().join('/');
const cm = (n: number | null) => (n === null ? '—' : `${formatarNumero(n, Number.isInteger(n) ? 0 : 1)} cm`);

type CpDemanda = { id: string; idade: number; numero: number; situacao: string; previsto: string };
type Demanda = {
  amostraId: string; status: 'pendente' | 'moldada' | 'ativa' | 'nao_amostrada' | 'cancelada'; cargaId: string; numero: number; dataHora: string; volume: number; tracoCodigo: string;
  fck: number | null; slumpTraco: string | null; clienteNome: string | null; obra: string | null; betoneiraCodigo: string; motoristaNome: string | null;
  slump: number | null; slumpEntrega: number | null; temperatura: number | null; moldadoPor: string | null; observacao: string | null; confirmadaEm: string | null;
  confirmadaPor: string | null; entregue: boolean; cpsMoldados: number | null; moldadaEm: string | null; recebidaEm: string | null; recebidaPor: string | null; cps: CpDemanda[];
};

const SELO: Record<Demanda['status'], [string, string]> = {
  pendente: ['Na obra', 'selo-neutro'],
  moldada: ['A receber', 'selo-aviso'],
  ativa: ['Recebidos', 'selo-ok'],
  nao_amostrada: ['Não amostrada', 'selo-neutro'],
  cancelada: ['Cancelada', 'selo-neutro'],
};
type SitCp = 'recebido' | 'danificado' | 'faltando';

/** CPs moldados na obra pelo motorista; o laboratório confirma a chegada de cada um. */
export function QualDemandas() {
  const [itens, setItens] = useState<Demanda[] | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [receber, setReceber] = useState<{ id: string; sit: Record<string, SitCp>; obs: string } | null>(null);
  const [naoAmostrar, setNaoAmostrar] = useState<{ id: string; motivo: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(() => {
    api<{ itens: Demanda[] }>(`/qual/demandas?de=${somarDias(hojeLocal(), -3)}&ate=${hojeLocal()}`).then((r) => setItens(r.itens)).catch((e) => setErro((e as Error).message));
  }, []);
  useEffect(carregar, [carregar]);

  function abrirRecebimento(d: Demanda) {
    setNaoAmostrar(null);
    const vivos = d.cps.filter((c) => c.situacao === 'aguardando');
    const n = d.cpsMoldados ?? vivos.length;
    // O motorista informou quantos moldou: os excedentes já vêm como "faltando".
    setReceber({ id: d.amostraId, sit: Object.fromEntries(vivos.map((c, i) => [c.id, i < n ? 'recebido' : 'faltando'])), obs: '' });
  }

  async function confirmarRecebimento(e: FormEvent, d: Demanda) {
    e.preventDefault();
    if (!receber) return;
    setErro('');
    setOcupado(true);
    try {
      const r = await api<{ recebidos: number }>(`/qual/amostras/${d.amostraId}/receber`, {
        corpo: { itens: Object.entries(receber.sit).map(([cpId, situacao]) => ({ cpId, situacao })), observacao: receber.obs },
      });
      setAviso(`Carga nº ${d.numero}: ${r.recebidos} CP(s) recebido(s) no laboratório. Já entram em CPs a romper nas datas previstas.`);
      setReceber(null);
      carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
    setOcupado(false);
  }

  async function marcarNaoAmostrada(e: FormEvent, d: Demanda) {
    e.preventDefault();
    if (!naoAmostrar) return;
    setErro('');
    setOcupado(true);
    try {
      await api(`/qual/amostras/${d.amostraId}/nao-amostrar`, { corpo: { motivo: naoAmostrar.motivo } });
      setAviso(`Carga nº ${d.numero} marcada como não amostrada.`);
      setNaoAmostrar(null);
      carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
    setOcupado(false);
  }

  const aReceber = (itens ?? []).filter((i) => i.status === 'moldada');
  const naObra = (itens ?? []).filter((i) => i.status === 'pendente');
  const feitas = (itens ?? []).filter((i) => !['pendente', 'moldada'].includes(i.status));

  const linha = (d: Demanda) => (
    <li key={d.amostraId} className="demanda">
      <div className="demanda-topo">
        <div style={{ minWidth: 0 }}>
          <b>Carga nº {d.numero}</b> <span className="muted small">· {dia(d.dataHora)} {hora(d.dataHora)}</span>{' '}
          <span className={`selo ${SELO[d.status][1]}`}>{SELO[d.status][0]}</span>
          <div className="small">
            <span className="mono">{d.tracoCodigo}</span>{d.fck ? ` · fck ${d.fck}` : ''} · {formatarNumero(d.volume, 1)} m³ · {d.clienteNome ?? 'sem cliente'}{d.obra ? ` · ${d.obra}` : ''}
          </div>
          <div className="small muted">
            {d.betoneiraCodigo}{d.motoristaNome ? ` · ${d.motoristaNome}` : ''} · slump usina {cm(d.slump)} · slump obra {d.entregue ? cm(d.slumpEntrega) : 'aguardando o motorista'}
          </div>
          {d.moldadaEm && d.status !== 'nao_amostrada' && (
            <div className="small">Moldagem na obra: <b>{d.cpsMoldados ?? '?'} CP(s)</b> por {d.moldadoPor ?? 'motorista'} · {formatarDataHora(d.moldadaEm)}</div>
          )}
          {d.status === 'ativa' && d.recebidaEm && (
            <div className="small muted">
              Recebidos {formatarDataHora(d.recebidaEm)}{d.recebidaPor ? ` por ${d.recebidaPor}` : ''} · {d.cps.filter((c) => c.situacao !== 'descartado').length} de {d.cps.length} CPs
            </div>
          )}
          {(d.status === 'nao_amostrada' || d.observacao) && d.observacao && <div className="small muted">{d.observacao}</div>}
        </div>
        <div className="aprov-acoes">
          {d.status === 'moldada' && <button className="btn btn-primario" type="button" onClick={() => abrirRecebimento(d)}>Receber CPs</button>}
          {(d.status === 'moldada' || d.status === 'pendente') && (
            <button className="btn btn-secundario" type="button" onClick={() => { setReceber(null); setNaoAmostrar({ id: d.amostraId, motivo: '' }); }}>Não amostrada</button>
          )}
          <Link className="btn btn-link" to={`/qual/rastreabilidade/${d.cargaId}`}>Rastrear</Link>
        </div>
      </div>
      {receber?.id === d.amostraId && (
        <form className="form" onSubmit={(e) => confirmarRecebimento(e, d)} style={{ marginTop: 8 }}>
          <table className="tabela tabela-compacta">
            <thead>
              <tr>
                <th>CP</th>
                <th>Ruptura prevista</th>
                <th>Chegou</th>
              </tr>
            </thead>
            <tbody>
              {d.cps.filter((c) => c.situacao === 'aguardando').map((c) => (
                <tr key={c.id}>
                  <td className="mono">{d.numero}-{c.idade}-{c.numero}</td>
                  <td className="mono">{c.previsto.split('-').reverse().join('/')} ({c.idade} d)</td>
                  <td>
                    <div className="segmentado" role="group" aria-label={`CP ${c.numero} aos ${c.idade} dias`}>
                      {(['recebido', 'danificado', 'faltando'] as SitCp[]).map((sit) => (
                        <button key={sit} type="button" aria-pressed={receber.sit[c.id] === sit} className={receber.sit[c.id] === sit ? 'ativo' : ''} onClick={() => setReceber({ ...receber, sit: { ...receber.sit, [c.id]: sit } })}>
                          {sit === 'recebido' ? 'Recebido' : sit === 'danificado' ? 'Danificado' : 'Faltando'}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="campo">
            <label htmlFor={`o-${d.amostraId}`}>Observação</label>
            <input id={`o-${d.amostraId}`} placeholder="Opcional" value={receber.obs} onChange={(e) => setReceber({ ...receber, obs: e.target.value })} />
          </div>
          <div className="acoes">
            <button className="btn btn-primario" type="submit" disabled={ocupado}>Confirmar recebimento</button>
            <button className="btn btn-link" type="button" onClick={() => setReceber(null)}>Voltar</button>
          </div>
        </form>
      )}
      {naoAmostrar?.id === d.amostraId && (
        <form className="form" onSubmit={(e) => marcarNaoAmostrada(e, d)} style={{ marginTop: 8 }}>
          <div className="campo">
            <label htmlFor={`n-${d.amostraId}`}>Motivo</label>
            <input id={`n-${d.amostraId}`} required minLength={3} value={naoAmostrar.motivo} onChange={(e) => setNaoAmostrar({ ...naoAmostrar, motivo: e.target.value })} />
          </div>
          <div className="acoes">
            <button className="btn btn-primario" type="submit" disabled={ocupado}>Marcar como não amostrada</button>
            <button className="btn btn-link" type="button" onClick={() => setNaoAmostrar(null)}>Voltar</button>
          </div>
        </form>
      )}
    </li>
  );

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>CPs a receber</h1>
          <span className="muted">Os CPs são moldados na obra pelo motorista. Confirme a chegada de cada um no laboratório para liberar a ruptura.</span>
        </div>
        <Link className="btn btn-secundario" to="/qual/rastreabilidade">Rastrear carga</Link>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}
      <section className="card">
        <h2>Moldados na obra, a receber {aReceber.length > 0 && <span className="selo selo-aviso">{aReceber.length}</span>}</h2>
        {!itens ? <p className="muted">Carregando…</p> : aReceber.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nenhum CP esperando o laboratório.</p> : <ul className="lista-demandas">{aReceber.map(linha)}</ul>}
      </section>
      {naObra.length > 0 && (
        <section className="card">
          <h2>Cargas a caminho ou na obra <span className="small muted">({naObra.length})</span></h2>
          <p className="small muted" style={{ marginTop: 0 }}>O motorista ainda não informou a moldagem.</p>
          <ul className="lista-demandas">{naObra.map(linha)}</ul>
        </section>
      )}
      {feitas.length > 0 && (
        <section className="card">
          <h2>Últimos 3 dias</h2>
          <ul className="lista-demandas">{feitas.slice(0, 15).map(linha)}</ul>
          {feitas.length > 15 && <p className="small muted" style={{ margin: 0 }}>Mais {feitas.length - 15} carga(s) em Amostras e resultados.</p>}
        </section>
      )}
    </>
  );
}

// ---------------------------------------------------------------- rastreabilidade
type Rastro = {
  carga: {
    id: string; numero: number; dataHora: string; status: string; volume: number; devolvido: number; tracoCodigo: string; tracoDescricao: string | null; fck: number | null;
    slumpTraco: string | null; clienteNome: string | null; obra: string | null; betoneira: string; placa: string | null; motorista: string | null; bomba: string | null;
    operadorBomba: string | null; documento: string | null; cargaFinal: boolean; vendaId: string | null; vendaNumero: number | null; slumpUsina: number | null; slumpEntrega: number | null;
  };
  consumo: { nome: string; unidade: string; quantidade: number }[];
  amostra: { id: string; status: string } | null;
  idadeControle: number;
  resultadoControle: number | null;
  conformidade: boolean | null;
  eventos: { quando: string | null; etapa: string; titulo: string; detalhe: string | null; situacao: 'ok' | 'aviso' | 'perigo' | 'pendente' }[];
};

const ETAPAS: Record<string, string> = { venda: 'Comercial', usina: 'Usina', transporte: 'Transporte', qualidade: 'Laboratório' };

export function QualRastreabilidade() {
  const { cargaId } = useParams();
  const navegar = useNavigate();
  const [r, setR] = useState<Rastro | null>(null);
  const [erro, setErro] = useState('');
  const [numero, setNumero] = useState('');

  useEffect(() => {
    setR(null);
    setErro('');
    if (cargaId) api<Rastro>(`/qual/rastreabilidade/${cargaId}`).then(setR).catch((e) => setErro((e as Error).message));
  }, [cargaId]);

  async function buscar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    try {
      const x = await api<Rastro>(`/qual/rastreabilidade?numero=${encodeURIComponent(numero.trim())}`);
      navegar(`/qual/rastreabilidade/${x.carga.id}`);
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  const busca = (
    <form className="filtros nao-imprimir" onSubmit={buscar}>
      <input className="mono" inputMode="numeric" placeholder="Nº da carga" aria-label="Número da carga" value={numero} onChange={(e) => setNumero(e.target.value)} />
      <button className="btn btn-secundario" type="submit">Rastrear</button>
    </form>
  );

  if (!cargaId || !r) {
    return (
      <>
        <div className="cabecalho">
          <div className="titulo">
            <h1>Rastreabilidade da carga</h1>
            <span className="muted">Da venda à resistência: digite o número da carga.</span>
          </div>
        </div>
        {busca}
        {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
        {cargaId && !erro && <p className="muted">Carregando…</p>}
      </>
    );
  }
  const c = r.carga;
  return (
    <>
      {busca}
      <CabecalhoDocumento
        modulo="Qualidade · Rastreabilidade"
        titulo={`Carga nº ${c.numero}`}
        descricao={`${c.clienteNome ?? 'Cliente não informado'}${c.obra ? ` · ${c.obra}` : ''}`}
        filtros={[`Traço ${c.tracoCodigo}${c.fck ? ` (fck ${c.fck} MPa)` : ''}`, `${formatarNumero(c.volume, 1)} m³`, `Saída ${formatarDataHora(c.dataHora)}`]}
      />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div className="grade">
        <div className="card indicador">
          <span className="rotulo-ind">Resistência aos {r.idadeControle} dias</span>
          <span className="valor-ind mono">{r.resultadoControle === null ? '—' : `${formatarNumero(r.resultadoControle, 1)} MPa`}</span>
        </div>
        <div className={`card indicador ${r.conformidade === false ? 'ind-perigo' : ''}`}>
          <span className="rotulo-ind">Conformidade</span>
          <span className="valor-ind">{r.conformidade === null ? 'Aguardando' : r.conformidade ? 'Conforme' : 'Abaixo do fck'}</span>
        </div>
        <div className="card indicador">
          <span className="rotulo-ind">Slump usina · obra</span>
          <span className="valor-ind mono">{cm(c.slumpUsina)} · {cm(c.slumpEntrega)}</span>
        </div>
      </div>

      <div className="grade-larga">
        <section className="card">
          <h2>Linha do tempo</h2>
          <ol className="linha-tempo">
            {r.eventos.map((e, i) => (
              <li key={i} className={`ev-${e.situacao}`}>
                <span className="ev-ponto" aria-hidden="true" />
                <div>
                  <span className="small muted">{ETAPAS[e.etapa] ?? e.etapa}{e.quando ? ` · ${formatarDataHora(e.quando)}` : ''}</span>
                  <div><b>{e.titulo}</b></div>
                  {e.detalhe && <div className="small">{e.detalhe}</div>}
                </div>
              </li>
            ))}
          </ol>
        </section>
        <section className="card">
          <h2>Dados da carga</h2>
          <dl className="lista-dados">
            <div><dt>Traço</dt><dd><span className="mono">{c.tracoCodigo}</span>{c.tracoDescricao ? ` · ${c.tracoDescricao}` : ''}</dd></div>
            <div><dt>Slump do traço</dt><dd>{c.slumpTraco ? `${c.slumpTraco} cm` : '—'}</dd></div>
            <div><dt>Betoneira</dt><dd className="mono">{c.betoneira}{c.placa ? ` · ${c.placa}` : ''}</dd></div>
            <div><dt>Motorista</dt><dd>{c.motorista ?? '—'}</dd></div>
            {c.bomba && <div><dt>Bomba</dt><dd><span className="mono">{c.bomba}</span>{c.operadorBomba ? ` · ${c.operadorBomba}` : ''}</dd></div>}
            {c.documento && <div><dt>Remessa ou nota</dt><dd className="mono">{c.documento}</dd></div>}
            {c.vendaNumero && <div><dt>Venda</dt><dd>nº {String(c.vendaNumero).padStart(4, '0')}{c.cargaFinal ? ' · carga final' : ''}</dd></div>}
            {c.devolvido > 0 && <div><dt>Devolvido</dt><dd className="mono">{formatarNumero(c.devolvido, 1)} m³</dd></div>}
          </dl>
          {r.consumo.length > 0 && (
            <>
              <h2 style={{ marginTop: 16 }}>Insumos consumidos</h2>
              <table className="tabela tabela-compacta">
                <tbody>
                  {r.consumo.map((i) => (
                    <tr key={i.nome}>
                      <td>{i.nome}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{formatarNumero(i.quantidade, i.quantidade < 100 ? 1 : 0)} {i.unidade === 'm3' ? 'm³' : i.unidade}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      </div>
    </>
  );
}
