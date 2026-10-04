import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, formatarData, hojeLocal, somarDias } from '../api';
import { CabecalhoDocumento } from '../componentes/Documento';
import {
  Assinatura,
  campoNumero,
  EditorItens,
  itensParaApi,
  nomeFornecedor,
  novaLinha,
  numeroDoc,
  qtd,
  Selo,
  SELO_COTACAO,
  SELO_PEDIDO,
  SELO_SOLICITACAO,
  useCadastrosCompra,
  type LinhaEditor,
  type Solicitacao,
  type SolicitacaoResumo,
  type SugestaoEstoque,
} from '../componentes/Suprimentos';

const FILTROS = [
  { id: '', texto: 'Em andamento' },
  { id: 'atendida', texto: 'Atendidas' },
  { id: 'cancelada', texto: 'Canceladas' },
];

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
          <span className="muted">Quem precisa de material pede aqui. Depois a solicitação vira cotação ou pedido direto.</span>
        </div>
        <div className="acoes">
          <Link className="btn btn-secundario" to="/sup/solicitacoes/nova?estoque=1">Pelo estoque mínimo</Link>
          <Link className="btn btn-primario" to="/sup/solicitacoes/nova">Nova solicitação</Link>
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div className="segmentado tres-opcoes" role="group" aria-label="Situação" style={{ maxWidth: 480 }}>
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
                  <td>{formatarData(s.data)}</td>
                  <td>
                    {s.resumo}
                    {s.origem === 'estoque_minimo' && <div className="small muted">Gerada pelo estoque mínimo</div>}
                  </td>
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

// ---------- Formulário (nova e edição) ----------
function FormSolicitacao({ inicial, aoSalvar, aoCancelar }: { inicial?: Solicitacao; aoSalvar: (s: Solicitacao) => void; aoCancelar?: () => void }) {
  const [params] = useSearchParams();
  const doEstoque = !inicial && params.get('estoque') === '1';
  const { insumos, centros, catalogo } = useCadastrosCompra();
  const [f, setF] = useState({
    data: inicial?.data ?? hojeLocal(),
    necessidade: inicial?.necessidade ?? somarDias(hojeLocal(), 7),
    centroCustoId: inicial?.centroCustoId ?? '',
    observacao: inicial?.observacao ?? '',
  });
  const [linhas, setLinhas] = useState<LinhaEditor[]>(
    inicial?.itens.map((i) => novaLinha({ insumoId: i.insumoId ?? '', catalogoId: i.catalogoId ?? '', descricao: i.descricao, unidade: i.unidade, quantidade: campoNumero(i.quantidade), observacao: i.observacao ?? '' })) ?? [novaLinha()],
  );
  const [sugestao, setSugestao] = useState<SugestaoEstoque[] | null>(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!doEstoque) return;
    api<{ insumos: SugestaoEstoque[] }>('/sup/solicitacoes/estoque-minimo')
      .then((r) => {
        setSugestao(r.insumos);
        const comQtd = r.insumos.filter((i) => i.sugerido > 0);
        if (comQtd.length) setLinhas(comQtd.map((i) => novaLinha({ insumoId: i.insumoId, descricao: i.nome, unidade: i.unidade, quantidade: campoNumero(i.sugerido, 0) })));
      })
      .catch((e) => setErro((e as Error).message));
  }, [doEstoque]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    try {
      const itens = itensParaApi(linhas);
      if (!itens.length) throw new Error('Inclua pelo menos um item.');
      setOcupado(true);
      const corpo = { ...f, centroCustoId: f.centroCustoId || null, observacao: f.observacao || null, origem: doEstoque ? 'estoque_minimo' : 'manual', itens };
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
      {doEstoque && sugestao && (
        <div className="alerta alerta-info">
          {sugestao.length === 0 ? (
            'Nenhum insumo está abaixo do estoque mínimo agora. Você pode montar a solicitação à mão.'
          ) : (
            <>
              <b>{sugestao.length} {sugestao.length === 1 ? 'insumo abaixo' : 'insumos abaixo'} do mínimo.</b> A quantidade sugerida repõe até 2× o mínimo, descontando o que já está pedido ou solicitado.
              <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {sugestao.map((s) => (
                  <li key={s.insumoId}>
                    {s.nome}: saldo {qtd(s.saldo, s.unidade)}, mínimo {qtd(s.estoqueMinimo, s.unidade)}
                    {s.diasCobertura !== null ? `, dura ~${s.diasCobertura} dias` : ''}
                    {s.emPedido > 0 ? `, ${qtd(s.emPedido, s.unidade)} já pedido` : ''}
                    {s.emSolicitacao > 0 ? `, ${qtd(s.emSolicitacao, s.unidade)} já solicitado` : ''}
                    {s.sugerido === 0 ? ' (nada a pedir)' : ''}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <div className="campos">
        <div className="campo">
          <label htmlFor="sol-data">Data</label>
          <input id="sol-data" type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="sol-nec">Precisa até</label>
          <input id="sol-nec" type="date" value={f.necessidade ?? ''} onChange={(e) => setF({ ...f, necessidade: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="sol-cc">Centro de custo</label>
          <select id="sol-cc" value={f.centroCustoId} onChange={(e) => setF({ ...f, centroCustoId: e.target.value })}>
            <option value="">Não informado</option>
            {centros.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
      </div>
      <h2>Itens</h2>
      <EditorItens linhas={linhas} aoMudar={setLinhas} insumos={insumos} catalogo={catalogo} comObservacao />
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

  async function cancelar() {
    if (!s) return;
    setOcupado(true);
    try {
      setS((await api<{ solicitacao: Solicitacao }>(`/sup/solicitacoes/${s.id}/cancelar`, { metodo: 'POST' })).solicitacao);
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
  const andamento = s.status === 'aberta' || s.status === 'em_cotacao';

  return (
    <>
      <div className="nao-imprimir">
        <Link to="/sup/solicitacoes" className="small">← Solicitações</Link>
      </div>
      <CabecalhoDocumento
        modulo="Suprimentos"
        titulo={`Solicitação de compra nº ${numeroDoc(s.numero)}`}
        descricao={s.origem === 'estoque_minimo' ? 'Gerada a partir dos insumos abaixo do estoque mínimo.' : undefined}
        filtros={[`Data: ${formatarData(s.data)}`, s.necessidade ? `Precisa até: ${formatarData(s.necessidade)}` : '', s.centroCusto ? `Centro de custo: ${s.centroCusto}` : '', `Situação: ${SELO_SOLICITACAO[s.status].texto}`]}
      />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}

      {editar ? (
        <FormSolicitacao inicial={s} aoSalvar={(n) => { setS(n); setEditar(false); }} aoCancelar={() => setEditar(false)} />
      ) : (
        <>
          <div className="card tabela-caixa">
            <h2>Itens</h2>
            <table className="tabela">
              <thead>
                <tr><th>Item</th><th style={{ textAlign: 'right' }}>Quantidade</th><th>Observação</th></tr>
              </thead>
              <tbody>
                {s.itens.map((i) => (
                  <tr key={i.id}>
                    <td>{i.descricao}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{qtd(i.quantidade, i.unidade)}</td>
                    <td className="small">{i.observacao ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {s.observacao && <p className="small" style={{ marginBottom: 0 }}><b>Observação:</b> {s.observacao}</p>}
            <p className="small muted" style={{ marginBottom: 0 }}>Solicitado por {s.solicitante ?? '—'}.</p>
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

          {andamento && !cotar && (
            <div className="acoes nao-imprimir">
              {s.status === 'aberta' && (
                <button className="btn btn-primario" type="button" onClick={() => setCotar({ fornecedorIds: [], prazoResposta: somarDias(hojeLocal(), 3) })}>
                  Cotar com fornecedores
                </button>
              )}
              <Link className="btn btn-secundario" to={`/sup/pedidos/novo?solicitacao=${s.id}`}>Pedido direto (sem cotação)</Link>
              {s.status === 'aberta' && <button className="btn btn-link" type="button" onClick={() => setEditar(true)}>Editar</button>}
              <button className="btn btn-link" type="button" disabled={ocupado} onClick={cancelar}>Cancelar solicitação</button>
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
