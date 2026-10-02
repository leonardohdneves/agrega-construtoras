import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, formatarMoeda } from '../api';
import { ATALHOS, mesCurto, SeletorPeriodo, type Periodo } from '../componentes/Periodo';

type Valores = Record<string, number>;
type LinhaDre = {
  chave: string;
  nome: string;
  tipo: 'grupo' | 'subtotal' | 'resultado';
  estimado: boolean;
  valores: Valores;
  total: number;
  categorias: { id: string; codigo: string; nome: string; valores: Valores; total: number }[];
};
type RespDre = { meses: string[]; visao: 'competencia' | 'caixa'; impostos: 'lancados' | 'estimados'; regime: 'simples' | 'presumido' | 'real'; temAliquota: boolean; linhas: LinhaDre[]; fora: LinhaDre };

const NOMES_REGIME = { simples: 'Simples Nacional', presumido: 'Lucro Presumido', real: 'Lucro Real' };

function valorCelula(v: number) {
  if (!v) return <span className="muted">—</span>;
  return <span className={v < 0 ? 'negativo' : undefined}>{formatarMoeda(v)}</span>;
}

export function Dre() {
  const [params, setParams] = useSearchParams();
  const padrao = ATALHOS.find((a) => a.id === '6m')!.periodo();
  const periodo: Periodo = { de: params.get('de') ?? padrao.de, ate: params.get('ate') ?? padrao.ate };
  const visao = params.get('visao') === 'caixa' ? 'caixa' : 'competencia';
  const impostos = params.get('impostos') === 'estimados' ? 'estimados' : 'lancados';
  const [dre, setDre] = useState<RespDre | null>(null);
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState('');

  const ir = (p: Record<string, string>) => setParams({ de: periodo.de, ate: periodo.ate, visao, impostos, ...p }, { replace: true });

  const carregar = useCallback(async () => {
    setDre(null);
    setErro('');
    try {
      setDre(await api<RespDre>(`/ger/dre?de=${periodo.de}&ate=${periodo.ate}&visao=${visao}&impostos=${impostos}`));
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [periodo.de, periodo.ate, visao, impostos]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  const alternar = (chave: string) => {
    const n = new Set(abertas);
    if (n.has(chave)) n.delete(chave);
    else n.add(chave);
    setAbertas(n);
  };

  const receita = dre?.linhas.find((l) => l.chave === 'receita_bruta');
  const av = (v: number, mes?: string) => {
    const base = mes ? receita?.valores[mes] ?? 0 : receita?.total ?? 0;
    if (!base) return '';
    return `${((v / base) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  };
  const varios = (dre?.meses.length ?? 0) > 1;

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>DRE gerencial</h1>
          <span className="muted">
            {visao === 'competencia'
              ? 'Por competência: receitas e despesas na data do fato (venda, compra, serviço), pagas ou não.'
              : 'Por caixa: o que entrou e saiu de fato, na data do pagamento ou recebimento.'}
          </span>
        </div>
      </div>

      <SeletorPeriodo valor={periodo} aoMudar={(p) => ir({ de: p.de, ate: p.ate })} />
      <div className="acoes">
        <div className="segmentado" role="group" aria-label="Visão" style={{ minWidth: 260 }}>
          <button type="button" aria-pressed={visao === 'competencia'} className={visao === 'competencia' ? 'ativo' : ''} onClick={() => ir({ visao: 'competencia' })}>
            Competência
          </button>
          <button type="button" aria-pressed={visao === 'caixa'} className={visao === 'caixa' ? 'ativo' : ''} onClick={() => ir({ visao: 'caixa' })}>
            Caixa
          </button>
        </div>
        <div className="segmentado" role="group" aria-label="Impostos" style={{ minWidth: 300 }}>
          <button type="button" aria-pressed={impostos === 'lancados'} className={impostos === 'lancados' ? 'ativo' : ''} onClick={() => ir({ impostos: 'lancados' })}>
            Impostos lançados
          </button>
          <button type="button" aria-pressed={impostos === 'estimados'} className={impostos === 'estimados' ? 'ativo' : ''} onClick={() => ir({ impostos: 'estimados' })}>
            Estimados pelo regime
          </button>
        </div>
      </div>
      {dre && impostos === 'estimados' && (
        <div className={`alerta ${dre.temAliquota ? 'alerta-info' : 'alerta-aviso'}`}>
          {dre.temAliquota ? (
            <>
              Impostos calculados pelas alíquotas do {NOMES_REGIME[dre.regime]} cadastradas em <Link to="/empresa">Empresa</Link>
              {dre.regime === 'real' ? ' (IRPJ e CSLL sobre o lucro do mês).' : dre.regime === 'presumido' ? ' (IRPJ e CSLL efetivos sobre a receita).' : '.'} Os impostos lançados ficam de fora para não contar duas vezes.
            </>
          ) : (
            <>
              Nenhuma alíquota cadastrada para o {NOMES_REGIME[dre.regime]}. <Link to="/empresa">Cadastre em Empresa</Link> para estimar os impostos.
            </>
          )}
        </div>
      )}
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}

      <div className="card tabela-caixa">
        {!dre ? (
          !erro && <p className="muted">Carregando…</p>
        ) : (
          <table className="tabela tabela-dre">
            <thead>
              <tr>
                <th className="col-fixa">Linha</th>
                {varios && dre.meses.map((m) => <th key={m} style={{ textAlign: 'right' }}>{mesCurto(m)}</th>)}
                <th style={{ textAlign: 'right' }}>{varios ? 'Total' : mesCurto(dre.meses[0])}</th>
                <th style={{ textAlign: 'right' }} title="Percentual da receita bruta">% receita</th>
              </tr>
            </thead>
            <tbody>
              {dre.linhas.map((l) => {
                const aberta = abertas.has(l.chave);
                const expandivel = l.tipo === 'grupo' && l.categorias.length > 0;
                if (l.tipo === 'grupo' && !l.total && !Object.values(l.valores).some(Boolean) && !['receita_bruta', 'deducoes'].includes(l.chave)) return null;
                return (
                  <Fragment key={l.chave}>
                    <tr className={`dre-${l.tipo}`}>
                      <td className="col-fixa">
                        {expandivel ? (
                          <button type="button" className="dre-abrir" aria-expanded={aberta} onClick={() => alternar(l.chave)}>
                            <span aria-hidden="true">{aberta ? '▾' : '▸'}</span> {l.nome}
                          </button>
                        ) : (
                          <span>{l.nome}</span>
                        )}
                        {l.estimado && <span className="selo selo-neutro" style={{ marginLeft: 8 }}>estimado</span>}
                      </td>
                      {varios && dre.meses.map((m) => <td key={m} className="mono num">{valorCelula(l.valores[m])}</td>)}
                      <td className="mono num forte">{valorCelula(l.total)}</td>
                      <td className="mono num muted">{av(l.total)}</td>
                    </tr>
                    {aberta &&
                      l.categorias.map((c) => (
                        <tr key={c.id} className="dre-categoria">
                          <td className="col-fixa">
                            <span className="mono muted">{c.codigo}</span> {c.nome}
                          </td>
                          {varios && dre.meses.map((m) => <td key={m} className="mono num">{valorCelula(c.valores[m])}</td>)}
                          <td className="mono num">{valorCelula(c.total)}</td>
                          <td className="mono num muted">{av(c.total)}</td>
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {dre && (dre.fora.total !== 0 || dre.fora.categorias.length > 0) && (
        <div className="card tabela-caixa">
          <h2>Fora da DRE</h2>
          <p className="small muted" style={{ marginTop: 0 }}>
            Compra de veículos, obras, empréstimos e retiradas dos sócios mexem no caixa, mas não são receita nem despesa do período.
          </p>
          <table className="tabela tabela-dre">
            <tbody>
              {dre.fora.categorias.map((c) => (
                <tr key={c.id} className="dre-categoria">
                  <td className="col-fixa">
                    <span className="mono muted">{c.codigo}</span> {c.nome}
                  </td>
                  {varios && dre.meses.map((m) => <td key={m} className="mono num">{valorCelula(c.valores[m])}</td>)}
                  <td className="mono num forte">{valorCelula(c.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted">
        Clique numa linha com ▸ para ver as categorias. Só entra o que está confirmado: notas em conferência e lançamentos cancelados ficam de fora.
        {visao === 'caixa' && ' Na visão de caixa, juros e descontos das baixas aparecem no resultado financeiro.'}
      </p>
    </>
  );
}
