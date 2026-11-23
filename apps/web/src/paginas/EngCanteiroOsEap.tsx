// Engenharia · OS na EAP: a EAP da obra com as OS das centrais como botões. A cor do botão é a prioridade; o status vai no
// texto e no preenchimento (vazado = liberada, cheio = em execução, cheio e claro com ✓ = concluída, tracejado = sem OS).
// Clicar no botão abre equipe, quantidade, prazo e as predecessoras do planejamento. Tem versão para imprimir.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatarData } from '../api';
import { CabecalhoDocumento } from '../componentes/Documento';

type Os = { id: string; numero: number; codigo: string; status: string; equipe: string; quantidade: number | null; unidade: string; prazo: string | null; atrasada: boolean };
type Predecessora = { atividade: number; descricao: string; nivel: number; situacao: string; codigoOs: string | null };
type Frente = { id: string; central: string; centralNome: string; prioridade: 'alta' | 'media' | 'baixa'; os: Os[]; predecessoras: Predecessora[] };
type No = { id: string; paiId: string | null; nivel: string; codigo: string; descricao: string; frente: Frente | null };
type Resposta = { resumo: { planejadas: number; liberadas: number; emExecucao: number; concluidas: number; atrasadas: number }; nos: No[] };

const NOMES_STATUS: Record<string, string> = { liberada: 'Liberada', em_execucao: 'Em execução', concluida: 'Concluída' };
const NOMES_SITUACAO: Record<string, string> = { sem_central: 'fora das centrais', planejada: 'sem OS', liberada: 'liberada', em_execucao: 'em execução', concluida: 'concluída' };
const NOMES_PRIORIDADE = { alta: 'alta', media: 'média', baixa: 'baixa' } as const;
const FILTROS_STATUS: [string, string][] = [
  ['todos', 'Todos os status'],
  ['planejada', 'Sem OS (planejada)'],
  ['liberada', 'Liberada'],
  ['em_execucao', 'Em execução'],
  ['concluida', 'Concluída'],
  ['atrasada', 'Prazo vencido'],
];

const rotuloOs = (o: Os) => `${o.status === 'concluida' ? '✓ ' : ''}${o.atrasada ? '⚠ ' : ''}${o.codigo} · ${NOMES_STATUS[o.status] ?? o.status}`;

function correspondeAoFiltro(f: Frente, central: string, status: string): boolean {
  if (central !== 'todas' && f.central !== central) return false;
  if (status === 'todos') return true;
  if (status === 'planejada') return f.os.length === 0;
  if (status === 'atrasada') return f.os.some((o) => o.atrasada);
  return f.os.some((o) => o.status === status);
}

export function EngCanteiroOsEap() {
  const { obraId = '' } = useParams();
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState('');
  const [central, setCentral] = useState('todas');
  const [status, setStatus] = useState('todos');
  const [aberto, setAberto] = useState<{ no: string; os: string | null } | null>(null);

  useEffect(() => {
    setDados(null);
    setErro('');
    api<Resposta>(`/eng/obras/${obraId}/canteiro/os-eap`).then(setDados).catch((e) => setErro((e as Error).message));
  }, [obraId]);

  const centrais = useMemo(() => [...new Map((dados?.nos ?? []).filter((n) => n.frente).map((n) => [n.frente!.central, n.frente!.centralNome])).entries()], [dados]);

  /** Nós que aparecem: os que casam com o filtro e os pais deles (para a árvore não ficar quebrada). */
  const visiveis = useMemo(() => {
    const ids = new Set<string>();
    if (!dados) return ids;
    const pais = new Map(dados.nos.map((n) => [n.id, n.paiId]));
    for (const n of dados.nos) {
      if (!n.frente || !correspondeAoFiltro(n.frente, central, status)) continue;
      for (let atual: string | null = n.id; atual && !ids.has(atual); atual = pais.get(atual) ?? null) ids.add(atual);
    }
    return ids;
  }, [dados, central, status]);

  const profundidade = useMemo(() => {
    const pais = new Map((dados?.nos ?? []).map((n) => [n.id, n.paiId]));
    const nivelDe = (id: string): number => (pais.get(id) && pais.has(pais.get(id)!) ? 1 + nivelDe(pais.get(id)!) : 0);
    return new Map((dados?.nos ?? []).map((n) => [n.id, nivelDe(n.id)]));
  }, [dados]);

  return (
    <>
      <CabecalhoDocumento
        modulo="Engenharia"
        titulo="OS na EAP"
        descricao="Status das OS de cada tarefa. A cor do botão é a prioridade."
        acoes={<Link className="btn" to={`/eng/canteiro/${obraId}`}>Canteiro da obra</Link>}
      />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {!dados ? (
        !erro && <p className="muted">Carregando…</p>
      ) : dados.nos.length === 0 ? (
        <p className="muted">Nenhuma tarefa está associada a uma central. Associe os serviços da EAP na página de cada central.</p>
      ) : (
        <>
          <div className="os-eap-resumo">
            <span><b>{dados.resumo.planejadas}</b> sem OS</span>
            <span><b>{dados.resumo.liberadas}</b> liberadas</span>
            <span><b>{dados.resumo.emExecucao}</b> em execução</span>
            <span><b>{dados.resumo.concluidas}</b> concluídas</span>
            <span className={dados.resumo.atrasadas ? 'os-eap-atrasadas' : ''}><b>{dados.resumo.atrasadas}</b> com prazo vencido</span>
          </div>
          <div className="os-eap-legenda">
            <span><i className="os-cor prioridade-alta" /> Prioridade alta</span>
            <span><i className="os-cor prioridade-media" /> média</span>
            <span><i className="os-cor prioridade-baixa" /> baixa</span>
            <span className="muted">Tracejado: sem OS · vazado: liberada · cheio: em execução · cheio claro com ✓: concluída · ⚠: prazo vencido</span>
          </div>
          <div className="os-eap-filtros nao-imprimir">
            <label>
              Central
              <select value={central} onChange={(e) => setCentral(e.target.value)}>
                <option value="todas">Todas as centrais</option>
                {centrais.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
              </select>
            </label>
            <label>
              Status
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                {FILTROS_STATUS.map(([v, nome]) => <option key={v} value={v}>{nome}</option>)}
              </select>
            </label>
          </div>
          <div className="card tabela-caixa">
            <table className="tabela">
              <thead>
                <tr><th>Item</th><th>Descrição</th><th>OS</th></tr>
              </thead>
              <tbody>
                {dados.nos.filter((n) => visiveis.has(n.id)).map((n) => {
                  const f = n.frente;
                  const lista = f ? (status === 'todos' || status === 'planejada' || status === 'atrasada' ? f.os : f.os.filter((o) => o.status === status)) : [];
                  const detalhe = aberto?.no === n.id && f ? f : null;
                  return (
                    <Fragment key={n.id}>
                      <tr>
                        <td style={{ whiteSpace: 'nowrap' }}><strong>{n.codigo}</strong></td>
                        <td style={{ paddingLeft: 8 + (profundidade.get(n.id) ?? 0) * 18 }}>{n.descricao}</td>
                        <td>
                          {f && (
                            <div className="os-botoes">
                              {lista.map((o) => (
                                <button key={o.id} type="button" className={`os-botao prioridade-${f.prioridade} estado-${o.status}${o.atrasada ? ' atrasada' : ''}`} onClick={() => setAberto(detalhe && aberto?.os === o.id ? null : { no: n.id, os: o.id })}>
                                  {rotuloOs(o)}
                                </button>
                              ))}
                              {f.os.length === 0 && (
                                <button type="button" className={`os-botao prioridade-${f.prioridade} estado-planejada`} onClick={() => setAberto(detalhe ? null : { no: n.id, os: null })}>
                                  Sem OS
                                </button>
                              )}
                              <span className="small muted">{f.centralNome}</span>
                            </div>
                          )}
                        </td>
                      </tr>
                      {detalhe && (
                        <tr className="os-eap-detalhe">
                          <td />
                          <td colSpan={2}>
                            <div className="small">
                              <b>{detalhe.centralNome}</b> · prioridade {NOMES_PRIORIDADE[detalhe.prioridade]}
                              {detalhe.os
                                .filter((o) => aberto?.os === null || o.id === aberto?.os)
                                .map((o) => (
                                  <div key={o.id}>
                                    {o.codigo}: {[o.equipe && `equipe ${o.equipe}`, o.quantidade !== null && `${o.quantidade.toLocaleString('pt-BR')} ${o.unidade}`.trim(), o.prazo && `prazo ${formatarData(o.prazo)}`].filter(Boolean).join(' · ') || 'sem equipe, quantidade ou prazo'}
                                  </div>
                                ))}
                              {detalhe.predecessoras.length > 0 ? (
                                <div>
                                  Predecessoras:{' '}
                                  {detalhe.predecessoras.map((p) => `${p.atividade} ${p.descricao}${p.codigoOs ? ` (${p.codigoOs})` : ''} — ${NOMES_SITUACAO[p.situacao] ?? p.situacao}`).join(' · ')}
                                </div>
                              ) : (
                                <div className="muted">Sem predecessoras no planejamento.</div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
