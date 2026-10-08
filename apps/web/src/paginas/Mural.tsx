// Mural de avisos: comunicação interna, aniversariantes do mês e ranking de produção (configurados pelo dono).
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, formatarData, formatarDataHora, formatarMoeda, formatarNumero, hojeLocal, NOMES_PERFIL, nomeMes, type Perfil } from '../api';
import { CabecalhoDocumento } from '../componentes/Documento';
import { TabelaRelatorio } from '../componentes/Relatorio';

type Aviso = { id: string; titulo: string; texto: string; perfis: Perfil[] | null; fixado: boolean; ate: string | null; autor: string | null; criadoEm: string; excluidoEm: string | null; excluidoPor?: string | null };
type Ranking = { id: string; titulo: string; unidade: 'm3' | 'moeda'; linhas: { nome: string; valor: number }[] };
type Config = { aniversariantes: boolean; ranking: boolean; rankings: string[]; posicoes: number };
type Painel = {
  mes: string; config: Config; podePublicar: boolean; podeConfigurar: boolean; avisos: Aviso[];
  aniversariantes: { nome: string; cargo: string | null; dia: number; hoje: boolean }[]; rankings: Ranking[];
};

const RANKINGS: [string, string][] = [
  ['motoristas_m3', 'Motoristas · m³ entregues'],
  ['bomba_m3', 'Operadores de bomba · m³ bombeados'],
  ['vendedores_m3', 'Vendedores · m³ entregues'],
  ['vendedores_valor', 'Vendedores · valor vendido'],
];
const PERFIS: Perfil[] = ['gestor', 'financeiro', 'administrativo', 'vendedor', 'operador_usina', 'laboratorista', 'motorista'];
const MEDALHA = ['1º', '2º', '3º'];

function usePainelMural() {
  const [d, setD] = useState<Painel | null>(null);
  const [erro, setErro] = useState('');
  const carregar = useCallback(() => {
    api<Painel>('/mural/painel').then(setD).catch((e) => setErro((e as Error).message));
  }, []);
  useEffect(carregar, [carregar]);
  return { d, erro, carregar };
}

function ListaAvisos({ avisos, max }: { avisos: Aviso[]; max?: number }) {
  const lista = max ? avisos.slice(0, max) : avisos;
  if (!lista.length) return <p className="muted small" style={{ margin: 0 }}>Nenhum aviso no mural.</p>;
  return (
    <ul className="lista-avisos">
      {lista.map((a) => (
        <li key={a.id} className={a.fixado ? 'fixado' : ''}>
          <div className="aviso-topo">
            <b>{a.titulo}</b>
            {a.fixado && <span className="selo selo-aviso">fixado</span>}
          </div>
          <p>{a.texto}</p>
          <span className="small muted">
            {a.autor ?? '—'} · {formatarDataHora(a.criadoEm)}
            {a.perfis && ` · para ${a.perfis.map((p) => NOMES_PERFIL[p]).join(', ')}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Rankings({ rankings }: { rankings: Ranking[] }) {
  return (
    <div className="rankings">
      {rankings.map((r) => (
        <div key={r.id}>
          <h3>{r.titulo}</h3>
          {r.linhas.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>Sem produção no mês.</p>
          ) : (
            <ol className="ranking">
              {r.linhas.map((l, i) => (
                <li key={l.nome}>
                  <span className={`posicao ${i < 3 ? `p${i + 1}` : ''}`}>{MEDALHA[i] ?? `${i + 1}º`}</span>
                  <span className="nome">{l.nome}</span>
                  <span className="mono">{r.unidade === 'moeda' ? formatarMoeda(l.valor) : `${formatarNumero(l.valor, 1)} m³`}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      ))}
    </div>
  );
}

function Aniversariantes({ lista }: { lista: Painel['aniversariantes'] }) {
  if (!lista.length) return <p className="small muted" style={{ margin: 0 }}>Nenhum aniversariante cadastrado neste mês.</p>;
  return (
    <ul className="lista-aniversarios">
      {lista.map((a) => (
        <li key={a.nome} className={a.hoje ? 'hoje' : ''}>
          <span className="mono dia">{String(a.dia).padStart(2, '0')}</span>
          <span>
            {a.nome}
            {a.cargo && <span className="small muted"> · {a.cargo}</span>}
          </span>
          {a.hoje && <span className="selo selo-ok">hoje 🎉</span>}
        </li>
      ))}
    </ul>
  );
}

/** Card do mural no painel de todos os perfis. */
export function CardMural() {
  const { d } = usePainelMural();
  if (!d) return null;
  const temAlgo = d.avisos.length || (d.config.aniversariantes && d.aniversariantes.length) || (d.config.ranking && d.rankings.some((r) => r.linhas.length));
  if (!temAlgo && !d.podePublicar) return null;
  return (
    <section className="card cartao-mural">
      <div className="cartao-topo">
        <h2>Mural</h2>
        <Link to="/mural" className="small">{d.podePublicar ? 'Publicar e ver tudo' : 'Ver tudo'}</Link>
      </div>
      <div className="mural-grade">
        <div>
          <ListaAvisos avisos={d.avisos} max={3} />
        </div>
        {(d.config.aniversariantes || d.config.ranking) && (
          <div className="mural-lateral">
            {d.config.aniversariantes && d.aniversariantes.length > 0 && (
              <div>
                <h3>Aniversariantes de {nomeMes(d.mes)}</h3>
                <Aniversariantes lista={d.aniversariantes} />
              </div>
            )}
            {d.config.ranking && d.rankings.length > 0 && <Rankings rankings={d.rankings.slice(0, 2).map((r) => ({ ...r, linhas: r.linhas.slice(0, 3) }))} />}
          </div>
        )}
      </div>
    </section>
  );
}

type FormAviso = { id?: string; titulo: string; texto: string; perfis: Perfil[]; fixado: boolean; ate: string };

export function MuralAvisos() {
  const { d, erro: erroCarga, carregar } = usePainelMural();
  const [form, setForm] = useState<FormAviso | null>(null);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [rel, setRel] = useState<{ de: string; ate: string; avisos: Aviso[] } | null>(null);
  const [per, setPer] = useState({ de: `${hojeLocal().slice(0, 7)}-01`, ate: hojeLocal() });

  useEffect(() => {
    if (d && !cfg) setCfg(d.config);
  }, [d, cfg]);
  useEffect(() => {
    api<{ de: string; ate: string; avisos: Aviso[] }>(`/mural/relatorio?de=${per.de}&ate=${per.ate}`).then(setRel).catch(() => {});
  }, [per, d]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setErro('');
    try {
      const corpo = { titulo: form.titulo, texto: form.texto, perfis: form.perfis, fixado: form.fixado, ate: form.ate || null };
      if (form.id) await api(`/mural/avisos/${form.id}`, { metodo: 'PUT', corpo });
      else await api('/mural/avisos', { corpo });
      setAviso(form.id ? 'Aviso alterado.' : 'Aviso publicado no mural.');
      setForm(null);
      carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  async function tirar(a: Aviso) {
    setErro('');
    try {
      await api(`/mural/avisos/${a.id}`, { metodo: 'DELETE' });
      setAviso(`"${a.titulo}" saiu do mural (continua no relatório).`);
      carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  async function salvarConfig(e: FormEvent) {
    e.preventDefault();
    if (!cfg) return;
    setErro('');
    try {
      await api('/mural/config', { metodo: 'PUT', corpo: cfg });
      setAviso('Mural configurado.');
      carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Mural de avisos</h1>
          <span className="muted">Comunicação interna da equipe, aniversariantes do mês e ranking de produção.</span>
        </div>
        {d?.podePublicar && !form && (
          <button className="btn btn-primario" type="button" onClick={() => setForm({ titulo: '', texto: '', perfis: [], fixado: false, ate: '' })}>
            Novo aviso
          </button>
        )}
      </div>
      {(erro || erroCarga) && <div className="alerta alerta-erro" role="alert">{erro || erroCarga}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}

      {form && (
        <form className="card form" onSubmit={salvar}>
          <h2>{form.id ? 'Alterar aviso' : 'Novo aviso'}</h2>
          <div className="campo">
            <label htmlFor="a-tit">Título</label>
            <input id="a-tit" maxLength={120} value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} />
          </div>
          <div className="campo">
            <label htmlFor="a-txt">Aviso</label>
            <textarea id="a-txt" rows={4} maxLength={3000} value={form.texto} onChange={(e) => setForm({ ...form, texto: e.target.value })} />
          </div>
          <fieldset className="campo">
            <legend>Para quem</legend>
            <div className="filtros">
              <button type="button" className={`chip ${form.perfis.length === 0 ? 'chip-ativo' : ''}`} onClick={() => setForm({ ...form, perfis: [] })}>Todos</button>
              {PERFIS.map((p) => (
                <button key={p} type="button" className={`chip ${form.perfis.includes(p) ? 'chip-ativo' : ''}`} aria-pressed={form.perfis.includes(p)}
                  onClick={() => setForm({ ...form, perfis: form.perfis.includes(p) ? form.perfis.filter((x) => x !== p) : [...form.perfis, p] })}>
                  {NOMES_PERFIL[p]}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="campos">
            <div className="campo">
              <label htmlFor="a-ate">Fica no mural até</label>
              <input id="a-ate" type="date" value={form.ate} onChange={(e) => setForm({ ...form, ate: e.target.value })} />
              <span className="small muted">Em branco: até alguém tirar.</span>
            </div>
          </div>
          <label className="marcar">
            <input type="checkbox" checked={form.fixado} onChange={(e) => setForm({ ...form, fixado: e.target.checked })} />
            Fixar no topo do mural
          </label>
          <div className="acoes">
            <button className="btn btn-primario" type="submit">{form.id ? 'Salvar' : 'Publicar'}</button>
            <button className="btn btn-link" type="button" onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </form>
      )}

      {!d ? (
        <p className="muted">Carregando…</p>
      ) : (
        <div className="grade-larga">
          <section className="card">
            <h2>Avisos</h2>
            {d.avisos.length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>Nenhum aviso no mural.</p>
            ) : (
              <ul className="lista-avisos">
                {d.avisos.map((a) => (
                  <li key={a.id} className={a.fixado ? 'fixado' : ''}>
                    <div className="aviso-topo">
                      <b>{a.titulo}</b>
                      {a.fixado && <span className="selo selo-aviso">fixado</span>}
                    </div>
                    <p>{a.texto}</p>
                    <span className="small muted">
                      {a.autor ?? '—'} · {formatarDataHora(a.criadoEm)}
                      {a.perfis && ` · para ${a.perfis.map((p) => NOMES_PERFIL[p]).join(', ')}`}
                      {a.ate && ` · até ${formatarData(a.ate)}`}
                    </span>
                    {d.podePublicar && (
                      <div>
                        <button className="btn btn-link" type="button" onClick={() => setForm({ id: a.id, titulo: a.titulo, texto: a.texto, perfis: a.perfis ?? [], fixado: a.fixado, ate: a.ate ?? '' })}>Alterar</button>
                        <button className="btn btn-link" type="button" onClick={() => tirar(a)}>Tirar do mural</button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
            {d.config.aniversariantes && (
              <section className="card">
                <h2>Aniversariantes de {nomeMes(d.mes)}</h2>
                <Aniversariantes lista={d.aniversariantes} />
                <span className="small muted">A data de nascimento fica no cadastro do colaborador (Administrativo › Colaboradores).</span>
              </section>
            )}
            {d.config.ranking && (
              <section className="card">
                <h2>Ranking de produção · {nomeMes(d.mes)}</h2>
                <Rankings rankings={d.rankings} />
              </section>
            )}
          </div>
        </div>
      )}

      {d?.podeConfigurar && cfg && (
        <form className="card form" onSubmit={salvarConfig}>
          <h2>Configurar o mural</h2>
          <span className="small muted">Só o dono muda o que aparece no mural.</span>
          <label className="marcar">
            <input type="checkbox" checked={cfg.aniversariantes} onChange={(e) => setCfg({ ...cfg, aniversariantes: e.target.checked })} />
            Mostrar os aniversariantes do mês
          </label>
          <label className="marcar">
            <input type="checkbox" checked={cfg.ranking} onChange={(e) => setCfg({ ...cfg, ranking: e.target.checked })} />
            Mostrar o ranking de produção do mês
          </label>
          {cfg.ranking && (
            <>
              <fieldset className="campo">
                <legend>Rankings</legend>
                {RANKINGS.map(([k, t]) => (
                  <label key={k} className="marcar">
                    <input type="checkbox" checked={cfg.rankings.includes(k)} onChange={(e) => setCfg({ ...cfg, rankings: e.target.checked ? [...cfg.rankings, k] : cfg.rankings.filter((x) => x !== k) })} />
                    {t}
                  </label>
                ))}
              </fieldset>
              <div className="campo" style={{ maxWidth: 220 }}>
                <label htmlFor="c-pos">Posições em cada ranking</label>
                <select id="c-pos" value={cfg.posicoes} onChange={(e) => setCfg({ ...cfg, posicoes: Number(e.target.value) })}>
                  {[3, 5, 10].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div className="acoes">
            <button className="btn btn-primario" type="submit">Salvar configuração</button>
          </div>
        </form>
      )}

      <section className="relatorio-mural">
        <CabecalhoDocumento modulo="Mural de avisos" titulo="Relatório de avisos" descricao="Todos os avisos publicados no período, inclusive os que já saíram do mural." periodo={`${formatarData(per.de)} a ${formatarData(per.ate)}`} />
        <div className="filtros nao-imprimir">
          <input type="date" aria-label="De" value={per.de} onChange={(e) => e.target.value && setPer({ ...per, de: e.target.value })} />
          <span className="muted">até</span>
          <input type="date" aria-label="Até" value={per.ate} onChange={(e) => e.target.value && setPer({ ...per, ate: e.target.value })} />
        </div>
        {rel && (
          <TabelaRelatorio
            titulo="Avisos"
            arquivo={`avisos-${per.de}-${per.ate}`}
            linhas={rel.avisos}
            colunas={[
              { titulo: 'Publicado em', valor: (a: Aviso) => formatarDataHora(a.criadoEm) },
              { titulo: 'Título', valor: (a: Aviso) => a.titulo },
              { titulo: 'Aviso', valor: (a: Aviso) => a.texto },
              { titulo: 'Para', valor: (a: Aviso) => (a.perfis ? a.perfis.map((p) => NOMES_PERFIL[p]).join(', ') : 'Todos') },
              { titulo: 'Autor', valor: (a: Aviso) => a.autor ?? '—' },
              { titulo: 'Situação', valor: (a: Aviso) => (a.excluidoEm ? `Retirado${a.excluidoPor ? ` por ${a.excluidoPor}` : ''}` : a.ate && a.ate < hojeLocal() ? 'Expirado' : 'No mural') },
            ]}
            vazio="Nenhum aviso no período."
          />
        )}
      </section>
    </>
  );
}
