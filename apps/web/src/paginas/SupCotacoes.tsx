import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, formatarData, formatarDocumento, formatarMoeda, hojeLocal, lerNumero, moedaCampo, somarDias } from '../api';
import { CabecalhoDocumento } from '../componentes/Documento';
import {
  Assinatura,
  campoNumero,
  EditorItens,
  itensParaApi,
  nomeFornecedor,
  novaLinha,
  numeroDoc,
  precoUn,
  qtd,
  Selo,
  SELO_COTACAO,
  SELO_PEDIDO,
  useCadastrosCompra,
  type Cotacao,
  type CotacaoResumo,
  type FornecedorCotacao,
  type LinhaEditor,
} from '../componentes/Suprimentos';
import { useSessao } from '../sessao';

const FILTROS = [
  { id: '', texto: 'Em andamento' },
  { id: 'concluida', texto: 'Concluídas' },
  { id: 'cancelada', texto: 'Canceladas' },
];

export function SupCotacoes() {
  const [params, setParams] = useSearchParams();
  const filtro = params.get('status') ?? '';
  const [lista, setLista] = useState<CotacaoResumo[] | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    setLista(null);
    api<{ cotacoes: CotacaoResumo[] }>(`/sup/cotacoes${filtro ? `?status=${filtro}` : ''}`)
      .then((r) => setLista(r.cotacoes))
      .catch((e) => setErro((e as Error).message));
  }, [filtro]);

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Cotações e mapa</h1>
          <span className="muted">Peça preço a vários fornecedores, compare no mapa e gere os pedidos de quem venceu.</span>
        </div>
        <Link className="btn btn-primario" to="/sup/cotacoes/nova">Nova cotação</Link>
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
          <p className="muted">Nenhuma cotação {filtro ? 'nesta situação' : 'em andamento'}. Comece por uma solicitação ou por "Nova cotação".</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr><th>Nº</th><th>Data</th><th>Itens</th><th>Respostas</th><th>Prazo</th><th>Situação</th></tr>
            </thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.id}>
                  <td className="mono"><Link to={`/sup/cotacoes/${c.id}`}>{numeroDoc(c.numero)}</Link></td>
                  <td>{formatarData(c.data)}</td>
                  <td>
                    {c.resumo}
                    {c.solicitacaoNumero && <div className="small muted">Solicitação {numeroDoc(c.solicitacaoNumero)}</div>}
                  </td>
                  <td className="mono">{c.respostas} de {c.fornecedores}</td>
                  <td>{c.prazoResposta ? formatarData(c.prazoResposta) : '—'}</td>
                  <td>
                    <Selo s={SELO_COTACAO[c.status]} />
                    {c.pedidos > 0 && <div className="small muted">{c.pedidos} {c.pedidos === 1 ? 'pedido' : 'pedidos'}</div>}
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

// ---------- Nova cotação avulsa (sem solicitação) ----------
export function NovaCotacao() {
  const navegar = useNavigate();
  const { insumos, fornecedores } = useCadastrosCompra();
  const [linhas, setLinhas] = useState<LinhaEditor[]>([novaLinha()]);
  const [sel, setSel] = useState<string[]>([]);
  const [prazo, setPrazo] = useState(somarDias(hojeLocal(), 3));
  const [obs, setObs] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    try {
      const itens = itensParaApi(linhas);
      if (!itens.length) throw new Error('Inclua pelo menos um item.');
      if (!sel.length) throw new Error('Escolha pelo menos um fornecedor.');
      setOcupado(true);
      const r = await api<{ cotacao: Cotacao }>('/sup/cotacoes', { corpo: { itens, fornecedorIds: sel, prazoResposta: prazo || null, observacao: obs || null } });
      navegar(`/sup/cotacoes/${r.cotacao.id}`, { replace: true });
    } catch (err) {
      setErro((err as Error).message);
      setOcupado(false);
    }
  }

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <Link to="/sup/cotacoes" className="small">← Cotações</Link>
          <h1>Nova cotação</h1>
          <span className="muted">Para cotar o que veio de uma solicitação, abra a solicitação e use "Cotar com fornecedores".</span>
        </div>
      </div>
      <form className="card form" onSubmit={salvar}>
        {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
        <h2>Itens</h2>
        <EditorItens linhas={linhas} aoMudar={setLinhas} insumos={insumos} />
        <h2>Fornecedores</h2>
        <div className="lista-marcar">
          {fornecedores.map((f) => (
            <label key={f.id} className="marcar">
              <input type="checkbox" checked={sel.includes(f.id)} onChange={(e) => setSel(e.target.checked ? [...sel, f.id].slice(0, 10) : sel.filter((x) => x !== f.id))} />
              <span>{nomeFornecedor(f)}{f.ramo ? <span className="small muted"> · {f.ramo}</span> : null}</span>
            </label>
          ))}
        </div>
        <div className="campos">
          <div className="campo">
            <label htmlFor="nc-prazo">Prazo para resposta</label>
            <input id="nc-prazo" type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
          </div>
          <div className="campo">
            <label htmlFor="nc-obs">Observação para os fornecedores</label>
            <input id="nc-obs" maxLength={500} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: entrega na usina, descarga por conta do fornecedor" />
          </div>
        </div>
        <div className="acoes">
          <button className="btn btn-primario" type="submit" disabled={ocupado}>Criar cotação</button>
        </div>
      </form>
    </>
  );
}

// ---------- Lançar a resposta de um fornecedor ----------
function FormResposta({ cotacao, f, aoSalvar, aoFechar }: { cotacao: Cotacao; f: FornecedorCotacao; aoSalvar: (c: Cotacao) => void; aoFechar: () => void }) {
  const [precos, setPrecos] = useState<Record<string, string>>(() =>
    Object.fromEntries(cotacao.itens.map((i) => [i.id, campoNumero(i.ofertas.find((o) => o.cotacaoFornecedorId === f.id)?.precoUnitario ?? null, 4)])),
  );
  const [d, setD] = useState({
    prazo: f.prazoEntregaDias === null ? '' : String(f.prazoEntregaDias),
    condicao: f.condicaoPagamento ?? '',
    frete: f.frete ? moedaCampo(f.frete) : '',
    validade: f.validade ?? '',
    observacao: f.observacao ?? '',
  });
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    try {
      const lista = cotacao.itens.map((i) => {
        const t = (precos[i.id] ?? '').trim();
        const v = t ? lerNumero(t) : null;
        if (t && (v === null || v < 0)) throw new Error(`${i.descricao}: preço inválido.`);
        return { itemId: i.id, precoUnitario: v };
      });
      setOcupado(true);
      const r = await api<{ cotacao: Cotacao }>(`/sup/cotacoes/${cotacao.id}/respostas/${f.id}`, {
        metodo: 'PUT',
        corpo: {
          prazoEntregaDias: d.prazo.trim() ? Math.round(Number(d.prazo)) : null,
          condicaoPagamento: d.condicao || null,
          frete: lerNumero(d.frete) ?? 0,
          validade: d.validade || null,
          observacao: d.observacao || null,
          precos: lista,
        },
      });
      aoSalvar(r.cotacao);
    } catch (err) {
      setErro((err as Error).message);
      setOcupado(false);
    }
  }

  return (
    <form className="card form nao-imprimir" onSubmit={salvar}>
      <h2>Preços de {f.nome}</h2>
      <span className="small muted">Preço por unidade de cada item. Deixe em branco o que o fornecedor não cotou.</span>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <table className="tabela">
        <thead>
          <tr><th>Item</th><th style={{ textAlign: 'right' }}>Quantidade</th><th>Preço unitário (R$)</th><th style={{ textAlign: 'right' }}>Total</th></tr>
        </thead>
        <tbody>
          {cotacao.itens.map((i) => {
            const v = lerNumero(precos[i.id] ?? '');
            return (
              <tr key={i.id}>
                <td>{i.descricao}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{qtd(i.quantidade, i.unidade)}</td>
                <td>
                  <input aria-label={`Preço de ${i.descricao}`} className="mono" inputMode="decimal" style={{ maxWidth: 140 }} value={precos[i.id] ?? ''} onChange={(e) => setPrecos({ ...precos, [i.id]: e.target.value })} />
                  <span className="small muted"> / {i.unidade === 'm3' ? 'm³' : i.unidade}</span>
                </td>
                <td className="mono" style={{ textAlign: 'right' }}>{v ? formatarMoeda(v * i.quantidade) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="campos">
        <div className="campo">
          <label htmlFor="r-prazo">Prazo de entrega (dias)</label>
          <input id="r-prazo" inputMode="numeric" value={d.prazo} onChange={(e) => setD({ ...d, prazo: e.target.value.replace(/\D/g, '') })} />
        </div>
        <div className="campo">
          <label htmlFor="r-cond">Condição de pagamento</label>
          <input id="r-cond" maxLength={120} value={d.condicao} onChange={(e) => setD({ ...d, condicao: e.target.value })} placeholder="Ex.: 28 dias boleto" />
        </div>
        <div className="campo">
          <label htmlFor="r-frete">Frete (R$)</label>
          <input id="r-frete" className="mono" inputMode="decimal" value={d.frete} onChange={(e) => setD({ ...d, frete: e.target.value })} placeholder="0,00 = CIF" />
        </div>
        <div className="campo">
          <label htmlFor="r-val">Validade da proposta</label>
          <input id="r-val" type="date" value={d.validade} onChange={(e) => setD({ ...d, validade: e.target.value })} />
        </div>
      </div>
      <div className="campo">
        <label htmlFor="r-obs">Observação</label>
        <input id="r-obs" maxLength={300} value={d.observacao} onChange={(e) => setD({ ...d, observacao: e.target.value })} />
      </div>
      <div className="acoes">
        <button className="btn btn-primario" type="submit" disabled={ocupado}>Salvar preços</button>
        <button className="btn btn-secundario" type="button" onClick={aoFechar}>Fechar</button>
      </div>
    </form>
  );
}

// ---------- Documento: pedido de cotação para o fornecedor ----------
function PedidoDeCotacao({ c, f, aoVoltar }: { c: Cotacao; f: FornecedorCotacao; aoVoltar: () => void }) {
  const { empresa, usuario } = useSessao();
  return (
    <>
      <div className="nao-imprimir acoes">
        <button className="btn btn-link" type="button" onClick={aoVoltar}>← Voltar ao mapa</button>
      </div>
      <CabecalhoDocumento
        modulo="Suprimentos"
        titulo={`Pedido de cotação nº ${numeroDoc(c.numero)}`}
        descricao={`Solicitamos proposta para os itens abaixo${c.prazoResposta ? `, com resposta até ${formatarData(c.prazoResposta)}` : ''}.`}
        filtros={[`Data: ${formatarData(c.data)}`]}
      />
      <div className="card doc-partes">
        <div>
          <span className="rotulo">Fornecedor</span>
          <strong>{f.razaoSocial}</strong>
          {f.documento && <span>CNPJ/CPF {formatarDocumento(f.documento)}</span>}
          {(f.telefone || f.email) && <span>{[f.telefone, f.email].filter(Boolean).join(' · ')}</span>}
          {f.cidade && <span>{f.cidade}</span>}
        </div>
        <div>
          <span className="rotulo">Comprador</span>
          <strong>{empresa?.razaoSocial}</strong>
          {empresa?.cnpj && <span>CNPJ {formatarDocumento(empresa.cnpj)}</span>}
          {(empresa?.telefone || empresa?.email) && <span>{[empresa?.telefone, empresa?.email].filter(Boolean).join(' · ')}</span>}
          <span>Contato: {usuario?.nome}</span>
        </div>
      </div>
      <div className="card tabela-caixa">
        <table className="tabela">
          <thead>
            <tr>
              <th>#</th><th>Item</th><th style={{ textAlign: 'right' }}>Quantidade</th><th style={{ width: '18%' }}>Preço unitário</th><th style={{ width: '18%' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {c.itens.map((i, n) => (
              <tr key={i.id}>
                <td className="mono">{n + 1}</td>
                <td>{i.descricao}</td>
                <td className="mono" style={{ textAlign: 'right' }}>{qtd(i.quantidade, i.unidade)}</td>
                <td className="campo-branco" />
                <td className="campo-branco" />
              </tr>
            ))}
          </tbody>
        </table>
        <div className="doc-condicoes">
          <span>Frete: ______________________</span>
          <span>Prazo de entrega: ______ dias</span>
          <span>Condição de pagamento: ______________________</span>
          <span>Validade da proposta: ____/____/______</span>
        </div>
        {c.observacao && <p className="small"><b>Observação:</b> {c.observacao}</p>}
      </div>
      <div className="assinaturas">
        <Assinatura nome={f.razaoSocial} papel="Fornecedor (carimbo e assinatura)" />
        <Assinatura nome={usuario?.nome ?? ''} papel={`Compras · ${empresa?.nomeFantasia || empresa?.razaoSocial || ''}`} />
      </div>
    </>
  );
}

// ---------- Detalhe: mapa de cotação ----------
export function CotacaoDetalhe() {
  const { id } = useParams();
  const navegar = useNavigate();
  const { fornecedores: todos } = useCadastrosCompra();
  const [c, setC] = useState<Cotacao | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [resposta, setResposta] = useState<string | null>(null);
  const [documento, setDocumento] = useState<string | null>(null);
  const [convidar, setConvidar] = useState<string[] | null>(null);
  const [escolhas, setEscolhas] = useState<Record<string, { vencedorId: string | null; justificativa: string }>>({});
  const [justGeral, setJustGeral] = useState('');

  const aplicar = useCallback((n: Cotacao) => {
    setC(n);
    setEscolhas(Object.fromEntries(n.itens.map((i) => [i.id, { vencedorId: i.vencedorId, justificativa: i.justificativa ?? '' }])));
    setJustGeral(n.justificativa ?? '');
  }, []);
  useEffect(() => {
    api<{ cotacao: Cotacao }>(`/sup/cotacoes/${id}`).then((r) => aplicar(r.cotacao)).catch((e) => setErro((e as Error).message));
  }, [id, aplicar]);

  async function executar(fn: () => Promise<{ cotacao: Cotacao }>, msg: string) {
    setErro('');
    setAviso('');
    setOcupado(true);
    try {
      aplicar((await fn()).cotacao);
      setAviso(msg);
    } catch (e) {
      setErro((e as Error).message);
    }
    setOcupado(false);
  }

  const alterado = useMemo(
    () => !!c && c.itens.some((i) => (escolhas[i.id]?.vencedorId ?? null) !== i.vencedorId || (escolhas[i.id]?.justificativa ?? '') !== (i.justificativa ?? '')) || (!!c && justGeral !== (c.justificativa ?? '')),
    [c, escolhas, justGeral],
  );

  if (!c) return erro ? <div className="alerta alerta-erro">{erro}</div> : <p className="muted">Carregando…</p>;
  const aberta = c.status === 'aberta';
  const doc = documento ? c.fornecedores.find((f) => f.id === documento) : null;
  if (doc) return <PedidoDeCotacao c={c} f={doc} aoVoltar={() => setDocumento(null)} />;
  const emResposta = resposta ? c.fornecedores.find((f) => f.id === resposta) : null;

  const salvarEscolhas = () =>
    executar(
      () =>
        api(`/sup/cotacoes/${c.id}/vencedores`, {
          metodo: 'PUT',
          corpo: { itens: c.itens.map((i) => ({ itemId: i.id, vencedorId: escolhas[i.id]?.vencedorId ?? null, justificativa: escolhas[i.id]?.justificativa || null })), justificativa: justGeral || null },
        }),
      'Escolha salva.',
    );

  async function concluir() {
    if (!c) return;
    setErro('');
    setOcupado(true);
    try {
      if (alterado)
        await api(`/sup/cotacoes/${c.id}/vencedores`, {
          metodo: 'PUT',
          corpo: { itens: c.itens.map((i) => ({ itemId: i.id, vencedorId: escolhas[i.id]?.vencedorId ?? null, justificativa: escolhas[i.id]?.justificativa || null })), justificativa: justGeral || null },
        });
      const r = await api<{ cotacao: Cotacao; pedidos: { id: string; numero: number }[] }>(`/sup/cotacoes/${c.id}/concluir`, { metodo: 'POST' });
      aplicar(r.cotacao);
      if (r.pedidos.length === 1) navegar(`/sup/pedidos/${r.pedidos[0].id}`, { state: { aviso: `Pedido nº ${numeroDoc(r.pedidos[0].numero)} gerado. Confira e envie para aprovação.` } });
      else setAviso(`${r.pedidos.length} pedidos gerados (um por fornecedor). Abra cada um, confira e envie para aprovação.`);
    } catch (e) {
      setErro((e as Error).message);
    }
    setOcupado(false);
  }

  const valorEscolha = (itemId: string) => {
    const i = c.itens.find((x) => x.id === itemId)!;
    const v = escolhas[itemId]?.vencedorId;
    return i.ofertas.find((o) => o.cotacaoFornecedorId === v) ?? null;
  };

  return (
    <>
      <div className="nao-imprimir">
        <Link to="/sup/cotacoes" className="small">← Cotações</Link>
      </div>
      <CabecalhoDocumento
        modulo="Suprimentos"
        titulo={`Mapa de cotação nº ${numeroDoc(c.numero)}`}
        descricao="Preços de cada fornecedor lado a lado. Em destaque, o menor preço de cada item; marcado, o fornecedor escolhido."
        filtros={[
          `Data: ${formatarData(c.data)}`,
          c.solicitacaoNumero ? `Solicitação ${numeroDoc(c.solicitacaoNumero)}` : '',
          c.prazoResposta ? `Resposta até ${formatarData(c.prazoResposta)}` : '',
          `Situação: ${SELO_COTACAO[c.status].texto}`,
        ]}
      />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}

      <div className="grade">
        <div className="card indicador">
          <span className="rotulo-ind">Total escolhido</span>
          <span className="valor-ind mono">{formatarMoeda(c.resumo.totalEscolhido)}</span>
          <span className="small muted">{c.resumo.itensComVencedor} de {c.resumo.itens} itens{c.resumo.freteEscolhido ? ` · frete ${formatarMoeda(c.resumo.freteEscolhido)}` : ''}</span>
        </div>
        <div className="card indicador">
          <span className="rotulo-ind">Economia sobre o maior preço</span>
          <span className="valor-ind mono">{formatarMoeda(c.resumo.economiaMaior)}</span>
          <span className="small muted">sobre a média: {formatarMoeda(c.resumo.economiaMedia)}</span>
        </div>
        <div className="card indicador">
          <span className="rotulo-ind">Fora do menor preço</span>
          <span className="valor-ind mono">{c.resumo.itensForaDoMenor}</span>
          <span className="small muted">{c.resumo.itensForaDoMenor ? 'itens com justificativa' : 'todos pelo menor preço'}</span>
        </div>
        <div className="card indicador">
          <span className="rotulo-ind">Tudo num fornecedor só</span>
          <span className="valor-ind mono">{c.resumo.melhorFornecedorCompleto ? formatarMoeda(c.resumo.melhorFornecedorCompleto.total) : '—'}</span>
          <span className="small muted">{c.resumo.melhorFornecedorCompleto?.nome ?? 'ninguém cotou todos os itens'}</span>
        </div>
      </div>

      {emResposta && <FormResposta cotacao={c} f={emResposta} aoFechar={() => setResposta(null)} aoSalvar={(n) => { aplicar(n); setResposta(null); setAviso(`Preços de ${emResposta.nome} salvos.`); }} />}

      <div className="card tabela-caixa">
        <div className="cartao-topo">
          <h2>Fornecedores</h2>
          {aberta && !convidar && (
            <button className="btn btn-link nao-imprimir" type="button" onClick={() => setConvidar(c.fornecedores.map((f) => f.fornecedorId))}>Incluir ou tirar fornecedores</button>
          )}
        </div>
        {convidar ? (
          <div className="form nao-imprimir">
            <div className="lista-marcar">
              {todos.map((f) => (
                <label key={f.id} className="marcar">
                  <input type="checkbox" checked={convidar.includes(f.id)} onChange={(e) => setConvidar(e.target.checked ? [...convidar, f.id].slice(0, 10) : convidar.filter((x) => x !== f.id))} />
                  <span>{nomeFornecedor(f)}</span>
                </label>
              ))}
            </div>
            <div className="acoes">
              <button className="btn btn-primario" type="button" disabled={ocupado} onClick={() => { executar(() => api(`/sup/cotacoes/${c.id}/fornecedores`, { metodo: 'PUT', corpo: { fornecedorIds: convidar } }), 'Fornecedores atualizados.'); setConvidar(null); }}>
                Salvar
              </button>
              <button className="btn btn-secundario" type="button" onClick={() => setConvidar(null)}>Voltar</button>
            </div>
          </div>
        ) : c.fornecedores.length === 0 ? (
          <p className="muted">Nenhum fornecedor convidado ainda.</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr><th>Fornecedor</th><th>Itens cotados</th><th>Prazo</th><th>Pagamento</th><th style={{ textAlign: 'right' }}>Frete</th><th style={{ textAlign: 'right' }}>Total cotado</th><th className="nao-imprimir"><span style={{ position: 'absolute', left: -9999 }}>Ações</span></th></tr>
            </thead>
            <tbody>
              {c.fornecedores.map((f) => (
                <tr key={f.id}>
                  <td>
                    {f.nome}
                    {f.validade && <div className="small muted">proposta válida até {formatarData(f.validade)}</div>}
                    {f.observacao && <div className="small muted">{f.observacao}</div>}
                  </td>
                  <td className={f.itensCotados === 0 ? 'tom-aviso' : ''}>{f.itensCotados === 0 ? 'sem resposta' : `${f.itensCotados} de ${c.itens.length}`}</td>
                  <td>{f.prazoEntregaDias === null ? '—' : `${f.prazoEntregaDias} ${f.prazoEntregaDias === 1 ? 'dia' : 'dias'}`}</td>
                  <td className="small">{f.condicaoPagamento ?? '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{f.frete ? formatarMoeda(f.frete) : 'CIF'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{f.itensCotados ? formatarMoeda(f.total) : '—'}</td>
                  <td className="nao-imprimir">
                    {aberta && <button className="btn btn-link" type="button" onClick={() => setResposta(f.id)}>Lançar preços</button>}
                    <button className="btn btn-link" type="button" onClick={() => setDocumento(f.id)}>Pedido de cotação</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card tabela-caixa">
        <h2>Mapa de preços</h2>
        {c.fornecedores.length === 0 ? (
          <p className="muted">Convide fornecedores e lance os preços para montar o mapa.</p>
        ) : (
          <table className="tabela tabela-compacta mapa-cotacao">
            <thead>
              <tr>
                <th>Item</th>
                <th style={{ textAlign: 'right' }}>Qtd.</th>
                {c.fornecedores.map((f) => <th key={f.id} style={{ textAlign: 'right' }}>{f.nome}</th>)}
                <th style={{ textAlign: 'right' }}>Escolhido</th>
                <th style={{ textAlign: 'right' }}>Economia*</th>
              </tr>
            </thead>
            <tbody>
              {c.itens.map((i) => {
                const esc = escolhas[i.id]?.vencedorId ?? null;
                const oferta = valorEscolha(i.id);
                const menor = i.ofertas.find((o) => o.cotacaoFornecedorId === i.menorPrecoId);
                const fora = !!oferta && !!menor && oferta.precoUnitario > menor.precoUnitario;
                const maior = i.ofertas.reduce((m, o) => Math.max(m, o.precoUnitario), 0);
                return (
                  <tr key={i.id}>
                    <td>
                      {i.descricao}
                      {fora && (
                        aberta ? (
                          <input
                            className="nao-imprimir"
                            aria-label={`Justificativa de ${i.descricao}`}
                            placeholder="Justificativa (obrigatória fora do menor preço)"
                            maxLength={300}
                            value={escolhas[i.id]?.justificativa ?? ''}
                            onChange={(e) => setEscolhas({ ...escolhas, [i.id]: { vencedorId: esc, justificativa: e.target.value } })}
                            style={{ display: 'block', width: '100%', marginTop: 4 }}
                          />
                        ) : null
                      )}
                      {fora && i.justificativa && <div className="small tom-aviso">Justificativa: {i.justificativa}</div>}
                    </td>
                    <td className="mono" style={{ textAlign: 'right' }}>{qtd(i.quantidade, i.unidade)}</td>
                    {c.fornecedores.map((f) => {
                      const o = i.ofertas.find((x) => x.cotacaoFornecedorId === f.id);
                      const ehMenor = i.menorPrecoId === f.id;
                      const ehEscolhido = esc === f.id;
                      return (
                        <td key={f.id} className={`mono celula-mapa ${ehMenor ? 'menor' : ''} ${ehEscolhido ? 'escolhido' : ''}`} style={{ textAlign: 'right' }}>
                          {o ? (
                            <label className="opcao-mapa">
                              {aberta && (
                                <input
                                  type="radio"
                                  className="nao-imprimir"
                                  name={`venc-${i.id}`}
                                  checked={ehEscolhido}
                                  onChange={() => setEscolhas({ ...escolhas, [i.id]: { vencedorId: f.id, justificativa: escolhas[i.id]?.justificativa ?? '' } })}
                                />
                              )}
                              <span>
                                {precoUn(o.precoUnitario)}
                                <span className="small muted" style={{ display: 'block' }}>{formatarMoeda(o.total)}</span>
                              </span>
                            </label>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="mono" style={{ textAlign: 'right' }}>{oferta ? formatarMoeda(oferta.total) : '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{oferta && i.ofertas.length > 1 ? formatarMoeda((maior - oferta.precoUnitario) * i.quantidade) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} className="forte">Total cotado (com frete)</td>
                {c.fornecedores.map((f) => (
                  <td key={f.id} className="mono forte" style={{ textAlign: 'right' }}>
                    {f.itensCotados ? formatarMoeda(f.total) : '—'}
                    {f.itensCotados > 0 && !f.completo && <span className="small muted" style={{ display: 'block' }}>parcial</span>}
                  </td>
                ))}
                <td className="mono forte" style={{ textAlign: 'right' }}>{formatarMoeda(c.resumo.totalEscolhido)}</td>
                <td className="mono forte" style={{ textAlign: 'right' }}>{formatarMoeda(c.resumo.economiaMaior)}</td>
              </tr>
            </tfoot>
          </table>
        )}
        <p className="small muted" style={{ marginBottom: 0 }}>* Economia: diferença entre o maior preço cotado e o escolhido, vezes a quantidade.</p>
        {aberta ? (
          <div className="campo nao-imprimir" style={{ marginTop: 12 }}>
            <label htmlFor="just-geral">Justificativa geral da escolha (opcional)</label>
            <textarea id="just-geral" rows={2} maxLength={1000} value={justGeral} onChange={(e) => setJustGeral(e.target.value)} />
          </div>
        ) : (
          c.justificativa && <p className="small"><b>Justificativa:</b> {c.justificativa}</p>
        )}
      </div>

      {aberta && (
        <div className="acoes nao-imprimir">
          <button className="btn btn-secundario" type="button" disabled={ocupado} onClick={() => executar(() => api(`/sup/cotacoes/${c.id}/vencedores`, { metodo: 'PUT', corpo: { menorPreco: true } }), 'Menor preço aplicado em todos os itens.')}>
            Aplicar menor preço
          </button>
          <button className="btn btn-secundario" type="button" disabled={ocupado || !alterado} onClick={salvarEscolhas}>Salvar escolha</button>
          <button className="btn btn-primario" type="button" disabled={ocupado} onClick={concluir}>Concluir e gerar pedidos</button>
          <button className="btn btn-link" type="button" disabled={ocupado} onClick={() => executar(() => api(`/sup/cotacoes/${c.id}/cancelar`, { metodo: 'POST' }), 'Cotação cancelada.')}>
            Cancelar cotação
          </button>
        </div>
      )}

      {c.pedidos.length > 0 && (
        <div className="card">
          <h2>Pedidos gerados</h2>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {c.pedidos.map((p) => (
              <li key={p.id}>
                <Link to={`/sup/pedidos/${p.id}`}>Pedido nº {numeroDoc(p.numero)}</Link> · {p.fornecedor} · <span className="mono">{formatarMoeda(p.total)}</span> <Selo s={SELO_PEDIDO[p.status]} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="so-imprimir assinaturas">
        <Assinatura nome={c.criadoPor ?? ''} papel="Comprador" />
        <Assinatura nome="" papel="Aprovação" />
      </div>
    </>
  );
}
