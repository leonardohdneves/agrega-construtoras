// Engenharia · Acompanhamento de obra: medições físicas por linha da EAP (etapas e subetapas do orçamento e do planejamento).
// Cada medição é uma data. Em cada linha folha informa-se o % acumulado, ou a quantidade executada na unidade do serviço.
import { useEffect, useState, type FormEvent } from 'react';
import { api, formatarMoeda } from '../api';
import { SecaoObra } from './EngSecoes';
import { ROTULO_NIVEL } from './EngObras';

type LinhaPlanilha = {
  id: string; paiId: string | null; nivel: string; codigo: string; descricao: string; folha: boolean;
  unidade: string | null; quantidadeOrcada: number | null; custoDireto: number; percentualAtual: number | null;
};
type MedicaoResumo = { id: string; data: string; descricao: string | null; linhas: number };
type Planilha = { hoje: string; ultimaData: string | null; linhas: LinhaPlanilha[]; medicoes: MedicaoResumo[] };

const dataBr = (iso: string) => iso.split('-').reverse().join('/');
const pct = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`);
const profundidade = (codigo: string) => codigo.split('.').length - 1;

export function EngAcompanhamento() {
  return (
    <SecaoObra titulo="Acompanhamento de obra" ajuda="Registre as medições físicas. Em cada linha da EAP, informe o % executado acumulado ou a quantidade executada na unidade do serviço. As etapas e subetapas são as do orçamento e do planejamento.">
      {(c) => <PainelAcompanhamento obraId={c.obra.id} setErro={c.setErro} />}
    </SecaoObra>
  );
}

function PainelAcompanhamento({ obraId, setErro }: { obraId: string; setErro: (m: string) => void }) {
  const [planilha, setPlanilha] = useState<Planilha | null>(null);
  const [data, setData] = useState('');
  const [descricao, setDescricao] = useState('');
  const [modo, setModo] = useState<'percentual' | 'quantidade'>('percentual');
  const [valores, setValores] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState('');

  async function carregar() {
    try {
      const r = await api<Planilha>(`/eng/obras/${obraId}/acompanhamento/planilha`);
      setPlanilha(r);
      if (!data) setData(r.hoje);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  useEffect(() => {
    setPlanilha(null);
    setValores({});
    carregar();
  }, [obraId]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setAviso('');
    const itens = Object.entries(valores)
      .filter(([, v]) => v.trim() !== '')
      .map(([eapNoId, v]) => {
        const n = Number(v.replace(',', '.'));
        const linha = planilha?.linhas.find((l) => l.id === eapNoId);
        if (!Number.isFinite(n) || n < 0) throw new Error(`Valor inválido em ${linha?.codigo ?? 'uma linha'}.`);
        return modo === 'quantidade' && linha?.unidade ? { eapNoId, quantidade: n } : { eapNoId, percentual: n };
      });
    if (!itens.length) return setErro('Preencha o % ou a quantidade de ao menos uma linha.');
    setOcupado(true);
    try {
      await api(`/eng/obras/${obraId}/acompanhamento/medicoes`, { metodo: 'POST', corpo: { data, descricao: descricao.trim() || null, itens } });
      setAviso(`Medição de ${dataBr(data)} registrada com ${itens.length} linha(s). Uma nova medição da mesma data substitui esta.`);
      setValores({});
      setDescricao('');
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function excluir(m: MedicaoResumo) {
    if (!window.confirm(`Excluir a medição de ${dataBr(m.data)}?`)) return;
    setErro('');
    try {
      await api(`/eng/obras/${obraId}/acompanhamento/medicoes/${m.id}`, { metodo: 'DELETE' });
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  if (!planilha) return <p className="muted">Carregando…</p>;
  const pendentes = planilha.linhas.filter((l) => l.folha).length;

  return (
    <>
      <form className="card form" onSubmit={salvar}>
        <div className="acoes" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0 }}>Nova medição</h2>
            <span className="small muted">
              Última medição: {planilha.ultimaData ? dataBr(planilha.ultimaData) : 'nenhuma'} · {pendentes} linhas de serviço
            </span>
          </div>
          <div className="segmentado" role="group" aria-label="Forma de medição">
            <button type="button" aria-pressed={modo === 'percentual'} className={modo === 'percentual' ? 'ativo' : ''} onClick={() => setModo('percentual')}>% executado</button>
            <button type="button" aria-pressed={modo === 'quantidade'} className={modo === 'quantidade' ? 'ativo' : ''} onClick={() => setModo('quantidade')}>Unidade do serviço</button>
          </div>
        </div>
        <div className="campos" style={{ marginTop: 12 }}>
          <div className="campo">
            <label htmlFor="ac-data">Data da medição</label>
            <input id="ac-data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </div>
          <div className="campo" style={{ gridColumn: 'span 2' }}>
            <label htmlFor="ac-desc">Descrição (opcional)</label>
            <input id="ac-desc" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: 3ª medição de outubro" />
          </div>
        </div>
        {aviso && <p className="small" role="status" style={{ marginTop: 8 }}>{aviso}</p>}

        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table className="tabela">
            <thead>
              <tr>
                <th>EAP</th>
                <th>Descrição</th>
                <th>Un.</th>
                <th className="num">Qtd. orçada</th>
                <th className="num">Custo direto</th>
                <th className="num">% atual</th>
                <th className="num">{modo === 'quantidade' ? 'Qtd. executada (acumulada)' : '% executado (acumulado)'}</th>
              </tr>
            </thead>
            <tbody>
              {planilha.linhas.map((l) => {
                const usaQuantidade = modo === 'quantidade' && !!l.unidade;
                return (
                  <tr key={l.id} style={l.folha ? undefined : { fontWeight: 600, background: 'var(--surface-sunken, transparent)' }}>
                    <td className="mono small" style={{ paddingLeft: 12 + profundidade(l.codigo) * 14 }}>{l.codigo} <span className="muted">{ROTULO_NIVEL[l.nivel as keyof typeof ROTULO_NIVEL] ?? ''}</span></td>
                    <td>{l.descricao}</td>
                    <td>{l.unidade ?? '—'}</td>
                    <td className="num">{l.quantidadeOrcada === null ? '—' : l.quantidadeOrcada.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}</td>
                    <td className="num">{formatarMoeda(l.custoDireto / 100)}</td>
                    <td className="num">{pct(l.percentualAtual)}</td>
                    <td className="num">
                      {l.folha ? (
                        <input
                          aria-label={`${usaQuantidade ? 'Quantidade' : 'Percentual'} executado de ${l.codigo}`}
                          inputMode="decimal"
                          style={{ width: 120, textAlign: 'right' }}
                          value={valores[l.id] ?? ''}
                          placeholder={usaQuantidade ? (l.quantidadeOrcada !== null ? `até ${l.quantidadeOrcada}` : '') : 'até 100'}
                          onChange={(e) => setValores({ ...valores, [l.id]: e.target.value })}
                        />
                      ) : (
                        <span className="muted small">média dos filhos</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="acoes" style={{ marginTop: 12 }}>
          <button className="btn btn-primario" type="submit" disabled={ocupado}>{ocupado ? 'Salvando…' : 'Salvar medição'}</button>
        </div>
      </form>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Medições registradas</h2>
        {planilha.medicoes.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nenhuma medição ainda.</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr>
                <th>Data</th>
                <th>Descrição</th>
                <th className="num">Linhas</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...planilha.medicoes].reverse().map((m) => (
                <tr key={m.id}>
                  <td>{dataBr(m.data)}</td>
                  <td>{m.descricao ?? '—'}</td>
                  <td className="num">{m.linhas}</td>
                  <td className="acoes"><button className="btn" type="button" onClick={() => excluir(m)}>Excluir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
