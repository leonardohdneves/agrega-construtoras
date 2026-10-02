import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, formatarData, formatarNumero, intervaloTexto, NOMES_TIPO_VEICULO, textoFalta, type ItemManutencao, type Plano, type TipoVeiculo } from '../api';

type Aba = 'situacao' | 'plano';
type Filtro = 'atencao' | 'todas' | 'sem_registro';

const SELO: Record<ItemManutencao['situacao'], { texto: string; classe: string }> = {
  vencida: { texto: 'Vencida', classe: 'selo-perigo' },
  proxima: { texto: 'Próxima', classe: 'selo-aviso' },
  em_dia: { texto: 'Em dia', classe: 'selo-ok' },
  sem_registro: { texto: 'Sem registro', classe: 'selo-neutro' },
};

type DadosPlano = { id?: string; tipoVeiculo: TipoVeiculo | ''; item: string; intervaloKm: string; intervaloHoras: string; intervaloDias: string; ativo: boolean };
const PLANO_VAZIO: DadosPlano = { tipoVeiculo: '', item: '', intervaloKm: '', intervaloHoras: '', intervaloDias: '', ativo: true };

function Situacao() {
  const navegar = useNavigate();
  const [itens, setItens] = useState<ItemManutencao[] | null>(null);
  const [filtro, setFiltro] = useState<Filtro>('atencao');
  const [registrar, setRegistrar] = useState<{ item: ItemManutencao; km: string; horas: string; data: string } | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  const carregar = useCallback(async () => {
    try {
      setItens((await api<{ itens: ItemManutencao[] }>('/frota/manutencao')).itens);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  const contagem = useMemo(() => {
    const c = { vencida: 0, proxima: 0, sem_registro: 0, total: 0 };
    for (const i of itens ?? []) {
      c.total++;
      if (i.situacao === 'vencida') c.vencida++;
      if (i.situacao === 'proxima') c.proxima++;
      if (i.situacao === 'sem_registro') c.sem_registro++;
    }
    return c;
  }, [itens]);

  const visiveis = (itens ?? [])
    .filter((i) => (filtro === 'atencao' ? i.situacao === 'vencida' || i.situacao === 'proxima' : filtro === 'sem_registro' ? i.situacao === 'sem_registro' : true))
    .sort((a, b) => (filtro === 'todas' ? a.codigo.localeCompare(b.codigo) || (b.uso ?? -1) - (a.uso ?? -1) : (b.uso ?? -1) - (a.uso ?? -1)));

  async function salvarExecucao(e: FormEvent) {
    e.preventDefault();
    if (!registrar) return;
    setErro('');
    try {
      await api('/frota/revisoes', {
        metodo: 'PUT',
        corpo: { veiculoId: registrar.item.veiculoId, planoId: registrar.item.planoId, km: registrar.km, horas: registrar.horas, data: registrar.data },
      });
      setAviso(`Última execução de "${registrar.item.item}" no ${registrar.item.codigo} registrada.`);
      setRegistrar(null);
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  return (
    <>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}

      <div className="indicadores">
        <div className="card indicador">
          <span className="rotulo-ind">Vencidas</span>
          <span className="valor-ind mono" style={{ color: contagem.vencida ? 'var(--status-danger-ink)' : undefined }}>{itens ? contagem.vencida : '—'}</span>
        </div>
        <div className="card indicador">
          <span className="rotulo-ind">Próximas (90% do intervalo)</span>
          <span className="valor-ind mono" style={{ color: contagem.proxima ? 'var(--status-warn-ink)' : undefined }}>{itens ? contagem.proxima : '—'}</span>
        </div>
        <div className="card indicador">
          <span className="rotulo-ind">Sem registro da última execução</span>
          <span className="valor-ind mono">{itens ? contagem.sem_registro : '—'}</span>
        </div>
      </div>

      <div className="filtros" role="group" aria-label="Filtrar itens">
        {([
          ['atencao', `Vencidas e próximas`, contagem.vencida + contagem.proxima],
          ['sem_registro', 'Sem registro', contagem.sem_registro],
          ['todas', 'Todas', contagem.total],
        ] as [Filtro, string, number][]).map(([f, r, n]) => (
          <button key={f} type="button" className={`chip ${filtro === f ? 'chip-ativo' : ''}`} aria-pressed={filtro === f} onClick={() => setFiltro(f)}>
            {r} <span className="mono">{n}</span>
          </button>
        ))}
      </div>

      {registrar && (
        <form className="card form" onSubmit={salvarExecucao}>
          <h2>
            Última execução · <span className="mono">{registrar.item.codigo}</span> · {registrar.item.item}
          </h2>
          <span className="small muted">Use quando o serviço foi feito fora do sistema (ex.: antes da implantação). Serviços feitos por ordem de serviço são registrados sozinhos ao concluir a OS.</span>
          <div className="campos">
            {registrar.item.intervaloKm && (
              <div className="campo">
                <label htmlFor="r-km">Km na execução</label>
                <input id="r-km" className="mono" inputMode="numeric" value={registrar.km} onChange={(e) => setRegistrar({ ...registrar, km: e.target.value })} />
              </div>
            )}
            {registrar.item.intervaloHoras && (
              <div className="campo">
                <label htmlFor="r-hor">Horímetro na execução</label>
                <input id="r-hor" className="mono" inputMode="decimal" value={registrar.horas} onChange={(e) => setRegistrar({ ...registrar, horas: e.target.value })} />
              </div>
            )}
            <div className="campo">
              <label htmlFor="r-data">Data da execução</label>
              <input id="r-data" type="date" value={registrar.data} onChange={(e) => setRegistrar({ ...registrar, data: e.target.value })} />
            </div>
          </div>
          <div className="acoes">
            <button className="btn btn-primario" type="submit">Registrar</button>
            <button className="btn btn-secundario" type="button" onClick={() => setRegistrar(null)}>Cancelar</button>
          </div>
        </form>
      )}

      <div className="card tabela-caixa">
        {!itens ? (
          <p className="muted">Carregando…</p>
        ) : itens.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nenhum item de manutenção. Abra a aba Plano de manutenção e aplique o plano padrão.</p>
        ) : visiveis.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nada neste filtro.</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr>
                <th>Veículo</th>
                <th>Item</th>
                <th>Intervalo</th>
                <th>Última execução</th>
                <th>Situação</th>
                <th><span style={{ position: 'absolute', left: -9999 }}>Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((i) => (
                <tr key={`${i.veiculoId}:${i.planoId}`}>
                  <td>
                    <Link to={`/frota/veiculos/${i.veiculoId}`} className="mono" style={{ fontWeight: 500 }}>{i.codigo}</Link>
                  </td>
                  <td>{i.item}</td>
                  <td className="small mono">{intervaloTexto(i)}</td>
                  <td className="small mono">
                    {[i.ultimaKm !== null ? `${formatarNumero(i.ultimaKm)} km` : null, i.ultimaHoras !== null ? `${formatarNumero(i.ultimaHoras)} h` : null, i.ultimaData ? formatarData(i.ultimaData) : null]
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </td>
                  <td>
                    <span className={`selo ${SELO[i.situacao].classe}`}>{SELO[i.situacao].texto}</span>
                    <div className="small muted">{textoFalta(i)}</div>
                  </td>
                  <td>
                    <div className="acoes" style={{ flexWrap: 'nowrap' }}>
                      <button className="btn btn-link" type="button" onClick={() => navegar(`/frota/os/nova?veiculoId=${i.veiculoId}&planoId=${i.planoId}`)}>
                        Abrir OS
                      </button>
                      <button
                        className="btn btn-link"
                        type="button"
                        onClick={() => {
                          setRegistrar({ item: i, km: '', horas: '', data: '' });
                          window.scrollTo({ top: 0 });
                        }}
                      >
                        Já foi feita
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function Planos() {
  const [planos, setPlanos] = useState<Plano[] | null>(null);
  const [form, setForm] = useState<DadosPlano | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setPlanos((await api<{ planos: Plano[] }>('/frota/planos')).planos);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  async function aplicarPadrao() {
    setOcupado(true);
    setErro('');
    try {
      const r = await api<{ criados: number }>('/frota/planos/padrao', { metodo: 'POST' });
      setAviso(r.criados ? `${r.criados} itens do plano padrão adicionados.` : 'Todos os itens do plano padrão já estavam cadastrados.');
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setErro('');
    setOcupado(true);
    try {
      const corpo = { ...form, tipoVeiculo: form.tipoVeiculo || null, id: undefined };
      if (form.id) await api(`/frota/planos/${form.id}`, { metodo: 'PUT', corpo });
      else await api('/frota/planos', { corpo });
      setAviso(form.id ? 'Item atualizado.' : 'Item adicionado ao plano.');
      setForm(null);
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}
      <div className="acoes">
        {!form && (
          <button className="btn btn-primario" type="button" onClick={() => setForm(PLANO_VAZIO)}>
            Novo item
          </button>
        )}
        <button className="btn btn-secundario" type="button" disabled={ocupado} onClick={aplicarPadrao}>
          Aplicar plano padrão de concreteira
        </button>
      </div>

      {form && (
        <form className="card form" onSubmit={salvar}>
          <h2>{form.id ? 'Editar item do plano' : 'Novo item do plano'}</h2>
          <div className="campos">
            <div className="campo" style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="p-item">Item</label>
              <input id="p-item" value={form.item} onChange={(e) => setForm({ ...form, item: e.target.value })} placeholder="Ex.: Troca de óleo do motor" />
            </div>
            <div className="campo">
              <label htmlFor="p-tipo">Vale para</label>
              <select id="p-tipo" value={form.tipoVeiculo} onChange={(e) => setForm({ ...form, tipoVeiculo: e.target.value as TipoVeiculo | '' })}>
                <option value="">Todos os veículos</option>
                {Object.entries(NOMES_TIPO_VEICULO).map(([k, r]) => (
                  <option key={k} value={k}>Só {r.toLowerCase()}</option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="p-km">A cada (km)</label>
              <input id="p-km" className="mono" inputMode="numeric" value={form.intervaloKm} onChange={(e) => setForm({ ...form, intervaloKm: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="p-h">A cada (horas)</label>
              <input id="p-h" className="mono" inputMode="numeric" value={form.intervaloHoras} onChange={(e) => setForm({ ...form, intervaloHoras: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="p-d">A cada (dias)</label>
              <input id="p-d" className="mono" inputMode="numeric" value={form.intervaloDias} onChange={(e) => setForm({ ...form, intervaloDias: e.target.value })} />
            </div>
          </div>
          <span className="small muted">Preencha um ou mais intervalos. Vence pelo que chegar primeiro.</span>
          <div className="acoes">
            <button className="btn btn-primario" type="submit" disabled={ocupado}>{form.id ? 'Salvar' : 'Adicionar'}</button>
            <button className="btn btn-secundario" type="button" onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </form>
      )}

      <div className="card tabela-caixa">
        {!planos ? (
          <p className="muted">Carregando…</p>
        ) : planos.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nenhum item no plano. Comece aplicando o plano padrão de concreteira e ajuste os intervalos à sua frota.</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr>
                <th>Item</th>
                <th>Vale para</th>
                <th>Intervalo</th>
                <th>Situação</th>
                <th><span style={{ position: 'absolute', left: -9999 }}>Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {planos.map((p) => (
                <tr key={p.id} style={p.ativo ? undefined : { opacity: 0.6 }}>
                  <td>{p.item}</td>
                  <td className="small">{p.tipoVeiculo ? NOMES_TIPO_VEICULO[p.tipoVeiculo] : 'Todos'}</td>
                  <td className="small mono">{intervaloTexto(p)}</td>
                  <td><span className={`selo ${p.ativo ? 'selo-ok' : 'selo-neutro'}`}>{p.ativo ? 'Ativo' : 'Desativado'}</span></td>
                  <td>
                    <div className="acoes" style={{ flexWrap: 'nowrap' }}>
                      <button
                        className="btn btn-link"
                        type="button"
                        onClick={() =>
                          setForm({
                            id: p.id,
                            tipoVeiculo: p.tipoVeiculo ?? '',
                            item: p.item,
                            intervaloKm: p.intervaloKm ? String(p.intervaloKm) : '',
                            intervaloHoras: p.intervaloHoras ? String(p.intervaloHoras) : '',
                            intervaloDias: p.intervaloDias ? String(p.intervaloDias) : '',
                            ativo: p.ativo,
                          })
                        }
                      >
                        Editar
                      </button>
                      <button
                        className="btn btn-link"
                        type="button"
                        disabled={ocupado}
                        onClick={async () => {
                          try {
                            await api(`/frota/planos/${p.id}`, {
                              metodo: 'PUT',
                              corpo: { tipoVeiculo: p.tipoVeiculo, item: p.item, intervaloKm: p.intervaloKm, intervaloHoras: p.intervaloHoras, intervaloDias: p.intervaloDias, ativo: !p.ativo },
                            });
                            await carregar();
                          } catch (e) {
                            setErro((e as Error).message);
                          }
                        }}
                      >
                        {p.ativo ? 'Desativar' : 'Reativar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

export function Manutencao() {
  const [aba, setAba] = useState<Aba>('situacao');
  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Manutenção preventiva</h1>
          <span className="muted">Situação de cada item do plano em cada veículo, por km, horas ou data.</span>
        </div>
        <Link className="btn btn-primario" to="/frota/os/nova">
          Abrir ordem de serviço
        </Link>
      </div>
      <div className="abas" role="tablist">
        <button type="button" role="tab" aria-selected={aba === 'situacao'} className={aba === 'situacao' ? 'ativa' : ''} onClick={() => setAba('situacao')}>
          Situação da frota
        </button>
        <button type="button" role="tab" aria-selected={aba === 'plano'} className={aba === 'plano' ? 'ativa' : ''} onClick={() => setAba('plano')}>
          Plano de manutenção
        </button>
      </div>
      {aba === 'situacao' ? <Situacao /> : <Planos />}
    </>
  );
}
