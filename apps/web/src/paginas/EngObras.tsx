// Engenharia · Obras: cadastro (centro de custo, nível de apropriação, BDI), insumos e serviços copiados de uma tabela,
// EAP com os mesmos níveis e orçamento lançado por nó da EAP.
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, formatarMoeda, lerNumero } from '../api';
import type { Tabela } from './EngTabelas';

export type Nivel = 'obra' | 'etapa' | 'subetapa' | 'tarefa';
export type Obra = {
  id: string; codigo: string; nome: string; endereco: string | null; cidade: string | null; uf: string | null; responsavel: string | null;
  status: string; dataInicio: string | null; dataPrevisao: string | null; nivelApropriacao: Nivel; bdiPercentual: number;
  bdiModo: 'calculado' | 'informado'; bdiParametros: Partial<Record<CampoBdi, number>> | null;
  centroCustoId: string; centroCustoNome: string | null; itens?: number; linhasOrcamento?: number; total?: number;
};
type ItemObra = { id: string; tipo: 'insumo' | 'composicao'; codigo: string; descricao: string; unidade: string; preco: number | null; precoReferencia: number | null; editado: boolean; origem: string | null; componentes: number };
type No = { id: string; paiId: string | null; nivel: Exclude<Nivel, 'obra'>; codigo: string; descricao: string; itens: number; subtotal: number | null };
type LinhaOrc = { id: string; eapNoId: string | null; eapCodigo: string | null; eapDescricao: string | null; itemId: string; tipo: string; codigo: string; descricao: string; unidade: string; editado: boolean; quantidade: number; precoUnitario: number | null; total: number };
type Orcamento = { nivelApropriacao: Nivel; bdiPercentual: number; subtotal: number; bdi: number; total: number; linhas: LinhaOrc[] };
type ItemCatalogo = { id: string; tipo: 'insumo' | 'composicao'; codigo: string; descricao: string; unidade: string; preco: number | null };

export const ROTULO_NIVEL: Record<Nivel, string> = { obra: 'Obra', etapa: 'Etapa', subetapa: 'Subetapa', tarefa: 'Tarefa' };
const ORDEM: Record<Nivel, number> = { obra: 0, etapa: 1, subetapa: 2, tarefa: 3 };
// Nível do filho de cada nó da EAP (a raiz é sempre Etapa).
const FILHO: Partial<Record<Nivel, Nivel>> = { etapa: 'subetapa', subetapa: 'tarefa' };
const ROTULO_STATUS: Record<string, string> = { orcamento: 'Em orçamento', planejamento: 'Planejamento', em_andamento: 'Em andamento', suspensa: 'Suspensa', concluida: 'Concluída' };
const LIMITE_CATALOGO = 200;

export function EngObras() {
  const [obras, setObras] = useState<Obra[] | null>(null);
  const [erro, setErro] = useState('');
  const [nova, setNova] = useState(false);
  const navegar = useNavigate();
  const carregar = () => api<{ obras: Obra[] }>('/eng/obras').then((r) => setObras(r.obras)).catch((e) => setErro((e as Error).message));
  useEffect(() => {
    carregar();
  }, []);

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Obras</h1>
          <span className="muted">Cadastro de obras com centro de custo, nível de apropriação e BDI.</span>
        </div>
        <div className="acoes">
          <button className="btn btn-primario" type="button" onClick={() => setNova(!nova)} aria-expanded={nova}>{nova ? 'Fechar' : 'Nova obra'}</button>
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {nova && <FormObra aoSalvar={(o) => navegar(`/eng/obras/${o.id}`)} />}
      {obras === null && !erro && <p className="muted">Carregando…</p>}
      {obras?.length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>Nenhuma obra cadastrada.</p></div>}
      {obras && obras.length > 0 && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="tabela">
            <thead>
              <tr>
                <th>Código</th>
                <th>Obra</th>
                <th>Nível de apropriação</th>
                <th>Centro de custo</th>
                <th>Status</th>
                <th className="num">Itens</th>
                <th className="num">Orçamento (c/ BDI)</th>
              </tr>
            </thead>
            <tbody>
              {obras.map((o) => (
                <tr key={o.id}>
                  <td>{o.codigo}</td>
                  <td><Link to={`/eng/obras/${o.id}`}>{o.nome}</Link></td>
                  <td>{ROTULO_NIVEL[o.nivelApropriacao]}</td>
                  <td>{o.centroCustoNome ?? '—'}</td>
                  <td>{ROTULO_STATUS[o.status] ?? o.status}</td>
                  <td className="num">{o.itens ?? 0}</td>
                  <td className="num">{formatarMoeda(o.total ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function EngObraNova() {
  const navegar = useNavigate();
  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Nova obra</h1>
          <span className="muted">Um centro de custo é criado automaticamente para a obra.</span>
        </div>
      </div>
      <FormObra aoSalvar={(o) => navegar(`/eng/obras/${o.id}`)} aoCancelar={() => navegar('/eng/obras')} />
    </>
  );
}

type CampoBdi = 'ac' | 's' | 'r' | 'g' | 'df' | 'l' | 'i';
const CAMPOS_BDI: [CampoBdi, string][] = [
  ['ac', 'Administração central (AC) %'],
  ['s', 'Seguros (S) %'],
  ['r', 'Riscos (R) %'],
  ['g', 'Garantias (G) %'],
  ['df', 'Despesas financeiras (DF) %'],
  ['l', 'Lucro (L) %'],
  ['i', 'Tributos: PIS, COFINS e ISS (I) %'],
];

/** Mesma fórmula da API (TCU, Acórdão 2622/2013), só para mostrar a prévia; quem grava é a API. */
export function bdiCalculadoPrevia(p: Partial<Record<CampoBdi, number>>): number {
  const f = (k: CampoBdi) => (p[k] ?? 0) / 100;
  const bdi = ((1 + f('ac') + f('s') + f('r') + f('g')) * (1 + f('df')) * (1 + f('l'))) / (1 - f('i')) - 1;
  return Math.round(bdi * 10000) / 100;
}

const paraTexto = (n: number | undefined) => String(n ?? 0).replace('.', ',');

type DadosForm = { codigo: string; nome: string; endereco: string; cidade: string; uf: string; responsavel: string; status: string; dataInicio: string; dataPrevisao: string; nivelApropriacao: Nivel; bdiModo: 'calculado' | 'informado'; bdi: string; params: Record<CampoBdi, string> };

function FormObra({ inicial, aoSalvar, aoCancelar }: { inicial?: Obra; aoSalvar: (o: Obra) => void; aoCancelar?: () => void }) {
  const editando = !!inicial;
  const [d, setD] = useState<DadosForm>({
    codigo: inicial?.codigo ?? '',
    nome: inicial?.nome ?? '',
    endereco: inicial?.endereco ?? '',
    cidade: inicial?.cidade ?? '',
    uf: inicial?.uf ?? '',
    responsavel: inicial?.responsavel ?? '',
    status: inicial?.status ?? 'planejamento',
    dataInicio: inicial?.dataInicio ?? '',
    dataPrevisao: inicial?.dataPrevisao ?? '',
    nivelApropriacao: inicial?.nivelApropriacao ?? 'etapa',
    bdiModo: inicial?.bdiModo ?? 'informado',
    bdi: paraTexto(inicial?.bdiPercentual),
    params: Object.fromEntries(CAMPOS_BDI.map(([k]) => [k, paraTexto(inicial?.bdiParametros?.[k])])) as Record<CampoBdi, string>,
  });
  const paramsNumericos = Object.fromEntries(CAMPOS_BDI.map(([k]) => [k, lerNumero(d.params[k]) ?? 0])) as Record<CampoBdi, number>;
  const previaBdi = bdiCalculadoPrevia(paramsNumericos);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setOcupado(true);
    const corpo = {
      ...(editando ? {} : { codigo: d.codigo.trim() || undefined }),
      nome: d.nome.trim(),
      endereco: d.endereco.trim() || null,
      cidade: d.cidade.trim() || null,
      uf: d.uf.trim().toUpperCase() || null,
      responsavel: d.responsavel.trim() || null,
      status: d.status,
      dataInicio: d.dataInicio || null,
      dataPrevisao: d.dataPrevisao || null,
      nivelApropriacao: d.nivelApropriacao,
      bdiModo: d.bdiModo,
      ...(d.bdiModo === 'calculado' ? { bdiParametros: paramsNumericos } : { bdiPercentual: lerNumero(d.bdi) ?? 0 }),
    };
    try {
      const r = await api<{ obra: Obra }>(editando ? `/eng/obras/${inicial!.id}` : '/eng/obras', { metodo: editando ? 'PUT' : 'POST', corpo });
      aoSalvar(r.obra);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form className="card form" onSubmit={salvar}>
      <h2 style={{ margin: 0 }}>{editando ? 'Dados da obra' : 'Nova obra'}</h2>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        {!editando && (
          <div className="campo">
            <label htmlFor="ob-codigo">Código</label>
            <input id="ob-codigo" placeholder="Automático (OB-0001)" value={d.codigo} onChange={(e) => setD({ ...d, codigo: e.target.value })} />
          </div>
        )}
        <div className="campo" style={{ gridColumn: 'span 2' }}>
          <label htmlFor="ob-nome">Nome da obra</label>
          <input id="ob-nome" value={d.nome} onChange={(e) => setD({ ...d, nome: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="ob-status">Status</label>
          <select id="ob-status" value={d.status} onChange={(e) => setD({ ...d, status: e.target.value })}>
            {Object.entries(ROTULO_STATUS).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </select>
        </div>
        <div className="campo" style={{ gridColumn: 'span 2' }}>
          <label htmlFor="ob-endereco">Endereço</label>
          <input id="ob-endereco" value={d.endereco} onChange={(e) => setD({ ...d, endereco: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="ob-cidade">Cidade</label>
          <input id="ob-cidade" value={d.cidade} onChange={(e) => setD({ ...d, cidade: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="ob-uf">UF</label>
          <input id="ob-uf" maxLength={2} value={d.uf} onChange={(e) => setD({ ...d, uf: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="ob-resp">Responsável</label>
          <input id="ob-resp" value={d.responsavel} onChange={(e) => setD({ ...d, responsavel: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="ob-ini">Início</label>
          <input id="ob-ini" type="date" value={d.dataInicio} onChange={(e) => setD({ ...d, dataInicio: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="ob-prev">Previsão de término</label>
          <input id="ob-prev" type="date" value={d.dataPrevisao} onChange={(e) => setD({ ...d, dataPrevisao: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="ob-nivel">Nível de apropriação</label>
          <select id="ob-nivel" value={d.nivelApropriacao} onChange={(e) => setD({ ...d, nivelApropriacao: e.target.value as Nivel })}>
            {(Object.keys(ROTULO_NIVEL) as Nivel[]).map((n) => <option key={n} value={n}>{ROTULO_NIVEL[n]}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="ob-bdi-modo">BDI</label>
          <select id="ob-bdi-modo" value={d.bdiModo} onChange={(e) => setD({ ...d, bdiModo: e.target.value as 'calculado' | 'informado' })}>
            <option value="informado">Informado</option>
            <option value="calculado">Calculado</option>
          </select>
        </div>
        {d.bdiModo === 'informado' ? (
          <div className="campo">
            <label htmlFor="ob-bdi">BDI informado (%)</label>
            <input id="ob-bdi" inputMode="decimal" value={d.bdi} onChange={(e) => setD({ ...d, bdi: e.target.value })} />
          </div>
        ) : (
          <div className="campo" style={{ gridColumn: 'span 2' }}>
            <span className="ajuda">BDI calculado: <b>{paraTexto(previaBdi)}%</b>. Preencha os componentes abaixo (valores em %).</span>
          </div>
        )}
      </div>
      {d.bdiModo === 'calculado' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          {CAMPOS_BDI.map(([k, rotulo]) => (
            <div className="campo" key={k}>
              <label htmlFor={`ob-bdi-${k}`}>{rotulo}</label>
              <input id={`ob-bdi-${k}`} inputMode="decimal" value={d.params[k]} onChange={(e) => setD({ ...d, params: { ...d.params, [k]: e.target.value } })} />
            </div>
          ))}
        </div>
      )}
      <span className="ajuda">
        O nível define onde o orçamento é lançado: <b>Obra</b> (sem EAP), <b>Etapa</b>, <b>Subetapa</b> ou <b>Tarefa</b>. Depois de haver itens no orçamento, o nível só muda após removê-los.
      </span>
      <div className="acoes">
        {aoCancelar && <button className="btn" type="button" onClick={aoCancelar}>Cancelar</button>}
        <button className="btn btn-primario" type="submit" disabled={ocupado || d.nome.trim().length < 2}>{ocupado ? 'Salvando…' : editando ? 'Salvar dados' : 'Criar obra'}</button>
      </div>
    </form>
  );
}

export function EngObraDetalhe() {
  const { id } = useParams();
  const [obra, setObra] = useState<Obra | null>(null);
  const [itens, setItens] = useState<ItemObra[]>([]);
  const [nos, setNos] = useState<No[]>([]);
  const [orc, setOrc] = useState<Orcamento | null>(null);
  const [aba, setAba] = useState<'dados' | 'insumos' | 'eap'>('dados');
  const [erro, setErro] = useState('');

  const recarregar = () =>
    Promise.all([
      api<{ obra: Obra }>(`/eng/obras/${id}`).then((r) => setObra(r.obra)),
      api<{ itens: ItemObra[] }>(`/eng/obras/${id}/itens`).then((r) => setItens(r.itens)),
      api<{ nos: No[] }>(`/eng/obras/${id}/eap`).then((r) => setNos(r.nos)),
      api<Orcamento>(`/eng/obras/${id}/orcamento`).then((r) => setOrc(r)),
    ])
      .then(() => setErro(''))
      .catch((e) => setErro((e as Error).message));

  useEffect(() => {
    recarregar();
  }, [id]);

  if (!obra) return erro ? <div className="alerta alerta-erro" role="alert">{erro}</div> : <p className="muted">Carregando…</p>;

  const abas: [typeof aba, string][] = [
    ['dados', 'Dados'],
    ['insumos', 'Insumos e serviços'],
    ['eap', 'EAP e orçamento'],
  ];

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>{obra.codigo} · {obra.nome}</h1>
          <span className="muted">
            Nível {ROTULO_NIVEL[obra.nivelApropriacao]} · BDI {String(obra.bdiPercentual).replace('.', ',')}% · Centro de custo: {obra.centroCustoNome ?? '—'}
          </span>
        </div>
        <div className="acoes">
          <Link className="btn" to="/eng/obras">Todas as obras</Link>
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div className="abas" role="tablist">
        {abas.map(([v, r]) => (
          <button key={v} type="button" role="tab" aria-selected={aba === v} className={aba === v ? 'ativa' : ''} onClick={() => setAba(v)}>{r}</button>
        ))}
      </div>

      {aba === 'dados' && <FormObra inicial={obra} aoSalvar={() => recarregar()} />}

      {aba === 'insumos' && <AbaInsumos obraId={obra.id} itens={itens} aoMudar={recarregar} setErro={setErro} />}

      {aba === 'eap' && <AbaEap obra={obra} nos={nos} itens={itens} orc={orc} aoMudar={recarregar} setErro={setErro} />}
    </>
  );
}

function AbaInsumos({ obraId, itens, aoMudar, setErro }: { obraId: string; itens: ItemObra[]; aoMudar: () => void; setErro: (m: string) => void }) {
  const [tabelas, setTabelas] = useState<Tabela[]>([]);
  const [tabelaId, setTabelaId] = useState('');
  const [catalogo, setCatalogo] = useState<ItemCatalogo[]>([]);
  const [busca, setBusca] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [novoPreco, setNovoPreco] = useState('');

  useEffect(() => {
    api<{ tabelas: Tabela[] }>('/eng/tabelas')
      .then((r) => {
        setTabelas(r.tabelas);
        if (r.tabelas[0]) setTabelaId(r.tabelas[0].id);
      })
      .catch((e) => setErro((e as Error).message));
  }, []);

  useEffect(() => {
    if (!tabelaId) return;
    setSel(new Set());
    api<{ itens: ItemCatalogo[] }>(`/eng/tabelas/${tabelaId}/itens`)
      .then((r) => setCatalogo(r.itens))
      .catch((e) => setErro((e as Error).message));
  }, [tabelaId]);

  const termo = busca.trim().toLowerCase();
  const filtrados = catalogo.filter((i) => !termo || i.codigo.toLowerCase().includes(termo) || i.descricao.toLowerCase().includes(termo));

  function alternar(id: string) {
    const n = new Set(sel);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setSel(n);
  }

  async function copiar() {
    setErro('');
    setMsg('');
    const composicaoIds = catalogo.filter((i) => sel.has(i.id) && i.tipo === 'composicao').map((i) => i.id);
    const insumoIds = catalogo.filter((i) => sel.has(i.id) && i.tipo === 'insumo').map((i) => i.id);
    try {
      const r = await api<{ importados: { insumos: number; composicoes: number }; jaExistiam: number }>(`/eng/obras/${obraId}/importar`, {
        metodo: 'POST',
        corpo: { tabelaId, composicaoIds, insumoIds },
      });
      setMsg(`Copiados para a obra: ${r.importados.composicoes} serviço(s) e ${r.importados.insumos} insumo(s). ${r.jaExistiam} já estavam na obra.`);
      setSel(new Set());
      aoMudar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function salvarPreco(item: ItemObra) {
    setErro('');
    const v = lerNumero(novoPreco);
    if (v === null || v < 0) return setErro('Informe um preço válido.');
    try {
      await api(`/eng/obras/${obraId}/itens/${item.id}`, { metodo: 'PATCH', corpo: { preco: v } });
      setEditando(null);
      aoMudar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function excluir(item: ItemObra) {
    setErro('');
    try {
      await api(`/eng/obras/${obraId}/itens/${item.id}`, { metodo: 'DELETE' });
      aoMudar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Insumos e serviços da obra</h2>
        <span className="ajuda">Os itens são cópias da tabela de referência. Alterar o preço aqui não mexe na tabela.</span>
        {itens.length === 0 ? (
          <p className="muted">Nenhum item copiado ainda. Escolha abaixo o que levar da tabela de referência.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tabela">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Código</th>
                  <th>Descrição</th>
                  <th>Unid.</th>
                  <th className="num">Preço da obra</th>
                  <th className="num">Preço de referência</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {itens.map((i) => (
                  <tr key={i.id}>
                    <td>{i.tipo === 'composicao' ? `Serviço (${i.componentes})` : 'Insumo'}</td>
                    <td>{i.codigo}</td>
                    <td>
                      {i.descricao}
                      {i.editado && <span className="selo" style={{ marginLeft: 6 }}>editado</span>}
                      {i.origem && <div className="small muted">{i.origem}</div>}
                    </td>
                    <td>{i.unidade}</td>
                    <td className="num">
                      {editando === i.id ? (
                        <span style={{ display: 'inline-flex', gap: 6 }}>
                          <input aria-label="Novo preço" style={{ width: 110 }} value={novoPreco} onChange={(e) => setNovoPreco(e.target.value)} />
                          <button className="btn btn-primario" type="button" onClick={() => salvarPreco(i)}>Salvar</button>
                          <button className="btn" type="button" onClick={() => setEditando(null)}>Cancelar</button>
                        </span>
                      ) : (
                        formatarMoeda(i.preco)
                      )}
                    </td>
                    <td className="num">{formatarMoeda(i.precoReferencia)}</td>
                    <td className="acoes">
                      {i.tipo === 'insumo' && editando !== i.id && (
                        <button className="btn" type="button" onClick={() => { setEditando(i.id); setNovoPreco(String(i.preco ?? '').replace('.', ',')); }}>Editar preço</button>
                      )}
                      <button className="btn" type="button" onClick={() => excluir(i)}>Excluir</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Copiar da tabela de referência</h2>
        {msg && <div className="alerta" role="status">{msg}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <div className="campo">
            <label htmlFor="ob-tabela">Tabela</label>
            <select id="ob-tabela" value={tabelaId} onChange={(e) => setTabelaId(e.target.value)}>
              {tabelas.length === 0 && <option value="">Nenhuma tabela cadastrada</option>}
              {tabelas.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="ob-busca">Buscar por código ou descrição</label>
            <input id="ob-busca" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
        </div>
        <p className="small muted">
          {sel.size} selecionado(s).
          {filtrados.length > LIMITE_CATALOGO && <> Mostrando {LIMITE_CATALOGO} de {filtrados.length}; refine a busca.</>}
        </p>
        <div style={{ maxHeight: 360, overflow: 'auto' }}>
          <table className="tabela">
            <tbody>
              {filtrados.slice(0, LIMITE_CATALOGO).map((i) => (
                <tr key={i.id}>
                  <td style={{ width: 32 }}>
                    <input type="checkbox" aria-label={`Selecionar ${i.codigo}`} checked={sel.has(i.id)} onChange={() => alternar(i.id)} />
                  </td>
                  <td>{i.tipo === 'composicao' ? 'Serviço' : 'Insumo'}</td>
                  <td>{i.codigo}</td>
                  <td>{i.descricao}</td>
                  <td>{i.unidade}</td>
                  <td className="num">{formatarMoeda(i.preco)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="acoes">
          <button className="btn btn-primario" type="button" disabled={!tabelaId || sel.size === 0} onClick={copiar}>Copiar para a obra</button>
        </div>
      </div>
    </>
  );
}

function AbaEap({ obra, nos, itens, orc, aoMudar, setErro }: { obra: Obra; nos: No[]; itens: ItemObra[]; orc: Orcamento | null; aoMudar: () => void; setErro: (m: string) => void }) {
  const nivelObra = obra.nivelApropriacao;
  const semEap = nivelObra === 'obra';
  const [paiId, setPaiId] = useState('');
  const [descricao, setDescricao] = useState('');
  const [itemId, setItemId] = useState('');
  const [eapSel, setEapSel] = useState('');
  const [quantidade, setQuantidade] = useState('');

  // Pais possíveis: o filho do nó não pode passar do nível da obra.
  const pais = nos.filter((n) => {
    const f = FILHO[n.nivel];
    return !!f && ORDEM[f] <= ORDEM[nivelObra];
  });
  const paiSel = nos.find((n) => n.id === paiId);
  const nivelNovo: Nivel = paiSel ? FILHO[paiSel.nivel] ?? 'tarefa' : 'etapa';
  const nosDoNivel = nos.filter((n) => n.nivel === nivelObra);

  async function criarNo(e: FormEvent) {
    e.preventDefault();
    setErro('');
    try {
      await api(`/eng/obras/${obra.id}/eap`, { metodo: 'POST', corpo: { paiId: paiId || null, descricao: descricao.trim() } });
      setDescricao('');
      aoMudar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  async function excluirNo(no: No) {
    setErro('');
    try {
      await api(`/eng/obras/${obra.id}/eap/${no.id}`, { metodo: 'DELETE' });
      aoMudar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  async function lancar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    const q = lerNumero(quantidade);
    if (q === null || q <= 0) return setErro('Informe uma quantidade maior que zero.');
    try {
      await api(`/eng/obras/${obra.id}/orcamento/itens`, {
        metodo: 'POST',
        corpo: { itemId, eapNoId: semEap ? null : eapSel || null, quantidade: q },
      });
      setQuantidade('');
      aoMudar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  async function retirar(linhaId: string) {
    setErro('');
    try {
      await api(`/eng/obras/${obra.id}/orcamento/itens/${linhaId}`, { metodo: 'DELETE' });
      aoMudar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>EAP</h2>
        {semEap ? (
          <p className="muted" style={{ margin: 0 }}>Esta obra lança o orçamento no nível da obra: a EAP não é usada.</p>
        ) : (
          <>
            <span className="ajuda">
              Níveis: Etapa › Subetapa › Tarefa. O orçamento é lançado nos nós de nível <b>{ROTULO_NIVEL[nivelObra]}</b>.
            </span>
            {nos.length > 0 && (
              <div style={{ overflowX: 'auto', marginTop: 8 }}>
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Nível</th>
                      <th>Descrição</th>
                      <th className="num">Itens no orçamento</th>
                      <th className="num">Subtotal</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {nos.map((n) => {
                      const prof = n.codigo.split('.').length - 1;
                      return (
                        <tr key={n.id}>
                          <td>{n.codigo}</td>
                          <td>{ROTULO_NIVEL[n.nivel]}</td>
                          <td style={{ paddingLeft: 12 + prof * 18 }}>{n.descricao}</td>
                          <td className="num">{n.itens}</td>
                          <td className="num">{formatarMoeda(n.subtotal)}</td>
                          <td className="acoes"><button className="btn" type="button" onClick={() => excluirNo(n)}>Excluir</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <form onSubmit={criarNo} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginTop: 12 }}>
              <div className="campo">
                <label htmlFor="eap-pai">Dentro de</label>
                <select id="eap-pai" value={paiId} onChange={(e) => setPaiId(e.target.value)}>
                  <option value="">Raiz (novo nó de Etapa)</option>
                  {pais.map((p) => <option key={p.id} value={p.id}>{p.codigo} {p.descricao}</option>)}
                </select>
              </div>
              <div className="campo">
                <label htmlFor="eap-desc">Descrição ({ROTULO_NIVEL[nivelNovo]})</label>
                <input id="eap-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
              </div>
              <div className="acoes" style={{ alignSelf: 'end' }}>
                <button className="btn btn-primario" type="submit" disabled={descricao.trim().length < 2}>Adicionar nó</button>
              </div>
            </form>
          </>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Orçamento</h2>
        {orc && orc.linhas.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table className="tabela">
              <thead>
                <tr>
                  <th>{semEap ? 'Nível' : 'Nó da EAP'}</th>
                  <th>Código</th>
                  <th>Descrição</th>
                  <th>Unid.</th>
                  <th className="num">Qtd.</th>
                  <th className="num">Preço unit.</th>
                  <th className="num">Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {orc.linhas.map((l) => (
                  <tr key={l.id}>
                    <td>{semEap ? 'Obra' : `${l.eapCodigo ?? ''} ${l.eapDescricao ?? ''}`}</td>
                    <td>{l.codigo}</td>
                    <td>{l.descricao}{l.editado && <span className="selo" style={{ marginLeft: 6 }}>editado</span>}</td>
                    <td>{l.unidade}</td>
                    <td className="num">{l.quantidade}</td>
                    <td className="num">{formatarMoeda(l.precoUnitario)}</td>
                    <td className="num">{formatarMoeda(l.total)}</td>
                    <td className="acoes"><button className="btn" type="button" onClick={() => retirar(l.id)}>Retirar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Nenhum item no orçamento.</p>
        )}
        {orc && (
          <div style={{ marginTop: 12, display: 'grid', gap: 4, justifyContent: 'end' }}>
            <div>Subtotal: <b>{formatarMoeda(orc.subtotal)}</b></div>
            <div>BDI ({String(orc.bdiPercentual).replace('.', ',')}%): <b>{formatarMoeda(orc.bdi)}</b></div>
            <div>Total: <b>{formatarMoeda(orc.total)}</b></div>
          </div>
        )}

        <form onSubmit={lancar} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginTop: 16 }}>
          <div className="campo" style={{ gridColumn: 'span 2' }}>
            <label htmlFor="orc-item">Insumo ou serviço da obra</label>
            <select id="orc-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">Escolha…</option>
              {itens.map((i) => <option key={i.id} value={i.id}>{i.codigo} · {i.descricao}</option>)}
            </select>
          </div>
          {!semEap && (
            <div className="campo" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="orc-eap">Nó da EAP ({ROTULO_NIVEL[nivelObra]})</label>
              <select id="orc-eap" value={eapSel} onChange={(e) => setEapSel(e.target.value)}>
                <option value="">Escolha…</option>
                {nosDoNivel.map((n) => <option key={n.id} value={n.id}>{n.codigo} {n.descricao}</option>)}
              </select>
            </div>
          )}
          <div className="campo">
            <label htmlFor="orc-qtd">Quantidade</label>
            <input id="orc-qtd" inputMode="decimal" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
          </div>
          <div className="acoes" style={{ alignSelf: 'end' }}>
            <button className="btn btn-primario" type="submit" disabled={!itemId || (!semEap && !eapSel)}>Lançar no orçamento</button>
          </div>
        </form>
      </div>
    </>
  );
}
