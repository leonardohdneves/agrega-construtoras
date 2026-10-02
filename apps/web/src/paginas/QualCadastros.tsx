import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  api,
  formatarData,
  formatarNumero,
  hojeLocal,
  NOMES_TIPO_EQUIP,
  somarDias,
  type ConfigQualidade,
  type Equipamento,
  type Insumo,
} from '../api';
import { CabecalhoDocumento } from '../componentes/Documento';
import { useSessao } from '../sessao';
import { SeletorDias, textoDias, type Dias } from './ProdMotoristas';

// ======================================================================= Equipamentos

type FormEquip = { id?: string; nome: string; tipo: Equipamento['tipo']; identificacao: string; ultimaCalibracao: string; validadeDias: string; certificado: string; laboratorio: string; observacoes: string; ativo: boolean };
const EQUIP_VAZIO: FormEquip = { nome: '', tipo: 'balanca', identificacao: '', ultimaCalibracao: '', validadeDias: '365', certificado: '', laboratorio: '', observacoes: '', ativo: true };

export function Equipamentos() {
  const [lista, setLista] = useState<Equipamento[] | null>(null);
  const [form, setForm] = useState<FormEquip | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  const carregar = useCallback(async () => {
    try {
      setLista((await api<{ equipamentos: Equipamento[] }>('/qual/equipamentos')).equipamentos);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setErro('');
    try {
      const corpo = {
        nome: form.nome,
        tipo: form.tipo,
        identificacao: form.identificacao,
        ultimaCalibracao: form.ultimaCalibracao,
        validadeDias: form.validadeDias ? Number(form.validadeDias) : null,
        certificado: form.certificado,
        laboratorio: form.laboratorio,
        observacoes: form.observacoes,
        ativo: form.ativo,
      };
      if (form.id) await api(`/qual/equipamentos/${form.id}`, { metodo: 'PATCH', corpo });
      else await api('/qual/equipamentos', { corpo });
      setAviso(`${form.nome} ${form.id ? 'atualizado' : 'cadastrado'}.`);
      setForm(null);
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  const selo = (x: Equipamento) =>
    x.situacao === 'vencido' ? <span className="selo selo-perigo">vencida há {-(x.dias ?? 0)} dias</span>
      : x.situacao === 'vencendo' ? <span className="selo selo-aviso">vence em {x.dias} dias</span>
        : x.situacao === 'em_dia' ? <span className="selo selo-ok">em dia</span> : <span className="selo selo-neutro">sem data</span>;

  return (
    <>
      <CabecalhoDocumento modulo="Qualidade" titulo="Equipamentos e calibração" descricao="Balanças da central, prensa, cones e demais equipamentos, com a validade da calibração." />
      <div className="acoes nao-imprimir" style={{ marginBottom: 12 }}>
        {!form && <button className="btn btn-primario" type="button" onClick={() => setForm(EQUIP_VAZIO)}>Novo equipamento</button>}
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok nao-imprimir" role="status">{aviso}</div>}
      {form && (
        <form className="card form nao-imprimir" onSubmit={salvar}>
          <h2>{form.id ? `Editar ${form.nome}` : 'Novo equipamento'}</h2>
          <div className="campos">
            <div className="campo">
              <label htmlFor="eq-nome">Nome</label>
              <input id="eq-nome" value={form.nome} placeholder="ex.: Balança de cimento da central" onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="eq-tipo">Tipo</label>
              <select id="eq-tipo" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as Equipamento['tipo'] })}>
                {(Object.keys(NOMES_TIPO_EQUIP) as Equipamento['tipo'][]).map((t) => (
                  <option key={t} value={t}>{NOMES_TIPO_EQUIP[t]}</option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="eq-id">Identificação</label>
              <input id="eq-id" value={form.identificacao} placeholder="código, série, faixa" onChange={(e) => setForm({ ...form, identificacao: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="eq-cal">Última calibração</label>
              <input id="eq-cal" type="date" value={form.ultimaCalibracao} onChange={(e) => setForm({ ...form, ultimaCalibracao: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="eq-val">Validade (dias)</label>
              <input id="eq-val" className="mono" inputMode="numeric" value={form.validadeDias} onChange={(e) => setForm({ ...form, validadeDias: e.target.value.replace(/\D/g, '') })} />
            </div>
            <div className="campo">
              <label htmlFor="eq-cert">Certificado</label>
              <input id="eq-cert" value={form.certificado} onChange={(e) => setForm({ ...form, certificado: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="eq-lab">Laboratório que calibrou</label>
              <input id="eq-lab" value={form.laboratorio} onChange={(e) => setForm({ ...form, laboratorio: e.target.value })} />
            </div>
          </div>
          {form.id && (
            <label className="marcar">
              <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} />
              Equipamento em uso
            </label>
          )}
          <div className="acoes">
            <button className="btn btn-primario" type="submit">Salvar</button>
            <button className="btn btn-link" type="button" onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </form>
      )}
      <section className="card tabela-caixa relatorio">
        {!lista ? (
          <p className="muted">Carregando…</p>
        ) : lista.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nenhum equipamento cadastrado.</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr>
                <th>Equipamento</th>
                <th>Tipo</th>
                <th>Última calibração</th>
                <th>Próxima</th>
                <th>Situação</th>
                <th>Certificado</th>
                <th className="nao-imprimir" />
              </tr>
            </thead>
            <tbody>
              {lista.map((x) => (
                <tr key={x.id} style={x.ativo ? undefined : { opacity: 0.55 }}>
                  <td>
                    {x.nome}
                    {x.identificacao && <div className="small muted">{x.identificacao}</div>}
                  </td>
                  <td>{NOMES_TIPO_EQUIP[x.tipo]}</td>
                  <td>{x.ultimaCalibracao ? formatarData(x.ultimaCalibracao) : '—'}</td>
                  <td>{x.proximaCalibracao ? formatarData(x.proximaCalibracao) : '—'}</td>
                  <td>{selo(x)}</td>
                  <td>
                    {x.certificado ?? '—'}
                    {x.laboratorio && <div className="small muted">{x.laboratorio}</div>}
                  </td>
                  <td className="nao-imprimir" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      className="btn btn-link"
                      type="button"
                      onClick={() => setForm({ ...EQUIP_VAZIO, ...Object.fromEntries(Object.entries(x).map(([k, v]) => [k, v === null ? '' : v])), validadeDias: x.validadeDias ? String(x.validadeDias) : '', ativo: x.ativo } as FormEquip)}
                    >
                      Editar
                    </button>
                    <button
                      className="btn btn-link"
                      type="button"
                      onClick={async () => {
                        try {
                          await api(`/qual/equipamentos/${x.id}`, { metodo: 'PATCH', corpo: { ultimaCalibracao: hojeLocal() } });
                          setAviso(`Calibração de ${x.nome} registrada hoje. Atualize o certificado em Editar.`);
                          await carregar();
                        } catch (e) {
                          setErro((e as Error).message);
                        }
                      }}
                    >
                      Calibrado hoje
                    </button>
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

// ======================================================================= Ensaios de insumos

type Ensaio = {
  id: string; insumoId: string; insumoNome: string; insumoTipo: string; data: string; tipo: 'umidade' | 'granulometria'; umidade: number | null; moduloFinura: number | null;
  dimensaoMaxima: number | null; pulverulento: number | null; observacao: string | null; registradoPor: string | null;
};
type Correcao = { traco: string; areias: { nome: string; seca: number; umidade: number | null; data: string | null; umida: number | null }[]; aguaTraco: number | null; aguaCorrigida: number | null };

export function EnsaiosInsumos() {
  const [periodo, setPeriodo] = useState<Dias>({ de: somarDias(hojeLocal(), -30), ate: hojeLocal() });
  const [dados, setDados] = useState<{ ensaios: Ensaio[]; correcoes: Correcao[] } | null>(null);
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [novo, setNovo] = useState({ tipo: 'umidade' as Ensaio['tipo'], insumoId: '', data: hojeLocal(), umidade: '', moduloFinura: '', dimensaoMaxima: '', pulverulento: '', observacao: '' });
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  const carregar = useCallback(async () => {
    try {
      setDados(await api(`/qual/ensaios?de=${periodo.de}&ate=${periodo.ate}`));
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [periodo]);
  useEffect(() => {
    carregar();
  }, [carregar]);
  useEffect(() => {
    api<{ insumos: Insumo[] }>('/prod/insumos')
      .then((r) => {
        const agregados = r.insumos.filter((i) => i.ativo && (i.tipo === 'areia' || i.tipo === 'brita'));
        setInsumos(agregados);
        setNovo((n) => ({ ...n, insumoId: n.insumoId || agregados.find((i) => i.tipo === 'areia')?.id || '' }));
      })
      .catch(() => {});
  }, []);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setAviso('');
    try {
      await api('/qual/ensaios', {
        corpo: {
          insumoId: novo.insumoId,
          data: novo.data,
          tipo: novo.tipo,
          umidade: novo.tipo === 'umidade' ? novo.umidade : null,
          moduloFinura: novo.tipo === 'granulometria' && novo.moduloFinura ? novo.moduloFinura : null,
          dimensaoMaxima: novo.tipo === 'granulometria' && novo.dimensaoMaxima ? novo.dimensaoMaxima : null,
          pulverulento: novo.tipo === 'granulometria' && novo.pulverulento ? novo.pulverulento : null,
          observacao: novo.observacao,
        },
      });
      setAviso(novo.tipo === 'umidade' ? 'Umidade registrada. A correção de água dos traços já usa este valor.' : 'Granulometria registrada.');
      setNovo({ ...novo, umidade: '', moduloFinura: '', dimensaoMaxima: '', pulverulento: '', observacao: '' });
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  return (
    <>
      <CabecalhoDocumento modulo="Qualidade" titulo="Ensaios de insumos" descricao="Umidade da areia (com a correção de água dos traços) e granulometria dos agregados." periodo={textoDias(periodo)} />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok nao-imprimir" role="status">{aviso}</div>}

      <form className="card form nao-imprimir" onSubmit={salvar}>
        <div className="segmentado" role="group" aria-label="Ensaio" style={{ maxWidth: 360 }}>
          <button type="button" aria-pressed={novo.tipo === 'umidade'} className={novo.tipo === 'umidade' ? 'ativo' : ''} onClick={() => setNovo({ ...novo, tipo: 'umidade' })}>Umidade</button>
          <button type="button" aria-pressed={novo.tipo === 'granulometria'} className={novo.tipo === 'granulometria' ? 'ativo' : ''} onClick={() => setNovo({ ...novo, tipo: 'granulometria' })}>Granulometria</button>
        </div>
        <div className="campos">
          <div className="campo">
            <label htmlFor="en-ins">Insumo</label>
            <select id="en-ins" value={novo.insumoId} onChange={(e) => setNovo({ ...novo, insumoId: e.target.value })}>
              <option value="">Escolha</option>
              {insumos.map((i) => (
                <option key={i.id} value={i.id}>{i.nome}</option>
              ))}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="en-data">Data</label>
            <input id="en-data" type="date" max={hojeLocal()} value={novo.data} onChange={(e) => setNovo({ ...novo, data: e.target.value })} />
          </div>
          {novo.tipo === 'umidade' ? (
            <div className="campo">
              <label htmlFor="en-u">Umidade (%)</label>
              <input id="en-u" className="mono" inputMode="decimal" placeholder="ex.: 5,2" value={novo.umidade} onChange={(e) => setNovo({ ...novo, umidade: e.target.value })} />
            </div>
          ) : (
            <>
              <div className="campo">
                <label htmlFor="en-mf">Módulo de finura</label>
                <input id="en-mf" className="mono" inputMode="decimal" value={novo.moduloFinura} onChange={(e) => setNovo({ ...novo, moduloFinura: e.target.value })} />
              </div>
              <div className="campo">
                <label htmlFor="en-dm">Dimensão máxima (mm)</label>
                <input id="en-dm" className="mono" inputMode="decimal" value={novo.dimensaoMaxima} onChange={(e) => setNovo({ ...novo, dimensaoMaxima: e.target.value })} />
              </div>
              <div className="campo">
                <label htmlFor="en-pv">Material pulverulento (%)</label>
                <input id="en-pv" className="mono" inputMode="decimal" value={novo.pulverulento} onChange={(e) => setNovo({ ...novo, pulverulento: e.target.value })} />
              </div>
            </>
          )}
        </div>
        <div className="acoes">
          <button className="btn btn-primario" type="submit">Registrar</button>
        </div>
      </form>

      {dados && dados.correcoes.some((c) => c.aguaCorrigida !== null) && (
        <section className="card tabela-caixa relatorio">
          <h2>Correção de umidade dos traços (por m³)</h2>
          <p className="small muted" style={{ marginTop: 0 }}>A água que vem na areia sai da água do traço, e a areia pesada na balança aumenta na mesma proporção.</p>
          <table className="tabela tabela-compacta">
            <thead>
              <tr>
                <th>Traço</th>
                <th>Areia</th>
                <th style={{ textAlign: 'right' }}>Umidade</th>
                <th style={{ textAlign: 'right' }}>Areia seca</th>
                <th style={{ textAlign: 'right' }}>Areia a pesar</th>
                <th style={{ textAlign: 'right' }}>Água do traço</th>
                <th style={{ textAlign: 'right' }}>Água a adicionar</th>
              </tr>
            </thead>
            <tbody>
              {dados.correcoes.flatMap((c) =>
                c.areias.map((a, k) => (
                  <tr key={`${c.traco}-${k}`}>
                    <td className="mono">{c.traco}</td>
                    <td>{a.nome}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>
                      {a.umidade === null ? '—' : `${formatarNumero(a.umidade, 1)}%`}
                      {a.data && <div className="small muted">{formatarData(a.data)}</div>}
                    </td>
                    <td className="mono" style={{ textAlign: 'right' }}>{formatarNumero(a.seca)} kg</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{a.umida === null ? '—' : `${formatarNumero(a.umida)} kg`}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{c.aguaTraco === null ? '—' : `${formatarNumero(c.aguaTraco)} L`}</td>
                    <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{c.aguaCorrigida === null ? '—' : `${formatarNumero(c.aguaCorrigida)} L`}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </section>
      )}

      <SeletorDias valor={periodo} aoMudar={setPeriodo} />
      <section className="card tabela-caixa relatorio">
        <h2>Ensaios do período</h2>
        {!dados || dados.ensaios.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nenhum ensaio no período.</p>
        ) : (
          <table className="tabela tabela-compacta">
            <thead>
              <tr>
                <th>Data</th>
                <th>Insumo</th>
                <th>Ensaio</th>
                <th>Resultado</th>
                <th>Por</th>
                <th className="nao-imprimir" />
              </tr>
            </thead>
            <tbody>
              {dados.ensaios.map((x) => (
                <tr key={x.id}>
                  <td>{formatarData(x.data)}</td>
                  <td>{x.insumoNome}</td>
                  <td>{x.tipo === 'umidade' ? 'Umidade' : 'Granulometria'}</td>
                  <td className="mono">
                    {x.tipo === 'umidade'
                      ? `${formatarNumero(x.umidade ?? 0, 1)}%`
                      : [x.moduloFinura !== null ? `MF ${formatarNumero(x.moduloFinura, 2)}` : null, x.dimensaoMaxima !== null ? `Dmáx ${formatarNumero(x.dimensaoMaxima, 1)} mm` : null, x.pulverulento !== null ? `pulverulento ${formatarNumero(x.pulverulento, 1)}%` : null]
                          .filter(Boolean)
                          .join(' · ')}
                  </td>
                  <td className="small muted">{x.registradoPor ?? ''}</td>
                  <td className="nao-imprimir" style={{ textAlign: 'right' }}>
                    <button
                      className="btn btn-link"
                      type="button"
                      onClick={async () => {
                        try {
                          await api(`/qual/ensaios/${x.id}`, { metodo: 'DELETE' });
                          await carregar();
                        } catch (e) {
                          setErro((e as Error).message);
                        }
                      }}
                    >
                      Excluir
                    </button>
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

// ======================================================================= Configuração

export function ConfigQualidade() {
  const { usuario } = useSessao();
  const gestao = usuario?.perfil === 'dono' || usuario?.perfil === 'gestor';
  const [f, setF] = useState<{ idades: string; cpsPorIdade: string; idadeControle: string; diametroMm: string; responsavelNome: string; responsavelRegistro: string } | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  useEffect(() => {
    api<{ config: ConfigQualidade }>('/qual/config')
      .then(({ config: c }) =>
        setF({ idades: c.idades.join(', '), cpsPorIdade: String(c.cpsPorIdade), idadeControle: String(c.idadeControle), diametroMm: String(c.diametroMm), responsavelNome: c.responsavelNome ?? '', responsavelRegistro: c.responsavelRegistro ?? '' }),
      )
      .catch((e) => setErro((e as Error).message));
  }, []);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!f) return;
    setErro('');
    setAviso('');
    try {
      await api('/qual/config', {
        metodo: 'PUT',
        corpo: {
          idades: f.idades.split(/[,;\s]+/).filter(Boolean).map(Number),
          cpsPorIdade: Number(f.cpsPorIdade),
          idadeControle: Number(f.idadeControle),
          diametroMm: Number(f.diametroMm),
          responsavelNome: f.responsavelNome,
          responsavelRegistro: f.responsavelRegistro,
        },
      });
      setAviso('Configuração salva. Vale para as próximas cargas.');
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Configurações da qualidade</h1>
          <span className="muted">Idades de rompimento, corpos de prova por idade e responsável técnico do laudo.</span>
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}
      {f && (
        <form className="card form" onSubmit={salvar}>
          <div className="campos">
            <div className="campo">
              <label htmlFor="q-idades">Idades de rompimento (dias)</label>
              <input id="q-idades" className="mono" value={f.idades} disabled={!gestao} onChange={(e) => setF({ ...f, idades: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="q-cps">CPs por idade</label>
              <select id="q-cps" value={f.cpsPorIdade} disabled={!gestao} onChange={(e) => setF({ ...f, cpsPorIdade: e.target.value })}>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="q-ctrl">Idade de controle (fck)</label>
              <input id="q-ctrl" className="mono" inputMode="numeric" value={f.idadeControle} disabled={!gestao} onChange={(e) => setF({ ...f, idadeControle: e.target.value.replace(/\D/g, '') })} />
            </div>
            <div className="campo">
              <label htmlFor="q-diam">Diâmetro do CP (mm)</label>
              <select id="q-diam" value={f.diametroMm} disabled={!gestao} onChange={(e) => setF({ ...f, diametroMm: e.target.value })}>
                <option value="100">100 (10 × 20 cm)</option>
                <option value="150">150 (15 × 30 cm)</option>
              </select>
            </div>
            <div className="campo">
              <label htmlFor="q-resp">Responsável técnico</label>
              <input id="q-resp" value={f.responsavelNome} disabled={!gestao} onChange={(e) => setF({ ...f, responsavelNome: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="q-reg">Registro (CREA/CFT)</label>
              <input id="q-reg" value={f.responsavelRegistro} disabled={!gestao} onChange={(e) => setF({ ...f, responsavelRegistro: e.target.value })} />
            </div>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Padrão: 2 CPs aos 7 e aos 28 dias, controle aos 28 dias. Mudanças valem para as cargas registradas daqui em diante.
          </p>
          {gestao && (
            <div className="acoes">
              <button className="btn btn-primario" type="submit">Salvar</button>
            </div>
          )}
        </form>
      )}
    </>
  );
}
