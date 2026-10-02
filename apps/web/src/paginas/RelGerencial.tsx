import { Link } from 'react-router-dom';
import { mesCurto, SeletorPeriodo } from '../componentes/Periodo';
import { CabecalhoRelatorio, TabelaRelatorio, useRelatorio } from '../componentes/Relatorio';

type Linha = {
  mes: string; receita: number; custoFrota: number; custoFrotaSemNota: number; frotaSobreReceita: number | null; lucroBruto: number; resultado: number;
  recebido: number; pago: number; litros: number; km: number; horas: number; receitaPorKm: number | null; osConcluidas: number;
  notasCompra: number; notasVenda: number; notasConfirmadas: number; notasPendentes: number; abastecimentosComNota: number | null;
};
type Resp = { meses: string[]; linhas: Linha[] };

const ABAS = [
  { id: 'resultado', texto: 'Resultado e frota' },
  { id: 'operacao', texto: 'Operação e receita' },
  { id: 'conferencia', texto: 'Conferência documental' },
];

const soma = (k: keyof Linha) => (ls: Linha[]) => ls.reduce((s, l) => s + (Number(l[k]) || 0), 0);

export function RelGerencial() {
  const { periodo, aba, dados: r, erro, mudar } = useRelatorio<Resp>('/rel/gerencial', 'resultado', '6m');
  const sufixo = `${periodo.de}_${periodo.ate}`;
  return (
    <>
      <CabecalhoRelatorio
        modulo="Gerencial"
        periodo={periodo}
        titulo="Relatórios gerais"
        sub="Cruzam frota, financeiro e notas fiscais mês a mês. Para DRE, fluxo de caixa e custo por veículo, use os itens do módulo Gerencial."
        abas={ABAS}
        aba={aba}
        aoMudar={(id) => mudar({ aba: id })}
        extra={<SeletorPeriodo valor={periodo} aoMudar={(p) => mudar(p)} />}
      />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {!r ? (
        !erro && <p className="muted">Carregando…</p>
      ) : aba === 'resultado' ? (
        <TabelaRelatorio
          titulo="Resultado e peso da frota"
          descricao={
            <>
              Receita e resultado pela competência (<Link to="/ger/dre">DRE</Link>). Custo da frota = lançado na DRE + abastecimentos e OS ainda sem nota.
            </>
          }
          arquivo={`resultado-e-frota_${sufixo}`}
          linhas={r.linhas}
          colunas={[
            { titulo: 'Mês', valor: (l) => mesCurto(l.mes) },
            { titulo: 'Receita bruta', valor: (l) => l.receita, formato: 'moeda', total: true },
            { titulo: 'Custo da frota', valor: (l) => l.custoFrota, formato: 'moeda', total: true },
            { titulo: 'dos quais sem nota', valor: (l) => l.custoFrotaSemNota, formato: 'moeda', total: true, destaque: (l) => (l.custoFrotaSemNota ? 'aviso' : undefined) },
            {
              titulo: 'Frota / receita',
              valor: (l) => l.frotaSobreReceita,
              formato: 'pct',
              total: (ls) => {
                const rec = soma('receita')(ls);
                return rec ? soma('custoFrota')(ls) / rec : null;
              },
            },
            { titulo: 'Lucro bruto', valor: (l) => l.lucroBruto, formato: 'moeda', total: true, destaque: (l) => (l.lucroBruto < 0 ? 'perigo' : undefined) },
            { titulo: 'Resultado', valor: (l) => l.resultado, formato: 'moeda', total: true, destaque: (l) => (l.resultado < 0 ? 'perigo' : 'ok') },
            { titulo: 'Recebido', valor: (l) => l.recebido, formato: 'moeda', total: true },
            { titulo: 'Pago', valor: (l) => l.pago, formato: 'moeda', total: true },
          ]}
        />
      ) : aba === 'operacao' ? (
        <TabelaRelatorio
          titulo="Operação da frota e receita"
          descricao="Quanto a frota rodou e trabalhou em cada mês e quanto isso gerou de receita."
          arquivo={`operacao-e-receita_${sufixo}`}
          linhas={r.linhas}
          colunas={[
            { titulo: 'Mês', valor: (l) => mesCurto(l.mes) },
            { titulo: 'Receita bruta', valor: (l) => l.receita, formato: 'moeda', total: true },
            { titulo: 'Km rodados', valor: (l) => l.km, formato: 'km', total: true },
            { titulo: 'Horas de bomba', valor: (l) => l.horas, formato: 'horas', total: true },
            { titulo: 'Diesel', valor: (l) => l.litros, formato: 'litros', total: true },
            {
              titulo: 'Receita por km',
              valor: (l) => l.receitaPorKm,
              formato: 'moeda',
              total: (ls) => {
                const km = soma('km')(ls);
                return km ? soma('receita')(ls) / km : null;
              },
            },
            { titulo: 'OS concluídas', valor: (l) => l.osConcluidas, formato: 'numero', total: true },
          ]}
        />
      ) : (
        <TabelaRelatorio
          titulo="Conferência documental"
          descricao="Notas fiscais lançadas e quanto dos abastecimentos já foi conferido com a nota do posto."
          arquivo={`conferencia-documental_${sufixo}`}
          linhas={r.linhas}
          colunas={[
            { titulo: 'Mês', valor: (l) => mesCurto(l.mes) },
            { titulo: 'Notas lançadas', valor: (l) => l.notasConfirmadas, formato: 'numero', total: true },
            { titulo: 'Para conferir', valor: (l) => l.notasPendentes, formato: 'numero', total: true, destaque: (l) => (l.notasPendentes ? 'aviso' : undefined) },
            { titulo: 'Compras com nota', valor: (l) => l.notasCompra, formato: 'moeda', total: true },
            { titulo: 'Vendas com nota', valor: (l) => l.notasVenda, formato: 'moeda', total: true },
            { titulo: 'Abastecimentos com nota', valor: (l) => l.abastecimentosComNota, formato: 'pct', destaque: (l) => (l.abastecimentosComNota !== null && l.abastecimentosComNota < 0.9 ? 'aviso' : undefined) },
          ]}
        />
      )}
    </>
  );
}
