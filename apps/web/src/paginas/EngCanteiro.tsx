// Engenharia · Canteiro de obra: fluxograma com as quatro centrais (argamassa, carpintaria, armação e almoxarifado).
// A engenharia associa os serviços da EAP a cada central, define a periodicidade e gera os boletins de produção
// (previsto pelo planejamento x realizado pelas medições físicas). O mestre de obra acompanha em consulta.
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatarData } from '../api';
import { useSessao } from '../sessao';
import { CabecalhoDocumento } from '../componentes/Documento';
import { Assinatura } from '../componentes/Suprimentos';

type Periodo = { inicio: string; fim: string };
type CentralResumo = {
  tipo: string;
  nome: string;
  periodicidadeDias: number;
  servicos: number;
  boletins: number;
  ultimoBoletim: { numero: number; inicio: string; fim: string } | null;
  proximoPeriodo: Periodo;
};
type Folha = { eapNoId: string; codigo: string; descricao: string; central: string | null };
type CanteiroObra = { obra: { id: string; codigo: string; nome: string; inicio: string | null; tipoCanteiro?: 'horizontal' | 'vertical' }; centrais: CentralResumo[]; folhas: Folha[] };
type BoletimResumo = { id: string; tipo: string; numero: number; inicio: string; fim: string; criadoEm: string };
type CentralDetalhe = { tipo: string; nome: string; periodicidadeDias: number; servicos: Folha[]; boletins: BoletimResumo[] };
type ItemBoletim = { eapNoId: string; codigo: string; descricao: string; previstoPct: number; realizadoPct: number; diferencaPct: number };
type BoletimDetalhe = {
  boletim: BoletimResumo & { nome: string; criadoPor: string | null };
  obra: { id: string; codigo: string; nome: string };
  itens: ItemBoletim[];
};

const pct = (n: number) => `${n.toFixed(2).replace('.', ',')}%`;
const periodo = (p: Periodo) => `${formatarData(p.inicio)} a ${formatarData(p.fim)}`;

/** Lista das obras da engenharia (o mestre e o engenheiro veem só as atribuídas a eles). */
export function EngCanteiroObras() {
  const [obras, setObras] = useState<{ id: string; codigo: string; nome: string }[] | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    api<{ obras: { id: string; codigo: string; nome: string }[] }>('/eng/obras').then((r) => setObras(r.obras)).catch((e) => setErro((e as Error).message));
  }, []);
  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Canteiro de obra</h1>
          <span className="muted">Centrais de argamassa, carpintaria e armação, e o almoxarifado de cada obra.</span>
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {!obras ? (
        <p className="muted">Carregando…</p>
      ) : obras.length === 0 ? (
        <p className="muted">Nenhuma obra disponível.</p>
      ) : (
        <div className="canteiro-lista">
          {obras.map((o) => (
            <Link key={o.id} to={`/eng/canteiro/${o.id}`} className="card canteiro-obra-link">
              <strong>{o.codigo}</strong> · {o.nome}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

/** Fluxograma da obra: Engenharia ligada às quatro centrais. */
export function EngCanteiroObra() {
  const { obraId = '' } = useParams();
  const { empresa, usuario } = useSessao();
  const [dados, setDados] = useState<CanteiroObra | null>(null);
  const [erro, setErro] = useState('');
  const recursos = empresa?.contrato?.recursos ?? [];
  useEffect(() => {
    setDados(null);
    setErro('');
    api<CanteiroObra>(`/eng/obras/${obraId}/canteiro`).then(setDados).catch((e) => setErro((e as Error).message));
  }, [obraId]);

  if (erro) return <div className="alerta alerta-erro" role="alert">{erro}</div>;
  if (!dados) return <p className="muted">Carregando…</p>;
  const temCentrais = recursos.includes('centrais');
  const temVertical = recursos.includes('canteiro_vertical') && dados.obra.tipoCanteiro === 'vertical';
  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Canteiro de obra</h1>
          <span className="muted">{dados.obra.codigo} · {dados.obra.nome} · Canteiro {dados.obra.tipoCanteiro === 'vertical' ? 'vertical' : 'horizontal'}</span>
        </div>
        <div className="acoes nao-imprimir">
          <Link className="btn" to="/eng/canteiro">Todas as obras</Link>
        </div>
      </div>
      {temVertical && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Obra vertical</h2>
          <p className="muted">Agenda de guincho e grua por pavimento, ciclo de cada laje e concreto lançado por andar.</p>
          <Link className="btn btn-primario" to={`/eng/canteiro/${obraId}/vertical`}>Abrir o canteiro vertical</Link>
        </div>
      )}
      {temCentrais ? (
        <>
          <div className="card canteiro-fluxo">
            <div className="canteiro-no canteiro-raiz">
              <strong>Engenharia</strong>
              <small>Planeja a produção de cada central</small>
            </div>
            <div className="canteiro-ramos">
              {dados.centrais.map((c) => (
                <Link key={c.tipo} to={`/eng/canteiro/${obraId}/${c.tipo}`} className="canteiro-no canteiro-central">
                  <strong>{c.nome}</strong>
                  <span className="muted">{c.servicos} serviço(s) · boletim a cada {c.periodicidadeDias} dia(s)</span>
                  <span className="muted">{c.ultimoBoletim ? `Último boletim: nº ${c.ultimoBoletim.numero}` : 'Sem boletim ainda'}</span>
                </Link>
              ))}
            </div>
          </div>
          <p className="muted">Clique em uma central para ver os serviços, a periodicidade e os boletins.</p>
          <KanbanCentrais obraId={obraId} centrais={dados.centrais} podeEditar={usuario?.perfil !== 'mestre_obra'} />
        </>
      ) : (
        <p className="muted">O contrato desta empresa não inclui as centrais de produção (argamassa, carpintaria, armação e almoxarifado). Elas são um recurso à parte.</p>
      )}
    </>
  );
}

/** Uma central: serviços e periodicidade (engenharia), boletins gerados e o detalhe de cada boletim. */
export function EngCanteiroCentral() {
  const { obraId = '', tipo = '' } = useParams();
  const { usuario } = useSessao();
  const podeEditar = usuario?.perfil !== 'mestre_obra';
  const [canteiro, setCanteiro] = useState<CanteiroObra | null>(null);
  const [central, setCentral] = useState<CentralDetalhe | null>(null);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [periodicidade, setPeriodicidade] = useState('7');
  const [boletim, setBoletim] = useState<BoletimDetalhe | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const carregar = async () => {
    const [c, d] = await Promise.all([
      api<CanteiroObra>(`/eng/obras/${obraId}/canteiro`),
      api<CentralDetalhe>(`/eng/obras/${obraId}/canteiro/centrais/${tipo}`),
    ]);
    setCanteiro(c);
    setCentral(d);
    setSelecionados(new Set(d.servicos.map((s) => s.eapNoId)));
    setPeriodicidade(String(d.periodicidadeDias));
  };

  useEffect(() => {
    setErro('');
    setAviso('');
    setBoletim(null);
    carregar().catch((e) => setErro((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obraId, tipo]);

  const alternar = (eapNoId: string) =>
    setSelecionados((atual) => {
      const novo = new Set(atual);
      if (novo.has(eapNoId)) novo.delete(eapNoId);
      else novo.add(eapNoId);
      return novo;
    });

  async function salvarCentral(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setAviso('');
    setOcupado(true);
    try {
      await api(`/eng/obras/${obraId}/canteiro/centrais/${tipo}`, {
        metodo: 'PUT',
        corpo: { periodicidadeDias: Number(periodicidade), servicos: [...selecionados] },
      });
      await carregar();
      setAviso('Central salva.');
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function abrirBoletim(id: string) {
    setErro('');
    setBoletim(await api<BoletimDetalhe>(`/eng/obras/${obraId}/canteiro/boletins/${id}`));
  }

  async function gerarBoletim() {
    setErro('');
    setAviso('');
    setOcupado(true);
    try {
      const r = await api<{ boletim: { id: string; numero: number } }>(`/eng/obras/${obraId}/canteiro/centrais/${tipo}/boletins`, { corpo: {} });
      await carregar();
      await abrirBoletim(r.boletim.id);
      setAviso(`Boletim nº ${r.boletim.numero} gerado.`);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function excluirBoletim(b: BoletimResumo) {
    if (!window.confirm(`Excluir o boletim nº ${b.numero} (${periodo(b)})? Esta ação não pode ser desfeita.`)) return;
    setErro('');
    setAviso('');
    setOcupado(true);
    try {
      await api(`/eng/obras/${obraId}/canteiro/boletins/${b.id}`, { metodo: 'DELETE' });
      if (boletim?.boletim.id === b.id) setBoletim(null);
      await carregar();
      setAviso(`Boletim nº ${b.numero} excluído.`);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  if (!central || !canteiro) {
    return erro ? <div className="alerta alerta-erro" role="alert">{erro}</div> : <p className="muted">Carregando…</p>;
  }
  const resumo = canteiro.centrais.find((c) => c.tipo === tipo);

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>{central.nome}</h1>
          <span className="muted">{canteiro.obra.codigo} · {canteiro.obra.nome}</span>
        </div>
        <div className="acoes nao-imprimir">
          <Link className="btn" to={`/eng/canteiro/${obraId}`}>Canteiro da obra</Link>
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta" role="status">{aviso}</div>}

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Serviços e periodicidade</h2>
        {podeEditar ? (
          <form onSubmit={salvarCentral} className="formulario">
            <label>
              Periodicidade do boletim (dias)
              <input type="number" min={1} max={90} value={periodicidade} onChange={(e) => setPeriodicidade(e.target.value)} required />
            </label>
            <p className="muted">Marque os serviços da EAP que esta central atende. Um serviço marcado aqui sai da central em que estava.</p>
            <div className="canteiro-servicos">
              {canteiro.folhas.map((f) => {
                const outra = f.central && f.central !== tipo ? f.central : null;
                return (
                  <label key={f.eapNoId} className="canteiro-servico">
                    <input type="checkbox" checked={selecionados.has(f.eapNoId)} onChange={() => alternar(f.eapNoId)} />
                    <span>
                      <strong>{f.codigo}</strong> {f.descricao}
                      {outra && <span className="muted"> (hoje em {canteiro.centrais.find((c) => c.tipo === outra)?.nome.toLowerCase()})</span>}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="acoes">
              <button className="btn btn-primario" type="submit" disabled={ocupado}>Salvar central</button>
            </div>
          </form>
        ) : (
          <>
            <p className="muted">Periodicidade: a cada {central.periodicidadeDias} dia(s). Serviços atendidos:</p>
            <ul>
              {central.servicos.map((s) => (
                <li key={s.eapNoId}>
                  <strong>{s.codigo}</strong> {s.descricao}
                </li>
              ))}
            </ul>
            {central.servicos.length === 0 && <p className="muted">Nenhum serviço associado ainda.</p>}
          </>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h2>Boletins de produção</h2>
        <p className="muted">
          Previsto: avanço planejado no período (planejamento). Realizado: avanço medido no período (medições físicas do acompanhamento).
        </p>
        {podeEditar && central.servicos.length > 0 && resumo && (
          <div className="acoes">
            <button className="btn btn-primario" onClick={gerarBoletim} disabled={ocupado}>
              Gerar boletim · {periodo(resumo.proximoPeriodo)}
            </button>
          </div>
        )}
        {central.boletins.length === 0 ? (
          <p className="muted">Nenhum boletim gerado.</p>
        ) : (
          <div className="tabela-caixa">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Nº</th>
                  <th>Período</th>
                  <th>Gerado em</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...central.boletins].reverse().map((b, n) => (
                  <tr key={b.id}>
                    <td>{b.numero}</td>
                    <td>{periodo(b)}</td>
                    <td>{formatarData(b.criadoEm)}</td>
                    <td>
                      <div className="acoes" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                        <button className="btn" onClick={() => abrirBoletim(b.id).catch((e) => setErro((e as Error).message))}>Ver</button>
                        <Link className="btn" to={`/eng/canteiro/${obraId}/${tipo}/boletins/${b.id}`}>Imprimir</Link>
                        {/* Só o último boletim da central pode ser excluído (o servidor confere). */}
                        {podeEditar && n === 0 && (
                          <button className="btn btn-perigo" onClick={() => excluirBoletim(b)} disabled={ocupado}>Excluir</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {boletim && (
        <div className="card">
          <div className="acoes" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>Boletim nº {boletim.boletim.numero} · {periodo(boletim.boletim)}</h2>
            <Link className="btn" to={`/eng/canteiro/${obraId}/${tipo}/boletins/${boletim.boletim.id}`}>Imprimir</Link>
          </div>
          <TabelaBoletim itens={boletim.itens} />
        </div>
      )}
    </>
  );
}

function TabelaBoletim({ itens }: { itens: ItemBoletim[] }) {
  if (itens.length === 0) return <p className="muted">Sem serviços neste boletim.</p>;
  return (
    <div className="tabela-caixa">
      <table className="tabela tabela-compacta boletim">
        <thead>
          <tr>
            <th>Código</th>
            <th>Serviço</th>
            <th style={{ textAlign: 'right' }}>Previsto</th>
            <th style={{ textAlign: 'right' }}>Realizado</th>
            <th style={{ textAlign: 'right' }}>Diferença</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((i) => (
            <tr key={i.eapNoId}>
              <td>{i.codigo}</td>
              <td>{i.descricao}</td>
              <td className="mono" style={{ textAlign: 'right' }}>{pct(i.previstoPct)}</td>
              <td className="mono" style={{ textAlign: 'right' }}>{pct(i.realizadoPct)}</td>
              <td className="mono" style={{ textAlign: 'right', color: i.diferencaPct < 0 ? 'var(--status-danger-ink)' : undefined }}>{pct(i.diferencaPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Boletim de produção em formato de documento, para imprimir ou salvar em PDF. */
export function EngCanteiroBoletimImprimir() {
  const { obraId = '', tipo = '', boletimId = '' } = useParams();
  const [dados, setDados] = useState<BoletimDetalhe | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    setDados(null);
    setErro('');
    api<BoletimDetalhe>(`/eng/obras/${obraId}/canteiro/boletins/${boletimId}`).then(setDados).catch((e) => setErro((e as Error).message));
  }, [obraId, boletimId]);

  if (erro) return <div className="alerta alerta-erro" role="alert">{erro}</div>;
  if (!dados) return <p className="muted">Carregando…</p>;
  const { boletim: b, obra, itens } = dados;
  const previsto = itens.reduce((s, i) => s + i.previstoPct, 0) / (itens.length || 1);
  const realizado = itens.reduce((s, i) => s + i.realizadoPct, 0) / (itens.length || 1);
  const atrasados = itens.filter((i) => i.diferencaPct < 0).length;
  return (
    <>
      <div className="nao-imprimir">
        <Link to={`/eng/canteiro/${obraId}/${tipo}`} className="small">← {b.nome}</Link>
      </div>
      <CabecalhoDocumento
        modulo="Engenharia · Canteiro de obra"
        titulo={`Boletim de produção nº ${b.numero} · ${b.nome}`}
        descricao={`Obra ${obra.codigo} · ${obra.nome}`}
        periodo={periodo(b)}
        filtros={[`Gerado em ${formatarData(b.criadoEm)}${b.criadoPor ? ` por ${b.criadoPor}` : ''}`]}
      />
      <div className="card">
        <TabelaBoletim itens={itens} />
        {itens.length > 0 && (
          <p className="small" style={{ marginBottom: 0 }}>
            Média dos serviços: previsto <b className="mono">{pct(previsto)}</b> · realizado <b className="mono">{pct(realizado)}</b> · {atrasados} serviço(s) abaixo do previsto.
          </p>
        )}
        <p className="small muted" style={{ marginBottom: 0 }}>
          Previsto: avanço planejado no período (planejamento). Realizado: avanço medido no período (medições físicas do acompanhamento).
        </p>
      </div>
      <div className="assinaturas">
        <Assinatura nome={b.criadoPor ?? ''} papel="Engenharia · emitido por" />
        <Assinatura nome="" papel="Mestre de obra · ciente" />
        <Assinatura nome="" papel={`Encarregado · ${b.nome.toLowerCase()}`} />
      </div>
    </>
  );
}

// ----- Kanban das centrais: um quadro por central, abaixo do organograma. Cada card é uma frente de serviço da central;
// a cor é a prioridade, a posição é a ordem do fluxo, e a coluna segue o status da OS da frente.
type OsCard = { id: string; numero: number; status: string; equipe: string; quantidade: number | null; unidade: string; prazo: string | null; atrasada: boolean };
type FrenteCard = {
  id: string; eapNoId: string; codigo: string; descricao: string; prioridade: 'alta' | 'media' | 'baixa'; ordem: number; coluna: string; os: OsCard | null;
  /** Sugestão para a OS: equipe do serviço e quantidade do orçamento. */
  sugestao: { equipe: string; quantidade: number | null; unidade: string };
};
type FormOsDados = { frenteId: string; osId?: string; equipe: string; quantidade: string; unidade: string; prazo: string };
const quantidadeTexto = (n: number | null) => (n === null ? '' : n.toLocaleString('pt-BR', { maximumFractionDigits: 4 }));
/** "1.234,5" ou "1234.5" viram número; vazio vira null. */
function lerQuantidade(texto: string): number | null | undefined {
  const t = texto.trim();
  if (!t) return null;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
const detalhesOs = (os: OsCard) =>
  [os.equipe && `Equipe: ${os.equipe}`, os.quantidade !== null && `${os.quantidade.toLocaleString('pt-BR')} ${os.unidade}`.trim(), os.prazo && `Prazo ${formatarData(os.prazo)}`]
    .filter(Boolean)
    .join(' · ');
type Kanban = { colunas: { id: string; nome: string; frentes: FrenteCard[] }[]; total: number };

const NOMES_PRIORIDADE: Record<FrenteCard['prioridade'], string> = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };
const NOMES_STATUS_OS: Record<string, string> = { liberada: 'Liberada', em_execucao: 'Em execução', concluida: 'Concluída', cancelada: 'Cancelada' };

function KanbanCentrais({ obraId, centrais, podeEditar }: { obraId: string; centrais: CentralResumo[]; podeEditar: boolean }) {
  const [tipo, setTipo] = useState(() => centrais.find((c) => c.servicos > 0)?.tipo ?? centrais[0]?.tipo ?? 'argamassa');
  const [quadro, setQuadro] = useState<Kanban | null>(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const base = `/eng/obras/${obraId}/canteiro/centrais/${tipo}`;
  const [formOs, setFormOs] = useState<FormOsDados | null>(null);

  /** Abre o formulário da OS no card: nova (com a sugestão) ou editando a OS aberta. */
  function abrirFormOs(f: FrenteCard, os?: OsCard) {
    setFormOs(
      os
        ? { frenteId: f.id, osId: os.id, equipe: os.equipe, quantidade: quantidadeTexto(os.quantidade), unidade: os.unidade, prazo: os.prazo ?? '' }
        : { frenteId: f.id, equipe: f.sugestao.equipe, quantidade: quantidadeTexto(f.sugestao.quantidade), unidade: f.sugestao.unidade, prazo: '' },
    );
  }

  function salvarOs(e: FormEvent) {
    e.preventDefault();
    if (!formOs) return;
    const quantidade = lerQuantidade(formOs.quantidade);
    if (quantidade === undefined) return setErro('Informe a quantidade maior que zero, ou deixe em branco.');
    const corpo = { equipe: formOs.equipe.trim(), quantidade, unidade: formOs.unidade.trim(), prazo: formOs.prazo || null };
    const editando = !!formOs.osId;
    const url = editando ? `${base}/os/${formOs.osId}` : `${base}/frentes/${formOs.frenteId}/os`;
    executar(async () => {
      await api(url, { metodo: editando ? 'PATCH' : 'POST', corpo });
      setFormOs(null);
    });
  }

  const carregar = async () => {
    try {
      setQuadro(await api<Kanban>(`${base}/kanban`));
      setErro('');
    } catch (e) {
      setErro((e as Error).message);
    }
  };
  useEffect(() => {
    setQuadro(null);
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obraId, tipo]);

  /** Executa uma alteração e recarrega o quadro; o erro do servidor aparece no alerta. */
  async function executar(fn: () => Promise<unknown>) {
    setOcupado(true);
    setErro('');
    try {
      await fn();
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  /** Sobe ou desce o card dentro da coluna: troca de lugar com o vizinho da mesma coluna na ordem geral da central. */
  function mover(card: FrenteCard, direcao: -1 | 1) {
    if (!quadro) return;
    const todos = quadro.colunas.flatMap((c) => c.frentes).sort((a, b) => a.ordem - b.ordem);
    const mesmaColuna = todos.filter((f) => f.coluna === card.coluna);
    const vizinho = mesmaColuna[mesmaColuna.findIndex((f) => f.id === card.id) + direcao];
    if (!vizinho) return;
    const ids = todos.map((f) => f.id);
    const i = ids.indexOf(card.id);
    const j = ids.indexOf(vizinho.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    executar(() => api(`${base}/kanban/ordem`, { metodo: 'PUT', corpo: { frentes: ids } }));
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2 style={{ marginTop: 0 }}>Kanban das centrais</h2>
      <div className="abas" role="tablist" aria-label="Centrais">
        {centrais.map((c) => (
          <button key={c.tipo} type="button" role="tab" aria-selected={c.tipo === tipo} className={`aba ${c.tipo === tipo ? 'ativa' : ''}`} onClick={() => { setTipo(c.tipo); setFormOs(null); }}>
            {c.nome}
          </button>
        ))}
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {!quadro ? (
        <p className="muted">Carregando…</p>
      ) : quadro.total === 0 ? (
        <p className="muted">Nenhum serviço nesta central. Associe os serviços da EAP na página da central.</p>
      ) : (
        <div className="kanban">
          {quadro.colunas.map((col) => (
            <section key={col.id} className="kanban-coluna" aria-label={col.nome}>
              <h3>{col.nome} <span className="muted">({col.frentes.length})</span></h3>
              {col.frentes.map((f, i) => (
                <article key={f.id} className={`kanban-card prioridade-${f.prioridade}`}>
                  <div>
                    <strong>{f.codigo}</strong> {f.descricao}
                  </div>
                  <div className="small muted">
                    Prioridade {NOMES_PRIORIDADE[f.prioridade].toLowerCase()}
                    {f.os && f.os.status !== 'cancelada' ? ` · OS ${f.os.numero} · ${NOMES_STATUS_OS[f.os.status]}` : ''}
                  </div>
                  {f.os && f.os.status !== 'cancelada' && detalhesOs(f.os) && <div className="small">{detalhesOs(f.os)}</div>}
                  {f.os?.atrasada && <div className="small kanban-atrasada">Prazo vencido</div>}
                  {formOs?.frenteId === f.id && (
                    <form className="kanban-os-form" onSubmit={salvarOs} aria-label={formOs.osId ? 'Editar OS' : 'Gerar OS'}>
                      <label>
                        Equipe
                        <input value={formOs.equipe} maxLength={300} onChange={(e) => setFormOs({ ...formOs, equipe: e.target.value })} placeholder="Ex.: João, Pedro" />
                      </label>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <label style={{ flex: 1 }}>
                          Quantidade
                          <input inputMode="decimal" value={formOs.quantidade} onChange={(e) => setFormOs({ ...formOs, quantidade: e.target.value })} />
                        </label>
                        <label style={{ width: 80 }}>
                          Unidade
                          <input value={formOs.unidade} maxLength={20} onChange={(e) => setFormOs({ ...formOs, unidade: e.target.value })} />
                        </label>
                      </div>
                      <label>
                        Prazo
                        <input type="date" value={formOs.prazo} onChange={(e) => setFormOs({ ...formOs, prazo: e.target.value })} />
                      </label>
                      <div className="kanban-acoes">
                        <button className="btn btn-primario" type="submit" disabled={ocupado}>{formOs.osId ? 'Salvar OS' : 'Gerar OS'}</button>
                        <button type="button" className="btn btn-link" onClick={() => setFormOs(null)}>Cancelar</button>
                      </div>
                    </form>
                  )}
                  {podeEditar && (
                    <div className="kanban-acoes">
                      <select aria-label={`Prioridade de ${f.codigo}`} value={f.prioridade} disabled={ocupado} onChange={(e) => executar(() => api(`${base}/frentes/${f.id}`, { metodo: 'PATCH', corpo: { prioridade: e.target.value } }))}>
                        <option value="alta">Alta</option>
                        <option value="media">Média</option>
                        <option value="baixa">Baixa</option>
                      </select>
                      <button type="button" className="btn btn-link" title="Subir" aria-label={`Subir ${f.codigo}`} disabled={ocupado || i === 0} onClick={() => mover(f, -1)}>↑</button>
                      <button type="button" className="btn btn-link" title="Descer" aria-label={`Descer ${f.codigo}`} disabled={ocupado || i === col.frentes.length - 1} onClick={() => mover(f, 1)}>↓</button>
                      {col.id === 'planejada' && (
                        <button type="button" className="btn btn-secundario" disabled={ocupado || formOs?.frenteId === f.id} onClick={() => abrirFormOs(f)}>Gerar OS</button>
                      )}
                      {col.id === 'liberada' && f.os && (
                        <button type="button" className="btn btn-secundario" disabled={ocupado} onClick={() => executar(() => api(`${base}/os/${f.os!.id}`, { metodo: 'PATCH', corpo: { status: 'em_execucao' } }))}>Iniciar</button>
                      )}
                      {col.id === 'em_execucao' && f.os && (
                        <button type="button" className="btn btn-secundario" disabled={ocupado} onClick={() => executar(() => api(`${base}/os/${f.os!.id}`, { metodo: 'PATCH', corpo: { status: 'concluida' } }))}>Concluir</button>
                      )}
                      {(col.id === 'liberada' || col.id === 'em_execucao') && f.os && formOs?.frenteId !== f.id && (
                        <button type="button" className="btn btn-link" disabled={ocupado} onClick={() => abrirFormOs(f, f.os!)}>Editar OS</button>
                      )}
                      {(col.id === 'liberada' || col.id === 'em_execucao') && f.os && (
                        <button
                          type="button"
                          className="btn btn-link"
                          disabled={ocupado}
                          onClick={() => {
                            if (window.confirm(`Cancelar a OS ${f.os!.numero}? A frente volta para Planejada.`)) executar(() => api(`${base}/os/${f.os!.id}`, { metodo: 'PATCH', corpo: { status: 'cancelada' } }));
                          }}
                        >
                          Cancelar OS
                        </button>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
