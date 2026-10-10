// Comercial · Propostas: orçamento para o cliente. A IA redige o texto com o histórico de preço; aceita, vira venda.
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, formatarData, formatarMoeda, lerNumero } from '../api';
import { useSessao } from '../sessao';
import { CabecalhoDocumento } from '../componentes/Documento';
import { Assinatura } from '../componentes/Suprimentos';
import type { PropostaBase } from './Comercial';

type Status = 'rascunho' | 'enviada' | 'aceita' | 'recusada';
type Proposta = {
  id: string; numero: number; clienteId: string; clienteNome: string; tracoId: string; tracoCodigo: string; tracoDescricao: string | null;
  vendedorNome: string; obra: string | null; endereco: string | null; volume: number; precoM3: number; total: number; condicoes: string | null;
  validadeDias: number; texto: string | null; textoIa: boolean; status: Status; vendaId: string | null; vendaNumero: number | null; criadoEm: string;
};
type Opcoes = {
  clientes: { id: string; nome: string; cidade: string | null }[];
  tracos: { id: string; codigo: string; descricao: string | null; fck: number | null; slump: string | null }[];
  ultimoPreco: Record<string, number>;
};
type Historico = { preco: number; data: string };

const ROTULO: Record<Status, string> = { rascunho: 'Rascunho', enviada: 'Enviada', aceita: 'Aceita', recusada: 'Recusada' };
const SELO: Record<Status, string> = { rascunho: 'selo-neutro', enviada: 'selo-aviso', aceita: 'selo-ok', recusada: 'selo-perigo' };
const numeroFmt = (n: number) => String(n).padStart(4, '0');
const campo = (n: number) => String(n).replace('.', ',');

function corpoDe(p: Proposta, texto: string | null) {
  return { clienteId: p.clienteId, tracoId: p.tracoId, obra: p.obra ?? '', endereco: p.endereco ?? '', volume: p.volume, precoM3: p.precoM3, condicoes: p.condicoes ?? '', validadeDias: p.validadeDias, texto };
}

export function ComPropostas() {
  const [lista, setLista] = useState<Proposta[] | null>(null);
  const [ia, setIa] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    api<{ propostas: Proposta[]; ia: boolean }>('/com/propostas')
      .then((r) => {
        setLista(r.propostas);
        setIa(r.ia);
      })
      .catch((e) => setErro((e as Error).message));
  }, []);

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Propostas</h1>
          <span className="muted">Orçamento para o cliente. A IA redige o texto com o histórico de preço; quando o cliente aceita, a proposta vira venda.</span>
        </div>
        <div className="acoes">
          <Link className="btn btn-primario" to="/com/propostas/nova">Nova proposta</Link>
        </div>
      </div>
      {!ia && <div className="alerta alerta-aviso">A IA não está configurada. Os textos saem no modelo padrão e você pode ajustá-los.</div>}
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {lista === null && !erro && <p className="muted">Carregando…</p>}
      {lista?.length === 0 && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>Nenhuma proposta ainda. Crie a primeira com o cliente, o traço e o preço.</p>
        </div>
      )}
      {lista && lista.length > 0 && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="tabela">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Cliente</th>
                <th>Traço</th>
                <th className="num">Volume</th>
                <th className="num">Preço/m³</th>
                <th className="num">Total</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => (
                <tr key={p.id}>
                  <td className="mono"><Link to={`/com/propostas/${p.id}`}>{numeroFmt(p.numero)}</Link></td>
                  <td><Link to={`/com/propostas/${p.id}`}>{p.clienteNome}</Link>{p.obra && <div className="small muted">{p.obra}</div>}</td>
                  <td>{p.tracoCodigo}</td>
                  <td className="num">{p.volume.toLocaleString('pt-BR')} m³</td>
                  <td className="num">{formatarMoeda(p.precoM3)}</td>
                  <td className="num">{formatarMoeda(p.total)}</td>
                  <td><span className={`selo ${SELO[p.status]}`}>{ROTULO[p.status]}</span>{p.vendaNumero && <div className="small muted">venda {numeroFmt(p.vendaNumero)}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function PropostaForm({ editando }: { editando?: Proposta }) {
  const navegar = useNavigate();
  const [op, setOp] = useState<Opcoes | null>(null);
  const [d, setD] = useState({
    clienteId: editando?.clienteId ?? '',
    tracoId: editando?.tracoId ?? '',
    obra: editando?.obra ?? '',
    endereco: editando?.endereco ?? '',
    volume: editando ? campo(editando.volume) : '',
    precoM3: editando ? campo(editando.precoM3) : '',
    condicoes: editando?.condicoes ?? '',
    validadeDias: String(editando?.validadeDias ?? 7),
    texto: editando?.texto ?? '',
  });
  const [hist, setHist] = useState<Historico[]>([]);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    api<Opcoes>('/com/opcoes').then(setOp).catch((e) => setErro((e as Error).message));
  }, []);

  // Histórico de preço deste cliente neste traço: a referência para o vendedor e para a IA.
  useEffect(() => {
    if (!d.clienteId || !d.tracoId) {
      setHist([]);
      return;
    }
    api<{ historico: Historico[] }>(`/com/propostas/referencia?clienteId=${d.clienteId}&tracoId=${d.tracoId}`)
      .then((r) => setHist(r.historico))
      .catch(() => setHist([]));
  }, [d.clienteId, d.tracoId]);

  // Ao escolher o traço, sugere o último preço aprovado dele (só se o preço ainda estiver vazio).
  function escolherTraco(id: string) {
    setD((x) => ({ ...x, tracoId: id, precoM3: x.precoM3 || (op?.ultimoPreco[id] ? campo(op.ultimoPreco[id]) : '') }));
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    const volume = lerNumero(d.volume);
    const preco = lerNumero(d.precoM3);
    if (!d.clienteId) return setErro('Escolha o cliente.');
    if (!d.tracoId) return setErro('Escolha o traço.');
    if (volume === null || volume <= 0) return setErro('Informe o volume em m³.');
    if (preco === null || preco < 0) return setErro('Informe o preço por m³.');
    const corpo = {
      clienteId: d.clienteId, tracoId: d.tracoId, obra: d.obra, endereco: d.endereco, volume, precoM3: preco,
      condicoes: d.condicoes, validadeDias: Number(d.validadeDias) || 7, texto: d.texto,
    };
    setOcupado(true);
    try {
      const r = editando
        ? await api<{ proposta: Proposta }>(`/com/propostas/${editando.id}`, { metodo: 'PUT', corpo })
        : await api<{ proposta: Proposta }>('/com/propostas', { corpo });
      navegar(`/com/propostas/${r.proposta.id}`, {
        replace: true,
        state: { aviso: editando ? 'Proposta alterada.' : 'Proposta criada. Use "Redigir com IA" para o texto, ou escreva o seu.' },
      });
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const sel = (valor: string, onChange: (v: string) => void, opcoes: { id: string; rotulo: string }[], rotulo: string, id: string) => (
    <div className="campo">
      <label htmlFor={id}>{rotulo}</label>
      <select id={id} value={valor} onChange={(e) => onChange(e.target.value)}>
        <option value="">Escolha…</option>
        {opcoes.map((o) => (
          <option key={o.id} value={o.id}>{o.rotulo}</option>
        ))}
      </select>
    </div>
  );

  return (
    <form className="card form" onSubmit={salvar}>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12 }}>
        {sel(d.clienteId, (v) => setD({ ...d, clienteId: v }), (op?.clientes ?? []).map((c) => ({ id: c.id, rotulo: `${c.nome}${c.cidade ? ` · ${c.cidade}` : ''}` })), 'Cliente', 'pr-cliente')}
        {sel(d.tracoId, escolherTraco, (op?.tracos ?? []).map((t) => ({ id: t.id, rotulo: `${t.codigo}${t.descricao ? ` · ${t.descricao}` : ''}` })), 'Traço', 'pr-traco')}
        <div className="campo">
          <label htmlFor="pr-obra">Obra</label>
          <input id="pr-obra" value={d.obra} onChange={(e) => setD({ ...d, obra: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="pr-endereco">Endereço da obra</label>
          <input id="pr-endereco" value={d.endereco} onChange={(e) => setD({ ...d, endereco: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="pr-volume">Volume (m³)</label>
          <input id="pr-volume" inputMode="decimal" value={d.volume} onChange={(e) => setD({ ...d, volume: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="pr-preco">Preço por m³ (R$)</label>
          <input id="pr-preco" inputMode="decimal" value={d.precoM3} onChange={(e) => setD({ ...d, precoM3: e.target.value })} />
          {hist.length > 0 ? (
            <span className="small">Este cliente, neste traço: {hist.slice(0, 3).map((h) => `${formatarMoeda(h.preco)}/m³ em ${h.data}`).join(' · ')}</span>
          ) : (
            d.clienteId && d.tracoId && <span className="small muted">Sem vendas anteriores deste traço para este cliente.</span>
          )}
        </div>
        <div className="campo">
          <label htmlFor="pr-condicoes">Condições de pagamento</label>
          <input id="pr-condicoes" placeholder="ex.: 28 dias, boleto" value={d.condicoes} onChange={(e) => setD({ ...d, condicoes: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="pr-validade">Validade (dias)</label>
          <input id="pr-validade" inputMode="numeric" value={d.validadeDias} onChange={(e) => setD({ ...d, validadeDias: e.target.value })} />
        </div>
      </div>
      <div className="campo">
        <label htmlFor="pr-texto">Texto da proposta (opcional)</label>
        <textarea id="pr-texto" rows={6} value={d.texto} onChange={(e) => setD({ ...d, texto: e.target.value })} placeholder="Deixe em branco: a IA redige na tela da proposta." />
      </div>
      <div className="acoes">
        <button className="btn btn-primario" type="submit" disabled={ocupado}>{ocupado ? 'Salvando…' : 'Salvar proposta'}</button>
        <Link className="btn btn-link" to={editando ? `/com/propostas/${editando.id}` : '/com/propostas'}>Cancelar</Link>
      </div>
    </form>
  );
}

export function PropostaNova() {
  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Nova proposta</h1>
          <span className="muted">Cliente, traço e preço. O histórico de preço do cliente aparece ao lado.</span>
        </div>
      </div>
      <PropostaForm />
    </>
  );
}

export function PropostaEditar() {
  const { id } = useParams();
  const [p, setP] = useState<Proposta | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    api<{ proposta: Proposta }>(`/com/propostas/${id}`).then((r) => setP(r.proposta)).catch((e) => setErro((e as Error).message));
  }, [id]);
  if (erro) return <div className="alerta alerta-erro" role="alert">{erro}</div>;
  if (!p) return <p className="muted">Carregando…</p>;
  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Alterar proposta nº {numeroFmt(p.numero)}</h1>
        </div>
      </div>
      <PropostaForm editando={p} />
    </>
  );
}

export function PropostaDetalhe() {
  const { id } = useParams();
  const { empresa } = useSessao();
  const local = useLocation();
  const navegar = useNavigate();
  const [p, setP] = useState<Proposta | null>(null);
  const [texto, setTexto] = useState('');
  const [aviso, setAviso] = useState((local.state as { aviso?: string } | null)?.aviso ?? '');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    api<{ proposta: Proposta }>(`/com/propostas/${id}`)
      .then((r) => {
        setP(r.proposta);
        setTexto(r.proposta.texto ?? '');
      })
      .catch((e) => setErro((e as Error).message));
  }, [id]);

  async function executar(fn: () => Promise<void>, msg?: string) {
    setOcupado(true);
    setErro('');
    setAviso('');
    try {
      await fn();
      const r = await api<{ proposta: Proposta }>(`/com/propostas/${id}`);
      setP(r.proposta);
      setTexto(r.proposta.texto ?? '');
      if (msg) setAviso(msg);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  if (erro && !p) return <div className="alerta alerta-erro" role="alert">{erro}</div>;
  if (!p) return <p className="muted">Carregando…</p>;

  const editavel = p.status === 'rascunho' || p.status === 'enviada';
  const mudou = texto !== (p.texto ?? '');

  const redigir = () =>
    executar(async () => {
      const r = await api<{ proposta: Proposta; aviso: string | null }>(`/com/propostas/${p.id}/redigir`, { metodo: 'POST' });
      setAviso(r.aviso ?? 'Texto redigido pela IA. Confira antes de enviar ao cliente.');
    });

  const salvarTexto = () => executar(async () => { await api(`/com/propostas/${p.id}`, { metodo: 'PUT', corpo: corpoDe(p, texto) }); }, 'Texto salvo.');
  const mudarStatus = (status: 'enviada' | 'aceita' | 'recusada', msg: string) =>
    executar(async () => { await api(`/com/propostas/${p.id}/status`, { corpo: { status } }); }, msg);

  const lancarVenda = () => {
    const base: PropostaBase = {
      propostaId: p.id, numero: p.numero, clienteId: p.clienteId, tracoId: p.tracoId, obra: p.obra, endereco: p.endereco, volume: p.volume, precoM3: p.precoM3, condicoes: p.condicoes,
    };
    navegar('/com/vendas/nova', { state: { proposta: base } });
  };

  return (
    <>
      <Link to="/com/propostas" className="small nao-imprimir">← Propostas</Link>
      <CabecalhoDocumento
        modulo="Comercial"
        titulo={`Proposta nº ${numeroFmt(p.numero)}`}
        descricao={`Para ${p.clienteNome}${p.obra ? `, obra ${p.obra}` : ''}.`}
        filtros={[`Situação: ${ROTULO[p.status]}`, `Vendedor: ${p.vendedorNome}`]}
      />
      {aviso && <div className="alerta nao-imprimir" role="status">{aviso}</div>}
      {erro && <div className="alerta alerta-erro nao-imprimir" role="alert">{erro}</div>}

      <div className="card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        <div><div className="small muted">Traço</div><b>{p.tracoCodigo}{p.tracoDescricao ? ` · ${p.tracoDescricao}` : ''}</b></div>
        <div><div className="small muted">Volume</div><b>{p.volume.toLocaleString('pt-BR')} m³</b></div>
        <div><div className="small muted">Preço por m³</div><b>{formatarMoeda(p.precoM3)}</b></div>
        <div><div className="small muted">Total estimado</div><b>{formatarMoeda(p.total)}</b></div>
        <div><div className="small muted">Condições</div><b>{p.condicoes || '—'}</b></div>
        <div><div className="small muted">Validade</div><b>{p.validadeDias} {p.validadeDias === 1 ? 'dia' : 'dias'}</b></div>
        <div><div className="small muted">Vendedor</div><b>{p.vendedorNome}</b></div>
        <div><div className="small muted">Criada em</div><b>{formatarData(p.criadoEm)}</b></div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="cabecalho" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Texto da proposta</h2>
          {p.textoIa && <span className="small muted">redigido pela IA</span>}
        </div>
        {editavel && (
          <textarea className="nao-imprimir" aria-label="Texto da proposta" rows={12} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ainda sem texto. Use Redigir com IA ou escreva o seu." style={{ width: '100%' }} />
        )}
        <p className={editavel ? 'so-imprimir' : undefined} style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
          {editavel ? texto || '—' : p.texto || '—'}
        </p>
      </div>

      <div className="so-imprimir assinaturas">
        <Assinatura nome={empresa?.nomeFantasia || empresa?.razaoSocial || ''} papel="Concreteira (responsável comercial)" />
        <Assinatura nome={p.clienteNome} papel="Aceite do cliente" />
      </div>

      <div className="acoes nao-imprimir" style={{ marginTop: 12, flexWrap: 'wrap' }}>
        {editavel && (
          <>
            <button className="btn btn-primario" type="button" disabled={ocupado} onClick={redigir}>{p.texto ? 'Redigir de novo com IA' : 'Redigir com IA'}</button>
            <button className="btn btn-secundario" type="button" disabled={ocupado || !mudou} onClick={salvarTexto}>Salvar texto</button>
            <Link className="btn btn-secundario" to={`/com/propostas/${p.id}/editar`}>Alterar dados</Link>
          </>
        )}
        {p.status === 'rascunho' && (
          <button className="btn btn-secundario" type="button" disabled={ocupado || !p.texto} onClick={() => mudarStatus('enviada', 'Proposta marcada como enviada ao cliente.')}>Marcar como enviada</button>
        )}
        {editavel && (
          <>
            <button className="btn btn-secundario" type="button" disabled={ocupado} onClick={() => mudarStatus('aceita', 'Proposta aceita. Agora você pode lançar a venda.')}>Cliente aceitou</button>
            <button className="btn btn-link" type="button" disabled={ocupado} onClick={() => mudarStatus('recusada', 'Proposta marcada como recusada.')}>Cliente recusou</button>
          </>
        )}
        {p.status === 'aceita' && !p.vendaId && (
          <button className="btn btn-primario" type="button" onClick={lancarVenda}>Lançar venda</button>
        )}
        {p.vendaId && <Link className="btn btn-secundario" to={`/com/vendas/${p.vendaId}`}>Ver a venda nº {numeroFmt(p.vendaNumero ?? 0)}</Link>}
      </div>
    </>
  );
}
