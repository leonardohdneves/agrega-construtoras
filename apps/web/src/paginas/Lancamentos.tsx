import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, formatarData, formatarMoeda, hojeLocal, nomeMes, somarMeses, type LancamentoResumo } from '../api';

type Filtro = 'todos' | 'despesa' | 'receita';

export function Lancamentos() {
  const [params, setParams] = useSearchParams();
  const mes = /^\d{4}-\d{2}$/.test(params.get('mes') ?? '') ? params.get('mes')! : hojeLocal().slice(0, 7);
  const filtro = (['todos', 'despesa', 'receita'].includes(params.get('tipo') ?? '') ? params.get('tipo') : 'todos') as Filtro;
  const [lista, setLista] = useState<LancamentoResumo[] | null>(null);
  const [busca, setBusca] = useState('');
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    setLista(null);
    try {
      const de = `${mes}-01`;
      const ate = somarMeses(de, 1);
      const r = await api<{ lancamentos: LancamentoResumo[] }>(`/fin/lancamentos?de=${de}&ate=${ate}${filtro !== 'todos' ? `&tipo=${filtro}` : ''}`);
      setLista(r.lancamentos);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [mes, filtro]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  const ir = (p: Record<string, string>) => setParams({ mes, tipo: filtro, ...p }, { replace: true });
  const termo = busca.trim().toLowerCase();
  const visiveis = (lista ?? []).filter((l) => !termo || [l.descricao, l.pessoa, l.categorias, l.documento, l.veiculos].some((x) => (x ?? '').toLowerCase().includes(termo)));
  const receitas = visiveis.filter((l) => l.tipo === 'receita').reduce((s, l) => s + l.valorTotal, 0);
  const despesas = visiveis.filter((l) => l.tipo === 'despesa').reduce((s, l) => s + l.valorTotal, 0);

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Lançamentos</h1>
          <span className="muted">Receitas e despesas pela data de competência. Notas fiscais e importação de XML chegam na Etapa 5.</span>
        </div>
        <div className="acoes">
          <Link className="btn btn-secundario" to="/fin/lancamentos/novo?tipo=receita">
            Nova receita
          </Link>
          <Link className="btn btn-primario" to="/fin/lancamentos/novo?tipo=despesa">
            Nova despesa
          </Link>
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}

      <div className="filtros">
        <div className="navegar-mes">
          <button type="button" className="btn btn-link" aria-label="Mês anterior" onClick={() => ir({ mes: somarMeses(`${mes}-01`, -1).slice(0, 7) })}>
            ‹
          </button>
          <strong style={{ minWidth: 150, textAlign: 'center', textTransform: 'capitalize' }}>{nomeMes(mes)}</strong>
          <button type="button" className="btn btn-link" aria-label="Próximo mês" onClick={() => ir({ mes: somarMeses(`${mes}-01`, 1).slice(0, 7) })}>
            ›
          </button>
        </div>
        {(['todos', 'despesa', 'receita'] as const).map((t) => (
          <button key={t} type="button" className={`chip ${filtro === t ? 'chip-ativo' : ''}`} aria-pressed={filtro === t} onClick={() => ir({ tipo: t })}>
            {t === 'todos' ? 'Todos' : t === 'despesa' ? 'Despesas' : 'Receitas'}
          </button>
        ))}
        <input className="busca" type="search" aria-label="Buscar" placeholder="Buscar descrição, fornecedor, categoria ou veículo" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>

      <div className="indicadores">
        <div className="card indicador">
          <span className="rotulo-ind">Receitas lançadas</span>
          <span className="valor-ind mono" style={{ color: 'var(--status-ok-ink)' }}>{lista ? formatarMoeda(receitas) : '—'}</span>
        </div>
        <div className="card indicador">
          <span className="rotulo-ind">Despesas lançadas</span>
          <span className="valor-ind mono">{lista ? formatarMoeda(despesas) : '—'}</span>
        </div>
        <div className="card indicador">
          <span className="rotulo-ind">Diferença no mês</span>
          <span className="valor-ind mono" style={{ color: receitas - despesas < 0 ? 'var(--status-danger-ink)' : undefined }}>{lista ? formatarMoeda(receitas - despesas) : '—'}</span>
          <span className="small muted">Inclui investimentos e empréstimos; a DRE separa na Etapa 7.</span>
        </div>
      </div>

      <div className="card tabela-caixa">
        {!lista ? (
          <p className="muted">Carregando…</p>
        ) : visiveis.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>{lista.length ? 'Nada encontrado na busca.' : 'Nenhum lançamento com competência neste mês.'}</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr>
                <th>Competência</th>
                <th>Descrição</th>
                <th>Fornecedor / cliente</th>
                <th>Categoria</th>
                <th>Pagamento</th>
                <th style={{ textAlign: 'right' }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((l) => (
                <tr key={l.id}>
                  <td className="mono small">{formatarData(l.competencia)}</td>
                  <td>
                    <Link to={`/fin/lancamentos/${l.id}`} style={{ fontWeight: 500 }}>
                      {l.descricao}
                    </Link>
                    <div className="small muted">
                      {l.documento ?? ''}
                      {l.veiculos ? `${l.documento ? ' · ' : ''}${l.veiculos}` : ''}
                      {l.recorrencia !== 'nenhuma' ? `${l.documento || l.veiculos ? ' · ' : ''}repete (${l.recorrenciaOrdem}ª)` : ''}
                    </div>
                  </td>
                  <td className="small">{l.pessoa ?? '—'}</td>
                  <td className="small">{l.categorias ?? '—'}</td>
                  <td className="small">
                    {l.pagas === l.parcelas ? (
                      <span className="selo selo-ok">{l.tipo === 'despesa' ? 'Pago' : 'Recebido'}</span>
                    ) : (
                      <>
                        {l.pagas}/{l.parcelas} {l.parcelas === 1 ? 'parcela' : 'parcelas'}
                        <div className="muted">
                          {formatarMoeda(l.valorAberto)} em aberto{l.proximoVencimento ? ` · vence ${formatarData(l.proximoVencimento)}` : ''}
                        </div>
                      </>
                    )}
                  </td>
                  <td className="mono" style={{ textAlign: 'right', color: l.tipo === 'receita' ? 'var(--status-ok-ink)' : undefined }}>
                    {l.tipo === 'despesa' ? '−' : '+'}
                    {formatarMoeda(l.valorTotal)}
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
