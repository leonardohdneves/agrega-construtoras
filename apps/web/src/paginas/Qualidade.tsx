import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  agoraLocal,
  api,
  diaCurto,
  formatarData,
  formatarDocumento,
  formatarNumero,
  hojeLocal,
  lerNumero,
  mpa,
  somarDias,
  type Amostra,
  type CpAromper,
  type ResumoQualidade,
} from '../api';
import { CabecalhoDocumento } from '../componentes/Documento';
import { TabelaRelatorio } from '../componentes/Relatorio';
import { useSessao } from '../sessao';
import { SeletorDias, textoDias, type Dias } from './ProdMotoristas';

const hora = (iso: string) => agoraLocal(new Date(iso)).slice(11, 16);
const pct = (n: number | null) => (n === null ? '—' : `${(n * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const cm = (n: number | null) => (n === null ? '—' : `${formatarNumero(n, n % 1 ? 1 : 0)} cm`);

function SeloConforme({ v }: { v: boolean | null }) {
  if (v === null) return <span className="selo selo-neutro">aguardando</span>;
  return v ? <span className="selo selo-ok">conforme</span> : <span className="selo selo-perigo">abaixo do fck</span>;
}

// ======================================================================= CPs a romper

export function CpsARomper() {
  const [dados, setDados] = useState<{ hoje: string; diametroMm: number; cps: CpAromper[] } | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [modo, setModo] = useState<'mpa' | 'kn'>('mpa');
  const [data, setData] = useState(hojeLocal());
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setDados(await api('/qual/cps'));
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  // Agrupa por amostra e idade: os CPs do mesmo exemplar ficam na mesma linha.
  const grupos = useMemo(() => {
    const m = new Map<string, CpAromper[]>();
    for (const c of dados?.cps ?? []) {
      const k = `${c.amostraId}|${c.idade}`;
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    return [...m.values()];
  }, [dados]);
  const converter = (v: string) => {
    const n = lerNumero(v);
    if (n === null) return null;
    if (modo === 'mpa') return n;
    const area = Math.PI * ((dados?.diametroMm ?? 100) / 2) ** 2;
    return Math.round(((n * 1000) / area) * 10) / 10;
  };

  async function salvar() {
    setErro('');
    setAviso('');
    const itens = Object.entries(valores)
      .filter(([, v]) => v.trim())
      .map(([cpId, v]) => (v.trim().toLowerCase() === 'x' ? { cpId, descartar: true, observacao: 'CP danificado' } : modo === 'mpa' ? { cpId, resistencia: v } : { cpId, cargaKn: v }));
    if (!itens.length) return setErro('Digite pelo menos um resultado.');
    setOcupado(true);
    try {
      const r = await api<{ gravados: number }>('/qual/cps/resultados', { corpo: { data, itens } });
      setAviso(`${r.gravados} resultado(s) gravado(s).`);
      setValores({});
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const atrasados = (dados?.cps ?? []).filter((c) => c.atraso > 0).length;

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>CPs a romper</h1>
          <span className="muted">Corpos de prova com rompimento previsto até hoje. Digite o resultado de cada CP.</span>
        </div>
        <Link className="btn btn-secundario" to="/qual/amostras">Amostras e resultados</Link>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}
      {atrasados > 0 && <div className="alerta alerta-aviso">{atrasados} CP(s) passaram da data. Rompa o quanto antes: fora da idade, o resultado perde o valor de controle.</div>}

      <div className="filtros">
        <div className="segmentado" role="group" aria-label="Unidade">
          <button type="button" aria-pressed={modo === 'mpa'} className={modo === 'mpa' ? 'ativo' : ''} onClick={() => setModo('mpa')}>Resistência (MPa)</button>
          <button type="button" aria-pressed={modo === 'kn'} className={modo === 'kn' ? 'ativo' : ''} onClick={() => setModo('kn')}>Carga da prensa (kN)</button>
        </div>
        <label className="periodo-manual">
          Rompidos em <input type="date" value={data} max={hojeLocal()} onChange={(e) => e.target.value && setData(e.target.value)} />
        </label>
      </div>
      {modo === 'kn' && <p className="small muted">Convertido para MPa pelo diâmetro de {dados?.diametroMm ?? 100} mm. Digite <b>x</b> para descartar um CP danificado.</p>}

      <div className="card tabela-caixa">
        {!dados ? (
          <p className="muted">Carregando…</p>
        ) : grupos.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nenhum corpo de prova para romper hoje.</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr>
                <th>Previsto</th>
                <th>Carga</th>
                <th>Traço</th>
                <th>Cliente e obra</th>
                <th style={{ textAlign: 'right' }}>Idade</th>
                <th>CPs</th>
                <th style={{ textAlign: 'right' }}>Exemplar</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => {
                const c = g[0];
                const resultados = g.map((x) => converter(valores[x.id] ?? '')).filter((x): x is number => x !== null);
                const exemplar = resultados.length ? Math.max(...resultados) : null;
                return (
                  <tr key={`${c.amostraId}-${c.idade}`}>
                    <td>
                      {diaCurto(c.previsto)}
                      {c.atraso > 0 && <div><span className="selo selo-aviso">{c.atraso} dia(s) de atraso</span></div>}
                    </td>
                    <td>
                      <span className="mono">nº {c.cargaNumero}</span>
                      <div className="small muted">{formatarData(c.moldagem.slice(0, 10))} {hora(c.moldagem)} · {c.betoneiraCodigo}</div>
                    </td>
                    <td>
                      <span className="mono">{c.tracoCodigo}</span>
                      <div className="small muted">fck {c.fck ?? '—'}{c.slump !== null ? ` · slump ${cm(c.slump)}` : ''}</div>
                    </td>
                    <td>
                      {c.clienteNome ?? '—'}
                      {c.obra && <div className="small muted">{c.obra}</div>}
                    </td>
                    <td className="mono" style={{ textAlign: 'right' }}>
                      {c.idade} dias
                      {c.anterior !== null && <div className="small muted">antes: {mpa(c.anterior)}</div>}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {g.map((x) => (
                          <input
                            key={x.id}
                            aria-label={`CP ${x.numero} da carga ${x.cargaNumero} aos ${x.idade} dias`}
                            className="mono"
                            inputMode="decimal"
                            placeholder={`CP ${x.numero}`}
                            style={{ width: 84, textAlign: 'right' }}
                            value={valores[x.id] ?? ''}
                            onChange={(e) => setValores({ ...valores, [x.id]: e.target.value })}
                          />
                        ))}
                      </div>
                    </td>
                    <td className="mono" style={{ textAlign: 'right' }}>
                      {exemplar === null ? '—' : (
                        <span className={c.fck !== null && c.idade >= 28 && exemplar < c.fck ? 'texto-perigo' : undefined}>{mpa(exemplar)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="acoes">
        <button className="btn btn-primario" type="button" disabled={ocupado} onClick={salvar}>Gravar resultados</button>
        <span className="small muted">O exemplar é o maior resultado entre os CPs da mesma idade (NBR 12655).</span>
      </div>
    </>
  );
}

// ======================================================================= Amostras e resultados

type RespAmostras = { de: string; ate: string; idades: number[]; idadeControle: number; amostras: Amostra[]; resumo: ResumoQualidade };

export function Amostras() {
  const [periodo, setPeriodo] = useState<Dias>({ de: somarDias(hojeLocal(), -30), ate: hojeLocal() });
  const [dados, setDados] = useState<RespAmostras | null>(null);
  const [filtro, setFiltro] = useState<'todas' | 'abaixo' | 'slump' | 'aguardando'>('todas');
  const [editando, setEditando] = useState<Amostra | null>(null);
  const [form, setForm] = useState({ slump: '', temperatura: '', observacao: '', cps: {} as Record<string, string> });
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  const carregar = useCallback(async () => {
    try {
      setDados(await api<RespAmostras>(`/qual/amostras?de=${periodo.de}&ate=${periodo.ate}`));
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [periodo]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  const lista = (dados?.amostras ?? []).filter((a) =>
    filtro === 'abaixo' ? a.conforme === false : filtro === 'slump' ? a.slumpFora : filtro === 'aguardando' ? a.resultadoControle === null && a.status === 'ativa' : true,
  );

  function abrir(a: Amostra) {
    setEditando(a);
    setForm({
      slump: a.slump === null ? '' : String(a.slump).replace('.', ','),
      temperatura: a.temperatura === null ? '' : String(a.temperatura).replace('.', ','),
      observacao: a.observacao ?? '',
      cps: Object.fromEntries(a.idades.flatMap((i) => i.cps).map((c) => [c.id, c.resistencia === null ? '' : String(c.resistencia).replace('.', ',')])),
    });
  }

  async function salvar() {
    if (!editando) return;
    setErro('');
    try {
      await api(`/qual/amostras/${editando.amostraId}`, {
        metodo: 'PATCH',
        corpo: { slump: form.slump.trim() ? form.slump : null, temperatura: form.temperatura.trim() ? form.temperatura : null, observacao: form.observacao },
      });
      for (const c of editando.idades.flatMap((i) => i.cps)) {
        const novo = form.cps[c.id]?.trim() ?? '';
        const atual = c.resistencia === null ? '' : String(c.resistencia).replace('.', ',');
        if (novo === atual || c.situacao === 'descartado') continue;
        await api(`/qual/cps/${c.id}`, { metodo: 'PATCH', corpo: { resistencia: novo ? lerNumero(novo) : null } });
      }
      setAviso(`Amostra da carga nº ${editando.numero} atualizada.`);
      setEditando(null);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  const r = dados?.resumo;
  return (
    <>
      <CabecalhoDocumento
        modulo="Qualidade"
        titulo="Amostras e resultados"
        descricao="Slump e resistência de cada carga: os corpos de prova de cada idade e o exemplar (maior resultado)."
        periodo={textoDias(periodo)}
      />
      <SeletorDias valor={periodo} aoMudar={setPeriodo} />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok nao-imprimir" role="status">{aviso}</div>}
      {r && (
        <div className="grade">
          <div className="card indicador">
            <span className="rotulo-ind">Amostras</span>
            <span className="valor-ind mono">{r.cargas}</span>
            <span className="small muted">{r.exemplares} com resultado aos {dados!.idadeControle} dias</span>
          </div>
          <div className="card indicador">
            <span className="rotulo-ind">Resistência média aos {dados!.idadeControle} dias</span>
            <span className="valor-ind mono">{mpa(r.media)}</span>
            <span className="small muted">desvio {r.desvio === null ? '—' : formatarNumero(r.desvio, 1)} MPa</span>
          </div>
          <div className="card indicador">
            <span className="rotulo-ind">Abaixo do fck</span>
            <span className={`valor-ind mono ${r.abaixoFck ? 'texto-perigo' : ''}`}>{r.abaixoFck}</span>
            <span className="small muted">{r.exemplares ? pct(r.abaixoFck / r.exemplares) : '—'} dos exemplares</span>
          </div>
          <div className="card indicador">
            <span className="rotulo-ind">Slump fora da faixa</span>
            <span className="valor-ind mono">{r.slumpFora}</span>
            <span className="small muted">{r.slumpMedidos ? pct(r.slumpFora / r.slumpMedidos) : '—'} das cargas medidas</span>
          </div>
        </div>
      )}
      <div className="segmentado nao-imprimir" role="group" aria-label="Filtro" style={{ marginBottom: 12 }}>
        {(
          [
            ['todas', 'Todas'],
            ['abaixo', 'Abaixo do fck'],
            ['slump', 'Slump fora'],
            ['aguardando', 'Aguardando resultado'],
          ] as const
        ).map(([id, t]) => (
          <button key={id} type="button" aria-pressed={filtro === id} className={filtro === id ? 'ativo' : ''} onClick={() => setFiltro(id)}>{t}</button>
        ))}
      </div>

      {editando && (
        <section className="card form nao-imprimir">
          <h2>Carga nº {editando.numero} · {editando.tracoCodigo}</h2>
          <div className="campos">
            <div className="campo">
              <label htmlFor="a-slump">Slump (cm){editando.faixa ? ` · faixa ${editando.faixa[0]} a ${editando.faixa[1]}` : ''}</label>
              <input id="a-slump" className="mono" inputMode="decimal" value={form.slump} onChange={(e) => setForm({ ...form, slump: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="a-temp">Temperatura do concreto (°C)</label>
              <input id="a-temp" className="mono" inputMode="decimal" value={form.temperatura} onChange={(e) => setForm({ ...form, temperatura: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="a-obs">Observação</label>
              <input id="a-obs" value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} />
            </div>
          </div>
          <div className="campos">
            {editando.idades.flatMap((i) =>
              i.cps.map((c) => (
                <div key={c.id} className="campo">
                  <label htmlFor={`cp-${c.id}`}>CP {c.numero} · {i.idade} dias (MPa)</label>
                  <input
                    id={`cp-${c.id}`}
                    className="mono"
                    inputMode="decimal"
                    disabled={c.situacao === 'descartado'}
                    placeholder={c.situacao === 'descartado' ? 'descartado' : `previsto ${formatarData(i.previsto)}`}
                    value={form.cps[c.id] ?? ''}
                    onChange={(e) => setForm({ ...form, cps: { ...form.cps, [c.id]: e.target.value } })}
                  />
                </div>
              )),
            )}
          </div>
          <div className="acoes">
            <button className="btn btn-primario" type="button" onClick={salvar}>Salvar</button>
            <button className="btn btn-link" type="button" onClick={() => setEditando(null)}>Cancelar</button>
          </div>
        </section>
      )}

      <section className="card tabela-caixa relatorio">
        {!dados ? (
          <p className="muted">Carregando…</p>
        ) : lista.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nenhuma amostra.</p>
        ) : (
          <table className="tabela tabela-compacta">
            <thead>
              <tr>
                <th>Data</th>
                <th>Carga</th>
                <th>Traço</th>
                <th>Cliente e obra</th>
                <th style={{ textAlign: 'right' }}>Slump</th>
                {dados.idades.map((i) => (
                  <th key={i} style={{ textAlign: 'right' }}>{i} dias</th>
                ))}
                <th>Situação</th>
                <th className="nao-imprimir" />
              </tr>
            </thead>
            <tbody>
              {lista.map((a) => (
                <tr key={a.amostraId} style={a.status === 'cancelada' ? { opacity: 0.5 } : undefined}>
                  <td>{diaCurto(a.dia)} {hora(a.dataHora)}</td>
                  <td className="mono">{a.numero}</td>
                  <td>
                    <span className="mono">{a.tracoCodigo}</span>
                    <div className="small muted">fck {a.fck ?? '—'} · {formatarNumero(a.volume, a.volume % 1 ? 1 : 0)} m³</div>
                  </td>
                  <td>
                    {a.clienteNome ?? '—'}
                    {a.obra && <div className="small muted">{a.obra}</div>}
                  </td>
                  <td className={`mono ${a.slumpFora ? 'texto-perigo' : ''}`} style={{ textAlign: 'right' }}>
                    {cm(a.slump)}
                    {a.slumpFora && <div className="small">fora de {a.faixa?.[0]} a {a.faixa?.[1]}</div>}
                  </td>
                  {dados.idades.map((idade) => {
                    const g = a.idades.find((x) => x.idade === idade);
                    return (
                      <td key={idade} className="mono" style={{ textAlign: 'right' }}>
                        {g?.exemplar !== null && g?.exemplar !== undefined ? mpa(g.exemplar) : g ? <span className="muted small">{formatarData(g.previsto)}</span> : '—'}
                        {g && g.cps.filter((c) => c.resistencia !== null).length > 1 && (
                          <div className="small muted">{g.cps.map((c) => (c.resistencia === null ? '—' : formatarNumero(c.resistencia, 1))).join(' / ')}</div>
                        )}
                      </td>
                    );
                  })}
                  <td>{a.status === 'cancelada' ? <span className="selo selo-neutro">carga cancelada</span> : <SeloConforme v={a.conforme} />}</td>
                  <td className="nao-imprimir" style={{ textAlign: 'right' }}>
                    {a.status === 'ativa' && <button className="btn btn-link" type="button" onClick={() => abrir(a)}>Corrigir</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

// ======================================================================= Resistência e fck estimado

type GrupoRes = ResumoQualidade & { traco: string };
type RespRes = {
  de: string; ate: string; idadeControle: number; idadeInicial: number; geral: ResumoQualidade; porTraco: GrupoRes[];
  porObra: (GrupoRes & { cliente: string; clienteId: string | null; obra: string })[]; evolucao: { traco: string; relacao: number | null; pares: number }[];
};

export function Resistencia() {
  const [periodo, setPeriodo] = useState<Dias>({ de: somarDias(hojeLocal(), -90), ate: hojeLocal() });
  const [d, setD] = useState<RespRes | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    api<RespRes>(`/qual/resistencia?de=${periodo.de}&ate=${periodo.ate}`).then(setD).catch((e) => setErro((e as Error).message));
  }, [periodo]);
  const colunas = (comObra: boolean) => [
    ...(comObra
      ? [
          { titulo: 'Cliente', valor: (l: RespRes['porObra'][number]) => l.cliente },
          { titulo: 'Obra', valor: (l: RespRes['porObra'][number]) => l.obra || '—' },
        ]
      : []),
    { titulo: 'Traço', valor: (l: GrupoRes) => l.traco },
    { titulo: 'fck', valor: (l: GrupoRes) => l.fck, formato: 'numero' as const },
    { titulo: 'Cargas', valor: (l: GrupoRes) => l.cargas, formato: 'numero' as const, total: true },
    { titulo: 'Exemplares', valor: (l: GrupoRes) => l.exemplares, formato: 'numero' as const, total: true },
    { titulo: 'Média (MPa)', valor: (l: GrupoRes) => l.media, formato: 'decimal' as const },
    { titulo: 'Desvio (MPa)', valor: (l: GrupoRes) => l.desvio, formato: 'decimal' as const },
    { titulo: 'Menor (MPa)', valor: (l: GrupoRes) => l.minimo, formato: 'decimal' as const },
    { titulo: 'fck estimado (MPa)', valor: (l: GrupoRes) => l.fckEstimado, formato: 'decimal' as const },
    { titulo: 'Abaixo do fck', valor: (l: GrupoRes) => l.abaixoFck, formato: 'numero' as const, total: true, destaque: (l: GrupoRes) => (l.abaixoFck ? ('perigo' as const) : undefined) },
    { titulo: 'Slump fora', valor: (l: GrupoRes) => (l.slumpMedidos ? `${l.slumpFora} de ${l.slumpMedidos}` : '—') },
    {
      titulo: 'Situação',
      valor: (l: GrupoRes) => (l.conforme === null ? 'aguardando' : l.conforme ? 'conforme' : 'não conforme'),
      destaque: (l: GrupoRes) => (l.conforme === false ? ('perigo' as const) : l.conforme ? ('ok' as const) : undefined),
    },
  ];
  return (
    <>
      <CabecalhoDocumento
        modulo="Qualidade"
        titulo="Resistência e fck estimado"
        descricao={`Resultados aos ${d?.idadeControle ?? 28} dias. Amostragem total (todas as cargas): até 20 exemplares, o fck estimado é o menor resultado; acima de 20, o de ordem 0,05·n (NBR 12655).`}
        periodo={textoDias(periodo)}
      />
      <SeletorDias valor={periodo} aoMudar={setPeriodo} />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {d && (
        <>
          <TabelaRelatorio titulo="Por traço" arquivo="resistencia-por-traco" linhas={d.porTraco} colunas={colunas(false) as never} />
          <TabelaRelatorio titulo="Por obra e traço" descricao="Cada obra e traço como um lote. A formação dos lotes conforme a norma é definida pelo responsável técnico." arquivo="resistencia-por-obra" linhas={d.porObra} colunas={colunas(true) as never} />
          <TabelaRelatorio
            titulo={`Evolução da resistência (${d.idadeInicial} ÷ ${d.idadeControle} dias)`}
            descricao="Quanto da resistência final o concreto já tem na primeira idade. Serve para prever o resultado final e detectar problema cedo."
            arquivo="resistencia-evolucao"
            linhas={d.evolucao}
            colunas={[
              { titulo: 'Traço', valor: (l) => l.traco },
              { titulo: 'Relação média', valor: (l) => l.relacao, formato: 'pct' },
              { titulo: 'Pares de resultados', valor: (l) => l.pares, formato: 'numero' },
            ]}
          />
        </>
      )}
    </>
  );
}

// ======================================================================= Laudo para o cliente

type Obra = { clienteId: string; cliente: string; obra: string; cargas: number; primeira: string; ultima: string };
type RespLaudo = {
  de: string; ate: string; idades: number[]; idadeControle: number; responsavel: { nome: string | null; registro: string | null };
  cliente: { razaoSocial: string; nomeFantasia: string | null; documento: string | null }; obra: string; amostras: Amostra[]; tracos: GrupoRes[]; pendentes: number;
};

export function Laudo() {
  const { empresa } = useSessao();
  const [obras, setObras] = useState<Obra[]>([]);
  const [sel, setSel] = useState('');
  const [periodo, setPeriodo] = useState<Dias>({ de: somarDias(hojeLocal(), -60), ate: hojeLocal() });
  const [d, setD] = useState<RespLaudo | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    api<{ obras: Obra[] }>('/qual/obras').then((r) => setObras(r.obras)).catch((e) => setErro((e as Error).message));
  }, []);
  const obra = obras.find((o) => `${o.clienteId}|${o.obra}` === sel);
  useEffect(() => {
    if (!obra) return setD(null);
    setErro('');
    api<RespLaudo>(`/qual/laudo?clienteId=${obra.clienteId}&obra=${encodeURIComponent(obra.obra)}&de=${periodo.de}&ate=${periodo.ate}`)
      .then(setD)
      .catch((e) => setErro((e as Error).message));
  }, [obra, periodo]);

  return (
    <>
      <CabecalhoDocumento
        modulo="Qualidade"
        titulo="Laudo de controle tecnológico do concreto"
        descricao={d ? `${d.cliente.razaoSocial}${d.cliente.documento ? ` · ${formatarDocumento(d.cliente.documento)}` : ''}${d.obra ? ` · Obra: ${d.obra}` : ''}` : 'Escolha a obra e o período.'}
        periodo={textoDias(periodo)}
      />
      <div className="filtros nao-imprimir">
        <select value={sel} onChange={(e) => setSel(e.target.value)} aria-label="Obra" style={{ minWidth: 280 }}>
          <option value="">Escolha a obra</option>
          {obras.map((o) => (
            <option key={`${o.clienteId}|${o.obra}`} value={`${o.clienteId}|${o.obra}`}>
              {o.cliente}{o.obra ? ` · ${o.obra}` : ''} ({o.cargas} cargas)
            </option>
          ))}
        </select>
      </div>
      <SeletorDias valor={periodo} aoMudar={setPeriodo} />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {d && (
        <>
          {d.pendentes > 0 && (
            <div className="alerta alerta-info nao-imprimir">{d.pendentes} carga(s) ainda sem o resultado aos {d.idadeControle} dias. O laudo sai como parcial até lá.</div>
          )}
          <section className="card tabela-caixa relatorio">
            <h2>Cargas e resultados</h2>
            <table className="tabela tabela-compacta">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Carga</th>
                  <th>Nota ou remessa</th>
                  <th>Traço</th>
                  <th style={{ textAlign: 'right' }}>m³</th>
                  <th style={{ textAlign: 'right' }}>Slump</th>
                  {d.idades.map((i) => (
                    <th key={i} style={{ textAlign: 'right' }}>{i} dias (MPa)</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.amostras.map((a) => (
                  <tr key={a.amostraId}>
                    <td>{formatarData(a.dia)}</td>
                    <td className="mono">{a.numero}</td>
                    <td className="mono">{a.documento ?? '—'}</td>
                    <td className="mono">{a.tracoCodigo}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{formatarNumero(a.volume, a.volume % 1 ? 1 : 0)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{cm(a.slump)}</td>
                    {d.idades.map((idade) => {
                      const g = a.idades.find((x) => x.idade === idade);
                      return (
                        <td key={idade} className="mono" style={{ textAlign: 'right' }}>
                          {g?.exemplar !== null && g?.exemplar !== undefined ? formatarNumero(g.exemplar, 1) : 'a romper'}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="card tabela-caixa relatorio">
            <h2>Resultado por traço</h2>
            <table className="tabela tabela-compacta">
              <thead>
                <tr>
                  <th>Traço</th>
                  <th style={{ textAlign: 'right' }}>fck (MPa)</th>
                  <th style={{ textAlign: 'right' }}>Volume</th>
                  <th style={{ textAlign: 'right' }}>Exemplares</th>
                  <th style={{ textAlign: 'right' }}>Média</th>
                  <th style={{ textAlign: 'right' }}>Desvio</th>
                  <th style={{ textAlign: 'right' }}>fck estimado</th>
                  <th>Conclusão</th>
                </tr>
              </thead>
              <tbody>
                {d.tracos.map((t) => (
                  <tr key={t.traco}>
                    <td className="mono">{t.traco}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{t.fck ?? '—'}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{formatarNumero(t.m3, 0)} m³</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{t.exemplares}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{t.media === null ? '—' : formatarNumero(t.media, 1)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{t.desvio === null ? '—' : formatarNumero(t.desvio, 1)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{t.fckEstimado === null ? '—' : formatarNumero(t.fckEstimado, 1)}</td>
                    <td>
                      {t.conforme === null ? 'Aguardando resultados' : t.conforme ? <b>Conforme: fck estimado ≥ fck</b> : <b className="texto-perigo">Não conforme: fck estimado abaixo do fck</b>}
                      {t.aguardando > 0 && t.conforme !== null && <div className="small muted">{t.aguardando} carga(s) ainda a romper</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small muted" style={{ marginTop: 10 }}>
              Ensaios de abatimento (NBR 16889), moldagem e cura (NBR 5738) e compressão (NBR 5739). Exemplar: maior resultado de 2 corpos de prova da mesma idade. fck estimado pela amostragem
              total da NBR 12655, considerando as cargas desta obra e deste traço no período como um lote.
            </p>
          </section>
          <section className="card relatorio" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
            <div>
              <div style={{ borderTop: '1px solid var(--ink)', paddingTop: 6, marginTop: 40 }}>
                <b>{d.responsavel.nome ?? 'Responsável técnico'}</b>
                <div className="small muted">{d.responsavel.registro ?? 'Informe o responsável em Qualidade › Configurações'}</div>
              </div>
            </div>
            <div className="small muted" style={{ alignSelf: 'end' }}>
              {empresa?.razaoSocial} · emitido em {formatarData(hojeLocal())}
            </div>
          </section>
        </>
      )}
    </>
  );
}

// ======================================================================= Painel do laboratório (início do laboratorista)

type PainelQual = {
  hoje: string;
  pendentes?: number;
  cps: { hoje: number; atrasados: number; amanha: number };
  abaixoFck: { amostraId: string; numero: number; dia: string; tracoCodigo: string; fck: number | null; resultado: number | null; clienteNome: string | null; obra: string | null }[];
  equipamentos: { vencidos: number; vencendo: number };
  umidade: { insumoId: string; nome: string; data: string; umidade: number | null }[];
};

export function InicioLaboratorio() {
  const [d, setD] = useState<PainelQual | null>(null);
  useEffect(() => {
    api<PainelQual>('/qual/painel').then(setD).catch(() => {});
  }, []);
  return (
    <>
      {d && (d.pendentes ?? 0) > 0 && (
        <div className="card form">
          <h2>Cargas a amostrar <span className="selo selo-aviso">{d.pendentes}</span></h2>
          <p className="muted" style={{ margin: 0 }}>Cargas registradas que esperam a confirmação da moldagem dos corpos de prova.</p>
          <Link to="/qual/demandas" className="btn btn-primario btn-bloco">Confirmar moldagem</Link>
        </div>
      )}
      <div className="card form">
        <h2>Corpos de prova de hoje</h2>
        <p className="muted" style={{ margin: 0 }}>
          {d ? `${d.cps.hoje} para romper hoje${d.cps.atrasados ? ` e ${d.cps.atrasados} atrasado(s)` : ''}.` : 'Carregando…'}
        </p>
        <Link to="/qual/cps" className="btn btn-primario btn-bloco">Lançar resultados</Link>
      </div>
      {d && (
        <div className="grade-larga">
          <div className="card">
            <h2>Umidade da areia</h2>
            {d.umidade.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>Nenhuma medição ainda.</p>
            ) : (
              d.umidade.map((u) => (
                <p key={u.insumoId} style={{ margin: '4px 0' }}>
                  {u.nome}: <b className="mono">{u.umidade === null ? '—' : `${formatarNumero(u.umidade, 1)}%`}</b>{' '}
                  <span className={`small ${u.data === d.hoje ? 'muted' : 'texto-perigo'}`}>{u.data === d.hoje ? 'medida hoje' : `última em ${formatarData(u.data)}`}</span>
                </p>
              ))
            )}
            <Link className="btn btn-link" to="/qual/insumos">Registrar umidade</Link>
          </div>
          <div className="card">
            <h2>Atenção</h2>
            <ul className="lista-alertas" style={{ margin: 0 }}>
              {d.abaixoFck.length > 0 && <li><Link to="/qual/amostras">{d.abaixoFck.length} resultado(s) abaixo do fck nos últimos 60 dias</Link></li>}
              {d.equipamentos.vencidos > 0 && <li><Link to="/qual/equipamentos">{d.equipamentos.vencidos} equipamento(s) com calibração vencida</Link></li>}
              {d.equipamentos.vencendo > 0 && <li><Link to="/qual/equipamentos">{d.equipamentos.vencendo} calibração(ões) vencendo em 30 dias</Link></li>}
              {!d.abaixoFck.length && !d.equipamentos.vencidos && !d.equipamentos.vencendo && <li className="muted">Nada pendente.</li>}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

