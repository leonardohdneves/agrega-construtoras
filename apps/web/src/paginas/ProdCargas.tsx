import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  agoraLocal,
  api,
  diaCurto,
  formatarNumero,
  hojeLocal,
  lerNumero,
  NOMES_FUNCAO,
  somarDias,
  type Carga,
  type OpcoesCarga,
} from '../api';
import { useSessao } from '../sessao';

const hora = (iso: string) => agoraLocal(new Date(iso)).slice(11, 16);
const m3 = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${formatarNumero(n, Number.isInteger(n) ? 0 : 1)} m³`);

// ---------------------------------------------------------------- formulário
type Dados = {
  dataHora: string;
  tracoId: string;
  volume: string;
  clienteId: string;
  obra: string;
  betoneiraId: string;
  motoristaId: string;
  comBomba: boolean;
  bombaId: string;
  operadorBombaId: string;
  volumeBombeado: string;
  devolvido: string;
  documento: string;
  observacoes: string;
};

const vazio = (): Dados => ({
  dataHora: agoraLocal(),
  tracoId: '',
  volume: '',
  clienteId: '',
  obra: '',
  betoneiraId: '',
  motoristaId: '',
  comBomba: false,
  bombaId: '',
  operadorBombaId: '',
  volumeBombeado: '',
  devolvido: '',
  documento: '',
  observacoes: '',
});

function deCarga(c: Carga): Dados {
  return {
    dataHora: agoraLocal(new Date(c.dataHora)),
    tracoId: c.tracoId,
    volume: String(c.volume).replace('.', ','),
    clienteId: c.clienteId ?? '',
    obra: c.obra ?? '',
    betoneiraId: c.betoneiraId,
    motoristaId: c.motoristaId ?? '',
    comBomba: !!c.bombaId,
    bombaId: c.bombaId ?? '',
    operadorBombaId: c.operadorBombaId ?? '',
    volumeBombeado: c.volumeBombeado === null ? '' : String(c.volumeBombeado).replace('.', ','),
    devolvido: c.devolvido ? String(c.devolvido).replace('.', ',') : '',
    documento: c.documento ?? '',
    observacoes: c.observacoes ?? '',
  };
}

function FormCarga({ opcoes, editando, aoSalvar, aoCancelar }: { opcoes: OpcoesCarga; editando?: Carga; aoSalvar: (c: Carga, outra: boolean) => void; aoCancelar: () => void }) {
  const [d, setD] = useState<Dados>(() => (editando ? deCarga(editando) : vazio()));
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const motoristas = opcoes.pessoas.filter((p) => p.funcao !== 'operador_bomba');
  const operadores = opcoes.pessoas.filter((p) => p.funcao !== 'motorista');
  const ordenar = (lista: OpcoesCarga['pessoas']) =>
    [...lista].sort((a, b) => Number(!a.escala || a.escala === 'folga') - Number(!b.escala || b.escala === 'folga') || a.nome.localeCompare(b.nome, 'pt-BR'));
  const betoneira = opcoes.betoneiras.find((b) => b.id === d.betoneiraId);

  function escolherBetoneira(id: string) {
    const sugerido = opcoes.motoristaDaBetoneira[id];
    setD((x) => ({ ...x, betoneiraId: id, motoristaId: x.motoristaId || sugerido || '' }));
  }

  async function salvar(e: FormEvent, outra = false) {
    e.preventDefault();
    setErro('');
    const volume = lerNumero(d.volume);
    if (!d.tracoId) return setErro('Escolha o traço.');
    if (!volume) return setErro('Informe o volume da carga em m³.');
    if (!d.betoneiraId) return setErro('Escolha a betoneira.');
    if (d.comBomba && !d.bombaId) return setErro('Escolha a bomba.');
    setOcupado(true);
    try {
      const corpo = {
        dataHora: d.dataHora,
        tracoId: d.tracoId,
        volume,
        clienteId: d.clienteId || null,
        obra: d.obra,
        betoneiraId: d.betoneiraId,
        motoristaId: d.motoristaId || null,
        bombaId: d.comBomba ? d.bombaId : null,
        operadorBombaId: d.comBomba ? d.operadorBombaId || null : null,
        volumeBombeado: d.comBomba ? (lerNumero(d.volumeBombeado) ?? volume) : null,
        devolvido: lerNumero(d.devolvido) ?? 0,
        documento: d.documento,
        observacoes: d.observacoes,
      };
      const r = editando
        ? await api<{ carga: Carga }>(`/prod/cargas/${editando.id}`, { metodo: 'PATCH', corpo })
        : await api<{ carga: Carga }>('/prod/cargas', { corpo });
      aoSalvar(r.carga, outra);
      if (outra) {
        // Mantém cliente, obra e traço para a próxima viagem da mesma obra.
        setD((x) => ({ ...vazio(), tracoId: x.tracoId, clienteId: x.clienteId, obra: x.obra, comBomba: x.comBomba, bombaId: x.bombaId, operadorBombaId: x.operadorBombaId }));
      }
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form className="form" onSubmit={(e) => salvar(e)}>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div className="campos">
        <div className="campo">
          <label htmlFor="c-traco">Traço</label>
          <select id="c-traco" value={d.tracoId} onChange={(e) => setD({ ...d, tracoId: e.target.value })}>
            <option value="">Escolha</option>
            {opcoes.tracos.map((t) => (
              <option key={t.id} value={t.id}>
                {t.codigo}{t.descricao ? ` · ${t.descricao}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="c-vol">Volume (m³)</label>
          <input id="c-vol" className="mono" inputMode="decimal" placeholder={betoneira?.capacidade ? `até ${formatarNumero(betoneira.capacidade)}` : 'ex.: 8'} value={d.volume} onChange={(e) => setD({ ...d, volume: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="c-bet">Betoneira</label>
          <select id="c-bet" value={d.betoneiraId} onChange={(e) => escolherBetoneira(e.target.value)}>
            <option value="">Escolha</option>
            {opcoes.betoneiras.map((b) => (
              <option key={b.id} value={b.id}>
                {b.codigo}{b.capacidade ? ` · ${formatarNumero(b.capacidade)} m³` : ''}{b.status !== 'disponivel' ? ' · em manutenção' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="c-mot">Motorista</label>
          <select id="c-mot" value={d.motoristaId} onChange={(e) => setD({ ...d, motoristaId: e.target.value })}>
            <option value="">Sem motorista</option>
            {ordenar(motoristas).map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}{p.escala ? (p.escala === 'folga' ? ' · folga hoje' : ` · entrada ${p.escala}`) : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="c-cli">Cliente</label>
          <select id="c-cli" value={d.clienteId} onChange={(e) => setD({ ...d, clienteId: e.target.value })}>
            <option value="">Não informado</option>
            {opcoes.clientes.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="c-obra">Obra</label>
          <input id="c-obra" value={d.obra} placeholder="Endereço ou nome da obra" onChange={(e) => setD({ ...d, obra: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="c-data">Data e hora da saída</label>
          <input id="c-data" type="datetime-local" value={d.dataHora} onChange={(e) => setD({ ...d, dataHora: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="c-doc">Remessa ou nota</label>
          <input id="c-doc" className="mono" value={d.documento} onChange={(e) => setD({ ...d, documento: e.target.value })} />
        </div>
      </div>

      <label className="marcar">
        <input type="checkbox" checked={d.comBomba} onChange={(e) => setD({ ...d, comBomba: e.target.checked })} />
        Entrega com bombeamento
      </label>
      {d.comBomba && (
        <div className="campos">
          <div className="campo">
            <label htmlFor="c-bomba">Bomba</label>
            <select
              id="c-bomba"
              value={d.bombaId}
              onChange={(e) => setD({ ...d, bombaId: e.target.value, operadorBombaId: d.operadorBombaId || opcoes.motoristaDaBetoneira[e.target.value] || '' })}
            >
              <option value="">Escolha</option>
              {opcoes.bombas.map((b) => (
                <option key={b.id} value={b.id}>{b.codigo}</option>
              ))}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="c-op">Operador da bomba</label>
            <select id="c-op" value={d.operadorBombaId} onChange={(e) => setD({ ...d, operadorBombaId: e.target.value })}>
              <option value="">Não informado</option>
              {ordenar(operadores).map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="c-bomb">Volume bombeado (m³)</label>
            <input id="c-bomb" className="mono" inputMode="decimal" placeholder="o volume da carga" value={d.volumeBombeado} onChange={(e) => setD({ ...d, volumeBombeado: e.target.value })} />
          </div>
        </div>
      )}

      <div className="campos">
        <div className="campo">
          <label htmlFor="c-dev">Concreto devolvido (m³)</label>
          <input id="c-dev" className="mono" inputMode="decimal" placeholder="0" value={d.devolvido} onChange={(e) => setD({ ...d, devolvido: e.target.value })} />
        </div>
        <div className="campo" style={{ gridColumn: 'span 2' }}>
          <label htmlFor="c-obs">Observações</label>
          <input id="c-obs" value={d.observacoes} onChange={(e) => setD({ ...d, observacoes: e.target.value })} />
        </div>
      </div>

      <div className="acoes">
        <button className="btn btn-primario" type="submit" disabled={ocupado}>
          {editando ? 'Salvar alterações' : 'Registrar carga'}
        </button>
        {!editando && (
          <button className="btn btn-secundario" type="button" disabled={ocupado} onClick={(e) => salvar(e as unknown as FormEvent, true)}>
            Registrar e lançar outra
          </button>
        )}
        <button className="btn btn-link" type="button" onClick={aoCancelar}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- tela de registro (celular da usina)
export function NovaCarga() {
  const [opcoes, setOpcoes] = useState<OpcoesCarga | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const navegar = useNavigate();
  useEffect(() => {
    api<OpcoesCarga>('/prod/cargas/opcoes').then(setOpcoes).catch((e) => setErro((e as Error).message));
  }, []);
  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Registrar carga</h1>
          <span className="muted">Lance cada viagem quando a betoneira sair da usina.</span>
        </div>
        <Link className="btn btn-secundario" to="/prod/cargas">Cargas do dia</Link>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}
      {opcoes && opcoes.tracos.length === 0 && (
        <div className="alerta alerta-aviso">Nenhum traço cadastrado. O gestor precisa cadastrar os traços em Produção › Traços.</div>
      )}
      {opcoes && (
        <div className="card">
          <FormCarga
            opcoes={opcoes}
            aoCancelar={() => navegar('/prod/cargas')}
            aoSalvar={(c, outra) => {
              setAviso(`Carga nº ${c.numero} registrada: ${m3(c.volume)} de ${c.tracoCodigo} no ${c.betoneiraCodigo}.`);
              if (!outra) navegar('/prod/cargas', { state: { aviso: `Carga nº ${c.numero} registrada.` } });
            }}
          />
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- lista
type Resposta = { de: string; ate: string; cargas: Carga[]; resumo: { cargas: number; canceladas: number; m3: number; devolvido: number; bombeado: number } };

export function Cargas() {
  const { usuario } = useSessao();
  const params = useParams();
  const gestao = usuario?.perfil === 'dono' || usuario?.perfil === 'gestor';
  const [dia, setDia] = useState(params.dia ?? hojeLocal());
  const [dados, setDados] = useState<Resposta | null>(null);
  const [opcoes, setOpcoes] = useState<OpcoesCarga | null>(null);
  const [editando, setEditando] = useState<Carga | null>(null);
  const [cancelando, setCancelando] = useState<Carga | null>(null);
  const [motivo, setMotivo] = useState('');
  const [filtroBet, setFiltroBet] = useState('');
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const hoje = hojeLocal();

  const carregar = useCallback(async () => {
    try {
      setDados(await api<Resposta>(`/prod/cargas?de=${dia}&ate=${dia}`));
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [dia]);
  useEffect(() => {
    carregar();
  }, [carregar]);
  useEffect(() => {
    api<OpcoesCarga>('/prod/cargas/opcoes').then(setOpcoes).catch(() => {});
  }, []);

  const podeMexer = gestao || dia === hoje;
  const lista = useMemo(() => (dados?.cargas ?? []).filter((c) => !filtroBet || c.betoneiraId === filtroBet), [dados, filtroBet]);
  const porBetoneira = useMemo(() => {
    const m = new Map<string, { codigo: string; viagens: number; m3: number }>();
    for (const c of dados?.cargas ?? []) {
      if (c.status !== 'produzida') continue;
      const x = m.get(c.betoneiraId) ?? { codigo: c.betoneiraCodigo, viagens: 0, m3: 0 };
      x.viagens++;
      x.m3 += c.volume;
      m.set(c.betoneiraId, x);
    }
    return [...m.entries()].sort((a, b) => a[1].codigo.localeCompare(b[1].codigo));
  }, [dados]);

  async function confirmarCancelamento() {
    if (!cancelando) return;
    setErro('');
    try {
      await api(`/prod/cargas/${cancelando.id}/cancelar`, { corpo: { motivo } });
      setAviso(`Carga nº ${cancelando.numero} cancelada.`);
      setCancelando(null);
      setMotivo('');
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Cargas</h1>
          <span className="muted">Concreto que saiu da usina, viagem a viagem.</span>
        </div>
        <Link className="btn btn-primario" to="/prod/cargas/nova">Registrar carga</Link>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}

      <div className="filtros">
        <div className="navegar-mes">
          <button className="btn btn-secundario" type="button" aria-label="Dia anterior" onClick={() => setDia(somarDias(dia, -1))}>‹</button>
          <input type="date" value={dia} max={hoje} onChange={(e) => e.target.value && setDia(e.target.value)} aria-label="Dia" />
          <button className="btn btn-secundario" type="button" aria-label="Próximo dia" disabled={dia >= hoje} onClick={() => setDia(somarDias(dia, 1))}>›</button>
          {dia !== hoje && (
            <button className="btn btn-link" type="button" onClick={() => setDia(hoje)}>Hoje</button>
          )}
        </div>
        {opcoes && (
          <select value={filtroBet} onChange={(e) => setFiltroBet(e.target.value)} aria-label="Betoneira">
            <option value="">Todas as betoneiras</option>
            {opcoes.betoneiras.map((b) => (
              <option key={b.id} value={b.id}>{b.codigo}</option>
            ))}
          </select>
        )}
      </div>

      <div className="grade">
        <div className="card indicador">
          <span className="rotulo-ind">Cargas · {diaCurto(dia)}</span>
          <span className="valor-ind mono">{dados ? dados.resumo.cargas : '—'}</span>
        </div>
        <div className="card indicador">
          <span className="rotulo-ind">Volume</span>
          <span className="valor-ind mono">{dados ? m3(dados.resumo.m3) : '—'}</span>
        </div>
        <div className="card indicador">
          <span className="rotulo-ind">Bombeado</span>
          <span className="valor-ind mono">{dados ? m3(dados.resumo.bombeado) : '—'}</span>
        </div>
        <div className="card indicador">
          <span className="rotulo-ind">Devolvido</span>
          <span className="valor-ind mono">{dados ? m3(dados.resumo.devolvido) : '—'}</span>
        </div>
      </div>

      {editando && opcoes && (
        <div className="card">
          <h2>Corrigir carga nº {editando.numero}</h2>
          <FormCarga
            opcoes={opcoes}
            editando={editando}
            aoCancelar={() => setEditando(null)}
            aoSalvar={async (c) => {
              setEditando(null);
              setAviso(`Carga nº ${c.numero} corrigida.`);
              await carregar();
            }}
          />
        </div>
      )}

      {cancelando && (
        <div className="alerta alerta-aviso" role="alert" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ flex: '1 1 220px' }}>Cancelar a carga nº {cancelando.numero} ({m3(cancelando.volume)} no {cancelando.betoneiraCodigo})?</span>
          <input placeholder="Motivo do cancelamento" value={motivo} onChange={(e) => setMotivo(e.target.value)} style={{ flex: '1 1 220px' }} />
          <button className="btn btn-primario" type="button" onClick={confirmarCancelamento}>Cancelar carga</button>
          <button className="btn btn-secundario" type="button" onClick={() => setCancelando(null)}>Manter</button>
        </div>
      )}

      {porBetoneira.length > 0 && (
        <div className="card tabela-caixa">
          <h2>Por betoneira</h2>
          <table className="tabela tabela-compacta">
            <thead>
              <tr>
                <th>Betoneira</th>
                <th style={{ textAlign: 'right' }}>Viagens</th>
                <th style={{ textAlign: 'right' }}>Volume</th>
              </tr>
            </thead>
            <tbody>
              {porBetoneira.map(([id, b]) => (
                <tr key={id}>
                  <td className="mono">{b.codigo}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{b.viagens}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{m3(b.m3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card tabela-caixa">
        <h2>Viagens</h2>
        {!dados ? (
          <p className="muted">Carregando…</p>
        ) : lista.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nenhuma carga neste dia.</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Saída</th>
                <th>Traço</th>
                <th style={{ textAlign: 'right' }}>Volume</th>
                <th>Cliente e obra</th>
                <th>Betoneira e motorista</th>
                <th>Bomba</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.id} style={c.status === 'cancelada' ? { opacity: 0.55 } : undefined}>
                  <td className="mono">{c.numero}</td>
                  <td className="mono">{hora(c.dataHora)}</td>
                  <td className="mono">{c.tracoCodigo}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    {m3(c.volume)}
                    {c.devolvido > 0 && <div className="small texto-perigo">voltou {m3(c.devolvido)}</div>}
                  </td>
                  <td>
                    {c.clienteNome ?? '—'}
                    {c.obra && <div className="small muted">{c.obra}</div>}
                  </td>
                  <td>
                    <span className="mono">{c.betoneiraCodigo}</span>
                    <div className="small muted">{c.motoristaNome ?? 'sem motorista'}</div>
                  </td>
                  <td>
                    {c.bombaCodigo ? (
                      <>
                        <span className="mono">{c.bombaCodigo}</span> · {m3(c.volumeBombeado)}
                        <div className="small muted">{c.operadorBombaNome ?? ''}</div>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    {c.status === 'cancelada' ? (
                      <span className="selo selo-neutro" title={c.motivoCancelamento ?? ''}>Cancelada</span>
                    ) : (
                      podeMexer && (
                        <>
                          <button className="btn btn-link" type="button" onClick={() => setEditando(c)}>Corrigir</button>
                          <button className="btn btn-link" type="button" onClick={() => { setCancelando(c); setMotivo(''); }}>Cancelar</button>
                        </>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {opcoes && opcoes.pessoas.length > 0 && (
        <p className="small muted">
          Motoristas na escala de hoje:{' '}
          {opcoes.pessoas.filter((p) => p.escala && p.escala !== 'folga').map((p) => `${p.nome.split(' ')[0]} (${p.escala}, ${NOMES_FUNCAO[p.funcao].toLowerCase()})`).join(' · ') || 'escala não montada'}
        </p>
      )}
    </>
  );
}
