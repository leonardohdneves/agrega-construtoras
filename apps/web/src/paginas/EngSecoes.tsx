// Engenharia · Seções do menu: insumos e serviços, EAP e orçamento, e planejamento (fase 2).
// Cada seção escolhe a obra (seletor, ou ?obra= na URL) e carrega os dados dela.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, formatarMoeda, lerNumero } from '../api';
import { AbaEap, AbaInsumos, ROTULO_NIVEL, type ItemObra, type No, type Obra, type Orcamento } from './EngObras';
import { NovoServico } from './EngTabelas';

type Contexto = { obra: Obra; itens: ItemObra[]; nos: No[]; orc: Orcamento | null; recarregar: () => Promise<void>; setErro: (m: string) => void };

export function SecaoObra({ titulo, ajuda, children }: { titulo: string; ajuda?: string; children: (c: Contexto) => ReactNode }) {
  const [params, setParams] = useSearchParams();
  const [obras, setObras] = useState<Obra[] | null>(null);
  const [dados, setDados] = useState<Omit<Contexto, 'recarregar' | 'setErro'> | null>(null);
  const [erro, setErro] = useState('');
  const escolhida = params.get('obra') ?? obras?.[0]?.id ?? '';

  useEffect(() => {
    api<{ obras: Obra[] }>('/eng/obras')
      .then((r) => setObras(r.obras))
      .catch((e) => setErro((e as Error).message));
  }, []);

  async function carregar() {
    if (!escolhida) return;
    try {
      const [o, i, n, orc] = await Promise.all([
        api<{ obra: Obra }>(`/eng/obras/${escolhida}`),
        api<{ itens: ItemObra[] }>(`/eng/obras/${escolhida}/itens`),
        api<{ nos: No[] }>(`/eng/obras/${escolhida}/eap`),
        api<Orcamento>(`/eng/obras/${escolhida}/orcamento`),
      ]);
      setDados({ obra: o.obra, itens: i.itens, nos: n.nos, orc });
      setErro('');
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  useEffect(() => {
    setDados(null);
    carregar();
  }, [escolhida]);

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>{titulo}</h1>
          {ajuda && <span className="muted">{ajuda}</span>}
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {obras === null && !erro && <p className="muted">Carregando…</p>}
      {obras?.length === 0 && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>Cadastre uma obra antes. <Link to="/eng/obras/nova">Nova obra</Link></p>
        </div>
      )}
      {obras && obras.length > 0 && (
        <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap' }}>
          <div className="campo" style={{ minWidth: 280 }}>
            <label htmlFor="sec-obra">Obra</label>
            <select id="sec-obra" value={escolhida} onChange={(e) => setParams({ obra: e.target.value })}>
              {obras.map((o) => <option key={o.id} value={o.id}>{o.codigo} · {o.nome}</option>)}
            </select>
          </div>
          {dados && (
            <span className="muted small">
              Nível de apropriação: {ROTULO_NIVEL[dados.obra.nivelApropriacao]} · BDI {String(dados.obra.bdiPercentual).replace('.', ',')}%
            </span>
          )}
        </div>
      )}
      {dados && children({ ...dados, recarregar: carregar, setErro })}
    </>
  );
}

export function EngInsumos() {
  return (
    <SecaoObra titulo="Insumos" ajuda="Insumos copiados das tabelas de referência para a obra. Editar o preço aqui não altera a tabela. Insumo próprio é criado na tabela própria.">
      {(c) => <AbaInsumos obraId={c.obra.id} itens={c.itens.filter((i) => i.tipo === 'insumo')} tipo="insumo" aoMudar={c.recarregar} setErro={c.setErro} />}
    </SecaoObra>
  );
}

export function EngServicos() {
  return (
    <SecaoObra titulo="Serviços" ajuda="Composições unitárias (SINAPI e próprias). Serviço próprio é criado na tabela própria, com seus insumos e coeficientes.">
      {(c) => <ConteudoServicos obraId={c.obra.id} itens={c.itens} aoMudar={c.recarregar} setErro={c.setErro} />}
    </SecaoObra>
  );
}

function ConteudoServicos({ obraId, itens, aoMudar, setErro }: { obraId: string; itens: ItemObra[]; aoMudar: () => void; setErro: (m: string) => void }) {
  const [novo, setNovo] = useState(false);
  const [msg, setMsg] = useState('');
  return (
    <>
      <div className="acoes" style={{ marginBottom: 12 }}>
        <button className="btn btn-primario" type="button" onClick={() => { setMsg(''); setNovo(!novo); }} aria-expanded={novo}>{novo ? 'Fechar' : 'Novo serviço'}</button>
      </div>
      {msg && <div className="alerta alerta-ok" role="status" style={{ marginBottom: 12 }}>{msg}</div>}
      {novo && (
        <div style={{ marginBottom: 12 }}>
          <NovoServico aoSalvar={(m) => { setNovo(false); setMsg(m); }} />
        </div>
      )}
      <AbaInsumos obraId={obraId} itens={itens.filter((i) => i.tipo === 'composicao')} tipo="composicao" aoMudar={aoMudar} setErro={setErro} />
    </>
  );
}

export function EngEap() {
  return (
    <SecaoObra titulo="EAP e orçamento" ajuda="A EAP organiza a obra nos níveis escolhidos; o orçamento é lançado nos nós desse nível.">
      {(c) => <AbaEap obra={c.obra} nos={c.nos} itens={c.itens} orc={c.orc} aoMudar={c.recarregar} setErro={c.setErro} />}
    </SecaoObra>
  );
}

export function EngPlanejamento() {
  return (
    <SecaoObra titulo="Planejamento" ajuda="Atividades ligadas à EAP. Sem predecessora, a atividade começa na data informada; com predecessora, começa no dia seguinte ao fim dela, se esse dia for depois.">
      {(c) => <PainelPlanejamento obra={c.obra} nos={c.nos} setErro={c.setErro} />}
    </SecaoObra>
  );
}

type Atividade = {
  id: string; ordem: number; descricao: string; eapNoId: string | null; eapCodigo: string | null; eapDescricao: string | null;
  inicioInformado: string; duracaoDias: number; predecessoraId: string | null; inicio: string; fim: string;
};
type FormAtividade = { descricao: string; eapNoId: string; inicio: string; duracaoDias: string; predecessoraId: string };
const VAZIO: FormAtividade = { descricao: '', eapNoId: '', inicio: '', duracaoDias: '', predecessoraId: '' };
const dataBr = (iso: string) => iso.split('-').reverse().join('/');

function PainelPlanejamento({ obra, nos, setErro }: { obra: Obra; nos: No[]; setErro: (m: string) => void }) {
  const [lista, setLista] = useState<Atividade[] | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [d, setD] = useState<FormAtividade>(VAZIO);
  const [ocupado, setOcupado] = useState(false);
  const nivel = obra.nivelApropriacao;
  const nosDoNivel = nos.filter((n) => n.nivel === nivel);

  async function carregar() {
    try {
      const r = await api<{ atividades: Atividade[] }>(`/eng/obras/${obra.id}/planejamento`);
      setLista(r.atividades);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  useEffect(() => {
    setLista(null);
    setEditando(null);
    setD(VAZIO);
    carregar();
  }, [obra.id]);

  const nomeDe = (id: string | null) => lista?.find((a) => a.id === id)?.descricao ?? '—';

  function editar(a: Atividade) {
    setEditando(a.id);
    setD({ descricao: a.descricao, eapNoId: a.eapNoId ?? '', inicio: a.inicioInformado, duracaoDias: String(a.duracaoDias), predecessoraId: a.predecessoraId ?? '' });
  }

  function cancelar() {
    setEditando(null);
    setD(VAZIO);
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    const dias = lerNumero(d.duracaoDias);
    if (dias === null || dias < 1) return setErro('Informe a duração em dias (mínimo 1).');
    const corpo = {
      descricao: d.descricao.trim(),
      eapNoId: nivel === 'obra' ? null : d.eapNoId || null,
      inicio: d.inicio,
      duracaoDias: Math.round(dias),
      predecessoraId: d.predecessoraId || null,
    };
    setOcupado(true);
    try {
      if (editando) await api(`/eng/obras/${obra.id}/planejamento/${editando}`, { metodo: 'PUT', corpo });
      else await api(`/eng/obras/${obra.id}/planejamento`, { metodo: 'POST', corpo });
      cancelar();
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function excluir(a: Atividade) {
    setErro('');
    try {
      await api(`/eng/obras/${obra.id}/planejamento/${a.id}`, { metodo: 'DELETE' });
      if (editando === a.id) cancelar();
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Atividades</h2>
        {lista === null ? (
          <p className="muted">Carregando…</p>
        ) : lista.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nenhuma atividade ainda.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tabela">
              <thead>
                <tr>
                  <th>Atividade</th>
                  <th>{nivel === 'obra' ? 'Nível' : 'Nó da EAP'}</th>
                  <th>Predecessora</th>
                  <th>Início</th>
                  <th>Fim</th>
                  <th className="num">Dias</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lista.map((a) => (
                  <tr key={a.id}>
                    <td>{a.descricao}</td>
                    <td>{nivel === 'obra' ? 'Obra' : `${a.eapCodigo ?? ''} ${a.eapDescricao ?? ''}`}</td>
                    <td>{nomeDe(a.predecessoraId)}</td>
                    <td>
                      {dataBr(a.inicio)}
                      {a.inicio !== a.inicioInformado && <div className="small muted">informado: {dataBr(a.inicioInformado)}</div>}
                    </td>
                    <td>{dataBr(a.fim)}</td>
                    <td className="num">{a.duracaoDias}</td>
                    <td className="acoes">
                      <button className="btn" type="button" onClick={() => editar(a)}>Editar</button>
                      <button className="btn" type="button" onClick={() => excluir(a)}>Excluir</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <form className="card form" onSubmit={salvar}>
        <h2 style={{ margin: 0 }}>{editando ? 'Editar atividade' : 'Nova atividade'}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <div className="campo" style={{ gridColumn: 'span 2' }}>
            <label htmlFor="at-desc">Atividade</label>
            <input id="at-desc" value={d.descricao} onChange={(e) => setD({ ...d, descricao: e.target.value })} />
          </div>
          {nivel !== 'obra' && (
            <div className="campo" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="at-eap">Nó da EAP ({ROTULO_NIVEL[nivel]})</label>
              <select id="at-eap" value={d.eapNoId} onChange={(e) => setD({ ...d, eapNoId: e.target.value })}>
                <option value="">Escolha…</option>
                {nosDoNivel.map((n) => <option key={n.id} value={n.id}>{n.codigo} {n.descricao}</option>)}
              </select>
            </div>
          )}
          <div className="campo">
            <label htmlFor="at-ini">Início informado</label>
            <input id="at-ini" type="date" value={d.inicio} onChange={(e) => setD({ ...d, inicio: e.target.value })} />
          </div>
          <div className="campo">
            <label htmlFor="at-dias">Duração (dias corridos)</label>
            <input id="at-dias" inputMode="numeric" value={d.duracaoDias} onChange={(e) => setD({ ...d, duracaoDias: e.target.value })} />
          </div>
          <div className="campo" style={{ gridColumn: 'span 2' }}>
            <label htmlFor="at-pred">Predecessora</label>
            <select id="at-pred" value={d.predecessoraId} onChange={(e) => setD({ ...d, predecessoraId: e.target.value })}>
              <option value="">Nenhuma</option>
              {(lista ?? []).filter((a) => a.id !== editando).map((a) => <option key={a.id} value={a.id}>{a.descricao}</option>)}
            </select>
          </div>
        </div>
        <div className="acoes">
          {editando && <button className="btn" type="button" onClick={cancelar}>Cancelar edição</button>}
          <button className="btn btn-primario" type="submit" disabled={ocupado || d.descricao.trim().length < 2 || !d.inicio || !d.duracaoDias || (nivel !== 'obra' && !d.eapNoId)}>
            {ocupado ? 'Salvando…' : editando ? 'Salvar atividade' : 'Adicionar atividade'}
          </button>
        </div>
      </form>
    </>
  );
}

export function EngApropriacao() {
  return (
    <SecaoObra titulo="Apropriação de insumos" ajuda="Insumos que a obra precisa, apropriados ao nível de apropriação escolhido no cadastro da obra. Ainda não geram solicitação de compra.">
      {(c) => <PainelApropriacao obra={c.obra} itens={c.itens.filter((i) => i.tipo === 'insumo')} nos={c.nos} setErro={c.setErro} />}
    </SecaoObra>
  );
}

type Necessidade = {
  id: string; itemId: string; codigo: string; descricao: string; unidade: string; eapNoId: string | null; eapCodigo: string | null; eapDescricao: string | null;
  quantidade: number; dataNecessaria: string | null; observacao: string | null; status: string; precoUnitario: number | null; total: number | null;
};
const VAZIO_NEC = { itemId: '', eapNoId: '', quantidade: '', dataNecessaria: '', observacao: '' };

function PainelApropriacao({ obra, itens, nos, setErro }: { obra: Obra; itens: ItemObra[]; nos: No[]; setErro: (m: string) => void }) {
  const [lista, setLista] = useState<Necessidade[] | null>(null);
  const [d, setD] = useState(VAZIO_NEC);
  const [ocupado, setOcupado] = useState(false);
  const nivel = obra.nivelApropriacao;
  const nosDoNivel = nos.filter((n) => n.nivel === nivel);

  async function carregar() {
    try {
      const r = await api<{ necessidades: Necessidade[] }>(`/eng/obras/${obra.id}/necessidades`);
      setLista(r.necessidades);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  useEffect(() => {
    setLista(null);
    setD(VAZIO_NEC);
    carregar();
  }, [obra.id]);

  async function adicionar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    const q = lerNumero(d.quantidade);
    if (q === null || q <= 0) return setErro('Informe uma quantidade maior que zero.');
    setOcupado(true);
    try {
      await api(`/eng/obras/${obra.id}/necessidades`, {
        metodo: 'POST',
        corpo: { itemId: d.itemId, eapNoId: nivel === 'obra' ? null : d.eapNoId || null, quantidade: q, dataNecessaria: d.dataNecessaria || null, observacao: d.observacao.trim() || null },
      });
      setD(VAZIO_NEC);
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function cancelar(n: Necessidade) {
    setErro('');
    try {
      await api(`/eng/obras/${obra.id}/necessidades/${n.id}`, { metodo: 'PUT', corpo: { status: 'cancelada' } });
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  async function excluir(n: Necessidade) {
    setErro('');
    try {
      await api(`/eng/obras/${obra.id}/necessidades/${n.id}`, { metodo: 'DELETE' });
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  // Total apropriado por nó (só o que não foi cancelado).
  const porNo = new Map<string, { rotulo: string; total: number }>();
  for (const n of (lista ?? []).filter((x) => x.status !== 'cancelada')) {
    const chave = n.eapNoId ?? 'obra';
    const rotulo = nivel === 'obra' ? 'Obra' : `${n.eapCodigo ?? ''} ${n.eapDescricao ?? ''}`;
    const atual = porNo.get(chave) ?? { rotulo, total: 0 };
    porNo.set(chave, { rotulo, total: atual.total + (n.total ?? 0) });
  }

  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Necessidades</h2>
        {lista === null ? (
          <p className="muted">Carregando…</p>
        ) : lista.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nenhum insumo apropriado ainda.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tabela">
              <thead>
                <tr>
                  <th>{nivel === 'obra' ? 'Nível' : 'Nó da EAP'}</th>
                  <th>Insumo</th>
                  <th>Unid.</th>
                  <th className="num">Qtd.</th>
                  <th>Necessário em</th>
                  <th className="num">Preço</th>
                  <th className="num">Total</th>
                  <th>Situação</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lista.map((n) => (
                  <tr key={n.id}>
                    <td>{nivel === 'obra' ? 'Obra' : `${n.eapCodigo ?? ''} ${n.eapDescricao ?? ''}`}</td>
                    <td>{n.codigo} · {n.descricao}{n.observacao && <div className="small muted">{n.observacao}</div>}</td>
                    <td>{n.unidade}</td>
                    <td className="num">{n.quantidade}</td>
                    <td>{n.dataNecessaria ? n.dataNecessaria.split('-').reverse().join('/') : '—'}</td>
                    <td className="num">{formatarMoeda(n.precoUnitario)}</td>
                    <td className="num">{formatarMoeda(n.total)}</td>
                    <td>{n.status === 'cancelada' ? 'Cancelada' : 'Pendente'}</td>
                    <td className="acoes">
                      {n.status !== 'cancelada' && <button className="btn" type="button" onClick={() => cancelar(n)}>Cancelar</button>}
                      <button className="btn" type="button" onClick={() => excluir(n)}>Excluir</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {porNo.size > 0 && (
          <div style={{ marginTop: 12, display: 'grid', gap: 4, justifyContent: 'end' }}>
            {[...porNo.entries()].map(([chave, v]) => (
              <div key={chave}>{v.rotulo.trim() || 'Obra'}: <b>{formatarMoeda(v.total)}</b></div>
            ))}
          </div>
        )}
      </div>

      <form className="card form" onSubmit={adicionar}>
        <h2 style={{ margin: 0 }}>Apropriar insumo</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <div className="campo" style={{ gridColumn: 'span 2' }}>
            <label htmlFor="ap-item">Insumo</label>
            <select id="ap-item" value={d.itemId} onChange={(e) => setD({ ...d, itemId: e.target.value })}>
              <option value="">Escolha…</option>
              {itens.map((i) => <option key={i.id} value={i.id}>{i.codigo} · {i.descricao}</option>)}
            </select>
          </div>
          {nivel !== 'obra' && (
            <div className="campo" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="ap-eap">Nó da EAP ({ROTULO_NIVEL[nivel]})</label>
              <select id="ap-eap" value={d.eapNoId} onChange={(e) => setD({ ...d, eapNoId: e.target.value })}>
                <option value="">Escolha…</option>
                {nosDoNivel.map((n) => <option key={n.id} value={n.id}>{n.codigo} {n.descricao}</option>)}
              </select>
            </div>
          )}
          <div className="campo">
            <label htmlFor="ap-qtd">Quantidade</label>
            <input id="ap-qtd" inputMode="decimal" value={d.quantidade} onChange={(e) => setD({ ...d, quantidade: e.target.value })} />
          </div>
          <div className="campo">
            <label htmlFor="ap-data">Necessário em</label>
            <input id="ap-data" type="date" value={d.dataNecessaria} onChange={(e) => setD({ ...d, dataNecessaria: e.target.value })} />
          </div>
          <div className="campo" style={{ gridColumn: 'span 2' }}>
            <label htmlFor="ap-obs">Observação</label>
            <input id="ap-obs" value={d.observacao} onChange={(e) => setD({ ...d, observacao: e.target.value })} />
          </div>
        </div>
        <div className="acoes">
          <button className="btn btn-primario" type="submit" disabled={ocupado || !d.itemId || !d.quantidade || (nivel !== 'obra' && !d.eapNoId)}>
            {ocupado ? 'Salvando…' : 'Apropriar'}
          </button>
        </div>
      </form>
    </>
  );
}
