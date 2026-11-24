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
export const POSICAO: Record<NivelPlanilha, number> = { obra: 1, etapa: 2, subetapa: 3, tarefa: 4 };

type Servico = { linhaId: string; itemId: string; codigo: string; descricaoServico: string; unidade: string; quantidade: number; custoUnitario: number; precoUnitario: number };
export type Linha = { id: string; paiId: string | null; nivel: NivelPlanilha; codigo: string; descricao: string; servico: Servico | null; precoTotal: number };
type Planilha = { precoTotal: number; linhas: Linha[] };

const qtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
const profundidade = (codigo: string) => codigo.split('.').length - 1;

/** Uma linha aparece na EAP se nenhum antepassado (etapa ou subetapa) estiver recolhido. */
function visivelNaEap(l: Linha, linhas: Linha[], recolhidas: Set<string>): boolean {
  const porId = new Map(linhas.map((x) => [x.id, x]));
  for (let pai = l.paiId; pai; pai = porId.get(pai)?.paiId ?? null) if (recolhidas.has(pai)) return false;
  return true;
}

export function PlanilhaOrcamentaria({ obra, itens, setErro }: { obra: Obra; itens: ItemObra[]; setErro: (m: string) => void }) {
  const [p, setP] = useState<Planilha | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  // Cópia local dos itens: a leitura do projeto pode incluir composições novas na obra antes do próximo carregamento da tela.
  const [itensAtuais, setItensAtuais] = useState<ItemObra[]>(itens);
  useEffect(() => setItensAtuais(itens), [itens]);
  const servicos = itensAtuais.filter((i) => i.tipo === 'composicao');
  // Etapas e subetapas recolhidas: as linhas abaixo delas somem da tabela até expandir de novo.
  const [recolhidas, setRecolhidas] = useState<Set<string>>(new Set());
  const alternarRecolhida = (id: string) => setRecolhidas((atual) => {
    const proxima = new Set(atual);
    if (proxima.has(id)) proxima.delete(id);
    else proxima.add(id);
    return proxima;
  });

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

  // Linhas marcadas para copiar ou excluir de uma vez (só as que aparecem na tela).
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const [lote, setLote] = useState(false);
  const visiveis = p ? p.linhas.filter((l) => visivelNaEap(l, p.linhas, recolhidas)) : [];
  const todasMarcadas = visiveis.length > 0 && visiveis.every((l) => marcadas.has(l.id));

  function alternarMarcada(id: string) {
    setMarcadas((atual) => {
      const proxima = new Set(atual);
      if (proxima.has(id)) proxima.delete(id);
      else proxima.add(id);
      return proxima;
    });
  }

  async function operarLote(acao: 'copiar-lote' | 'excluir-lote') {
    setErro('');
    setLote(true);
    try {
      await api(`/eng/obras/${obra.id}/planilha/${acao}`, { corpo: { ids: [...marcadas] } });
      setMarcadas(new Set());
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setLote(false);
    }
  }

  function excluirMarcadas() {
    const n = marcadas.size;
    if (!window.confirm(`Excluir ${n} ${n === 1 ? 'linha marcada' : 'linhas marcadas'}? O que estiver abaixo delas também sai.`)) return;
    void operarLote('excluir-lote');
  }

  if (!p) return <p className="muted">Carregando…</p>;
  return (
    <>
      <div className="card" style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div>Preço de venda: <b>{formatarMoeda(p.precoTotal)}</b></div>
        <div className="small muted" style={{ marginLeft: 'auto', alignSelf: 'center' }}>
          <Link to={`/eng/relatorios?obra=${obra.id}`}>Emitir relatório do orçamento</Link>
          {' · '}
          <Link to={`/eng/importar-quantitativos?obra=${obra.id}`}>Importar quantitativos</Link>
        </div>
      </div>

      {marcadas.size > 0 && (
        <div className="card nao-imprimir" role="region" aria-label="Linhas marcadas" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '10px 16px' }}>
          <b>{marcadas.size} {marcadas.size === 1 ? 'linha marcada' : 'linhas marcadas'}</b>
          <button className="btn" type="button" onClick={() => void operarLote('copiar-lote')} disabled={lote}>Copiar</button>
          <button className="btn" type="button" onClick={excluirMarcadas} disabled={lote}>Excluir</button>
          <button className="btn btn-link" type="button" onClick={() => setMarcadas(new Set())} disabled={lote}>Limpar seleção</button>
        </div>
      )}
      <div className="card planilha-eap-rolagem" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="tabela planilha-orc">
          <thead>
            <tr>
              <th className="nao-imprimir" style={{ width: 36 }}>
                <input type="checkbox" aria-label="Marcar todas as linhas visíveis" checked={todasMarcadas} onChange={() => setMarcadas(todasMarcadas ? new Set() : new Set(visiveis.map((l) => l.id)))} />
              </th>
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
                <td colSpan={10} className="muted">Planilha vazia. Comece pela linha de Obra ou de Etapa, logo abaixo.</td>
              </tr>
            )}
            {p.linhas.filter((l) => visivelNaEap(l, p.linhas, recolhidas)).map((l) =>
              editando === l.id ? (
                <EditarLinha key={l.id} obraId={obra.id} linha={l} linhas={p.linhas} servicos={servicos} setErro={setErro} aoFechar={async (salvou) => { setEditando(null); if (salvou) await carregar(); }} />
              ) : (
                <tr key={l.id} className={`nivel-${l.nivel}`} style={l.nivel !== 'tarefa' ? { fontWeight: l.nivel === 'obra' ? 700 : 600, background: 'var(--surface-sunken)' } : undefined}>
                  <td className="nao-imprimir"><input type="checkbox" aria-label={`Marcar ${l.codigo}`} checked={marcadas.has(l.id)} onChange={() => alternarMarcada(l.id)} /></td>
                  <td className="mono">{l.codigo}</td>
                  <td className="small">{ROTULO[l.nivel]}</td>
                  <td className="descricao-linha" style={{ paddingLeft: 12 + profundidade(l.codigo) * 16 }}>
                    {(l.nivel === 'etapa' || l.nivel === 'subetapa') && p.linhas.some((x) => x.paiId === l.id) && (
                      <button
                        className="btn btn-link"
                        type="button"
                        aria-expanded={!recolhidas.has(l.id)}
                        aria-label={`${recolhidas.has(l.id) ? 'Expandir' : 'Recolher'} ${l.codigo} ${l.descricao}`}
                        title={recolhidas.has(l.id) ? 'Expandir' : 'Recolher'}
                        onClick={() => alternarRecolhida(l.id)}
                        style={{ padding: '0 6px 0 0', width: 22 }}
                      >
                        {recolhidas.has(l.id) ? '▸' : '▾'}
                      </button>
                    )}
                    {l.descricao}
                  </td>
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

      <NovaLinha obraId={obra.id} linhas={p.linhas} servicos={servicos} setErro={setErro} aoIncluir={carregar} />

    </>
  );
}

/** Edição na própria linha: descrição sempre; na Tarefa, serviço e quantidade. */
/** Linhas acima desta (o pai, o pai do pai…), do mais próximo para a raiz. */
function ancestrais(linhas: Linha[], id: string | null): Linha[] {
  const porId = new Map(linhas.map((l) => [l.id, l]));
  const saida: Linha[] = [];
  for (let atual = id; atual; atual = porId.get(atual)?.paiId ?? null) {
    const l = porId.get(atual);
    if (!l) break;
    saida.push(l);
  }
  return saida;
}

/** Pai que a linha pode ter num certo nível: o mais próximo acima dela que seja de nível mais alto. Null é a raiz. */
function paiPermitido(linhas: Linha[], paiId: string | null, nivel: NivelPlanilha): string | null {
  return ancestrais(linhas, paiId).find((a) => POSICAO[a.nivel] < POSICAO[nivel])?.id ?? null;
}

/** Edição na própria linha: descrição, nível, em qual linha de cima ela fica (mover) e, na Tarefa, serviço e quantidade. */
function EditarLinha({ obraId, linha, linhas, servicos, setErro, aoFechar }: { obraId: string; linha: Linha; linhas: Linha[]; servicos: ItemObra[]; setErro: (m: string) => void; aoFechar: (salvou: boolean) => void }) {
  const [descricao, setDescricao] = useState(linha.descricao);
  const [itemId, setItemId] = useState(linha.servico?.itemId ?? '');
  const [quantidade, setQuantidade] = useState(linha.servico ? String(linha.servico.quantidade).replace('.', ',') : '');
  const [nivel, setNivel] = useState<NivelPlanilha>(linha.nivel);
  const [pai, setPai] = useState<string>(linha.paiId ?? 'raiz');
  const [erroLinha, setErroLinha] = useState('');
  const tarefa = nivel === 'tarefa';
  // Onde a linha pode ficar: linhas de nível mais alto que o novo nível, fora dela e do que está abaixo dela.
  const destinos = linhas.filter((d) => d.id !== linha.id && POSICAO[d.nivel] < POSICAO[nivel] && !ancestrais(linhas, d.id).some((a) => a.id === linha.id));

  function mudarNivel(novo: NivelPlanilha) {
    setNivel(novo);
    setErroLinha('');
    setPai(paiPermitido(linhas, pai === 'raiz' ? null : pai, novo) ?? 'raiz');
  }

  async function salvar(e?: FormEvent) {
    e?.preventDefault();
    setErro('');
    setErroLinha('');
    const novoPai = pai === 'raiz' ? null : pai;
    const corpo: Record<string, unknown> = { descricao: descricao.trim() };
    if (nivel !== linha.nivel) corpo.nivel = nivel;
    if (novoPai !== linha.paiId) corpo.paiId = novoPai;
    if (!tarefa && linha.servico) corpo.itemId = null;
    if (tarefa) {
      if (itemId) {
        const q = lerNumero(quantidade);
        if (q === null || q <= 0) return setErroLinha('Informe a quantidade do serviço.');
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
      setErroLinha((err as Error).message);
    }
  }

  return (
    <tr style={{ background: 'var(--surface-sunken)' }}>
      <td />
      <td className="mono">{linha.codigo}</td>
      <td>
        <select aria-label="Nível" value={nivel} onChange={(e) => mudarNivel(e.target.value as NivelPlanilha)}>
          {NIVEIS.map((n) => <option key={n} value={n}>{POSICAO[n]} · {ROTULO[n]}</option>)}
        </select>
        <div style={{ marginTop: 6 }}>
          <label htmlFor="ed-pai" className="small muted">Dentro de </label>
          <select id="ed-pai" aria-label="Dentro de" value={pai} onChange={(e) => setPai(e.target.value)} style={{ maxWidth: 260 }}>
            <option value="raiz">Raiz (sem linha acima)</option>
            {destinos.map((d) => <option key={d.id} value={d.id}>{d.codigo} · {ROTULO[d.nivel]} · {d.descricao}</option>)}
          </select>
        </div>
        {nivel !== 'tarefa' && linha.servico && <div className="small tom-aviso">O serviço sai da linha.</div>}
      </td>
      <td>
        <input aria-label="Descrição" maxLength={200} value={descricao} onChange={(e) => setDescricao(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && salvar()} style={{ width: '100%', minWidth: 200 }} autoFocus />
        {erroLinha && <div className="alerta alerta-erro small" role="alert" style={{ marginTop: 6 }}>{erroLinha}</div>}
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
