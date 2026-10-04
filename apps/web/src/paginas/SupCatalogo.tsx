import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, formatarData, type PlanoConta } from '../api';
import { CabecalhoDocumento } from '../componentes/Documento';
import { numeroDoc, precoUn, qtd, UNIDADES, type CatalogoItem } from '../componentes/Suprimentos';

type Historico = { origem: 'pedido' | 'contrato'; id: string; numero: number; data: string; status: string; fornecedor: string; quantidade: number; precoUnitario: number };
type Form = { id: string | null; tipo: 'material' | 'servico'; codigo: string; descricao: string; unidade: string; planoContaId: string; observacao: string; ativo: boolean };
const VAZIO: Form = { id: null, tipo: 'material', codigo: '', descricao: '', unidade: 'un', planoContaId: '', observacao: '', ativo: true };
const FILTROS = [
  { id: '', texto: 'Todos' },
  { id: 'material', texto: 'Materiais' },
  { id: 'servico', texto: 'Serviços' },
] as const;

export function SupCatalogo() {
  const [itens, setItens] = useState<CatalogoItem[] | null>(null);
  const [planos, setPlanos] = useState<PlanoConta[]>([]);
  const [filtro, setFiltro] = useState<'' | 'material' | 'servico'>('');
  const [inativos, setInativos] = useState(false);
  const [busca, setBusca] = useState('');
  const [f, setF] = useState<Form | null>(null);
  const [aberto, setAberto] = useState<(CatalogoItem & { historico: Historico[] }) | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(() => {
    api<{ itens: CatalogoItem[] }>(`/sup/catalogo${inativos ? '?inativos=1' : ''}`).then((r) => setItens(r.itens)).catch((e) => setErro((e as Error).message));
  }, [inativos]);
  useEffect(carregar, [carregar]);
  useEffect(() => {
    api<{ contas: PlanoConta[] }>('/fin/plano-contas').then((r) => setPlanos(r.contas.filter((p) => p.tipo === 'despesa' && p.aceitaLancamento && p.ativo))).catch(() => {});
  }, []);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!f) return;
    setErro('');
    setOcupado(true);
    try {
      const corpo = { tipo: f.tipo, codigo: f.codigo.trim() || null, descricao: f.descricao, unidade: f.unidade, planoContaId: f.planoContaId || null, observacao: f.observacao || null, ativo: f.ativo };
      if (f.id) await api(`/sup/catalogo/${f.id}`, { metodo: 'PUT', corpo });
      else await api('/sup/catalogo', { corpo });
      setAviso(f.id ? 'Item alterado.' : 'Item cadastrado no catálogo.');
      setF(null);
      setAberto(null);
      carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
    setOcupado(false);
  }

  async function abrir(id: string) {
    setErro('');
    try {
      setAberto((await api<{ item: CatalogoItem & { historico: Historico[] } }>(`/sup/catalogo/${id}`)).item);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  const termo = busca.trim().toLowerCase();
  const visiveis = (itens ?? []).filter((i) => (!filtro || i.tipo === filtro) && (!termo || `${i.codigo} ${i.descricao}`.toLowerCase().includes(termo)));
  const editar = (i: CatalogoItem) =>
    setF({ id: i.id, tipo: i.tipo, codigo: i.codigo, descricao: i.descricao, unidade: i.unidade, planoContaId: i.planoContaId ?? '', observacao: i.observacao ?? '', ativo: i.ativo });

  return (
    <>
      <CabecalhoDocumento
        modulo="Suprimentos"
        titulo="Catálogo de materiais e serviços"
        descricao="Peças, materiais de consumo e serviços cadastrados uma vez, com código, unidade, categoria e último preço. Os insumos da usina continuam em Produção › Insumos."
        acoes={!f ? <button className="btn btn-primario" type="button" onClick={() => { setF({ ...VAZIO, tipo: filtro === 'servico' ? 'servico' : 'material' }); setAviso(''); }}>Novo item</button> : undefined}
      />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}

      {f && (
        <form className="card form nao-imprimir" onSubmit={salvar}>
          <h2>{f.id ? 'Editar item' : 'Novo item do catálogo'}</h2>
          <div className="campos">
            <div className="campo">
              <span className="rotulo" id="cat-tipo">Tipo</span>
              <div className="segmentado" role="group" aria-labelledby="cat-tipo">
                {(['material', 'servico'] as const).map((t) => (
                  <button key={t} type="button" aria-pressed={f.tipo === t} className={f.tipo === t ? 'ativo' : ''} onClick={() => setF({ ...f, tipo: t })}>
                    {t === 'material' ? 'Material' : 'Serviço'}
                  </button>
                ))}
              </div>
            </div>
            <div className="campo">
              <label htmlFor="cat-cod">Código</label>
              <input id="cat-cod" className="mono" maxLength={30} value={f.codigo} onChange={(e) => setF({ ...f, codigo: e.target.value })} placeholder={f.id ? '' : 'Automático (M-0001, S-0001)'} />
            </div>
            <div className="campo">
              <label htmlFor="cat-un">Unidade</label>
              <select id="cat-un" value={f.unidade} onChange={(e) => setF({ ...f, unidade: e.target.value })}>
                {[...new Set([f.unidade, ...UNIDADES, 'mês', 'diária', 'balde', 'rolo', 'par', 'jogo', 'l'])].map((u) => <option key={u} value={u}>{u === 'm3' ? 'm³' : u === 'm2' ? 'm²' : u}</option>)}
              </select>
            </div>
          </div>
          <div className="campo">
            <label htmlFor="cat-desc">Descrição</label>
            <input id="cat-desc" maxLength={200} value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} placeholder={f.tipo === 'material' ? 'Ex.: filtro de ar do motor (betoneira)' : 'Ex.: hora técnica de eletricista'} required />
          </div>
          <div className="campos">
            <div className="campo">
              <label htmlFor="cat-plano">Categoria padrão (plano de contas)</label>
              <select id="cat-plano" value={f.planoContaId} onChange={(e) => setF({ ...f, planoContaId: e.target.value })}>
                <option value="">Não definir</option>
                {planos.map((p) => <option key={p.id} value={p.id}>{p.codigo} {p.nome}</option>)}
              </select>
              <span className="small muted">Usada na nota recebida pelo pedido, quando o item da nota ainda não tem categoria.</span>
            </div>
            <div className="campo">
              <label htmlFor="cat-obs">Observação</label>
              <input id="cat-obs" maxLength={500} value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} placeholder="Marca, especificação, aplicação…" />
            </div>
          </div>
          {f.id && (
            <label className="marcar">
              <input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} />
              <span>Ativo (aparece para escolher nas compras e contratos)</span>
            </label>
          )}
          <div className="acoes">
            <button className="btn btn-primario" type="submit" disabled={ocupado}>{f.id ? 'Salvar' : 'Cadastrar'}</button>
            <button className="btn btn-secundario" type="button" onClick={() => setF(null)}>Cancelar</button>
          </div>
        </form>
      )}

      <div className="filtros nao-imprimir" style={{ alignItems: 'center' }}>
        <div className="segmentado tres-opcoes" role="group" aria-label="Tipo" style={{ maxWidth: 380 }}>
          {FILTROS.map((x) => (
            <button key={x.id} type="button" aria-pressed={filtro === x.id} className={filtro === x.id ? 'ativo' : ''} onClick={() => setFiltro(x.id)}>{x.texto}</button>
          ))}
        </div>
        <input aria-label="Buscar no catálogo" placeholder="Buscar por código ou descrição" value={busca} onChange={(e) => setBusca(e.target.value)} style={{ width: 300, maxWidth: "100%", minHeight: 40 }} />
        <label className="marcar"><input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} /><span>Mostrar inativos</span></label>
      </div>

      <div className="card tabela-caixa">
        {!itens ? (
          <p className="muted">Carregando…</p>
        ) : visiveis.length === 0 ? (
          <p className="muted">Nenhum item. Use "Novo item" para cadastrar peças, materiais e serviços.</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr><th>Código</th><th>Descrição</th><th>Tipo</th><th>Un.</th><th>Categoria</th><th style={{ textAlign: 'right' }}>Último preço</th><th>Último fornecedor</th><th className="nao-imprimir"><span style={{ position: 'absolute', left: -9999 }}>Ações</span></th></tr>
            </thead>
            <tbody>
              {visiveis.map((i) => (
                <tr key={i.id} className={i.ativo ? '' : 'folga'}>
                  <td className="mono">{i.codigo}</td>
                  <td>
                    {i.descricao}
                    {!i.ativo && <span className="small muted"> · inativo</span>}
                    {i.observacao && <div className="small muted">{i.observacao}</div>}
                  </td>
                  <td>{i.tipo === 'material' ? 'Material' : 'Serviço'}</td>
                  <td>{i.unidade === 'm3' ? 'm³' : i.unidade}</td>
                  <td className="small">{i.planoConta ?? '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    {precoUn(i.ultimoPreco)}
                    {i.ultimoPrecoEm && <div className="small muted">{formatarData(i.ultimoPrecoEm)}</div>}
                  </td>
                  <td className="small">{i.ultimoFornecedor ?? '—'}</td>
                  <td className="nao-imprimir">
                    <button className="btn btn-link" type="button" onClick={() => abrir(i.id)}>Histórico</button>
                    <button className="btn btn-link" type="button" onClick={() => { editar(i); window.scrollTo(0, 0); }}>Editar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {aberto && (
        <div className="card tabela-caixa">
          <div className="cartao-topo">
            <h2>Histórico de preços · {aberto.codigo} {aberto.descricao}</h2>
            <button className="btn btn-link nao-imprimir" type="button" onClick={() => setAberto(null)}>Fechar</button>
          </div>
          {aberto.historico.length === 0 ? (
            <p className="muted">Ainda não foi pedido nem contratado.</p>
          ) : (
            <table className="tabela tabela-compacta">
              <thead><tr><th>Data</th><th>Origem</th><th>Fornecedor</th><th style={{ textAlign: 'right' }}>Quantidade</th><th style={{ textAlign: 'right' }}>Preço unitário</th></tr></thead>
              <tbody>
                {aberto.historico.map((h) => (
                  <tr key={`${h.origem}-${h.id}`}>
                    <td>{formatarData(h.data)}</td>
                    <td>
                      <Link to={h.origem === 'pedido' ? `/sup/pedidos/${h.id}` : `/sup/contratos/${h.id}`}>
                        {h.origem === 'pedido' ? 'Pedido' : 'Contrato'} nº {numeroDoc(h.numero)}
                      </Link>
                    </td>
                    <td>{h.fornecedor}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{qtd(h.quantidade, aberto.unidade)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{precoUn(h.precoUnitario)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
