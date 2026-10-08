// Qualidade: cargas a amostrar (confirmação do laboratório) e rastreabilidade da carga até a resistência.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { agoraLocal, api, formatarDataHora, formatarNumero, hojeLocal, lerNumero, somarDias } from '../api';
import { CabecalhoDocumento } from '../componentes/Documento';
import { useSessao } from '../sessao';

const hora = (iso: string) => agoraLocal(new Date(iso)).slice(11, 16);
const dia = (iso: string) => agoraLocal(new Date(iso)).slice(0, 10).split('-').reverse().join('/');
const cm = (n: number | null) => (n === null ? '—' : `${formatarNumero(n, Number.isInteger(n) ? 0 : 1)} cm`);

type Demanda = {
  amostraId: string; status: 'pendente' | 'ativa' | 'nao_amostrada' | 'cancelada'; cargaId: string; numero: number; dataHora: string; volume: number; tracoCodigo: string;
  fck: number | null; slumpTraco: string | null; clienteNome: string | null; obra: string | null; betoneiraCodigo: string; motoristaNome: string | null;
  slump: number | null; slumpEntrega: number | null; temperatura: number | null; moldadoPor: string | null; observacao: string | null; confirmadaEm: string | null;
  confirmadaPor: string | null; entregue: boolean;
};

const SELO: Record<Demanda['status'], [string, string]> = {
  pendente: ['Aguardando', 'selo-aviso'],
  ativa: ['Moldada', 'selo-ok'],
  nao_amostrada: ['Não amostrada', 'selo-neutro'],
  cancelada: ['Cancelada', 'selo-neutro'],
};

export function QualDemandas() {
  const { usuario } = useSessao();
  const [itens, setItens] = useState<Demanda[] | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [aberta, setAberta] = useState<{ id: string; modo: 'confirmar' | 'nao'; slump: string; temperatura: string; moldadoPor: string; motivo: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [ultimaConfirmada, setUltimaConfirmada] = useState<string | null>(null);

  const carregar = useCallback(() => {
    api<{ itens: Demanda[] }>(`/qual/demandas?de=${somarDias(hojeLocal(), -3)}&ate=${hojeLocal()}`).then((r) => setItens(r.itens)).catch((e) => setErro((e as Error).message));
  }, []);
  useEffect(carregar, [carregar]);

  async function enviar(e: FormEvent, d: Demanda) {
    e.preventDefault();
    if (!aberta) return;
    setErro('');
    setOcupado(true);
    try {
      if (aberta.modo === 'confirmar') {
        const r = await api<{ cps: number }>(`/qual/amostras/${d.amostraId}/confirmar`, {
          corpo: { slump: aberta.slump.trim() ? lerNumero(aberta.slump) : null, temperatura: aberta.temperatura.trim() ? lerNumero(aberta.temperatura) : null, moldadoPor: aberta.moldadoPor },
        });
        setAviso(`Carga nº ${d.numero}: moldagem confirmada, ${r.cps} corpos de prova gerados.`);
        setUltimaConfirmada(d.cargaId);
      } else {
        await api(`/qual/amostras/${d.amostraId}/nao-amostrar`, { corpo: { motivo: aberta.motivo } });
        setAviso(`Carga nº ${d.numero} marcada como não amostrada.`);
        setUltimaConfirmada(null);
      }
      setAberta(null);
      carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
    setOcupado(false);
  }

  const pend = (itens ?? []).filter((i) => i.status === 'pendente');
  const moldadasHoje = (itens ?? []).filter((i) => i.status === 'ativa' && agoraLocal(new Date(i.dataHora)).slice(0, 10) === hojeLocal());
  const feitas = (itens ?? []).filter((i) => i.status !== 'pendente');
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
            {d.slumpTraco ? ` · traço ${d.slumpTraco} cm` : ''}
          </div>
          {d.status !== 'pendente' && (d.confirmadaPor || d.observacao) && (
            <div className="small muted">{[d.observacao, d.confirmadaPor ? `por ${d.confirmadaPor}` : null, d.confirmadaEm ? formatarDataHora(d.confirmadaEm) : null].filter(Boolean).join(' · ')}</div>
          )}
        </div>
        <div className="aprov-acoes">
          {d.status === 'pendente' && (
            <>
              <button className="btn btn-primario" type="button" onClick={() => setAberta({ id: d.amostraId, modo: 'confirmar', slump: d.slump === null ? '' : String(d.slump).replace('.', ','), temperatura: '', moldadoPor: usuario?.nome ?? '', motivo: '' })}>
                Confirmar moldagem
              </button>
              <button className="btn btn-secundario" type="button" onClick={() => setAberta({ id: d.amostraId, modo: 'nao', slump: '', temperatura: '', moldadoPor: '', motivo: '' })}>
                Não amostrar
              </button>
            </>
          )}
          {d.status === 'ativa' && <Link className="btn btn-link" to={`/prod/etiquetas/imprimir?ids=${d.cargaId}`}>Etiquetas</Link>}
          <Link className="btn btn-link" to={`/qual/rastreabilidade/${d.cargaId}`}>Rastrear</Link>
        </div>
      </div>
      {aberta?.id === d.amostraId && (
        <form className="form" onSubmit={(e) => enviar(e, d)} style={{ marginTop: 8 }}>
          {aberta.modo === 'confirmar' ? (
            <div className="campos">
              <div className="campo">
                <label htmlFor={`s-${d.amostraId}`}>Slump na usina (cm)</label>
                <input id={`s-${d.amostraId}`} className="mono" inputMode="decimal" value={aberta.slump} onChange={(e) => setAberta({ ...aberta, slump: e.target.value })} />
              </div>
              <div className="campo">
                <label htmlFor={`t-${d.amostraId}`}>Temperatura do concreto (°C)</label>
                <input id={`t-${d.amostraId}`} className="mono" inputMode="decimal" value={aberta.temperatura} onChange={(e) => setAberta({ ...aberta, temperatura: e.target.value })} />
              </div>
              <div className="campo">
                <label htmlFor={`m-${d.amostraId}`}>Moldado por</label>
                <input id={`m-${d.amostraId}`} value={aberta.moldadoPor} onChange={(e) => setAberta({ ...aberta, moldadoPor: e.target.value })} />
              </div>
            </div>
          ) : (
            <div className="campo">
              <label htmlFor={`n-${d.amostraId}`}>Motivo de não amostrar</label>
              <input id={`n-${d.amostraId}`} required minLength={3} value={aberta.motivo} onChange={(e) => setAberta({ ...aberta, motivo: e.target.value })} />
            </div>
          )}
          <div className="acoes">
            <button className="btn btn-primario" type="submit" disabled={ocupado}>{aberta.modo === 'confirmar' ? 'Confirmar e gerar os CPs' : 'Marcar como não amostrada'}</button>
            <button className="btn btn-link" type="button" onClick={() => setAberta(null)}>Voltar</button>
          </div>
        </form>
      )}
    </li>
  );

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Cargas a amostrar</h1>
          <span className="muted">Cada carga registrada vira uma demanda. Confirme a moldagem para gerar os corpos de prova.</span>
        </div>
        <Link className="btn btn-secundario" to="/qual/rastreabilidade">Rastrear carga</Link>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && (
        <div className="alerta alerta-ok" role="status" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ flex: 1 }}>{aviso}</span>
          {ultimaConfirmada && <Link className="btn btn-secundario" to={`/prod/etiquetas/imprimir?ids=${ultimaConfirmada}`}>Imprimir etiquetas</Link>}
        </div>
      )}
      {moldadasHoje.length > 0 && (
        <div className="filtros">
          <Link className="btn btn-secundario" to={`/prod/etiquetas/imprimir?ids=${moldadasHoje.map((i) => i.cargaId).join(',')}`}>
            Etiquetas das cargas moldadas hoje ({moldadasHoje.length})
          </Link>
        </div>
      )}
      <section className="card">
        <h2>Aguardando o laboratório {pend.length > 0 && <span className="selo selo-aviso">{pend.length}</span>}</h2>
        {!itens ? <p className="muted">Carregando…</p> : pend.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nenhuma carga esperando.</p> : <ul className="lista-demandas">{pend.map(linha)}</ul>}
      </section>
      {feitas.length > 0 && (
        <section className="card">
          <h2>Últimos 3 dias</h2>
          <ul className="lista-demandas">{feitas.map(linha)}</ul>
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
