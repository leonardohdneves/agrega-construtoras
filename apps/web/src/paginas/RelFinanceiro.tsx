import { NOMES_FORMA, NOMES_LINHA_DRE, formatarData, type FormaPagamento, type LinhaDre } from '../api';
import { mesCurto, SeletorPeriodo } from '../componentes/Periodo';
import { CabecalhoRelatorio, TabelaRelatorio, useRelatorio } from '../componentes/Relatorio';

type Resp = {
  de: string; ate: string; hoje: string;
  porCategoria: { tipo: 'receita' | 'despesa'; codigo: string; nome: string; linhaDre: LinhaDre; valor: number; lancamentos: number }[];
  porCentro: { nome: string; valor: number }[];
  porPessoa: { tipo: 'receita' | 'despesa'; nome: string; valor: number; lancamentos: number }[];
  porMes: { mes: string; recebido: number; pago: number; jurosPagos: number; descontosObtidos: number }[];
  porForma: { forma: string; recebido: number; pago: number; baixas: number }[];
  aging: { tipo: 'receita' | 'despesa'; faixa: 'a_vencer' | 'ate30' | 'ate60' | 'ate90' | 'mais90'; valor: number; parcelas: number }[];
};

const ABAS = [
  { id: 'despesas', texto: 'Despesas por categoria' },
  { id: 'receitas', texto: 'Receitas por categoria' },
  { id: 'centros', texto: 'Por centro de custo' },
  { id: 'fornecedores', texto: 'Por fornecedor' },
  { id: 'clientes', texto: 'Por cliente' },
  { id: 'caixa', texto: 'Pago e recebido' },
  { id: 'aging', texto: 'Idade das contas' },
];

const FAIXAS: { id: Resp['aging'][number]['faixa']; texto: string }[] = [
  { id: 'a_vencer', texto: 'A vencer' },
  { id: 'ate30', texto: 'Vencidas há até 30 dias' },
  { id: 'ate60', texto: '31 a 60 dias' },
  { id: 'ate90', texto: '61 a 90 dias' },
  { id: 'mais90', texto: 'Mais de 90 dias' },
];

export function RelFinanceiro() {
  const { periodo, aba, dados: r, erro, mudar } = useRelatorio<Resp>('/rel/financeiro', 'despesas', '3m');
  const sufixo = `${periodo.de}_${periodo.ate}`;
  const desc = r ? `Lançamentos confirmados pela competência, de ${formatarData(r.de)} a ${formatarData(r.ate)}.` : '';
  const cats = (tipo: 'receita' | 'despesa') => {
    const xs = (r?.porCategoria ?? []).filter((c) => c.tipo === tipo).sort((a, b) => b.valor - a.valor);
    const total = xs.reduce((s, c) => s + c.valor, 0);
    return xs.map((c) => ({ ...c, part: total ? c.valor / total : null }));
  };
  return (
    <>
      <CabecalhoRelatorio
        modulo="Financeiro"
        periodo={aba !== 'aging' ? periodo : null}
        titulo="Relatórios financeiros"
        sub="Para onde vai e de onde vem o dinheiro: categorias, centros de custo, fornecedores, clientes e prazos."
        abas={ABAS}
        aba={aba}
        aoMudar={(id) => mudar({ aba: id })}
        extra={aba !== 'aging' ? <SeletorPeriodo valor={periodo} aoMudar={(p) => mudar(p)} /> : undefined}
      />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {!r ? (
        !erro && <p className="muted">Carregando…</p>
      ) : aba === 'despesas' || aba === 'receitas' ? (
        <TabelaRelatorio
          titulo={aba === 'despesas' ? 'Despesas por categoria' : 'Receitas por categoria'}
          descricao={desc}
          arquivo={`${aba}-por-categoria_${sufixo}`}
          linhas={cats(aba === 'despesas' ? 'despesa' : 'receita')}
          colunas={[
            { titulo: 'Código', valor: (c) => c.codigo },
            { titulo: 'Categoria', valor: (c) => c.nome },
            { titulo: 'Linha da DRE', valor: (c) => NOMES_LINHA_DRE[c.linhaDre] },
            { titulo: 'Lançamentos', valor: (c) => c.lancamentos, formato: 'numero', total: true },
            { titulo: 'Valor', valor: (c) => c.valor, formato: 'moeda', total: true },
            { titulo: '% do total', valor: (c) => c.part, formato: 'pct' },
          ]}
        />
      ) : aba === 'centros' ? (
        <TabelaRelatorio
          titulo="Despesas por centro de custo"
          descricao={`${desc} Sem investimentos e empréstimos.`}
          arquivo={`despesas-por-centro_${sufixo}`}
          linhas={r.porCentro}
          colunas={[
            { titulo: 'Centro de custo', valor: (c) => c.nome },
            { titulo: 'Valor', valor: (c) => c.valor, formato: 'moeda', total: true },
            { titulo: '% do total', valor: (c) => c.valor / (r.porCentro.reduce((s, x) => s + x.valor, 0) || 1), formato: 'pct' },
          ]}
        />
      ) : aba === 'fornecedores' || aba === 'clientes' ? (
        <TabelaRelatorio
          titulo={aba === 'fornecedores' ? 'Despesas por fornecedor e credor' : 'Receitas por cliente'}
          descricao={desc}
          arquivo={`${aba}_${sufixo}`}
          limite={30}
          linhas={r.porPessoa.filter((p) => p.tipo === (aba === 'fornecedores' ? 'despesa' : 'receita'))}
          colunas={[
            { titulo: aba === 'fornecedores' ? 'Fornecedor / credor' : 'Cliente', valor: (p) => p.nome },
            { titulo: 'Lançamentos', valor: (p) => p.lancamentos, formato: 'numero', total: true },
            { titulo: 'Valor', valor: (p) => p.valor, formato: 'moeda', total: true },
          ]}
        />
      ) : aba === 'caixa' ? (
        <>
          <TabelaRelatorio
            titulo="Pago e recebido por mês"
            descricao="Pela data da baixa (pagamento ou recebimento)."
            arquivo={`pago-recebido_${sufixo}`}
            linhas={r.porMes}
            colunas={[
              { titulo: 'Mês', valor: (m) => mesCurto(m.mes) },
              { titulo: 'Recebido', valor: (m) => m.recebido, formato: 'moeda', total: true },
              { titulo: 'Pago', valor: (m) => m.pago, formato: 'moeda', total: true },
              { titulo: 'Diferença', valor: (m) => m.recebido - m.pago, formato: 'moeda', total: true, destaque: (m) => (m.recebido - m.pago < 0 ? 'perigo' : undefined) },
              { titulo: 'Juros pagos', valor: (m) => m.jurosPagos, formato: 'moeda', total: true },
              { titulo: 'Descontos obtidos', valor: (m) => m.descontosObtidos, formato: 'moeda', total: true },
            ]}
          />
          <TabelaRelatorio
            titulo="Por forma de pagamento"
            arquivo={`formas-de-pagamento_${sufixo}`}
            linhas={r.porForma}
            colunas={[
              { titulo: 'Forma', valor: (f) => NOMES_FORMA[f.forma as FormaPagamento] ?? 'Não informada' },
              { titulo: 'Baixas', valor: (f) => f.baixas, formato: 'numero', total: true },
              { titulo: 'Recebido', valor: (f) => f.recebido, formato: 'moeda', total: true },
              { titulo: 'Pago', valor: (f) => f.pago, formato: 'moeda', total: true },
            ]}
          />
        </>
      ) : (
        <TabelaRelatorio
          titulo="Idade das contas em aberto"
          descricao={`Situação em ${formatarData(r.hoje)}: quanto está a vencer e há quanto tempo o resto está vencido.`}
          arquivo="idade-das-contas"
          linhas={FAIXAS.map((f) => {
            const pag = r.aging.find((a) => a.tipo === 'despesa' && a.faixa === f.id);
            const rec = r.aging.find((a) => a.tipo === 'receita' && a.faixa === f.id);
            return { faixa: f.texto, id: f.id, pagar: pag?.valor ?? 0, pagarN: pag?.parcelas ?? 0, receber: rec?.valor ?? 0, receberN: rec?.parcelas ?? 0 };
          })}
          colunas={[
            { titulo: 'Faixa', valor: (a) => a.faixa },
            { titulo: 'A pagar', valor: (a) => a.pagar, formato: 'moeda', total: true, destaque: (a) => (a.id !== 'a_vencer' && a.pagar ? 'perigo' : undefined) },
            { titulo: 'Parcelas a pagar', valor: (a) => a.pagarN, formato: 'numero', total: true },
            { titulo: 'A receber', valor: (a) => a.receber, formato: 'moeda', total: true, destaque: (a) => (a.id !== 'a_vencer' && a.receber ? 'aviso' : undefined) },
            { titulo: 'Parcelas a receber', valor: (a) => a.receberN, formato: 'numero', total: true },
          ]}
        />
      )}
    </>
  );
}
