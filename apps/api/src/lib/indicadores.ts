// Catálogo dos indicadores do Agrega e o cálculo a partir dos números brutos de cada mês.
// O mesmo catálogo alimenta a página de conferência e o painel de indicadores do dono.

export type Unidade = 'pct' | 'moeda' | 'km_l' | 'l_h' | 'dias' | 'numero' | 'moeda_km' | 'moeda_l' | 'moeda_h';

export type Bruto = {
  receita: number; // centavos
  lucroBruto: number;
  resultado: number;
  custoFrotaLancado: number;
  custoFrotaSemNota: number;
  dieselValor: number;
  dieselLitros: number;
  kmBet: number;
  litrosBet: number; // litros dos abastecimentos que têm km anterior (base do km/L)
  horasBomba: number;
  litrosBomba: number;
  custoBet: number;
  custoBomba: number;
  osConcluidas: number;
  osDiasParado: number;
  osCusto: number;
  recPonderado: number; // soma de valor × dias entre competência e recebimento
  recValor: number;
  pagPonderado: number;
  pagValor: number;
  abastPosto: number;
  abastComNota: number;
};

export type Retrato = {
  disponiveis: number;
  ativos: number;
  revisoesEmDia: number;
  revisoesComRegistro: number;
  receberAberto: number;
  receberVencido: number;
  saldoCaixa: number;
  saidasDia: number; // média diária de pagamentos dos últimos 90 dias (centavos)
  notasPendentes: number;
};

export const BRUTO_ZERO: Bruto = {
  receita: 0, lucroBruto: 0, resultado: 0, custoFrotaLancado: 0, custoFrotaSemNota: 0, dieselValor: 0, dieselLitros: 0, kmBet: 0, litrosBet: 0,
  horasBomba: 0, litrosBomba: 0, custoBet: 0, custoBomba: 0, osConcluidas: 0, osDiasParado: 0, osCusto: 0, recPonderado: 0, recValor: 0,
  pagPonderado: 0, pagValor: 0, abastPosto: 0, abastComNota: 0,
};

export function somarBrutos(xs: Bruto[]): Bruto {
  const r = { ...BRUTO_ZERO };
  for (const x of xs) for (const k of Object.keys(r) as (keyof Bruto)[]) r[k] += x[k] ?? 0;
  return r;
}

const div = (a: number, b: number) => (b ? a / b : null);

export type Indicador = {
  id: string;
  nome: string;
  modulo: 'Frota' | 'Financeiro' | 'Gerencial' | 'Administrativo';
  unidade: Unidade;
  formula: string;
  fonte: string;
  leitura: string;
  melhor: 'maior' | 'menor' | 'neutro';
  retrato?: boolean; // valor do momento (não tem série mensal)
  bruto?: (b: Bruto) => number | null;
  agora?: (r: Retrato) => number | null;
};

export const INDICADORES: Indicador[] = [
  // ---------- Gerencial / Financeiro ----------
  {
    id: 'receita_bruta', nome: 'Receita bruta', modulo: 'Financeiro', unidade: 'moeda', melhor: 'maior',
    formula: 'Soma das receitas confirmadas nas categorias da linha "Receita bruta", pela competência.',
    fonte: 'Lançamentos e notas de venda confirmados (DRE por competência).',
    leitura: 'Quanto a concreteira vendeu no mês, pago ou não.',
    bruto: (b) => b.receita / 100,
  },
  {
    id: 'margem_bruta', nome: 'Margem bruta', modulo: 'Gerencial', unidade: 'pct', melhor: 'maior',
    formula: 'Lucro bruto ÷ receita bruta. Lucro bruto = receita − deduções − custo de produção − custo da frota − pessoal operacional.',
    fonte: 'DRE por competência, impostos lançados.',
    leitura: 'Quanto sobra de cada R$ 100 vendidos depois de produzir e entregar o concreto.',
    bruto: (b) => div(b.lucroBruto, b.receita),
  },
  {
    id: 'margem_liquida', nome: 'Margem líquida', modulo: 'Gerencial', unidade: 'pct', melhor: 'maior',
    formula: 'Resultado líquido ÷ receita bruta.',
    fonte: 'DRE por competência, impostos lançados.',
    leitura: 'Lucro final de cada R$ 100 vendidos, depois de todas as despesas e impostos.',
    bruto: (b) => div(b.resultado, b.receita),
  },
  {
    id: 'frota_sobre_receita', nome: 'Custo da frota sobre a receita', modulo: 'Gerencial', unidade: 'pct', melhor: 'menor',
    formula: '(Custo da frota lançado + abastecimentos e OS ainda sem nota) ÷ receita bruta.',
    fonte: 'DRE (linha Custo da frota) + registros da frota sem nota.',
    leitura: 'Quanto da venda vai para diesel, manutenção, pneus e documentos dos caminhões e bombas.',
    bruto: (b) => div(b.custoFrotaLancado + b.custoFrotaSemNota, b.receita),
  },
  {
    id: 'pmr', nome: 'Prazo médio de recebimento', modulo: 'Financeiro', unidade: 'dias', melhor: 'menor',
    formula: 'Média dos dias entre a competência e o recebimento, ponderada pelo valor recebido no mês.',
    fonte: 'Parcelas de receita recebidas.',
    leitura: 'Em quantos dias, em média, o cliente paga depois da entrega.',
    bruto: (b) => div(b.recPonderado, b.recValor),
  },
  {
    id: 'pmp', nome: 'Prazo médio de pagamento', modulo: 'Financeiro', unidade: 'dias', melhor: 'maior',
    formula: 'Média dos dias entre a competência e o pagamento, ponderada pelo valor pago no mês.',
    fonte: 'Parcelas de despesa pagas.',
    leitura: 'Em quantos dias, em média, a concreteira paga os fornecedores. Bom quando é maior que o prazo de recebimento.',
    bruto: (b) => div(b.pagPonderado, b.pagValor),
  },
  {
    id: 'inadimplencia', nome: 'Inadimplência', modulo: 'Financeiro', unidade: 'pct', melhor: 'menor', retrato: true,
    formula: 'Valor a receber vencido ÷ total a receber em aberto, hoje.',
    fonte: 'Parcelas de receita em aberto.',
    leitura: 'Parte do que os clientes devem que já passou do vencimento.',
    agora: (r) => div(r.receberVencido, r.receberAberto),
  },
  {
    id: 'cobertura_caixa', nome: 'Cobertura de caixa', modulo: 'Financeiro', unidade: 'dias', melhor: 'maior', retrato: true,
    formula: 'Saldo em bancos e caixa ÷ média diária de pagamentos dos últimos 90 dias.',
    fonte: 'Saldo das contas e parcelas pagas.',
    leitura: 'Por quantos dias o caixa de hoje paga as contas, sem entrar nada.',
    agora: (r) => div(r.saldoCaixa, r.saidasDia),
  },
  // ---------- Frota ----------
  {
    id: 'disponibilidade', nome: 'Disponibilidade da frota', modulo: 'Frota', unidade: 'pct', melhor: 'maior', retrato: true,
    formula: 'Veículos disponíveis ÷ veículos ativos (disponíveis + em manutenção + parados), hoje.',
    fonte: 'Situação dos veículos.',
    leitura: 'Parte da frota pronta para rodar agora.',
    agora: (r) => div(r.disponiveis, r.ativos),
  },
  {
    id: 'consumo_bet', nome: 'Consumo das betoneiras', modulo: 'Frota', unidade: 'km_l', melhor: 'maior',
    formula: 'Km rodados entre abastecimentos ÷ litros abastecidos (sem o primeiro abastecimento de cada veículo).',
    fonte: 'Abastecimentos de betoneiras e veículos de apoio.',
    leitura: 'Quantos km cada litro rende. Queda indica problema mecânico, rota ou vazamento.',
    bruto: (b) => div(b.kmBet, b.litrosBet),
  },
  {
    id: 'consumo_bomba', nome: 'Consumo das bombas', modulo: 'Frota', unidade: 'l_h', melhor: 'menor',
    formula: 'Litros abastecidos ÷ horas trabalhadas pelo horímetro entre abastecimentos.',
    fonte: 'Abastecimentos de bombas.',
    leitura: 'Quantos litros a bomba gasta por hora de trabalho.',
    bruto: (b) => div(b.litrosBomba, b.horasBomba),
  },
  {
    id: 'preco_diesel', nome: 'Preço médio do diesel', modulo: 'Frota', unidade: 'moeda_l', melhor: 'menor',
    formula: 'Valor dos abastecimentos ÷ litros abastecidos.',
    fonte: 'Abastecimentos com valor informado.',
    leitura: 'Quanto a concreteira pagou, em média, por litro.',
    bruto: (b) => div(b.dieselValor / 100, b.dieselLitros),
  },
  {
    id: 'custo_km', nome: 'Custo por km das betoneiras', modulo: 'Frota', unidade: 'moeda_km', melhor: 'menor',
    formula: 'Custo das betoneiras e apoio (notas e lançamentos com veículo + registros sem nota) ÷ km rodados.',
    fonte: 'Custo por veículo e abastecimentos.',
    leitura: 'Quanto custa rodar 1 km com uma betoneira.',
    bruto: (b) => div(b.custoBet / 100, b.kmBet),
  },
  {
    id: 'custo_hora_bomba', nome: 'Custo por hora das bombas', modulo: 'Frota', unidade: 'moeda_h', melhor: 'menor',
    formula: 'Custo das bombas (notas e lançamentos com veículo + registros sem nota) ÷ horas trabalhadas.',
    fonte: 'Custo por veículo e horímetro.',
    leitura: 'Quanto custa 1 hora de bomba trabalhando.',
    bruto: (b) => div(b.custoBomba / 100, b.horasBomba),
  },
  {
    id: 'revisoes_em_dia', nome: 'Revisões em dia', modulo: 'Frota', unidade: 'pct', melhor: 'maior', retrato: true,
    formula: 'Itens do plano não vencidos (em dia ou próximos) ÷ itens do plano com última execução registrada, hoje.',
    fonte: 'Plano de manutenção preventiva.',
    leitura: 'Quanto da manutenção preventiva está sendo cumprida.',
    agora: (r) => div(r.revisoesEmDia, r.revisoesComRegistro),
  },
  {
    id: 'dias_parado_os', nome: 'Dias parado por OS', modulo: 'Frota', unidade: 'dias', melhor: 'menor',
    formula: 'Soma dos dias entre abertura e conclusão ÷ OS concluídas no mês.',
    fonte: 'Ordens de serviço concluídas.',
    leitura: 'Quanto tempo, em média, um veículo fica na oficina.',
    bruto: (b) => div(b.osDiasParado, b.osConcluidas),
  },
  {
    id: 'custo_manutencao', nome: 'Custo de manutenção', modulo: 'Frota', unidade: 'moeda', melhor: 'menor',
    formula: 'Soma das peças, mão de obra e serviços das OS concluídas no mês.',
    fonte: 'Ordens de serviço concluídas.',
    leitura: 'Quanto foi gasto em oficina no mês.',
    bruto: (b) => b.osCusto / 100,
  },
  // ---------- Administrativo ----------
  {
    id: 'abastecimentos_com_nota', nome: 'Abastecimentos com nota', modulo: 'Administrativo', unidade: 'pct', melhor: 'maior',
    formula: 'Abastecimentos em posto ligados a uma nota fiscal ÷ abastecimentos em posto.',
    fonte: 'Abastecimentos e vínculos das notas.',
    leitura: 'Quanto do diesel lançado pelos motoristas já foi conferido com a nota do posto.',
    bruto: (b) => div(b.abastComNota, b.abastPosto),
  },
  {
    id: 'notas_pendentes', nome: 'Notas para conferir', modulo: 'Administrativo', unidade: 'numero', melhor: 'menor', retrato: true,
    formula: 'Notas importadas ou digitadas que ainda não foram confirmadas.',
    fonte: 'Notas fiscais em conferência.',
    leitura: 'Despesas que ainda não entraram no financeiro.',
    agora: (r) => r.notasPendentes,
  },
];

export function calcularIndicadores(meses: string[], brutos: Record<string, Bruto>, retrato: Retrato) {
  const periodo = somarBrutos(meses.map((m) => brutos[m] ?? BRUTO_ZERO));
  return INDICADORES.map((ind) => {
    const valores: Record<string, number | null> = {};
    for (const m of meses) valores[m] = ind.bruto ? ind.bruto(brutos[m] ?? BRUTO_ZERO) : null;
    const valor = ind.retrato ? ind.agora!(retrato) : ind.bruto!(periodo);
    return {
      id: ind.id,
      nome: ind.nome,
      modulo: ind.modulo,
      unidade: ind.unidade,
      formula: ind.formula,
      fonte: ind.fonte,
      leitura: ind.leitura,
      melhor: ind.melhor,
      retrato: !!ind.retrato,
      valor,
      valores: ind.retrato ? null : valores,
    };
  });
}
