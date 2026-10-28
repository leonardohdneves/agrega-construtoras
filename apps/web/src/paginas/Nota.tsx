import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  api,
  formatarChave,
  formatarData,
  formatarDataHoraCurta,
  formatarDocumento,
  formatarMoeda,
  formatarNumero,
  hojeLocal,
  lerNumero,
  moedaCampo,
  NOMES_FORMA,
  NOMES_ITEM_OS,
  NOMES_MODELO,
  NOMES_UNIDADE,
  SELO_NOTA,
  somarDias,
  TEXTO_SUGESTAO,
  type FormaPagamento,
  type Insumo,
  type ItemNota,
  type ModeloNota,
  type NotaFiscal,
  type TipoLanc,
} from '../api';
import { OpcoesCategoria, useCadastros, type Cadastros } from './Lancamento';
import { imagemParaJpeg } from '../leitorBarras';

/** Origens em que os dados do documento e os itens podem ser corrigidos à mão. */
const DIGITAVEL = new Set<NotaFiscal['origem']>(['manual', 'pdf', 'chave']);
const ORIGEM_TEXTO: Record<NotaFiscal['origem'], string> = { xml: 'importada do XML', manual: 'digitada', ia_whatsapp: 'recebida pelo WhatsApp', pdf: 'lida do PDF', chave: 'criada pelo código de barras' };
const CONFERIR_TEXTO: Record<string, string> = { dataEmissao: 'a data de emissão', fornecedor: 'o fornecedor', itens: 'os itens', total: 'o total' };
const METODO_TEXTO: Record<string, string> = { leitor: 'pelo leitor do Agrega', ia: 'pela IA', codigo_barras: 'pela chave do código de barras' };


const soma = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;

// ======================= Nota lançada à mão =======================
type ItemForm = { chave: number; descricao: string; quantidade: string; unidade: string; valor: string; planoContaId: string; centroCustoId: string; veiculoId: string };
let seq = 0;
const itemVazio = (): ItemForm => ({ chave: ++seq, descricao: '', quantidade: '1', unidade: '', valor: '', planoContaId: '', centroCustoId: '', veiculoId: '' });

function NovaNota({ cadastros }: { cadastros: Cadastros }) {
  const navegar = useNavigate();
  const [params] = useSearchParams();
  const [direcao, setDirecao] = useState<'entrada' | 'saida'>(params.get('direcao') === 'saida' ? 'saida' : 'entrada');
  const tipo: TipoLanc = direcao === 'saida' ? 'receita' : 'despesa';
  const [f, setF] = useState({ modelo: 'nfe' as ModeloNota, numero: '', serie: '', chaveAcesso: '', dataEmissao: hojeLocal(), pessoaId: '', frete: '', desconto: '', outras: '', observacoes: '' });
  const [itens, setItens] = useState<ItemForm[]>([itemVazio()]);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const pessoas = direcao === 'entrada' ? cadastros.fornecedores.filter((x) => x.ativo) : cadastros.clientes.filter((x) => x.ativo);
  const produtos = soma(itens.map((i) => lerNumero(i.valor) ?? 0));
  const total = Math.round((produtos + (lerNumero(f.frete) ?? 0) + (lerNumero(f.outras) ?? 0) - (lerNumero(f.desconto) ?? 0)) * 100) / 100;
  const mudarItem = (chave: number, p: Partial<ItemForm>) => setItens((xs) => xs.map((x) => (x.chave === chave ? { ...x, ...p } : x)));

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setOcupado(true);
    try {
      const r = await api<{ nota: NotaFiscal }>('/fin/notas', {
        corpo: {
          direcao,
          modelo: f.modelo,
          numero: f.numero,
          serie: f.serie,
          chaveAcesso: f.chaveAcesso || null,
          dataEmissao: f.dataEmissao,
          fornecedorId: direcao === 'entrada' ? f.pessoaId || null : null,
          clienteId: direcao === 'saida' ? f.pessoaId || null : null,
          frete: f.frete,
          desconto: f.desconto,
          outras: f.outras,
          observacoes: f.observacoes,
          itens: itens.map(({ chave: _c, ...i }) => i),
        },
      });
      navegar(`/fin/notas/${r.nota.id}`, { replace: true, state: { aviso: 'Nota salva para conferência. Confira as categorias e confirme para lançar.' } });
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
          <span className="rotulo" id="n-dir">Tipo de nota</span>
          <div className="segmentado" role="group" aria-labelledby="n-dir">
            <button type="button" aria-pressed={direcao === 'entrada'} className={direcao === 'entrada' ? 'ativo' : ''} onClick={() => { setDirecao('entrada'); setF({ ...f, pessoaId: '' }); }}>
              Compra
            </button>
            <button type="button" aria-pressed={direcao === 'saida'} className={direcao === 'saida' ? 'ativo' : ''} onClick={() => { setDirecao('saida'); setF({ ...f, pessoaId: '' }); }}>
              Venda
            </button>
          </div>
        </div>
        <div className="campo">
          <label htmlFor="n-modelo">Documento</label>
          <select id="n-modelo" value={f.modelo} onChange={(e) => setF({ ...f, modelo: e.target.value as ModeloNota })}>
            {(Object.keys(NOMES_MODELO) as ModeloNota[]).map((m) => (
              <option key={m} value={m}>{NOMES_MODELO[m]}</option>
            ))}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="n-num">Número</label>
          <input id="n-num" className="mono" value={f.numero} onChange={(e) => setF({ ...f, numero: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="n-serie">Série</label>
          <input id="n-serie" className="mono" value={f.serie} onChange={(e) => setF({ ...f, serie: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="n-emissao">Emissão</label>
          <input id="n-emissao" type="date" value={f.dataEmissao} onChange={(e) => setF({ ...f, dataEmissao: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="n-pessoa">{direcao === 'entrada' ? 'Fornecedor' : 'Cliente'}</label>
          <select id="n-pessoa" value={f.pessoaId} onChange={(e) => setF({ ...f, pessoaId: e.target.value })}>
            <option value="">Escolha</option>
            {pessoas.map((p) => (
              <option key={p.id} value={p.id}>{p.nomeFantasia || p.razaoSocial}</option>
            ))}
          </select>
          <span className="small muted">
            Não está na lista? <Link to={direcao === 'entrada' ? '/adm/fornecedores' : '/adm/clientes'}>Cadastre em Administrativo</Link>.
          </span>
        </div>
      </div>
      {(f.modelo === 'nfe' || f.modelo === 'nfce') && (
        <div className="campo">
          <label htmlFor="n-chave">Chave de acesso (opcional, 44 números)</label>
          <input id="n-chave" className="mono" inputMode="numeric" value={f.chaveAcesso} onChange={(e) => setF({ ...f, chaveAcesso: e.target.value })} />
          <span className="ajuda">Com a chave, o sistema impede lançar a mesma nota duas vezes. Se tiver o XML, prefira importar.</span>
        </div>
      )}

      <h2 style={{ margin: '8px 0 0' }}>Itens</h2>
      {itens.map((i, k) => (
        <div key={i.chave} className="item-nota-form">
          <div className="campos">
            <div className="campo" style={{ gridColumn: 'span 2' }}>
              <label htmlFor={`i-desc-${i.chave}`}>Item {k + 1}</label>
              <input id={`i-desc-${i.chave}`} value={i.descricao} placeholder="Ex.: Óleo diesel S10" onChange={(e) => mudarItem(i.chave, { descricao: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor={`i-qtd-${i.chave}`}>Quantidade</label>
              <input id={`i-qtd-${i.chave}`} className="mono" inputMode="decimal" value={i.quantidade} onChange={(e) => mudarItem(i.chave, { quantidade: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor={`i-un-${i.chave}`}>Unidade</label>
              <input id={`i-un-${i.chave}`} value={i.unidade} placeholder="L, un, t…" onChange={(e) => mudarItem(i.chave, { unidade: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor={`i-valor-${i.chave}`}>Valor total do item (R$)</label>
              <input id={`i-valor-${i.chave}`} className="mono" inputMode="decimal" placeholder="0,00" value={i.valor} onChange={(e) => mudarItem(i.chave, { valor: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor={`i-cat-${i.chave}`}>Categoria</label>
              <select id={`i-cat-${i.chave}`} value={i.planoContaId} onChange={(e) => mudarItem(i.chave, { planoContaId: e.target.value })}>
                <OpcoesCategoria plano={cadastros.plano} tipo={tipo} atual={i.planoContaId} />
              </select>
            </div>
            <div className="campo">
              <label htmlFor={`i-cc-${i.chave}`}>Centro de custo</label>
              <select id={`i-cc-${i.chave}`} value={i.centroCustoId} onChange={(e) => mudarItem(i.chave, { centroCustoId: e.target.value })}>
                <option value="">—</option>
                {cadastros.centros.filter((c) => c.ativo).map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </div>
          </div>
          {itens.length > 1 && (
            <button className="btn btn-link" type="button" onClick={() => setItens((xs) => xs.filter((x) => x.chave !== i.chave))}>
              Remover item {k + 1}
            </button>
          )}
        </div>
      ))}
      <div className="acoes">
        <button className="btn btn-secundario" type="button" onClick={() => setItens((xs) => [...xs, itemVazio()])}>
          + Item
        </button>
        <span className="small muted">Sem categoria, o sistema sugere uma pela descrição; você confere antes de lançar.</span>
      </div>

      <div className="campos">
        <div className="campo">
          <label htmlFor="n-frete">Frete (R$)</label>
          <input id="n-frete" className="mono" inputMode="decimal" placeholder="0,00" value={f.frete} onChange={(e) => setF({ ...f, frete: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="n-outras">Outras despesas (R$)</label>
          <input id="n-outras" className="mono" inputMode="decimal" placeholder="0,00" value={f.outras} onChange={(e) => setF({ ...f, outras: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="n-desc">Desconto (R$)</label>
          <input id="n-desc" className="mono" inputMode="decimal" placeholder="0,00" value={f.desconto} onChange={(e) => setF({ ...f, desconto: e.target.value })} />
        </div>
        <div className="campo">
          <span className="rotulo">Total da nota</span>
          <strong className="mono" style={{ fontSize: 22, lineHeight: '48px' }}>{formatarMoeda(total)}</strong>
        </div>
      </div>
      <div className="campo">
        <label htmlFor="n-obs">Observações</label>
        <input id="n-obs" value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} />
      </div>
      <div className="acoes">
        <button className="btn btn-primario" type="submit" disabled={ocupado}>
          {ocupado ? 'Salvando…' : 'Salvar e conferir'}
        </button>
        <Link className="btn btn-secundario" to="/fin/notas">Cancelar</Link>
        <span className="small muted">Os vencimentos e o pagamento você informa na próxima tela, ao confirmar.</span>
      </div>
    </form>
  );
}

// ======================= Vínculo com o item do pedido de compra =======================
function VinculoPedidoItem({
  item,
  pedido,
  salvar,
  aoFechar,
}: {
  item: ItemNota;
  pedido: NonNullable<NotaFiscal['pedido']>;
  salvar: (corpo: Record<string, unknown>) => Promise<void>;
  aoFechar: () => void;
}) {
  const [pedidoItemId, setPedidoItemId] = useState(item.pedidoItemId ?? '');
  const base = item.quantidadePedido ?? item.quantidade;
  const [qtd, setQtd] = useState(formatarNumero(base, base % 1 ? 3 : 0));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');

  async function gravar() {
    const quantidade = lerNumero(qtd) ?? 0;
    if (pedidoItemId && !(quantidade > 0)) {
      setErro('Informe a quantidade deste item que chega nesta linha da nota.');
      return;
    }
    setErro('');
    setOcupado(true);
    try {
      await salvar(pedidoItemId ? { pedidoItemId, quantidadePedido: quantidade } : { pedidoItemId: null, quantidadePedido: null });
      aoFechar();
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="row" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
      <label style={{ flex: '1 1 320px', minWidth: 0 }}>
        <span className="small muted">Item do pedido nº {pedido.numero}</span>
        <select aria-label="Item do pedido" value={pedidoItemId} onChange={(e) => setPedidoItemId(e.target.value)} style={{ width: '100%' }}>
          <option value="">— sem vínculo —</option>
          {pedido.itens.map((p) => (
            <option key={p.id} value={p.id}>
              {p.descricao} · {formatarNumero(p.quantidade, p.quantidade % 1 ? 3 : 0)} {p.unidade}
              {p.nestaNota && p.id !== item.pedidoItemId ? ' (já vinculado a outra linha desta nota)' : ''}
            </option>
          ))}
        </select>
      </label>
      <label style={{ width: 140 }}>
        <span className="small muted">Quantidade nesta linha</span>
        <input className="mono" inputMode="decimal" value={qtd} disabled={!pedidoItemId} onChange={(e) => setQtd(e.target.value)} />
      </label>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-primario" type="button" onClick={gravar} disabled={ocupado}>
          Salvar
        </button>
        <button className="btn btn-link" type="button" onClick={aoFechar}>
          Cancelar
        </button>
      </div>
      {erro && <div className="erro" style={{ width: '100%' }}>{erro}</div>}
    </div>
  );
}

// ======================= Vínculos com abastecimentos e OS =======================
type Candidatos = {
  item: { id: string; descricao: string; quantidade: number; unidade: string | null; valorCusto: number };
  abastecimentos: { id: string; dataHora: string; litros: number; valor: number | null; veiculoCodigo: string; posto: string | null; mesmoFornecedor: boolean; vinculado: boolean; emOutraNota: string | null }[];
  osItens: { id: string; tipo: keyof typeof NOMES_ITEM_OS; descricao: string; quantidade: number; total: number; osNumero: number; abertura: string; osStatus: string; veiculoCodigo: string; oficina: string | null; mesmoFornecedor: boolean; vinculado: boolean; emOutraNota: string | null }[];
};

function Vinculos({ item, emissao, aoSalvar, aoFechar }: { item: ItemNota; emissao: string; aoSalvar: (n: NotaFiscal) => void; aoFechar: () => void }) {
  const [c, setC] = useState<Candidatos | null>(null);
  const [selA, setSelA] = useState<Set<string>>(new Set());
  const [selO, setSelO] = useState<Set<string>>(new Set());
  const [aba, setAba] = useState<'abast' | 'os'>(item.os ? 'os' : 'abast');
  const [todos, setTodos] = useState(false);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    api<Candidatos>(`/fin/notas/itens/${item.id}/candidatos`)
      .then((r) => {
        setC(r);
        setSelA(new Set(r.abastecimentos.filter((a) => a.vinculado).map((a) => a.id)));
        setSelO(new Set(r.osItens.filter((o) => o.vinculado).map((o) => o.id)));
        if (!item.abastecimentos && !item.os && !/diesel|s10|s500|combust/i.test(item.descricao) && r.osItens.some((o) => o.mesmoFornecedor)) setAba('os');
      })
      .catch((e) => setErro((e as Error).message));
  }, [item]);

  const alternar = (s: Set<string>, set: (x: Set<string>) => void, id: string) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    set(n);
  };

  const abast = (c?.abastecimentos ?? []).filter((a) => todos || a.mesmoFornecedor || a.vinculado);
  const os = (c?.osItens ?? []).filter((o) => todos || o.mesmoFornecedor || o.vinculado);
  const escolhidosA = (c?.abastecimentos ?? []).filter((a) => selA.has(a.id));
  const litros = soma(escolhidosA.map((a) => a.litros));
  const valorA = soma(escolhidosA.map((a) => a.valor ?? 0));
  const valorO = soma((c?.osItens ?? []).filter((o) => selO.has(o.id)).map((o) => o.total));

  // Do mais recente para o mais antigo (até a emissão), soma os litros até chegar na quantidade do item.
  function completar() {
    const livres = abast
      .filter((a) => !a.emOutraNota && a.dataHora.slice(0, 10) <= somarDias(emissao, 1))
      .sort((a, b) => b.dataHora.localeCompare(a.dataHora));
    const novo = new Set<string>();
    let total = 0;
    for (const a of livres) {
      if (total >= item.quantidade - 0.5) break;
      novo.add(a.id);
      total += a.litros;
    }
    setSelA(novo);
  }

  async function salvar() {
    setErro('');
    setOcupado(true);
    try {
      const r = await api<{ nota: NotaFiscal }>(`/fin/notas/itens/${item.id}/vinculos`, { metodo: 'PUT', corpo: { abastecimentoIds: [...selA], osItemIds: [...selO] } });
      aoSalvar(r.nota);
    } catch (e) {
      setErro((e as Error).message);
      setOcupado(false);
    }
  }

  return (
    <div className="painel-vinculo">
      <p className="small" style={{ margin: 0 }}>
        Ligue este item aos registros da frota que ele paga. Assim o diesel e as peças não contam duas vezes, e o custo é dividido entre os veículos certos.
      </p>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div className="abas" role="tablist">
        <button type="button" role="tab" aria-selected={aba === 'abast'} className={aba === 'abast' ? 'ativa' : ''} onClick={() => setAba('abast')}>
          Abastecimentos {selA.size ? `(${selA.size})` : ''}
        </button>
        <button type="button" role="tab" aria-selected={aba === 'os'} className={aba === 'os' ? 'ativa' : ''} onClick={() => setAba('os')}>
          Ordens de serviço {selO.size ? `(${selO.size})` : ''}
        </button>
      </div>
      {!c ? (
        <p className="muted">Carregando…</p>
      ) : aba === 'abast' ? (
        <>
          <div className="acoes small">
            <label className="marcar" style={{ minHeight: 0 }}>
              <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} />
              <span>Mostrar de outros postos</span>
            </label>
            {abast.length > 0 && item.quantidade > 0 && (
              <button className="btn btn-link" type="button" onClick={completar}>
                Marcar até completar {formatarNumero(item.quantidade, 0)} {item.unidade ?? ''}
              </button>
            )}
            {selA.size > 0 && <button className="btn btn-link" type="button" onClick={() => setSelA(new Set())}>Desmarcar</button>}
          </div>
          {abast.length === 0 ? (
            <p className="small muted">Nenhum abastecimento deste posto nos 60 dias antes da emissão. Marque "Mostrar de outros postos" se o posto não foi informado no abastecimento.</p>
          ) : (
            <div className="lista-vinculo">
              {abast.map((a) => (
                <label key={a.id} className={`marcar ${a.emOutraNota ? 'desabilitado' : ''}`}>
                  <input type="checkbox" disabled={!!a.emOutraNota} checked={selA.has(a.id)} onChange={() => alternar(selA, setSelA, a.id)} />
                  <span className="mono small">{formatarDataHoraCurta(a.dataHora)}</span>
                  <span className="mono" style={{ fontWeight: 600 }}>{a.veiculoCodigo}</span>
                  <span className="mono small">{formatarNumero(a.litros, 1)} L</span>
                  <span className="mono small">{formatarMoeda(a.valor)}</span>
                  <span className="small muted">{a.emOutraNota ? `já na nota: ${a.emOutraNota}` : a.posto ?? ''}</span>
                </label>
              ))}
            </div>
          )}
          <p className="small" style={{ margin: 0 }}>
            Escolhidos: <strong className="mono">{formatarNumero(litros, 1)} L</strong> · <strong className="mono">{formatarMoeda(valorA)}</strong>
            {' '}— no item da nota: <span className="mono">{formatarNumero(item.quantidade, 1)} {item.unidade ?? ''}</span> · <span className="mono">{formatarMoeda(item.valorCusto)}</span>
            {item.unidade && /^l/i.test(item.unidade) && selA.size > 0 && Math.abs(litros - item.quantidade) > 0.5 && (
              <span style={{ color: 'var(--status-warn-ink)' }}> · diferença de {formatarNumero(Math.abs(litros - item.quantidade), 1)} L</span>
            )}
          </p>
        </>
      ) : (
        <>
          <label className="marcar small" style={{ minHeight: 0 }}>
            <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} />
            <span>Mostrar OS de outras oficinas</span>
          </label>
          {os.length === 0 ? (
            <p className="small muted">Nenhuma OS desta oficina nos 4 meses antes da emissão.</p>
          ) : (
            <div className="lista-vinculo">
              {os.map((o) => (
                <label key={o.id} className={`marcar ${o.emOutraNota ? 'desabilitado' : ''}`}>
                  <input type="checkbox" disabled={!!o.emOutraNota} checked={selO.has(o.id)} onChange={() => alternar(selO, setSelO, o.id)} />
                  <span className="mono" style={{ fontWeight: 600 }}>OS #{o.osNumero}</span>
                  <span className="mono">{o.veiculoCodigo}</span>
                  <span className="small">{NOMES_ITEM_OS[o.tipo]}: {o.descricao}</span>
                  <span className="mono small">{formatarMoeda(o.total)}</span>
                  <span className="small muted">{o.emOutraNota ? `já na nota: ${o.emOutraNota}` : o.oficina ?? 'oficina própria'}</span>
                </label>
              ))}
            </div>
          )}
          <p className="small" style={{ margin: 0 }}>
            Escolhidos: <strong className="mono">{formatarMoeda(valorO)}</strong> — no item da nota: <span className="mono">{formatarMoeda(item.valorCusto)}</span>
          </p>
        </>
      )}
      <div className="acoes">
        <button className="btn btn-primario" type="button" disabled={ocupado || !c} onClick={salvar}>
          Salvar vínculo
        </button>
        <button className="btn btn-secundario" type="button" onClick={aoFechar}>
          Fechar
        </button>
      </div>
    </div>
  );
}

// ======================= Item da nota (linha) =======================
/** Obra, insumo da obra e etapa da EAP do item: é daqui que sai a apropriação do estoque da construtora. */
function ApropriacaoEstoque({ item, editavel, salvar }: { item: ItemNota; editavel: boolean; salvar: (corpo: Record<string, unknown>) => void }) {
  const [obras, setObras] = useState<{ id: string; codigo: string; nome: string }[]>([]);
  const [insumos, setInsumos] = useState<{ id: string; codigo: string; descricao: string }[]>([]);
  const [etapas, setEtapas] = useState<{ id: string; codigo: string; descricao: string }[]>([]);
  const [estoques, setEstoques] = useState<{ id: string; codigo: string; nome: string; obraId: string | null }[]>([]);
  useEffect(() => {
    if (!editavel) return;
    api<{ obras: { id: string; codigo: string; nome: string }[] }>('/eng/obras').then((r) => setObras(r.obras)).catch(() => setObras([]));
  }, [editavel]);
  useEffect(() => {
    if (!item.obraId) { setInsumos([]); setEtapas([]); setEstoques([]); return; }
    api<{ itens: { id: string; codigo: string; descricao: string }[] }>(`/eng/obras/${item.obraId}/itens?tipo=insumo`).then((r) => setInsumos(r.itens ?? [])).catch(() => setInsumos([]));
    api<{ nos: { id: string; codigo: string; descricao: string }[] }>(`/eng/obras/${item.obraId}/eap`).then((r) => setEtapas(r.nos ?? [])).catch(() => setEtapas([]));
    api<{ estoques: { id: string; codigo: string; nome: string; obraId: string | null }[] }>(`/sup/estoques?obraId=${item.obraId}`).then((r) => setEstoques(r.estoques ?? [])).catch(() => setEstoques([]));
  }, [item.obraId]);
  if (!editavel) {
    return <span className="small">{item.obraItemDescricao ?? '—'}{item.eapCodigo ? ` · etapa ${item.eapCodigo}` : ''}</span>;
  }
  return (
    <div className="estoque-apropriacao">
      <select aria-label="Obra do estoque" className="campo-tabela" value={item.obraId ?? ''} onChange={(e) => salvar({ obraId: e.target.value || null, obraItemId: null, eapNoId: null })}>
        <option value="">Obra…</option>
        {obras.map((o) => <option key={o.id} value={o.id}>{o.codigo} · {o.nome}</option>)}
      </select>
      <select aria-label="Insumo da obra" className="campo-tabela" value={item.obraItemId ?? ''} disabled={!item.obraId} onChange={(e) => salvar({ obraItemId: e.target.value || null })}>
        <option value="">Insumo…</option>
        {insumos.map((i) => <option key={i.id} value={i.id}>{i.codigo} · {i.descricao}</option>)}
      </select>
      <select aria-label="Etapa da EAP" className="campo-tabela" value={item.eapNoId ?? ''} disabled={!item.obraId} onChange={(e) => salvar({ eapNoId: e.target.value || null })}>
        <option value="">Etapa…</option>
        {etapas.map((n) => <option key={n.id} value={n.id}>{n.codigo} {n.descricao}</option>)}
      </select>
      <select aria-label="Estoque de recebimento" className="campo-tabela" value={item.obraEstoqueId ?? ''} disabled={!item.obraId} onChange={(e) => salvar({ obraEstoqueId: e.target.value || null })}>
        <option value="">Recebimento da obra</option>
        {estoques.map((x) => <option key={x.id} value={x.id}>{x.codigo} · {x.nome}{x.obraId ? '' : ' (geral)'}</option>)}
      </select>
    </div>
  );
}

function LinhaItem({
  item,
  nota,
  cadastros,
  editavel,
  insumos,
  aoMudar,
  aoErro,
}: {
  item: ItemNota;
  nota: NotaFiscal;
  cadastros: Cadastros;
  editavel: boolean;
  insumos: Insumo[];
  aoMudar: (n: NotaFiscal) => void;
  aoErro: (m: string) => void;
}) {
  const [vinculo, setVinculo] = useState(false);
  const [vincPedido, setVincPedido] = useState(false);
  const [dividindo, setDividindo] = useState(false);
  const [qtdSai, setQtdSai] = useState('');
  const [salvando, setSalvando] = useState(false);
  async function dividir() {
    aoErro('');
    const q = lerNumero(qtdSai) ?? 0;
    if (!(q > 0 && q < item.quantidade)) {
      aoErro(`Informe uma quantidade entre 0 e ${formatarNumero(item.quantidade, item.quantidade % 1 ? 3 : 0)} para a parte que sai desta linha.`);
      return;
    }
    setSalvando(true);
    try {
      aoMudar((await api<{ nota: NotaFiscal }>(`/fin/notas/itens/${item.id}/dividir`, { metodo: 'POST', corpo: { quantidade: q } })).nota);
      setDividindo(false);
      setQtdSai('');
    } catch (e) {
      aoErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }
  const [desc, setDesc] = useState({ descricao: item.descricao, quantidade: formatarNumero(item.quantidade, item.quantidade % 1 ? 3 : 0), valor: moedaCampo(item.valorProduto) });
  const manual = DIGITAVEL.has(nota.origem);
  const [fator, setFator] = useState(item.fatorEstoque ? String(item.fatorEstoque).replace('.', ',') : '');
  useEffect(() => setFator(item.fatorEstoque ? String(item.fatorEstoque).replace('.', ',') : ''), [item.fatorEstoque]);
  const unidadeInsumo = item.insumoUnidade ? NOMES_UNIDADE[item.insumoUnidade] : '';

  async function salvar(corpo: Record<string, unknown>) {
    aoErro('');
    setSalvando(true);
    try {
      aoMudar((await api<{ nota: NotaFiscal }>(`/fin/notas/itens/${item.id}`, { metodo: 'PATCH', corpo })).nota);
    } catch (e) {
      aoErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }
  async function remover() {
    aoErro('');
    try {
      aoMudar((await api<{ nota: NotaFiscal }>(`/fin/notas/itens/${item.id}`, { metodo: 'DELETE' })).nota);
    } catch (e) {
      aoErro((e as Error).message);
    }
  }

  return (
    <Fragment>
      <tr className={salvando ? 'salvando' : undefined}>
        <td className="mono small">{item.numeroItem}</td>
        <td style={{ minWidth: 190 }}>
          {editavel && manual ? (
            <textarea
              aria-label="Descrição do item"
              className="campo-tabela"
              rows={Math.min(6, Math.max(1, Math.ceil(desc.descricao.length / 60)))}
              style={{ resize: 'vertical', width: '100%' }}
              value={desc.descricao}
              onChange={(e) => setDesc({ ...desc, descricao: e.target.value })}
              onBlur={() => desc.descricao.trim() !== item.descricao && salvar({ descricao: desc.descricao })}
            />
          ) : (
            <span style={{ fontWeight: 500, whiteSpace: 'pre-wrap' }}>{item.descricao}</span>
          )}
          <div className="small muted">
            {editavel && manual ? (
              <>
                <input
                  aria-label="Quantidade"
                  className="campo-tabela mono curto"
                  inputMode="decimal"
                  value={desc.quantidade}
                  onChange={(e) => setDesc({ ...desc, quantidade: e.target.value })}
                  onBlur={() => lerNumero(desc.quantidade) !== item.quantidade && salvar({ quantidade: desc.quantidade })}
                />{' '}
                {item.unidade ?? 'un'}
              </>
            ) : (
              <>
                {formatarNumero(item.quantidade, item.quantidade % 1 ? 3 : 0)} {item.unidade ?? ''}
                {item.ncm ? ` · NCM ${item.ncm}` : ''}
              </>
            )}
          </div>
          {item.abastecimentos && (
            <div className="small" style={{ color: 'var(--status-ok-ink)' }}>
              Ligado a {item.abastecimentos.quantidade} abastecimento(s) · {formatarNumero(item.abastecimentos.litros, 1)} L · {item.abastecimentos.veiculos}
            </div>
          )}
          {item.os && (
            <div className="small" style={{ color: 'var(--status-ok-ink)' }}>
              Ligado a {item.os.quantidade} item(ns) de OS · {item.os.ordens}
            </div>
          )}
          {nota.direcao === 'entrada' && (editavel || item.insumoId) && (
            <div className="small" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
              {editavel ? (
                <>
                  <span className="muted">Cadastro:</span>
                  <select
                    aria-label="Cadastro do item"
                    className="campo-tabela"
                    style={{ width: 'auto', maxWidth: 190 }}
                    value={item.insumoId ? `ins:${item.insumoId}` : ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v.startsWith('ins:')) salvar({ insumoId: v.slice(4) });
                      else salvar({ insumoId: null });
                    }}
                  >
                    <option value="">Lançar sem cadastrar</option>
                    {insumos.some((x) => x.controlaEstoque) && (
                      <optgroup label="Insumos da usina (entra no estoque)">
                        {insumos.filter((x) => x.controlaEstoque && (x.ativo || x.id === item.insumoId)).map((x) => (
                          <option key={x.id} value={`ins:${x.id}`}>{x.nome}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  {item.vinculoSugestao && item.insumoId && (
                    <span className="selo selo-neutro">{item.vinculoSugestao === 'ia' ? 'sugerido pela IA' : 'já usado com este fornecedor'}</span>
                  )}
                  {item.insumoId && (
                    <>
                      <span className="muted">1 {item.unidade || 'un'} =</span>
                      <input
                        aria-label="Fator de conversão"
                        className={`campo-tabela mono curto ${item.fatorEstoque ? '' : 'pendente'}`}
                        inputMode="decimal"
                        value={fator}
                        onChange={(e) => setFator(e.target.value)}
                        onBlur={() => lerNumero(fator) !== item.fatorEstoque && lerNumero(fator) && salvar({ insumoId: item.insumoId, fatorEstoque: fator })}
                      />
                      <span className="muted">{unidadeInsumo}</span>
                    </>
                  )}
                </>
              ) : item.insumoId ? (
                <span style={{ color: 'var(--status-ok-ink)' }}>
                  Entrou no estoque: {formatarNumero(item.quantidade * (item.fatorEstoque ?? 1), 0)} {unidadeInsumo} de {item.insumoNome}
                </span>
              ) : null}
            </div>
          )}
        </td>
        <td style={{ minWidth: 150 }}>
          {editavel ? (
            <select
              aria-label="Categoria"
              className={`campo-tabela ${item.planoContaId ? '' : 'pendente'}`}
              value={item.planoContaId ?? ''}
              onChange={(e) => salvar({ planoContaId: e.target.value || null })}
            >
              <OpcoesCategoria plano={cadastros.plano} tipo={nota.tipo} atual={item.planoContaId ?? ''} />
            </select>
          ) : (
            <span className="small">{item.planoCodigo} {item.planoNome}</span>
          )}
          {editavel && item.sugestao && <div className="small muted">{TEXTO_SUGESTAO[item.sugestao]}</div>}
        </td>
        <td>
          {editavel ? (
            <select aria-label="Centro de custo" className="campo-tabela" value={item.centroCustoId ?? ''} onChange={(e) => salvar({ centroCustoId: e.target.value || null })}>
              <option value="">—</option>
              {cadastros.centros.filter((c) => c.ativo || c.id === item.centroCustoId).map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
          ) : (
            <span className="small">{item.centroNome ?? '—'}</span>
          )}
        </td>
        {nota.direcao === 'entrada' && (
          <td>
            <ApropriacaoEstoque item={item} editavel={!!editavel} salvar={salvar} />
          </td>
        )}
        <td className="mono" style={{ textAlign: 'right' }}>
          {editavel && manual ? (
            <input
              aria-label="Valor do item"
              title="Valor total do item (coluna VLR. TOTAL da nota)"
              className={`campo-tabela mono ${nota.leitura?.conferir.includes('itens') ? 'pendente' : ''}`}
              style={{ textAlign: 'right', width: 110 }}
              inputMode="decimal"
              value={desc.valor}
              onChange={(e) => setDesc({ ...desc, valor: e.target.value })}
              onBlur={() => lerNumero(desc.valor) !== item.valorProduto && salvar({ valor: desc.valor })}
            />
          ) : (
            formatarMoeda(item.valorProduto)
          )}
          {Math.abs(item.valorCusto - item.valorProduto) >= 0.01 && (
            <div className="small muted" title="Valor do item com frete, descontos e impostos da nota rateados">custo {formatarMoeda(item.valorCusto)}</div>
          )}
        </td>
        <td>
          <div className="acoes" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
            {editavel && nota.direcao === 'entrada' && nota.pedido && (
              <button
                className="btn btn-link"
                type="button"
                onClick={() => {
                  setVinculo(false);
                  setVincPedido(!vincPedido);
                }}
              >
                {vincPedido ? 'Fechar' : 'Vincular'}
              </button>
            )}
            {nota.pedido && item.pedidoItemId && (
              <span className="small muted">
                {nota.pedido.itens.find((p) => p.id === item.pedidoItemId)?.descricao ?? 'Item do pedido'}
                {item.quantidadePedido != null ? ` · ${formatarNumero(item.quantidadePedido, item.quantidadePedido % 1 ? 3 : 0)}` : ''}
              </span>
            )}
            {editavel && nota.direcao === 'entrada' && (
              <button
                className="btn btn-link"
                type="button"
                onClick={() => {
                  setVincPedido(false);
                  setVinculo(!vinculo);
                }}
              >
                {vinculo ? 'Fechar' : 'Frota'}
              </button>
            )}
            {editavel && nota.direcao === 'entrada' && item.quantidade > 1 && (
              <button className="btn btn-link" type="button" onClick={() => setDividindo(!dividindo)}>
                {dividindo ? 'Fechar' : 'Dividir'}
              </button>
            )}
            {editavel && manual && nota.itens.length > 1 && (
              <button className="btn btn-link" type="button" onClick={remover}>
                Remover
              </button>
            )}
          </div>
        </td>
      </tr>
      {dividindo && (
        <tr className="linha-form">
          <td colSpan={nota.direcao === 'entrada' ? 7 : 6}>
            <div className="row" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
              <label style={{ width: 260 }}>
                <span className="small muted">
                  Quantidade que sai para uma nova linha (de {formatarNumero(item.quantidade, item.quantidade % 1 ? 3 : 0)})
                </span>
                <input className="mono" inputMode="decimal" value={qtdSai} onChange={(e) => setQtdSai(e.target.value)} />
              </label>
              <button className="btn btn-primario" type="button" onClick={dividir} disabled={salvando}>
                Dividir linha
              </button>
              <span className="small muted" style={{ flex: '1 1 300px' }}>
                Depois da divisão, ligue cada linha ao item do pedido correspondente com o botão Vincular.
              </span>
            </div>
          </td>
        </tr>
      )}
      {vincPedido && nota.pedido && (
        <tr className="linha-form">
          <td colSpan={nota.direcao === 'entrada' ? 7 : 6}>
            <VinculoPedidoItem
              item={item}
              pedido={nota.pedido}
              salvar={salvar}
              aoFechar={() => setVincPedido(false)}
            />
          </td>
        </tr>
      )}
      {vinculo && (
        <tr className="linha-form">
          <td colSpan={nota.direcao === 'entrada' ? 7 : 6}>
            <Vinculos
              item={item}
              emissao={nota.dataEmissao}
              aoFechar={() => setVinculo(false)}
              aoSalvar={(n) => {
                setVinculo(false);
                aoMudar(n);
              }}
            />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

// ======================= Detalhe e conferência =======================
type Dup = { chave: number; vencimento: string; valor: string; numero: string | null };

function DetalheNota({ id, cadastros }: { id: string; cadastros: Cadastros }) {
  const local = useLocation();
  const navegar = useNavigate();
  const [nota, setNota] = useState<NotaFiscal | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState(() => (local.state as { aviso?: string } | null)?.aviso ?? '');
  const [ocupado, setOcupado] = useState(false);
  const [dups, setDups] = useState<Dup[] | null>(null);
  const [lote, setLote] = useState({ planoContaId: '', centroCustoId: '' });
  const [conf, setConf] = useState({ vencimento: '', paga: false, contaId: '', data: hojeLocal(), forma: '' as FormaPagamento | '', aprender: true });
  const [acao, setAcao] = useState<'reabrir' | 'cancelar' | 'excluir' | null>(null);
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  useEffect(() => {
    api<{ insumos: Insumo[] }>('/prod/insumos').then((r) => setInsumos(r.insumos)).catch(() => {});
  }, []);

  const carregar = useCallback(async () => {
    try {
      const n = (await api<{ nota: NotaFiscal }>(`/fin/notas/${id}`)).nota;
      setNota(n);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    carregar();
  }, [carregar]);
  useEffect(() => {
    if (!nota) return;
    setConf((c) => ({
      ...c,
      vencimento: c.vencimento || nota.dataEmissao,
      contaId: c.contaId || cadastros.contas.find((x) => x.ativo && x.tipo === 'banco')?.id || cadastros.contas.find((x) => x.ativo)?.id || '',
      forma: c.forma || nota.formaPagamento || '',
    }));
  }, [nota, cadastros.contas]);

  const editavel = nota?.status === 'rascunho' || nota?.status === 'aguardando_conferencia';
  const semCategoria = useMemo(() => (nota?.itens ?? []).filter((i) => !i.planoContaId).length, [nota]);

  async function executar(fn: () => Promise<{ nota: NotaFiscal }>, msg: string) {
    setErro('');
    setAviso('');
    setOcupado(true);
    try {
      setNota((await fn()).nota);
      setAviso(msg);
      return true;
    } catch (e) {
      setErro((e as Error).message);
      return false;
    } finally {
      setOcupado(false);
    }
  }

  async function alterar(corpo: Record<string, unknown>, msg = '') {
    await executar(() => api(`/fin/notas/${id}`, { metodo: 'PATCH', corpo }), msg);
  }

  async function salvarDups() {
    if (!dups) return;
    const ok = await executar(
      () => api(`/fin/notas/${id}`, { metodo: 'PATCH', corpo: { duplicatas: dups.map((d) => ({ numero: d.numero, vencimento: d.vencimento, valor: d.valor })) } }),
      'Vencimentos salvos.',
    );
    if (ok) setDups(null);
  }

  async function confirmar(e: FormEvent) {
    e.preventDefault();
    if (!nota) return;
    const ok = await executar(
      () =>
        api(`/fin/notas/${id}/confirmar`, {
          corpo: {
            vencimento: nota.duplicatas.length ? undefined : conf.vencimento,
            baixa: conf.paga ? { data: conf.data, contaId: conf.contaId, forma: conf.forma || null } : null,
            aprender: conf.aprender,
          },
        }),
      nota.tipo === 'despesa' ? 'Nota lançada. As parcelas já estão em Contas a pagar.' : 'Nota lançada. As parcelas já estão em Contas a receber.',
    );
    if (ok) window.scrollTo({ top: 0 });
  }

  async function executarAcao() {
    if (acao === 'excluir') {
      setOcupado(true);
      try {
        await api(`/fin/notas/${id}`, { metodo: 'DELETE' });
        navegar('/fin/notas', { replace: true });
      } catch (e) {
        setErro((e as Error).message);
        setOcupado(false);
      }
      return;
    }
    const ok = await executar(
      () => api(`/fin/notas/${id}/${acao}`, { metodo: 'POST' }),
      acao === 'reabrir' ? 'Nota reaberta. O lançamento anterior foi cancelado; confira e confirme de novo.' : 'Nota cancelada.',
    );
    if (ok) setAcao(null);
  }

  if (!nota) return erro ? <div className="alerta alerta-erro" role="alert">{erro}</div> : <p className="muted">Carregando…</p>;
  const pessoas = nota.direcao === 'entrada' ? cadastros.fornecedores : cadastros.clientes;
  const confere = (c: string) => !!nota.leitura?.conferir.includes(c);
  const somaDups = dups ? soma(dups.map((d) => lerNumero(d.valor) ?? 0)) : 0;

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <Link to="/fin/notas" className="small">← Notas fiscais</Link>
          <h1>
            {NOMES_MODELO[nota.modelo]} {nota.numero ?? 's/n'}
            {nota.serie ? <span className="muted" style={{ fontWeight: 500 }}> · série {nota.serie}</span> : null}
          </h1>
          <span className="muted">
            {nota.direcao === 'entrada' ? 'Compra' : 'Venda'} · emitida em {formatarData(nota.dataEmissao)} · {ORIGEM_TEXTO[nota.origem] ?? 'digitada'}
            {nota.naturezaOperacao ? ` · ${nota.naturezaOperacao}` : ''}
          </span>
        </div>
        <span className={`selo ${SELO_NOTA[nota.status].classe}`}>{SELO_NOTA[nota.status].texto}</span>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}
      {nota.leitura && (
        <div className={`alerta ${editavel && nota.leitura.conferir.length ? 'alerta-aviso' : 'alerta-info'}`}>
          {nota.origem === 'chave' ? 'Rascunho criado pela chave do código de barras.' : `Dados lidos ${METODO_TEXTO[nota.leitura.metodo] ?? ''}${nota.leitura.chaveVia === 'codigo_barras' && nota.leitura.metodo !== 'codigo_barras' ? ', com a chave do código de barras' : ''}.`}
          {editavel && nota.leitura.conferir.length > 0 && <> Confira {listaE(nota.leitura.conferir.map((c) => CONFERIR_TEXTO[c] ?? c))} antes de confirmar.</>}
          {editavel && !nota.leitura.conferir.length && ' Confira com o documento antes de confirmar.'}
          {nota.anexo && (
            <>
              {' '}
              <a href={`/api/fin/notas/${nota.id}/arquivo`} target="_blank" rel="noreferrer">Abrir o {nota.anexo.tipo === 'application/pdf' ? 'PDF' : 'arquivo'}</a>
            </>
          )}
          {editavel && nota.anexo && <LerComIa nota={nota} />}
        </div>
      )}
      {nota.avisos.map((a) => (
        <div key={a} className="alerta alerta-aviso">{a}</div>
      ))}
      {editavel && nota.origem === 'chave' && <CompletarComArquivo nota={nota} />}

      <div className="card">
        <div className="campos">
          <div className={`campo ${editavel && confere('fornecedor') ? 'conferir' : ''}`}>
            <label htmlFor="nt-pessoa">{nota.direcao === 'entrada' ? 'Fornecedor' : 'Cliente'}</label>
            {editavel ? (
              <select
                id="nt-pessoa"
                value={(nota.direcao === 'entrada' ? nota.fornecedorId : nota.clienteId) ?? ''}
                onChange={(e) => alterar(nota.direcao === 'entrada' ? { fornecedorId: e.target.value || null } : { clienteId: e.target.value || null }, 'Dados da nota salvos.')}
              >
                <option value="">Escolha</option>
                {pessoas.filter((p) => p.ativo || p.id === nota.fornecedorId || p.id === nota.clienteId).map((p) => (
                  <option key={p.id} value={p.id}>{p.nomeFantasia || p.razaoSocial}</option>
                ))}
              </select>
            ) : (
              <strong>{nota.fornecedorNome ?? nota.clienteNome ?? '—'}</strong>
            )}
            {nota.emitenteDocumento && (
              <span className="small muted">
                Emitente: {nota.emitenteNome ? `${nota.emitenteNome} · ` : ''}{formatarDocumento(nota.emitenteDocumento)}
                {nota.fornecedorNovo && editavel ? ` · cadastrado agora a partir do ${nota.origem === 'xml' ? 'XML' : 'documento'}` : ''}
              </span>
            )}
            {nota.pedido && (
              <div className="small" style={{ width: '100%' }}>
                <div>
                  Recebimento do <Link to={`/sup/pedidos/${nota.pedido.id}`}>pedido de compra nº {String(nota.pedido.numero).padStart(4, '0')}</Link>
                  {` · emitido em ${formatarData(nota.pedido.data)}`}
                  {nota.pedido.condicaoPagamento ? ` · ${nota.pedido.condicaoPagamento}` : ''}
                  {` · ${nota.pedido.freteTipo === 'transportadora' ? 'frete por transportadora' : nota.pedido.freteTipo === 'proprio' ? 'frete próprio' : 'frete CIF'}${nota.pedido.frete ? ` (${formatarMoeda(nota.pedido.frete)})` : ''}`}
                  {` · total do pedido ${formatarMoeda(nota.pedido.total)}`}
                </div>
                {nota.pedido.itens.length > 0 && (
                  <table style={{ marginTop: 6 }}>
                    <thead>
                      <tr><th>Item do pedido</th><th>Qtd.</th><th>Preço unit.</th><th>Total</th><th>Nesta nota</th></tr>
                    </thead>
                    <tbody>
                      {nota.pedido.itens.map((i) => (
                        <tr key={i.id}>
                          <td>{i.descricao}</td>
                          <td>{formatarNumero(i.quantidade, 3)} {i.unidade}</td>
                          <td>{formatarMoeda(i.preco)}</td>
                          <td>{formatarMoeda(i.total)}</td>
                          <td>{i.nestaNota ? 'sim' : 'não'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
          <div className="campo">
            <label htmlFor="nt-comp">Competência</label>
            {editavel ? (
              <input id="nt-comp" type="date" value={nota.competencia} onChange={(e) => e.target.value && alterar({ competencia: e.target.value }, 'Competência salva.')} />
            ) : (
              <strong className="mono">{formatarData(nota.competencia)}</strong>
            )}
            <span className="ajuda">Data que vale na DRE por competência. Normalmente, a emissão.</span>
          </div>
          <div className={`campo ${editavel && confere('total') ? 'conferir' : ''}`}>
            <span className="rotulo">Total da nota</span>
            <strong className="mono" style={{ fontSize: 24 }}>{formatarMoeda(nota.totais.total)}</strong>
            <span className="small muted">
              Produtos {formatarMoeda(nota.totais.produtos)}
              {nota.totais.frete ? ` · frete ${formatarMoeda(nota.totais.frete)}` : ''}
              {nota.totais.outras ? ` · outras ${formatarMoeda(nota.totais.outras)}` : ''}
              {nota.totais.ipi ? ` · IPI ${formatarMoeda(nota.totais.ipi)}` : ''}
              {nota.totais.icmsSt ? ` · ICMS ST ${formatarMoeda(nota.totais.icmsSt)}` : ''}
              {nota.totais.desconto ? ` · desconto ${formatarMoeda(nota.totais.desconto)}` : ''}
            </span>
          </div>
        </div>
        {editavel && DIGITAVEL.has(nota.origem) && nota.origem !== 'manual' && <DadosDocumento nota={nota} conferirData={confere('dataEmissao')} alterar={alterar} />}
        {nota.chaveAcesso && (
          <p className="small muted" style={{ margin: '12px 0 0' }}>
            Chave de acesso: <span className="mono">{formatarChave(nota.chaveAcesso)}</span>
            {nota.temXml && (
              <>
                {' · '}
                <a href={`/api/fin/notas/${nota.id}/xml`}>baixar XML</a>
              </>
            )}
          </p>
        )}
        {nota.informacoes && <p className="small muted" style={{ margin: '6px 0 0' }}>Informações da nota: {nota.informacoes}</p>}
      </div>

      <div className="card tabela-caixa">
        <div className="cabecalho" style={{ marginBottom: 8 }}>
          <h2>Itens e apropriação{editavel && confere('itens') && <span className="selo selo-aviso" style={{ marginLeft: 8 }}>Conferir itens</span>}</h2>
          <span className="small muted">{nota.itens.length} {nota.itens.length === 1 ? 'item' : 'itens'}</span>
        </div>
        {editavel && nota.itens.length > 1 && (
          <div className="barra-lote">
            <span className="small">{semCategoria ? `Aplicar aos ${semCategoria} itens sem categoria:` : 'Aplicar a todos os itens:'}</span>
            <select aria-label="Categoria para vários itens" value={lote.planoContaId} onChange={(e) => setLote({ ...lote, planoContaId: e.target.value })}>
              <OpcoesCategoria plano={cadastros.plano} tipo={nota.tipo} atual={lote.planoContaId} />
            </select>
            <select aria-label="Centro de custo para vários itens" value={lote.centroCustoId} onChange={(e) => setLote({ ...lote, centroCustoId: e.target.value })}>
              <option value="">Centro de custo —</option>
              {cadastros.centros.filter((c) => c.ativo).map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
            <button
              className="btn btn-secundario"
              type="button"
              disabled={!lote.planoContaId || ocupado}
              onClick={() =>
                executar(
                  () => api(`/fin/notas/${id}/apropriar`, { corpo: { ...lote, centroCustoId: lote.centroCustoId || null, somenteSemCategoria: semCategoria > 0 } }),
                  'Categoria aplicada.',
                )
              }
            >
              Aplicar
            </button>
          </div>
        )}
        {!nota.pedido && editavel && nota.direcao === 'entrada' && <PedidosParaNota nota={nota} aoLigado={carregar} />}
        <table className="tabela tabela-nota">
          <thead>
            <tr>
              <th>#</th>
              <th>Item</th>
              <th>Categoria</th>
              <th>Centro de custo</th>
              <th style={{ textAlign: 'right' }}>Valor total</th>
              <th><span style={{ position: 'absolute', left: -9999 }}>Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {nota.itens.map((i) => (
              <LinhaItem key={`${i.id}-${i.valorProduto}-${i.quantidade}`} item={i} nota={nota} cadastros={cadastros} editavel={!!editavel} insumos={insumos} aoMudar={setNota} aoErro={setErro} />
            ))}
          </tbody>
          <tfoot>
            {/* Conferência com a nota: itens (valor dos produtos) + acréscimos − desconto = total. */}
            <tr>
              <td colSpan={4} className="small muted">Soma dos itens (valor dos produtos)</td>
              <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{formatarMoeda(soma(nota.itens.map((i) => i.valorProduto)))}</td>
              <td />
            </tr>
            {(
              [
                ['+ frete', nota.totais.frete],
                ['+ seguro', nota.totais.seguro],
                ['+ outras despesas', nota.totais.outras],
                ['+ IPI', nota.totais.ipi],
                ['+ ICMS ST', nota.totais.icmsSt],
                ['− desconto', -nota.totais.desconto],
              ] as [string, number][]
            )
              .filter(([, v]) => v)
              .map(([r, v]) => (
                <tr key={r}>
                  <td colSpan={4} className="small muted">{r}</td>
                  <td className="mono small" style={{ textAlign: 'right' }}>{formatarMoeda(Math.abs(v))}</td>
                  <td />
                </tr>
              ))}
            <tr>
              <td colSpan={4} className="small muted">
                = Total da nota
                {nota.leitura?.totalLido != null && Math.round(nota.leitura.totalLido) !== Math.round(nota.totais.total * 100) && (
                  <span style={{ color: 'var(--status-warn-ink)' }}> · na nota impressa: {formatarMoeda(nota.leitura.totalLido / 100)}</span>
                )}
              </td>
              <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{formatarMoeda(nota.totais.total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
        {editavel && DIGITAVEL.has(nota.origem) && <NovoItemManual nota={nota} cadastros={cadastros} aoMudar={setNota} aoErro={setErro} />}
      </div>

      <div className="card">
        <div className="cabecalho" style={{ marginBottom: 8 }}>
          <h2>{nota.tipo === 'despesa' ? 'Vencimentos (a pagar)' : 'Vencimentos (a receber)'}</h2>
          {editavel && !dups && (
            <button
              className="btn btn-link"
              type="button"
              onClick={() =>
                setDups(
                  nota.duplicatas.length
                    ? nota.duplicatas.map((d) => ({ chave: ++seq, numero: d.numero, vencimento: d.vencimento, valor: moedaCampo(d.valor) }))
                    : [{ chave: ++seq, numero: null, vencimento: nota.dataEmissao, valor: moedaCampo(nota.totais.total) }],
                )
              }
            >
              {nota.duplicatas.length ? 'Alterar vencimentos' : 'Parcelar'}
            </button>
          )}
        </div>
        {dups ? (
          <div className="form">
            {dups.map((d, k) => (
              <div key={d.chave} className="acoes">
                <span className="mono small" style={{ width: 28 }}>{k + 1}</span>
                <input type="date" aria-label={`Vencimento ${k + 1}`} value={d.vencimento} onChange={(e) => setDups(dups.map((x) => (x.chave === d.chave ? { ...x, vencimento: e.target.value } : x)))} />
                <input
                  className="mono"
                  aria-label={`Valor ${k + 1}`}
                  inputMode="decimal"
                  style={{ width: 140 }}
                  value={d.valor}
                  onChange={(e) => setDups(dups.map((x) => (x.chave === d.chave ? { ...x, valor: e.target.value } : x)))}
                />
                {dups.length > 1 && (
                  <button className="btn btn-link" type="button" onClick={() => setDups(dups.filter((x) => x.chave !== d.chave))}>
                    Remover
                  </button>
                )}
              </div>
            ))}
            <p className="small" style={{ margin: 0, color: Math.abs(somaDups - nota.totais.total) > 0.004 ? 'var(--status-danger-ink)' : undefined }}>
              Soma {formatarMoeda(somaDups)} de {formatarMoeda(nota.totais.total)}
            </p>
            <div className="acoes">
              <button
                className="btn btn-secundario"
                type="button"
                onClick={() => {
                  const ult = dups[dups.length - 1];
                  const resto = Math.round((nota.totais.total - somaDups) * 100) / 100;
                  const [a, m, dd] = ult.vencimento.split('-').map(Number);
                  const prox = new Date(Date.UTC(a, m, Math.min(dd, 28))).toISOString().slice(0, 10);
                  setDups([...dups, { chave: ++seq, numero: null, vencimento: prox, valor: moedaCampo(resto > 0 ? resto : 0) }]);
                }}
              >
                + Parcela
              </button>
              <button className="btn btn-primario" type="button" disabled={ocupado} onClick={salvarDups}>
                Salvar vencimentos
              </button>
              <button className="btn btn-link" type="button" onClick={() => setDups(null)}>
                Cancelar
              </button>
              {nota.duplicatas.length > 0 && (
                <button className="btn btn-link" type="button" onClick={() => executar(() => api(`/fin/notas/${id}`, { metodo: 'PATCH', corpo: { duplicatas: [] } }), 'Parcelas removidas: vencimento único.').then(() => setDups(null))}>
                  Usar vencimento único
                </button>
              )}
            </div>
          </div>
        ) : nota.duplicatas.length ? (
          <ul className="lista-alertas compacta">
            {nota.duplicatas.map((d, k) => (
              <li key={d.id}>
                <span className="mono small">
                  {k + 1}/{nota.duplicatas.length} · {formatarData(d.vencimento)}
                  {d.numero ? <span className="muted"> · dup. {d.numero}</span> : null}
                </span>
                <span className="mono">{formatarMoeda(d.valor)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            {editavel ? 'Sem parcelas na nota: você informa o vencimento ao confirmar.' : 'Vencimento único.'}
          </p>
        )}
      </div>

      {editavel && (
        <form className="card form" onSubmit={confirmar}>
          <h2>Conferir e lançar</h2>
          {nota.pendencias.length ? (
            <div className="alerta alerta-aviso">
              Falta resolver: {nota.pendencias.join(' ')}
            </div>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>
              Ao confirmar, a nota vira {nota.tipo === 'despesa' ? 'despesa' : 'receita'} de {formatarMoeda(nota.totais.total)} na competência {formatarData(nota.competencia)}, com
              {nota.duplicatas.length ? ` ${nota.duplicatas.length} parcela(s)` : ' uma parcela'} em {nota.tipo === 'despesa' ? 'Contas a pagar' : 'Contas a receber'}.
            </p>
          )}
          <div className="campos">
            {!nota.duplicatas.length && (
              <div className="campo">
                <label htmlFor="cf-venc">Vencimento</label>
                <input id="cf-venc" type="date" value={conf.vencimento} onChange={(e) => setConf({ ...conf, vencimento: e.target.value })} />
              </div>
            )}
          </div>
          <label className="marcar">
            <input type="checkbox" checked={conf.paga} onChange={(e) => setConf({ ...conf, paga: e.target.checked })} />
            <span>{nota.tipo === 'despesa' ? 'Já foi paga (à vista)' : 'Já foi recebida (à vista)'}</span>
          </label>
          {conf.paga && (
            <div className="campos">
              <div className="campo">
                <label htmlFor="cf-data">Data do {nota.tipo === 'despesa' ? 'pagamento' : 'recebimento'}</label>
                <input id="cf-data" type="date" max={hojeLocal()} value={conf.data} onChange={(e) => setConf({ ...conf, data: e.target.value })} />
              </div>
              <div className="campo">
                <label htmlFor="cf-conta">Conta</label>
                <select id="cf-conta" value={conf.contaId} onChange={(e) => setConf({ ...conf, contaId: e.target.value })}>
                  {cadastros.contas.filter((c) => c.ativo).map((c) => (
                    <option key={c.id} value={c.id}>{c.nome}</option>
                  ))}
                </select>
              </div>
              <div className="campo">
                <label htmlFor="cf-forma">Forma</label>
                <select id="cf-forma" value={conf.forma} onChange={(e) => setConf({ ...conf, forma: e.target.value as FormaPagamento })}>
                  <option value="">—</option>
                  {(Object.keys(NOMES_FORMA) as FormaPagamento[]).map((x) => (
                    <option key={x} value={x}>{NOMES_FORMA[x]}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {nota.direcao === 'entrada' && (
            <label className="marcar">
              <input type="checkbox" checked={conf.aprender} onChange={(e) => setConf({ ...conf, aprender: e.target.checked })} />
              <span>Lembrar estas categorias para as próximas notas deste fornecedor</span>
            </label>
          )}
          <div className="acoes">
            <button className="btn btn-primario" type="submit" disabled={ocupado || nota.pendencias.length > 0}>
              Confirmar e lançar
            </button>
            {!acao && (
              <button className="btn btn-link" type="button" onClick={() => setAcao('excluir')}>
                Excluir esta nota
              </button>
            )}
          </div>
        </form>
      )}

      {nota.status === 'confirmada' && (
        <div className="card">
          <h2>Lançamento</h2>
          {nota.lancamento && (
            <p style={{ marginTop: 0 }}>
              <Link to={`/fin/lancamentos/${nota.lancamento.id}`} style={{ fontWeight: 600 }}>
                Ver o lançamento e as parcelas ›
              </Link>
              <span className="small muted">
                {' '}· {nota.lancamento.parcelas} parcela(s), {nota.lancamento.pagas} {nota.tipo === 'despesa' ? 'paga(s)' : 'recebida(s)'}
              </span>
            </p>
          )}
          {!acao && (
            <div className="acoes">
              <button className="btn btn-secundario" type="button" onClick={() => setAcao('reabrir')}>
                Reabrir para corrigir
              </button>
              <button className="btn btn-link" type="button" onClick={() => setAcao('cancelar')}>
                A nota foi cancelada pelo emitente
              </button>
            </div>
          )}
        </div>
      )}

      {acao && (
        <div className="card">
          <h2>{acao === 'reabrir' ? 'Reabrir a nota?' : acao === 'cancelar' ? 'Cancelar a nota?' : 'Excluir esta nota?'}</h2>
          <p className="muted">
            {acao === 'reabrir' && 'O lançamento e as parcelas em aberto são cancelados, e a nota volta para conferência. Se alguma parcela já foi paga, estorne antes.'}
            {acao === 'cancelar' && 'Use quando o fornecedor cancelou a nota. Ela fica no histórico sem valor, o lançamento é cancelado e os abastecimentos e OS ligados ficam livres.'}
            {acao === 'excluir' && 'A nota sai da lista e os vínculos com abastecimentos e OS são desfeitos. Se foi importada, você pode importar o XML de novo.'}
          </p>
          <div className="acoes">
            <button className="btn btn-perigo" type="button" disabled={ocupado} onClick={executarAcao}>
              {acao === 'reabrir' ? 'Reabrir' : acao === 'cancelar' ? 'Cancelar a nota' : 'Excluir'}
            </button>
            <button className="btn btn-secundario" type="button" onClick={() => setAcao(null)}>
              Voltar
            </button>
          </div>
        </div>
      )}

      {editavel && (
        <div className="card">
          <label htmlFor="nt-obs" className="rotulo small">Observações internas</label>
          <input
            id="nt-obs"
            className="campo-tabela"
            style={{ width: '100%' }}
            defaultValue={nota.observacoes ?? ''}
            onBlur={(e) => e.target.value !== (nota.observacoes ?? '') && alterar({ observacoes: e.target.value }, 'Observação salva.')}
          />
        </div>
      )}
    </>
  );
}

function NovoItemManual({ nota, cadastros, aoMudar, aoErro }: { nota: NotaFiscal; cadastros: Cadastros; aoMudar: (n: NotaFiscal) => void; aoErro: (m: string) => void }) {
  const [i, setI] = useState({ descricao: '', quantidade: '1', valor: '', planoContaId: '' });
  const [ocupado, setOcupado] = useState(false);
  async function incluir(e: FormEvent) {
    e.preventDefault();
    aoErro('');
    setOcupado(true);
    try {
      aoMudar((await api<{ nota: NotaFiscal }>(`/fin/notas/${nota.id}/itens`, { corpo: { ...i, planoContaId: i.planoContaId || null } })).nota);
      setI({ descricao: '', quantidade: '1', valor: '', planoContaId: '' });
    } catch (err) {
      aoErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }
  return (
    <form className="campos linha-item-nota" onSubmit={incluir} style={{ marginTop: 12 }}>
      <div className="campo">
        <label htmlFor="ni-desc">Novo item</label>
        <input id="ni-desc" value={i.descricao} onChange={(e) => setI({ ...i, descricao: e.target.value })} />
      </div>
      <div className="campo">
        <label htmlFor="ni-qtd">Quantidade</label>
        <input id="ni-qtd" className="mono" inputMode="decimal" value={i.quantidade} onChange={(e) => setI({ ...i, quantidade: e.target.value })} />
      </div>
      <div className="campo">
        <label htmlFor="ni-valor">Valor (R$)</label>
        <input id="ni-valor" className="mono" inputMode="decimal" value={i.valor} onChange={(e) => setI({ ...i, valor: e.target.value })} />
      </div>
      <div className="campo">
        <label htmlFor="ni-cat">Categoria</label>
        <select id="ni-cat" value={i.planoContaId} onChange={(e) => setI({ ...i, planoContaId: e.target.value })}>
          <OpcoesCategoria plano={cadastros.plano} tipo={nota.tipo} atual={i.planoContaId} />
        </select>
      </div>
      <div className="campo" style={{ justifyContent: 'flex-end' }}>
        <button className="btn btn-secundario" type="submit" disabled={ocupado || !i.descricao.trim() || !i.valor}>
          Incluir item
        </button>
      </div>
    </form>
  );
}

type CandidatoPedido = {
  id: string;
  numero: number;
  data: string;
  status: string;
  condicaoPagamento: string | null;
  freteTipo: string | null;
  frete: number;
  total: number;
  itens: { id: string; descricao: string; unidade: string; quantidade: number; recebido: number; preco: number }[];
  sugestoes: { notaItemId: string; pedidoItemId: string; quantidade: number }[];
};

/** Cartão com o pedido de compra do mesmo fornecedor e o cruzamento sugerido dos itens. Ligar faz o recebimento. */
function PedidosParaNota({ nota, aoLigado }: { nota: NotaFiscal; aoLigado: () => void }) {
  const [pedidos, setPedidos] = useState<CandidatoPedido[] | null>(null);
  const [escolhido, setEscolhido] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');

  useEffect(() => {
    api<{ pedidos: CandidatoPedido[] }>(`/fin/notas/${nota.id}/pedidos-candidatos`)
      .then((r) => {
        setPedidos(r.pedidos);
        setEscolhido((r.pedidos.find((x) => x.sugestoes.length) ?? r.pedidos[0])?.id ?? '');
      })
      .catch(() => setPedidos([]));
  }, [nota.id]);

  if (!pedidos?.length) return null;
  const p = pedidos.find((x) => x.id === escolhido) ?? pedidos[0];
  const nomeItemPedido = (pedidoItemId: string) => p.itens.find((i) => i.id === pedidoItemId)?.descricao ?? '';

  async function ligar() {
    setOcupado(true);
    setErro('');
    try {
      const itens = nota.itens.map((i) => {
        const s = p.sugestoes.find((x) => x.notaItemId === i.id);
        return { notaItemId: i.id, pedidoItemId: s?.pedidoItemId ?? null, quantidade: s?.quantidade ?? null };
      });
      await api(`/sup/pedidos/${p.id}/recebimento`, { metodo: 'PUT', corpo: { notaId: nota.id, itens } });
      aoLigado();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong>Pedido de compra deste fornecedor</strong>
        {pedidos.length > 1 && (
          <select aria-label="Pedido de compra" value={p.id} onChange={(e) => setEscolhido(e.target.value)}>
            {pedidos.map((x) => (
              <option key={x.id} value={x.id}>
                Pedido nº {String(x.numero).padStart(4, '0')} · {formatarData(x.data)} · {formatarMoeda(x.total)}
              </option>
            ))}
          </select>
        )}
      </div>
      <p className="small muted" style={{ margin: '6px 0' }}>
        Pedido nº {String(p.numero).padStart(4, '0')} · {formatarData(p.data)} · {formatarMoeda(p.total)}
        {p.condicaoPagamento ? ` · ${p.condicaoPagamento}` : ''}
        {` · ${p.freteTipo === 'transportadora' ? 'frete por transportadora' : p.freteTipo === 'proprio' ? 'frete próprio' : 'frete CIF'}`}
        {` · ${p.sugestoes.length} de ${nota.itens.length} itens da nota casam com o pedido`}
      </p>
      <table>
        <thead>
          <tr><th>Item da nota</th><th>Item do pedido (sugerido)</th><th>Qtd. recebida</th></tr>
        </thead>
        <tbody>
          {nota.itens.map((i) => {
            const s = p.sugestoes.find((x) => x.notaItemId === i.id);
            return (
              <tr key={i.id}>
                <td>{i.descricao}</td>
                <td className="small">{s ? nomeItemPedido(s.pedidoItemId) : <span className="muted">sem correspondência</span>}</td>
                <td className="mono small">{s ? `${formatarNumero(s.quantidade, 3)} ${i.unidade ?? ''}` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {erro && <div className="alerta alerta-erro" role="alert" style={{ marginTop: 8 }}>{erro}</div>}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <span className="small muted">Ao ligar, cada item herda a obra, o insumo da obra e a etapa do pedido.</span>
        <button className="btn btn-primario" type="button" disabled={!p.sugestoes.length || ocupado} onClick={ligar}>
          {ocupado ? 'Ligando…' : `Ligar esta nota ao pedido nº ${String(p.numero).padStart(4, '0')}`}
        </button>
      </div>
    </div>
  );
}

export function Nota() {
  const { id } = useParams();
  const { cadastros, erro } = useCadastros();
  const nova = !id || id === 'nova';
  return (
    <>
      {nova && (
        <div className="cabecalho">
          <div className="titulo">
            <Link to="/fin/notas" className="small">← Notas fiscais</Link>
            <h1>Lançar nota à mão</h1>
            <span className="muted">Para notas sem XML: NFS-e, cupom, recibo ou NF-e em papel. Se tiver o XML, prefira importar.</span>
          </div>
        </div>
      )}
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {!cadastros ? (
        !erro && <p className="muted">Carregando…</p>
      ) : nova ? (
        <NovaNota cadastros={cadastros} />
      ) : (
        <DetalheNota key={id} id={id!} cadastros={cadastros} />
      )}
    </>
  );
}

function listaE(xs: string[]): string {
  return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`;
}

/** Dados do documento lido do PDF ou da chave: número, série, emissão e acréscimos, corrigíveis na conferência. */
function DadosDocumento({ nota, conferirData, alterar }: { nota: NotaFiscal; conferirData: boolean; alterar: (c: Record<string, unknown>, msg?: string) => Promise<void> }) {
  const inicial = () => ({
    numero: nota.numero ?? '',
    serie: nota.serie ?? '',
    dataEmissao: nota.dataEmissao,
    frete: moedaCampo(nota.totais.frete),
    desconto: moedaCampo(nota.totais.desconto),
    outras: moedaCampo(nota.totais.outras),
  });
  const [f, setF] = useState(inicial);
  useEffect(() => setF(inicial()), [nota.numero, nota.serie, nota.dataEmissao, nota.totais.frete, nota.totais.desconto, nota.totais.outras]); // eslint-disable-line react-hooks/exhaustive-deps
  const salvar = (campo: keyof typeof f, valor: unknown) => alterar({ [campo]: valor }, 'Dados do documento salvos.');
  const dinheiro = (campo: 'frete' | 'desconto' | 'outras') => (
    <div className="campo">
      <label htmlFor={`dd-${campo}`}>{campo === 'frete' ? 'Frete' : campo === 'desconto' ? 'Desconto / retenções' : 'Outras despesas'}</label>
      <input
        id={`dd-${campo}`}
        className="mono"
        inputMode="decimal"
        value={f[campo]}
        onChange={(e) => setF({ ...f, [campo]: e.target.value })}
        onBlur={() => (lerNumero(f[campo]) ?? 0) !== nota.totais[campo] && salvar(campo, f[campo] || '0')}
      />
    </div>
  );
  return (
    <div className="dados-documento">
      <span className="small muted">Dados do documento (corrija se a leitura errou)</span>
      <div className="campos">
        <div className="campo">
          <label htmlFor="dd-numero">Número</label>
          <input id="dd-numero" className="mono" value={f.numero} onChange={(e) => setF({ ...f, numero: e.target.value })} onBlur={() => f.numero !== (nota.numero ?? '') && salvar('numero', f.numero)} />
        </div>
        <div className="campo">
          <label htmlFor="dd-serie">Série</label>
          <input id="dd-serie" className="mono" value={f.serie} onChange={(e) => setF({ ...f, serie: e.target.value })} onBlur={() => f.serie !== (nota.serie ?? '') && salvar('serie', f.serie)} />
        </div>
        <div className={`campo ${conferirData ? 'conferir' : ''}`}>
          <label htmlFor="dd-emissao">Data de emissão</label>
          <input id="dd-emissao" type="date" value={f.dataEmissao} onChange={(e) => setF({ ...f, dataEmissao: e.target.value })} onBlur={() => f.dataEmissao && f.dataEmissao !== nota.dataEmissao && salvar('dataEmissao', f.dataEmissao)} />
        </div>
        {dinheiro('frete')}
        {dinheiro('desconto')}
        {dinheiro('outras')}
      </div>
    </div>
  );
}

function arquivoBase64(arquivo: Blob): Promise<string> {
  return new Promise((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1] ?? '');
    r.onerror = () => falha(new Error('Não consegui abrir o arquivo.'));
    r.readAsDataURL(arquivo);
  });
}

/** Rascunho criado só pela chave: o PDF (ou foto) da nota completa valor, itens e parcelas. */
function CompletarComArquivo({ nota }: { nota: NotaFiscal }) {
  const navegar = useNavigate();
  const entrada = useRef<HTMLInputElement>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  async function enviar(f: File | undefined) {
    if (!f) return;
    setErro('');
    setOcupado(true);
    try {
      const pdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
      if (!pdf && !/^image\/(jpeg|png|webp)$/.test(f.type)) throw new Error('Envie o PDF da nota ou uma foto (JPG ou PNG).');
      if (f.size > 10 * 1024 * 1024) throw new Error('Arquivo grande demais (máximo 10 MB).');
      const envio = pdf ? f : ((await imagemParaJpeg(f)) ?? f);
      const r = await api<{ nota: NotaFiscal }>('/fin/notas/pdf', {
        corpo: { arquivo: await arquivoBase64(envio), nome: f.name, tipo: pdf ? 'application/pdf' : envio.type || f.type, chave: nota.chaveAcesso },
      });
      navegar(`/fin/notas/${r.nota.id}`, { replace: true });
    } catch (e) {
      setErro((e as Error).message);
    }
    setOcupado(false);
    if (entrada.current) entrada.current.value = '';
  }
  return (
    <div className="card completar-arquivo">
      <h2 style={{ margin: 0 }}>Completar com o PDF da nota</h2>
      <p className="small" style={{ margin: '4px 0 10px' }}>
        A chave não traz valor nem itens. Envie o PDF da nota (ou uma foto) e o Agrega preenche o resto neste rascunho.
      </p>
      <input ref={entrada} type="file" accept=".pdf,application/pdf,image/jpeg,image/png,image/webp" hidden onChange={(e) => enviar(e.target.files?.[0])} />
      <div className="acoes">
        <button className="btn btn-primario" type="button" disabled={ocupado} onClick={() => entrada.current?.click()}>
          {ocupado ? 'A IA está lendo a nota…' : 'Enviar PDF ou foto'}
        </button>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert" style={{ marginTop: 10 }}>{erro}</div>}
    </div>
  );
}

/** Lê de novo, pela IA, o PDF ou a foto anexada (quando o leitor do Agrega não entendeu o modelo da nota). */
function LerComIa({ nota }: { nota: NotaFiscal }) {
  const navegar = useNavigate();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  async function ler() {
    setErro('');
    setOcupado(true);
    try {
      const r = await api<{ nota: NotaFiscal }>(`/fin/notas/${nota.id}/reler`, { metodo: 'POST' });
      navegar(`/fin/notas/${r.nota.id}`, { replace: true });
    } catch (e) {
      setErro((e as Error).message);
      setOcupado(false);
    }
  }
  return (
    <div style={{ marginTop: 8 }}>
      <button className="btn btn-secundario" type="button" disabled={ocupado} onClick={ler}>
        {ocupado ? 'A IA está lendo a nota…' : 'Ler de novo com a IA'}
      </button>
      {erro && <div className="small" role="alert" style={{ marginTop: 6, color: 'var(--status-danger-ink)' }}>{erro}</div>}
    </div>
  );
}
