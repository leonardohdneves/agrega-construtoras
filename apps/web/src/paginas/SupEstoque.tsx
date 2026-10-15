import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';

type Apropriacao = { obraId: string; obraCodigo: string; eapNoId: string; eapCodigo: string; eapDescricao: string; quantidade: number };
type ItemEstoque = { obraItemId: string; codigo: string; descricao: string; unidade: string; saldo: number; apropriacoes: Apropriacao[] };
type Obra = { id: string; codigo: string; nome: string };
type NoEap = { id: string; codigo: string; descricao: string };
type InsumoObra = { id: string; codigo: string; descricao: string; unidade: string };
type EstoqueObra = { id: string; nome: string; recebimento: boolean; ativo: boolean; movimentos: number };

const hoje = () => new Date().toISOString().slice(0, 10);
const num = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

/** Estoque da construtora: saldo de cada insumo da obra, por etapa da EAP, e saídas por requisição. */
export function SupEstoque() {
  const [obras, setObras] = useState<Obra[]>([]);
  const [obraId, setObraId] = useState('');
  const [itens, setItens] = useState<ItemEstoque[] | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [insumos, setInsumos] = useState<InsumoObra[]>([]);
  const [etapas, setEtapas] = useState<NoEap[]>([]);
  const [saida, setSaida] = useState({ obraItemId: '', eapNoId: '', quantidade: '', data: hoje(), observacao: '', estoqueId: '' });
  const [ocupado, setOcupado] = useState(false);
  const [estoques, setEstoques] = useState<EstoqueObra[]>([]);
  const [nomeNovo, setNomeNovo] = useState('');

  useEffect(() => {
    api<{ obras: Obra[] }>('/obras').then((r) => setObras(r.obras)).catch(() => setObras([]));
  }, []);

  async function carregarEstoques(obra: string) {
    const r = await api<{ estoques: EstoqueObra[] }>(`/sup/obras/${obra}/estoques`);
    setEstoques(r.estoques);
  }

  async function criarEstoque(e: FormEvent) {
    e.preventDefault();
    setErro(null); setAviso(null);
    try {
      await api(`/sup/obras/${obraId}/estoques`, { metodo: 'POST', corpo: { nome: nomeNovo } });
      setNomeNovo('');
      setAviso('Estoque criado.');
      await carregarEstoques(obraId);
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  async function alternarEstoque(est: EstoqueObra) {
    setErro(null); setAviso(null);
    try {
      await api(`/sup/estoques/${est.id}`, { metodo: 'PUT', corpo: { ativo: !est.ativo } });
      await carregarEstoques(obraId);
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  async function carregar(obra: string) {
    setItens(null);
    const r = await api<{ itens: ItemEstoque[] }>(`/sup/estoque${obra ? `?obraId=${obra}` : ''}`);
    setItens(r.itens);
  }

  useEffect(() => {
    setSaida({ obraItemId: '', eapNoId: '', quantidade: '', data: hoje(), observacao: '', estoqueId: '' });
    setEstoques([]);
    setInsumos([]);
    setEtapas([]);
    if (!obraId) { setItens(null); return; }
    carregar(obraId).catch((e) => setErro((e as Error).message));
    carregarEstoques(obraId).catch((e) => setErro((e as Error).message));
    api<{ itens: InsumoObra[] }>(`/obras/${obraId}/itens?tipo=insumo`).then((r) => setInsumos(r.itens)).catch(() => setInsumos([]));
    api<{ nos: NoEap[] }>(`/obras/${obraId}/eap`).then((r) => setEtapas(r.nos)).catch(() => setEtapas([]));
  }, [obraId]);

  const insumoEscolhido = insumos.find((i) => i.id === saida.obraItemId);
  const saldoAtual = itens?.find((i) => i.obraItemId === saida.obraItemId)?.apropriacoes.find((a) => a.eapNoId === saida.eapNoId)?.quantidade ?? 0;

  async function registrarSaida(e: FormEvent) {
    e.preventDefault();
    setErro(null); setAviso(null);
    setOcupado(true);
    try {
      await api('/sup/estoque/saidas', {
        metodo: 'POST',
        corpo: { obraId, obraItemId: saida.obraItemId, eapNoId: saida.eapNoId, data: saida.data, quantidade: saida.quantidade, observacao: saida.observacao || null, estoqueId: saida.estoqueId || null },
      });
      setAviso('Saída registrada.');
      setSaida({ obraItemId: '', eapNoId: '', quantidade: '', data: hoje(), observacao: '', estoqueId: '' });
      await carregar(obraId);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="pagina">
      <header className="cabecalho-pagina">
        <h1>Estoque</h1>
        <p className="muted">Saldo de cada insumo da obra, por etapa da EAP. As entradas vêm das notas de compra; a saída é a requisição de material.</p>
      </header>

      <div className="card">
        <label className="campo">
          <span>Obra</span>
          <select aria-label="Obra do estoque" value={obraId} onChange={(e) => setObraId(e.target.value)}>
            <option value="">Escolha a obra…</option>
            {obras.map((o) => <option key={o.id} value={o.id}>{o.codigo} · {o.nome}</option>)}
          </select>
        </label>
      </div>

      {erro && <div className="alerta alerta-erro">{erro}</div>}
      {aviso && <div className="alerta">{aviso}</div>}

      {obraId && (
        <>
          <div className="card">
            <h2>Estoques da obra</h2>
            <p className="muted small">As notas de compra entram no estoque de recebimento. Outros estoques servem para organizar as saídas; cada obra mantém sempre o de recebimento ativo.</p>
            {estoques.length > 0 && (
              <table className="tabela">
                <thead><tr><th>Estoque</th><th>Situação</th><th className="n">Movimentos</th><th /></tr></thead>
                <tbody>
                  {estoques.map((est) => (
                    <tr key={est.id}>
                      <td>{est.nome}</td>
                      <td>{est.recebimento ? 'Recebimento' : est.ativo ? 'Ativo' : 'Inativo'}</td>
                      <td className="n">{est.movimentos}</td>
                      <td>{!est.recebimento && <button className="btn btn-link" type="button" onClick={() => alternarEstoque(est)}>{est.ativo ? 'Desativar' : 'Ativar'}</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <form className="campos" onSubmit={criarEstoque}>
              <label className="campo">
                <span>Novo estoque</span>
                <input aria-label="Nome do novo estoque" required minLength={2} maxLength={60} value={nomeNovo} onChange={(e) => setNomeNovo(e.target.value)} />
              </label>
              <div className="acoes">
                <button className="btn btn-secundario" type="submit">Criar estoque</button>
              </div>
            </form>
          </div>

          <div className="card">
            <h2>Saldo por insumo</h2>
            {itens === null ? <p className="muted">Carregando…</p> : itens.length === 0 ? (
              <p className="muted">Nenhum insumo em estoque nesta obra. As entradas aparecem quando a nota de compra é confirmada com obra, insumo e etapa.</p>
            ) : (
              <table className="tabela">
                <thead><tr><th>Insumo</th><th className="n">Saldo</th><th>Apropriação (etapa)</th></tr></thead>
                <tbody>
                  {itens.map((it) => (
                    <tr key={it.obraItemId} onClick={() => setAberto(aberto === it.obraItemId ? null : it.obraItemId)} style={{ cursor: 'pointer' }}>
                      <td>{it.codigo} · {it.descricao}</td>
                      <td className="n">{num(it.saldo)} {it.unidade}</td>
                      <td className="small">
                        {aberto === it.obraItemId
                          ? it.apropriacoes.map((a) => <div key={a.eapNoId}>{a.eapCodigo} {a.eapDescricao}: {num(a.quantidade)} {it.unidade}</div>)
                          : `${it.apropriacoes.length} etapa(s) · clique para ver`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <form className="card form" onSubmit={registrarSaida}>
            <h2>Registrar saída (requisição de material)</h2>
            <div className="campos">
              <label className="campo">
                <span>Insumo da obra</span>
                <select aria-label="Insumo da obra" required value={saida.obraItemId} onChange={(e) => setSaida({ ...saida, obraItemId: e.target.value, eapNoId: '' })}>
                  <option value="">Escolha…</option>
                  {insumos.map((i) => <option key={i.id} value={i.id}>{i.codigo} · {i.descricao}</option>)}
                </select>
              </label>
              <label className="campo">
                <span>Estoque de saída</span>
                <select aria-label="Estoque de saída" value={saida.estoqueId} onChange={(e) => setSaida({ ...saida, estoqueId: e.target.value })}>
                  <option value="">Recebimento (padrão)</option>
                  {estoques.filter((est) => est.ativo && !est.recebimento).map((est) => <option key={est.id} value={est.id}>{est.nome}</option>)}
                </select>
              </label>
              <label className="campo">
                <span>Etapa da EAP</span>
                <select aria-label="Etapa da saída" required disabled={!saida.obraItemId} value={saida.eapNoId} onChange={(e) => setSaida({ ...saida, eapNoId: e.target.value })}>
                  <option value="">Escolha…</option>
                  {etapas.map((n) => <option key={n.id} value={n.id}>{n.codigo} {n.descricao}</option>)}
                </select>
              </label>
              <label className="campo">
                <span>Quantidade{insumoEscolhido ? ` (${insumoEscolhido.unidade})` : ''}</span>
                <input inputMode="decimal" required value={saida.quantidade} onChange={(e) => setSaida({ ...saida, quantidade: e.target.value })} />
                {saida.obraItemId && saida.eapNoId && <small className="muted">Disponível nesta etapa: {num(saldoAtual)}</small>}
              </label>
              <label className="campo">
                <span>Data</span>
                <input type="date" required value={saida.data} onChange={(e) => setSaida({ ...saida, data: e.target.value })} />
              </label>
              <label className="campo">
                <span>Observação</span>
                <input value={saida.observacao} onChange={(e) => setSaida({ ...saida, observacao: e.target.value })} />
              </label>
            </div>
            <div className="acoes">
              <button className="btn btn-primario" type="submit" disabled={ocupado}>{ocupado ? 'Registrando…' : 'Registrar saída'}</button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
