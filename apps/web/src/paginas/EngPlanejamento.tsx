// Engenharia · Planejamento em abas: Planejamento (atividades), Gantt, Equipes necessárias, Materiais necessários e Equipamentos.
// A estrutura é a EAP do orçamento: etapas e subetapas são resumos (expansíveis) e as tarefas são as atividades.
// Cada aba tem botão de impressão.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, lerNumero } from '../api';
import { SecaoObra } from './EngSecoes';
import { ROTULO_NIVEL, type No } from './EngObras';
import { dataBr, diasEntre, mesesEntre, montarLinhas, somarDias, type Atividade } from './arvorePlanejamento';

import { ComprasView, EquipesView, GRANULARIDADES, type ComprasRel, type EquipesRel, type Gran } from './EngRelatorios';

type FormAtividade = { descricaoResumida: string; descricao: string; eapNoId: string; inicio: string; duracaoDias: string; predecessoraId: string };
const VAZIO: FormAtividade = { descricaoResumida: '', descricao: '', eapNoId: '', inicio: '', duracaoDias: '', predecessoraId: '' };
const idDe = (n: number | null | undefined) => (n ? `#${n}` : '—');

const ABAS_PLANEJAMENTO = [
  { id: 'planejamento', texto: 'Planejamento' },
  { id: 'gantt', texto: 'Gantt' },
  { id: 'equipes', texto: 'Equipes necessárias' },
  { id: 'materiais', texto: 'Materiais necessários' },
  { id: 'equipamentos', texto: 'Equipamentos' },
] as const;
type AbaPlanejamento = (typeof ABAS_PLANEJAMENTO)[number]['id'];

export function EngPlanejamento() {
  return (
    <SecaoObra titulo="Planejamento" ajuda="As atividades seguem a EAP do orçamento: etapas e subetapas agrupam as tarefas e podem ser expandidas ou recolhidas. Sem predecessora, a atividade começa na data informada; com predecessora, começa no dia seguinte ao fim dela, se esse dia for depois.">
      {(c) => <PlanejamentoAbas obraId={c.obra.id} nos={c.nos} setErro={c.setErro} />}
    </SecaoObra>
  );
}

function PlanejamentoAbas({ obraId, nos, setErro }: { obraId: string; nos: No[]; setErro: (m: string) => void }) {
  const [params, setParams] = useSearchParams();
  const aba: AbaPlanejamento = ABAS_PLANEJAMENTO.find((a) => a.id === params.get('aba'))?.id ?? 'planejamento';
  const [lista, setLista] = useState<Atividade[] | null>(null);
  const [fechados, setFechados] = useState<Set<string>>(() => new Set());

  async function carregar() {
    try {
      const r = await api<{ atividades: Atividade[] }>(`/eng/obras/${obraId}/planejamento`);
      setLista(r.atividades);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  useEffect(() => {
    setLista(null);
    setFechados(new Set());
    carregar();
  }, [obraId]);

  function trocarAba(id: AbaPlanejamento) {
    const proximo = new URLSearchParams(params);
    proximo.set('aba', id);
    setParams(proximo, { replace: true });
  }

  return (
    <>
      <div className="abas" role="tablist" aria-label="Planejamento">
        {ABAS_PLANEJAMENTO.map((a) => (
          <button key={a.id} type="button" role="tab" aria-selected={aba === a.id} className={aba === a.id ? 'ativa' : ''} onClick={() => trocarAba(a.id)}>
            {a.texto}
          </button>
        ))}
      </div>
      {lista === null ? (
        <p className="muted">Carregando…</p>
      ) : aba === 'planejamento' ? (
        <AbaAtividades obraId={obraId} nos={nos} lista={lista} recarregar={carregar} setErro={setErro} fechados={fechados} setFechados={setFechados} />
      ) : aba === 'gantt' ? (
        <AbaGantt nos={nos} lista={lista} fechados={fechados} setFechados={setFechados} />
      ) : aba === 'equipes' ? (
        <AbaRecursos obraId={obraId} tipo="equipes" setErro={setErro} />
      ) : aba === 'materiais' ? (
        <AbaRecursos obraId={obraId} tipo="materiais" setErro={setErro} />
      ) : (
        <AbaRecursos obraId={obraId} tipo="equipamentos" setErro={setErro} />
      )}
    </>
  );
}

/** Expandir e recolher etapas e subetapas. Usado pelas abas Planejamento e Gantt. */
function ControlesArvore({ nos, fechados, setFechados }: { nos: No[]; fechados: Set<string>; setFechados: (s: Set<string>) => void }) {
  const comFilhos = useMemo(() => [...new Set(nos.map((n) => n.paiId).filter((x): x is string => !!x))], [nos]);
  if (!comFilhos.length) return null;
  return (
    <div className="acoes nao-imprimir">
      <button className="btn" type="button" onClick={() => setFechados(new Set())}>Expandir tudo</button>
      <button className="btn" type="button" onClick={() => setFechados(new Set(comFilhos))}>Recolher tudo</button>
    </div>
  );
}

function BotaoImprimir() {
  return <button className="btn nao-imprimir" type="button" onClick={() => window.print()}>Imprimir</button>;
}

function AbaAtividades({ obraId, nos, lista, recarregar, setErro, fechados, setFechados }: {
  obraId: string; nos: No[]; lista: Atividade[]; recarregar: () => Promise<void>; setErro: (m: string) => void;
  fechados: Set<string>; setFechados: (s: Set<string>) => void;
}) {
  const [editando, setEditando] = useState<string | null>(null);
  const [d, setD] = useState<FormAtividade>(VAZIO);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState('');
  const linhas = useMemo(() => montarLinhas(nos, lista, fechados), [nos, lista, fechados]);
  const nomeDe = (id: string | null) => idDe(lista.find((a) => a.id === id)?.numero);
  // Só tarefas (nós sem filhos) recebem atividade. Etapas e subetapas são resumos.
  const comFilhos = useMemo(() => new Set(nos.map((n) => n.paiId).filter((x): x is string => !!x)), [nos]);
  const tarefas = nos.filter((n) => !comFilhos.has(n.id));

  function editar(a: Atividade) {
    setEditando(a.id);
    setD({ descricaoResumida: a.descricaoResumida, descricao: a.descricao, eapNoId: a.eapNoId ?? '', inicio: a.inicioInformado, duracaoDias: String(a.duracaoDias), predecessoraId: a.predecessoraId ?? '' });
  }

  function cancelar() {
    setEditando(null);
    setD(VAZIO);
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    const dias = lerNumero(d.duracaoDias);
    if (dias === null || dias < 1) return setErro('Informe a duração em dias (mínimo 1).');
    const resumida = d.descricaoResumida.trim();
    const corpo = {
      descricao: (d.descricao.trim() || resumida),
      descricaoResumida: resumida,
      eapNoId: d.eapNoId || null,
      inicio: d.inicio,
      duracaoDias: Math.round(dias),
      predecessoraId: d.predecessoraId || null,
    };
    setOcupado(true);
    try {
      if (editando) await api(`/eng/obras/${obraId}/planejamento/${editando}`, { metodo: 'PUT', corpo });
      else await api(`/eng/obras/${obraId}/planejamento`, { metodo: 'POST', corpo });
      cancelar();
      await recarregar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function gerarDaEap() {
    setErro('');
    setAviso('');
    setOcupado(true);
    try {
      const r = await api<{ criadas: number }>(`/eng/obras/${obraId}/planejamento/gerar-da-eap`, { metodo: 'POST' });
      setAviso(r.criadas ? `${r.criadas} tarefa(s) nova(s) criada(s) pela EAP. Ajuste início e duração; as demais atividades não foram alteradas.` : 'Nenhuma tarefa nova na EAP: o planejamento já está atualizado.');
      await recarregar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function excluir(a: Atividade) {
    setErro('');
    try {
      await api(`/eng/obras/${obraId}/planejamento/${a.id}`, { metodo: 'DELETE' });
      if (editando === a.id) cancelar();
      await recarregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  const alternar = (noId: string) => {
    const proximo = new Set(fechados);
    if (proximo.has(noId)) proximo.delete(noId);
    else proximo.add(noId);
    setFechados(proximo);
  };

  return (
    <>
      <div className="card">
        <div className="acoes" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Atividades</h2>
          <div className="acoes nao-imprimir">
            <button className="btn" type="button" onClick={gerarDaEap} disabled={ocupado || !nos.length} title="Cria uma atividade só para as tarefas da EAP que ainda não têm atividade. Etapas e subetapas não viram atividade.">Atualizar pela EAP</button>
            <BotaoImprimir />
          </div>
        </div>
        <ControlesArvore nos={nos} fechados={fechados} setFechados={setFechados} />
        {aviso && <p className="small muted" style={{ marginTop: 8 }}>{aviso}</p>}
        {!linhas.length ? (
          <p className="muted" style={{ margin: 0 }}>Nenhuma atividade ainda. Monte a EAP e o orçamento, depois use “Atualizar pela EAP”.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tabela">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Atividade</th>
                  <th>Predecessora</th>
                  <th>Início</th>
                  <th>Fim</th>
                  <th className="num">Dias</th>
                  <th className="nao-imprimir" />
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.chave} className={l.resumo ? 'arv-resumo' : !l.atividade ? 'arv-sem' : undefined}>
                    <td className="mono small">{l.atividade ? `#${l.atividade.numero}` : ''}</td>
                    <td style={{ paddingLeft: 12 + l.profundidade * 18 }} title={l.atividade?.descricao}>
                      {l.temFilhos ? (
                        <button className="arv-botao" type="button" aria-expanded={l.aberta} aria-label={`${l.aberta ? 'Recolher' : 'Expandir'} ${l.descricao}`} onClick={() => alternar(l.noId!)}>
                          {l.aberta ? '▾' : '▸'}
                        </button>
                      ) : null}
                      {l.codigo && <span className="mono small muted">{l.codigo} </span>}
                      {l.descricao}
                      {!l.atividade && !l.resumo && l.noId && <span className="small muted"> · sem atividade</span>}
                    </td>
                    <td className="mono">{l.atividade?.predecessoraId ? nomeDe(l.atividade.predecessoraId) : '—'}</td>
                    <td>
                      {l.inicio ? dataBr(l.inicio) : '—'}
                      {l.atividade && l.atividade.inicio !== l.atividade.inicioInformado && <div className="small muted">informado: {dataBr(l.atividade.inicioInformado)}</div>}
                    </td>
                    <td>{l.fim ? dataBr(l.fim) : '—'}</td>
                    <td className="num">{l.dias ?? '—'}</td>
                    <td className="acoes nao-imprimir">
                      {l.atividade && (
                        <>
                          <button className="btn" type="button" onClick={() => editar(l.atividade!)}>Editar</button>
                          <button className="btn" type="button" onClick={() => excluir(l.atividade!)}>Excluir</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <form className="card form nao-imprimir" onSubmit={salvar}>
        <h2 style={{ margin: 0 }}>{editando ? 'Editar atividade' : 'Nova atividade'}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <div className="campo" style={{ gridColumn: 'span 2' }}>
            <label htmlFor="at-resumida">Atividade (nome curto)</label>
            <input id="at-resumida" maxLength={80} value={d.descricaoResumida} onChange={(e) => setD({ ...d, descricaoResumida: e.target.value })} />
          </div>
          <div className="campo" style={{ gridColumn: 'span 2' }}>
            <label htmlFor="at-desc">Descrição completa (opcional)</label>
            <input id="at-desc" value={d.descricao} onChange={(e) => setD({ ...d, descricao: e.target.value })} />
          </div>
          <div className="campo" style={{ gridColumn: 'span 2' }}>
            <label htmlFor="at-eap">Tarefa da EAP</label>
            <select id="at-eap" value={d.eapNoId} onChange={(e) => setD({ ...d, eapNoId: e.target.value })}>
              <option value="">Escolha…</option>
              {tarefas.map((n) => <option key={n.id} value={n.id}>{' '.repeat(n.codigo.split('.').length - 1)}{n.codigo} {ROTULO_NIVEL[n.nivel]} · {n.descricao}</option>)}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="at-ini">Início informado</label>
            <input id="at-ini" type="date" value={d.inicio} onChange={(e) => setD({ ...d, inicio: e.target.value })} />
          </div>
          <div className="campo">
            <label htmlFor="at-dias">Duração (dias corridos)</label>
            <input id="at-dias" inputMode="numeric" value={d.duracaoDias} onChange={(e) => setD({ ...d, duracaoDias: e.target.value })} />
          </div>
          <div className="campo" style={{ gridColumn: 'span 2' }}>
            <label htmlFor="at-pred">Predecessora</label>
            <select id="at-pred" value={d.predecessoraId} onChange={(e) => setD({ ...d, predecessoraId: e.target.value })}>
              <option value="">Nenhuma</option>
              {lista.filter((a) => a.id !== editando).map((a) => <option key={a.id} value={a.id}>#{a.numero} · {a.descricaoResumida}</option>)}
            </select>
          </div>
        </div>
        <div className="acoes">
          {editando && <button className="btn" type="button" onClick={cancelar}>Cancelar edição</button>}
          <button className="btn btn-primario" type="submit" disabled={ocupado || d.descricaoResumida.trim().length < 2 || !d.inicio || !d.duracaoDias || !d.eapNoId}>
            {ocupado ? 'Salvando…' : editando ? 'Salvar atividade' : 'Adicionar atividade'}
          </button>
        </div>
      </form>
    </>
  );
}

/** Gantt: a mesma árvore da EAP. Etapas e subetapas mostram a barra do início ao fim das tarefas abaixo delas. */
function AbaGantt({ nos, lista, fechados, setFechados }: { nos: No[]; lista: Atividade[]; fechados: Set<string>; setFechados: (s: Set<string>) => void }) {
  const linhas = useMemo(() => montarLinhas(nos, lista, fechados), [nos, lista, fechados]);
  const comData = linhas.filter((l) => l.inicio && l.fim);
  if (!comData.length) {
    return (
      <div className="card">
        <div className="acoes" style={{ justifyContent: 'flex-end' }}><BotaoImprimir /></div>
        <p className="muted" style={{ margin: 0 }}>Não há atividades com datas. Monte o planejamento em Planejamento.</p>
      </div>
    );
  }
  const ini = comData.reduce((m, l) => (l.inicio! < m ? l.inicio! : m), comData[0].inicio!);
  const fim = comData.reduce((m, l) => (l.fim! > m ? l.fim! : m), comData[0].fim!);
  const total = diasEntre(ini, fim) + 1;
  const meses = mesesEntre(ini, fim);
  const largura = Math.max(900, total * 4);

  return (
    <div className="card">
      <div className="acoes" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <p className="small muted" style={{ margin: 0 }}>Projeto de {dataBr(ini)} a {dataBr(fim)} · {total} dias corridos</p>
        <BotaoImprimir />
      </div>
      <ControlesArvore nos={nos} fechados={fechados} setFechados={setFechados} />
      <div style={{ overflowX: 'auto', marginTop: 8 }}>
        <div style={{ minWidth: largura + 320 }}>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
            <div className="small muted" style={{ flex: '0 0 320px', padding: '4px 8px 4px 0' }}>Atividade</div>
            <div style={{ flex: 1, display: 'flex' }}>
              {meses.map((m, i) => (
                <div key={i} className="gantt-mes" style={{ flex: `${m.dias} 1 0` }}>{m.rotulo}</div>
              ))}
            </div>
          </div>
          {linhas.map((l) => {
            const temBarra = !!(l.inicio && l.fim);
            const esquerda = temBarra ? (diasEntre(ini, l.inicio!) / total) * 100 : 0;
            const largBarra = temBarra ? Math.max(0.5, ((diasEntre(l.inicio!, l.fim!) + 1) / total) * 100) : 0;
            return (
              <div key={l.chave} style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border)', minHeight: 34 }} className={l.resumo ? 'arv-resumo' : undefined}>
                <div style={{ flex: '0 0 320px', padding: '4px 8px 4px 0', fontSize: 12, paddingLeft: 4 + l.profundidade * 14 }}>
                  {l.temFilhos ? (
                    <button className="arv-botao" type="button" aria-expanded={l.aberta} aria-label={`${l.aberta ? 'Recolher' : 'Expandir'} ${l.descricao}`} onClick={() => {
                      const proximo = new Set(fechados);
                      if (proximo.has(l.noId!)) proximo.delete(l.noId!);
                      else proximo.add(l.noId!);
                      setFechados(proximo);
                    }}>
                      {l.aberta ? '▾' : '▸'}
                    </button>
                  ) : null}
                  {l.codigo && <span className="mono muted">{l.codigo} </span>}
                  {l.descricao}
                  {temBarra && <div className="small muted">{dataBr(l.inicio!)} a {dataBr(l.fim!)} · {l.dias} d</div>}
                  {!temBarra && l.noId && <div className="small muted">sem atividade</div>}
                </div>
                <div style={{ flex: 1, position: 'relative', height: 30 }}>
                  {temBarra && (
                    <div
                      className={`gantt-barra${l.resumo ? ' resumo' : ''}`}
                      title={`${l.descricao}: ${dataBr(l.inicio!)} a ${dataBr(l.fim!)}`}
                      style={{ left: `${esquerda}%`, width: `${largBarra}%` }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="small muted">Barra cheia: tarefa. Barra vazada: etapa ou subetapa (vai do início ao fim das tarefas abaixo dela).</p>
    </div>
  );
}

/** Equipes, materiais e equipamentos necessários: os mesmos cálculos dos relatórios, cada um numa aba. */
function AbaRecursos({ obraId, tipo, setErro }: { obraId: string; tipo: 'equipes' | 'materiais' | 'equipamentos'; setErro: (m: string) => void }) {
  const [gran, setGran] = useState<Gran>('semana');
  const [equipes, setEquipes] = useState<EquipesRel | null>(null);
  const [compras, setCompras] = useState<ComprasRel | null>(null);

  useEffect(() => {
    setErro('');
    setEquipes(null);
    setCompras(null);
    const caminho = tipo === 'equipes'
      ? `/eng/obras/${obraId}/relatorios-planejamento/equipes?granularidade=${gran}`
      : `/eng/obras/${obraId}/relatorios-planejamento/compras?classe=${tipo === 'materiais' ? 'material' : 'equipamento'}`;
    api<EquipesRel | ComprasRel>(caminho)
      .then((r) => (tipo === 'equipes' ? setEquipes(r as EquipesRel) : setCompras(r as ComprasRel)))
      .catch((e) => setErro((e as Error).message));
  }, [obraId, tipo, gran]);

  const titulo = tipo === 'equipes' ? 'Equipes necessárias' : tipo === 'materiais' ? 'Materiais necessários' : 'Equipamentos';

  return (
    <>
      <div className="card">
        <div className="acoes" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0 }}>{titulo}</h2>
          <div className="acoes nao-imprimir" style={{ alignItems: 'center' }}>
            {tipo === 'equipes' && (
              <div className="segmentado" role="group" aria-label="Período">
                {GRANULARIDADES.map((g) => (
                  <button key={g.id} type="button" aria-pressed={gran === g.id} className={gran === g.id ? 'ativo' : ''} onClick={() => setGran(g.id)}>{g.texto}</button>
                ))}
              </div>
            )}
            <BotaoImprimir />
          </div>
        </div>
      </div>
      {tipo === 'equipes' && equipes && <EquipesView e={equipes} />}
      {tipo !== 'equipes' && compras && <ComprasView c={compras} classe={tipo === 'materiais' ? 'material' : 'equipamento'} />}
      {((tipo === 'equipes' && !equipes) || (tipo !== 'equipes' && !compras)) && <p className="muted">Carregando…</p>}
    </>
  );
}
