import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, formatarMoeda } from '../api';
import { ATALHOS, mesCurto, SeletorPeriodo, type Periodo } from '../componentes/Periodo';
import { CabecalhoDocumento, imprimirPagina, OpcoesPagina, textoPeriodo, usePaginaImpressao } from '../componentes/Documento';

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

type OpcoesImpressao = { detalhar: boolean; percentual: boolean; fora: boolean; somenteTotais: boolean; meses: 'todos' | 'total' };

export function Dre() {
  const [params, setParams] = useSearchParams();
  const padrao = ATALHOS.find((a) => a.id === '6m')!.periodo();
  const periodo: Periodo = { de: params.get('de') ?? padrao.de, ate: params.get('ate') ?? padrao.ate };
  const visao = params.get('visao') === 'caixa' ? 'caixa' : 'competencia';
  const impostos = params.get('impostos') === 'estimados' ? 'estimados' : 'lancados';
  const [dre, setDre] = useState<RespDre | null>(null);
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState('');
  const [painelImpressao, setPainelImpressao] = useState(false);
  const [opcoes, setOpcoes] = useState<OpcoesImpressao>({ detalhar: false, percentual: true, fora: true, somenteTotais: false, meses: 'todos' });
  const [imprimindo, setImprimindo] = useState<OpcoesImpressao | null>(null);
  const [pagina, setPagina] = usePaginaImpressao();

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

  // Impressão: aplica as opções escolhidas, imprime e volta à tela normal.
  useEffect(() => {
    if (!imprimindo) return;
    const voltar = () => setImprimindo(null);
    window.addEventListener('afterprint', voltar, { once: true });
    const t = setTimeout(() => imprimirPagina(pagina), 20);
    return () => {
      clearTimeout(t);
      window.removeEventListener('afterprint', voltar);
    };
  }, [imprimindo]);

  const alternar = (chave: string) => {
    const n = new Set(abertas);
    if (n.has(chave)) n.delete(chave);
    else n.add(chave);
    setAbertas(n);
  };

  const receita = dre?.linhas.find((l) => l.chave === 'receita_bruta');
  const av = (v: number) => {
    const base = receita?.total ?? 0;
    if (!base) return '';
    return `${((v / base) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  };
  const op = imprimindo;
  const mostrarMeses = (dre?.meses.length ?? 0) > 1 && (!op || op.meses === 'todos');
  const mostrarPct = !op || op.percentual;
  const estaAberta = (chave: string) => (op ? op.detalhar && !op.somenteTotais : abertas.has(chave));
  const filtros = [
    `Visão: ${visao === 'competencia' ? 'competência' : 'caixa'}`,
    `Impostos: ${impostos === 'lancados' ? 'lançados' : 'estimados pelo regime'}`,
    op?.detalhar ? 'Com categorias' : '',
    op?.somenteTotais ? 'Só totais' : '',
  ];

  return (
    <>
      <CabecalhoDocumento
        modulo="Gerencial · Financeiro"
        titulo="DRE gerencial"
        descricao={
          visao === 'competencia'
            ? 'Por competência: receitas e despesas na data do fato (venda, compra, serviço), pagas ou não.'
            : 'Por caixa: o que entrou e saiu de fato, na data do pagamento ou recebimento.'
        }
        periodo={textoPeriodo(periodo.de, periodo.ate)}
        filtros={filtros}
        aoImprimir={() => setPainelImpressao(!painelImpressao)}
      />

      {painelImpressao && (
        <div className="card nao-imprimir painel-impressao">
          <h2>Imprimir a DRE</h2>
          <p className="small muted" style={{ marginTop: 0 }}>
            Sai o período, a visão e os impostos escolhidos acima, com a identidade do Agrega. Escolha o que entra na folha:
          </p>
          <div className="opcoes-impressao">
            <label className="marcar">
              <input type="checkbox" checked={opcoes.detalhar} disabled={opcoes.somenteTotais} onChange={(e) => setOpcoes({ ...opcoes, detalhar: e.target.checked })} />
              <span>Detalhar as categorias de cada linha</span>
            </label>
            <label className="marcar">
              <input type="checkbox" checked={opcoes.somenteTotais} onChange={(e) => setOpcoes({ ...opcoes, somenteTotais: e.target.checked })} />
              <span>Só os totais (receita líquida, lucro bruto, resultados)</span>
            </label>
            <label className="marcar">
              <input type="checkbox" checked={opcoes.percentual} onChange={(e) => setOpcoes({ ...opcoes, percentual: e.target.checked })} />
              <span>Coluna % da receita</span>
            </label>
            <label className="marcar">
              <input type="checkbox" checked={opcoes.fora} onChange={(e) => setOpcoes({ ...opcoes, fora: e.target.checked })} />
              <span>Quadro "Fora da DRE"</span>
            </label>
            {(dre?.meses.length ?? 0) > 1 && (
              <div className="segmentado" role="group" aria-label="Colunas" style={{ maxWidth: 360 }}>
                <button type="button" aria-pressed={opcoes.meses === 'todos'} className={opcoes.meses === 'todos' ? 'ativo' : ''} onClick={() => setOpcoes({ ...opcoes, meses: 'todos' })}>
                  Mês a mês e total
                </button>
                <button type="button" aria-pressed={opcoes.meses === 'total'} className={opcoes.meses === 'total' ? 'ativo' : ''} onClick={() => setOpcoes({ ...opcoes, meses: 'total' })}>
                  Só o total do período
                </button>
              </div>
            )}
          </div>
          <OpcoesPagina valor={pagina} aoMudar={setPagina} />
          <div className="acoes">
            <button className="btn btn-primario" type="button" disabled={!dre} onClick={() => setImprimindo({ ...opcoes })}>
              Imprimir
            </button>
            <button className="btn btn-link" type="button" onClick={() => setPainelImpressao(false)}>
              Fechar
            </button>
            <span className="small muted">Para salvar em PDF, escolha "Salvar como PDF" na janela de impressão.</span>
          </div>
        </div>
      )}

      <div className="nao-imprimir">
        <SeletorPeriodo valor={periodo} aoMudar={(p) => ir({ de: p.de, ate: p.ate })} />
      </div>
      <div className="acoes nao-imprimir">
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

      <section className="card tabela-caixa relatorio">
        {!dre ? (
          !erro && <p className="muted">Carregando…</p>
        ) : (
          <table className="tabela tabela-dre">
            <thead>
              <tr>
                <th className="col-fixa">Demonstração do resultado</th>
                {mostrarMeses && dre.meses.map((m) => <th key={m} style={{ textAlign: 'right' }}>{mesCurto(m)}</th>)}
                <th style={{ textAlign: 'right' }}>{dre.meses.length > 1 ? 'Total' : mesCurto(dre.meses[0])}</th>
                {mostrarPct && <th style={{ textAlign: 'right' }} title="Percentual da receita bruta">% receita</th>}
              </tr>
            </thead>
            <tbody>
              {dre.linhas.map((l) => {
                const aberta = estaAberta(l.chave);
                const expandivel = l.tipo === 'grupo' && l.categorias.length > 0;
                if (l.tipo === 'grupo' && !l.total && !Object.values(l.valores).some(Boolean) && !['receita_bruta', 'deducoes'].includes(l.chave)) return null;
                if (op?.somenteTotais && l.tipo === 'grupo' && l.chave !== 'receita_bruta') return null;
                return (
                  <Fragment key={l.chave}>
                    <tr className={`dre-${l.tipo}`}>
                      <td className="col-fixa">
                        {expandivel && !op ? (
                          <button type="button" className="dre-abrir" aria-expanded={aberta} onClick={() => alternar(l.chave)}>
                            <span aria-hidden="true">{aberta ? '▾' : '▸'}</span> {l.nome}
                          </button>
                        ) : (
                          <span>{l.nome}</span>
                        )}
                        {l.estimado && <span className="selo selo-neutro" style={{ marginLeft: 8 }}>estimado</span>}
                      </td>
                      {mostrarMeses && dre.meses.map((m) => <td key={m} className="mono num">{valorCelula(l.valores[m])}</td>)}
                      <td className="mono num forte">{valorCelula(l.total)}</td>
                      {mostrarPct && <td className="mono num muted">{av(l.total)}</td>}
                    </tr>
                    {aberta &&
                      l.categorias.map((c) => (
                        <tr key={c.id} className="dre-categoria">
                          <td className="col-fixa">
                            <span className="mono muted">{c.codigo}</span> {c.nome}
                          </td>
                          {mostrarMeses && dre.meses.map((m) => <td key={m} className="mono num">{valorCelula(c.valores[m])}</td>)}
                          <td className="mono num">{valorCelula(c.total)}</td>
                          {mostrarPct && <td className="mono num muted">{av(c.total)}</td>}
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {dre && (dre.fora.total !== 0 || dre.fora.categorias.length > 0) && (!op || op.fora) && (
        <section className="card tabela-caixa relatorio">
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
                  {mostrarMeses && dre.meses.map((m) => <td key={m} className="mono num">{valorCelula(c.valores[m])}</td>)}
                  <td className="mono num forte">{valorCelula(c.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <p className="small muted doc-rodape-nota">
        Só entra o que está confirmado: notas em conferência e lançamentos cancelados ficam de fora.
        {visao === 'caixa' && ' Na visão de caixa, juros e descontos das baixas aparecem no resultado financeiro.'}
        <span className="nao-imprimir"> Clique numa linha com ▸ para ver as categorias.</span>
      </p>
    </>
  );
}
