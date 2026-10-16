// Engenharia · Seções do menu: insumos e serviços, EAP e orçamento. O planejamento está em EngPlanejamento.tsx.
// Cada seção escolhe a obra (seletor, ou ?obra= na URL) e carrega os dados dela.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, formatarMoeda, lerNumero } from '../api';
import { AbaInsumos, ROTULO_NIVEL, type ItemObra, type No, type Obra, type Orcamento } from './EngObras';
import { NovoItemProprio } from './EngTabelas';
import { PlanilhaOrcamentaria } from './EngPlanilha';

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
    <SecaoObra titulo="Insumos" ajuda="Insumos da obra, copiados das tabelas de referência ou lançados manualmente. Editar o preço aqui não altera a tabela.">
      {(c) => <ItensDaObra tipo="insumo" obraId={c.obra.id} itens={c.itens} aoMudar={c.recarregar} setErro={c.setErro} />}
    </SecaoObra>
  );
}

export function EngServicos() {
  return (
    <SecaoObra titulo="Serviços" ajuda="Composições unitárias da obra (SINAPI ou próprias). Serviço próprio tem seus insumos e coeficientes.">
      {(c) => <ItensDaObra tipo="composicao" obraId={c.obra.id} itens={c.itens} aoMudar={c.recarregar} setErro={c.setErro} />}
    </SecaoObra>
  );
}

/** Lista só os itens do tipo da página (insumos ou serviços), com a entrada manual de item próprio. */
function ItensDaObra({ tipo, obraId, itens, aoMudar, setErro }: { tipo: 'insumo' | 'composicao'; obraId: string; itens: ItemObra[]; aoMudar: () => void; setErro: (m: string) => void }) {
  const [novo, setNovo] = useState(false);
  const [msg, setMsg] = useState('');
  const rotulo = tipo === 'insumo' ? 'Novo insumo' : 'Novo serviço';
  return (
    <>
      <div className="acoes" style={{ marginBottom: 12 }}>
        <button className="btn btn-primario" type="button" onClick={() => { setMsg(''); setNovo(!novo); }} aria-expanded={novo}>{novo ? 'Fechar' : rotulo}</button>
      </div>
      {msg && <div className="alerta alerta-ok" role="status" style={{ marginBottom: 12 }}>{msg}</div>}
      {novo && (
        <div style={{ marginBottom: 12 }}>
          <NovoItemProprio
            tipo={tipo}
            obraId={obraId}
            aoSalvar={(m) => {
              setNovo(false);
              setMsg(m);
              aoMudar();
            }}
          />
        </div>
      )}
      <AbaInsumos obraId={obraId} itens={itens.filter((i) => i.tipo === tipo)} tipo={tipo} aoMudar={aoMudar} setErro={setErro} />
    </>
  );
}

export function EngEap() {
  return (
    <SecaoObra titulo="EAP e orçamento" ajuda="A EAP e o orçamento são montados juntos, linha a linha: 1 Obra, 2 Etapa, 3 Sub Etapa e 4 Tarefa. O serviço é lançado na Tarefa; as linhas acima somam o que está abaixo delas.">
      {(c) => <AbasCustos obra={c.obra} itens={c.itens} setErro={c.setErro} />}
    </SecaoObra>
  );
}

/** Botão "Orçamento": a planilha só aparece depois de clicar. */
function EapComBotao({ obra, itens, setErro }: { obra: Obra; itens: ItemObra[]; setErro: (m: string) => void }) {
  const [aberta, setAberta] = useState(false);
  return (
    <>
      <div className="acoes" style={{ marginBottom: 12 }}>
        <button className="btn btn-primario" type="button" onClick={() => setAberta(!aberta)} aria-expanded={aberta}>
          {aberta ? 'Ocultar orçamento' : 'Orçamento'}
        </button>
      </div>
      {aberta && <PlanilhaOrcamentaria obra={obra} itens={itens} setErro={setErro} />}
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
                    <td>{n.status === 'cancelada' ? 'Cancelada' : n.status === 'solicitada' ? 'Em solicitação' : n.status === 'comprada' ? 'Comprada' : 'Pendente'}</td>
                    <td className="acoes">
                      {n.status === 'pendente' && <button className="btn" type="button" onClick={() => cancelar(n)}>Cancelar</button>}
                      {(n.status === 'pendente' || n.status === 'cancelada') && <button className="btn" type="button" onClick={() => excluir(n)}>Excluir</button>}
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

type AbaCusto = 'direto' | 'indireto' | 'acessorios' | 'impostos' | 'lucro';
const ABAS_CUSTO: { id: AbaCusto; texto: string }[] = [
  { id: 'direto', texto: 'Custo direto' },
  { id: 'indireto', texto: 'Custo indireto' },
  { id: 'acessorios', texto: 'Custos acessórios' },
  { id: 'impostos', texto: 'Impostos' },
  { id: 'lucro', texto: 'Lucratividade' },
];

/** Abas da planilha: custo direto (EAP e orçamento) e a formação do preço de venda. */
function AbasCustos({ obra, itens, setErro }: { obra: Obra; itens: ItemObra[]; setErro: (m: string) => void }) {
  const [aba, setAba] = useState<AbaCusto>('direto');
  return (
    <>
      <div className="abas" role="tablist" aria-label="Planilhas de custo" style={{ marginBottom: 12 }}>
        {ABAS_CUSTO.map((a) => (
          <button key={a.id} type="button" role="tab" aria-selected={aba === a.id} className={aba === a.id ? 'ativa' : ''} onClick={() => setAba(a.id)}>
            {a.texto}
          </button>
        ))}
      </div>
      {aba === 'direto' ? (
        <EapComBotao obra={obra} itens={itens} setErro={setErro} />
      ) : (
        <ComposicaoPreco obra={obra} aba={aba} setErro={setErro} />
      )}
    </>
  );
}

type Composicao = {
  direto: number;
  percentuais: { administracao: number; imprevistos: number; cdi: number; lucro: number };
  indiretos: { descricao: string; valor: number }[];
  impostos: { descricao: string; percentual: number; automatico: boolean }[];
};
type LinhaCampo = { descricao: string; valor: string };
type LinhaImposto = { descricao: string; percentual: string };
const numTexto = (v: number | null | undefined) => (v === null || v === undefined || v === 0 ? '' : String(v).replace('.', ','));
const pctTexto = (v: number) => `${String(Number(v.toFixed(2))).replace('.', ',')}%`;

/** Prévia da formação do preço, igual à do servidor. Custo financeiro = CDI. */
function previaPreco(direto: number, indiretos: number, pct: { administracao: number; imprevistos: number; cdi: number; lucro: number }, impostos: number[]) {
  const base1 = direto + indiretos;
  const administracao = (base1 * pct.administracao) / 100;
  const imprevistos = (base1 * pct.imprevistos) / 100;
  const financeiro = (base1 * pct.cdi) / 100;
  const base2 = base1 + administracao + imprevistos + financeiro;
  const valorImpostos = (base2 * impostos.reduce((s, p) => s + p, 0)) / 100;
  const lucro = (base2 * pct.lucro) / 100;
  const precoVenda = base2 + valorImpostos + lucro;
  const bdi = direto > 0 ? (precoVenda / direto - 1) * 100 : 0;
  return { base1, administracao, imprevistos, financeiro, base2, impostos: valorImpostos, lucro, precoVenda, bdi };
}

function ComposicaoPreco({ obra, aba, setErro }: { obra: Obra; aba: Exclude<AbaCusto, 'direto'>; setErro: (m: string) => void }) {
  const [dados, setDados] = useState<Composicao | null>(null);
  const [pct, setPct] = useState({ administracao: '', imprevistos: '', cdi: '', lucro: '' });
  const [indiretos, setIndiretos] = useState<LinhaCampo[]>([]);
  const [impostos, setImpostos] = useState<LinhaImposto[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState('');

  function aplicar(c: Composicao) {
    setDados(c);
    setPct({ administracao: numTexto(c.percentuais.administracao), imprevistos: numTexto(c.percentuais.imprevistos), cdi: numTexto(c.percentuais.cdi), lucro: numTexto(c.percentuais.lucro) });
    setIndiretos(c.indiretos.map((x) => ({ descricao: x.descricao, valor: numTexto(x.valor) })));
    setImpostos(c.impostos.filter((x) => !x.automatico).map((x) => ({ descricao: x.descricao, percentual: numTexto(x.percentual) })));
  }

  useEffect(() => {
    setDados(null);
    setMsg('');
    api<Composicao>(`/eng/obras/${obra.id}/composicao`).then(aplicar).catch((e) => setErro((e as Error).message));
  }, [obra.id]);

  if (!dados) return <p className="muted">Carregando…</p>;

  const pctLidos = { administracao: lerNumero(pct.administracao) ?? 0, imprevistos: lerNumero(pct.imprevistos) ?? 0, cdi: lerNumero(pct.cdi) ?? 0, lucro: lerNumero(pct.lucro) ?? 0 };
  const somaIndiretos = indiretos.reduce((s, x) => s + (lerNumero(x.valor) ?? 0), 0);
  const das = dados.impostos.find((x) => x.automatico);
  const impostosLidos = impostos.map((x) => lerNumero(x.percentual) ?? 0);
  const todosImpostos = [das?.percentual ?? 0, ...impostosLidos];
  const previa = previaPreco(dados.direto, somaIndiretos, pctLidos, todosImpostos);

  async function salvar(e?: FormEvent) {
    e?.preventDefault();
    setErro('');
    setMsg('');
    const corpo = {
      administracao: pctLidos.administracao,
      imprevistos: pctLidos.imprevistos,
      cdi: pctLidos.cdi,
      lucro: pctLidos.lucro,
      indiretos: indiretos.filter((x) => x.descricao.trim() || x.valor.trim()).map((x) => ({ descricao: x.descricao.trim(), valor: lerNumero(x.valor) ?? 0 })),
      impostos: impostos.filter((x) => x.descricao.trim() || x.percentual.trim()).map((x) => ({ descricao: x.descricao.trim(), percentual: lerNumero(x.percentual) ?? 0 })),
    };
    setOcupado(true);
    try {
      const r = await api<Composicao>(`/eng/obras/${obra.id}/composicao`, { metodo: 'PUT', corpo });
      aplicar(r);
      setMsg('Composição salva. BDI da obra atualizado.');
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const linhaPct = (texto: string, campo: 'administracao' | 'imprevistos' | 'cdi', sobre: string) => (
    <tr>
      <td>{texto}</td>
      <td className="num"><input aria-label={texto} inputMode="decimal" style={{ width: 90 }} value={pct[campo]} onChange={(e) => setPct({ ...pct, [campo]: e.target.value })} /> %</td>
      <td className="small muted">{sobre}</td>
    </tr>
  );

  return (
    <form className="card" onSubmit={salvar}>
      <div className="cartao-topo">
        <h2 style={{ margin: 0 }}>{ABAS_CUSTO.find((a) => a.id === aba)!.texto}</h2>
        {msg && <span className="small muted">{msg}</span>}
      </div>
      <p className="muted small" style={{ marginTop: 4 }}>Custo direto da obra: <strong>{formatarMoeda(dados.direto)}</strong>. Salve a composição ao final de cada aba.</p>

      {aba === 'indireto' && (
        <>
          <div className="tabela-caixa">
            <table className="tabela">
              <thead><tr><th>Custo indireto</th><th className="num">Valor (R$)</th><th /></tr></thead>
              <tbody>
                {indiretos.length === 0 && <tr><td colSpan={3} className="muted">Nenhum custo indireto. Ex.: canteiro, mobilização, projetos, ligações provisórias.</td></tr>}
                {indiretos.map((x, i) => (
                  <tr key={i}>
                    <td><input aria-label={`Custo indireto ${i + 1}`} value={x.descricao} onChange={(e) => setIndiretos(indiretos.map((y, n) => (n === i ? { ...y, descricao: e.target.value } : y)))} style={{ width: '100%' }} /></td>
                    <td className="num"><input aria-label={`Valor do custo indireto ${i + 1}`} inputMode="decimal" style={{ width: 130 }} value={x.valor} onChange={(e) => setIndiretos(indiretos.map((y, n) => (n === i ? { ...y, valor: e.target.value } : y)))} /></td>
                    <td><button className="btn btn-link" type="button" onClick={() => setIndiretos(indiretos.filter((_, n) => n !== i))}>Remover</button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td>Total dos custos indiretos</td><td className="num">{formatarMoeda(somaIndiretos)}</td><td /></tr></tfoot>
            </table>
          </div>
          <div><button className="btn" type="button" onClick={() => setIndiretos([...indiretos, { descricao: '', valor: '' }])}>+ Custo indireto</button></div>
        </>
      )}

      {aba === 'acessorios' && (
        <>
          <div className="tabela-caixa">
            <table className="tabela">
              <thead><tr><th>Custo acessório</th><th className="num">Percentual</th><th>Incide sobre</th></tr></thead>
              <tbody>
                {linhaPct('Administração de obra', 'administracao', 'Custo direto + indireto')}
                {linhaPct('Imprevistos e contingências', 'imprevistos', 'Custo direto + indireto')}
                {linhaPct('CDI (taxa do custo financeiro)', 'cdi', 'Informe o CDI aplicável')}
                <tr>
                  <td>Custo financeiro</td>
                  <td className="num">{pctTexto(pctLidos.cdi)}</td>
                  <td className="small muted">Mesma alíquota do CDI · Direto + indireto · {formatarMoeda(previa.financeiro)}</td>
                </tr>
              </tbody>
              <tfoot><tr><td>Total dos acessórios</td><td /><td className="num">{formatarMoeda(previa.administracao + previa.imprevistos + previa.financeiro)}</td></tr></tfoot>
            </table>
          </div>
        </>
      )}

      {aba === 'impostos' && (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            O DAS vem do enquadramento da empresa (anexo e faixa do cadastro). Os demais impostos são digitados aqui. Todos incidem sobre a base de impostos e lucro.
          </p>
          <div className="tabela-caixa">
            <table className="tabela">
              <thead><tr><th>Imposto</th><th className="num">Percentual</th><th>Origem</th><th /></tr></thead>
              <tbody>
                {das && (
                  <tr>
                    <td>{das.descricao}</td>
                    <td className="num">{pctTexto(das.percentual)}</td>
                    <td className="small muted">Cadastro da empresa</td>
                    <td />
                  </tr>
                )}
                {impostos.map((x, i) => (
                  <tr key={i}>
                    <td><input aria-label={`Imposto ${i + 1}`} value={x.descricao} onChange={(e) => setImpostos(impostos.map((y, n) => (n === i ? { ...y, descricao: e.target.value } : y)))} style={{ width: '100%' }} /></td>
                    <td className="num"><input aria-label={`Percentual do imposto ${i + 1}`} inputMode="decimal" style={{ width: 90 }} value={x.percentual} onChange={(e) => setImpostos(impostos.map((y, n) => (n === i ? { ...y, percentual: e.target.value } : y)))} /> %</td>
                    <td className="small muted">Digitado</td>
                    <td><button className="btn btn-link" type="button" onClick={() => setImpostos(impostos.filter((_, n) => n !== i))}>Remover</button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td>Total dos impostos</td><td className="num">{pctTexto(todosImpostos.reduce((s, p) => s + p, 0))}</td><td colSpan={2} className="num">{formatarMoeda(previa.impostos)}</td></tr></tfoot>
            </table>
          </div>
          <div><button className="btn" type="button" onClick={() => setImpostos([...impostos, { descricao: '', percentual: '' }])}>+ Imposto</button></div>
        </>
      )}

      {aba === 'lucro' && (
        <>
          <div className="tabela-caixa">
            <table className="tabela">
              <thead><tr><th>Formação do preço de venda</th><th className="num">Valor</th></tr></thead>
              <tbody>
                <tr><td>Custo direto</td><td className="num">{formatarMoeda(dados.direto)}</td></tr>
                <tr><td>Custos indiretos</td><td className="num">{formatarMoeda(somaIndiretos)}</td></tr>
                <tr><td>Administração de obra ({pctTexto(pctLidos.administracao)})</td><td className="num">{formatarMoeda(previa.administracao)}</td></tr>
                <tr><td>Imprevistos e contingências ({pctTexto(pctLidos.imprevistos)})</td><td className="num">{formatarMoeda(previa.imprevistos)}</td></tr>
                <tr><td>Custo financeiro (CDI {pctTexto(pctLidos.cdi)})</td><td className="num">{formatarMoeda(previa.financeiro)}</td></tr>
                <tr><td>Impostos ({pctTexto(todosImpostos.reduce((s, p) => s + p, 0))} sobre a base de impostos e lucro)</td><td className="num">{formatarMoeda(previa.impostos)}</td></tr>
                <tr>
                  <td>Lucratividade almejada <input aria-label="Lucratividade almejada" inputMode="decimal" style={{ width: 90, marginLeft: 8 }} value={pct.lucro} onChange={(e) => setPct({ ...pct, lucro: e.target.value })} /> %</td>
                  <td className="num">{formatarMoeda(previa.lucro)}</td>
                </tr>
              </tbody>
              <tfoot><tr><td>Preço de venda</td><td className="num">{formatarMoeda(previa.precoVenda)}</td></tr></tfoot>
            </table>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Preço de venda = custo direto + custos indiretos + administração + imprevistos + custo financeiro + impostos + lucro.
            BDI calculado = preço de venda ÷ custo direto − 1: <strong>{pctTexto(previa.bdi)}</strong>.
          </p>
        </>
      )}

      <div className="acoes" style={{ marginTop: 12 }}>
        <button className="btn btn-primario" type="submit" disabled={ocupado}>{ocupado ? 'Salvando…' : 'Salvar composição'}</button>
      </div>
    </form>
  );
}
