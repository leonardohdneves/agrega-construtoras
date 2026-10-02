import { Link } from 'react-router-dom';
import { NOMES_FUNCAO, NOMES_STATUS_VEICULO, NOMES_TIPO_DOCUMENTO, NOMES_TIPO_VEICULO, formatarData, type DocumentoVeiculo, type Funcao, type StatusVeiculo, type TipoVeiculo } from '../api';
import { mesCurto, SeletorPeriodo } from '../componentes/Periodo';
import { CabecalhoRelatorio, TabelaRelatorio, useRelatorio } from '../componentes/Relatorio';

type Veic = {
  veiculoId: string; codigo: string; tipo: TipoVeiculo; status: StatusVeiculo; abastecimentos: number; litros: number; valor: number; km: number; horas: number;
  kmPorLitro: number | null; litrosPorHora: number | null; precoLitro: number | null; semNota: number; osConcluidas: number; osCorretivas: number; osAbertas: number;
  diasParado: number; custoOs: number; revisoesVencidas: number; revisoesProximas: number;
};
type Resp = {
  de: string; ate: string; hoje: string;
  porVeiculo: Veic[];
  porMotorista: { nome: string; funcao: Funcao | null; abastecimentos: number; litros: number; valor: number; veiculos: string }[];
  porMes: { mes: string; abastecimentos: number; litros: number; valor: number; precoLitro: number | null; osConcluidas: number; custoOs: number }[];
  vencimentos: { tipo: 'documento' | 'cnh'; referencia: string; veiculoId?: string; item: string; descricao: string | null; vencimento: string; valor: number | null }[];
};

const ABAS = [
  { id: 'consumo', texto: 'Consumo por veículo' },
  { id: 'manutencao', texto: 'Manutenção por veículo' },
  { id: 'mes', texto: 'Mês a mês' },
  { id: 'motoristas', texto: 'Por motorista' },
  { id: 'vencimentos', texto: 'Vencimentos' },
];

const bomba = (v: Veic) => v.tipo.startsWith('bomba');

export function RelFrota() {
  const { periodo, aba, dados: r, erro, mudar } = useRelatorio<Resp>('/rel/frota', 'consumo', '3m');
  const sufixo = `${periodo.de}_${periodo.ate}`;
  return (
    <>
      <CabecalhoRelatorio
        titulo="Relatórios da frota"
        sub="Consumo, manutenção, motoristas e vencimentos, pelos registros da frota."
        abas={ABAS}
        aba={aba}
        aoMudar={(id) => mudar({ aba: id })}
        extra={aba !== 'vencimentos' ? <SeletorPeriodo valor={periodo} aoMudar={(p) => mudar(p)} /> : undefined}
      />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {!r ? (
        !erro && <p className="muted">Carregando…</p>
      ) : aba === 'consumo' ? (
        <TabelaRelatorio
          titulo="Consumo por veículo"
          descricao={`De ${formatarData(r.de)} a ${formatarData(r.ate)}. Km/L nas betoneiras e L/h nas bombas, calculados entre abastecimentos.`}
          arquivo={`consumo-por-veiculo_${sufixo}`}
          linhas={r.porVeiculo.filter((v) => v.abastecimentos > 0 || v.status !== 'inativo')}
          colunas={[
            { titulo: 'Veículo', valor: (v) => v.codigo, render: (v) => <Link to={`/frota/veiculos/${v.veiculoId}`} className="mono">{v.codigo}</Link> },
            { titulo: 'Tipo', valor: (v) => NOMES_TIPO_VEICULO[v.tipo] },
            { titulo: 'Abastecimentos', valor: (v) => v.abastecimentos, formato: 'numero', total: true },
            { titulo: 'Litros', valor: (v) => v.litros, formato: 'litros', total: true },
            { titulo: 'Valor', valor: (v) => v.valor, formato: 'moeda', total: true },
            { titulo: 'R$/L', valor: (v) => v.precoLitro, formato: 'decimal' },
            { titulo: 'Rodado', valor: (v) => (bomba(v) ? null : v.km), formato: 'km', total: true },
            { titulo: 'Horas', valor: (v) => (bomba(v) ? v.horas : null), formato: 'horas', total: true },
            { titulo: 'km/L', valor: (v) => v.kmPorLitro, formato: 'decimal' },
            { titulo: 'L/h', valor: (v) => v.litrosPorHora, formato: 'decimal' },
            { titulo: 'Sem nota', valor: (v) => v.semNota, formato: 'numero', total: true, destaque: (v) => (v.semNota ? 'aviso' : undefined) },
          ]}
        />
      ) : aba === 'manutencao' ? (
        <TabelaRelatorio
          titulo="Manutenção por veículo"
          descricao="OS concluídas no período, dias na oficina e situação da preventiva hoje."
          arquivo={`manutencao-por-veiculo_${sufixo}`}
          linhas={r.porVeiculo.filter((v) => v.status !== 'inativo' || v.osConcluidas > 0)}
          colunas={[
            { titulo: 'Veículo', valor: (v) => v.codigo, render: (v) => <Link to={`/frota/veiculos/${v.veiculoId}`} className="mono">{v.codigo}</Link> },
            { titulo: 'Situação', valor: (v) => NOMES_STATUS_VEICULO[v.status] },
            { titulo: 'OS concluídas', valor: (v) => v.osConcluidas, formato: 'numero', total: true },
            { titulo: 'Corretivas', valor: (v) => v.osCorretivas, formato: 'numero', total: true },
            { titulo: 'Dias na oficina', valor: (v) => v.diasParado, formato: 'numero', total: true },
            { titulo: 'Custo das OS', valor: (v) => v.custoOs, formato: 'moeda', total: true },
            { titulo: 'OS abertas', valor: (v) => v.osAbertas, formato: 'numero', total: true, destaque: (v) => (v.osAbertas ? 'aviso' : undefined) },
            { titulo: 'Revisões vencidas', valor: (v) => v.revisoesVencidas, formato: 'numero', total: true, destaque: (v) => (v.revisoesVencidas ? 'perigo' : undefined) },
            { titulo: 'Próximas', valor: (v) => v.revisoesProximas, formato: 'numero', total: true },
          ]}
        />
      ) : aba === 'mes' ? (
        <TabelaRelatorio
          titulo="Frota mês a mês"
          arquivo={`frota-mes-a-mes_${sufixo}`}
          linhas={r.porMes}
          colunas={[
            { titulo: 'Mês', valor: (m) => mesCurto(m.mes) },
            { titulo: 'Abastecimentos', valor: (m) => m.abastecimentos, formato: 'numero', total: true },
            { titulo: 'Litros', valor: (m) => m.litros, formato: 'litros', total: true },
            { titulo: 'Diesel', valor: (m) => m.valor, formato: 'moeda', total: true },
            { titulo: 'R$/L', valor: (m) => m.precoLitro, formato: 'decimal' },
            { titulo: 'OS concluídas', valor: (m) => m.osConcluidas, formato: 'numero', total: true },
            { titulo: 'Custo das OS', valor: (m) => m.custoOs, formato: 'moeda', total: true },
          ]}
        />
      ) : aba === 'motoristas' ? (
        <TabelaRelatorio
          titulo="Abastecimentos por motorista"
          arquivo={`abastecimentos-por-motorista_${sufixo}`}
          linhas={r.porMotorista}
          colunas={[
            { titulo: 'Motorista', valor: (m) => m.nome },
            { titulo: 'Função', valor: (m) => (m.funcao ? NOMES_FUNCAO[m.funcao] : null) },
            { titulo: 'Abastecimentos', valor: (m) => m.abastecimentos, formato: 'numero', total: true },
            { titulo: 'Litros', valor: (m) => m.litros, formato: 'litros', total: true },
            { titulo: 'Valor', valor: (m) => m.valor, formato: 'moeda', total: true },
            { titulo: 'Veículos', valor: (m) => m.veiculos },
          ]}
        />
      ) : (
        <TabelaRelatorio
          titulo="Documentos e CNH vencidos ou vencendo em 60 dias"
          arquivo="vencimentos-60-dias"
          vazio="Nenhum documento ou CNH vencido ou vencendo nos próximos 60 dias."
          linhas={r.vencimentos}
          colunas={[
            { titulo: 'Vencimento', valor: (d) => d.vencimento, formato: 'data', destaque: (d) => (d.vencimento < r.hoje ? 'perigo' : 'aviso') },
            { titulo: 'Veículo ou pessoa', valor: (d) => d.referencia },
            { titulo: 'Documento', valor: (d) => (d.tipo === 'cnh' ? d.item : NOMES_TIPO_DOCUMENTO[d.item as DocumentoVeiculo['tipo']] ?? d.item) },
            { titulo: 'Descrição', valor: (d) => d.descricao },
            { titulo: 'Valor', valor: (d) => d.valor, formato: 'moeda', total: true },
          ]}
        />
      )}
    </>
  );
}
