// Catálogo dos indicadores do Agrega e o cálculo a partir dos números brutos de cada mês.
// O mesmo catálogo alimenta a página de conferência e o painel de indicadores do dono.

export type Unidade = 'pct' | 'moeda' | 'km_l' | 'l_h' | 'dias' | 'numero' | 'moeda_km' | 'moeda_l' | 'moeda_h' | 'm3' | 'kg_m3' | 'moeda_m3';

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
  m3Produzido: number;
  m3Devolvido: number;
  cimentoKg: number;
  materialTeorico: number; // centavos
  materialLancado: number; // centavos: cimento, areia, brita e aditivos lançados
  betoneiraDias: number;
  qualRelSoma: number; // soma de (resultado na idade de controle ÷ fck)
  qualN: number;
  qualAbaixo: number;
  slumpMedidos: number;
  slumpFora: number;
  cpsPrevistos: number;
  cpsNoPrazo: number;
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
  perdaInventario: number; // diferença (valor) do último inventário, negativa quando falta
  consumoInventario: number; // consumo (valor) no período do último inventário
  calibracoesVencidas: number;
};

export const BRUTO_ZERO: Bruto = {
  receita: 0, lucroBruto: 0, resultado: 0, custoFrotaLancado: 0, custoFrotaSemNota: 0, dieselValor: 0, dieselLitros: 0, kmBet: 0, litrosBet: 0,
  horasBomba: 0, litrosBomba: 0, custoBet: 0, custoBomba: 0, osConcluidas: 0, osDiasParado: 0, osCusto: 0, recPonderado: 0, recValor: 0,
  pagPonderado: 0, pagValor: 0, abastPosto: 0, abastComNota: 0, m3Produzido: 0, m3Devolvido: 0, cimentoKg: 0, materialTeorico: 0,
  materialLancado: 0, betoneiraDias: 0, qualRelSoma: 0, qualN: 0, qualAbaixo: 0, slumpMedidos: 0, slumpFora: 0, cpsPrevistos: 0, cpsNoPrazo: 0,
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
  modulo: 'Frota' | 'Financeiro' | 'Gerencial' | 'Administrativo' | 'Produção' | 'Qualidade';
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
  // ---------- Produção ----------
  {
    id: 'volume_produzido', nome: 'Volume produzido', modulo: 'Produção', unidade: 'm3', melhor: 'maior',
    formula: 'Soma do volume das cargas produzidas (sem as canceladas).',
    fonte: 'Cargas registradas na usina.',
    leitura: 'Quanto concreto saiu da usina no mês.',
    bruto: (b) => (b.m3Produzido ? b.m3Produzido : null),
  },
  {
    id: 'm3_betoneira_dia', nome: 'm³ por betoneira por dia', modulo: 'Produção', unidade: 'm3', melhor: 'maior',
    formula: 'Volume das cargas ÷ soma, dia a dia, das betoneiras que fizeram pelo menos uma carga.',
    fonte: 'Cargas registradas na usina.',
    leitura: 'Quanto cada caminhão entrega num dia de trabalho. Baixo indica frota sobrando ou ociosa.',
    bruto: (b) => div(b.m3Produzido, b.betoneiraDias),
  },
  {
    id: 'cimento_m3', nome: 'Cimento por m³', modulo: 'Produção', unidade: 'kg_m3', melhor: 'menor',
    formula: 'Cimento das cargas pelo traço (kg) ÷ volume produzido.',
    fonte: 'Cargas e traços.',
    leitura: 'Consumo médio de cimento do mix vendido. Sobe quando se vende mais fck alto.',
    bruto: (b) => div(b.cimentoKg, b.m3Produzido),
  },
  {
    id: 'material_teorico_m3', nome: 'Custo de material por m³ (teórico)', modulo: 'Produção', unidade: 'moeda_m3', melhor: 'menor',
    formula: 'Consumo de cada carga pelo traço × custo do insumo no dia ÷ volume produzido.',
    fonte: 'Cargas, traços e custo dos insumos (notas).',
    leitura: 'Quanto deveria custar o material de 1 m³, se a usina dosasse exatamente o traço.',
    bruto: (b) => div(b.materialTeorico / 100, b.m3Produzido),
  },
  {
    id: 'material_real_m3', nome: 'Custo de material por m³ (lançado)', modulo: 'Produção', unidade: 'moeda_m3', melhor: 'menor',
    formula: 'Cimento, areia, brita e aditivos lançados no mês (DRE) ÷ volume produzido.',
    fonte: 'Notas e lançamentos das contas 3.1 a 3.4 e cargas.',
    leitura: 'Quanto o material custou de fato. Bem acima do teórico indica perda, desvio ou estoque se formando.',
    bruto: (b) => (b.materialLancado ? div(b.materialLancado / 100, b.m3Produzido) : null),
  },
  {
    id: 'frota_m3', nome: 'Custo da frota por m³', modulo: 'Produção', unidade: 'moeda_m3', melhor: 'menor',
    formula: '(Custo da frota lançado + abastecimentos e OS ainda sem nota) ÷ volume produzido.',
    fonte: 'DRE, frota e cargas.',
    leitura: 'Quanto custa transportar e bombear cada m³ vendido.',
    bruto: (b) => div((b.custoFrotaLancado + b.custoFrotaSemNota) / 100, b.m3Produzido),
  },
  {
    id: 'devolvido_pct', nome: 'Concreto devolvido', modulo: 'Produção', unidade: 'pct', melhor: 'menor',
    formula: 'Volume que voltou da obra ÷ volume produzido.',
    fonte: 'Cargas com concreto devolvido.',
    leitura: 'Concreto pago na produção e perdido. Acima de 1% merece atenção.',
    bruto: (b) => div(b.m3Devolvido, b.m3Produzido),
  },
  {
    id: 'perda_inventario', nome: 'Perda de insumos no inventário', modulo: 'Produção', unidade: 'pct', melhor: 'menor', retrato: true,
    formula: 'Falta (em valor) apurada no último inventário ÷ consumo teórico (em valor) desde o inventário anterior.',
    fonte: 'Inventários de insumos.',
    leitura: 'Quanto do material sumiu além do traço: dosagem acima, umidade, desperdício ou desvio.',
    agora: (r) => (r.consumoInventario ? -r.perdaInventario / r.consumoInventario : null),
  },
  // ---------- Qualidade ----------
  {
    id: 'resistencia_relativa', nome: 'Resistência sobre o fck', modulo: 'Qualidade', unidade: 'pct', melhor: 'maior',
    formula: 'Média de (resultado do exemplar na idade de controle ÷ fck do traço), pelas cargas moldadas no mês.',
    fonte: 'Corpos de prova rompidos e traços.',
    leitura: 'Quanto o concreto entregue passa do fck. Muito acima indica traço com cimento sobrando; perto de 100%, risco de não conformidade.',
    bruto: (b) => div(b.qualRelSoma, b.qualN),
  },
  {
    id: 'abaixo_fck', nome: 'Exemplares abaixo do fck', modulo: 'Qualidade', unidade: 'pct', melhor: 'menor',
    formula: 'Exemplares com resultado na idade de controle abaixo do fck ÷ exemplares rompidos.',
    fonte: 'Corpos de prova rompidos e traços.',
    leitura: 'Parte das cargas que não atingiu o fck. Cada caso merece análise com o responsável técnico.',
    bruto: (b) => div(b.qualAbaixo, b.qualN),
  },
  {
    id: 'slump_fora', nome: 'Slump fora da faixa', modulo: 'Qualidade', unidade: 'pct', melhor: 'menor',
    formula: 'Cargas com slump medido fora da faixa do traço ÷ cargas com slump medido.',
    fonte: 'Slump das amostras e faixa do traço.',
    leitura: 'Consistência fora do pedido: reclamação na obra, água adicionada ou concreto devolvido.',
    bruto: (b) => div(b.slumpFora, b.slumpMedidos),
  },
  {
    id: 'cps_no_prazo', nome: 'CPs rompidos no prazo', modulo: 'Qualidade', unidade: 'pct', melhor: 'maior',
    formula: 'Corpos de prova rompidos até a data prevista ÷ corpos de prova previstos para o mês (até hoje).',
    fonte: 'Corpos de prova.',
    leitura: 'Disciplina do laboratório. CP rompido fora da idade perde o valor de controle.',
    bruto: (b) => div(b.cpsNoPrazo, b.cpsPrevistos),
  },
  {
    id: 'calibracoes_vencidas', nome: 'Calibrações vencidas', modulo: 'Qualidade', unidade: 'numero', melhor: 'menor', retrato: true,
    formula: 'Equipamentos ativos com a calibração vencida, hoje.',
    fonte: 'Cadastro de equipamentos.',
    leitura: 'Balança ou prensa sem calibração compromete a dosagem e os resultados.',
    agora: (r) => r.calibracoesVencidas,
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
