// Engenharia · Planilha orçamentária: EAP e orçamento construídos juntos.
// Cada linha tem um nível (1 Obra, 2 Etapa, 3 Sub Etapa, 4 Tarefa) e uma descrição editável;
// a Tarefa recebe um serviço da obra com quantidade. As linhas acima somam o que está abaixo delas.
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, formatarMoeda, lerNumero } from '../api';
import { SeletorBusca } from '../componentes/SeletorBusca';
import type { ItemObra, Obra } from './EngObras';

export type NivelPlanilha = 'obra' | 'etapa' | 'subetapa' | 'tarefa';
export const NIVEIS: NivelPlanilha[] = ['obra', 'etapa', 'subetapa', 'tarefa'];
export const ROTULO: Record<NivelPlanilha, string> = { obra: 'Obra', etapa: 'Etapa', subetapa: 'Sub Etapa', tarefa: 'Tarefa' };
const POSICAO: Record<NivelPlanilha, number> = { obra: 1, etapa: 2, subetapa: 3, tarefa: 4 };

type Servico = { linhaId: string; itemId: string; codigo: string; descricaoServico: string; unidade: string; quantidade: number; custoUnitario: number; precoUnitario: number };
type Linha = { id: string; paiId: string | null; nivel: NivelPlanilha; codigo: string; descricao: string; servico: Servico | null; precoTotal: number };
type Planilha = { precoTotal: number; linhas: Linha[] };

const qtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
const profundidade = (codigo: string) => codigo.split('.').length - 1;

export function PlanilhaOrcamentaria({ obra, itens, setErro }: { obra: Obra; itens: ItemObra[]; setErro: (m: string) => void }) {
  const [p, setP] = useState<Planilha | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  // Cópia local dos itens: a leitura do projeto pode incluir composições novas na obra antes do próximo carregamento da tela.
  const [itensAtuais, setItensAtuais] = useState<ItemObra[]>(itens);
  useEffect(() => setItensAtuais(itens), [itens]);
  const servicos = itensAtuais.filter((i) => i.tipo === 'composicao');

  const carregar = () =>
    api<Planilha>(`/eng/obras/${obra.id}/planilha`)
      .then(setP)
      .catch((e) => setErro((e as Error).message));
  useEffect(() => {
    carregar();
  }, [obra.id]);

  const [movendo, setMovendo] = useState(false);
  // Setas: a linha troca de lugar com a irmã de cima ou de baixo (mesma linha acima dela), levando as de baixo junto.
  async function mover(l: Linha, direcao: 'cima' | 'baixo') {
    setErro('');
    setMovendo(true);
    try {
      await api(`/eng/obras/${obra.id}/planilha/${l.id}/mover`, { corpo: { direcao } });
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setMovendo(false);
    }
  }
  const irmas = (l: Linha) => (p?.linhas ?? []).filter((x) => x.paiId === l.paiId);

  async function excluir(l: Linha) {
    setErro('');
    if (!window.confirm(`Excluir a linha ${l.codigo} · ${l.descricao}?${l.servico ? ' O serviço lançado nela sai junto.' : ''}`)) return;
    try {
      await api(`/eng/obras/${obra.id}/planilha/${l.id}`, { metodo: 'DELETE' });
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  if (!p) return <p className="muted">Carregando…</p>;
  return (
    <>
      <div className="card" style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div>Preço de venda: <b>{formatarMoeda(p.precoTotal)}</b></div>
        <div className="small muted" style={{ marginLeft: 'auto', alignSelf: 'center' }}>
          <Link to={`/eng/relatorios?obra=${obra.id}`}>Emitir relatório do orçamento</Link>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="tabela planilha-orc">
          <thead>
            <tr>
              <th>Item</th>
              <th>Nível</th>
              <th style={{ minWidth: 220 }}>Descrição</th>
              <th>Serviço</th>
              <th>Unid.</th>
              <th className="num">Quant.</th>
              <th className="num">Preço unit.</th>
              <th className="num">Preço total</th>
              <th className="nao-imprimir"><span style={{ position: 'absolute', left: -9999 }}>Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {p.linhas.length === 0 && (
              <tr>
                <td colSpan={9} className="muted">Planilha vazia. Comece pela linha de Obra ou de Etapa, logo abaixo.</td>
              </tr>
            )}
            {p.linhas.map((l) =>
              editando === l.id ? (
                <EditarLinha key={l.id} obraId={obra.id} linha={l} servicos={servicos} setErro={setErro} aoFechar={async (salvou) => { setEditando(null); if (salvou) await carregar(); }} />
              ) : (
                <tr key={l.id} className={`nivel-${l.nivel}`} style={l.nivel !== 'tarefa' ? { fontWeight: l.nivel === 'obra' ? 700 : 600, background: 'var(--surface-sunken)' } : undefined}>
                  <td className="mono">{l.codigo}</td>
                  <td className="small">{ROTULO[l.nivel]}</td>
                  <td className="descricao-linha" style={{ paddingLeft: 12 + profundidade(l.codigo) * 16 }}>{l.descricao}</td>
                  <td className="mono small">{l.servico?.codigo ?? ''}</td>
                  <td>{l.servico?.unidade ?? ''}</td>
                  <td className="num">{l.servico ? qtd(l.servico.quantidade) : ''}</td>
                  <td className="num">{l.servico ? formatarMoeda(l.servico.precoUnitario) : ''}</td>
                  <td className="num">{l.servico || l.nivel !== 'tarefa' ? formatarMoeda(l.precoTotal) : <span className="small muted">sem serviço</span>}</td>
                  <td className="acoes-celula nao-imprimir">
                    <div className="acoes-linha">
                    <span className="setas" style={{ display: 'inline-flex', gap: 2, marginRight: 4 }}>
                      <button className="btn btn-link" type="button" title="Subir (leva junto as linhas de baixo)" aria-label={`Subir ${l.codigo}`} disabled={movendo || irmas(l)[0]?.id === l.id} onClick={() => mover(l, 'cima')} style={{ padding: '0 6px' }}>▲</button>
                      <button className="btn btn-link" type="button" title="Descer (leva junto as linhas de baixo)" aria-label={`Descer ${l.codigo}`} disabled={movendo || irmas(l).at(-1)?.id === l.id} onClick={() => mover(l, 'baixo')} style={{ padding: '0 6px' }}>▼</button>
                    </span>
                    <button className="btn btn-link" type="button" onClick={() => setEditando(l.id)}>Editar</button>
                    <button className="btn btn-link" type="button" onClick={() => excluir(l)}>Excluir</button>
                    </div>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      <LeituraProjeto obra={obra} linhas={p.linhas} itens={itensAtuais} setErro={setErro} aoLancar={carregar} aoMudarItens={setItensAtuais} />
      <NovaLinha obraId={obra.id} linhas={p.linhas} servicos={servicos} setErro={setErro} aoIncluir={carregar} />
    </>
  );
}

/** Edição na própria linha: descrição sempre; na Tarefa, serviço e quantidade. */
function EditarLinha({ obraId, linha, servicos, setErro, aoFechar }: { obraId: string; linha: Linha; servicos: ItemObra[]; setErro: (m: string) => void; aoFechar: (salvou: boolean) => void }) {
  const [descricao, setDescricao] = useState(linha.descricao);
  const [itemId, setItemId] = useState(linha.servico?.itemId ?? '');
  const [quantidade, setQuantidade] = useState(linha.servico ? String(linha.servico.quantidade).replace('.', ',') : '');
  const [nivel, setNivel] = useState<NivelPlanilha>(linha.nivel);
  const tarefa = nivel === 'tarefa';

  async function salvar(e?: FormEvent) {
    e?.preventDefault();
    setErro('');
    const corpo: Record<string, unknown> = { descricao: descricao.trim() };
    if (nivel !== linha.nivel) corpo.nivel = nivel;
    if (!tarefa && linha.servico) corpo.itemId = null;
    if (tarefa) {
      if (itemId) {
        const q = lerNumero(quantidade);
        if (q === null || q <= 0) return setErro('Informe a quantidade do serviço.');
        corpo.itemId = itemId;
        corpo.quantidade = q;
      } else if (linha.servico) {
        corpo.itemId = null;
      }
    }
    try {
      await api(`/eng/obras/${obraId}/planilha/${linha.id}`, { metodo: 'PUT', corpo });
      aoFechar(true);
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  return (
    <tr style={{ background: 'var(--surface-sunken)' }}>
      <td className="mono">{linha.codigo}</td>
      <td>
        <select aria-label="Nível" value={nivel} onChange={(e) => setNivel(e.target.value as NivelPlanilha)}>
          {NIVEIS.map((n) => <option key={n} value={n}>{POSICAO[n]} · {ROTULO[n]}</option>)}
        </select>
        {nivel !== 'tarefa' && linha.servico && <div className="small tom-aviso">O serviço sai da linha.</div>}
      </td>
      <td>
        <input aria-label="Descrição" maxLength={200} value={descricao} onChange={(e) => setDescricao(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && salvar()} style={{ width: '100%', minWidth: 200 }} autoFocus />
      </td>
      <td colSpan={2}>
        {tarefa ? (
          <div style={{ maxWidth: 360 }}>
            <SeletorBusca id="ed-servico" label="Serviço" semRotulo opcoes={servicos.map((s) => ({ id: s.id, rotulo: `${s.codigo} · ${s.descricao}` }))} valor={itemId} onChange={setItemId} vazio="Sem serviço" />
          </div>
        ) : null}
      </td>
      <td className="num">
        {tarefa && itemId ? <input aria-label="Quantidade" inputMode="decimal" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} style={{ width: 90 }} /> : null}
      </td>
      <td colSpan={2} />
      <td className="acoes-celula">
        <div className="acoes-linha">
          <button className="btn btn-primario" type="button" onClick={() => salvar()} disabled={descricao.trim().length < 2}>Salvar</button>
          <button className="btn" type="button" onClick={() => aoFechar(false)}>Cancelar</button>
        </div>
      </td>
    </tr>
  );
}

type CandidataProjeto = { id: string; tabelaId: string; tabela: string; fonte: string; codigo: string; descricao: string; unidade: string; pontos: number };
type LidoProjeto = { servico: string; descricao: string; unidade: string; quantidade: number; origem: string; candidatas: CandidataProjeto[] };
type EscolhaProjeto = { marcado: boolean; composicaoId: string; quantidade: string; descricao: string };

const ROTULO_SERVICO: Record<string, string> = { forma: 'Forma', armacao: 'Armação', concreto: 'Concreto', outro: 'Outro' };

function lerArquivoBase64(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result).split(',')[1] ?? '');
    leitor.onerror = () => reject(new Error('Não consegui ler o arquivo.'));
    leitor.readAsDataURL(arquivo);
  });
}

/**
 * Leitura do projeto por IA, dentro de EAP e orçamento. A IA lista os quantitativos do PDF e sugere composições
 * já cadastradas nas tabelas. Nada entra na planilha antes de o usuário marcar e confirmar.
 */
function LeituraProjeto({ obra, linhas, itens, setErro, aoLancar, aoMudarItens }: { obra: Obra; linhas: Linha[]; itens: ItemObra[]; setErro: (m: string) => void; aoLancar: () => Promise<void>; aoMudarItens: (novos: ItemObra[]) => void }) {
  const [aberto, setAberto] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [analisando, setAnalisando] = useState(false);
  const [lancando, setLancando] = useState(false);
  const [lidos, setLidos] = useState<LidoProjeto[] | null>(null);
  const [pendencias, setPendencias] = useState<string[]>([]);
  const [escolhas, setEscolhas] = useState<EscolhaProjeto[]>([]);
  const [pai, setPai] = useState('auto');
  const [feito, setFeito] = useState('');

  // As mesmas posições da linha "Adicionar linha": etapa, subetapa ou obra.
  const pais = linhas.filter((l) => POSICAO[l.nivel] < POSICAO.tarefa);

  function atualizar(i: number, campo: Partial<EscolhaProjeto>) {
    setEscolhas((es) => es.map((e, k) => (k === i ? { ...e, ...campo } : e)));
  }

  async function analisar() {
    if (!arquivo) return setErro('Escolha o PDF do projeto.');
    setErro('');
    setFeito('');
    setAnalisando(true);
    setLidos(null);
    try {
      const base64 = await lerArquivoBase64(arquivo);
      const r = await api<{ itens: LidoProjeto[]; pendencias: string[] }>(`/eng/obras/${obra.id}/leitura-projeto`, { corpo: { arquivo: base64, nome: arquivo.name } });
      setLidos(r.itens);
      setPendencias(r.pendencias);
      setEscolhas(
        r.itens.map((x) => ({
          marcado: x.candidatas.length > 0,
          composicaoId: x.candidatas[0]?.id ?? '',
          quantidade: x.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 4 }),
          descricao: x.descricao,
        })),
      );
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAnalisando(false);
    }
  }

  async function lancar() {
    if (!lidos) return;
    const escolhidas = lidos.flatMap((x, i) => {
      const e = escolhas[i];
      const cand = x.candidatas.find((c) => c.id === e?.composicaoId);
      const q = lerNumero(e?.quantidade ?? '');
      return e?.marcado && cand && q !== null && q > 0 ? [{ cand, quantidade: q, descricao: e.descricao.trim() }] : [];
    });
    if (escolhidas.length === 0) return setErro('Marque ao menos uma linha com serviço e quantidade.');
    setErro('');
    setFeito('');
    setLancando(true);
    let atuais = itens;
    let feitas = 0;
    let falha = '';
    try {
      for (const { cand, quantidade, descricao } of escolhidas) {
        // Inclui a composição na obra só se ela ainda não estiver lá (a importação ignora o que já existe).
        let item = atuais.find((i) => i.tipo === 'composicao' && i.codigo === cand.codigo);
        if (!item) {
          await api(`/eng/obras/${obra.id}/importar`, { corpo: { tabelaId: cand.tabelaId, composicaoIds: [cand.id] } });
          atuais = (await api<{ itens: ItemObra[] }>(`/eng/obras/${obra.id}/itens`)).itens;
          item = atuais.find((i) => i.tipo === 'composicao' && i.codigo === cand.codigo);
        }
        if (!item) throw new Error(`Não consegui incluir o serviço ${cand.codigo} na obra.`);
        const corpo: Record<string, unknown> = { nivel: 'tarefa', descricao: (descricao || item.descricao).slice(0, 200), itemId: item.id, quantidade };
        if (pai === 'raiz') corpo.paiId = null;
        else if (pai !== 'auto') corpo.paiId = pai;
        await api(`/eng/obras/${obra.id}/planilha`, { corpo });
        feitas++;
      }
    } catch (e) {
      falha = (e as Error).message;
    } finally {
      aoMudarItens(atuais);
      await aoLancar();
      setLancando(false);
      if (falha) setErro(`${feitas} de ${escolhidas.length} linhas lançadas. ${falha}`);
      else {
        setFeito(`${feitas} ${feitas === 1 ? 'linha lançada' : 'linhas lançadas'} na planilha.`);
        setLidos(null);
      }
    }
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <div className="acoes" style={{ marginBottom: 8 }}>
        <button className="btn" type="button" onClick={() => setAberto(!aberto)} aria-expanded={aberto}>
          {aberto ? 'Fechar leitura do projeto' : 'Ler projeto com IA'}
        </button>
      </div>
      {aberto && (
        <div className="card form">
          <h2 style={{ margin: 0 }}>Leitura do projeto</h2>
          <p className="ajuda" style={{ margin: 0 }}>
            A IA lista os quantitativos de forma, armação e concreto do PDF. As composições sugeridas são só as já cadastradas nas suas tabelas. Nada entra na planilha antes da sua confirmação.
          </p>
          <div className="campo">
            <label htmlFor="lp-arquivo">Projeto estrutural (PDF)</label>
            <input
              id="lp-arquivo"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => {
                setArquivo(e.target.files?.[0] ?? null);
                setLidos(null);
                setFeito('');
              }}
            />
          </div>
          <div className="acoes">
            <button className="btn btn-primario" type="button" onClick={analisar} disabled={!arquivo || analisando}>
              {analisando ? 'Lendo o projeto…' : 'Ler com IA'}
            </button>
          </div>
          {feito && <p className="ajuda" role="status" style={{ margin: 0 }}>{feito}</p>}
          {lidos && lidos.length === 0 && <p className="muted" style={{ margin: 0 }}>Não encontrei quantitativos de forma, armação ou concreto neste arquivo.</p>}
          {lidos && lidos.length > 0 && (
            <>
              <div style={{ overflowX: 'auto' }}>
                <table className="tabela">
                  <thead>
                    <tr>
                      <th aria-label="Lançar" />
                      <th>Serviço</th>
                      <th style={{ minWidth: 200 }}>Descrição</th>
                      <th className="num">Quant.</th>
                      <th>Unid.</th>
                      <th style={{ minWidth: 260 }}>Composição sugerida</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lidos.map((x, i) => {
                      const e = escolhas[i];
                      return (
                        <tr key={i}>
                          <td>
                            <input type="checkbox" aria-label={`Lançar ${x.descricao}`} checked={!!e?.marcado} onChange={(ev) => atualizar(i, { marcado: ev.target.checked })} />
                          </td>
                          <td>{ROTULO_SERVICO[x.servico] ?? 'Outro'}</td>
                          <td>
                            <input aria-label="Descrição da linha" value={e?.descricao ?? ''} maxLength={200} onChange={(ev) => atualizar(i, { descricao: ev.target.value })} style={{ width: '100%' }} />
                            {x.origem && <div className="ajuda small">{x.origem}</div>}
                          </td>
                          <td className="num">
                            <input aria-label="Quantidade" inputMode="decimal" value={e?.quantidade ?? ''} onChange={(ev) => atualizar(i, { quantidade: ev.target.value })} style={{ width: 90 }} />
                          </td>
                          <td>{x.unidade}</td>
                          <td>
                            {x.candidatas.length === 0 ? (
                              <span className="small muted">Nenhuma composição cadastrada para este serviço</span>
                            ) : (
                              <select aria-label="Composição sugerida" value={e?.composicaoId ?? ''} onChange={(ev) => atualizar(i, { composicaoId: ev.target.value })} style={{ maxWidth: 360 }}>
                                {x.candidatas.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.codigo} · {c.descricao} ({c.unidade}) · {c.tabela}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {pendencias.length > 0 && (
                <div className="ajuda">
                  <b>Não consegui ler pela IA:</b>
                  <ul style={{ margin: '4px 0 0' }}>
                    {pendencias.map((p, k) => (
                      <li key={k}>{p}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="campo">
                <label htmlFor="lp-pai">Entra dentro de</label>
                <select id="lp-pai" value={pai} onChange={(ev) => setPai(ev.target.value)}>
                  <option value="auto">Automático</option>
                  <option value="raiz">Primeiro nível (sem linha acima)</option>
                  {pais.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.codigo} · {ROTULO[l.nivel]} · {l.descricao}
                    </option>
                  ))}
                </select>
              </div>
              <div className="acoes">
                <button className="btn btn-primario" type="button" onClick={lancar} disabled={lancando}>
                  {lancando ? 'Lançando…' : 'Lançar marcadas no orçamento'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Botão "Adicionar linha" abaixo da planilha: nível, onde entra, descrição e, na Tarefa, o serviço da obra. */
function NovaLinha({ obraId, linhas, servicos, setErro, aoIncluir }: { obraId: string; linhas: Linha[]; servicos: ItemObra[]; setErro: (m: string) => void; aoIncluir: () => void }) {
  const [nivel, setNivel] = useState<NivelPlanilha>(linhas.length ? 'tarefa' : 'obra');
  const [pai, setPai] = useState('auto');
  const [descricao, setDescricao] = useState('');
  const [itemId, setItemId] = useState('');
  const [quantidade, setQuantidade] = useState('');
  const [ocupado, setOcupado] = useState(false);

  // Onde a linha pode entrar: dentro de uma linha de nível acima (pode pular níveis) ou na raiz.
  const pais = linhas.filter((l) => POSICAO[l.nivel] < POSICAO[nivel]);
  const automatico = [...pais].pop();
  useEffect(() => {
    if (pai !== 'auto' && pai !== 'raiz' && !pais.some((l) => l.id === pai)) setPai('auto');
  }, [nivel, linhas.length]);

  function escolherServico(id: string) {
    setItemId(id);
    const s = servicos.find((x) => x.id === id);
    if (s && !descricao.trim()) setDescricao(s.descricao.slice(0, 200));
  }

  async function incluir(e: FormEvent) {
    e.preventDefault();
    setErro('');
    const corpo: Record<string, unknown> = { nivel, descricao: descricao.trim() };
    if (pai === 'raiz') corpo.paiId = null;
    else if (pai !== 'auto') corpo.paiId = pai;
    if (nivel === 'tarefa' && itemId) {
      const q = lerNumero(quantidade);
      if (q === null || q <= 0) return setErro('Informe a quantidade do serviço.');
      corpo.itemId = itemId;
      corpo.quantidade = q;
    }
    setOcupado(true);
    try {
      await api(`/eng/obras/${obraId}/planilha`, { corpo });
      setDescricao('');
      setItemId('');
      setQuantidade('');
      setPai('auto');
      aoIncluir();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const podeIncluir = descricao.trim().length >= 2 || (nivel === 'tarefa' && !!itemId);
  return (
    <form className="card form" onSubmit={incluir} aria-label="Adicionar linha">
      <h2 style={{ margin: 0 }}>Adicionar linha</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <div className="campo">
          <label htmlFor="pl-nivel">Nível</label>
          <select id="pl-nivel" value={nivel} onChange={(e) => setNivel(e.target.value as NivelPlanilha)}>
            {NIVEIS.map((n) => <option key={n} value={n}>{POSICAO[n]} · {ROTULO[n]}</option>)}
          </select>
        </div>
        <div className="campo" style={{ gridColumn: 'span 2' }}>
          <label htmlFor="pl-pai">Entra dentro de</label>
          <select id="pl-pai" value={pai} onChange={(e) => setPai(e.target.value)}>
            <option value="auto">{automatico ? `Automático: ${automatico.codigo} · ${automatico.descricao}` : 'Automático: no primeiro nível'}</option>
            <option value="raiz">Primeiro nível (sem linha acima)</option>
            {pais.map((l) => <option key={l.id} value={l.id}>{l.codigo} · {ROTULO[l.nivel]} · {l.descricao}</option>)}
          </select>
        </div>
        {nivel === 'tarefa' && (
          <>
            <SeletorBusca
              id="pl-servico"
              label="Serviço da obra"
              style={{ gridColumn: 'span 2' }}
              disabled={servicos.length === 0}
              opcoes={servicos.map((s) => ({ id: s.id, rotulo: `${s.codigo} · ${s.descricao} (${s.unidade})` }))}
              valor={itemId}
              onChange={escolherServico}
              vazio={servicos.length === 0 ? 'Nenhum serviço na obra' : 'Sem serviço (só a descrição)'}
              resultadosVisiveis
            >
              <span className="ajuda">
                Só os serviços incluídos na obra. <Link to={`/eng/servicos?obra=${obraId}`}>Incluir serviços</Link>
              </span>
            </SeletorBusca>
            {itemId && (
              <div className="campo">
                <label htmlFor="pl-qtd">Quantidade ({servicos.find((s) => s.id === itemId)?.unidade})</label>
                <input id="pl-qtd" inputMode="decimal" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
              </div>
            )}
          </>
        )}
        <div className="campo" style={{ gridColumn: '1 / -1' }}>
          <label htmlFor="pl-desc">Descrição</label>
          <input id="pl-desc" maxLength={200} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder={nivel === 'tarefa' ? 'Escolha o serviço ou descreva a tarefa' : `Nome da ${ROTULO[nivel]}`} />
          {nivel === 'tarefa' && itemId && <span className="ajuda">A descrição começa com a do serviço e pode ser mudada.</span>}
        </div>
      </div>
      <div className="acoes">
        <button className="btn btn-primario" type="submit" disabled={ocupado || !podeIncluir}>{ocupado ? 'Adicionando…' : '+ Adicionar linha'}</button>
      </div>
    </form>
  );
}
