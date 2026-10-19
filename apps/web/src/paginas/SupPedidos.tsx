import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { api, formatarData, formatarDataHora, formatarDocumento, formatarMoeda, hojeLocal, lerNumero, moedaCampo, NOMES_MODELO, type ModeloNota } from '../api';
import { CabecalhoDocumento } from '../componentes/Documento';
import {
  Assinatura,
  campoNumero,
  nomeFornecedor,
  numeroDoc,
  pct,
  precoUn,
  qtd,
  Selo,
  SELO_PEDIDO,
  useCadastrosCompra,
  type Pedido,
  type PedidoResumo,
} from '../componentes/Suprimentos';
import { useSessao } from '../sessao';

const FILTROS = [
  { id: '', texto: 'Recentes' },
  { id: 'aprovacao', texto: 'Para aprovar' },
  { id: 'receber', texto: 'A receber' },
  { id: 'atrasados', texto: 'Atrasados' },
  { id: 'concluidos', texto: 'Concluídos' },
  { id: 'cancelados', texto: 'Cancelados' },
];

export function SupPedidos() {
  const [params, setParams] = useSearchParams();
  const filtro = params.get('status') ?? '';
  const [lista, setLista] = useState<PedidoResumo[] | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    setLista(null);
    api<{ pedidos: PedidoResumo[] }>(`/sup/pedidos${filtro ? `?status=${filtro}` : ''}`)
      .then((r) => setLista(r.pedidos))
      .catch((e) => setErro((e as Error).message));
  }, [filtro]);
  const total = (lista ?? []).reduce((s, p) => s + p.total, 0);

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Pedidos de compra</h1>
          <span className="muted">Do rascunho à entrega: aprovação, envio ao fornecedor e recebimento conferido pela nota fiscal.</span>
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div className="abas" role="tablist">
        {FILTROS.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={filtro === f.id} className={filtro === f.id ? 'ativa' : ''} onClick={() => setParams(f.id ? { status: f.id } : {}, { replace: true })}>
            {f.texto}
          </button>
        ))}
      </div>
      <div className="card tabela-caixa">
        {!lista ? (
          <p className="muted">Carregando…</p>
        ) : lista.length === 0 ? (
          <p className="muted">Nenhum pedido aqui.</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr><th>Nº</th><th>Data</th><th>Fornecedor</th><th>Itens</th><th>Entrega</th><th style={{ textAlign: 'right' }}>Total</th><th>Situação</th></tr>
            </thead>
            <tbody>
              {lista.map((p) => (
                <tr key={p.id}>
                  <td className="mono"><Link to={`/sup/pedidos/${p.id}`}>{numeroDoc(p.numero)}</Link></td>
                  <td>{formatarData(p.data)}</td>
                  <td>{p.fornecedor}</td>
                  <td className="small">
                    {p.resumo}
                    {p.cotacaoNumero && <div className="muted">Cotação {numeroDoc(p.cotacaoNumero)}</div>}
                  </td>
                  <td className={p.atrasado ? 'tom-perigo' : ''}>
                    {p.previsaoEntrega ? formatarData(p.previsaoEntrega) : '—'}
                    {p.atrasado && <div className="small">{p.diasAtraso} {p.diasAtraso === 1 ? 'dia' : 'dias'} de atraso</div>}
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(p.total)}</td>
                  <td>
                    <Selo s={SELO_PEDIDO[p.status]} />
                    {p.notas > 0 && <div className="small muted">{p.notas} {p.notas === 1 ? 'nota' : 'notas'}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={5} className="forte">{lista.length} pedidos</td><td className="mono forte" style={{ textAlign: 'right' }}>{formatarMoeda(total)}</td><td /></tr>
            </tfoot>
          </table>
        )}
      </div>
    </>
  );
}

// ---------- Edição do cabeçalho (os itens vêm da cotação e não são alterados aqui) ----------
type DadosForm = { fornecedorId: string; data: string; previsaoEntrega: string; condicaoPagamento: string; localEntrega: string; frete: string; centroCustoId: string; observacao: string };

function FormPedido({ inicial, aoSalvar, aoCancelar }: { inicial: Pedido; aoSalvar: (p: Pedido) => void; aoCancelar?: () => void }) {
  const { fornecedores, centros } = useCadastrosCompra();
  const [f, setF] = useState<DadosForm>({
    fornecedorId: inicial.fornecedorId ?? '',
    data: inicial.data ?? hojeLocal(),
    previsaoEntrega: inicial.previsaoEntrega ?? '',
    condicaoPagamento: inicial.condicaoPagamento ?? '',
    localEntrega: inicial.localEntrega ?? '',
    frete: inicial.frete ? moedaCampo(inicial.frete) : '',
    centroCustoId: inicial.centroCustoId ?? '',
    observacao: inicial.observacao ?? '',
  });
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    try {
      if (!f.fornecedorId) throw new Error('Escolha o fornecedor.');
      setOcupado(true);
      const corpo = {
        ...f,
        previsaoEntrega: f.previsaoEntrega || null,
        condicaoPagamento: f.condicaoPagamento || null,
        localEntrega: f.localEntrega || null,
        frete: lerNumero(f.frete) ?? 0,
        centroCustoId: f.centroCustoId || null,
        observacao: f.observacao || null,
        solicitacaoId: inicial.solicitacaoId,
      };
      const r = await api<{ pedido: Pedido }>(`/sup/pedidos/${inicial.id}`, { metodo: 'PUT', corpo });
      aoSalvar(r.pedido);
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
          <label htmlFor="pd-forn">Fornecedor</label>
          <select id="pd-forn" value={f.fornecedorId} onChange={(e) => setF({ ...f, fornecedorId: e.target.value })} required>
            <option value="">Escolha o fornecedor</option>
            {fornecedores.map((x) => <option key={x.id} value={x.id}>{nomeFornecedor(x)}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="pd-data">Data do pedido</label>
          <input id="pd-data" type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="pd-prev">Previsão de entrega</label>
          <input id="pd-prev" type="date" value={f.previsaoEntrega} onChange={(e) => setF({ ...f, previsaoEntrega: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="pd-cc">Centro de custo</label>
          <select id="pd-cc" value={f.centroCustoId} onChange={(e) => setF({ ...f, centroCustoId: e.target.value })}>
            <option value="">Não informado</option>
            {centros.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
      </div>
      <h2>Itens da cotação</h2>
      <p className="small muted">Os itens e preços vêm da cotação vencedora. Para mudar um item, refaça a cotação.</p>
      <ItensPedidoTabela itens={inicial.itens} />
      <div className="campos">
        <div className="campo">
          <label htmlFor="pd-frete">Frete (R$)</label>
          <input id="pd-frete" className="mono" inputMode="decimal" value={f.frete} onChange={(e) => setF({ ...f, frete: e.target.value })} placeholder="0,00 = CIF" />
        </div>
        <div className="campo">
          <label htmlFor="pd-cond">Condição de pagamento</label>
          <input id="pd-cond" maxLength={120} value={f.condicaoPagamento} onChange={(e) => setF({ ...f, condicaoPagamento: e.target.value })} placeholder="Ex.: 28 dias boleto" />
        </div>
        <div className="campo">
          <label htmlFor="pd-local">Local de entrega</label>
          <input id="pd-local" maxLength={200} value={f.localEntrega} onChange={(e) => setF({ ...f, localEntrega: e.target.value })} placeholder="Ex.: usina, silo 2" />
        </div>
      </div>
      <div className="campo">
        <label htmlFor="pd-obs">Observação para o fornecedor</label>
        <textarea id="pd-obs" rows={2} maxLength={1000} value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} />
      </div>
      <div className="acoes">
        <button className="btn btn-primario" type="submit" disabled={ocupado}>{ocupado ? 'Salvando…' : 'Salvar alterações'}</button>
        {aoCancelar && <button className="btn btn-secundario" type="button" onClick={aoCancelar}>Cancelar</button>}
      </div>
    </form>
  );
}

/** Itens do pedido com a EAP de cada insumo (a base do custo real da obra). */
export function ItensPedidoTabela({ itens }: { itens: Pedido['itens'] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="tabela">
        <thead>
          <tr>
            <th>EAP</th>
            <th>Insumo</th>
            <th className="num">Quantidade</th>
            <th className="num">Preço unit.</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((i) => (
            <tr key={i.id}>
              <td className="mono small">{i.eapCodigo ?? '—'} <span className="muted">{i.eapDescricao ?? ''}</span></td>
              <td>{i.descricao}</td>
              <td className="num">{qtd(i.quantidade, i.unidade)}</td>
              <td className="num">{precoUn(i.precoUnitario)}</td>
              <td className="num">{formatarMoeda(i.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Recebimento pela nota ----------
type NotaCandidata = {
  id: string; numero: string | null; serie: string | null; modelo: ModeloNota; dataEmissao: string; total: number; status: string; ligada: boolean;
  itens: { id: string; numeroItem: number; descricao: string; unidade: string | null; quantidade: number; valor: number; pedidoItemId: string | null; quantidadePedido: number | null }[];
};

function Recebimento({ pedido, aoSalvar, aoFechar }: { pedido: Pedido; aoSalvar: (p: Pedido) => void; aoFechar: () => void }) {
  const [notas, setNotas] = useState<NotaCandidata[] | null>(null);
  const [notaId, setNotaId] = useState('');
  const [mapa, setMapa] = useState<Record<string, { pedidoItemId: string; quantidade: string }>>({});
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    api<{ notas: NotaCandidata[] }>(`/sup/pedidos/${pedido.id}/notas-candidatas`)
      .then((r) => {
        setNotas(r.notas);
        const primeira = r.notas.find((n) => !n.ligada) ?? r.notas[0];
        if (primeira) escolher(primeira);
      })
      .catch((e) => setErro((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido.id]);

  function escolher(n: NotaCandidata) {
    setNotaId(n.id);
    setMapa(Object.fromEntries(n.itens.map((i) => [i.id, { pedidoItemId: i.pedidoItemId ?? '', quantidade: campoNumero(i.quantidadePedido) }])));
  }

  const nota = notas?.find((n) => n.id === notaId);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!nota) return;
    setErro('');
    try {
      const itens = nota.itens.map((i) => {
        const m = mapa[i.id];
        const q = m?.pedidoItemId ? lerNumero(m.quantidade) : null;
        if (m?.pedidoItemId && (!q || q <= 0)) throw new Error(`Item ${i.numeroItem} da nota: informe a quantidade recebida na unidade do pedido.`);
        return { notaItemId: i.id, pedidoItemId: m?.pedidoItemId || null, quantidade: q };
      });
      setOcupado(true);
      const r = await api<{ pedido: Pedido }>(`/sup/pedidos/${pedido.id}/recebimento`, { metodo: 'PUT', corpo: { notaId: nota.id, itens } });
      aoSalvar(r.pedido);
    } catch (err) {
      setErro((err as Error).message);
      setOcupado(false);
    }
  }

  return (
    <form className="card form nao-imprimir" onSubmit={salvar}>
      <h2>Receber com nota fiscal</h2>
      <span className="small muted">
        A nota é a que você importou ou lançou em Financeiro › Notas fiscais (ela gera a conta a pagar). Aqui ela é ligada ao pedido, item a item, para conferir quantidade e preço.
      </span>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {!notas ? (
        <p className="muted">Procurando notas de {pedido.fornecedor.nome}…</p>
      ) : notas.length === 0 ? (
        <div className="alerta alerta-info">
          Nenhuma nota de {pedido.fornecedor.nome} desde {formatarData(pedido.data)}. Importe o XML em <Link to="/fin/notas">Notas fiscais</Link> e volte aqui.
        </div>
      ) : (
        <>
          <div className="campo">
            <label htmlFor="rc-nota">Nota fiscal</label>
            <select id="rc-nota" value={notaId} onChange={(e) => escolher(notas.find((n) => n.id === e.target.value)!)}>
              {notas.map((n) => (
                <option key={n.id} value={n.id}>
                  {NOMES_MODELO[n.modelo] ?? 'Nota'} {n.numero ?? 's/n'} · {formatarData(n.dataEmissao)} · {formatarMoeda(n.total)}
                  {n.status !== 'confirmada' ? ' · ainda não conferida' : ''}
                  {n.ligada ? ' · já ligada a este pedido' : ''}
                </option>
              ))}
            </select>
          </div>
          {nota && (
            <table className="tabela tabela-compacta">
              <thead>
                <tr><th>Item da nota</th><th style={{ textAlign: 'right' }}>Qtd. na nota</th><th style={{ textAlign: 'right' }}>Valor</th><th>Item do pedido</th><th>Qtd. na unidade do pedido</th></tr>
              </thead>
              <tbody>
                {nota.itens.map((i) => {
                  const m = mapa[i.id] ?? { pedidoItemId: '', quantidade: '' };
                  const alvo = pedido.itens.find((p) => p.id === m.pedidoItemId);
                  return (
                    <tr key={i.id}>
                      <td>{i.numeroItem}. {i.descricao}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{qtd(i.quantidade, i.unidade ?? undefined)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(i.valor)}</td>
                      <td>
                        <select aria-label={`Item do pedido para ${i.descricao}`} value={m.pedidoItemId} onChange={(e) => setMapa({ ...mapa, [i.id]: { ...m, pedidoItemId: e.target.value } })}>
                          <option value="">Não é deste pedido</option>
                          {pedido.itens.map((p) => <option key={p.id} value={p.id}>{p.descricao} (saldo {qtd(p.saldo, p.unidade)})</option>)}
                        </select>
                      </td>
                      <td>
                        {m.pedidoItemId && (
                          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                            <input aria-label="Quantidade na unidade do pedido" className="mono" inputMode="decimal" style={{ maxWidth: 120 }} value={m.quantidade} onChange={(e) => setMapa({ ...mapa, [i.id]: { ...m, quantidade: e.target.value } })} />
                            <span className="small muted">{alvo?.unidade === 'm3' ? 'm³' : alvo?.unidade}</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <span className="small muted">Se a nota vem em toneladas e o pedido em kg, multiplique por 1.000 na quantidade do pedido.</span>
        </>
      )}
      <div className="acoes">
        {nota && <button className="btn btn-primario" type="submit" disabled={ocupado}>Ligar nota ao pedido</button>}
        <button className="btn btn-secundario" type="button" onClick={aoFechar}>Fechar</button>
      </div>
    </form>
  );
}

// ---------- Detalhe ----------
export function PedidoDetalhe() {
  const { id } = useParams();
  const local = useLocation();
  const { empresa } = useSessao();
  const [p, setP] = useState<Pedido | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState((local.state as { aviso?: string } | null)?.aviso ?? '');
  const [ocupado, setOcupado] = useState(false);
  const [modo, setModo] = useState<'editar' | 'receber' | 'reprovar' | 'encerrar' | 'cancelar' | null>(null);
  const [motivo, setMotivo] = useState('');

  const carregar = useCallback(() => {
    api<{ pedido: Pedido }>(`/sup/pedidos/${id}`).then((r) => setP(r.pedido)).catch((e) => setErro((e as Error).message));
  }, [id]);
  useEffect(carregar, [carregar]);

  async function executar(caminho: string, msg: string, corpo?: unknown, metodo = 'POST') {
    setErro('');
    setAviso('');
    setOcupado(true);
    try {
      setP((await api<{ pedido: Pedido }>(caminho, { metodo, corpo })).pedido);
      setAviso(msg);
      setModo(null);
      setMotivo('');
    } catch (e) {
      setErro((e as Error).message);
    }
    setOcupado(false);
  }

  if (!p) return erro ? <div className="alerta alerta-erro">{erro}</div> : <p className="muted">Carregando…</p>;
  const base = `/sup/pedidos/${p.id}`;
  const editavel = p.status === 'rascunho' || p.status === 'reprovado';
  const aReceber = p.status === 'aprovado' || p.status === 'enviado' || p.status === 'parcial';
  const mostraRecebido = ['parcial', 'recebido', 'encerrado'].includes(p.status) || p.notas.length > 0;

  return (
    <>
      <div className="nao-imprimir">
        <Link to="/sup/pedidos" className="small">← Pedidos de compra</Link>
      </div>
      <CabecalhoDocumento
        modulo="Suprimentos"
        titulo={`Pedido de compra nº ${numeroDoc(p.numero)}`}
        filtros={[
          `Data: ${formatarData(p.data)}`,
          p.previsaoEntrega ? `Entrega prevista: ${formatarData(p.previsaoEntrega)}` : '',
          p.cotacaoNumero ? `Cotação ${numeroDoc(p.cotacaoNumero)}` : '',
          p.solicitacaoNumero ? `Solicitação ${numeroDoc(p.solicitacaoNumero)}` : '',
          `Situação: ${SELO_PEDIDO[p.status].texto}`,
        ]}
      />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}
      {p.status === 'reprovado' && p.motivoReprovacao && (
        <div className="alerta alerta-erro nao-imprimir">Reprovado por {p.aprovadoPor ?? '—'}: {p.motivoReprovacao}. Ajuste e envie de novo.</div>
      )}
      {p.status === 'aguardando_aprovacao' && (
        <div className="alerta alerta-info nao-imprimir">
          Aguardando aprovação desde {formatarDataHora(p.enviadoAprovacaoEm)}. {p.regrasAprovacao}
        </div>
      )}
      {p.atrasado && <div className="alerta alerta-erro nao-imprimir">Entrega atrasada há {p.diasAtraso} {p.diasAtraso === 1 ? 'dia' : 'dias'}.</div>}
      {p.status === 'encerrado' && p.encerradoMotivo && <div className="alerta alerta-info">Encerrado com saldo: {p.encerradoMotivo}</div>}

      {modo === 'editar' ? (
        <FormPedido inicial={p} aoSalvar={(n) => { setP(n); setModo(null); setAviso('Pedido alterado.'); }} aoCancelar={() => setModo(null)} />
      ) : (
        <>
          <div className="card doc-partes">
            <div>
              <span className="rotulo">Fornecedor</span>
              <strong>{p.fornecedor.razaoSocial}</strong>
              {p.fornecedor.documento && <span>CNPJ/CPF {formatarDocumento(p.fornecedor.documento)}</span>}
              {(p.fornecedor.telefone || p.fornecedor.email) && <span>{[p.fornecedor.telefone, p.fornecedor.email].filter(Boolean).join(' · ')}</span>}
              {p.fornecedor.cidade && <span>{p.fornecedor.cidade}</span>}
            </div>
            <div>
              <span className="rotulo">Comprador</span>
              <strong>{empresa?.razaoSocial}</strong>
              {empresa?.cnpj && <span>CNPJ {formatarDocumento(empresa.cnpj)}</span>}
              {(empresa?.telefone || empresa?.email) && <span>{[empresa?.telefone, empresa?.email].filter(Boolean).join(' · ')}</span>}
              {empresa?.cidade && <span>{empresa.cidade}{empresa.uf ? `/${empresa.uf}` : ''}</span>}
            </div>
          </div>

          <div className="card tabela-caixa">
            <h2>Itens</h2>
            <table className="tabela">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Item</th>
                  <th style={{ textAlign: 'right' }}>Quantidade</th>
                  <th style={{ textAlign: 'right' }}>Preço unitário</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  {mostraRecebido && <th className="nao-imprimir" style={{ textAlign: 'right' }}>Recebido</th>}
                  {mostraRecebido && <th className="nao-imprimir" style={{ textAlign: 'right' }}>Preço na nota</th>}
                </tr>
              </thead>
              <tbody>
                {p.itens.map((i, n) => {
                  const difPreco = i.diferencaPreco !== null && Math.abs(i.diferencaPreco) > 0.005;
                  return (
                    <tr key={i.id}>
                      <td className="mono">{n + 1}</td>
                      <td>{i.codigo && <span className="mono small muted">{i.codigo} · </span>}{i.descricao}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{qtd(i.quantidade, i.unidade)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{precoUn(i.precoUnitario)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(i.total)}</td>
                      {mostraRecebido && (
                        <td className={`mono nao-imprimir ${i.recebido > 0 && i.saldo > 0 ? 'tom-aviso' : ''}`} style={{ textAlign: 'right' }}>
                          {qtd(i.recebido, i.unidade)}
                          {i.saldo > 0 && i.recebido > 0 && <div className="small">falta {qtd(i.saldo, i.unidade)}</div>}
                          {i.diferencaQuantidade !== null && i.diferencaQuantidade > i.quantidade * 0.005 && <div className="small tom-aviso">{qtd(i.diferencaQuantidade, i.unidade)} a mais</div>}
                        </td>
                      )}
                      {mostraRecebido && (
                        <td className={`mono nao-imprimir ${difPreco ? 'tom-perigo' : ''}`} style={{ textAlign: 'right' }}>
                          {precoUn(i.precoNota)}
                          {difPreco && <div className="small">{pct(i.diferencaPreco)}</div>}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr><td colSpan={4}>Itens</td><td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(p.subtotal)}</td>{mostraRecebido && <td colSpan={2} className="nao-imprimir" />}</tr>
                <tr><td colSpan={4}>Frete</td><td className="mono" style={{ textAlign: 'right' }}>{p.frete ? formatarMoeda(p.frete) : 'CIF'}</td>{mostraRecebido && <td colSpan={2} className="nao-imprimir" />}</tr>
                <tr><td colSpan={4} className="forte">Total do pedido</td><td className="mono forte" style={{ textAlign: 'right' }}>{formatarMoeda(p.total)}</td>{mostraRecebido && <td colSpan={2} className="nao-imprimir" />}</tr>
              </tfoot>
            </table>
            <div className="doc-condicoes">
              <span><b>Entrega:</b> {p.previsaoEntrega ? formatarData(p.previsaoEntrega) : 'a combinar'}{p.localEntrega ? ` · ${p.localEntrega}` : ''}</span>
              <span><b>Pagamento:</b> {p.condicaoPagamento ?? 'a combinar'}</span>
              {p.centroCusto && <span className="nao-imprimir"><b>Centro de custo:</b> {p.centroCusto}</span>}
            </div>
            {p.entregaObra && (
              <div className="doc-condicoes">
                <span><b>Obra:</b> {p.entregaObra.codigo} · {p.entregaObra.nome}</span>
                <span><b>Endereço de entrega:</b> {[p.entregaObra.endereco, p.entregaObra.cidade].filter(Boolean).join(' · ') || 'não informado no cadastro da obra'}</span>
                <span><b>Referência para entrega:</b> {p.entregaObra.referencia || 'não informada no cadastro da obra'}</span>
                <span><b>Contato na obra:</b> {[p.entregaObra.contatoNome, p.entregaObra.contatoTelefone].filter(Boolean).join(' · ') || 'não informado no cadastro da obra'}</span>
              </div>
            )}
            {p.observacao && <p className="small"><b>Observação:</b> {p.observacao}</p>}
            <p className="small so-imprimir">Informe o número deste pedido na nota fiscal. Entregas com quantidade ou preço diferentes do pedido serão conferidas antes do pagamento.</p>
          </div>

          {p.divergencias > 0 && (
            <div className="alerta alerta-erro nao-imprimir">
              {p.divergencias} {p.divergencias === 1 ? 'item com' : 'itens com'} diferença de preço ou quantidade entre o pedido e a nota. Confira antes de pagar.
            </div>
          )}

          {p.notas.length > 0 && (
            <div className="card tabela-caixa nao-imprimir">
              <h2>Notas recebidas</h2>
              <table className="tabela">
                <thead><tr><th>Nota</th><th>Emissão</th><th style={{ textAlign: 'right' }}>Total</th><th>Financeiro</th><th><span style={{ position: 'absolute', left: -9999 }}>Ações</span></th></tr></thead>
                <tbody>
                  {p.notas.map((n) => (
                    <tr key={n.id}>
                      <td><Link to={`/fin/notas/${n.id}`}>{NOMES_MODELO[n.modelo as ModeloNota] ?? 'Nota'} {n.numero ?? 's/n'}</Link> <span className="small muted">· {n.itensLigados} {n.itensLigados === 1 ? 'item ligado' : 'itens ligados'}</span></td>
                      <td>{formatarData(n.dataEmissao)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(n.total)}</td>
                      <td className="small">{n.status === 'cancelada' ? 'Nota cancelada' : n.lancada ? 'Conta a pagar gerada' : 'Falta conferir a nota'}</td>
                      <td>
                        {!['encerrado', 'cancelado'].includes(p.status) && (
                          <button className="btn btn-link" type="button" disabled={ocupado} onClick={() => executar(`${base}/recebimento/${n.id}`, 'Recebimento desfeito.', undefined, 'DELETE')}>Desfazer</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {modo === 'receber' && <Recebimento pedido={p} aoSalvar={(n) => { setP(n); setModo(null); setAviso('Nota ligada ao pedido. Confira as diferenças, se houver.'); }} aoFechar={() => setModo(null)} />}

          {(modo === 'reprovar' || modo === 'encerrar' || modo === 'cancelar') && (
            <form
              className="card form nao-imprimir"
              onSubmit={(e) => {
                e.preventDefault();
                if (modo === 'reprovar') executar(`${base}/reprovar`, 'Pedido reprovado.', { motivo });
                else if (modo === 'encerrar') executar(`${base}/encerrar`, 'Pedido encerrado com saldo.', { motivo });
                else executar(`${base}/cancelar`, 'Pedido cancelado.', { motivo: motivo || null });
              }}
            >
              <div className="campo">
                <label htmlFor="pd-motivo">{modo === 'reprovar' ? 'Motivo da reprovação' : modo === 'encerrar' ? 'Por que o saldo não será entregue?' : 'Motivo do cancelamento (opcional)'}</label>
                <input id="pd-motivo" maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} required={modo !== 'cancelar'} />
              </div>
              <div className="acoes">
                <button className={`btn ${modo === 'encerrar' ? 'btn-primario' : 'btn-perigo'}`} type="submit" disabled={ocupado}>
                  {modo === 'reprovar' ? 'Reprovar' : modo === 'encerrar' ? 'Encerrar pedido' : 'Cancelar pedido'}
                </button>
                <button className="btn btn-secundario" type="button" onClick={() => setModo(null)}>Voltar</button>
              </div>
            </form>
          )}

          {!modo && (
            <div className="acoes nao-imprimir">
              {editavel && (
                <>
                  <button className="btn btn-primario" type="button" disabled={ocupado} onClick={() => executar(`${base}/enviar-aprovacao`, 'Pedido enviado para aprovação. Ele aparece em Gerencial › Aprovações e no painel do dono.')}>
                    Enviar para aprovação
                  </button>
                  <button className="btn btn-secundario" type="button" onClick={() => setModo('editar')}>Editar</button>
                </>
              )}
              {p.status === 'aguardando_aprovacao' && p.podeAprovar && (
                <>
                  <button className="btn btn-primario" type="button" disabled={ocupado} onClick={() => executar(`${base}/aprovar`, 'Pedido aprovado.')}>Aprovar</button>
                  <button className="btn btn-secundario" type="button" onClick={() => setModo('reprovar')}>Reprovar</button>
                </>
              )}
              {p.status === 'aprovado' && (
                <button className="btn btn-secundario" type="button" disabled={ocupado} onClick={() => executar(`${base}/enviado`, 'Marcado como enviado ao fornecedor.')}>Marcar como enviado ao fornecedor</button>
              )}
              {aReceber && <button className="btn btn-primario" type="button" onClick={() => setModo('receber')}>Receber com nota fiscal</button>}
              {p.status === 'parcial' && <button className="btn btn-link" type="button" onClick={() => setModo('encerrar')}>Encerrar com saldo</button>}
              {['rascunho', 'reprovado', 'aguardando_aprovacao', 'aprovado', 'enviado'].includes(p.status) && p.notas.length === 0 && (
                <button className="btn btn-link" type="button" onClick={() => setModo('cancelar')}>Cancelar pedido</button>
              )}
            </div>
          )}

          <div className="assinaturas">
            <Assinatura nome={p.criadoPor ?? ''} papel="Comprador" />
            <Assinatura
              nome={p.aprovacaoAutomatica ? 'Aprovação automática' : p.aprovadoPor && p.status !== 'reprovado' ? p.aprovadoPor : ''}
              papel="Aprovado por"
              detalhe={p.aprovadoEm && p.status !== 'reprovado' ? `em ${formatarDataHora(p.aprovadoEm)}` : 'aguardando aprovação'}
            />
            <Assinatura nome={p.fornecedor.razaoSocial} papel="Fornecedor · de acordo" />
          </div>
        </>
      )}
    </>
  );
}
