import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, NOMES_LINHA_DRE, type CentroCusto, type LinhaDre, type PlanoConta, type TipoLanc } from '../api';

type DadosConta = { id?: string; paiId: string; codigo: string; nome: string; tipo: TipoLanc; linhaDre: LinhaDre };

/** Próximo código livre dentro do grupo (ex.: 4.8 → 4.9). */
function proximoCodigo(plano: PlanoConta[], pai: PlanoConta | undefined): string {
  const prefixo = pai ? `${pai.codigo}.` : '';
  const irmaos = plano.filter((p) => (pai ? p.paiId === pai.id : !p.paiId)).map((p) => Number(p.codigo.slice(prefixo.length)));
  return `${prefixo}${(irmaos.length ? Math.max(...irmaos.filter(Number.isFinite)) : 0) + 1}`;
}

export function PlanoContas() {
  const [plano, setPlano] = useState<PlanoConta[] | null>(null);
  const [centros, setCentros] = useState<CentroCusto[]>([]);
  const [form, setForm] = useState<DadosConta | null>(null);
  const [novoCentro, setNovoCentro] = useState('');
  const [editCentro, setEditCentro] = useState<{ id: string; nome: string } | null>(null);
  const [mostrarInativas, setMostrarInativas] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([api<{ contas: PlanoConta[] }>('/fin/plano-contas'), api<{ centros: CentroCusto[] }>('/fin/centros-custo')]);
      setPlano(p.contas);
      setCentros(c.centros);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  async function executar(fn: () => Promise<unknown>, msg: string | ((r: any) => string)) {
    setErro('');
    setAviso('');
    setOcupado(true);
    try {
      const r = await fn();
      setAviso(typeof msg === 'function' ? msg(r) : msg);
      await carregar();
      return true;
    } catch (e) {
      setErro((e as Error).message);
      return false;
    } finally {
      setOcupado(false);
    }
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const ok = form.id
      ? await executar(() => api(`/fin/plano-contas/${form.id}`, { metodo: 'PATCH', corpo: { nome: form.nome, linhaDre: form.linhaDre, tipo: form.tipo } }), 'Categoria atualizada.')
      : await executar(() => api('/fin/plano-contas', { corpo: { codigo: form.codigo, nome: form.nome, tipo: form.tipo, linhaDre: form.linhaDre } }), `Categoria ${form.codigo} criada.`);
    if (ok) setForm(null);
  }

  function novaEm(pai?: PlanoConta) {
    if (!plano) return;
    setForm({ paiId: pai?.id ?? '', codigo: proximoCodigo(plano, pai), nome: '', tipo: pai?.tipo ?? 'despesa', linhaDre: pai?.linhaDre ?? 'despesas_administrativas' });
    window.scrollTo({ top: 0 });
  }

  const nivel = (c: string) => c.split('.').length - 1;
  const visiveis = (plano ?? []).filter((p) => mostrarInativas || p.ativo);

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Plano de contas e centros de custo</h1>
          <span className="muted">As categorias classificam cada receita e despesa. Cada uma soma numa linha da DRE.</span>
        </div>
        <div className="acoes">
          <button
            className="btn btn-secundario"
            type="button"
            disabled={ocupado}
            onClick={() =>
              executar(
                () => api<{ contas: number; centros: number }>('/fin/plano-contas/padrao', { metodo: 'POST' }),
                (r: { contas: number; centros: number }) =>
                  r.contas || r.centros ? `Plano padrão aplicado: ${r.contas} categorias e ${r.centros} centros de custo criados.` : 'O plano padrão já estava completo; nada foi criado.',
              )
            }
          >
            {plano?.length ? 'Completar com o plano padrão' : 'Aplicar plano padrão de concreteira'}
          </button>
          {!form && plano && (
            <button className="btn btn-primario" type="button" onClick={() => novaEm()}>
              Novo grupo
            </button>
          )}
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}

      {form && (
        <form className="card form" onSubmit={salvar}>
          <h2>{form.id ? `Editar ${form.codigo}` : form.paiId ? `Nova categoria em ${plano?.find((p) => p.id === form.paiId)?.nome}` : 'Novo grupo'}</h2>
          <div className="campos">
            <div className="campo">
              <label htmlFor="pc-cod">Código</label>
              <input id="pc-cod" className="mono" value={form.codigo} disabled={!!form.id} onChange={(e) => setForm({ ...form, codigo: e.target.value })} />
            </div>
            <div className="campo largo">
              <label htmlFor="pc-nome">Nome</label>
              <input id="pc-nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} required />
            </div>
            <div className="campo">
              <label htmlFor="pc-tipo">Tipo</label>
              <select id="pc-tipo" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as TipoLanc })}>
                <option value="despesa">Despesa (saída)</option>
                <option value="receita">Receita (entrada)</option>
              </select>
            </div>
            <div className="campo largo">
              <label htmlFor="pc-dre">Linha da DRE</label>
              <select id="pc-dre" value={form.linhaDre} onChange={(e) => setForm({ ...form, linhaDre: e.target.value as LinhaDre })}>
                {Object.entries(NOMES_LINHA_DRE).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="acoes">
            <button className="btn btn-primario" type="submit" disabled={ocupado}>
              {form.id ? 'Salvar' : 'Criar'}
            </button>
            <button className="btn btn-secundario" type="button" onClick={() => setForm(null)}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="card tabela-caixa">
        {!plano ? (
          <p className="muted">Carregando…</p>
        ) : plano.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            O plano de contas está vazio. Aplique o plano padrão de concreteira (receitas de concreto e bombeamento, cimento, agregados, diesel, manutenção, pessoal, administrativo,
            financeiro e investimentos) e ajuste o que precisar.
          </p>
        ) : (
          <>
            <label className="marcar" style={{ marginBottom: 8 }}>
              <input type="checkbox" checked={mostrarInativas} onChange={(e) => setMostrarInativas(e.target.checked)} />
              <span className="small">Mostrar categorias desativadas</span>
            </label>
            <table className="tabela">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Categoria</th>
                  <th>Tipo</th>
                  <th>Linha da DRE</th>
                  <th><span style={{ position: 'absolute', left: -9999 }}>Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((p) => {
                  const grupo = !p.aceitaLancamento;
                  return (
                    <tr key={p.id} className={grupo ? 'linha-grupo' : undefined} style={p.ativo ? undefined : { opacity: 0.55 }}>
                      <td className="mono small">{p.codigo}</td>
                      <td style={{ paddingLeft: 12 + nivel(p.codigo) * 18, fontWeight: grupo ? 600 : 400 }}>{p.nome}</td>
                      <td className="small">{p.tipo === 'receita' ? 'Receita' : 'Despesa'}</td>
                      <td className="small">{NOMES_LINHA_DRE[p.linhaDre]}</td>
                      <td>
                        <div className="acoes" style={{ flexWrap: 'nowrap' }}>
                          {grupo && (
                            <button className="btn btn-link" type="button" onClick={() => novaEm(p)}>
                              + Categoria
                            </button>
                          )}
                          <button className="btn btn-link" type="button" onClick={() => { setForm({ id: p.id, paiId: p.paiId ?? '', codigo: p.codigo, nome: p.nome, tipo: p.tipo, linhaDre: p.linhaDre }); window.scrollTo({ top: 0 }); }}>
                            Editar
                          </button>
                          <button className="btn btn-link" type="button" disabled={ocupado} onClick={() => executar(() => api(`/fin/plano-contas/${p.id}`, { metodo: 'PATCH', corpo: { ativo: !p.ativo } }), p.ativo ? `${p.nome} desativada.` : `${p.nome} reativada.`)}>
                            {p.ativo ? 'Desativar' : 'Reativar'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="card">
        <h2>Centros de custo</h2>
        <p className="small muted" style={{ marginTop: 0 }}>Onde o dinheiro foi usado. Ao escolher um veículo no lançamento, o centro Frota ou Bombas é sugerido.</p>
        <ul className="lista-alertas">
          {centros.map((c) => (
            <li key={c.id} style={c.ativo ? undefined : { opacity: 0.55 }}>
              {editCentro?.id === c.id ? (
                <form
                  style={{ display: 'flex', gap: 8, flex: 1 }}
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (await executar(() => api(`/fin/centros-custo/${c.id}`, { metodo: 'PATCH', corpo: { nome: editCentro.nome } }), 'Centro de custo renomeado.')) setEditCentro(null);
                  }}
                >
                  <div className="campo" style={{ flex: 1 }}>
                    <input aria-label="Nome do centro de custo" value={editCentro.nome} onChange={(e) => setEditCentro({ ...editCentro, nome: e.target.value })} />
                  </div>
                  <button className="btn btn-link" type="submit">Salvar</button>
                  <button className="btn btn-link" type="button" onClick={() => setEditCentro(null)}>Cancelar</button>
                </form>
              ) : (
                <>
                  <span>{c.nome}</span>
                  <span className="acoes" style={{ flexWrap: 'nowrap' }}>
                    <button className="btn btn-link" type="button" onClick={() => setEditCentro({ id: c.id, nome: c.nome })}>Renomear</button>
                    <button className="btn btn-link" type="button" disabled={ocupado} onClick={() => executar(() => api(`/fin/centros-custo/${c.id}`, { metodo: 'PATCH', corpo: { ativo: !c.ativo } }), c.ativo ? `${c.nome} desativado.` : `${c.nome} reativado.`)}>
                      {c.ativo ? 'Desativar' : 'Reativar'}
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
        <form
          className="acoes"
          style={{ marginTop: 12 }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (await executar(() => api('/fin/centros-custo', { corpo: { nome: novoCentro } }), `Centro de custo ${novoCentro} criado.`)) setNovoCentro('');
          }}
        >
          <div className="campo" style={{ flex: 1, minWidth: 200 }}>
            <input aria-label="Novo centro de custo" placeholder="Novo centro de custo" value={novoCentro} onChange={(e) => setNovoCentro(e.target.value)} />
          </div>
          <button className="btn btn-secundario" type="submit" disabled={ocupado || novoCentro.trim().length < 2}>
            Adicionar
          </button>
        </form>
      </div>
    </>
  );
}
