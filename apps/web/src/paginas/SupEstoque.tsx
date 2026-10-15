import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '../api';
import { LeitorCodigo } from '../componentes/LeitorCodigo';
import { qrSvg } from '../qr';

type Apropriacao = { obraId: string; obraCodigo: string; estoqueId: string | null; estoqueNome: string | null; eapNoId: string; eapCodigo: string; eapDescricao: string; quantidade: number };
type ItemEstoque = { obraItemId: string; codigo: string; descricao: string; unidade: string; saldo: number; apropriacoes: Apropriacao[] };
type Obra = { id: string; codigo: string; nome: string };
type NoEap = { id: string; codigo: string; descricao: string };
type InsumoObra = { id: string; codigo: string; descricao: string; unidade: string };
type Estoque = { id: string; codigo: string; nome: string; recebimento: boolean; ativo: boolean; obraId: string | null; obraCodigo: string | null; obraNome: string | null };
type Etiqueta = {
  id: string;
  chave: string;
  data: string;
  quantidade: number;
  saldo: number;
  insumo: { codigo: string; descricao: string; unidade: string };
  obraId: string;
  obraCodigo: string;
  obraNome: string;
  eapNoId: string;
  eapCodigo: string;
  eapDescricao: string;
  estoque: { id: string | null; codigo: string | null; nome: string | null };
};
type Funcionario = { id: string; nome: string; cpf: string | null; funcao: string | null; ativo: boolean };
type SaidaMaterial = { id: string; numero: string; data: string; observacao: string | null; obraCodigo: string; obraNome: string; eapCodigo: string; eapDescricao: string; funcionario: string; entreguePor: string; itens: number };
type ItemSaida = { etiqueta: Etiqueta; quantidade: string };

const hoje = () => new Date().toISOString().slice(0, 10);
const num = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const UUID_RX = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const rotuloEstoque = (e: Pick<Estoque, 'codigo' | 'nome'>) => `${e.codigo} · ${e.nome}`;

/** QR da etiqueta do insumo (a leitura na saída usa o identificador que ele contém). */
function QrEtiqueta({ texto, mm }: { texto: string; mm: number }) {
  const q = useMemo(() => qrSvg(texto), [texto]);
  return (
    <svg className="qr" viewBox={`0 0 ${q.tamanho} ${q.tamanho}`} style={{ width: `${mm}mm`, height: `${mm}mm` }} shapeRendering="crispEdges" role="img" aria-label={`QR: ${texto}`}>
      <rect width={q.tamanho} height={q.tamanho} fill="#fff" />
      <path d={q.caminho} fill="#000" />
    </svg>
  );
}

/** Estoque da construtora: estoques (com código automático), saldo por insumo, etiquetas QR, saídas por leitura e funcionários. */
export function SupEstoque() {
  const [obras, setObras] = useState<Obra[]>([]);
  const [obraId, setObraId] = useState('');
  const [estoques, setEstoques] = useState<Estoque[]>([]);
  const [novoAberto, setNovoAberto] = useState(false);
  const [novo, setNovo] = useState({ nome: '', obraId: '' });
  const [itens, setItens] = useState<ItemEstoque[] | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [insumos, setInsumos] = useState<InsumoObra[]>([]);
  const [etapas, setEtapas] = useState<NoEap[]>([]);
  const [etiquetas, setEtiquetas] = useState<Etiqueta[]>([]);
  const [soComSaldo, setSoComSaldo] = useState(true);
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [novoFunc, setNovoFunc] = useState({ nome: '', cpf: '', funcao: '' });
  const [saidas, setSaidas] = useState<SaidaMaterial[]>([]);
  const [saida, setSaida] = useState({ funcionarioId: '', eapNoId: '', data: hoje(), observacao: '' });
  const [itensSaida, setItensSaida] = useState<ItemSaida[]>([]);
  const [codigo, setCodigo] = useState('');
  const [leitor, setLeitor] = useState(false);
  const [transf, setTransf] = useState({ obraItemId: '', eapNoId: '', origemId: '', destinoId: '', quantidade: '', data: hoje(), observacao: '' });
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const msg = (err: unknown) => setErro((err as Error).message);

  async function carregarEstoques(obra: string) {
    const r = await api<{ estoques: Estoque[] }>(`/sup/estoques${obra ? `?obraId=${obra}` : ''}`);
    setEstoques(r.estoques);
  }

  async function carregarEtiquetas(obra: string) {
    const r = await api<{ etiquetas: Etiqueta[] }>(`/sup/etiquetas?obraId=${obra}&saldo=${soComSaldo ? '1' : '0'}`);
    setEtiquetas(r.etiquetas);
  }

  async function carregarObra(obra: string) {
    const [saldo, etq] = await Promise.all([
      api<{ itens: ItemEstoque[] }>(`/sup/estoque?obraId=${obra}`),
      api<{ etiquetas: Etiqueta[] }>(`/sup/etiquetas?obraId=${obra}&saldo=${soComSaldo ? '1' : '0'}`),
    ]);
    setItens(saldo.itens);
    setEtiquetas(etq.etiquetas);
  }

  async function carregarSaidas() {
    const r = await api<{ saidas: SaidaMaterial[] }>('/sup/saidas-material');
    setSaidas(r.saidas);
  }

  async function carregarFuncionarios() {
    const r = await api<{ funcionarios: Funcionario[] }>('/sup/funcionarios');
    setFuncionarios(r.funcionarios);
  }

  useEffect(() => {
    api<{ obras: Obra[] }>('/eng/obras').then((r) => setObras(r.obras)).catch(() => setObras([]));
    carregarFuncionarios().catch(msg);
    carregarSaidas().catch(msg);
  }, []);

  useEffect(() => {
    setErro(null); setAviso(null); setAberto(null);
    setItensSaida([]); setCodigo('');
    setSaida({ funcionarioId: '', eapNoId: '', data: hoje(), observacao: '' });
    setTransf({ obraItemId: '', eapNoId: '', origemId: '', destinoId: '', quantidade: '', data: hoje(), observacao: '' });
    setInsumos([]);
    setEtapas([]);
    carregarEstoques(obraId).catch(msg);
    if (!obraId) { setItens(null); setEtiquetas([]); return; }
    carregarObra(obraId).catch(msg);
    api<{ itens: InsumoObra[] }>(`/eng/obras/${obraId}/itens?tipo=insumo`).then((r) => setInsumos(r.itens)).catch(() => setInsumos([]));
    api<{ nos: NoEap[] }>(`/eng/obras/${obraId}/eap`).then((r) => setEtapas(r.nos)).catch(() => setEtapas([]));
  }, [obraId]);

  useEffect(() => {
    if (obraId) carregarEtiquetas(obraId).catch(msg);
  }, [soComSaldo]);

  async function criarEstoque(e: FormEvent) {
    e.preventDefault();
    setErro(null); setAviso(null);
    try {
      const r = await api<{ codigo: string }>('/sup/estoques', { metodo: 'POST', corpo: { nome: novo.nome, ...(novo.obraId ? { obraId: novo.obraId } : {}) } });
      setNovo({ nome: '', obraId: '' });
      setNovoAberto(false);
      setAviso(`Estoque ${r.codigo} criado.`);
      await carregarEstoques(obraId);
    } catch (err) {
      msg(err);
    }
  }

  async function alternarEstoque(est: Estoque) {
    setErro(null); setAviso(null);
    try {
      await api(`/sup/estoques/${est.id}`, { metodo: 'PUT', corpo: { ativo: !est.ativo } });
      await carregarEstoques(obraId);
    } catch (err) {
      msg(err);
    }
  }

  async function criarFuncionario(e: FormEvent) {
    e.preventDefault();
    setErro(null); setAviso(null);
    try {
      await api('/sup/funcionarios', { metodo: 'POST', corpo: { nome: novoFunc.nome, cpf: novoFunc.cpf || undefined, funcao: novoFunc.funcao || undefined } });
      setNovoFunc({ nome: '', cpf: '', funcao: '' });
      setAviso('Funcionário cadastrado.');
      await carregarFuncionarios();
    } catch (err) {
      msg(err);
    }
  }

  async function alternarFuncionario(f: Funcionario) {
    setErro(null); setAviso(null);
    try {
      await api(`/sup/funcionarios/${f.id}`, { metodo: 'PUT', corpo: { ativo: !f.ativo } });
      await carregarFuncionarios();
    } catch (err) {
      msg(err);
    }
  }

  /** Lê uma etiqueta (código digitado ou QR) e a põe na saída, se for desta obra, com saldo e da mesma etapa. */
  async function lerEtiqueta(texto: string) {
    setErro(null); setAviso(null);
    const id = texto.match(UUID_RX)?.[0]?.toLowerCase();
    if (!id) { setErro('Este código não é de etiqueta do estoque. Leia a etiqueta do insumo.'); return; }
    if (itensSaida.some((i) => i.etiqueta.id === id)) { setErro('Esta etiqueta já está na saída.'); return; }
    try {
      const r = await api<{ etiqueta: Etiqueta }>(`/sup/etiquetas/${id}`);
      const e = r.etiqueta;
      if (e.obraId !== obraId) { setErro(`Esta etiqueta é da obra ${e.obraCodigo}.`); return; }
      if (e.saldo <= 0) { setErro('Esta etiqueta não tem saldo.'); return; }
      if (saida.eapNoId && e.eapNoId !== saida.eapNoId) { setErro(`Este insumo está apropriado à etapa ${e.eapCodigo}. Use outra saída para ele.`); return; }
      setItensSaida((lista) => [...lista, { etiqueta: e, quantidade: '' }]);
      if (!saida.eapNoId) setSaida((s) => ({ ...s, eapNoId: e.eapNoId }));
      setCodigo('');
    } catch (err) {
      msg(err);
    }
  }

  async function registrarSaida(e: FormEvent) {
    e.preventDefault();
    setErro(null); setAviso(null);
    if (!itensSaida.length) { setErro('Leia ao menos uma etiqueta.'); return; }
    setOcupado(true);
    try {
      const r = await api<{ numero: string }>('/sup/saidas-material', {
        metodo: 'POST',
        corpo: {
          obraId,
          eapNoId: saida.eapNoId,
          funcionarioId: saida.funcionarioId,
          data: saida.data,
          observacao: saida.observacao || null,
          itens: itensSaida.map((i) => ({ etiquetaId: i.etiqueta.id, quantidade: i.quantidade })),
        },
      });
      setAviso(`Saída ${r.numero} registrada.`);
      setItensSaida([]);
      setSaida({ funcionarioId: '', eapNoId: '', data: hoje(), observacao: '' });
      await Promise.all([carregarObra(obraId), carregarSaidas()]);
    } catch (err) {
      msg(err);
    } finally {
      setOcupado(false);
    }
  }

  async function registrarTransferencia(e: FormEvent) {
    e.preventDefault();
    setErro(null); setAviso(null);
    setOcupado(true);
    try {
      await api('/sup/estoque/transferencias', {
        metodo: 'POST',
        corpo: { obraId, obraItemId: transf.obraItemId, eapNoId: transf.eapNoId, origemId: transf.origemId, destinoId: transf.destinoId, data: transf.data, quantidade: transf.quantidade, observacao: transf.observacao || null },
      });
      setAviso('Transferência registrada.');
      setTransf({ obraItemId: '', eapNoId: '', origemId: '', destinoId: '', quantidade: '', data: hoje(), observacao: '' });
      await carregarObra(obraId);
    } catch (err) {
      msg(err);
    } finally {
      setOcupado(false);
    }
  }

  const insumoEscolhido = (obraItemId: string) => insumos.find((i) => i.id === obraItemId);
  const saldoDo = (obraItemId: string, eapNoId: string, estoqueId: string) =>
    itens?.find((i) => i.obraItemId === obraItemId)?.apropriacoes.find((a) => a.eapNoId === eapNoId && (a.estoqueId ?? '') === estoqueId)?.quantidade ?? 0;
  const saldoTransf = saldoDo(transf.obraItemId, transf.eapNoId, transf.origemId);
  const estoquesAtivos = estoques.filter((x) => x.ativo);
  const etapaDaSaida = etapas.find((n) => n.id === saida.eapNoId);

  return (
    <div className="pagina">
      <header className="cabecalho-pagina">
        <h1>Estoque</h1>
        <p className="muted">As entradas das notas de compra viram etiquetas com QR code, uma por insumo recebido. A saída para a obra é feita lendo essa etiqueta.</p>
      </header>

      <div className="card">
        <label className="campo">
          <span>Obra</span>
          <select aria-label="Obra do estoque" value={obraId} onChange={(e) => setObraId(e.target.value)}>
            <option value="">Todas as obras (estoques e funcionários)</option>
            {obras.map((o) => <option key={o.id} value={o.id}>{o.codigo} · {o.nome}</option>)}
          </select>
        </label>
      </div>

      {erro && <div className="alerta alerta-erro">{erro}</div>}
      {aviso && <div className="alerta alerta-ok">{aviso}</div>}

      <div className="card">
        <div className="cabecalho" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
          <h2>Estoques</h2>
          <button className="btn btn-primario" type="button" onClick={() => setNovoAberto((v) => !v)}>{novoAberto ? 'Fechar' : 'Novo estoque'}</button>
        </div>
        <p className="muted small">Cada estoque tem código automático (EST-####). Vinculado a uma obra, ele recebe insumos dela; sem obra, é um estoque geral.</p>

        {novoAberto && (
          <form className="campos" onSubmit={criarEstoque} aria-label="Cadastro de estoque">
            <label className="campo">
              <span>Nome</span>
              <input aria-label="Nome do novo estoque" required minLength={2} maxLength={60} value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
            </label>
            <label className="campo">
              <span>Vincular à obra</span>
              <select aria-label="Obra do novo estoque" value={novo.obraId} onChange={(e) => setNovo({ ...novo, obraId: e.target.value })}>
                <option value="">Sem obra (estoque geral)</option>
                {obras.map((o) => <option key={o.id} value={o.id}>{o.codigo} · {o.nome}</option>)}
              </select>
            </label>
            <label className="campo">
              <span>Código</span>
              <input value="Automático (EST-####)" disabled />
            </label>
            <div className="acoes">
              <button className="btn btn-primario" type="submit">Criar estoque</button>
              <button className="btn btn-link" type="button" onClick={() => setNovoAberto(false)}>Cancelar</button>
            </div>
          </form>
        )}

        {estoques.length === 0 ? (
          <p className="muted">Nenhum estoque cadastrado{obraId ? ' para esta obra' : ''}.</p>
        ) : (
          <table className="tabela">
            <thead><tr><th>Código</th><th>Nome</th><th>Vínculo</th><th>Situação</th><th /></tr></thead>
            <tbody>
              {estoques.map((est) => (
                <tr key={est.id}>
                  <td>{est.codigo}</td>
                  <td>{est.nome}</td>
                  <td>{est.obraId ? `${est.obraCodigo} · ${est.obraNome}` : 'Geral (sem obra)'}</td>
                  <td>{est.recebimento ? 'Recebimento' : est.ativo ? 'Ativo' : 'Inativo'}</td>
                  <td>{!est.recebimento && <button className="btn btn-link" type="button" onClick={() => alternarEstoque(est)}>{est.ativo ? 'Desativar' : 'Ativar'}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {obraId && (
        <>
          <div className="card">
            <h2>Saldo por insumo</h2>
            {itens === null ? <p className="muted">Carregando…</p> : itens.length === 0 ? (
              <p className="muted">Nenhum insumo em estoque nesta obra. As entradas aparecem quando a nota de compra é recebida com obra, insumo e etapa.</p>
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
                          ? it.apropriacoes.map((a) => <div key={`${a.estoqueId}-${a.eapNoId}`}>{a.estoqueNome ?? 'Recebimento'} · {a.eapCodigo} {a.eapDescricao}: {num(a.quantidade)} {it.unidade}</div>)
                          : `${it.apropriacoes.length} etapa(s) · clique para ver`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <div className="cabecalho" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
              <h2>Etiquetas (QR)</h2>
              <div className="acoes">
                <label className="small"><input type="checkbox" checked={soComSaldo} onChange={(e) => setSoComSaldo(e.target.checked)} /> Somente com saldo</label>
                <button className="btn btn-link nao-imprimir" type="button" onClick={() => window.print()}>Imprimir</button>
              </div>
            </div>
            <p className="muted small">Uma etiqueta por insumo recebido. Cole-a no material; na saída, a leitura do QR confere obra, etapa e saldo.</p>
            {etiquetas.length === 0 ? <p className="muted">Nenhuma etiqueta{soComSaldo ? ' com saldo' : ''} nesta obra.</p> : (
              <table className="tabela">
                <thead><tr><th>QR</th><th>Insumo</th><th>Entrada</th><th className="n">Qtd.</th><th className="n">Saldo</th><th>Etapa</th><th>Estoque</th></tr></thead>
                <tbody>
                  {etiquetas.map((q) => (
                    <tr key={q.id}>
                      <td><QrEtiqueta texto={q.chave} mm={14} /></td>
                      <td>{q.insumo.codigo} · {q.insumo.descricao}</td>
                      <td>{q.data}</td>
                      <td className="n">{num(q.quantidade)} {q.insumo.unidade}</td>
                      <td className="n">{num(q.saldo)} {q.insumo.unidade}</td>
                      <td>{q.eapCodigo} {q.eapDescricao}</td>
                      <td>{q.estoque.codigo ? `${q.estoque.codigo} · ${q.estoque.nome}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <form className="card form" onSubmit={registrarSaida}>
            <h2>Saída de material</h2>
            <p className="muted small">Leia a etiqueta de cada insumo que sai. Todos os insumos da saída devem ser da mesma etapa.</p>
            <div className="campos">
              <label className="campo">
                <span>Funcionário que pegou</span>
                <select aria-label="Funcionário da saída" required value={saida.funcionarioId} onChange={(e) => setSaida({ ...saida, funcionarioId: e.target.value })}>
                  <option value="">Escolha…</option>
                  {funcionarios.filter((f) => f.ativo).map((f) => <option key={f.id} value={f.id}>{f.nome}{f.funcao ? ` · ${f.funcao}` : ''}</option>)}
                </select>
              </label>
              <label className="campo">
                <span>Etapa da EAP</span>
                <select aria-label="Etapa da saída" required value={saida.eapNoId} onChange={(e) => setSaida({ ...saida, eapNoId: e.target.value })}>
                  <option value="">Escolha…</option>
                  {etapas.map((n) => <option key={n.id} value={n.id}>{n.codigo} {n.descricao}</option>)}
                </select>
              </label>
              <label className="campo">
                <span>Data</span>
                <input type="date" required value={saida.data} onChange={(e) => setSaida({ ...saida, data: e.target.value })} />
              </label>
              <label className="campo">
                <span>Observações</span>
                <input maxLength={500} value={saida.observacao} onChange={(e) => setSaida({ ...saida, observacao: e.target.value })} />
              </label>
            </div>

            <div className="campos">
              <label className="campo">
                <span>Código da etiqueta</span>
                <input aria-label="Código da etiqueta" value={codigo} onChange={(e) => setCodigo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (codigo.trim()) lerEtiqueta(codigo); } }} />
              </label>
            </div>
            <div className="acoes">
              <button className="btn btn-secundario" type="button" disabled={!codigo.trim()} onClick={() => lerEtiqueta(codigo)}>Adicionar</button>
              <button className="btn btn-secundario" type="button" onClick={() => setLeitor(true)}>Ler QR com a câmera</button>
            </div>

            {itensSaida.length > 0 && (
              <table className="tabela">
                <thead><tr><th>Insumo</th><th>Etapa</th><th className="n">Saldo</th><th className="n">Quantidade</th><th /></tr></thead>
                <tbody>
                  {itensSaida.map((i, idx) => (
                    <tr key={i.etiqueta.id}>
                      <td>{i.etiqueta.insumo.codigo} · {i.etiqueta.insumo.descricao}</td>
                      <td>{i.etiqueta.eapCodigo}</td>
                      <td className="n">{num(i.etiqueta.saldo)} {i.etiqueta.insumo.unidade}</td>
                      <td className="n">
                        <input aria-label={`Quantidade de ${i.etiqueta.insumo.descricao}`} inputMode="decimal" required value={i.quantidade} onChange={(e) => setItensSaida((lista) => lista.map((x, k) => (k === idx ? { ...x, quantidade: e.target.value } : x)))} />
                      </td>
                      <td><button className="btn btn-link" type="button" onClick={() => setItensSaida((lista) => lista.filter((_, k) => k !== idx))}>Remover</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="acoes">
              <button className="btn btn-primario" type="submit" disabled={ocupado || itensSaida.length === 0}>{ocupado ? 'Registrando…' : `Registrar saída${etapaDaSaida ? ` · ${etapaDaSaida.codigo}` : ''}`}</button>
            </div>
          </form>

          <div className="card">
            <h2>Últimas saídas</h2>
            {saidas.length === 0 ? <p className="muted">Nenhuma saída registrada.</p> : (
              <table className="tabela">
                <thead><tr><th>Saída</th><th>Data</th><th>Obra</th><th>Etapa</th><th>Funcionário</th><th>Entregue por</th><th className="n">Insumos</th></tr></thead>
                <tbody>
                  {saidas.map((s) => (
                    <tr key={s.id}>
                      <td>{s.numero}</td>
                      <td>{s.data}</td>
                      <td>{s.obraCodigo}</td>
                      <td>{s.eapCodigo} {s.eapDescricao}</td>
                      <td>{s.funcionario}</td>
                      <td>{s.entreguePor}</td>
                      <td className="n">{s.itens}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <form className="card form" onSubmit={registrarTransferencia}>
            <h2>Transferir entre estoques</h2>
            <p className="muted small">Sai do estoque de origem e entra no de destino, na mesma etapa e data. A etiqueta continua com o estoque de origem.</p>
            <div className="campos">
              <label className="campo">
                <span>Insumo da obra</span>
                <select aria-label="Insumo da transferência" required value={transf.obraItemId} onChange={(e) => setTransf({ ...transf, obraItemId: e.target.value, eapNoId: '' })}>
                  <option value="">Escolha…</option>
                  {insumos.map((i) => <option key={i.id} value={i.id}>{i.codigo} · {i.descricao}</option>)}
                </select>
              </label>
              <label className="campo">
                <span>Etapa da EAP</span>
                <select aria-label="Etapa da transferência" required disabled={!transf.obraItemId} value={transf.eapNoId} onChange={(e) => setTransf({ ...transf, eapNoId: e.target.value })}>
                  <option value="">Escolha…</option>
                  {etapas.map((n) => <option key={n.id} value={n.id}>{n.codigo} {n.descricao}</option>)}
                </select>
              </label>
              <label className="campo">
                <span>Estoque de origem</span>
                <select aria-label="Estoque de origem" required value={transf.origemId} onChange={(e) => setTransf({ ...transf, origemId: e.target.value })}>
                  <option value="">Escolha…</option>
                  {estoquesAtivos.map((est) => <option key={est.id} value={est.id}>{rotuloEstoque(est)}</option>)}
                </select>
              </label>
              <label className="campo">
                <span>Estoque de destino</span>
                <select aria-label="Estoque de destino" required value={transf.destinoId} onChange={(e) => setTransf({ ...transf, destinoId: e.target.value })}>
                  <option value="">Escolha…</option>
                  {estoquesAtivos.filter((est) => est.id !== transf.origemId).map((est) => <option key={est.id} value={est.id}>{rotuloEstoque(est)}</option>)}
                </select>
              </label>
              <label className="campo">
                <span>Quantidade{insumoEscolhido(transf.obraItemId) ? ` (${insumoEscolhido(transf.obraItemId)!.unidade})` : ''}</span>
                <input inputMode="decimal" required value={transf.quantidade} onChange={(e) => setTransf({ ...transf, quantidade: e.target.value })} />
                {transf.origemId && transf.eapNoId && transf.obraItemId && <small className="muted">Disponível na origem: {num(saldoTransf)}</small>}
              </label>
              <label className="campo">
                <span>Data</span>
                <input type="date" required value={transf.data} onChange={(e) => setTransf({ ...transf, data: e.target.value })} />
              </label>
              <label className="campo">
                <span>Observação</span>
                <input value={transf.observacao} onChange={(e) => setTransf({ ...transf, observacao: e.target.value })} />
              </label>
            </div>
            <div className="acoes">
              <button className="btn btn-secundario" type="submit" disabled={ocupado}>{ocupado ? 'Registrando…' : 'Registrar transferência'}</button>
            </div>
          </form>
        </>
      )}

      <div className="card">
        <h2>Funcionários</h2>
        <p className="muted small">Quem pega o material na saída. Só os ativos aparecem na saída.</p>
        {funcionarios.length > 0 && (
          <table className="tabela">
            <thead><tr><th>Nome</th><th>Função</th><th>CPF</th><th>Situação</th><th /></tr></thead>
            <tbody>
              {funcionarios.map((f) => (
                <tr key={f.id}>
                  <td>{f.nome}</td>
                  <td>{f.funcao ?? '—'}</td>
                  <td>{f.cpf ?? '—'}</td>
                  <td>{f.ativo ? 'Ativo' : 'Inativo'}</td>
                  <td><button className="btn btn-link" type="button" onClick={() => alternarFuncionario(f)}>{f.ativo ? 'Desativar' : 'Ativar'}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form className="campos" onSubmit={criarFuncionario}>
          <label className="campo">
            <span>Nome</span>
            <input aria-label="Nome do funcionário" required minLength={2} maxLength={120} value={novoFunc.nome} onChange={(e) => setNovoFunc({ ...novoFunc, nome: e.target.value })} />
          </label>
          <label className="campo">
            <span>Função</span>
            <input aria-label="Função do funcionário" maxLength={60} value={novoFunc.funcao} onChange={(e) => setNovoFunc({ ...novoFunc, funcao: e.target.value })} />
          </label>
          <label className="campo">
            <span>CPF (opcional)</span>
            <input aria-label="CPF do funcionário" inputMode="numeric" value={novoFunc.cpf} onChange={(e) => setNovoFunc({ ...novoFunc, cpf: e.target.value })} />
          </label>
          <div className="acoes">
            <button className="btn btn-secundario" type="submit">Cadastrar funcionário</button>
          </div>
        </form>
      </div>

      {leitor && <LeitorCodigo aoLer={(chave) => lerEtiqueta(chave)} aoFechar={() => setLeitor(false)} ocupado={ocupado} />}
    </div>
  );
}
