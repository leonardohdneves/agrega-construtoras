// Engenharia · Planilha orçamentária: EAP e orçamento construídos juntos.
// Cada linha tem um nível (1 Obra, 2 Etapa, 3 Sub Etapa, 4 Tarefa) e uma descrição editável;
// a Tarefa recebe um serviço da obra com quantidade. As linhas acima somam o que está abaixo delas.
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, formatarMoeda, lerNumero } from '../api';
import type { ItemObra, Obra } from './EngObras';

export type NivelPlanilha = 'obra' | 'etapa' | 'subetapa' | 'tarefa';
export const NIVEIS: NivelPlanilha[] = ['obra', 'etapa', 'subetapa', 'tarefa'];
export const ROTULO: Record<NivelPlanilha, string> = { obra: 'Obra', etapa: 'Etapa', subetapa: 'Sub Etapa', tarefa: 'Tarefa' };
const POSICAO: Record<NivelPlanilha, number> = { obra: 1, etapa: 2, subetapa: 3, tarefa: 4 };

type Servico = { linhaId: string; itemId: string; codigo: string; descricaoServico: string; unidade: string; quantidade: number; custoUnitario: number };
type Linha = { id: string; paiId: string | null; nivel: NivelPlanilha; codigo: string; descricao: string; servico: Servico | null; custoTotal: number };
type Planilha = { bdiPercentual: number; custoTotal: number; bdiValor: number; precoTotal: number; linhas: Linha[] };

const qtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
const profundidade = (codigo: string) => codigo.split('.').length - 1;

export function PlanilhaOrcamentaria({ obra, itens, setErro }: { obra: Obra; itens: ItemObra[]; setErro: (m: string) => void }) {
  const [p, setP] = useState<Planilha | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const servicos = itens.filter((i) => i.tipo === 'composicao');

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
        <div>Custo direto: <b>{formatarMoeda(p.custoTotal)}</b></div>
        <div>BDI ({String(p.bdiPercentual).replace('.', ',')}%): <b>{formatarMoeda(p.bdiValor)}</b></div>
        <div>Preço total: <b>{formatarMoeda(p.precoTotal)}</b></div>
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
              <th className="num">Custo unit.</th>
              <th className="num">Custo total</th>
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
                  <td className="num">{l.servico ? formatarMoeda(l.servico.custoUnitario) : ''}</td>
                  <td className="num">{l.servico || l.nivel !== 'tarefa' ? formatarMoeda(l.custoTotal) : <span className="small muted">sem serviço</span>}</td>
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
        <input aria-label="Descrição" value={descricao} onChange={(e) => setDescricao(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && salvar()} style={{ width: '100%', minWidth: 200 }} autoFocus />
      </td>
      <td colSpan={2}>
        {tarefa ? (
          <select aria-label="Serviço" value={itemId} onChange={(e) => setItemId(e.target.value)} style={{ maxWidth: 260 }}>
            <option value="">Sem serviço</option>
            {servicos.map((s) => <option key={s.id} value={s.id}>{s.codigo} · {s.descricao}</option>)}
          </select>
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
    if (s && !descricao.trim()) setDescricao(s.descricao);
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
            <div className="campo" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="pl-servico">Serviço da obra</label>
              <select id="pl-servico" value={itemId} onChange={(e) => escolherServico(e.target.value)} disabled={servicos.length === 0}>
                <option value="">{servicos.length === 0 ? 'Nenhum serviço na obra' : 'Sem serviço (só a descrição)'}</option>
                {servicos.map((s) => <option key={s.id} value={s.id}>{s.codigo} · {s.descricao} ({s.unidade})</option>)}
              </select>
              <span className="ajuda">
                Só os serviços incluídos na obra. <Link to={`/eng/servicos?obra=${obraId}`}>Incluir serviços</Link>
              </span>
            </div>
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
          <input id="pl-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder={nivel === 'tarefa' ? 'Escolha o serviço ou descreva a tarefa' : `Nome da ${ROTULO[nivel]}`} />
          {nivel === 'tarefa' && itemId && <span className="ajuda">A descrição começa com a do serviço e pode ser mudada.</span>}
        </div>
      </div>
      <div className="acoes">
        <button className="btn btn-primario" type="submit" disabled={ocupado || !podeIncluir}>{ocupado ? 'Adicionando…' : '+ Adicionar linha'}</button>
      </div>
    </form>
  );
}
