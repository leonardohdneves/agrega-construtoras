import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  api,
  formatarMoeda,
  formatarNumero,
  lerNumero,
  NOMES_TIPO_INSUMO,
  NOMES_UNIDADE,
  type Insumo,
  type TipoInsumo,
  type Traco,
  type UnidadeInsumo,
} from '../api';
import { useSessao } from '../sessao';

// ======================================================================= Traços

type DadosTraco = { id?: string; codigo: string; descricao: string; fck: string; slump: string; brita: string; observacoes: string; ativo: boolean; itens: { insumoId: string; quantidade: string }[] };
const TRACO_VAZIO: DadosTraco = { codigo: '', descricao: '', fck: '', slump: '', brita: '', observacoes: '', ativo: true, itens: [] };

function paraForm(t: Traco): DadosTraco {
  return {
    id: t.id,
    codigo: t.codigo,
    descricao: t.descricao ?? '',
    fck: t.fck ? String(t.fck) : '',
    slump: t.slump ?? '',
    brita: t.brita ?? '',
    observacoes: t.observacoes ?? '',
    ativo: t.ativo,
    itens: t.itens.map((i) => ({ insumoId: i.insumoId, quantidade: String(i.quantidade).replace('.', ',') })),
  };
}

export function Tracos() {
  const { usuario } = useSessao();
  const gestao = usuario?.perfil === 'dono' || usuario?.perfil === 'gestor';
  const [tracos, setTracos] = useState<Traco[] | null>(null);
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [form, setForm] = useState<DadosTraco | null>(null);
  const [inativos, setInativos] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [t, i] = await Promise.all([api<{ tracos: Traco[] }>(`/prod/tracos${inativos ? '?todos=1' : ''}`), api<{ insumos: Insumo[] }>('/prod/insumos')]);
      setTracos(t.tracos);
      setInsumos(i.insumos);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [inativos]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  const insumoDe = (id: string) => insumos.find((i) => i.id === id);
  const custoPrevia = form
    ? form.itens.reduce((s, it) => {
        const ins = insumoDe(it.insumoId);
        const q = lerNumero(it.quantidade) ?? 0;
        return s + (ins?.custoUnitario ?? 0) * q;
      }, 0)
    : 0;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setErro('');
    setAviso('');
    const itens = form.itens.filter((i) => i.insumoId).map((i) => ({ insumoId: i.insumoId, quantidade: lerNumero(i.quantidade) ?? 0 }));
    if (itens.some((i) => !(i.quantidade > 0))) return setErro('Informe a quantidade de cada insumo por m³.');
    setOcupado(true);
    try {
      const corpo = {
        codigo: form.codigo,
        descricao: form.descricao,
        fck: form.fck ? Number(form.fck) : null,
        slump: form.slump,
        brita: form.brita,
        observacoes: form.observacoes,
        ativo: form.ativo,
        itens,
      };
      if (form.id) await api(`/prod/tracos/${form.id}`, { metodo: 'PATCH', corpo });
      else await api('/prod/tracos', { corpo });
      setAviso(`Traço ${form.codigo} ${form.id ? 'atualizado' : 'cadastrado'}.`);
      setForm(null);
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Traços</h1>
          <span className="muted">Receita de cada concreto: quanto de cada insumo vai em 1 m³ e quanto custa.</span>
        </div>
        {gestao && !form && (
          <button className="btn btn-primario" type="button" onClick={() => setForm({ ...TRACO_VAZIO, itens: insumos.filter((i) => i.ativo && i.tipo !== 'fibra' && i.tipo !== 'outro').slice(0, 5).map((i) => ({ insumoId: i.id, quantidade: '' })) })}>
            Novo traço
          </button>
        )}
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}
      {gestao && insumos.length === 0 && tracos && (
        <div className="alerta alerta-info">Cadastre primeiro os insumos (cimento, areia, brita, água, aditivo) em Produção › Insumos.</div>
      )}

      {form && (
        <form className="card form" onSubmit={salvar}>
          <h2>{form.id ? `Editar ${form.codigo}` : 'Novo traço'}</h2>
          <div className="campos">
            <div className="campo">
              <label htmlFor="t-cod">Código</label>
              <input id="t-cod" className="mono" placeholder="ex.: C25-S100-B1" value={form.codigo} onChange={(e) => setForm({ ...form, codigo: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="t-desc">Descrição</label>
              <input id="t-desc" placeholder="ex.: Concreto convencional fck 25" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="t-fck">fck (MPa)</label>
              <input id="t-fck" className="mono" inputMode="numeric" value={form.fck} onChange={(e) => setForm({ ...form, fck: e.target.value.replace(/\D/g, '') })} />
            </div>
            <div className="campo">
              <label htmlFor="t-slump">Slump (cm)</label>
              <input id="t-slump" className="mono" placeholder="ex.: 10 ± 2" value={form.slump} onChange={(e) => setForm({ ...form, slump: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="t-brita">Brita</label>
              <input id="t-brita" placeholder="ex.: Brita 1" value={form.brita} onChange={(e) => setForm({ ...form, brita: e.target.value })} />
            </div>
          </div>

          <h3 className="sub-titulo">Consumo por m³</h3>
          <table className="tabela tabela-compacta">
            <thead>
              <tr>
                <th>Insumo</th>
                <th style={{ textAlign: 'right', width: 140 }}>Quantidade por m³</th>
                <th style={{ textAlign: 'right' }}>Custo por m³</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {form.itens.map((it, k) => {
                const ins = insumoDe(it.insumoId);
                const q = lerNumero(it.quantidade) ?? 0;
                return (
                  <tr key={k}>
                    <td>
                      <select
                        aria-label="Insumo"
                        value={it.insumoId}
                        onChange={(e) => setForm({ ...form, itens: form.itens.map((x, j) => (j === k ? { ...x, insumoId: e.target.value } : x)) })}
                      >
                        <option value="">Escolha</option>
                        {insumos.filter((i) => i.ativo || i.id === it.insumoId).map((i) => (
                          <option key={i.id} value={i.id} disabled={form.itens.some((x, j) => j !== k && x.insumoId === i.id)}>
                            {i.nome}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        <input
                          aria-label="Quantidade por m³"
                          className="mono"
                          inputMode="decimal"
                          style={{ width: 90, textAlign: 'right' }}
                          value={it.quantidade}
                          onChange={(e) => setForm({ ...form, itens: form.itens.map((x, j) => (j === k ? { ...x, quantidade: e.target.value } : x)) })}
                        />
                        <span className="small muted">{ins ? NOMES_UNIDADE[ins.unidade] : ''}</span>
                      </span>
                    </td>
                    <td className="mono" style={{ textAlign: 'right' }}>{ins?.custoUnitario !== null && ins?.custoUnitario !== undefined && q ? formatarMoeda(ins.custoUnitario * q) : '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-link" type="button" onClick={() => setForm({ ...form, itens: form.itens.filter((_, j) => j !== k) })}>
                        Tirar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>
                  <button className="btn btn-link" type="button" onClick={() => setForm({ ...form, itens: [...form.itens, { insumoId: '', quantidade: '' }] })}>
                    + Insumo
                  </button>
                </td>
                <td className="muted small" style={{ textAlign: 'right' }}>Custo teórico do m³</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{formatarMoeda(custoPrevia)}</td>
                <td />
              </tr>
            </tfoot>
          </table>

          <div className="campo">
            <label htmlFor="t-obs">Observações</label>
            <input id="t-obs" value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
          </div>
          {form.id && (
            <label className="marcar">
              <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} />
              Traço em uso (desmarque para tirar da lista de cargas)
            </label>
          )}
          <div className="acoes">
            <button className="btn btn-primario" type="submit" disabled={ocupado}>Salvar traço</button>
            <button className="btn btn-link" type="button" onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </form>
      )}

      {tracos && tracos.length === 0 && !form && <div className="card muted">Nenhum traço cadastrado.</div>}
      <div className="grade-larga">
        {(tracos ?? []).map((t) => (
          <section key={t.id} className="card" style={t.ativo ? undefined : { opacity: 0.6 }}>
            <div className="cartao-topo">
              <h2 className="mono" style={{ margin: 0 }}>{t.codigo}</h2>
              {gestao && !form && (
                <button className="btn btn-link" type="button" onClick={() => setForm(paraForm(t))}>Editar</button>
              )}
            </div>
            <p className="muted small" style={{ margin: '2px 0 10px' }}>
              {[t.descricao, t.fck ? `fck ${t.fck} MPa` : null, t.slump ? `slump ${t.slump}` : null, t.brita].filter(Boolean).join(' · ')}
              {!t.ativo && ' · fora de uso'}
            </p>
            <table className="tabela tabela-compacta">
              <tbody>
                {t.itens.map((i) => (
                  <tr key={i.insumoId}>
                    <td>{i.nome}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{formatarNumero(i.quantidade, i.quantidade < 10 ? 1 : 0)} {NOMES_UNIDADE[i.unidade]}</td>
                    {gestao && <td className="mono muted" style={{ textAlign: 'right' }}>{i.custo !== null ? formatarMoeda(i.custo) : '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, gap: 12, flexWrap: 'wrap' }}>
              <span className="small muted">Cimento: <b className="mono">{formatarNumero(t.cimentoKgM3)} kg/m³</b></span>
              {gestao && (
                <span className="small muted">
                  Custo teórico: <b className="mono">{t.custoM3 !== null ? formatarMoeda(t.custoM3) : '—'}/m³</b>
                  {t.custoIncompleto && <span className="texto-perigo"> (falta custo de insumo)</span>}
                </span>
              )}
            </div>
          </section>
        ))}
      </div>
      {gestao && (
        <label className="marcar" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} />
          Mostrar traços fora de uso
        </label>
      )}
    </>
  );
}

// ======================================================================= Insumos

type DadosInsumo = { id?: string; nome: string; tipo: TipoInsumo; unidade: UnidadeInsumo; custoUnitario: string; estoqueMinimo: string; ativo: boolean; controlaEstoque: boolean };
const INSUMO_VAZIO: DadosInsumo = { nome: '', tipo: 'cimento', unidade: 'kg', custoUnitario: '', estoqueMinimo: '', ativo: true, controlaEstoque: true };

export function Insumos() {
  const [lista, setLista] = useState<Insumo[] | null>(null);
  const [form, setForm] = useState<DadosInsumo | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setLista((await api<{ insumos: Insumo[] }>('/prod/insumos')).insumos);
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
    setAviso('');
    setOcupado(true);
    try {
      const corpo = {
        nome: form.nome,
        tipo: form.tipo,
        unidade: form.unidade,
        custoUnitario: form.custoUnitario.trim() ? lerNumero(form.custoUnitario) : null,
        estoqueMinimo: form.estoqueMinimo.trim() ? lerNumero(form.estoqueMinimo) : null,
        ativo: form.ativo,
        controlaEstoque: form.controlaEstoque,
      };
      if (form.id) await api(`/prod/insumos/${form.id}`, { metodo: 'PATCH', corpo });
      else await api('/prod/insumos', { corpo });
      setAviso(`${form.nome} ${form.id ? 'atualizado' : 'cadastrado'}.`);
      setForm(null);
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const custo = (i: Insumo) => {
    if (i.custoUnitario === null) return '—';
    const casas = i.custoUnitario < 0.1 ? 4 : i.custoUnitario < 1 ? 3 : 2;
    return `R$ ${i.custoUnitario.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: casas })}/${NOMES_UNIDADE[i.unidade]}`;
  };

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Insumos</h1>
          <span className="muted">Materiais usados nos traços. O custo de cada um entra no custo teórico do m³.</span>
        </div>
        {!form && (
          <button className="btn btn-primario" type="button" onClick={() => setForm(INSUMO_VAZIO)}>Novo insumo</button>
        )}
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}

      {form && (
        <form className="card form" onSubmit={salvar}>
          <h2>{form.id ? `Editar ${form.nome}` : 'Novo insumo'}</h2>
          <div className="campos">
            <div className="campo">
              <label htmlFor="i-nome">Nome</label>
              <input id="i-nome" placeholder="ex.: Cimento CP II-F 40" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="i-tipo">Tipo</label>
              <select id="i-tipo" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as TipoInsumo, unidade: e.target.value === 'agua' || e.target.value === 'aditivo' ? 'L' : form.unidade, controlaEstoque: e.target.value !== 'agua' })}>
                {(Object.keys(NOMES_TIPO_INSUMO) as TipoInsumo[]).map((t) => (
                  <option key={t} value={t}>{NOMES_TIPO_INSUMO[t]}</option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="i-un">Unidade no traço</label>
              <select id="i-un" value={form.unidade} onChange={(e) => setForm({ ...form, unidade: e.target.value as UnidadeInsumo })}>
                {(Object.keys(NOMES_UNIDADE) as UnidadeInsumo[]).map((u) => (
                  <option key={u} value={u}>{NOMES_UNIDADE[u]}</option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="i-custo">Custo por {NOMES_UNIDADE[form.unidade]} (R$)</label>
              <input id="i-custo" className="mono" inputMode="decimal" placeholder="ex.: 0,575" value={form.custoUnitario} onChange={(e) => setForm({ ...form, custoUnitario: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="i-min">Estoque mínimo ({NOMES_UNIDADE[form.unidade]})</label>
              <input id="i-min" className="mono" inputMode="decimal" value={form.estoqueMinimo} onChange={(e) => setForm({ ...form, estoqueMinimo: e.target.value })} />
            </div>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Dica: compre por tonelada e use kg no traço; o custo vai por kg (R$ 575,00 a tonelada = R$ 0,575 o kg). Depois que as notas de compra forem ligadas ao insumo, o custo passa a ser a média das notas dos últimos 90 dias.
          </p>
          <label className="marcar">
            <input type="checkbox" checked={form.controlaEstoque} onChange={(e) => setForm({ ...form, controlaEstoque: e.target.checked })} />
            Controlar estoque deste insumo (desmarque para a água da rede ou do poço)
          </label>
          {form.id && (
            <label className="marcar">
              <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} />
              Insumo em uso
            </label>
          )}
          <div className="acoes">
            <button className="btn btn-primario" type="submit" disabled={ocupado}>Salvar insumo</button>
            <button className="btn btn-link" type="button" onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </form>
      )}

      <div className="card tabela-caixa">
        {!lista ? (
          <p className="muted">Carregando…</p>
        ) : lista.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nenhum insumo cadastrado.</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr>
                <th>Insumo</th>
                <th>Tipo</th>
                <th style={{ textAlign: 'right' }}>Custo</th>
                <th style={{ textAlign: 'right' }}>Estoque mínimo</th>
                <th style={{ textAlign: 'right' }}>Traços</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lista.map((i) => (
                <tr key={i.id} style={i.ativo ? undefined : { opacity: 0.55 }}>
                  <td>{i.nome}{!i.ativo && <span className="selo selo-neutro" style={{ marginLeft: 8 }}>fora de uso</span>}</td>
                  <td>{NOMES_TIPO_INSUMO[i.tipo]}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    {custo(i)}
                    <div className="small muted" style={{ fontFamily: 'inherit' }}>{i.custoOrigem === 'notas' ? 'média das notas' : i.custoUnitario !== null ? 'digitado' : ''}</div>
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>{!i.controlaEstoque ? <span className="small muted">sem estoque</span> : i.estoqueMinimo !== null ? `${formatarNumero(i.estoqueMinimo)} ${NOMES_UNIDADE[i.unidade]}` : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{i.usadoEmTracos}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="btn btn-link"
                      type="button"
                      onClick={() =>
                        setForm({
                          id: i.id,
                          nome: i.nome,
                          tipo: i.tipo,
                          unidade: i.unidade,
                          custoUnitario: i.custoUnitario === null ? '' : String(i.custoUnitario).replace('.', ','),
                          estoqueMinimo: i.estoqueMinimo === null ? '' : String(i.estoqueMinimo).replace('.', ','),
                          ativo: i.ativo,
                          controlaEstoque: i.controlaEstoque,
                        })
                      }
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
