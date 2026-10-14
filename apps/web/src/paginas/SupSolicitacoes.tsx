import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, formatarData, hojeLocal, somarDias } from '../api';
import { CabecalhoDocumento } from '../componentes/Documento';
import {
  Assinatura,
  nomeFornecedor,
  numeroDoc,
  qtd,
  Selo,
  SELO_COTACAO,
  SELO_PEDIDO,
  SELO_SOLICITACAO,
  unidadeTexto,
  useCadastrosCompra,
  type Solicitacao,
  type SolicitacaoResumo,
} from '../componentes/Suprimentos';

const FILTROS = [
  { id: '', texto: 'Em andamento' },
  { id: 'finalizada', texto: 'Finalizadas' },
  { id: 'atendida', texto: 'Atendidas' },
  { id: 'cancelada', texto: 'Canceladas' },
];

type ObraLista = { id: string; codigo: string; nome: string; ativo?: boolean };
/** Insumo da obra (necessidade de compra) já apropriado a um nó da EAP. */
type Necessidade = {
  id: string; codigo: string; descricao: string; unidade: string; eapNoId: string | null; eapCodigo: string | null; eapDescricao: string | null;
  quantidade: number; dataNecessaria: string | null; status: 'pendente' | 'solicitada' | 'comprada' | 'cancelada';
};

const ordenarEap = (a: { eapCodigo: string | null; descricao: string }, b: { eapCodigo: string | null; descricao: string }) =>
  (a.eapCodigo ?? '').localeCompare(b.eapCodigo ?? '', 'pt-BR', { numeric: true }) || a.descricao.localeCompare(b.descricao, 'pt-BR');

export function SupSolicitacoes() {
  const [params, setParams] = useSearchParams();
  const filtro = params.get('status') ?? '';
  const [lista, setLista] = useState<SolicitacaoResumo[] | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    setLista(null);
    api<{ solicitacoes: SolicitacaoResumo[] }>(`/sup/solicitacoes${filtro ? `?status=${filtro}` : ''}`)
      .then((r) => setLista(r.solicitacoes))
      .catch((e) => setErro((e as Error).message));
  }, [filtro]);

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Solicitações de compra</h1>
          <span className="muted">Cada solicitação é de uma obra e usa os insumos apropriados à EAP. Finalizada, ela vai para a cotação.</span>
        </div>
        <div className="acoes">
          <Link className="btn btn-primario" to="/sup/solicitacoes/nova">Nova solicitação</Link>
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div className="segmentado" role="group" aria-label="Situação" style={{ maxWidth: 640 }}>
        {FILTROS.map((f) => (
          <button key={f.id} type="button" aria-pressed={filtro === f.id} className={filtro === f.id ? 'ativo' : ''} onClick={() => setParams(f.id ? { status: f.id } : {}, { replace: true })}>
            {f.texto}
          </button>
        ))}
      </div>
      <div className="card tabela-caixa">
        {!lista ? (
          <p className="muted">Carregando…</p>
        ) : lista.length === 0 ? (
          <p className="muted">Nenhuma solicitação {filtro ? 'nesta situação' : 'em andamento'}.</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Obra</th>
                <th>Data</th>
                <th>Itens</th>
                <th>Precisa até</th>
                <th>Solicitante</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((s) => (
                <tr key={s.id}>
                  <td className="mono"><Link to={`/sup/solicitacoes/${s.id}`}>{numeroDoc(s.numero)}</Link></td>
                  <td className="small">{s.obra ? `${s.obra.codigo} · ${s.obra.nome}` : '—'}</td>
                  <td>{formatarData(s.data)}</td>
                  <td>{s.itens} {s.itens === 1 ? 'insumo' : 'insumos'}<div className="small muted">{s.resumo}</div></td>
                  <td className={s.urgente ? 'tom-perigo' : ''}>{s.necessidade ? formatarData(s.necessidade) : '—'}</td>
                  <td className="small">{s.solicitante ?? '—'}</td>
                  <td>
                    <Selo s={SELO_SOLICITACAO[s.status]} />
                    {s.diasAberta !== null && s.diasAberta > 0 && <div className="small muted">há {s.diasAberta} {s.diasAberta === 1 ? 'dia' : 'dias'}</div>}
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

// ---------- Formulário (nova e edição): obra e insumos apropriados ----------
function FormSolicitacao({ inicial, aoSalvar, aoCancelar }: { inicial?: Solicitacao; aoSalvar: (s: Solicitacao) => void; aoCancelar?: () => void }) {
  const [obras, setObras] = useState<ObraLista[]>([]);
  const [f, setF] = useState({
    obraId: inicial?.obraId ?? '',
    data: inicial?.data ?? hojeLocal(),
    necessidade: inicial?.necessidade ?? somarDias(hojeLocal(), 7),
    observacao: inicial?.observacao ?? '',
  });
  const [necessidades, setNecessidades] = useState<Necessidade[] | null>(null);
  const [marcadas, setMarcadas] = useState<Set<string>>(() => new Set(inicial?.itens.map((i) => i.necessidadeId).filter((x): x is string => !!x) ?? []));
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    api<{ obras: ObraLista[] }>('/eng/obras')
      .then((r) => setObras(r.obras.filter((o) => o.ativo !== false)))
      .catch((e) => setErro((e as Error).message));
  }, []);

  useEffect(() => {
    if (!f.obraId) {
      setNecessidades(null);
      return;
    }
    setNecessidades(null);
    api<{ necessidades: Necessidade[] }>(`/eng/obras/${f.obraId}/necessidades`)
      .then((r) => setNecessidades(r.necessidades))
      .catch((e) => setErro((e as Error).message));
  }, [f.obraId]);

  // Só entram insumos pendentes (ou os já desta solicitação), com apropriação à EAP.
  const disponiveis = useMemo(() => {
    const doAtual = new Set(inicial?.itens.map((i) => i.necessidadeId) ?? []);
    return (necessidades ?? []).filter((n) => (n.status === 'pendente' || doAtual.has(n.id)) && n.eapNoId).sort(ordenarEap);
  }, [necessidades, inicial]);
  const semEap = (necessidades ?? []).filter((n) => n.status === 'pendente' && !n.eapNoId).length;

  function alternar(id: string) {
    setMarcadas((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    if (!f.obraId) return setErro('Escolha a obra.');
    if (marcadas.size === 0) return setErro('Marque pelo menos um insumo da obra.');
    setOcupado(true);
    try {
      const corpo = {
        obraId: f.obraId,
        data: f.data,
        necessidade: f.necessidade || null,
        observacao: f.observacao || null,
        itens: [...marcadas].map((necessidadeId) => ({ necessidadeId, observacao: null })),
      };
      const r = inicial
        ? await api<{ solicitacao: Solicitacao }>(`/sup/solicitacoes/${inicial.id}`, { metodo: 'PUT', corpo })
        : await api<{ solicitacao: Solicitacao }>('/sup/solicitacoes', { corpo });
      aoSalvar(r.solicitacao);
    } catch (err) {
      setErro((err as Error).message);
      setOcupado(false);
    }
  }

  return (
    <form className="card form" onSubmit={salvar}>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div className="campos">
        <div className="campo">
          <label htmlFor="sol-obra">Obra</label>
          <select id="sol-obra" value={f.obraId} onChange={(e) => { setF({ ...f, obraId: e.target.value }); setMarcadas(new Set()); }}>
            <option value="">Escolha a obra</option>
            {obras.map((o) => <option key={o.id} value={o.id}>{o.codigo} · {o.nome}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="sol-data">Data</label>
          <input id="sol-data" type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="sol-nec">Precisa até</label>
          <input id="sol-nec" type="date" value={f.necessidade ?? ''} onChange={(e) => setF({ ...f, necessidade: e.target.value })} />
        </div>
      </div>

      <h2>Insumos da obra</h2>
      {!f.obraId && <p className="muted small">Escolha a obra para ver os insumos cadastrados nela.</p>}
      {f.obraId && necessidades === null && <p className="muted small">Carregando insumos…</p>}
      {f.obraId && necessidades !== null && disponiveis.length === 0 && (
        <div className="alerta alerta-info">
          Não há insumos pendentes apropriados à EAP nesta obra. Cadastre a necessidade em Engenharia › Obras (apropriação) e volte aqui.
        </div>
      )}
      {semEap > 0 && <p className="small tom-perigo">{semEap} insumo(s) desta obra ainda não estão apropriados a um nó da EAP e não podem ser comprados.</p>}
      {disponiveis.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table className="tabela">
            <thead>
              <tr>
                <th style={{ width: 40 }} />
                <th>EAP</th>
                <th>Insumo</th>
                <th>Un.</th>
                <th className="num">Quantidade</th>
                <th>Precisa até</th>
              </tr>
            </thead>
            <tbody>
              {disponiveis.map((n) => (
                <tr key={n.id}>
                  <td>
                    <input type="checkbox" aria-label={`Incluir ${n.descricao}`} checked={marcadas.has(n.id)} onChange={() => alternar(n.id)} />
                  </td>
                  <td className="mono small">{n.eapCodigo} <span className="muted">{n.eapDescricao}</span></td>
                  <td>{n.descricao}<div className="small muted mono">{n.codigo}</div></td>
                  <td>{unidadeTexto(n.unidade)}</td>
                  <td className="num">{qtd(n.quantidade)}</td>
                  <td className="small">{n.dataNecessaria ? formatarData(n.dataNecessaria) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">{marcadas.size} {marcadas.size === 1 ? 'insumo marcado' : 'insumos marcados'}.</p>
        </div>
      )}

      <div className="campo">
        <label htmlFor="sol-obs">Observação</label>
        <textarea id="sol-obs" rows={2} maxLength={500} value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} placeholder="Onde será usado, marca preferida, urgência…" />
      </div>
      <div className="acoes">
        <button className="btn btn-primario" type="submit" disabled={ocupado}>{ocupado ? 'Salvando…' : inicial ? 'Salvar alterações' : 'Registrar solicitação'}</button>
        {aoCancelar && <button className="btn btn-secundario" type="button" onClick={aoCancelar}>Cancelar</button>}
      </div>
    </form>
  );
}

export function NovaSolicitacao() {
  const navegar = useNavigate();
  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <Link to="/sup/solicitacoes" className="small">← Solicitações</Link>
          <h1>Nova solicitação de compra</h1>
        </div>
      </div>
      <FormSolicitacao aoSalvar={(s) => navegar(`/sup/solicitacoes/${s.id}`, { replace: true })} />
    </>
  );
}

// ---------- Detalhe ----------
export function SolicitacaoDetalhe() {
  const { id } = useParams();
  const navegar = useNavigate();
  const { fornecedores } = useCadastrosCompra();
  const [s, setS] = useState<Solicitacao | null>(null);
  const [erro, setErro] = useState('');
  const [editar, setEditar] = useState(false);
  const [cotar, setCotar] = useState<{ fornecedorIds: string[]; prazoResposta: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(() => {
    api<{ solicitacao: Solicitacao }>(`/sup/solicitacoes/${id}`).then((r) => setS(r.solicitacao)).catch((e) => setErro((e as Error).message));
  }, [id]);
  useEffect(carregar, [carregar]);

  async function acao(caminho: 'finalizar' | 'reabrir' | 'cancelar', pergunta?: string) {
    if (!s) return;
    if (pergunta && !window.confirm(pergunta)) return;
    setErro('');
    setOcupado(true);
    try {
      setS((await api<{ solicitacao: Solicitacao }>(`/sup/solicitacoes/${s.id}/${caminho}`, { metodo: 'POST' })).solicitacao);
    } catch (e) {
      setErro((e as Error).message);
    }
    setOcupado(false);
  }

  async function criarCotacao(e: FormEvent) {
    e.preventDefault();
    if (!s || !cotar) return;
    setErro('');
    if (cotar.fornecedorIds.length === 0) return setErro('Escolha pelo menos um fornecedor.');
    setOcupado(true);
    try {
      const r = await api<{ cotacao: { id: string } }>('/sup/cotacoes', { corpo: { solicitacaoId: s.id, prazoResposta: cotar.prazoResposta || null, fornecedorIds: cotar.fornecedorIds } });
      navegar(`/sup/cotacoes/${r.cotacao.id}`);
    } catch (err) {
      setErro((err as Error).message);
      setOcupado(false);
    }
  }

  if (!s) return erro ? <div className="alerta alerta-erro">{erro}</div> : <p className="muted">Carregando…</p>;
  const emAberto = s.status === 'aberta' || s.status === 'finalizada' || s.status === 'em_cotacao';

  return (
    <>
      <div className="nao-imprimir">
        <Link to="/sup/solicitacoes" className="small">← Solicitações</Link>
      </div>
      <CabecalhoDocumento
        modulo="Suprimentos"
        titulo={`Solicitação de compra nº ${numeroDoc(s.numero)}`}
        descricao={s.obra ? `Obra ${s.obra.codigo} · ${s.obra.nome}` : undefined}
        filtros={[`Data: ${formatarData(s.data)}`, s.necessidade ? `Precisa até: ${formatarData(s.necessidade)}` : '', `Situação: ${SELO_SOLICITACAO[s.status].texto}`]}
      />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}

      {editar ? (
        <FormSolicitacao inicial={s} aoSalvar={(n) => { setS(n); setEditar(false); }} aoCancelar={() => setEditar(false)} />
      ) : (
        <>
          <div className="card tabela-caixa">
            <h2>Insumos</h2>
            <table className="tabela">
              <thead>
                <tr><th>EAP</th><th>Insumo</th><th className="num">Quantidade</th></tr>
              </thead>
              <tbody>
                {s.itens.map((i) => (
                  <tr key={i.id}>
                    <td className="mono small">{i.eapCodigo} <span className="muted">{i.eapDescricao}</span></td>
                    <td>{i.descricao}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{qtd(i.quantidade, i.unidade)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {s.observacao && <p className="small" style={{ marginBottom: 0 }}><b>Observação:</b> {s.observacao}</p>}
            <p className="small muted" style={{ marginBottom: 0 }}>Solicitado por {s.solicitante ?? '—'}{s.finalizadaEm ? ` · finalizada em ${formatarData(s.finalizadaEm.slice(0, 10))}` : ''}.</p>
          </div>

          {(s.cotacoes.length > 0 || s.pedidos.length > 0) && (
            <div className="card">
              <h2>Andamento</h2>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {s.cotacoes.map((c) => (
                  <li key={c.id}>
                    <Link to={`/sup/cotacoes/${c.id}`}>Cotação nº {numeroDoc(c.numero)}</Link> <Selo s={SELO_COTACAO[c.status]} />
                  </li>
                ))}
                {s.pedidos.map((p) => (
                  <li key={p.id}>
                    <Link to={`/sup/pedidos/${p.id}`}>Pedido de compra nº {numeroDoc(p.numero)}</Link> <Selo s={SELO_PEDIDO[p.status]} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {emAberto && !cotar && (
            <div className="acoes nao-imprimir">
              {s.status === 'aberta' && (
                <>
                  <button className="btn btn-primario" type="button" disabled={ocupado} onClick={() => acao('finalizar')}>Finalizar solicitação</button>
                  <button className="btn btn-link" type="button" onClick={() => setEditar(true)}>Editar</button>
                </>
              )}
              {s.status === 'finalizada' && (
                <>
                  <button className="btn btn-primario" type="button" onClick={() => setCotar({ fornecedorIds: [], prazoResposta: somarDias(hojeLocal(), 3) })}>Cotar com fornecedores</button>
                  <button className="btn btn-link" type="button" disabled={ocupado} onClick={() => acao('reabrir')}>Reabrir para editar</button>
                </>
              )}
              <button className="btn btn-link" type="button" disabled={ocupado} onClick={() => acao('cancelar', 'Cancelar esta solicitação? Os insumos voltam a ficar pendentes na obra.')}>
                Cancelar solicitação
              </button>
            </div>
          )}

          {cotar && (
            <form className="card form nao-imprimir" onSubmit={criarCotacao}>
              <h2>Cotar com fornecedores</h2>
              <span className="small muted">Escolha até 10 fornecedores. Depois você lança o preço de cada um e o sistema monta o mapa.</span>
              <div className="lista-marcar">
                {fornecedores.map((f) => (
                  <label key={f.id} className="marcar">
                    <input
                      type="checkbox"
                      checked={cotar.fornecedorIds.includes(f.id)}
                      onChange={(e) => setCotar({ ...cotar, fornecedorIds: e.target.checked ? [...cotar.fornecedorIds, f.id].slice(0, 10) : cotar.fornecedorIds.filter((x) => x !== f.id) })}
                    />
                    <span>{nomeFornecedor(f)}{f.ramo ? <span className="small muted"> · {f.ramo}</span> : null}</span>
                  </label>
                ))}
              </div>
              <div className="campos">
                <div className="campo">
                  <label htmlFor="cot-prazo">Prazo para resposta</label>
                  <input id="cot-prazo" type="date" value={cotar.prazoResposta} onChange={(e) => setCotar({ ...cotar, prazoResposta: e.target.value })} />
                </div>
              </div>
              <div className="acoes">
                <button className="btn btn-primario" type="submit" disabled={ocupado}>Criar cotação</button>
                <button className="btn btn-secundario" type="button" onClick={() => setCotar(null)}>Voltar</button>
              </div>
            </form>
          )}

          <div className="so-imprimir assinaturas">
            <Assinatura nome={s.solicitante ?? ''} papel="Solicitante" />
            <Assinatura nome="" papel="Aprovação / Compras" />
          </div>
        </>
      )}
    </>
  );
}
