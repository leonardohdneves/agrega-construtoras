import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { mesCurto, SeletorPeriodo, type Periodo } from '../componentes/Periodo';
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
  { id: 'vendas', texto: 'Vendas' },
  { id: 'conversao', texto: 'Propostas x vendas' },
];

type LinhaCom = {
  mes: string; vendas: number; m3: number; valor: number; precoMedio: number | null; emitidas: number; aguardando: number; recusadas: number; fechadas: number; taxa: number | null;
};

/** Abas de Comercial: vendas por mês e a conversão de propostas emitidas em vendas fechadas. */
function AbaComercial({ periodo, aba }: { periodo: Periodo; aba: 'vendas' | 'conversao' }) {
  const [linhas, setLinhas] = useState<LinhaCom[] | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    let vivo = true;
    setLinhas(null);
    setErro('');
    api<{ linhas: LinhaCom[] }>(`/rel/comercial?de=${periodo.de}&ate=${periodo.ate}`)
      .then((d) => vivo && setLinhas(d.linhas))
      .catch((e) => vivo && setErro((e as Error).message));
    return () => {
      vivo = false;
    };
  }, [periodo.de, periodo.ate]);
  if (erro) return <div className="alerta alerta-erro" role="alert">{erro}</div>;
  if (!linhas) return <p className="muted">Carregando…</p>;
  const sufixo = `${periodo.de}_${periodo.ate}`;
  const soma = (k: keyof LinhaCom) => (ls: LinhaCom[]) => ls.reduce((s, l) => s + (Number(l[k]) || 0), 0);
  if (aba === 'vendas') {
    return (
      <TabelaRelatorio
        titulo="Vendas por mês"
        descricao="Vendas aprovadas, pela data de entrega. Valor = concreto e bomba (sem adicionais). Para vendas por vendedor e cliente, use Comercial › Relatórios."
        arquivo={`vendas-por-mes_${sufixo}`}
        linhas={linhas}
        colunas={[
          { titulo: 'Mês', valor: (l) => mesCurto(l.mes) },
          { titulo: 'Vendas', valor: (l) => l.vendas, formato: 'numero', total: true },
          { titulo: 'Vendido (m³)', valor: (l) => l.m3, formato: 'decimal', total: true },
          { titulo: 'Valor vendido', valor: (l) => l.valor, formato: 'moeda', total: true },
          {
            titulo: 'Preço médio/m³',
            valor: (l) => l.precoMedio,
            formato: 'moeda',
            total: (ls) => {
              const m3 = soma('m3')(ls);
              return m3 ? soma('valor')(ls) / m3 : null;
            },
          },
        ]}
      />
    );
  }
  return (
    <TabelaRelatorio
      titulo="Propostas emitidas × vendas fechadas"
      descricao="Propostas emitidas (fora do rascunho) no mês em que foram criadas, e quantas o cliente aceitou. Taxa de conversão = fechadas ÷ emitidas."
      arquivo={`conversao-propostas_${sufixo}`}
      linhas={linhas}
      colunas={[
        { titulo: 'Mês', valor: (l) => mesCurto(l.mes) },
        { titulo: 'Emitidas', valor: (l) => l.emitidas, formato: 'numero', total: true },
        { titulo: 'Aguardando resposta', valor: (l) => l.aguardando, formato: 'numero', total: true },
        { titulo: 'Recusadas', valor: (l) => l.recusadas, formato: 'numero', total: true },
        { titulo: 'Fechadas (aceitas)', valor: (l) => l.fechadas, formato: 'numero', total: true },
        {
          titulo: 'Taxa de conversão',
          valor: (l) => l.taxa,
          formato: 'pct',
          total: (ls) => {
            const e = soma('emitidas')(ls);
            return e ? soma('fechadas')(ls) / e : null;
          },
        },
      ]}
    />
  );
}

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
      {aba === 'vendas' || aba === 'conversao' ? (
        <AbaComercial periodo={periodo} aba={aba} />
      ) : !r ? (
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
