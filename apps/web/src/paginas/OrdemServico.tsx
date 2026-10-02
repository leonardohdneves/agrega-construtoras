import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  agoraLocal,
  api,
  CLASSE_STATUS_OS,
  formatarData,
  formatarMoeda,
  formatarNumero,
  NOMES_ITEM_OS,
  NOMES_STATUS_OS,
  type Fornecedor,
  type ItemManutencao,
  type ItemOS,
  type OrdemServico as OS,
  type Veiculo,
} from '../api';

const hoje = () => agoraLocal().slice(0, 10);
const ehBomba = (v?: Veiculo) => !!v && v.tipo.startsWith('bomba');

function useOficinas() {
  const [oficinas, setOficinas] = useState<Fornecedor[]>([]);
  useEffect(() => {
    api<{ fornecedores: Fornecedor[] }>('/adm/fornecedores?categoria=fornecedor')
      .then((r) => setOficinas(r.fornecedores.filter((f) => f.ativo)))
      .catch(() => {});
  }, []);
  return oficinas;
}

// ---------- Nova OS ----------
function NovaOS() {
  const navegar = useNavigate();
  const [params] = useSearchParams();
  const oficinas = useOficinas();
  const [veiculos, setVeiculos] = useState<Veiculo[] | null>(null);
  const [pendencias, setPendencias] = useState<ItemManutencao[]>([]);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [f, setF] = useState({
    veiculoId: params.get('veiculoId') ?? '',
    tipo: (params.get('planoId') ? 'preventiva' : 'corretiva') as 'preventiva' | 'corretiva',
    descricao: '',
    abertura: hoje(),
    km: '',
    horimetro: '',
    oficina: 'externa' as 'interna' | 'externa',
    fornecedorId: '',
    observacoes: '',
    pararVeiculo: true,
    planoIds: params.get('planoId') ? [params.get('planoId')!] : ([] as string[]),
  });

  useEffect(() => {
    api<{ veiculos: Veiculo[] }>('/frota/veiculos')
      .then((r) => setVeiculos(r.veiculos.filter((v) => v.status !== 'inativo')))
      .catch((e) => setErro((e as Error).message));
  }, []);

  // Itens do plano do veículo escolhido, para incluir na OS preventiva.
  useEffect(() => {
    if (!f.veiculoId) return setPendencias([]);
    api<{ itens: ItemManutencao[] }>(`/frota/manutencao?veiculoId=${f.veiculoId}`)
      .then((r) => setPendencias(r.itens.sort((a, b) => (b.uso ?? -1) - (a.uso ?? -1))))
      .catch(() => setPendencias([]));
  }, [f.veiculoId]);

  const veiculo = veiculos?.find((v) => v.id === f.veiculoId);

  // Sugere a descrição a partir dos itens preventivos marcados.
  useEffect(() => {
    if (f.tipo !== 'preventiva' || !f.planoIds.length) return;
    const nomes = pendencias.filter((p) => f.planoIds.includes(p.planoId)).map((p) => p.item);
    if (nomes.length) setF((x) => (x.descricao && !x.descricao.startsWith('Revisão: ') ? x : { ...x, descricao: `Revisão: ${nomes.join(', ')}` }));
  }, [f.planoIds, f.tipo, pendencias]);

  function alternarPlano(id: string) {
    setF((x) => ({ ...x, planoIds: x.planoIds.includes(id) ? x.planoIds.filter((p) => p !== id) : [...x.planoIds, id] }));
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setOcupado(true);
    try {
      const r = await api<{ os: OS }>('/frota/os', {
        corpo: {
          ...f,
          km: f.km || null,
          horimetro: f.horimetro || null,
          fornecedorId: f.oficina === 'externa' && f.fornecedorId ? f.fornecedorId : null,
          planoIds: f.tipo === 'preventiva' ? f.planoIds : [],
        },
      });
      navegar(`/frota/os/${r.os.id}`, { replace: true, state: { aviso: `OS #${r.os.numero} aberta.` } });
    } catch (err) {
      setErro((err as Error).message);
      setOcupado(false);
    }
  }

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <Link to="/frota/os" className="small">← Ordens de serviço</Link>
          <h1>Abrir ordem de serviço</h1>
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}

      <form className="card form" onSubmit={salvar}>
        <div className="campos">
          <div className="campo">
            <label htmlFor="os-veiculo">Veículo</label>
            <select id="os-veiculo" value={f.veiculoId} onChange={(e) => setF({ ...f, veiculoId: e.target.value, planoIds: [] })} required>
              <option value="">{veiculos ? 'Escolha o veículo' : 'Carregando…'}</option>
              {(veiculos ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.codigo}
                  {v.placa ? ` · ${v.placa}` : ''}
                  {v.status === 'manutencao' ? ' (em manutenção)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="campo">
            <span className="rotulo" id="os-tipo">Tipo</span>
            <div className="segmentado" role="group" aria-labelledby="os-tipo">
              {(['corretiva', 'preventiva'] as const).map((t) => (
                <button key={t} type="button" aria-pressed={f.tipo === t} className={f.tipo === t ? 'ativo' : ''} onClick={() => setF({ ...f, tipo: t })}>
                  {t === 'corretiva' ? 'Corretiva' : 'Preventiva'}
                </button>
              ))}
            </div>
          </div>
          <div className="campo">
            <label htmlFor="os-abertura">Abertura</label>
            <input id="os-abertura" type="date" value={f.abertura} max={hoje()} onChange={(e) => setF({ ...f, abertura: e.target.value })} />
          </div>
          <div className="campo">
            <label htmlFor="os-km">Km no momento</label>
            <input id="os-km" className="mono" inputMode="numeric" placeholder={veiculo ? formatarNumero(veiculo.kmAtual) : ''} value={f.km} onChange={(e) => setF({ ...f, km: e.target.value })} />
          </div>
          {ehBomba(veiculo) && (
            <div className="campo">
              <label htmlFor="os-hor">Horímetro</label>
              <input id="os-hor" className="mono" inputMode="decimal" placeholder={veiculo ? formatarNumero(veiculo.horimetroAtual) : ''} value={f.horimetro} onChange={(e) => setF({ ...f, horimetro: e.target.value })} />
            </div>
          )}
          <div className="campo">
            <span className="rotulo" id="os-oficina">Oficina</span>
            <div className="segmentado" role="group" aria-labelledby="os-oficina">
              <button type="button" aria-pressed={f.oficina === 'externa'} className={f.oficina === 'externa' ? 'ativo' : ''} onClick={() => setF({ ...f, oficina: 'externa' })}>
                Externa
              </button>
              <button type="button" aria-pressed={f.oficina === 'interna'} className={f.oficina === 'interna' ? 'ativo' : ''} onClick={() => setF({ ...f, oficina: 'interna' })}>
                Própria
              </button>
            </div>
          </div>
          {f.oficina === 'externa' && (
            <div className="campo">
              <label htmlFor="os-forn">Oficina / fornecedor</label>
              <select id="os-forn" value={f.fornecedorId} onChange={(e) => setF({ ...f, fornecedorId: e.target.value })}>
                <option value="">Não informado</option>
                {oficinas.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nomeFantasia || o.razaoSocial}
                    {o.ramo ? ` · ${o.ramo}` : ''}
                  </option>
                ))}
              </select>
              <span className="small muted">
                Não está na lista? <Link to="/adm/fornecedores">Cadastre em Fornecedores</Link>.
              </span>
            </div>
          )}
        </div>

        {f.tipo === 'preventiva' && f.veiculoId && (
          <fieldset className="grupo-marcar">
            <legend>Itens do plano incluídos nesta OS</legend>
            {pendencias.length === 0 ? (
              <p className="small muted" style={{ margin: 0 }}>
                Nenhum item de plano para este veículo. <Link to="/frota/manutencao">Configure o plano de manutenção</Link>.
              </p>
            ) : (
              pendencias.map((p) => (
                <label key={p.planoId} className="marcar">
                  <input type="checkbox" checked={f.planoIds.includes(p.planoId)} onChange={() => alternarPlano(p.planoId)} />
                  <span>{p.item}</span>
                  {p.situacao === 'vencida' && <span className="selo selo-perigo">Vencida</span>}
                  {p.situacao === 'proxima' && <span className="selo selo-aviso">Próxima</span>}
                </label>
              ))
            )}
            <p className="small muted" style={{ margin: '6px 0 0' }}>Ao concluir a OS, a última execução desses itens é registrada automaticamente.</p>
          </fieldset>
        )}

        <div className="campo">
          <label htmlFor="os-desc">{f.tipo === 'corretiva' ? 'Defeito relatado' : 'Serviço a executar'}</label>
          <textarea id="os-desc" rows={3} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} required />
        </div>
        <div className="campo">
          <label htmlFor="os-obs">Observações</label>
          <input id="os-obs" value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} />
        </div>
        <label className="marcar">
          <input type="checkbox" checked={f.pararVeiculo} onChange={(e) => setF({ ...f, pararVeiculo: e.target.checked })} />
          <span>Colocar o veículo em manutenção (fica indisponível até a OS ser concluída)</span>
        </label>
        <div className="acoes">
          <button className="btn btn-primario" type="submit" disabled={ocupado}>
            {ocupado ? 'Abrindo…' : 'Abrir OS'}
          </button>
          <Link className="btn btn-secundario" to="/frota/os">
            Cancelar
          </Link>
        </div>
      </form>
    </>
  );
}

// ---------- Detalhe da OS ----------
const ITEM_VAZIO = { tipo: 'peca' as ItemOS['tipo'], descricao: '', quantidade: '1', valorUnitario: '' };

function DetalheOS({ id }: { id: string }) {
  const oficinas = useOficinas();
  const local = useLocation();
  const [os, setOs] = useState<OS | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState(() => ((local.state as { aviso?: string } | null)?.aviso ?? ''));
  const [ocupado, setOcupado] = useState(false);
  const [item, setItem] = useState(ITEM_VAZIO);
  const [concluir, setConcluir] = useState<{ conclusao: string; km: string; horimetro: string; liberarVeiculo: boolean } | null>(null);
  const [cancelar, setCancelar] = useState(false);
  const [editar, setEditar] = useState<{ descricao: string; oficina: 'interna' | 'externa'; fornecedorId: string; observacoes: string } | null>(null);

  const carregar = useCallback(async () => {
    try {
      setOs((await api<{ os: OS }>(`/frota/os/${id}`)).os);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  const aberta = os?.status === 'aberta' || os?.status === 'em_andamento';
  const subtotais = useMemo(() => {
    const s = { peca: 0, mao_de_obra: 0, servico: 0 };
    for (const i of os?.itens ?? []) s[i.tipo] += i.total;
    return s;
  }, [os]);

  async function executar(fn: () => Promise<{ os: OS }>, msg: string) {
    setErro('');
    setAviso('');
    setOcupado(true);
    try {
      setOs((await fn()).os);
      setAviso(msg);
      return true;
    } catch (err) {
      setErro((err as Error).message);
      return false;
    } finally {
      setOcupado(false);
    }
  }

  async function adicionarItem(e: FormEvent) {
    e.preventDefault();
    const ok = await executar(() => api(`/frota/os/${id}/itens`, { corpo: item }), `${NOMES_ITEM_OS[item.tipo]} adicionada.`);
    if (ok) setItem({ ...ITEM_VAZIO, tipo: item.tipo });
  }

  async function removerItem(i: ItemOS) {
    await executar(() => api(`/frota/os/itens/${i.id}`, { metodo: 'DELETE' }), `"${i.descricao}" removido.`);
  }

  async function mudarStatus(status: 'aberta' | 'em_andamento') {
    await executar(() => api(`/frota/os/${id}`, { metodo: 'PATCH', corpo: { status } }), status === 'em_andamento' ? 'Serviço marcado como em andamento.' : 'OS voltou para aberta.');
  }

  async function salvarEdicao(e: FormEvent) {
    e.preventDefault();
    if (!editar) return;
    const ok = await executar(
      () => api(`/frota/os/${id}`, { metodo: 'PATCH', corpo: { ...editar, fornecedorId: editar.oficina === 'externa' && editar.fornecedorId ? editar.fornecedorId : null } }),
      'Dados da OS atualizados.',
    );
    if (ok) setEditar(null);
  }

  async function confirmarConclusao(e: FormEvent) {
    e.preventDefault();
    if (!concluir) return;
    const ok = await executar(
      () => api(`/frota/os/${id}/concluir`, { corpo: { ...concluir, km: concluir.km || null, horimetro: concluir.horimetro || null } }),
      concluir.liberarVeiculo ? 'OS concluída e veículo liberado.' : 'OS concluída.',
    );
    if (ok) setConcluir(null);
  }

  async function confirmarCancelamento() {
    const ok = await executar(() => api(`/frota/os/${id}/cancelar`, { metodo: 'POST' }), 'OS cancelada. O veículo voltou à situação anterior.');
    if (ok) setCancelar(false);
  }

  if (!os) {
    return erro ? <div className="alerta alerta-erro" role="alert">{erro}</div> : <p className="muted">Carregando…</p>;
  }

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <Link to="/frota/os" className="small">← Ordens de serviço</Link>
          <h1>
            OS <span className="mono">#{os.numero}</span> · <Link to={`/frota/veiculos/${os.veiculoId}`} className="mono">{os.veiculoCodigo}</Link>
          </h1>
          <span className="muted">
            {os.tipo === 'preventiva' ? 'Preventiva' : 'Corretiva'} · {os.oficina === 'interna' ? 'oficina própria' : os.fornecedorNome ?? 'oficina externa'} · aberta em {formatarData(os.abertura)}
            {os.conclusao ? ` · concluída em ${formatarData(os.conclusao)}` : ''} · {os.dias ?? 0} {os.dias === 1 ? 'dia' : 'dias'}
          </span>
        </div>
        <span className={`selo ${CLASSE_STATUS_OS[os.status]}`}>{NOMES_STATUS_OS[os.status]}</span>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}

      {editar ? (
        <form className="card form" onSubmit={salvarEdicao}>
          <h2>Editar dados da OS</h2>
          <div className="campo">
            <label htmlFor="ed-desc">Serviço / defeito</label>
            <textarea id="ed-desc" rows={3} value={editar.descricao} onChange={(e) => setEditar({ ...editar, descricao: e.target.value })} />
          </div>
          <div className="campos">
            <div className="campo">
              <label htmlFor="ed-ofi">Oficina</label>
              <select id="ed-ofi" value={editar.oficina} onChange={(e) => setEditar({ ...editar, oficina: e.target.value as 'interna' | 'externa' })}>
                <option value="externa">Externa</option>
                <option value="interna">Própria</option>
              </select>
            </div>
            {editar.oficina === 'externa' && (
              <div className="campo">
                <label htmlFor="ed-forn">Oficina / fornecedor</label>
                <select id="ed-forn" value={editar.fornecedorId} onChange={(e) => setEditar({ ...editar, fornecedorId: e.target.value })}>
                  <option value="">Não informado</option>
                  {oficinas.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.nomeFantasia || o.razaoSocial}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="campo">
            <label htmlFor="ed-obs">Observações</label>
            <input id="ed-obs" value={editar.observacoes} onChange={(e) => setEditar({ ...editar, observacoes: e.target.value })} />
          </div>
          <div className="acoes">
            <button className="btn btn-primario" type="submit" disabled={ocupado}>Salvar</button>
            <button className="btn btn-secundario" type="button" onClick={() => setEditar(null)}>Cancelar</button>
          </div>
        </form>
      ) : (
        <div className="card">
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{os.descricao}</p>
          {os.observacoes && <p className="small muted" style={{ margin: '8px 0 0' }}>{os.observacoes}</p>}
          <p className="small muted" style={{ margin: '8px 0 0' }}>
            {os.km !== null && <>Km na abertura: <span className="mono">{formatarNumero(os.km)}</span></>}
            {os.horimetro !== null && os.horimetro > 0 && <> · Horímetro: <span className="mono">{formatarNumero(os.horimetro)}</span></>}
          </p>
          {aberta && (
            <div className="acoes" style={{ marginTop: 12 }}>
              <button
                className="btn btn-link"
                type="button"
                onClick={() => setEditar({ descricao: os.descricao, oficina: os.oficina, fornecedorId: os.fornecedorId ?? '', observacoes: os.observacoes ?? '' })}
              >
                Editar dados
              </button>
              {os.status === 'aberta' ? (
                <button className="btn btn-link" type="button" disabled={ocupado} onClick={() => mudarStatus('em_andamento')}>
                  Marcar como em andamento
                </button>
              ) : (
                <button className="btn btn-link" type="button" disabled={ocupado} onClick={() => mudarStatus('aberta')}>
                  Voltar para aberta
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="card tabela-caixa">
        <h2>Peças e serviços</h2>
        {os.itens.length === 0 ? (
          <p className="muted">Nenhum item lançado. Lance peças, mão de obra e serviços para formar o custo da OS.</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Descrição</th>
                <th style={{ textAlign: 'right' }}>Qtd.</th>
                <th style={{ textAlign: 'right' }}>Unitário</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                {aberta && <th><span style={{ position: 'absolute', left: -9999 }}>Ações</span></th>}
              </tr>
            </thead>
            <tbody>
              {os.itens.map((i) => (
                <tr key={i.id}>
                  <td className="small">{NOMES_ITEM_OS[i.tipo]}</td>
                  <td>
                    {i.descricao}
                    {i.planoItem && <div className="small muted">Plano: {i.planoItem}</div>}
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>{formatarNumero(i.quantidade, i.quantidade % 1 ? 2 : 0)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(i.valorUnitario)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(i.total)}</td>
                  {aberta && (
                    <td>
                      {!i.temNota && (
                        <button className="btn btn-link" type="button" disabled={ocupado} onClick={() => removerItem(i)}>
                          Remover
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="small muted">
                  Peças {formatarMoeda(subtotais.peca)} · Mão de obra {formatarMoeda(subtotais.mao_de_obra)} · Serviços {formatarMoeda(subtotais.servico)}
                </td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{formatarMoeda(os.total)}</td>
                {aberta && <td />}
              </tr>
            </tfoot>
          </table>
        )}

        {aberta && (
          <form className="form" onSubmit={adicionarItem} style={{ marginTop: 16 }}>
            <div className="campos linha-item">
              <div className="campo">
                <label htmlFor="it-tipo">Tipo</label>
                <select id="it-tipo" value={item.tipo} onChange={(e) => setItem({ ...item, tipo: e.target.value as ItemOS['tipo'] })}>
                  <option value="peca">Peça</option>
                  <option value="mao_de_obra">Mão de obra</option>
                  <option value="servico">Serviço</option>
                </select>
              </div>
              <div className="campo">
                <label htmlFor="it-desc">Descrição</label>
                <input id="it-desc" value={item.descricao} onChange={(e) => setItem({ ...item, descricao: e.target.value })} placeholder={item.tipo === 'peca' ? 'Ex.: filtro de óleo' : 'Ex.: troca do redutor'} />
              </div>
              <div className="campo">
                <label htmlFor="it-qtd">Quantidade</label>
                <input id="it-qtd" className="mono" inputMode="decimal" value={item.quantidade} onChange={(e) => setItem({ ...item, quantidade: e.target.value })} />
              </div>
              <div className="campo">
                <label htmlFor="it-valor">Valor unitário (R$)</label>
                <input id="it-valor" className="mono" inputMode="decimal" placeholder="0,00" value={item.valorUnitario} onChange={(e) => setItem({ ...item, valorUnitario: e.target.value })} />
              </div>
            </div>
            <div className="acoes">
              <button className="btn btn-secundario" type="submit" disabled={ocupado || !item.descricao.trim()}>
                Adicionar item
              </button>
              <span className="small muted">Ao lançar a nota da oficina em Notas fiscais, use “Vincular” no item para ligar esta OS. Assim o custo não conta duas vezes.</span>
            </div>
          </form>
        )}
      </div>

      {aberta && !concluir && !cancelar && (
        <div className="acoes">
          <button
            className="btn btn-primario"
            type="button"
            onClick={() => setConcluir({ conclusao: hoje(), km: '', horimetro: '', liberarVeiculo: true })}
          >
            Concluir OS
          </button>
          <button className="btn btn-secundario" type="button" onClick={() => setCancelar(true)}>
            Cancelar OS
          </button>
        </div>
      )}

      {concluir && (
        <form className="card form" onSubmit={confirmarConclusao}>
          <h2>Concluir OS #{os.numero}</h2>
          <div className="campos">
            <div className="campo">
              <label htmlFor="c-data">Data de conclusão</label>
              <input id="c-data" type="date" min={os.abertura} max={hoje()} value={concluir.conclusao} onChange={(e) => setConcluir({ ...concluir, conclusao: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="c-km">Km na saída</label>
              <input id="c-km" className="mono" inputMode="numeric" placeholder={os.km !== null ? formatarNumero(os.km) : ''} value={concluir.km} onChange={(e) => setConcluir({ ...concluir, km: e.target.value })} />
            </div>
            {os.horimetro !== null && os.horimetro > 0 && (
              <div className="campo">
                <label htmlFor="c-hor">Horímetro na saída</label>
                <input id="c-hor" className="mono" inputMode="decimal" placeholder={formatarNumero(os.horimetro)} value={concluir.horimetro} onChange={(e) => setConcluir({ ...concluir, horimetro: e.target.value })} />
              </div>
            )}
          </div>
          <label className="marcar">
            <input type="checkbox" checked={concluir.liberarVeiculo} onChange={(e) => setConcluir({ ...concluir, liberarVeiculo: e.target.checked })} />
            <span>Liberar o veículo para operação</span>
          </label>
          {os.itens.some((i) => i.planoId) && (
            <p className="small muted" style={{ margin: 0 }}>
              Os itens do plano ({os.itens.filter((i) => i.planoId).map((i) => i.planoItem).join(', ')}) terão a última execução registrada com esta data e leitura.
            </p>
          )}
          <div className="acoes">
            <button className="btn btn-primario" type="submit" disabled={ocupado}>Confirmar conclusão</button>
            <button className="btn btn-secundario" type="button" onClick={() => setConcluir(null)}>Voltar</button>
          </div>
        </form>
      )}

      {cancelar && (
        <div className="card">
          <h2>Cancelar OS #{os.numero}?</h2>
          <p className="muted">A OS fica no histórico como cancelada, os itens não entram no custo e o veículo volta para a situação que tinha antes.</p>
          <div className="acoes">
            <button className="btn btn-perigo" type="button" disabled={ocupado} onClick={confirmarCancelamento}>Cancelar a OS</button>
            <button className="btn btn-secundario" type="button" onClick={() => setCancelar(false)}>Voltar</button>
          </div>
        </div>
      )}
    </>
  );
}

export function OrdemServico() {
  const { id } = useParams();
  return !id || id === 'nova' ? <NovaOS /> : <DetalheOS key={id} id={id} />;
}
