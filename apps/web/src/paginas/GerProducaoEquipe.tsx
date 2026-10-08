// Gerencial › Produção da equipe: operador de usina, gestor de pátio e vendedor, pelas faixas de R$/m³ do mês.
import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, formatarData, formatarMoeda, formatarNumero, hojeLocal, lerNumero, moedaCampo, nomeMes, somarMeses } from '../api';

type Funcao = 'operador_usina' | 'gestor_patio' | 'vendedor';
type Regra = { id: string; funcao: Funcao; base: 'usina' | 'vendas'; modo: 'progressiva' | 'faixa'; vigencia: string; faixas: { ate: number | null; valorM3: number }[]; texto: string; criadoPor: string | null };
type Parte = { de: number; ate: number | null; m3: number; valorM3: number; valor: number };
type Resp = {
  mes: string;
  usinaM3: number;
  total: number;
  funcoes: { funcao: Funcao; nome: string; regra: Regra | null; total: number; pessoas: { id: string; nome: string; baseM3: number; valor: number; partes: Parte[] }[] }[];
};

const NOMES: Record<Funcao, string> = { operador_usina: 'Operador de usina', gestor_patio: 'Gestor de pátio', vendedor: 'Vendedor' };
const m3 = (n: number) => `${formatarNumero(n, Number.isInteger(n) ? 0 : 1)} m³`;
const textoBase = (r: Regra) => (r.base === 'vendas' ? 'm³ entregues das vendas dele' : 'produção da usina no mês');
const textoModo = (r: Regra) => (r.modo === 'progressiva' ? 'progressiva (cada faixa paga o seu volume)' : 'faixa atingida (todo o volume no valor da faixa)');

type Form = { funcao: Funcao; base: 'usina' | 'vendas'; modo: 'progressiva' | 'faixa'; vigencia: string; faixas: { ate: string; valorM3: string }[] };

export function GerProducaoEquipe() {
  const [mes, setMes] = useState(hojeLocal().slice(0, 7));
  const [r, setR] = useState<Resp | null>(null);
  const [regras, setRegras] = useState<Regra[]>([]);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [aberto, setAberto] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);

  const carregar = useCallback(() => {
    setR(null);
    api<Resp>(`/ger/producao-equipe?mes=${mes}`).then(setR).catch((e) => setErro((e as Error).message));
    api<{ regras: Regra[] }>('/ger/regras-producao').then((x) => setRegras(x.regras)).catch(() => {});
  }, [mes]);
  useEffect(carregar, [carregar]);

  function novaRegra(funcao: Funcao, atual: Regra | null) {
    setForm({
      funcao,
      base: atual?.base ?? (funcao === 'vendedor' ? 'vendas' : 'usina'),
      modo: atual?.modo ?? 'progressiva',
      vigencia: `${mes}-01`,
      faixas: atual
        ? atual.faixas.map((f) => ({ ate: f.ate === null ? '' : String(f.ate), valorM3: moedaCampo(f.valorM3) }))
        : [{ ate: '1000', valorM3: '2,00' }, { ate: '', valorM3: '1,50' }],
    });
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setErro('');
    try {
      await api('/ger/regras-producao', {
        corpo: {
          ...form,
          faixas: form.faixas.map((f, i) => ({ ate: i === form.faixas.length - 1 ? null : lerNumero(f.ate), valorM3: lerNumero(f.valorM3) ?? -1 })),
        },
      });
      setAviso(`Regra do ${NOMES[form.funcao].toLowerCase()} salva, valendo a partir de ${formatarData(form.vigencia)}.`);
      setForm(null);
      carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  async function excluir(regra: Regra) {
    setErro('');
    try {
      await api(`/ger/regras-producao/${regra.id}`, { metodo: 'DELETE' });
      setAviso('Regra excluída.');
      carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Produção da equipe</h1>
          <span className="muted">Operador de usina, gestor de pátio e vendedor: R$ por m³ em faixas de volume do mês.</span>
        </div>
      </div>
      <div className="filtros">
        <div className="navegar-mes">
          <button className="btn btn-secundario" type="button" aria-label="Mês anterior" onClick={() => setMes(somarMeses(`${mes}-01`, -1).slice(0, 7))}>‹</button>
          <input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} aria-label="Mês" />
          <button className="btn btn-secundario" type="button" aria-label="Próximo mês" onClick={() => setMes(somarMeses(`${mes}-01`, 1).slice(0, 7))}>›</button>
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}

      {!r ? (
        <p className="muted">Carregando…</p>
      ) : (
        <>
          <div className="grade">
            <div className="card indicador"><span className="rotulo-ind">Produção da usina · {nomeMes(mes)}</span><span className="valor-ind mono">{m3(r.usinaM3)}</span></div>
            <div className="card indicador"><span className="rotulo-ind">Total da equipe</span><span className="valor-ind mono">{formatarMoeda(r.total)}</span></div>
            <div className="card indicador"><span className="rotulo-ind">Custo por m³ produzido</span><span className="valor-ind mono">{r.usinaM3 ? formatarMoeda(r.total / r.usinaM3) : '—'}</span></div>
          </div>

          {r.funcoes.map((f) => (
            <section key={f.funcao} className="card relatorio">
              <div className="cartao-topo">
                <h2>{f.nome}</h2>
                <button className="btn btn-link" type="button" onClick={() => novaRegra(f.funcao, f.regra)}>{f.regra ? 'Mudar regra' : 'Definir regra'}</button>
              </div>
              {f.regra ? (
                <p className="small muted" style={{ marginTop: 0 }}>
                  {f.regra.texto}. Base: {textoBase(f.regra)}. Cálculo: {textoModo(f.regra)}. Desde {formatarData(f.regra.vigencia)}.
                </p>
              ) : (
                <div className="alerta alerta-aviso">Sem regra para este mês. Defina as faixas de R$/m³ para calcular.</div>
              )}
              {f.pessoas.length === 0 ? (
                <p className="muted small" style={{ margin: 0 }}>
                  {f.funcao === 'vendedor' ? 'Nenhum usuário com perfil Vendedor.' : `Nenhum colaborador com a função ${f.nome.toLowerCase()}. Cadastre em Administrativo › Colaboradores.`}
                </p>
              ) : (
                <div className="tabela-caixa">
                  <table className="tabela">
                    <thead>
                      <tr>
                        <th>{f.funcao === 'vendedor' ? 'Vendedor' : 'Colaborador'}</th>
                        <th style={{ textAlign: 'right' }}>Base do cálculo</th>
                        <th style={{ textAlign: 'right' }}>Valor</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {f.pessoas.map((p) => {
                        const chave = `${f.funcao}:${p.id}`;
                        return (
                          <Fragment key={chave}>
                            <tr>
                              <td>{p.nome}</td>
                              <td className="mono" style={{ textAlign: 'right' }}>{m3(p.baseM3)}</td>
                              <td className="mono" style={{ textAlign: 'right' }}><b>{formatarMoeda(p.valor)}</b></td>
                              <td style={{ textAlign: 'right' }}>
                                {p.partes.length > 0 && (
                                  <button className="btn btn-link" type="button" aria-expanded={aberto === chave} onClick={() => setAberto(aberto === chave ? null : chave)}>
                                    {aberto === chave ? 'Fechar' : 'Ver cálculo'}
                                  </button>
                                )}
                              </td>
                            </tr>
                            {aberto === chave &&
                              p.partes.map((x, i) => (
                                <tr key={`${chave}:${i}`} className="small">
                                  <td className="muted" style={{ paddingLeft: 24 }}>
                                    {f.regra?.modo === 'faixa' ? 'Faixa atingida' : x.ate === null ? `Acima de ${formatarNumero(x.de)} m³` : `De ${formatarNumero(x.de)} a ${formatarNumero(x.ate)} m³`}
                                  </td>
                                  <td className="mono muted" style={{ textAlign: 'right' }}>{m3(x.m3)} × {formatarMoeda(x.valorM3)}</td>
                                  <td className="mono muted" style={{ textAlign: 'right' }}>{formatarMoeda(x.valor)}</td>
                                  <td />
                                </tr>
                              ))}
                          </Fragment>
                        );
                      })}
                    </tbody>
                    {f.pessoas.length > 1 && (
                      <tfoot>
                        <tr>
                          <td>Total</td>
                          <td />
                          <td className="mono" style={{ textAlign: 'right' }}><b>{formatarMoeda(f.total)}</b></td>
                          <td />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </section>
          ))}
        </>
      )}

      {form && (
        <form className="card form" onSubmit={salvar}>
          <h2>Regra do {NOMES[form.funcao].toLowerCase()}</h2>
          <div className="campos">
            <div className="campo">
              <label htmlFor="r-base">Base do cálculo</label>
              <select id="r-base" value={form.base} onChange={(e) => setForm({ ...form, base: e.target.value as Form['base'] })}>
                <option value="usina">Produção da usina no mês</option>
                {form.funcao === 'vendedor' && <option value="vendas">m³ entregues das vendas dele</option>}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="r-modo">Cálculo</label>
              <select id="r-modo" value={form.modo} onChange={(e) => setForm({ ...form, modo: e.target.value as Form['modo'] })}>
                <option value="progressiva">Progressiva: cada faixa paga o seu volume</option>
                <option value="faixa">Faixa atingida: todo o volume no valor da faixa</option>
              </select>
            </div>
            <div className="campo">
              <label htmlFor="r-vig">Vale a partir de</label>
              <input id="r-vig" type="date" value={form.vigencia} onChange={(e) => setForm({ ...form, vigencia: e.target.value })} />
            </div>
          </div>
          <div className="faixas-editor">
            {form.faixas.map((f, i) => {
              const ultima = i === form.faixas.length - 1;
              const anterior = i > 0 ? form.faixas[i - 1].ate : '0';
              return (
                <div key={i} className="faixa">
                  <div className="campo">
                    <label htmlFor={`r-ate-${i}`}>{ultima ? `Acima de ${anterior || '…'} m³` : `De ${anterior || '0'} até (m³)`}</label>
                    <input id={`r-ate-${i}`} className="mono" inputMode="decimal" disabled={ultima} placeholder={ultima ? 'sem limite' : 'ex.: 1000'} value={ultima ? '' : f.ate}
                      onChange={(e) => setForm({ ...form, faixas: form.faixas.map((x, j) => (j === i ? { ...x, ate: e.target.value } : x)) })} />
                  </div>
                  <div className="campo">
                    <label htmlFor={`r-val-${i}`}>R$ por m³</label>
                    <input id={`r-val-${i}`} className="mono" inputMode="decimal" value={f.valorM3}
                      onChange={(e) => setForm({ ...form, faixas: form.faixas.map((x, j) => (j === i ? { ...x, valorM3: e.target.value } : x)) })} />
                  </div>
                  <button className="btn btn-link" type="button" disabled={form.faixas.length === 1} aria-label={`Tirar a faixa ${i + 1}`}
                    onClick={() => setForm({ ...form, faixas: form.faixas.filter((_, j) => j !== i) })}>
                    Tirar
                  </button>
                </div>
              );
            })}
            <button className="btn btn-secundario" type="button" style={{ justifySelf: 'start' }} disabled={form.faixas.length >= 10}
              onClick={() => setForm({ ...form, faixas: [...form.faixas.slice(0, -1), { ate: '', valorM3: '' }, form.faixas[form.faixas.length - 1]] })}>
              + Faixa
            </button>
          </div>
          <span className="small muted">
            Exemplo progressivo: até 1.000 m³ a R$ 2,00 e acima a R$ 1,50 → 1.200 m³ = 1.000 × 2,00 + 200 × 1,50 = R$ 2.300,00. Na faixa atingida, 1.200 m³ × 1,50 = R$ 1.800,00.
          </span>
          <div className="acoes">
            <button className="btn btn-primario" type="submit">Salvar regra</button>
            <button className="btn btn-link" type="button" onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </form>
      )}

      {regras.length > 0 && (
        <section className="card tabela-caixa">
          <h2>Histórico de regras</h2>
          <table className="tabela tabela-compacta">
            <thead>
              <tr>
                <th>Função</th>
                <th>Desde</th>
                <th>Faixas</th>
                <th>Base e cálculo</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {regras.map((g) => (
                <tr key={g.id}>
                  <td>{NOMES[g.funcao]}</td>
                  <td className="mono">{formatarData(g.vigencia)}</td>
                  <td className="small">{g.texto}</td>
                  <td className="small muted">{g.base === 'vendas' ? 'vendas dele' : 'usina'} · {g.modo === 'progressiva' ? 'progressiva' : 'faixa atingida'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-link" type="button" onClick={() => excluir(g)}>Excluir</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
