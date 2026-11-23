// Engenharia · Canteiro vertical: pavimentos, ciclo de cada laje, agenda de guincho e grua por pavimento e concreto
// lançado por andar. Só aparece para obras de canteiro vertical, em empresas com o recurso no contrato.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatarData } from '../api';
import { useSessao } from '../sessao';

const ETAPAS: [string, string][] = [
  ['formas', 'Formas'],
  ['armacao', 'Armação'],
  ['concretagem', 'Concretagem'],
  ['cura', 'Cura'],
  ['desforma', 'Desforma'],
];
type Etapa = { etapa: string; inicio: string; fim: string; dias: number };
type Pavimento = { id: string; ordem: number; nome: string; ciclo: { etapas: Etapa[]; diasCiclo: number | null }; concretadoM3: number };
type Pavimentos = { pavimentos: Pavimento[]; mediaDiasCiclo: number | null; concretadoTotalM3: number };
type Reserva = { id: string; pavimentoId: string; pavimento: string; equipamento: string; data: string; inicio: string; fim: string; descricao: string };
type Concretagem = { id: string; pavimentoId: string; pavimento: string; data: string; volumeM3: number; fck: string; nota: string };

const m3 = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m³`;
const hoje = () => new Date().toLocaleDateString('en-CA');
const nomeEquipamento = (e: string) => (e === 'grua' ? 'Grua' : 'Guincho');

/** Ciclo de uma laje: as datas de cada etapa. Etapa sem as duas datas fica fora do ciclo. */
function EditorCiclo({ pav, aoSalvar, aoFechar, setErro }: { pav: Pavimento; aoSalvar: (etapas: { etapa: string; inicio: string; fim: string }[]) => Promise<void>; aoFechar: () => void; setErro: (m: string) => void }) {
  const [datas, setDatas] = useState<Record<string, { inicio: string; fim: string }>>(
    Object.fromEntries(ETAPAS.map(([v]) => [v, pav.ciclo.etapas.find((e) => e.etapa === v) ?? { inicio: '', fim: '' }])),
  );
  const mudar = (v: string, campo: 'inicio' | 'fim', valor: string) => setDatas({ ...datas, [v]: { ...datas[v], [campo]: valor } });
  async function salvar(e: FormEvent) {
    e.preventDefault();
    const etapas = ETAPAS.map(([v]) => ({ etapa: v, ...datas[v] }));
    if (etapas.some((x) => !!x.inicio !== !!x.fim)) return setErro('Preencha o início e o fim de cada etapa, ou deixe as duas datas vazias.');
    await aoSalvar(etapas.filter((x) => x.inicio && x.fim));
  }
  return (
    <form className="card form" onSubmit={salvar}>
      <h3 style={{ margin: 0 }}>Ciclo da laje · {pav.nome}</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        {ETAPAS.map(([v, nome]) => (
          <div className="campo" key={v}>
            <label htmlFor={`cl-${v}-i`}>{nome}</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input id={`cl-${v}-i`} type="date" aria-label={`${nome}: início`} value={datas[v].inicio} onChange={(e) => mudar(v, 'inicio', e.target.value)} />
              <input type="date" aria-label={`${nome}: fim`} value={datas[v].fim} onChange={(e) => mudar(v, 'fim', e.target.value)} />
            </div>
          </div>
        ))}
      </div>
      <div className="acoes">
        <button className="btn btn-primario" type="submit">Salvar ciclo</button>
        <button className="btn btn-secundario" type="button" onClick={aoFechar}>Fechar</button>
      </div>
    </form>
  );
}

export function EngCanteiroVertical() {
  const { obraId = '' } = useParams();
  const { usuario } = useSessao();
  const somenteLeitura = usuario?.perfil === 'mestre_obra';
  const base = `/eng/obras/${obraId}/canteiro/vertical`;
  const [pav, setPav] = useState<Pavimentos | null>(null);
  const [agenda, setAgenda] = useState<Reserva[]>([]);
  const [concretagens, setConcretagens] = useState<Concretagem[]>([]);
  const [desde, setDesde] = useState(hoje());
  const [erro, setErro] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [novoPav, setNovoPav] = useState('');
  const [reserva, setReserva] = useState({ pavimentoId: '', equipamento: 'guincho', data: hoje(), inicio: '07:00', fim: '11:00', descricao: '' });
  const [concreto, setConcreto] = useState({ pavimentoId: '', data: hoje(), volume: '', fck: '', nota: '' });

  const carregar = useCallback(async () => {
    try {
      const [p, a, c] = await Promise.all([
        api<Pavimentos>(`${base}/pavimentos`),
        api<{ agenda: Reserva[] }>(`${base}/agenda?inicio=${desde}`),
        api<{ concretagens: Concretagem[] }>(`${base}/concretagens`),
      ]);
      setPav(p);
      setAgenda(a.agenda);
      setConcretagens(c.concretagens);
      setErro('');
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [base, desde]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  /** Executa uma alteração e recarrega a tela; o erro do servidor aparece no alerta. */
  async function executar(fn: () => Promise<unknown>): Promise<boolean> {
    setErro('');
    try {
      await fn();
      await carregar();
      return true;
    } catch (e) {
      setErro((e as Error).message);
      return false;
    }
  }

  if (!pav) return erro ? <div className="alerta alerta-erro" role="alert">{erro}</div> : <p className="muted">Carregando…</p>;
  const lista = pav.pavimentos;
  const pavimentoPadrao = lista[0]?.id ?? '';

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Canteiro vertical</h1>
          <span className="muted">Pavimentos, ciclo de laje, agenda de guincho e grua, e concreto por andar.</span>
        </div>
        <div className="acoes nao-imprimir">
          <Link className="btn" to={`/eng/canteiro/${obraId}`}>Voltar ao canteiro</Link>
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Pavimentos e ciclo de laje</h2>
        <p className="muted">
          Ciclo médio: {pav.mediaDiasCiclo === null ? 'sem ciclo lançado' : `${pav.mediaDiasCiclo.toLocaleString('pt-BR')} dias`} · Concreto lançado na obra: {m3(pav.concretadoTotalM3)}
        </p>
        {lista.length === 0 ? (
          <p className="muted">Cadastre os pavimentos da obra para lançar ciclo, agenda e concreto.</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr><th>Pavimento</th><th>Ciclo da laje</th><th>Concreto lançado</th><th /></tr>
            </thead>
            <tbody>
              {lista.map((p) => (
                <tr key={p.id}>
                  <td>{p.nome}</td>
                  <td>{p.ciclo.diasCiclo === null ? '—' : `${p.ciclo.diasCiclo} dia(s): ${p.ciclo.etapas.map((e) => `${ETAPAS.find(([v]) => v === e.etapa)?.[1] ?? e.etapa} ${e.dias}d`).join(' · ')}`}</td>
                  <td>{m3(p.concretadoM3)}</td>
                  <td>
                    {!somenteLeitura && (
                      <>
                        <button type="button" className="btn btn-link" onClick={() => setEditando(editando === p.id ? null : p.id)}>Ciclo</button>
                        <button
                          type="button"
                          className="btn btn-link"
                          onClick={() => {
                            if (window.confirm(`Apagar o pavimento ${p.nome}? A agenda, o ciclo e o concreto lançado nele também são apagados.`)) executar(() => api(`${base}/pavimentos/${p.id}`, { metodo: 'DELETE' }));
                          }}
                        >
                          Apagar
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!somenteLeitura && (
          <form
            className="form"
            style={{ marginTop: 12 }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (await executar(() => api(`${base}/pavimentos`, { metodo: 'POST', corpo: { nome: novoPav } }))) setNovoPav('');
            }}
          >
            <div className="campo">
              <label htmlFor="pv-nome">Novo pavimento</label>
              <input id="pv-nome" value={novoPav} maxLength={60} onChange={(e) => setNovoPav(e.target.value)} placeholder="Ex.: Térreo, 1º pavimento, Cobertura" />
            </div>
            <div className="acoes"><button className="btn btn-secundario" type="submit" disabled={!novoPav.trim()}>Adicionar pavimento</button></div>
          </form>
        )}
      </div>

      {editando && lista.find((p) => p.id === editando) && (
        <EditorCiclo
          key={editando}
          pav={lista.find((p) => p.id === editando)!}
          setErro={setErro}
          aoFechar={() => setEditando(null)}
          aoSalvar={async (etapas) => {
            if (await executar(() => api(`${base}/pavimentos/${editando}/ciclo`, { metodo: 'PUT', corpo: { etapas } }))) setEditando(null);
          }}
        />
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Agenda de guincho e grua</h2>
        <div className="campo" style={{ maxWidth: 220 }}>
          <label htmlFor="ag-desde">A partir de</label>
          <input id="ag-desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value || hoje())} />
        </div>
        {agenda.length === 0 ? (
          <p className="muted">Nenhuma reserva a partir dessa data.</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr><th>Data</th><th>Horário</th><th>Equipamento</th><th>Pavimento</th><th>Serviço</th><th /></tr>
            </thead>
            <tbody>
              {agenda.map((a) => (
                <tr key={a.id}>
                  <td>{formatarData(a.data)}</td>
                  <td>{a.inicio} às {a.fim}</td>
                  <td>{nomeEquipamento(a.equipamento)}</td>
                  <td>{a.pavimento}</td>
                  <td>{a.descricao || '—'}</td>
                  <td>{!somenteLeitura && <button type="button" className="btn btn-link" onClick={() => executar(() => api(`${base}/agenda/${a.id}`, { metodo: 'DELETE' }))}>Remover</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!somenteLeitura && lista.length > 0 && (
          <form
            className="form"
            style={{ marginTop: 12 }}
            onSubmit={async (e) => {
              e.preventDefault();
              await executar(() => api(`${base}/agenda`, { metodo: 'POST', corpo: { ...reserva, pavimentoId: reserva.pavimentoId || pavimentoPadrao } }));
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
              <div className="campo">
                <label htmlFor="ag-eq">Equipamento</label>
                <select id="ag-eq" value={reserva.equipamento} onChange={(e) => setReserva({ ...reserva, equipamento: e.target.value })}>
                  <option value="guincho">Guincho</option>
                  <option value="grua">Grua</option>
                </select>
              </div>
              <div className="campo">
                <label htmlFor="ag-pav">Pavimento</label>
                <select id="ag-pav" value={reserva.pavimentoId || pavimentoPadrao} onChange={(e) => setReserva({ ...reserva, pavimentoId: e.target.value })}>
                  {lista.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </div>
              <div className="campo"><label htmlFor="ag-data">Data</label><input id="ag-data" type="date" value={reserva.data} onChange={(e) => setReserva({ ...reserva, data: e.target.value })} /></div>
              <div className="campo"><label htmlFor="ag-i">Início</label><input id="ag-i" type="time" value={reserva.inicio} onChange={(e) => setReserva({ ...reserva, inicio: e.target.value })} /></div>
              <div className="campo"><label htmlFor="ag-f">Fim</label><input id="ag-f" type="time" value={reserva.fim} onChange={(e) => setReserva({ ...reserva, fim: e.target.value })} /></div>
              <div className="campo"><label htmlFor="ag-d">Serviço (opcional)</label><input id="ag-d" maxLength={200} value={reserva.descricao} onChange={(e) => setReserva({ ...reserva, descricao: e.target.value })} placeholder="Ex.: içar formas da laje" /></div>
            </div>
            <div className="acoes"><button className="btn btn-secundario" type="submit">Reservar</button></div>
          </form>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Concreto por andar</h2>
        {concretagens.length === 0 ? (
          <p className="muted">Nenhuma concretagem lançada.</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr><th>Data</th><th>Pavimento</th><th>Volume</th><th>fck</th><th>Observação</th><th /></tr>
            </thead>
            <tbody>
              {concretagens.map((c) => (
                <tr key={c.id}>
                  <td>{formatarData(c.data)}</td>
                  <td>{c.pavimento}</td>
                  <td>{m3(c.volumeM3)}</td>
                  <td>{c.fck || '—'}</td>
                  <td>{c.nota || '—'}</td>
                  <td>{!somenteLeitura && <button type="button" className="btn btn-link" onClick={() => executar(() => api(`${base}/concretagens/${c.id}`, { metodo: 'DELETE' }))}>Remover</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!somenteLeitura && lista.length > 0 && (
          <form
            className="form"
            style={{ marginTop: 12 }}
            onSubmit={async (e) => {
              e.preventDefault();
              const volumeM3 = Number(concreto.volume.replace(',', '.'));
              if (!Number.isFinite(volumeM3) || volumeM3 <= 0) return setErro('Informe o volume em m³, maior que zero.');
              const ok = await executar(() =>
                api(`${base}/concretagens`, { metodo: 'POST', corpo: { pavimentoId: concreto.pavimentoId || pavimentoPadrao, data: concreto.data, volumeM3, fck: concreto.fck, nota: concreto.nota } }),
              );
              if (ok) setConcreto({ ...concreto, volume: '', nota: '' });
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
              <div className="campo">
                <label htmlFor="cc-pav">Pavimento</label>
                <select id="cc-pav" value={concreto.pavimentoId || pavimentoPadrao} onChange={(e) => setConcreto({ ...concreto, pavimentoId: e.target.value })}>
                  {lista.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </div>
              <div className="campo"><label htmlFor="cc-data">Data</label><input id="cc-data" type="date" value={concreto.data} onChange={(e) => setConcreto({ ...concreto, data: e.target.value })} /></div>
              <div className="campo"><label htmlFor="cc-vol">Volume (m³)</label><input id="cc-vol" inputMode="decimal" value={concreto.volume} onChange={(e) => setConcreto({ ...concreto, volume: e.target.value })} /></div>
              <div className="campo"><label htmlFor="cc-fck">fck (opcional)</label><input id="cc-fck" maxLength={20} value={concreto.fck} onChange={(e) => setConcreto({ ...concreto, fck: e.target.value })} placeholder="Ex.: 30 MPa" /></div>
              <div className="campo"><label htmlFor="cc-nota">Observação (opcional)</label><input id="cc-nota" maxLength={300} value={concreto.nota} onChange={(e) => setConcreto({ ...concreto, nota: e.target.value })} /></div>
            </div>
            <div className="acoes"><button className="btn btn-secundario" type="submit">Lançar concretagem</button></div>
          </form>
        )}
      </div>
    </>
  );
}
