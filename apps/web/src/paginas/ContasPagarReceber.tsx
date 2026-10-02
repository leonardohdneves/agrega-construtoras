import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FormBaixa } from '../componentes/FormBaixa';
import { api, formatarData, formatarMoeda, NOMES_FORMA, SELO_PARCELA, type ContaFinanceira, type Parcela, type TipoLanc } from '../api';

type Situacao = 'vencidas' | 'hoje' | 'semana' | 'mes' | 'abertas' | 'pagas';
const FILTROS: { id: Situacao; texto: string }[] = [
  { id: 'vencidas', texto: 'Vencidas' },
  { id: 'hoje', texto: 'Hoje' },
  { id: 'semana', texto: 'Próximos 7 dias' },
  { id: 'mes', texto: 'Este mês' },
  { id: 'abertas', texto: 'Todas em aberto' },
  { id: 'pagas', texto: 'Pagas no mês' },
];

export function ContasPagarReceber() {
  const [params, setParams] = useSearchParams();
  const tipo: TipoLanc = params.get('tipo') === 'receita' ? 'receita' : 'despesa';
  const situacao = (FILTROS.some((f) => f.id === params.get('situacao')) ? params.get('situacao') : 'abertas') as Situacao;
  const [lista, setLista] = useState<{ parcelas: Parcela[]; total: number } | null>(null);
  const [contas, setContas] = useState<ContaFinanceira[]>([]);
  const [baixando, setBaixando] = useState<string | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await api<{ parcelas: Parcela[]; total: number }>(`/fin/parcelas?tipo=${tipo}&situacao=${situacao}`);
      setLista(r);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [tipo, situacao]);

  useEffect(() => {
    setLista(null);
    setBaixando(null);
    carregar();
  }, [carregar]);
  useEffect(() => {
    api<{ contas: ContaFinanceira[] }>('/fin/contas').then((r) => setContas(r.contas)).catch(() => {});
  }, []);

  function mudar(p: Record<string, string>) {
    setAviso('');
    setErro('');
    setParams({ tipo, situacao, ...p }, { replace: true });
  }

  async function estornar(p: Parcela) {
    setErro('');
    setOcupado(true);
    try {
      await api(`/fin/parcelas/${p.id}/estornar`, { metodo: 'POST' });
      setAviso(`${tipo === 'despesa' ? 'Pagamento' : 'Recebimento'} de "${p.descricao}" estornado. A parcela voltou para em aberto.`);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const pagas = situacao === 'pagas';
  const verbo = tipo === 'despesa' ? 'Pagar' : 'Receber';

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Contas a pagar e a receber</h1>
          <span className="muted">Cada parcela tem vencimento; ao dar baixa, o valor sai (pagamento) ou entra (recebimento) no saldo da conta escolhida.</span>
        </div>
        <Link className="btn btn-primario" to={`/fin/lancamentos/novo?tipo=${tipo}`}>
          {tipo === 'despesa' ? 'Nova despesa' : 'Nova receita'}
        </Link>
      </div>

      <div className="abas" role="tablist">
        <button type="button" role="tab" aria-selected={tipo === 'despesa'} className={tipo === 'despesa' ? 'ativa' : ''} onClick={() => mudar({ tipo: 'despesa' })}>
          A pagar
        </button>
        <button type="button" role="tab" aria-selected={tipo === 'receita'} className={tipo === 'receita' ? 'ativa' : ''} onClick={() => mudar({ tipo: 'receita' })}>
          A receber
        </button>
      </div>

      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}

      <div className="filtros">
        {FILTROS.map((f) => (
          <button key={f.id} type="button" className={`chip ${situacao === f.id ? 'chip-ativo' : ''}`} aria-pressed={situacao === f.id} onClick={() => mudar({ situacao: f.id })}>
            {f.id === 'pagas' && tipo === 'receita' ? 'Recebidas no mês' : f.texto}
          </button>
        ))}
      </div>

      <div className="card tabela-caixa">
        {!lista ? (
          <p className="muted">Carregando…</p>
        ) : lista.parcelas.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            {pagas ? 'Nada foi baixado neste mês.' : situacao === 'vencidas' ? 'Nenhuma conta vencida.' : 'Nenhuma conta neste período.'}
          </p>
        ) : (
          <table className="tabela">
            <thead>
              <tr>
                <th>{pagas ? (tipo === 'despesa' ? 'Pago em' : 'Recebido em') : 'Vencimento'}</th>
                <th>Descrição</th>
                <th>{tipo === 'despesa' ? 'Fornecedor / credor' : 'Cliente'}</th>
                <th>Categoria</th>
                <th>Situação</th>
                <th style={{ textAlign: 'right' }}>Valor</th>
                <th><span style={{ position: 'absolute', left: -9999 }}>Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {lista.parcelas.map((p) => (
                <FilaParcela
                  key={p.id}
                  p={p}
                  pagas={pagas}
                  verbo={verbo}
                  ocupado={ocupado}
                  baixando={baixando === p.id}
                  aoBaixar={() => setBaixando(baixando === p.id ? null : p.id)}
                  aoEstornar={() => estornar(p)}
                >
                  <FormBaixa
                    parcela={p}
                    tipo={tipo}
                    contas={contas}
                    aoCancelar={() => setBaixando(null)}
                    aoConcluir={() => {
                      setBaixando(null);
                      setAviso(`"${p.descricao}" ${tipo === 'despesa' ? 'paga' : 'recebida'}.`);
                      carregar();
                    }}
                  />
                </FilaParcela>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} className="small muted">
                  {lista.parcelas.length} {lista.parcelas.length === 1 ? 'parcela' : 'parcelas'}
                </td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{formatarMoeda(lista.total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </>
  );
}

function FilaParcela({
  p,
  pagas,
  verbo,
  ocupado,
  baixando,
  aoBaixar,
  aoEstornar,
  children,
}: {
  p: Parcela;
  pagas: boolean;
  verbo: string;
  ocupado: boolean;
  baixando: boolean;
  aoBaixar: () => void;
  aoEstornar: () => void;
  children: ReactNode;
}) {
  const s = SELO_PARCELA[p.situacao];
  return (
    <>
      <tr>
        <td className="mono small">{formatarData(pagas ? p.dataPagamento : p.vencimento)}</td>
        <td>
          <Link to={`/fin/lancamentos/${p.lancamentoId}`} style={{ fontWeight: 500 }}>
            {p.descricao}
          </Link>
          <div className="small muted">
            {p.totalParcelas && p.totalParcelas > 1 ? `Parcela ${p.numero} de ${p.totalParcelas}` : 'Parcela única'}
            {p.documento ? ` · ${p.documento}` : ''}
            {pagas && p.contaNome ? ` · ${p.contaNome}${p.forma ? ` · ${NOMES_FORMA[p.forma]}` : ''}` : ''}
          </div>
        </td>
        <td className="small">{p.pessoa ?? '—'}</td>
        <td className="small">{p.categorias ?? '—'}</td>
        <td>
          <span className={`selo ${s.classe}`}>{s.texto}</span>
        </td>
        <td className="mono" style={{ textAlign: 'right' }}>
          {formatarMoeda(pagas ? p.valorPago : p.valor)}
          {pagas && (p.juros > 0 || p.desconto > 0) && (
            <div className="small muted">
              {p.juros > 0 ? `+${formatarMoeda(p.juros)} juros` : ''} {p.desconto > 0 ? `−${formatarMoeda(p.desconto)} desc.` : ''}
            </div>
          )}
        </td>
        <td>
          {p.status === 'aberta' ? (
            <button className="btn btn-link" type="button" onClick={aoBaixar} aria-expanded={baixando}>
              {baixando ? 'Fechar' : verbo}
            </button>
          ) : p.status === 'paga' ? (
            <button className="btn btn-link" type="button" disabled={ocupado} onClick={aoEstornar}>
              Estornar
            </button>
          ) : null}
        </td>
      </tr>
      {baixando && (
        <tr className="linha-form">
          <td colSpan={7}>{children}</td>
        </tr>
      )}
    </>
  );
}
