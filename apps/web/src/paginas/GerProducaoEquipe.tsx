// Gerencial › Produção da equipe (construtora): cada serviço da EAP tem uma equipe e um preço por unidade.
// A produção do mês é a quantidade executada no mês (diferença das medições) vezes o preço unitário da equipe.
import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, formatarMoeda, formatarNumero, hojeLocal, lerNumero, moedaCampo, nomeMes, somarMeses } from '../api';
import { SecaoObra } from './EngSecoes';

type ServicoMes = { eapNoId: string; codigo: string; descricao: string; unidade: string | null; quantidadeMes: number | null; precoCentavos: number | null; valorCentavos: number | null };
type Producao = {
  mes: string;
  colaboradores: { id: string; nome: string; valorCentavos: number; servicos: ServicoMes[] }[];
  semEquipe: ServicoMes[];
  totalCentavos: number;
};
type Folha = { eapNoId: string; codigo: string; descricao: string; unidade: string | null; quantidade: number | null; colaboradorId: string | null; colaboradorNome: string | null; precoUnitario: number | null };
type Equipes = { folhas: Folha[]; colaboradores: { id: string; nome: string; funcao: string | null }[] };

const quantidade = (n: number | null, unidade: string | null) =>
  n === null ? 'unidade não definida' : `${formatarNumero(n, Number.isInteger(n) ? 0 : 2)} ${unidade ?? ''}`.trim();

export function GerProducaoEquipe() {
  return (
    <SecaoObra titulo="Produção da equipe" ajuda="Cada serviço da EAP tem uma equipe responsável e um preço por unidade. A produção do mês vem das medições.">
      {(c) => <PainelProducao obraId={c.obra.id} setErro={c.setErro} />}
    </SecaoObra>
  );
}

function PainelProducao({ obraId, setErro }: { obraId: string; setErro: (m: string) => void }) {
  const [mes, setMes] = useState(hojeLocal().slice(0, 7));
  const [producao, setProducao] = useState<Producao | null>(null);
  const [equipes, setEquipes] = useState<Equipes | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [aviso, setAviso] = useState('');
  const [form, setForm] = useState({ eapNoId: '', colaboradorId: '', precoUnitario: '' });
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(() => {
    setProducao(null);
    api<Producao>(`/eng/obras/${obraId}/producao-equipe?mes=${mes}`).then(setProducao).catch((e) => setErro((e as Error).message));
    api<Equipes>(`/eng/obras/${obraId}/equipes-servicos`).then(setEquipes).catch((e) => setErro((e as Error).message));
  }, [obraId, mes, setErro]);
  useEffect(carregar, [carregar]);

  function escolherServico(eapNoId: string) {
    const f = equipes?.folhas.find((x) => x.eapNoId === eapNoId);
    setForm({
      eapNoId,
      colaboradorId: f?.colaboradorId ?? '',
      precoUnitario: f?.precoUnitario !== null && f?.precoUnitario !== undefined ? moedaCampo(f.precoUnitario) : '',
    });
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setAviso('');
    const preco = lerNumero(form.precoUnitario);
    if (preco === null || preco < 0) return setErro('Informe o preço por unidade.');
    setSalvando(true);
    try {
      await api(`/eng/obras/${obraId}/equipes-servicos`, { metodo: 'PUT', corpo: { eapNoId: form.eapNoId, colaboradorId: form.colaboradorId, precoUnitario: preco } });
      setAviso('Equipe e preço salvos.');
      setForm({ eapNoId: '', colaboradorId: '', precoUnitario: '' });
      carregar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function remover(eapNoId: string) {
    setAviso('');
    try {
      await api(`/eng/obras/${obraId}/equipes-servicos/${eapNoId}`, { metodo: 'DELETE' });
      setAviso('Equipe removida do serviço.');
      carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  const folhasComEquipe = equipes?.folhas.filter((f) => f.colaboradorId) ?? [];
  const folhasSemEquipe = equipes?.folhas.filter((f) => !f.colaboradorId) ?? [];

  return (
    <>
      <div className="filtros" style={{ marginBottom: 12 }}>
        <div className="navegar-mes">
          <button className="btn btn-secundario" type="button" aria-label="Mês anterior" onClick={() => setMes(somarMeses(`${mes}-01`, -1).slice(0, 7))}>‹</button>
          <input type="month" value={mes} onChange={(e) => e.target.value && setMes(e.target.value)} aria-label="Mês" />
          <button className="btn btn-secundario" type="button" aria-label="Próximo mês" onClick={() => setMes(somarMeses(`${mes}-01`, 1).slice(0, 7))}>›</button>
        </div>
      </div>
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}

      {!producao || !equipes ? (
        <p className="muted">Carregando…</p>
      ) : (
        <>
          <div className="kpis" style={{ marginBottom: 16 }}>
            <div className="kpi"><div className="kpi-rotulo">A pagar às equipes · {nomeMes(mes)}</div><div className="kpi-valor">{formatarMoeda(producao.totalCentavos / 100)}</div></div>
            <div className="kpi"><div className="kpi-rotulo">Serviços com equipe</div><div className="kpi-valor">{folhasComEquipe.length}</div><div className="kpi-detalhe">de {equipes.folhas.length} serviços</div></div>
            <div className={"kpi" + (producao.semEquipe.length ? " kpi-aviso" : "")}><div className="kpi-rotulo">Medidos sem equipe</div><div className="kpi-valor">{producao.semEquipe.length}</div><div className="kpi-detalhe">no mês, sem responsável</div></div>
          </div>

          <section className="card" style={{ marginBottom: 12 }}>
            <h2 style={{ marginTop: 0 }}>Produção por equipe</h2>
            {producao.colaboradores.length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>Nenhuma equipe produziu no mês. Defina a equipe de cada serviço abaixo.</p>
            ) : (
              <div className="tabela-caixa">
                <table className="tabela">
                  <thead><tr><th>Colaborador</th><th className="num">Serviços</th><th className="num">A pagar</th><th /></tr></thead>
                  <tbody>
                    {producao.colaboradores.map((c) => (
                      <Fragment key={c.id}>
                        <tr>
                          <td>{c.nome}</td>
                          <td className="num">{c.servicos.length}</td>
                          <td className="num"><b>{formatarMoeda(c.valorCentavos / 100)}</b></td>
                          <td style={{ textAlign: 'right' }}>
                            <button className="btn btn-link" type="button" aria-expanded={aberto === c.id} onClick={() => setAberto(aberto === c.id ? null : c.id)}>
                              {aberto === c.id ? 'Fechar' : 'Ver serviços'}
                            </button>
                          </td>
                        </tr>
                        {aberto === c.id && (
                          <tr>
                            <td colSpan={4}>
                              <table className="tabela" style={{ margin: 0 }}>
                                <thead><tr><th>Serviço</th><th className="num">Executado no mês</th><th className="num">Preço/un.</th><th className="num">Valor</th></tr></thead>
                                <tbody>
                                  {c.servicos.map((s) => (
                                    <tr key={s.eapNoId}>
                                      <td>{s.codigo} {s.descricao}</td>
                                      <td className="num">{quantidade(s.quantidadeMes, s.unidade)}</td>
                                      <td className="num">{s.precoCentavos !== null ? formatarMoeda(s.precoCentavos / 100) : '—'}</td>
                                      <td className="num">{s.valorCentavos !== null ? formatarMoeda(s.valorCentavos / 100) : '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {producao.semEquipe.length > 0 && (
            <section className="card" style={{ marginBottom: 12 }}>
              <h2 style={{ marginTop: 0 }}>Serviços medidos sem equipe</h2>
              <p className="small muted" style={{ marginTop: 0 }}>Houve produção no mês, mas nenhuma equipe está definida para estes serviços. Defina abaixo para que a produção seja paga.</p>
              <div className="tabela-caixa">
                <table className="tabela">
                  <thead><tr><th>Serviço</th><th className="num">Executado no mês</th><th /></tr></thead>
                  <tbody>
                    {producao.semEquipe.map((s) => (
                      <tr key={s.eapNoId}>
                        <td>{s.codigo} {s.descricao}</td>
                        <td className="num">{quantidade(s.quantidadeMes, s.unidade)}</td>
                        <td style={{ textAlign: 'right' }}><button className="btn btn-link" type="button" onClick={() => escolherServico(s.eapNoId)}>Definir equipe</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="card" style={{ marginBottom: 12 }}>
            <h2 style={{ marginTop: 0 }}>Equipe de cada serviço</h2>
            <form onSubmit={salvar} className="form">
              <div className="campos">
                <div className="campo">
                  <label htmlFor="eq-servico">Serviço (EAP)</label>
                  <select id="eq-servico" value={form.eapNoId} onChange={(e) => escolherServico(e.target.value)}>
                    <option value="">Escolha o serviço…</option>
                    {equipes.folhas.map((f) => (
                      <option key={f.eapNoId} value={f.eapNoId}>{f.codigo} {f.descricao}{f.unidade ? ` (${f.unidade})` : ' (sem unidade)'}</option>
                    ))}
                  </select>
                </div>
                <div className="campo">
                  <label htmlFor="eq-colab">Equipe responsável</label>
                  <select id="eq-colab" value={form.colaboradorId} onChange={(e) => setForm({ ...form, colaboradorId: e.target.value })}>
                    <option value="">Escolha o colaborador…</option>
                    {equipes.colaboradores.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.funcao ? ` · ${c.funcao}` : ''}</option>)}
                  </select>
                </div>
                <div className="campo">
                  <label htmlFor="eq-preco">Preço por unidade (R$)</label>
                  <input id="eq-preco" inputMode="decimal" value={form.precoUnitario} onChange={(e) => setForm({ ...form, precoUnitario: e.target.value })} placeholder="0,00" />
                </div>
              </div>
              <div className="acoes">
                <button className="btn btn-primario" type="submit" disabled={salvando || !form.eapNoId || !form.colaboradorId}>Salvar equipe</button>
              </div>
            </form>

            {folhasComEquipe.length > 0 && (
              <div className="tabela-caixa" style={{ marginTop: 12 }}>
                <table className="tabela">
                  <thead><tr><th>Serviço</th><th>Equipe</th><th className="num">Preço/un.</th><th /></tr></thead>
                  <tbody>
                    {folhasComEquipe.map((f) => (
                      <tr key={f.eapNoId}>
                        <td>{f.codigo} {f.descricao}</td>
                        <td>{f.colaboradorNome}</td>
                        <td className="num">{f.precoUnitario !== null ? formatarMoeda(f.precoUnitario) : '—'}</td>
                        <td style={{ textAlign: 'right' }}><button className="btn btn-link" type="button" onClick={() => remover(f.eapNoId)}>Remover</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {folhasSemEquipe.length > 0 && (
              <p className="small muted" style={{ marginBottom: 0 }}>{folhasSemEquipe.length} serviço(s) ainda sem equipe.</p>
            )}
          </section>
        </>
      )}
    </>
  );
}
