import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, formatarData, formatarMoeda, hojeLocal, moedaCampo, nomeMes, NOMES_TIPO_CONTA, somarMeses, type ContaFinanceira } from '../api';

type DadosConta = { id?: string; nome: string; tipo: ContaFinanceira['tipo']; banco: string; agencia: string; conta: string; saldoInicial: string; dataSaldoInicial: string };
const CONTA_VAZIA: DadosConta = { nome: '', tipo: 'banco', banco: '', agencia: '', conta: '', saldoInicial: '', dataSaldoInicial: hojeLocal() };
type Transferencia = { id: string; data: string; valor: number; descricao: string | null; origemNome: string; destinoNome: string };
type Movimento = { data: string; descricao: string; pessoa: string | null; valor: number; saldo: number; origem: string; id: string; lancamentoId: string | null };
type Extrato = { saldoAnterior: number; saldoFinal: number; movimentos: Movimento[]; de: string; ate: string };

export function ContasFinanceiras() {
  const [contas, setContas] = useState<ContaFinanceira[] | null>(null);
  const [transf, setTransf] = useState<Transferencia[]>([]);
  const [form, setForm] = useState<DadosConta | null>(null);
  const [nova, setNova] = useState<{ origemId: string; destinoId: string; data: string; valor: string; descricao: string } | null>(null);
  const [extratoDe, setExtratoDe] = useState<{ contaId: string; mes: string } | null>(null);
  const [extrato, setExtrato] = useState<Extrato | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [c, t] = await Promise.all([api<{ contas: ContaFinanceira[] }>('/fin/contas'), api<{ transferencias: Transferencia[] }>('/fin/transferencias')]);
      setContas(c.contas);
      setTransf(t.transferencias);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    if (!extratoDe) return setExtrato(null);
    const de = `${extratoDe.mes}-01`;
    const fim = somarMeses(de, 1);
    const ate = new Date(Date.parse(`${fim}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    setExtrato(null);
    api<Extrato>(`/fin/contas/${extratoDe.contaId}/extrato?de=${de}&ate=${ate}`)
      .then(setExtrato)
      .catch((e) => setErro((e as Error).message));
  }, [extratoDe]);

  async function executar(fn: () => Promise<unknown>, msg: string) {
    setErro('');
    setAviso('');
    setOcupado(true);
    try {
      await fn();
      setAviso(msg);
      await carregar();
      return true;
    } catch (e) {
      setErro((e as Error).message);
      return false;
    } finally {
      setOcupado(false);
    }
  }

  async function salvarConta(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    const { id, ...corpo } = form;
    const ok = await executar(
      () => (id ? api(`/fin/contas/${id}`, { metodo: 'PATCH', corpo }) : api('/fin/contas', { corpo })),
      id ? 'Conta atualizada.' : 'Conta cadastrada.',
    );
    if (ok) setForm(null);
  }

  async function salvarTransferencia(e: FormEvent) {
    e.preventDefault();
    if (!nova) return;
    const ok = await executar(() => api('/fin/transferencias', { corpo: nova }), 'Transferência registrada.');
    if (ok) setNova(null);
  }

  const ativas = (contas ?? []).filter((c) => c.ativo);
  const total = ativas.reduce((s, c) => s + c.saldo, 0);

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Bancos e caixa</h1>
          <span className="muted">O saldo vem do saldo inicial mais tudo o que foi pago, recebido e transferido. A conciliação com o extrato OFX chega na Etapa 6.</span>
        </div>
        <div className="acoes">
          {ativas.length >= 2 && !nova && (
            <button className="btn btn-secundario" type="button" onClick={() => setNova({ origemId: ativas[0].id, destinoId: ativas[1].id, data: hojeLocal(), valor: '', descricao: '' })}>
              Transferir entre contas
            </button>
          )}
          {!form && (
            <button className="btn btn-primario" type="button" onClick={() => setForm({ ...CONTA_VAZIA })}>
              Nova conta
            </button>
          )}
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}

      {form && (
        <form className="card form" onSubmit={salvarConta}>
          <h2>{form.id ? `Editar ${form.nome}` : 'Nova conta'}</h2>
          <div className="campos">
            <div className="campo">
              <label htmlFor="c-nome">Nome</label>
              <input id="c-nome" value={form.nome} placeholder="Ex.: Sicoob conta corrente" onChange={(e) => setForm({ ...form, nome: e.target.value })} required />
            </div>
            <div className="campo">
              <label htmlFor="c-tipo">Tipo</label>
              <select id="c-tipo" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as ContaFinanceira['tipo'] })}>
                {Object.entries(NOMES_TIPO_CONTA).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            {form.tipo !== 'caixa' && (
              <>
                <div className="campo">
                  <label htmlFor="c-banco">Banco</label>
                  <input id="c-banco" value={form.banco} onChange={(e) => setForm({ ...form, banco: e.target.value })} />
                </div>
                <div className="campo">
                  <label htmlFor="c-ag">Agência</label>
                  <input id="c-ag" className="mono" value={form.agencia} onChange={(e) => setForm({ ...form, agencia: e.target.value })} />
                </div>
                <div className="campo">
                  <label htmlFor="c-cc">Conta</label>
                  <input id="c-cc" className="mono" value={form.conta} onChange={(e) => setForm({ ...form, conta: e.target.value })} />
                </div>
              </>
            )}
            <div className="campo">
              <label htmlFor="c-saldo">Saldo inicial (R$)</label>
              <input id="c-saldo" className="mono" inputMode="decimal" placeholder="0,00" value={form.saldoInicial} onChange={(e) => setForm({ ...form, saldoInicial: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="c-data">Saldo no início do dia</label>
              <input id="c-data" type="date" value={form.dataSaldoInicial} onChange={(e) => setForm({ ...form, dataSaldoInicial: e.target.value })} />
              <span className="small muted">Pagamentos e recebimentos a partir desta data entram no saldo.</span>
            </div>
          </div>
          <div className="acoes">
            <button className="btn btn-primario" type="submit" disabled={ocupado}>
              {form.id ? 'Salvar alterações' : 'Cadastrar'}
            </button>
            <button className="btn btn-secundario" type="button" onClick={() => setForm(null)}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {nova && (
        <form className="card form" onSubmit={salvarTransferencia}>
          <h2>Transferir entre contas</h2>
          <p className="small muted" style={{ margin: 0 }}>Saque, depósito ou TED entre contas da própria empresa. Não é receita nem despesa.</p>
          <div className="campos">
            <div className="campo">
              <label htmlFor="t-de">De</label>
              <select id="t-de" value={nova.origemId} onChange={(e) => setNova({ ...nova, origemId: e.target.value })}>
                {ativas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="t-para">Para</label>
              <select id="t-para" value={nova.destinoId} onChange={(e) => setNova({ ...nova, destinoId: e.target.value })}>
                {ativas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="t-data">Data</label>
              <input id="t-data" type="date" value={nova.data} onChange={(e) => setNova({ ...nova, data: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="t-valor">Valor (R$)</label>
              <input id="t-valor" className="mono" inputMode="decimal" value={nova.valor} onChange={(e) => setNova({ ...nova, valor: e.target.value })} required />
            </div>
            <div className="campo">
              <label htmlFor="t-desc">Descrição</label>
              <input id="t-desc" value={nova.descricao} placeholder="Ex.: Reforço do caixa" onChange={(e) => setNova({ ...nova, descricao: e.target.value })} />
            </div>
          </div>
          <div className="acoes">
            <button className="btn btn-primario" type="submit" disabled={ocupado}>
              Transferir
            </button>
            <button className="btn btn-secundario" type="button" onClick={() => setNova(null)}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="card tabela-caixa">
        {!contas ? (
          <p className="muted">Carregando…</p>
        ) : contas.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nenhuma conta cadastrada. Cadastre a conta do banco e o caixa para registrar pagamentos e recebimentos.</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr>
                <th>Conta</th>
                <th>Tipo</th>
                <th>Saldo inicial</th>
                <th style={{ textAlign: 'right' }}>Saldo atual</th>
                <th><span style={{ position: 'absolute', left: -9999 }}>Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {contas.map((c) => (
                <tr key={c.id} style={c.ativo ? undefined : { opacity: 0.6 }}>
                  <td>
                    <span style={{ fontWeight: 500 }}>{c.nome}</span>
                    {c.banco && (
                      <div className="small muted mono">
                        {c.banco}
                        {c.agencia ? ` · ag ${c.agencia}` : ''}
                        {c.conta ? ` · cc ${c.conta}` : ''}
                      </div>
                    )}
                  </td>
                  <td className="small">{NOMES_TIPO_CONTA[c.tipo]}</td>
                  <td className="small mono">
                    {formatarMoeda(c.saldoInicial)} em {formatarData(c.dataSaldoInicial)}
                  </td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 600, color: c.saldo < 0 ? 'var(--status-danger-ink)' : undefined }}>{formatarMoeda(c.saldo)}</td>
                  <td>
                    <div className="acoes" style={{ flexWrap: 'nowrap' }}>
                      <button className="btn btn-link" type="button" onClick={() => setExtratoDe({ contaId: c.id, mes: hojeLocal().slice(0, 7) })}>
                        Extrato
                      </button>
                      <button
                        className="btn btn-link"
                        type="button"
                        onClick={() => {
                          setForm({ id: c.id, nome: c.nome, tipo: c.tipo, banco: c.banco ?? '', agencia: c.agencia ?? '', conta: c.conta ?? '', saldoInicial: moedaCampo(c.saldoInicial), dataSaldoInicial: c.dataSaldoInicial });
                          window.scrollTo({ top: 0 });
                        }}
                      >
                        Editar
                      </button>
                      <button className="btn btn-link" type="button" disabled={ocupado} onClick={() => executar(() => api(`/fin/contas/${c.id}`, { metodo: 'PATCH', corpo: { ativo: !c.ativo } }), c.ativo ? 'Conta desativada.' : 'Conta reativada.')}>
                        {c.ativo ? 'Desativar' : 'Reativar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="small muted">Saldo das contas ativas</td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{formatarMoeda(total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {extratoDe && (
        <div className="card tabela-caixa">
          <div className="cabecalho" style={{ marginBottom: 12 }}>
            <h2>Extrato · {contas?.find((c) => c.id === extratoDe.contaId)?.nome}</h2>
            <div className="navegar-mes">
              <button type="button" className="btn btn-link" aria-label="Mês anterior" onClick={() => setExtratoDe({ ...extratoDe, mes: somarMeses(`${extratoDe.mes}-01`, -1).slice(0, 7) })}>
                ‹
              </button>
              <strong style={{ textTransform: 'capitalize' }}>{nomeMes(extratoDe.mes)}</strong>
              <button type="button" className="btn btn-link" aria-label="Próximo mês" onClick={() => setExtratoDe({ ...extratoDe, mes: somarMeses(`${extratoDe.mes}-01`, 1).slice(0, 7) })}>
                ›
              </button>
              <button type="button" className="btn btn-link" onClick={() => setExtratoDe(null)}>
                Fechar
              </button>
            </div>
          </div>
          {!extrato ? (
            <p className="muted">Carregando…</p>
          ) : (
            <table className="tabela">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Descrição</th>
                  <th style={{ textAlign: 'right' }}>Valor</th>
                  <th style={{ textAlign: 'right' }}>Saldo</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="mono small">{formatarData(extrato.de)}</td>
                  <td className="small muted">Saldo anterior</td>
                  <td />
                  <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(extrato.saldoAnterior)}</td>
                </tr>
                {extrato.movimentos.map((m) => (
                  <tr key={`${m.origem}-${m.id}`}>
                    <td className="mono small">{formatarData(m.data)}</td>
                    <td>
                      {m.lancamentoId ? <Link to={`/fin/lancamentos/${m.lancamentoId}`}>{m.descricao}</Link> : m.descricao}
                      {m.pessoa && <div className="small muted">{m.pessoa}</div>}
                    </td>
                    <td className="mono" style={{ textAlign: 'right', color: m.valor < 0 ? 'var(--status-danger-ink)' : 'var(--status-ok-ink)' }}>{formatarMoeda(m.valor)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(m.saldo)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="small muted">
                    {extrato.movimentos.length} movimentos · saldo em {formatarData(extrato.ate)}
                  </td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 700 }}>{formatarMoeda(extrato.saldoFinal)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      )}

      {transf.length > 0 && (
        <div className="card tabela-caixa">
          <h2>Transferências dos últimos 90 dias</h2>
          <table className="tabela">
            <thead>
              <tr>
                <th>Data</th>
                <th>De → para</th>
                <th>Descrição</th>
                <th style={{ textAlign: 'right' }}>Valor</th>
                <th><span style={{ position: 'absolute', left: -9999 }}>Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {transf.map((t) => (
                <tr key={t.id}>
                  <td className="mono small">{formatarData(t.data)}</td>
                  <td className="small">
                    {t.origemNome} → {t.destinoNome}
                  </td>
                  <td className="small">{t.descricao ?? '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(t.valor)}</td>
                  <td>
                    <button className="btn btn-link" type="button" disabled={ocupado} onClick={() => executar(() => api(`/fin/transferencias/${t.id}`, { metodo: 'DELETE' }), 'Transferência excluída.')}>
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
