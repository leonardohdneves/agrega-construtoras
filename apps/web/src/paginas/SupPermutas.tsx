// Suprimentos · Permuta por material: recebemos material do fornecedor e entregamos serviços prestados a ele,
// pelo preço acordado no contrato. Compensar não depende da nota fiscal; a emissão fica como pendência avisada.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, formatarData, formatarMoeda, hojeLocal, lerNumero } from '../api';
import { CabecalhoDocumento } from '../componentes/Documento';
import { Assinatura, Selo, UNIDADES, useCadastrosCompra, nomeFornecedor } from '../componentes/Suprimentos';

type Status = 'aberta' | 'compensada' | 'cancelada';
const SELO_PERMUTA: Record<Status, { texto: string; classe: string }> = {
  aberta: { texto: 'Aberta', classe: 'selo-aviso' },
  compensada: { texto: 'Compensada', classe: 'selo-ok' },
  cancelada: { texto: 'Cancelada', classe: 'selo-neutro' },
};
const FILTROS = [
  { id: '', texto: 'Todas' },
  { id: 'aberta', texto: 'Abertas' },
  { id: 'compensada', texto: 'Compensadas' },
  { id: 'cancelada', texto: 'Canceladas' },
];

type ItemPermuta = { id: string; lado: 'material' | 'servico'; descricao: string; unidade: string | null; quantidade: number; precoUnitario: number; total: number };
type Permuta = {
  id: string;
  numero: number;
  status: Status;
  data: string;
  observacao: string | null;
  obra: { id: string; codigo: string; nome: string };
  fornecedor: { id: string; nome: string; razaoSocial: string; documento: string | null };
  nfEmitida: boolean;
  compensadaEm: string | null;
  itens: ItemPermuta[];
  totais: { material: number; servico: number; diferenca: number; tornaTipo: 'pagar' | 'receber' | 'nenhuma'; torna: number };
  pendencias: string[];
};
type ResumoPermuta = { id: string; numero: number; data: string; status: Status; nfEmitida: boolean; obraCodigo: string; fornecedor: string; material: number; servico: number };
type Obra = { id: string; codigo: string; nome: string };

const numeroPermuta = (n: number) => String(n).padStart(4, '0');

export function SupPermutas() {
  const [filtro, setFiltro] = useState('');
  const [lista, setLista] = useState<ResumoPermuta[] | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    setLista(null);
    api<{ permutas: ResumoPermuta[] }>('/sup/permutas')
      .then((r) => setLista(r.permutas))
      .catch((e) => setErro((e as Error).message));
  }, []);
  const visiveis = (lista ?? []).filter((p) => !filtro || p.status === filtro);
  return (
    <div className="pagina">
      <div className="cabecalho-pagina">
        <h1>Permutas por material</h1>
        <Link className="btn btn-primario" to="/sup/permutas/nova">Nova permuta</Link>
      </div>
      <p className="muted small">Material recebido do fornecedor em troca de serviços prestados a ele, pelo preço acordado no contrato.</p>
      <div className="filtros" role="tablist">
        {FILTROS.map((f) => (
          <button key={f.id} type="button" className={`chip${filtro === f.id ? ' ativo' : ''}`} onClick={() => setFiltro(f.id)}>{f.texto}</button>
        ))}
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {!lista && !erro && <p className="muted">Carregando…</p>}
      {lista && visiveis.length === 0 && <p className="muted">Nenhuma permuta por aqui.</p>}
      {visiveis.length > 0 && (
        <div className="tabela-wrap">
          <table className="tabela">
            <thead>
              <tr><th>Nº</th><th>Data</th><th>Obra</th><th>Fornecedor</th><th className="num">Material</th><th className="num">Serviço</th><th>Situação</th><th>NF</th></tr>
            </thead>
            <tbody>
              {visiveis.map((p) => (
                <tr key={p.id}>
                  <td><Link to={`/sup/permutas/${p.id}`}>{numeroPermuta(p.numero)}</Link></td>
                  <td>{formatarData(p.data)}</td>
                  <td>{p.obraCodigo}</td>
                  <td>{p.fornecedor}</td>
                  <td className="num">{formatarMoeda(p.material)}</td>
                  <td className="num">{formatarMoeda(p.servico)}</td>
                  <td><Selo s={SELO_PERMUTA[p.status]} /></td>
                  <td>{p.status === 'cancelada' ? '—' : p.nfEmitida ? 'Emitida' : <span className="muted">A emitir</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type LinhaForm = { descricao: string; unidade: string; quantidade: string; preco: string };
const linhaVazia = (): LinhaForm => ({ descricao: '', unidade: 'un', quantidade: '', preco: '' });

function Linhas({ titulo, lado, linhas, aoMudar }: { titulo: string; lado: string; linhas: LinhaForm[]; aoMudar: (l: LinhaForm[]) => void }) {
  const set = (i: number, campo: keyof LinhaForm, v: string) => aoMudar(linhas.map((l, j) => (j === i ? { ...l, [campo]: v } : l)));
  return (
    <fieldset className="card" style={{ border: 'none', padding: 0 }}>
      <legend><strong>{titulo}</strong></legend>
      {linhas.map((l, i) => (
        <div key={i} className="grade-campos" style={{ display: 'grid', gap: 8, gridTemplateColumns: 'minmax(0,3fr) 90px 100px 130px auto', alignItems: 'end', marginBottom: 8 }}>
          <div className="campo"><label htmlFor={`${lado}-d-${i}`}>Descrição</label><input id={`${lado}-d-${i}`} value={l.descricao} onChange={(e) => set(i, 'descricao', e.target.value)} /></div>
          <div className="campo"><label htmlFor={`${lado}-u-${i}`}>Unid.</label>
            <select id={`${lado}-u-${i}`} value={l.unidade} onChange={(e) => set(i, 'unidade', e.target.value)}>{UNIDADES.map((u) => <option key={u}>{u}</option>)}</select>
          </div>
          <div className="campo"><label htmlFor={`${lado}-q-${i}`}>Quantidade</label><input id={`${lado}-q-${i}`} inputMode="decimal" value={l.quantidade} onChange={(e) => set(i, 'quantidade', e.target.value)} /></div>
          <div className="campo"><label htmlFor={`${lado}-p-${i}`}>Preço acordado (R$)</label><input id={`${lado}-p-${i}`} inputMode="decimal" value={l.preco} onChange={(e) => set(i, 'preco', e.target.value)} /></div>
          <button type="button" className="btn btn-secundario" disabled={linhas.length === 1} onClick={() => aoMudar(linhas.filter((_, j) => j !== i))}>Remover</button>
        </div>
      ))}
      <button type="button" className="btn btn-secundario" onClick={() => aoMudar([...linhas, linhaVazia()])}>Adicionar linha</button>
    </fieldset>
  );
}

export function NovaPermuta() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { fornecedores } = useCadastrosCompra();
  const [obras, setObras] = useState<Obra[]>([]);
  const [obraId, setObraId] = useState('');
  const [fornecedorId, setFornecedorId] = useState('');
  const [data, setData] = useState(hojeLocal());
  const [observacao, setObservacao] = useState('');
  const [materiais, setMateriais] = useState<LinhaForm[]>([linhaVazia()]);
  const [servicos, setServicos] = useState<LinhaForm[]>([linhaVazia()]);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    api<{ obras: Obra[] }>('/eng/obras').then((r) => setObras(r.obras)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!id) return;
    api<{ permuta: Permuta }>(`/sup/permutas/${id}`).then(({ permuta }) => {
      setObraId(permuta.obra.id);
      setFornecedorId(permuta.fornecedor.id);
      setData(permuta.data);
      setObservacao(permuta.observacao ?? '');
      const linhaDe = (i: ItemPermuta): LinhaForm => ({ descricao: i.descricao, unidade: i.unidade ?? 'un', quantidade: String(i.quantidade).replace('.', ','), preco: String(i.precoUnitario).replace('.', ',') });
      setMateriais(permuta.itens.filter((i) => i.lado === 'material').map(linhaDe));
      setServicos(permuta.itens.filter((i) => i.lado === 'servico').map(linhaDe));
    }).catch((e) => setErro((e as Error).message));
  }, [id]);

  const totalDe = (ls: LinhaForm[]) => ls.reduce((s, l) => s + (lerNumero(l.quantidade) ?? 0) * (lerNumero(l.preco) ?? 0), 0);
  const totMat = useMemo(() => totalDe(materiais), [materiais]);
  const totSer = useMemo(() => totalDe(servicos), [servicos]);
  const dif = Math.round((totMat - totSer) * 100) / 100;

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro('');
    const converter = (ls: LinhaForm[]) =>
      ls.filter((l) => l.descricao.trim() || l.quantidade || l.preco).map((l) => ({
        descricao: l.descricao,
        unidade: l.unidade,
        quantidade: lerNumero(l.quantidade) ?? NaN,
        precoUnitario: lerNumero(l.preco) ?? NaN,
      }));
    const corpo = { obraId, fornecedorId, data, observacao, materiais: converter(materiais), servicos: converter(servicos) };
    setSalvando(true);
    try {
      const r = await api<{ permuta: Permuta }>(id ? `/sup/permutas/${id}` : '/sup/permutas', { metodo: id ? 'PUT' : 'POST', corpo });
      navigate(`/sup/permutas/${r.permuta.id}`);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <form className="pagina" onSubmit={enviar}>
      <div className="cabecalho-pagina">
        <h1>{id ? 'Editar permuta' : 'Nova permuta por material'}</h1>
        <Link className="btn btn-secundario" to={id ? `/sup/permutas/${id}` : '/sup/permutas'}>Cancelar</Link>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div className="grade-campos" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <div className="campo"><label htmlFor="pm-obra">Obra</label>
          <select id="pm-obra" value={obraId} onChange={(e) => setObraId(e.target.value)} required>
            <option value="">Escolha a obra</option>
            {obras.map((o) => <option key={o.id} value={o.id}>{o.codigo} · {o.nome}</option>)}
          </select>
        </div>
        <div className="campo"><label htmlFor="pm-forn">Fornecedor</label>
          <select id="pm-forn" value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value)} required>
            <option value="">Escolha o fornecedor</option>
            {fornecedores.map((f) => <option key={f.id} value={f.id}>{nomeFornecedor(f)}</option>)}
          </select>
        </div>
        <div className="campo"><label htmlFor="pm-data">Data</label><input id="pm-data" type="date" value={data} onChange={(e) => setData(e.target.value)} required /></div>
      </div>
      <div className="campo"><label htmlFor="pm-obs">Observação</label><textarea id="pm-obs" rows={2} value={observacao} onChange={(e) => setObservacao(e.target.value)} /></div>

      <Linhas titulo="Material recebido do fornecedor" lado="m" linhas={materiais} aoMudar={setMateriais} />
      <Linhas titulo="Serviços prestados ao fornecedor" lado="s" linhas={servicos} aoMudar={setServicos} />

      <div className="card" style={{ marginTop: 12 }}>
        <p>Material: <strong>{formatarMoeda(totMat)}</strong> · Serviço: <strong>{formatarMoeda(totSer)}</strong></p>
        <p>
          {dif === 0 ? 'Equilibrada, sem torna.' : dif > 0 ? <>Torna a pagar pela construtora: <strong>{formatarMoeda(dif)}</strong></> : <>Torna a receber do fornecedor: <strong>{formatarMoeda(-dif)}</strong></>}
        </p>
        <p className="small muted">Os valores são o preço acordado no contrato, para os dois lados. A permuta não movimenta caixa.</p>
      </div>
      <div className="alerta alerta-info" role="note" style={{ marginTop: 12 }}>
        A nota fiscal da permuta não é emitida pelo sistema. Ela fica pendente, avisada na permuta, e não impede a compensação.
      </div>
      <div className="acoes" style={{ marginTop: 16 }}>
        <button className="btn btn-primario" type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar permuta'}</button>
      </div>
    </form>
  );
}

export function PermutaDetalhe() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [p, setP] = useState<Permuta | null>(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const carregar = () => api<{ permuta: Permuta }>(`/sup/permutas/${id}`).then((r) => setP(r.permuta)).catch((e) => setErro((e as Error).message));
  useEffect(() => { carregar(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const acao = async (caminho: string, corpo?: unknown, confirmacao?: string) => {
    if (confirmacao && !window.confirm(confirmacao)) return;
    setErro('');
    setOcupado(true);
    try {
      const r = await api<{ permuta: Permuta }>(`/sup/permutas/${id}${caminho}`, { metodo: 'POST', corpo: corpo ?? {} });
      setP(r.permuta);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  if (erro && !p) return <div className="alerta alerta-erro" role="alert">{erro}</div>;
  if (!p) return <p className="muted">Carregando…</p>;

  return (
    <div className="pagina">
      <CabecalhoDocumento
        modulo="Suprimentos"
        titulo={`Permuta nº ${numeroPermuta(p.numero)} · ${p.fornecedor.nome}`}
        filtros={[`Obra: ${p.obra.codigo} · ${p.obra.nome}`, `Data: ${formatarData(p.data)}`, `Situação: ${SELO_PERMUTA[p.status].texto}`]}
      />
      <div className="nao-imprimir" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <Selo s={SELO_PERMUTA[p.status]} />
        {p.status === 'aberta' && <Link className="btn btn-secundario" to={`/sup/permutas/${id}/editar`}>Editar</Link>}
        <Link className="btn btn-secundario" to={`/sup/permutas/${id}/romaneio`}>Romaneio</Link>
        {p.status === 'aberta' && (
          <button className="btn btn-primario" type="button" disabled={ocupado} onClick={() => acao('/compensar', {}, 'Compensar a permuta? Ela fecha pelo preço acordado.')}>Compensar</button>
        )}
        {p.status === 'aberta' && (
          <button className="btn btn-perigo" type="button" disabled={ocupado} onClick={() => acao('/cancelar', {}, 'Cancelar esta permuta?')}>Cancelar permuta</button>
        )}
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {p.pendencias.length > 0 && (
        <div className="alerta alerta-aviso nao-imprimir" role="status">
          Emissão de NF pendente: a emitir pelo contador. Isso não impede a compensação.{' '}
          <button className="btn btn-secundario" type="button" disabled={ocupado} onClick={() => acao('/nota-emitida', { emitida: true })}>Marcar NF como emitida</button>
        </div>
      )}
      {p.nfEmitida && p.status !== 'cancelada' && (
        <div className="nao-imprimir small muted" style={{ marginBottom: 8 }}>
          NF emitida. <button className="btn btn-secundario" type="button" disabled={ocupado} onClick={() => acao('/nota-emitida', { emitida: false })}>Marcar como pendente</button>
        </div>
      )}
      <ResumoItens p={p} />
      {p.observacao && <p className="small">Observação: {p.observacao}</p>}
      <button type="button" className="btn btn-secundario nao-imprimir" onClick={() => navigate('/sup/permutas')}>Voltar à lista</button>
    </div>
  );
}

function ResumoItens({ p }: { p: Permuta }) {
  const linhas = (lado: 'material' | 'servico') => p.itens.filter((i) => i.lado === lado);
  const titulos = { material: 'Material recebido', servico: 'Serviços prestados' } as const;
  return (
    <>
      {(['material', 'servico'] as const).map((lado) => (
        <section key={lado} style={{ marginBottom: 14 }}>
          <h3>{titulos[lado]}</h3>
          <div className="tabela-wrap">
            <table className="tabela">
              <thead><tr><th>Descrição</th><th>Unid.</th><th className="num">Qtd.</th><th className="num">Preço acordado</th><th className="num">Total</th></tr></thead>
              <tbody>
                {linhas(lado).map((i) => (
                  <tr key={i.id}>
                    <td>{i.descricao}</td><td>{i.unidade ?? '—'}</td>
                    <td className="num">{i.quantidade.toLocaleString('pt-BR')}</td>
                    <td className="num">{formatarMoeda(i.precoUnitario)}</td>
                    <td className="num">{formatarMoeda(i.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <Totais p={p} />
    </>
  );
}

function Totais({ p }: { p: Permuta }) {
  const t = p.totais;
  const txt = t.tornaTipo === 'nenhuma' ? 'Sem torna: os dois lados fecham pelo mesmo valor.'
    : t.tornaTipo === 'pagar' ? `Torna a pagar pela construtora: ${formatarMoeda(t.torna)}.`
    : `Torna a receber do fornecedor: ${formatarMoeda(t.torna)}.`;
  return (
    <div className="card">
      <p>Total material: <strong>{formatarMoeda(t.material)}</strong> · Total serviço: <strong>{formatarMoeda(t.servico)}</strong></p>
      <p>{txt}</p>
    </div>
  );
}

export function PermutaRomaneio() {
  const { id } = useParams();
  const [p, setP] = useState<Permuta | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    api<{ permuta: Permuta }>(`/sup/permutas/${id}`).then((r) => setP(r.permuta)).catch((e) => setErro((e as Error).message));
  }, [id]);
  if (erro) return <div className="alerta alerta-erro" role="alert">{erro}</div>;
  if (!p) return <p className="muted">Carregando…</p>;
  const t = p.totais;
  return (
    <div className="pagina romaneio">
      <CabecalhoDocumento
        modulo="Suprimentos"
        titulo={`Romaneio de permuta nº ${numeroPermuta(p.numero)}`}
        descricao="Comunicação com o fornecedor: material recebido em troca de serviços prestados, pelo preço acordado no contrato."
        filtros={[`Obra: ${p.obra.codigo} · ${p.obra.nome}`, `Data: ${formatarData(p.data)}`, `Fornecedor: ${p.fornecedor.razaoSocial}${p.fornecedor.documento ? ` · ${p.fornecedor.documento}` : ''}`]}
      />
      {p.status === 'cancelada' && <div className="alerta alerta-erro">Permuta cancelada.</div>}
      {p.pendencias.length > 0 && p.status !== 'cancelada' && (
        <div className="alerta alerta-aviso" role="note">Nota fiscal da permuta ainda não emitida (a emitir pelo contador).</div>
      )}
      <table className="tabela">
        <thead><tr><th>Lado</th><th>Descrição</th><th>Unid.</th><th className="num">Qtd.</th><th className="num">Preço acordado</th><th className="num">Total</th></tr></thead>
        <tbody>
          {p.itens.map((i) => (
            <tr key={i.id}>
              <td>{i.lado === 'material' ? 'Recebido' : 'Prestado'}</td>
              <td>{i.descricao}</td><td>{i.unidade ?? '—'}</td>
              <td className="num">{i.quantidade.toLocaleString('pt-BR')}</td>
              <td className="num">{formatarMoeda(i.precoUnitario)}</td>
              <td className="num">{formatarMoeda(i.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="card" style={{ marginTop: 12 }}>
        <p>Total material recebido: <strong>{formatarMoeda(t.material)}</strong></p>
        <p>Total serviço prestado: <strong>{formatarMoeda(t.servico)}</strong></p>
        <p>{t.tornaTipo === 'nenhuma' ? 'Sem torna.' : t.tornaTipo === 'pagar' ? <>Torna a pagar pela construtora: <strong>{formatarMoeda(t.torna)}</strong></> : <>Torna a receber do fornecedor: <strong>{formatarMoeda(t.torna)}</strong></>}</p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, marginTop: 40 }}>
        <Assinatura nome="Agrega Construtoras" papel="Pela construtora" />
        <Assinatura nome={p.fornecedor.razaoSocial} papel="Pelo fornecedor" />
      </div>
      <p className="small muted" style={{ marginTop: 16 }}>Emissão da nota fiscal pendente, a cargo do contador. Documento de controle da permuta, sem valor fiscal.</p>
      <Link className="btn btn-secundario nao-imprimir" to={`/sup/permutas/${id}`}>Voltar à permuta</Link>
    </div>
  );
}
