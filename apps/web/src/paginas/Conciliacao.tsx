import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, formatarData, formatarDataHora, formatarMoeda } from '../api';
import { OpcoesCategoria, useCadastros, type Cadastros } from './Lancamento';

type ContaResumo = {
  id: string; nome: string; tipo: string; banco: string | null; agencia: string | null; conta: string | null; ativo: boolean; pendentes: number; sugestoes: number;
  comparacao: { data: string; banco: number; sistema: number | null; diferenca: number | null } | null;
};
type ParcelaRef = { id: string; lancamentoId: string; descricao: string; pessoa: string | null; numero: number; total: number; vencimento: string; valor: number; status: string; dataPagamento: string | null; valorPago: number | null; sugestao?: boolean; exato?: boolean; documento?: string | null };
type TransfRef = { id: string; data: string; valor: number; origem: string; destino: string; descricao: string | null; sugestao?: boolean; exato?: boolean };
type Linha = {
  id: string; data: string; valor: number; tipo: string | null; descricao: string; documento: string | null; status: 'pendente' | 'conciliado' | 'ignorado';
  acao: 'vinculo' | 'baixa' | 'lancamento' | 'transferencia' | 'nova_transferencia' | null; parcela: ParcelaRef | null; transferencia: TransfRef | null; categoriaSugerida: string | null;
};
type Extrato = { id: string; contaId: string; arquivo: string | null; inicio: string; fim: string; saldo: number | null; dataSaldo: string | null; novas: number; repetidas: number; pendentes: number; usuario: string | null; importadoEm: string };
type Resultado = { novas: number; repetidas: number; sugestoes: number; avisos: string[]; inicio: string; fim: string; arquivo: string };

const FILTROS = [
  { id: 'pendente', texto: 'Pendentes' },
  { id: 'conciliado', texto: 'Conciliadas' },
  { id: 'ignorado', texto: 'Ignoradas' },
  { id: 'todas', texto: 'Todas' },
] as const;

/** Lê o OFX no navegador respeitando a codificação (muitos bancos usam Windows-1252). */
async function lerArquivo(f: File): Promise<string> {
  const buf = await f.arrayBuffer();
  const cab = new TextDecoder('latin1').decode(buf.slice(0, 800));
  if (/CHARSET:\s*(1252|ISO|8859)/i.test(cab) || /encoding="(windows-1252|iso-8859-1)"/i.test(cab)) return new TextDecoder('windows-1252').decode(buf);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

const refParcela = (p: ParcelaRef) =>
  `${p.pessoa ? `${p.pessoa} · ` : ''}${p.descricao}${p.total > 1 ? ` · parcela ${p.numero}/${p.total}` : ''}`;

function Resolver({ linha, cadastros, contaId, aoConcluir }: { linha: Linha; cadastros: Cadastros; contaId: string; aoConcluir: (msg: string) => void }) {
  const tipo = linha.valor > 0 ? 'receita' : 'despesa';
  const [aba, setAba] = useState<'parcela' | 'lancamento' | 'transferencia'>(linha.categoriaSugerida ? 'lancamento' : 'parcela');
  const [busca, setBusca] = useState('');
  const [cand, setCand] = useState<{ parcelas: ParcelaRef[]; transferencias: TransfRef[] } | null>(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const planoSug = linha.categoriaSugerida ? cadastros.plano.find((p) => p.codigo === linha.categoriaSugerida && p.tipo === tipo)?.id ?? '' : '';
  const [lanc, setLanc] = useState({ planoContaId: planoSug, centroCustoId: '', descricao: linha.descricao, pessoaId: '' });
  const [outra, setOutra] = useState('');

  const buscar = useCallback(
    async (texto: string) => {
      try {
        setCand(await api(`/fin/conciliacao/linhas/${linha.id}/candidatos?busca=${encodeURIComponent(texto)}`));
      } catch (e) {
        setErro((e as Error).message);
      }
    },
    [linha.id],
  );
  useEffect(() => {
    buscar('');
  }, [buscar]);

  async function executar(fn: () => Promise<unknown>, msg: string) {
    setErro('');
    setOcupado(true);
    try {
      await fn();
      aoConcluir(msg);
    } catch (e) {
      setErro((e as Error).message);
      setOcupado(false);
    }
  }

  function criarLancamento(e: FormEvent) {
    e.preventDefault();
    executar(
      () =>
        api(`/fin/conciliacao/linhas/${linha.id}/lancamento`, {
          corpo: {
            planoContaId: lanc.planoContaId,
            centroCustoId: lanc.centroCustoId || null,
            descricao: lanc.descricao,
            fornecedorId: tipo === 'despesa' ? lanc.pessoaId || null : null,
            clienteId: tipo === 'receita' ? lanc.pessoaId || null : null,
          },
        }),
      'Lançamento criado e conciliado.',
    );
  }

  const pessoas = tipo === 'despesa' ? cadastros.fornecedores : cadastros.clientes;
  return (
    <div className="painel-vinculo">
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div className="abas" role="tablist">
        <button type="button" role="tab" aria-selected={aba === 'parcela'} className={aba === 'parcela' ? 'ativa' : ''} onClick={() => setAba('parcela')}>
          {tipo === 'despesa' ? 'Conta a pagar' : 'Conta a receber'}
        </button>
        <button type="button" role="tab" aria-selected={aba === 'lancamento'} className={aba === 'lancamento' ? 'ativa' : ''} onClick={() => setAba('lancamento')}>
          Novo lançamento
        </button>
        <button type="button" role="tab" aria-selected={aba === 'transferencia'} className={aba === 'transferencia' ? 'ativa' : ''} onClick={() => setAba('transferencia')}>
          Transferência entre contas
        </button>
      </div>

      {aba === 'parcela' && (
        <>
          <form
            className="acoes"
            onSubmit={(e) => {
              e.preventDefault();
              buscar(busca);
            }}
          >
            <input className="busca" style={{ marginLeft: 0 }} type="search" placeholder="Buscar por fornecedor, cliente, descrição ou documento" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <button className="btn btn-secundario" type="submit">Buscar</button>
          </form>
          {!cand ? (
            <p className="muted">Carregando…</p>
          ) : cand.parcelas.length === 0 && cand.transferencias.length === 0 ? (
            <p className="small muted">
              Nenhuma {tipo === 'despesa' ? 'conta a pagar' : 'conta a receber'} perto desta data. Se a despesa não foi lançada, use "Novo lançamento" ou lance a nota fiscal antes.
            </p>
          ) : (
            <div className="lista-vinculo">
              {cand.parcelas.map((p) => (
                <div key={p.id} className="marcar">
                  <span className="mono small">{p.status === 'paga' ? `pago ${formatarData(p.dataPagamento)}` : `vence ${formatarData(p.vencimento)}`}</span>
                  <span className="small" style={{ flex: 1, minWidth: 180 }}>{refParcela(p)}</span>
                  <span className={`mono small ${p.exato ? 'tom-ok' : ''}`} style={{ fontWeight: 600 }}>{formatarMoeda(p.status === 'paga' ? p.valorPago : p.valor)}</span>
                  <button className="btn btn-link" type="button" disabled={ocupado} onClick={() => executar(() => api(`/fin/conciliacao/linhas/${linha.id}/conciliar`, { corpo: { parcelaId: p.id } }), 'Linha conciliada.')}>
                    Conciliar
                  </button>
                </div>
              ))}
              {cand.transferencias.map((t) => (
                <div key={t.id} className="marcar">
                  <span className="mono small">{formatarData(t.data)}</span>
                  <span className="small" style={{ flex: 1, minWidth: 180 }}>Transferência {t.origem} → {t.destino}</span>
                  <span className={`mono small ${t.exato ? 'tom-ok' : ''}`} style={{ fontWeight: 600 }}>{formatarMoeda(t.valor)}</span>
                  <button className="btn btn-link" type="button" disabled={ocupado} onClick={() => executar(() => api(`/fin/conciliacao/linhas/${linha.id}/conciliar`, { corpo: { transferenciaId: t.id } }), 'Linha conciliada.')}>
                    Conciliar
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="small muted" style={{ margin: 0 }}>
            Se a conta estiver em aberto, a conciliação dá baixa na data do extrato. Diferença de valor vira juros (a mais) ou desconto (a menos).
          </p>
        </>
      )}

      {aba === 'lancamento' && (
        <form className="form" onSubmit={criarLancamento}>
          <p className="small muted" style={{ margin: 0 }}>Para o que só aparece no extrato: tarifas, IOF, rendimentos, débitos automáticos. O lançamento já entra pago nesta conta.</p>
          <div className="campos">
            <div className="campo">
              <label htmlFor={`cl-cat-${linha.id}`}>Categoria</label>
              <select id={`cl-cat-${linha.id}`} value={lanc.planoContaId} onChange={(e) => setLanc({ ...lanc, planoContaId: e.target.value })}>
                <OpcoesCategoria plano={cadastros.plano} tipo={tipo} atual={lanc.planoContaId} />
              </select>
              {planoSug && lanc.planoContaId === planoSug && <span className="ajuda">Sugerida pela descrição do extrato.</span>}
            </div>
            <div className="campo">
              <label htmlFor={`cl-cc-${linha.id}`}>Centro de custo</label>
              <select id={`cl-cc-${linha.id}`} value={lanc.centroCustoId} onChange={(e) => setLanc({ ...lanc, centroCustoId: e.target.value })}>
                <option value="">—</option>
                {cadastros.centros.filter((c) => c.ativo).map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor={`cl-p-${linha.id}`}>{tipo === 'despesa' ? 'Fornecedor ou credor' : 'Cliente'}</label>
              <select id={`cl-p-${linha.id}`} value={lanc.pessoaId} onChange={(e) => setLanc({ ...lanc, pessoaId: e.target.value })}>
                <option value="">Não informado</option>
                {pessoas.filter((p) => p.ativo).map((p) => (
                  <option key={p.id} value={p.id}>{p.nomeFantasia || p.razaoSocial}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="campo">
            <label htmlFor={`cl-d-${linha.id}`}>Descrição</label>
            <input id={`cl-d-${linha.id}`} value={lanc.descricao} onChange={(e) => setLanc({ ...lanc, descricao: e.target.value })} />
          </div>
          <div className="acoes">
            <button className="btn btn-primario" type="submit" disabled={ocupado || !lanc.planoContaId}>
              Lançar e conciliar
            </button>
          </div>
        </form>
      )}

      {aba === 'transferencia' && (
        <div className="form">
          <p className="small muted" style={{ margin: 0 }}>
            {tipo === 'despesa' ? 'O dinheiro saiu desta conta para outra conta da empresa.' : 'O dinheiro veio de outra conta da empresa.'} A transferência não entra na DRE.
          </p>
          <div className="campo" style={{ maxWidth: 360 }}>
            <label htmlFor={`ct-${linha.id}`}>{tipo === 'despesa' ? 'Foi para a conta' : 'Veio da conta'}</label>
            <select id={`ct-${linha.id}`} value={outra} onChange={(e) => setOutra(e.target.value)}>
              <option value="">Escolha</option>
              {cadastros.contas.filter((c) => c.ativo && c.id !== contaId).map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
          </div>
          <div className="acoes">
            <button
              className="btn btn-primario"
              type="button"
              disabled={ocupado || !outra}
              onClick={() => executar(() => api(`/fin/conciliacao/linhas/${linha.id}/transferencia`, { corpo: { outraContaId: outra } }), 'Transferência registrada e conciliada.')}
            >
              Registrar transferência
            </button>
          </div>
        </div>
      )}

      <div className="acoes" style={{ borderTop: '1px solid var(--divider)', paddingTop: 10 }}>
        <button className="btn btn-link" type="button" disabled={ocupado} onClick={() => executar(() => api(`/fin/conciliacao/linhas/${linha.id}/ignorar`, { metodo: 'POST' }), 'Linha ignorada.')}>
          Ignorar esta linha
        </button>
        <span className="small muted">Para movimentos que não mudam o resultado e já estão no saldo (ex.: aplicação e resgate automáticos).</span>
      </div>
    </div>
  );
}

const TEXTO_ACAO: Record<NonNullable<Linha['acao']>, string> = {
  baixa: 'Baixa feita pela conciliação',
  vinculo: 'Ligada à baixa já registrada',
  lancamento: 'Lançamento criado pelo extrato',
  transferencia: 'Ligada à transferência',
  nova_transferencia: 'Transferência criada pelo extrato',
};

export function Conciliacao() {
  const { cadastros, erro: erroCad } = useCadastros();
  const [params, setParams] = useSearchParams();
  const [contas, setContas] = useState<ContaResumo[] | null>(null);
  const contaId = params.get('conta') ?? contas?.find((c) => c.ativo && c.tipo !== 'caixa')?.id ?? contas?.[0]?.id ?? '';
  const filtro = (FILTROS.some((f) => f.id === params.get('situacao')) ? params.get('situacao') : 'pendente') as (typeof FILTROS)[number]['id'];
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [extratos, setExtratos] = useState<Extrato[]>([]);
  const [aberta, setAberta] = useState<string | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const arquivo = useRef<HTMLInputElement>(null);

  const carregarContas = useCallback(async () => {
    try {
      setContas((await api<{ contas: ContaResumo[] }>('/fin/conciliacao/resumo')).contas);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);
  const carregarLinhas = useCallback(async () => {
    if (!contaId) return;
    try {
      const [l, e] = await Promise.all([
        api<{ linhas: Linha[] }>(`/fin/conciliacao/linhas?contaId=${contaId}&status=${filtro}`),
        api<{ extratos: Extrato[] }>(`/fin/conciliacao/extratos?contaId=${contaId}`),
      ]);
      setLinhas(l.linhas);
      setExtratos(e.extratos);
    } catch (err) {
      setErro((err as Error).message);
    }
  }, [contaId, filtro]);
  useEffect(() => {
    carregarContas();
  }, [carregarContas]);
  useEffect(() => {
    setLinhas(null);
    setAberta(null);
    carregarLinhas();
  }, [carregarLinhas]);

  const recarregar = async (msg?: string) => {
    if (msg) setAviso(msg);
    setAberta(null);
    await Promise.all([carregarContas(), carregarLinhas()]);
  };
  const ir = (p: Record<string, string>) => setParams({ conta: contaId, situacao: filtro, ...p }, { replace: true });

  async function importar(f: File | undefined) {
    if (!f || !contaId) return;
    setErro('');
    setAviso('');
    setResultado(null);
    setOcupado(true);
    try {
      if (f.size > 8_000_000) throw new Error('Arquivo grande demais para um extrato.');
      const conteudo = await lerArquivo(f);
      const r = await api<Omit<Resultado, 'arquivo'>>('/fin/conciliacao/ofx', { corpo: { contaId, conteudo, arquivo: f.name } });
      setResultado({ ...r, arquivo: f.name });
      ir({ situacao: 'pendente' });
      await recarregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
      if (arquivo.current) arquivo.current.value = '';
    }
  }

  async function acao(fn: () => Promise<unknown>, msg: string) {
    setErro('');
    setAviso('');
    setOcupado(true);
    try {
      await fn();
      await recarregar(msg);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const conta = contas?.find((c) => c.id === contaId);
  const comSugestao = (linhas ?? []).filter((l) => l.status === 'pendente' && (l.parcela || l.transferencia)).length;

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Conciliação bancária</h1>
          <span className="muted">Importe o extrato OFX do banco e confira cada linha com as contas pagas e recebidas no Agrega.</span>
        </div>
      </div>
      {(erro || erroCad) && <div className="alerta alerta-erro" role="alert">{erro || erroCad}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}

      {!contas ? (
        <p className="muted">Carregando…</p>
      ) : contas.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            Cadastre primeiro a conta bancária em <Link to="/fin/contas">Bancos e caixa</Link>.
          </p>
        </div>
      ) : (
        <>
          <div className="filtros">
            {contas.filter((c) => c.ativo || c.id === contaId).map((c) => (
              <button key={c.id} type="button" className={`chip ${c.id === contaId ? 'chip-ativo' : ''}`} aria-pressed={c.id === contaId} onClick={() => setParams({ conta: c.id }, { replace: true })}>
                {c.nome}
                {c.pendentes > 0 && <span className="mono"> {c.pendentes}</span>}
              </button>
            ))}
          </div>

          {conta && (
            <div className="kpis">
              <div className="kpi">
                <span className="kpi-rotulo">Saldo no banco</span>
                <span className="kpi-valor">{conta.comparacao ? formatarMoeda(conta.comparacao.banco) : '—'}</span>
                <span className="kpi-detalhe">{conta.comparacao ? `pelo extrato, em ${formatarData(conta.comparacao.data)}` : 'importe um extrato'}</span>
              </div>
              <div className="kpi">
                <span className="kpi-rotulo">Saldo no Agrega</span>
                <span className="kpi-valor">{conta.comparacao?.sistema !== null && conta.comparacao ? formatarMoeda(conta.comparacao.sistema) : '—'}</span>
                <span className="kpi-detalhe">{conta.comparacao ? `na mesma data` : ''}</span>
              </div>
              <div className={`kpi ${conta.comparacao?.diferenca ? 'kpi-perigo' : conta.comparacao ? 'kpi-ok' : ''}`}>
                <span className="kpi-rotulo">Diferença</span>
                <span className="kpi-valor">{conta.comparacao?.diferenca !== null && conta.comparacao ? formatarMoeda(conta.comparacao.diferenca) : '—'}</span>
                <span className="kpi-detalhe">{conta.comparacao ? (conta.comparacao.diferenca ? 'concilie as linhas pendentes' : 'saldos batem') : ''}</span>
              </div>
              <div className={`kpi ${conta.pendentes ? 'kpi-aviso' : ''}`}>
                <span className="kpi-rotulo">Linhas pendentes</span>
                <span className="kpi-valor">{conta.pendentes}</span>
                <span className="kpi-detalhe">{conta.sugestoes ? `${conta.sugestoes} com sugestão` : 'sem sugestões'}</span>
              </div>
            </div>
          )}

          <div className="acoes">
            <input ref={arquivo} type="file" accept=".ofx,.OFX,application/x-ofx,text/plain" hidden onChange={(e) => importar(e.target.files?.[0])} />
            <button className="btn btn-primario" type="button" disabled={ocupado || !contaId} onClick={() => arquivo.current?.click()}>
              {ocupado ? 'Processando…' : `Importar extrato OFX${conta ? ` · ${conta.nome}` : ''}`}
            </button>
            <button className="btn btn-link" type="button" disabled={ocupado || !contaId} onClick={() => acao(() => api('/fin/conciliacao/sugerir', { corpo: { contaId } }), 'Sugestões atualizadas.')}>
              Procurar sugestões de novo
            </button>
          </div>

          {resultado && (
            <div className="alerta alerta-info">
              <strong>{resultado.arquivo}</strong>: {formatarData(resultado.inicio)} a {formatarData(resultado.fim)} · {resultado.novas} linha(s) nova(s)
              {resultado.repetidas ? `, ${resultado.repetidas} já importada(s) antes` : ''} · {resultado.sugestoes} sugestão(ões) encontrada(s).
              {resultado.avisos.map((a) => (
                <div key={a} style={{ marginTop: 6, color: 'var(--status-warn-ink)' }}>{a}</div>
              ))}
            </div>
          )}

          <div className="filtros">
            {FILTROS.map((f) => (
              <button key={f.id} type="button" className={`chip ${filtro === f.id ? 'chip-ativo' : ''}`} aria-pressed={filtro === f.id} onClick={() => ir({ situacao: f.id })}>
                {f.texto}
              </button>
            ))}
          </div>

          {filtro === 'pendente' && comSugestao > 0 && (
            <div className="barra-lote">
              <span className="small">
                {comSugestao === 1 ? '1 linha tem sugestão.' : `${comSugestao} linhas têm sugestão.`} Confira na lista e confirme de uma vez.
              </span>
              <button className="btn btn-primario" type="button" disabled={ocupado} onClick={() => acao(async () => {
                const r = await api<{ conciliadas: number; erros: string[] }>('/fin/conciliacao/aceitar-sugestoes', { corpo: { contaId } });
                if (r.erros.length) setErro(`${r.erros.length} não puderam ser conciliadas: ${[...new Set(r.erros)].join(' ')}`);
              }, 'Sugestões conciliadas.')}>
                Conciliar as sugestões
              </button>
            </div>
          )}

          <div className="card tabela-caixa">
            {!linhas || !cadastros ? (
              <p className="muted">Carregando…</p>
            ) : linhas.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                {filtro === 'pendente' ? (extratos.length ? 'Nenhuma linha pendente. Extrato conciliado.' : 'Nenhum extrato importado nesta conta ainda.') : 'Nenhuma linha.'}
              </p>
            ) : (
              <table className="tabela tabela-compacta tabela-nota">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Extrato</th>
                    <th style={{ textAlign: 'right' }}>Valor</th>
                    <th>No Agrega</th>
                    <th><span style={{ position: 'absolute', left: -9999 }}>Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l) => (
                    <Fragment key={l.id}>
                      <tr>
                        <td className="mono small">{formatarData(l.data)}</td>
                        <td className="small" style={{ minWidth: 200 }}>
                          {l.descricao}
                          {l.documento && <div className="muted">doc. {l.documento}</div>}
                        </td>
                        <td className={`mono num forte ${l.valor < 0 ? 'negativo' : 'tom-ok'}`}>{formatarMoeda(l.valor)}</td>
                        <td className="small" style={{ minWidth: 220 }}>
                          {l.status === 'ignorado' ? (
                            <span className="selo selo-neutro">Ignorada</span>
                          ) : l.parcela ? (
                            <>
                              {l.status === 'pendente' ? <span className="selo selo-aviso">Sugestão</span> : <span className="selo selo-ok">Conciliada</span>}{' '}
                              <Link to={`/fin/lancamentos/${l.parcela.lancamentoId}`}>{refParcela(l.parcela)}</Link>
                              <div className="muted">
                                {l.parcela.status === 'paga' ? `pago em ${formatarData(l.parcela.dataPagamento)} · ${formatarMoeda(l.parcela.valorPago)}` : `vence ${formatarData(l.parcela.vencimento)} · ${formatarMoeda(l.parcela.valor)}`}
                                {l.acao ? ` · ${TEXTO_ACAO[l.acao]}` : ''}
                              </div>
                            </>
                          ) : l.transferencia ? (
                            <>
                              {l.status === 'pendente' ? <span className="selo selo-aviso">Sugestão</span> : <span className="selo selo-ok">Conciliada</span>}{' '}
                              Transferência {l.transferencia.origem} → {l.transferencia.destino}
                              <div className="muted">
                                {formatarData(l.transferencia.data)} · {formatarMoeda(l.transferencia.valor)}
                                {l.acao ? ` · ${TEXTO_ACAO[l.acao]}` : ''}
                              </div>
                            </>
                          ) : (
                            <span className="muted">Sem correspondência</span>
                          )}
                        </td>
                        <td>
                          <div className="acoes" style={{ flexWrap: 'nowrap', gap: 4 }}>
                            {l.status === 'pendente' && (l.parcela || l.transferencia) && (
                              <button className="btn btn-link" type="button" disabled={ocupado} onClick={() => acao(() => api(`/fin/conciliacao/linhas/${l.id}/conciliar`, { metodo: 'POST' }), 'Linha conciliada.')}>
                                Confirmar
                              </button>
                            )}
                            {l.status === 'pendente' && (
                              <button className="btn btn-link" type="button" onClick={() => setAberta(aberta === l.id ? null : l.id)}>
                                {aberta === l.id ? 'Fechar' : l.parcela || l.transferencia ? 'Outra opção' : 'Resolver'}
                              </button>
                            )}
                            {l.status !== 'pendente' && (
                              <button className="btn btn-link" type="button" disabled={ocupado} onClick={() => acao(() => api(`/fin/conciliacao/linhas/${l.id}/desfazer`, { metodo: 'POST' }), 'Conciliação desfeita.')}>
                                Desfazer
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {aberta === l.id && (
                        <tr className="linha-form">
                          <td colSpan={5}>
                            <Resolver linha={l} cadastros={cadastros} contaId={contaId} aoConcluir={(m) => recarregar(m)} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {extratos.length > 0 && (
            <details className="card implantacao">
              <summary>
                <span>Extratos importados</span>
                <span className="small muted">{extratos.length}</span>
              </summary>
              <ul className="linhas">
                {extratos.map((e) => (
                  <li key={e.id}>
                    <span className="linha-texto">
                      <span>
                        {formatarData(e.inicio)} a {formatarData(e.fim)} {e.arquivo ? <span className="muted">· {e.arquivo}</span> : null}
                      </span>
                      <span className="linha-sub">
                        {e.novas} nova(s), {e.repetidas} repetida(s) · {e.pendentes} pendente(s) · importado em {formatarDataHora(e.importadoEm)}
                        {e.usuario ? ` por ${e.usuario}` : ''}
                      </span>
                    </span>
                    <button className="btn btn-link" type="button" disabled={ocupado} onClick={() => acao(() => api(`/fin/conciliacao/extratos/${e.id}`, { metodo: 'DELETE' }), 'Extrato excluído.')}>
                      Excluir
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </>
  );
}
