// Engenharia · Obras: cadastro (centro de custo, nível de apropriação, BDI), insumos e serviços copiados de uma tabela,
// EAP com os mesmos níveis e orçamento lançado por nó da EAP.
import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, formatarMoeda, lerNumero } from '../api';
import { ConferenciaComposicao, type DetalheComposicao, type Tabela } from './EngTabelas';
import { rotuloEmpresaGrupo, type EmpresaGrupo } from './EmpresasGrupo';
import { useSessao } from '../sessao';

export type Nivel = 'obra' | 'etapa' | 'subetapa' | 'tarefa';
export type Obra = {
  id: string; codigo: string; nome: string; endereco: string | null; cidade: string | null; uf: string | null; responsavel: string | null;
  status: string; dataInicio: string | null; dataPrevisao: string | null; nivelApropriacao: Nivel; bdiPercentual: number; horasDia?: number;
  bdiModo: 'calculado' | 'informado'; bdiParametros: Partial<Record<CampoBdi, number>> | null;
  centroCustoId: string; centroCustoNome: string | null; itens?: number; linhasOrcamento?: number; total?: number;
  empresaGrupoId?: string | null; empresaGrupoNome?: string | null;
  /** Engenheiros de obra responsáveis: só eles (além de dono, gestor e orçamentista) enxergam a obra. */
  responsaveis?: { id: string; nome: string }[];
};
type Engenheiro = { id: string; nome: string; email: string; ativo: boolean };
export type ItemObra = { id: string; tipo: 'insumo' | 'composicao'; codigo: string; descricao: string; unidade: string; grupo?: string | null; preco: number | null; precoReferencia: number | null; editado: boolean; origem: string | null; componentes: number; origemTabelaId?: string | null; unidadesCompra?: { unidade: string; fator: number }[] };

type ClasseComponente = 'insumo' | 'servico' | 'equipamento';
const ROTULO_CLASSE: Record<ClasseComponente, string> = { insumo: 'Insumo', servico: 'Serviço', equipamento: 'Equipamento' };
const classeDoItem = (tipo: 'insumo' | 'composicao', grupo?: string | null): ClasseComponente => (tipo === 'composicao' ? 'servico' : /EQUIPAMENT/i.test(grupo ?? '') ? 'equipamento' : 'insumo');
export type No = { id: string; paiId: string | null; nivel: Nivel; codigo: string; descricao: string; itens: number; subtotal: number | null };
type LinhaOrc = { id: string; eapNoId: string | null; eapCodigo: string | null; eapDescricao: string | null; itemId: string; tipo: string; codigo: string; descricao: string; unidade: string; editado: boolean; quantidade: number; precoUnitario: number | null; total: number };
export type Orcamento = { nivelApropriacao: Nivel; bdiPercentual: number; subtotal: number; bdi: number; total: number; linhas: LinhaOrc[] };
type ItemCatalogo = { id: string; tipo: 'insumo' | 'composicao'; codigo: string; descricao: string; unidade: string; preco: number | null };

export const ROTULO_NIVEL: Record<Nivel, string> = { obra: 'Obra', etapa: 'Etapa', subetapa: 'Sub Etapa', tarefa: 'Tarefa' };
const ROTULO_STATUS: Record<string, string> = { orcamento: 'Em orçamento', planejamento: 'Planejamento', em_andamento: 'Em andamento', suspensa: 'Suspensa', concluida: 'Concluída' };
const LIMITE_CATALOGO = 200;

export function EngObras() {
  const [obras, setObras] = useState<Obra[] | null>(null);
  const [erro, setErro] = useState('');
  const [nova, setNova] = useState(false);
  const navegar = useNavigate();
  const { usuario } = useSessao();
  const engenheiro = usuario?.perfil === 'engenheiro_obra';
  const carregar = () => api<{ obras: Obra[] }>('/eng/obras').then((r) => setObras(r.obras)).catch((e) => setErro((e as Error).message));
  useEffect(() => {
    carregar();
  }, []);

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Obras</h1>
          <span className="muted">{engenheiro ? 'Obras sob a sua responsabilidade.' : 'Cadastro de obras com centro de custo, nível de apropriação e BDI.'}</span>
        </div>
        {!engenheiro && (
          <div className="acoes">
            <button className="btn btn-primario" type="button" onClick={() => setNova(!nova)} aria-expanded={nova}>{nova ? 'Fechar' : 'Nova obra'}</button>
          </div>
        )}
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {nova && <FormObra aoSalvar={(o) => navegar(`/eng/obras/${o.id}`)} />}
      {obras === null && !erro && <p className="muted">Carregando…</p>}
      {obras?.length === 0 && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>{engenheiro ? 'Nenhuma obra atribuída a você ainda. Peça ao dono ou ao gestor para marcar você como responsável na obra.' : 'Nenhuma obra cadastrada.'}</p>
        </div>
      )}
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

type DadosForm = { codigo: string; nome: string; endereco: string; cidade: string; uf: string; responsavel: string; empresaGrupoId: string; status: string; dataInicio: string; dataPrevisao: string; nivelApropriacao: Nivel; horasDia: string; bdiModo: 'calculado' | 'informado'; bdi: string; params: Record<CampoBdi, string> };

function FormObra({ inicial, aoSalvar, aoCancelar }: { inicial?: Obra; aoSalvar: (o: Obra) => void; aoCancelar?: () => void }) {
  const editando = !!inicial;
  const [d, setD] = useState<DadosForm>({
    codigo: inicial?.codigo ?? '',
    nome: inicial?.nome ?? '',
    endereco: inicial?.endereco ?? '',
    cidade: inicial?.cidade ?? '',
    uf: inicial?.uf ?? '',
    responsavel: inicial?.responsavel ?? '',
    empresaGrupoId: inicial?.empresaGrupoId ?? '',
    status: inicial?.status ?? 'planejamento',
    dataInicio: inicial?.dataInicio ?? '',
    dataPrevisao: inicial?.dataPrevisao ?? '',
    nivelApropriacao: inicial?.nivelApropriacao ?? 'etapa',
    horasDia: paraTexto(inicial?.horasDia ?? 8),
    bdiModo: inicial?.bdiModo ?? 'informado',
    bdi: paraTexto(inicial?.bdiPercentual),
    params: Object.fromEntries(CAMPOS_BDI.map(([k]) => [k, paraTexto(inicial?.bdiParametros?.[k])])) as Record<CampoBdi, string>,
  });
  const paramsNumericos = Object.fromEntries(CAMPOS_BDI.map(([k]) => [k, lerNumero(d.params[k]) ?? 0])) as Record<CampoBdi, number>;
  const previaBdi = bdiCalculadoPrevia(paramsNumericos);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [empresasGrupo, setEmpresasGrupo] = useState<EmpresaGrupo[]>([]);
  // Engenheiros de obra da empresa; null = este usuário não atribui responsáveis.
  const [engenheiros, setEngenheiros] = useState<Engenheiro[] | null>(null);
  const [responsaveis, setResponsaveis] = useState<string[]>(() => (inicial?.responsaveis ?? []).map((r) => r.id));
  useEffect(() => {
    api<{ empresas: EmpresaGrupo[] }>('/empresa/grupo').then((r) => setEmpresasGrupo(r.empresas.filter((x) => x.ativo))).catch(() => setEmpresasGrupo([]));
    api<{ engenheiros: Engenheiro[] }>('/eng/engenheiros').then((r) => setEngenheiros(r.engenheiros)).catch(() => setEngenheiros(null));
  }, []);

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
      empresaGrupoId: d.empresaGrupoId || null,
      status: d.status,
      dataInicio: d.dataInicio || null,
      dataPrevisao: d.dataPrevisao || null,
      nivelApropriacao: d.nivelApropriacao,
      horasDia: lerNumero(d.horasDia) ?? 8,
      bdiModo: d.bdiModo,
      ...(d.bdiModo === 'calculado' ? { bdiParametros: paramsNumericos } : { bdiPercentual: lerNumero(d.bdi) ?? 0 }),
      ...(engenheiros ? { responsaveis } : {}),
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
          <label htmlFor="ob-empresa">Empresa que executa a obra</label>
          <select id="ob-empresa" value={d.empresaGrupoId} onChange={(e) => setD({ ...d, empresaGrupoId: e.target.value })}>
            <option value="">Empresa logada (sem grupo)</option>
            {empresasGrupo.map((e) => <option key={e.id} value={e.id}>{rotuloEmpresaGrupo(e)}</option>)}
          </select>
          <span className="small muted">O regime de impostos da obra segue a empresa escolhida.</span>
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
          <label htmlFor="ob-horas">Horas de trabalho por dia</label>
          <input id="ob-horas" inputMode="decimal" value={d.horasDia} onChange={(e) => setD({ ...d, horasDia: e.target.value })} />
          <span className="ajuda">Usada para dimensionar as equipes do planejamento. Padrão: 8.</span>
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
      {engenheiros && (
        <fieldset className="campo" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600, marginBottom: 6 }}>Engenheiros de obra responsáveis</legend>
          {engenheiros.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px' }}>
              {engenheiros.map((e) => (
                <label key={e.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 400 }}>
                  <input
                    type="checkbox"
                    checked={responsaveis.includes(e.id)}
                    onChange={(ev) => setResponsaveis(ev.target.checked ? [...responsaveis, e.id] : responsaveis.filter((x) => x !== e.id))}
                  />
                  {e.nome}{!e.ativo && <span className="small muted"> (inativo)</span>}
                </label>
              ))}
            </div>
          ) : (
            <span className="small muted">Nenhum usuário com o perfil Engenheiro de obra. Cadastre em Configurações › Usuários.</span>
          )}
          <span className="small muted">O engenheiro de obra só vê as obras marcadas aqui, com os contratos e as medições delas.</span>
        </fieldset>
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
  const { usuario } = useSessao();
  // O cadastro da obra (nome, BDI, responsáveis) é do dono, do gestor e do orçamentista.
  const editaCadastro = usuario?.perfil !== 'engenheiro_obra';
  const [obra, setObra] = useState<Obra | null>(null);
  const [itens, setItens] = useState<ItemObra[]>([]);
  const [nos, setNos] = useState<No[]>([]);
  const [orc, setOrc] = useState<Orcamento | null>(null);
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

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>{obra.codigo} · {obra.nome}</h1>
          <span className="muted">
            Nível {ROTULO_NIVEL[obra.nivelApropriacao]} · BDI {String(obra.bdiPercentual).replace('.', ',')}% · Empresa: {obra.empresaGrupoNome ?? 'empresa logada'} · Centro de custo: {obra.centroCustoNome ?? '—'}
            {obra.responsaveis?.length ? ` · Engenheiros: ${obra.responsaveis.map((r) => r.nome).join(', ')}` : ''}
          </span>
        </div>
        <div className="acoes">
          <Link className="btn" to="/eng/obras">Todas as obras</Link>
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {editaCadastro && <FormObra key={obra.id} inicial={obra} aoSalvar={() => recarregar()} />}
    </>
  );
}

export function AbaInsumos({ obraId, itens, aoMudar, setErro, tipo }: { obraId: string; itens: ItemObra[]; aoMudar: () => void; setErro: (m: string) => void; tipo?: 'insumo' | 'composicao' }) {
  const [tabelas, setTabelas] = useState<Tabela[]>([]);
  const [tabelaId, setTabelaId] = useState('');
  const [catalogo, setCatalogo] = useState<ItemCatalogo[]>([]);
  const [busca, setBusca] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [novoPreco, setNovoPreco] = useState('');
  const [unidEdit, setUnidEdit] = useState<{ id: string; linhas: { unidade: string; fator: string }[] } | null>(null);
  const [conferindo, setConferindo] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ modo: 'copia' | 'edicao'; item: ItemObra } | null>(null);
  const [semTabela, setSemTabela] = useState<{ modo: 'copia' | 'edicao'; item: ItemObra } | null>(null);
  const [copiaInsumo, setCopiaInsumo] = useState<ItemObra | null>(null);
  const [buscaObra, setBuscaObra] = useState('');
  const proprias = tabelas.filter((t) => t.fonte === 'proprio');

  async function recarregarTabelas() {
    const r = await api<{ tabelas: Tabela[] }>('/eng/tabelas');
    setTabelas(r.tabelas);
    return r.tabelas;
  }

  useEffect(() => {
    recarregarTabelas()
      .then((lista) => {
        if (lista[0]) setTabelaId(lista[0].id);
      })
      .catch((e) => setErro((e as Error).message));
  }, []);

  /** Editar ou copiar um serviço grava numa tabela própria. Se não existe, avisa antes de começar. */
  function abrirEdicao(modo: 'copia' | 'edicao', item: ItemObra) {
    setMsg('');
    setEditor(null);
    setCopiaInsumo(null);
    if (proprias.length === 0) setSemTabela({ modo, item });
    else {
      setSemTabela(null);
      if (item.tipo === 'insumo') setCopiaInsumo(item);
      else setEditor({ modo, item });
    }
  }

  useEffect(() => {
    setSel(new Set());
  }, [tabelaId]);

  // Busca no servidor, já filtrada pelo tipo da página (tabelas SINAPI têm milhares de itens).
  useEffect(() => {
    if (!tabelaId) return;
    const q = new URLSearchParams();
    if (tipo) q.set('tipo', tipo);
    if (busca.trim()) q.set('busca', busca.trim());
    const t = setTimeout(() => {
      api<{ itens: ItemCatalogo[] }>(`/eng/tabelas/${tabelaId}/itens?${q}`)
        .then((r) => setCatalogo(r.itens))
        .catch((e) => setErro((e as Error).message));
    }, 250);
    return () => clearTimeout(t);
  }, [tabelaId, tipo, busca]);

  const filtrados = catalogo.filter((i) => !tipo || i.tipo === tipo);
  const rotulo = tipo === 'insumo' ? 'Insumos' : tipo === 'composicao' ? 'Serviços' : 'Insumos e serviços';

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

  async function salvarUnidades(item: ItemObra) {
    if (!unidEdit) return;
    setErro('');
    const corpo: { unidade: string; fator: number }[] = [];
    for (const u of unidEdit.linhas) {
      if (!u.unidade.trim() && !u.fator.trim()) continue;
      const f = lerNumero(u.fator);
      if (!u.unidade.trim() || f === null || f <= 0) return setErro('Cada unidade de compra precisa de nome e de quantas unidades do orçamento cabem nela.');
      corpo.push({ unidade: u.unidade.trim(), fator: f });
    }
    try {
      await api(`/eng/obras/${obraId}/itens/${item.id}`, { metodo: 'PATCH', corpo: { unidadesCompra: corpo } });
      setUnidEdit(null);
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

  const termos = normalizarBusca(buscaObra).split(' ').filter(Boolean);
  const itensVisiveis = itens.filter((i) => {
    const texto = normalizarBusca(`${i.codigo} ${i.descricao} ${i.grupo ?? ''}`);
    return termos.every((t) => texto.includes(t));
  });

  return (
    <>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>{rotulo} da obra</h2>
        <span className="ajuda">Os itens são cópias da tabela de referência. Alterar o preço aqui não mexe na tabela.</span>
        {itens.length > 0 && (
          <div className="campo" style={{ maxWidth: 420, marginTop: 12 }}>
            <label htmlFor="busca-obra">Buscar na obra</label>
            <input id="busca-obra" type="search" placeholder="Código ou descrição" value={buscaObra} onChange={(e) => setBuscaObra(e.target.value)} autoComplete="off" />
          </div>
        )}
        {itens.length === 0 ? (
          <p className="muted">Nenhum item ainda. Escolha abaixo o que levar da tabela de referência.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tabela">
              <thead>
                <tr>
                  {!tipo && <th>Tipo</th>}
                  <th>Código</th>
                  <th>Descrição</th>
                  <th>Unid.</th>
                  <th className="num">Preço da obra</th>
                  <th className="num">Preço de referência</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {itensVisiveis.map((i) => (
                  <Fragment key={i.id}>
                  <tr>
                    {!tipo && <td>{i.tipo === 'composicao' ? `Serviço (${i.componentes})` : 'Insumo'}</td>}
                    <td>{i.codigo}{i.tipo === 'composicao' && tipo && <div className="small muted">{i.componentes} insumos</div>}</td>
                    <td>
                      {i.tipo === 'composicao' ? (
                        <button className="btn btn-link" type="button" style={{ padding: 0, minHeight: 0, textAlign: 'left' }} onClick={() => setConferindo(i.id)}>{i.descricao}</button>
                      ) : (
                        i.descricao
                      )}
                      {i.editado && <span className="selo" style={{ marginLeft: 6 }}>editado</span>}
                      {i.origem && <div className="small muted">{i.origem}</div>}
                    </td>
                    <td>
                      {i.unidade}
                      {i.tipo === 'insumo' && (i.unidadesCompra ?? []).map((u) => (
                        <div key={u.unidade} className="small muted">1 {u.unidade} = {u.fator.toLocaleString('pt-BR', { maximumFractionDigits: 4 })} {i.unidade}</div>
                      ))}
                    </td>
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
                      {i.tipo === 'insumo' && (
                        <button className="btn" type="button" onClick={() => abrirEdicao('copia', i)}>Criar cópia</button>
                      )}
                      {i.tipo === 'insumo' && unidEdit?.id !== i.id && (
                        <button className="btn" type="button" onClick={() => setUnidEdit({ id: i.id, linhas: (i.unidadesCompra ?? []).map((u) => ({ unidade: u.unidade, fator: String(u.fator).replace('.', ',') })) })}>Editar</button>
                      )}
                      {i.tipo === 'composicao' && (
                        <>
                          <button className="btn" type="button" onClick={() => abrirEdicao('edicao', i)}>Editar</button>
                          <button className="btn" type="button" onClick={() => abrirEdicao('copia', i)}>Criar cópia</button>
                        </>
                      )}
                      <button className="btn" type="button" onClick={() => excluir(i)}>Excluir</button>
                    </td>
                  </tr>
                  {unidEdit?.id === i.id && (
                    <tr>
                      <td colSpan={20} style={{ background: 'var(--surface-sunken)' }}>
                        <div className="form" style={{ padding: 8 }}>
                          <b>Unidades de compra de {i.codigo} · {i.descricao}</b>
                          <span className="ajuda">Se o insumo é orçado em {i.unidade} e comprado em outra unidade, informe quantos {i.unidade} cabem em cada unidade de compra. Ex.: 1 barra = 46,2 {i.unidade}.</span>
                          {unidEdit.linhas.map((u, n) => (
                            <div key={n} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                              <input aria-label={`Unidade de compra ${n + 1}`} placeholder="ex.: barra" value={u.unidade} style={{ maxWidth: 140 }} onChange={(e) => setUnidEdit({ ...unidEdit, linhas: unidEdit.linhas.map((x, k) => (k === n ? { ...x, unidade: e.target.value } : x)) })} />
                              <span className="small muted">1 {u.unidade.trim() || 'unidade'} =</span>
                              <input aria-label={`Quantos ${i.unidade} cabem em 1 ${u.unidade.trim() || 'unidade'}`} placeholder="ex.: 46,2" inputMode="decimal" value={u.fator} style={{ maxWidth: 120 }} onChange={(e) => setUnidEdit({ ...unidEdit, linhas: unidEdit.linhas.map((x, k) => (k === n ? { ...x, fator: e.target.value } : x)) })} />
                              <span className="small muted">{i.unidade}</span>
                              <button className="btn btn-link" type="button" onClick={() => setUnidEdit({ ...unidEdit, linhas: unidEdit.linhas.filter((_, k) => k !== n) })}>Remover</button>
                            </div>
                          ))}
                          <div><button className="btn btn-link" type="button" onClick={() => setUnidEdit({ ...unidEdit, linhas: [...unidEdit.linhas, { unidade: '', fator: '' }] })}>+ unidade de compra</button></div>
                          <div className="acoes">
                            <button className="btn" type="button" onClick={() => setUnidEdit(null)}>Cancelar</button>
                            <button className="btn btn-primario" type="button" onClick={() => salvarUnidades(i)}>Salvar unidades</button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
            {itensVisiveis.length === 0 && <p className="muted">Nenhum item encontrado para “{buscaObra}”.</p>}
          </div>
        )}
      </div>

      {semTabela && (
        <AvisoTabelaPropria
          modo={semTabela.modo}
          setErro={setErro}
          aoCriada={async () => {
            const item = semTabela.item;
            const modo = semTabela.modo;
            const lista = await recarregarTabelas();
            setSemTabela(null);
            if (lista.some((t) => t.fonte === 'proprio')) {
              if (item.tipo === 'insumo') setCopiaInsumo(item);
              else setEditor({ modo, item });
            }
          }}
          aoCancelar={() => setSemTabela(null)}
        />
      )}
      {copiaInsumo && (
        <CopiaInsumo
          obraId={obraId}
          item={copiaInsumo}
          tabelas={proprias}
          setErro={setErro}
          aoFechar={() => setCopiaInsumo(null)}
          aoSalvo={(m) => {
            setCopiaInsumo(null);
            setMsg(m);
            aoMudar();
          }}
        />
      )}
      {editor && (
        <EditorServico
          obraId={obraId}
          modo={editor.modo}
          item={editor.item}
          tabelas={proprias}
          setErro={setErro}
          aoFechar={() => setEditor(null)}
          aoSalvo={(m) => {
            setEditor(null);
            setMsg(m);
            aoMudar();
          }}
        />
      )}

      {conferindo && (
        <ConferenciaComposicao inicial={conferindo} carregar={(itemId) => api<DetalheComposicao>(`/eng/obras/${obraId}/itens/${itemId}`)} aoFechar={() => setConferindo(null)} />
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Copiar {tipo === 'insumo' ? 'insumos' : tipo === 'composicao' ? 'serviços' : 'itens'} da tabela de referência</h2>
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
                  {!tipo && <td>{i.tipo === 'composicao' ? 'Serviço' : 'Insumo'}</td>}
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

/** Aviso antes de copiar ou editar um serviço: é preciso uma tabela própria. As tabelas SINAPI não mudam. */
/** Busca sem acento e sem diferença de maiúsculas. */
function normalizarBusca(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Cópia de insumo: grava uma cópia editável na tabela própria e inclui a cópia na obra. O insumo original não muda. */
function CopiaInsumo({ obraId, item, tabelas, setErro, aoFechar, aoSalvo }: { obraId: string; item: ItemObra; tabelas: Tabela[]; setErro: (m: string) => void; aoFechar: () => void; aoSalvo: (m: string) => void }) {
  const [tabelaId, setTabelaId] = useState(tabelas[0]?.id ?? '');
  const [descricao, setDescricao] = useState(item.descricao);
  const [unidade, setUnidade] = useState(item.unidade);
  const [grupo, setGrupo] = useState(item.grupo ?? '');
  const [preco, setPreco] = useState(item.preco === null || item.preco === undefined ? '' : String(item.preco).replace('.', ','));
  const [ocupado, setOcupado] = useState(false);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    if (descricao.trim().length < 2) return setErro('Dê uma descrição ao insumo.');
    if (!unidade.trim()) return setErro('Informe a unidade.');
    if (!tabelaId) return setErro('Escolha a tabela própria.');
    let precoNum: number | null = null;
    if (preco.trim()) {
      const p = lerNumero(preco);
      if (p === null || p < 0) return setErro('Informe um preço válido ou deixe em branco.');
      precoNum = p;
    }
    setOcupado(true);
    try {
      const criado = await api<{ id: string; codigo: string }>(`/eng/tabelas/${tabelaId}/itens`, {
        corpo: {
          tipo: 'insumo',
          descricao: descricao.trim(),
          unidade: unidade.trim(),
          grupo: grupo.trim() || null,
          preco: precoNum,
          precoOrigem: precoNum === null ? 'nao_informado' : 'informado',
          unidadesCompra: (item.unidadesCompra ?? []).map((u) => ({ unidade: u.unidade, fator: u.fator })),
        },
      });
      await api(`/eng/obras/${obraId}/importar`, { corpo: { tabelaId, insumoIds: [criado.id], composicaoIds: [] } });
      const nomeTabela = tabelas.find((t) => t.id === tabelaId)?.nome ?? 'tabela própria';
      aoSalvo(`Cópia criada com o código ${criado.codigo} e salva em ${nomeTabela}. O insumo original não mudou.`);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form className="card form" onSubmit={salvar}>
      <h2 style={{ margin: 0 }}>Cópia editável do insumo</h2>
      <p className="muted" style={{ margin: 0 }}>Copiando {item.codigo}. Ajuste o que precisar: a cópia vai para a tabela própria escolhida e entra nesta obra.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <div className="campo" style={{ gridColumn: 'span 2' }}>
          <label htmlFor="ci-descricao">Descrição</label>
          <input id="ci-descricao" value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="ci-unidade">Unidade</label>
          <input id="ci-unidade" value={unidade} onChange={(e) => setUnidade(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="ci-preco">Preço</label>
          <input id="ci-preco" inputMode="decimal" value={preco} onChange={(e) => setPreco(e.target.value)} placeholder="Deixe em branco para depois" />
        </div>
        <div className="campo">
          <label htmlFor="ci-grupo">Grupo</label>
          <input id="ci-grupo" value={grupo} onChange={(e) => setGrupo(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="ci-tabela">Tabela própria</label>
          <select id="ci-tabela" value={tabelaId} onChange={(e) => setTabelaId(e.target.value)}>
            {tabelas.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
        </div>
      </div>
      <div className="acoes">
        <button className="btn btn-primario" type="submit" disabled={ocupado}>{ocupado ? 'Salvando…' : 'Criar cópia'}</button>
        <button className="btn" type="button" onClick={aoFechar} disabled={ocupado}>Cancelar</button>
      </div>
    </form>
  );
}

function AvisoTabelaPropria({ modo, setErro, aoCriada, aoCancelar }: { modo: 'copia' | 'edicao'; setErro: (m: string) => void; aoCriada: () => Promise<void>; aoCancelar: () => void }) {
  const [nome, setNome] = useState('Serviços da construtora');
  const [ocupado, setOcupado] = useState(false);

  async function criar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setOcupado(true);
    try {
      await api('/eng/tabelas', { corpo: { fonte: 'proprio', nome: nome.trim(), uf: null, mesReferencia: null, desonerado: false, csv: null } });
      await aoCriada();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form className="card form" onSubmit={criar} role="alert">
      <h2 style={{ margin: 0 }}>Antes de {modo === 'copia' ? 'criar a cópia' : 'editar o serviço'}: crie uma tabela própria</h2>
      <p className="muted" style={{ margin: 0 }}>
        {modo === 'copia' ? 'A cópia' : 'A versão editada'} é salva numa tabela própria, que você escolhe. Ainda não existe nenhuma. As tabelas importadas (como o SINAPI) não são alteradas.
      </p>
      <div className="campo">
        <label htmlFor="tp-nome">Nome da tabela própria</label>
        <input id="tp-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
      </div>
      <div className="acoes">
        <button className="btn" type="button" onClick={aoCancelar}>Cancelar</button>
        <button className="btn btn-primario" type="submit" disabled={ocupado || nome.trim().length < 2}>{ocupado ? 'Criando…' : 'Criar tabela e continuar'}</button>
      </div>
    </form>
  );
}

type CompEditor = { insumoId: string; classe: ClasseComponente; codigo: string; descricao: string; unidade: string; coeficiente: string; preco: string };
const numCampo = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v).replace('.', ','));

/** Editor de composição: renomear, trocar insumos, coeficientes e preços. Salva na tabela própria escolhida. */
function EditorServico({ obraId, modo, item, tabelas, setErro, aoFechar, aoSalvo }: {
  obraId: string; modo: 'copia' | 'edicao'; item: ItemObra; tabelas: Tabela[]; setErro: (m: string) => void; aoFechar: () => void; aoSalvo: (m: string) => void;
}) {
  const [carregando, setCarregando] = useState(true);
  const [nome, setNome] = useState(item.descricao);
  const [unidade, setUnidade] = useState(item.unidade);
  const [tabelaId, setTabelaId] = useState(tabelas[0]?.id ?? '');
  const [comps, setComps] = useState<CompEditor[]>([]);
  const [insumos, setInsumos] = useState<ItemObra[]>([]);
  const [servicos, setServicos] = useState<ItemObra[]>([]);
  const [novo, setNovo] = useState({ insumoId: '', coeficiente: '' });
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    Promise.all([
      api<{ componentes: { id: string; classe: ClasseComponente; codigo: string; descricao: string; unidade: string; coeficiente: number; precoUnitario: number | null }[] }>(`/eng/obras/${obraId}/itens/${item.id}`),
      api<{ itens: ItemObra[] }>(`/eng/obras/${obraId}/itens?tipo=insumo`),
      api<{ itens: ItemObra[] }>(`/eng/obras/${obraId}/itens?tipo=composicao`),
    ])
      .then(([det, ins, sv]) => {
        setComps(det.componentes.map((k) => ({ insumoId: k.id, classe: k.classe, codigo: k.codigo, descricao: k.descricao, unidade: k.unidade, coeficiente: numCampo(k.coeficiente), preco: numCampo(k.precoUnitario) })));
        setInsumos(ins.itens);
        // Serviços que podem entrar aqui: os salvos na tabela própria escolhida, exceto o próprio serviço em edição.
        setServicos(sv.itens.filter((x) => x.id !== item.id));
      })
      .catch((e) => setErro((e as Error).message))
      .finally(() => setCarregando(false));
  }, [obraId, item.id]);

  const custo = comps.reduce((s, k) => s + (lerNumero(k.coeficiente) ?? 0) * (lerNumero(k.preco) ?? 0), 0);
  const servicosDaTabela = servicos.filter((x) => x.origemTabelaId === tabelaId);
  const disponiveis = insumos.filter((i) => !comps.some((k) => k.insumoId === i.id));
  const servicosDisponiveis = servicosDaTabela.filter((x) => !comps.some((k) => k.insumoId === x.id));

  function incluir() {
    const ins = [...insumos, ...servicosDaTabela].find((i) => i.id === novo.insumoId);
    const q = lerNumero(novo.coeficiente);
    if (!ins) return setErro('Escolha o insumo ou o serviço.');
    if (q === null || q <= 0) return setErro('Informe o coeficiente.');
    setErro('');
    const classe = classeDoItem(ins.tipo, ins.grupo);
    setComps([...comps, { insumoId: ins.id, classe, codigo: ins.codigo, descricao: ins.descricao, unidade: ins.unidade, coeficiente: numCampo(q), preco: numCampo(ins.preco) }]);
    setNovo({ insumoId: '', coeficiente: '' });
  }

  function atualizar(i: number, campo: 'coeficiente' | 'preco', valor: string) {
    setComps(comps.map((k, n) => (n === i ? { ...k, [campo]: valor } : k)));
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    if (nome.trim().length < 2) return setErro('Dê um nome ao serviço.');
    if (!tabelaId) return setErro('Escolha a tabela própria.');
    if (!comps.length) return setErro('O serviço precisa de pelo menos um insumo ou serviço.');
    const componentes: { insumoId: string; coeficiente: number; precoUnitario?: number }[] = [];
    for (const k of comps) {
      const q = lerNumero(k.coeficiente);
      if (q === null || q <= 0) return setErro(`Coeficiente inválido em ${k.descricao}.`);
      // Serviço não tem preço próprio: o custo dele vem da composição.
      const p = k.classe !== 'servico' && k.preco.trim() ? lerNumero(k.preco) : null;
      if (k.classe !== 'servico' && k.preco.trim() && (p === null || p < 0)) return setErro(`Preço inválido em ${k.descricao}.`);
      componentes.push({ insumoId: k.insumoId, coeficiente: q, ...(p !== null ? { precoUnitario: p } : {}) });
    }
    setOcupado(true);
    try {
      const r = await api<{ id: string; codigo: string }>(`/eng/obras/${obraId}/servicos/salvar`, {
        metodo: 'POST',
        corpo: { modo, itemId: item.id, tabelaId, descricao: nome.trim(), unidade: unidade.trim(), componentes },
      });
      const nomeTabela = tabelas.find((t) => t.id === tabelaId)?.nome ?? 'tabela própria';
      aoSalvo(modo === 'copia' ? `Cópia criada com o código ${r?.codigo ?? '—'} e salva em ${nomeTabela}. O serviço original não mudou.` : `Serviço editado na obra e salvo em ${nomeTabela}${r?.codigo ? ` com o código ${r.codigo}` : ''}.`);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form className="card form" onSubmit={salvar}>
      <h2 style={{ margin: 0 }}>{modo === 'copia' ? 'Cópia editável do serviço' : 'Editar serviço'}</h2>
      <p className="muted" style={{ margin: 0 }}>
        {modo === 'copia' ? `Copiando ${item.codigo}. ` : ''}Altere o nome, a unidade, os insumos e serviços, os coeficientes e os preços. Ao salvar, a composição vai para a tabela própria escolhida.
      </p>
      {carregando ? <p className="muted">Carregando composição…</p> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <div className="campo" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="es-nome">Nome do serviço</label>
              <input id="es-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
            <div className="campo">
              <label htmlFor="es-codigo">Código</label>
              <input id="es-codigo" value={modo === 'edicao' ? item.codigo : 'Automático'} disabled />
              <span className="ajuda">Sequência da tabela própria. Apagar um serviço não libera o número.</span>
            </div>
            <div className="campo">
              <label htmlFor="es-unid">Unidade</label>
              <input id="es-unid" value={unidade} onChange={(e) => setUnidade(e.target.value)} />
            </div>
            <div className="campo" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="es-tab">Tabela própria onde será salvo</label>
              <select id="es-tab" value={tabelaId} onChange={(e) => setTabelaId(e.target.value)}>
                {tabelas.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </select>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="tabela">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Tipo</th>
                  <th>Descrição</th>
                  <th>Unid.</th>
                  <th className="num">Coeficiente</th>
                  <th className="num">Preço unit.</th>
                  <th className="num">Subtotal</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {comps.map((k, i) => (
                  <tr key={k.insumoId}>
                    <td>{k.codigo}</td>
                    <td className="small">{ROTULO_CLASSE[k.classe]}</td>
                    <td>{k.descricao}</td>
                    <td>{k.unidade}</td>
                    <td className="num"><input aria-label={`Coeficiente de ${k.descricao}`} style={{ width: 110 }} inputMode="decimal" value={k.coeficiente} onChange={(e) => atualizar(i, 'coeficiente', e.target.value)} /></td>
                    <td className="num">
                      {k.classe === 'servico'
                        ? <span title="O custo do serviço vem da composição dele">{formatarMoeda(lerNumero(k.preco) ?? 0)}</span>
                        : <input aria-label={`Preço de ${k.descricao}`} style={{ width: 110 }} inputMode="decimal" value={k.preco} onChange={(e) => atualizar(i, 'preco', e.target.value)} />}
                    </td>
                    <td className="num">{formatarMoeda((lerNumero(k.coeficiente) ?? 0) * (lerNumero(k.preco) ?? 0))}</td>
                    <td><button className="btn btn-link" type="button" onClick={() => setComps(comps.filter((_, n) => n !== i))}>Remover</button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6} className="forte">Custo unitário do serviço</td>
                  <td className="num forte">{formatarMoeda(custo)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, alignItems: 'end' }}>
            <div className="campo" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="es-novo">Incluir insumo ou serviço da obra</label>
              <select id="es-novo" value={novo.insumoId} onChange={(e) => setNovo({ ...novo, insumoId: e.target.value })}>
                <option value="">Escolha…</option>
                <optgroup label="Insumos">
                  {disponiveis.map((i) => <option key={i.id} value={i.id}>{i.codigo} · {i.descricao}</option>)}
                </optgroup>
                {servicosDisponiveis.length > 0 && (
                  <optgroup label="Serviços desta tabela própria">
                    {servicosDisponiveis.map((x) => <option key={x.id} value={x.id}>{x.codigo} · {x.descricao}</option>)}
                  </optgroup>
                )}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="es-novo-coef">Coeficiente</label>
              <input id="es-novo-coef" inputMode="decimal" value={novo.coeficiente} onChange={(e) => setNovo({ ...novo, coeficiente: e.target.value })} />
            </div>
            <div>
              <button className="btn" type="button" onClick={incluir}>Incluir</button>
            </div>
          </div>
          <p className="small muted" style={{ margin: 0 }}>Insumo novo que não esteja na obra: cadastre antes em Insumos. Serviço só entra depois de salvo nesta tabela própria.</p>
        </>
      )}
      <div className="acoes">
        <button className="btn" type="button" onClick={aoFechar}>Cancelar</button>
        <button className="btn btn-primario" type="submit" disabled={ocupado || carregando || !tabelaId}>{ocupado ? 'Salvando…' : 'Salvar serviço na tabela própria'}</button>
      </div>
    </form>
  );
}
