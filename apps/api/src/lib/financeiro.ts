// Regras puras do financeiro: parcelas, datas, apropriação e plano de contas padrão.

/** Converte reais (número) em centavos inteiros. */
export function centavos(reais: number): number {
  return Math.round(reais * 100);
}

/** Soma dias a uma data AAAA-MM-DD. */
export function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Soma meses mantendo o dia; se o mês não tiver o dia (31/02), usa o último dia do mês. */
export function somarMeses(data: string, meses: number): string {
  const [a, m, d] = data.split('-').map(Number);
  const total = a * 12 + (m - 1) + meses;
  const ano = Math.floor(total / 12);
  const mes = total % 12;
  const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return `${ano}-${String(mes + 1).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
}

export type Intervalo = 'mensal' | 'semanal' | 'quinzenal' | 'dias';

/**
 * Divide o total em N parcelas de valores iguais; a diferença de arredondamento vai para a primeira.
 * Vencimentos a partir do primeiro: mensal mantém o dia do mês; semanal/quinzenal/dias somam dias.
 */
export function gerarParcelas(totalCentavos: number, quantidade: number, primeiroVencimento: string, intervalo: Intervalo = 'mensal', dias = 30) {
  const n = Math.max(1, Math.floor(quantidade));
  const base = Math.floor(totalCentavos / n);
  const resto = totalCentavos - base * n;
  return Array.from({ length: n }, (_, i) => ({
    numero: i + 1,
    valorCentavos: base + (i === 0 ? resto : 0),
    vencimento:
      intervalo === 'mensal'
        ? somarMeses(primeiroVencimento, i)
        : somarDias(primeiroVencimento, i * (intervalo === 'semanal' ? 7 : intervalo === 'quinzenal' ? 15 : dias)),
  }));
}

/** Próxima data de uma recorrência. */
export function proximaRecorrencia(data: string, recorrencia: 'semanal' | 'mensal' | 'anual', vezes: number): string {
  if (recorrencia === 'semanal') return somarDias(data, 7 * vezes);
  if (recorrencia === 'anual') return somarMeses(data, 12 * vezes);
  return somarMeses(data, vezes);
}

/** Valor efetivamente pago na baixa. */
export function valorPago(valorCentavos: number, jurosCentavos = 0, descontoCentavos = 0): number {
  return valorCentavos + jurosCentavos - descontoCentavos;
}

export type SituacaoParcela = 'paga' | 'cancelada' | 'vencida' | 'vence_hoje' | 'a_vencer';
export function situacaoParcela(status: string, vencimento: string, hoje: string): SituacaoParcela {
  if (status === 'paga') return 'paga';
  if (status === 'cancelada') return 'cancelada';
  if (vencimento < hoje) return 'vencida';
  if (vencimento === hoje) return 'vence_hoje';
  return 'a_vencer';
}

// ---------- Plano de contas padrão de concreteira ----------
export type LinhaDre =
  | 'receita_bruta' | 'deducoes' | 'custo_producao' | 'custo_frota' | 'custo_pessoal'
  | 'despesas_pessoal' | 'despesas_administrativas' | 'despesas_comerciais'
  | 'receitas_financeiras' | 'despesas_financeiras' | 'outras_receitas' | 'outras_despesas'
  | 'impostos_lucro' | 'fora_dre';

export const NOMES_LINHA_DRE: Record<LinhaDre, string> = {
  receita_bruta: 'Receita bruta',
  deducoes: 'Deduções e impostos sobre vendas',
  custo_producao: 'Custo de produção do concreto',
  custo_frota: 'Custo da frota',
  custo_pessoal: 'Custo de pessoal operacional',
  despesas_pessoal: 'Despesas com pessoal administrativo',
  despesas_administrativas: 'Despesas administrativas',
  despesas_comerciais: 'Despesas comerciais',
  receitas_financeiras: 'Receitas financeiras',
  despesas_financeiras: 'Despesas financeiras',
  outras_receitas: 'Outras receitas',
  outras_despesas: 'Outras despesas',
  impostos_lucro: 'IRPJ e CSLL',
  fora_dre: 'Fora da DRE (investimentos, empréstimos e sócios)',
};

type ContaPadrao = { codigo: string; nome: string; tipo: 'receita' | 'despesa'; linha: LinhaDre; grupo?: boolean };

const g = (codigo: string, nome: string, tipo: 'receita' | 'despesa', linha: LinhaDre): ContaPadrao => ({ codigo, nome, tipo, linha, grupo: true });
const c = (codigo: string, nome: string, tipo: 'receita' | 'despesa', linha: LinhaDre): ContaPadrao => ({ codigo, nome, tipo, linha });

export const PLANO_CONTAS_PADRAO: ContaPadrao[] = [
  g('1', 'Receitas operacionais', 'receita', 'receita_bruta'),
  c('1.1', 'Venda de concreto', 'receita', 'receita_bruta'),
  c('1.2', 'Serviço de bombeamento', 'receita', 'receita_bruta'),
  c('1.3', 'Taxas de entrega, espera e volume mínimo', 'receita', 'receita_bruta'),
  c('1.4', 'Outras receitas operacionais', 'receita', 'receita_bruta'),

  g('2', 'Deduções da receita', 'despesa', 'deducoes'),
  c('2.1', 'Impostos sobre vendas (Simples, ICMS, ISS, PIS, COFINS)', 'despesa', 'deducoes'),
  c('2.2', 'Devoluções e abatimentos', 'despesa', 'deducoes'),

  g('3', 'Custo de produção', 'despesa', 'custo_producao'),
  c('3.1', 'Cimento', 'despesa', 'custo_producao'),
  c('3.2', 'Areia', 'despesa', 'custo_producao'),
  c('3.3', 'Brita', 'despesa', 'custo_producao'),
  c('3.4', 'Aditivos', 'despesa', 'custo_producao'),
  c('3.5', 'Água e energia da usina', 'despesa', 'custo_producao'),
  c('3.6', 'Manutenção da usina', 'despesa', 'custo_producao'),
  c('3.7', 'Laboratório e ensaios', 'despesa', 'custo_producao'),

  g('4', 'Custo da frota', 'despesa', 'custo_frota'),
  c('4.1', 'Diesel', 'despesa', 'custo_frota'),
  c('4.2', 'Manutenção e peças', 'despesa', 'custo_frota'),
  c('4.3', 'Pneus', 'despesa', 'custo_frota'),
  c('4.4', 'Lubrificantes e Arla 32', 'despesa', 'custo_frota'),
  c('4.5', 'IPVA, licenciamento e documentação', 'despesa', 'custo_frota'),
  c('4.6', 'Seguro da frota', 'despesa', 'custo_frota'),
  c('4.7', 'Pedágios', 'despesa', 'custo_frota'),
  c('4.8', 'Locação de veículos e equipamentos', 'despesa', 'custo_frota'),

  g('5', 'Pessoal', 'despesa', 'custo_pessoal'),
  c('5.1', 'Salários operacionais (motoristas, operadores, usina)', 'despesa', 'custo_pessoal'),
  c('5.2', 'Encargos e benefícios operacionais', 'despesa', 'custo_pessoal'),
  c('5.3', 'Salários administrativos', 'despesa', 'despesas_pessoal'),
  c('5.4', 'Encargos e benefícios administrativos', 'despesa', 'despesas_pessoal'),
  c('5.5', 'Pró-labore', 'despesa', 'despesas_pessoal'),

  g('6', 'Despesas administrativas', 'despesa', 'despesas_administrativas'),
  c('6.1', 'Aluguel', 'despesa', 'despesas_administrativas'),
  c('6.2', 'Energia, água, internet e telefone', 'despesa', 'despesas_administrativas'),
  c('6.3', 'Contabilidade e honorários', 'despesa', 'despesas_administrativas'),
  c('6.4', 'Sistemas e software', 'despesa', 'despesas_administrativas'),
  c('6.5', 'Material de escritório e limpeza', 'despesa', 'despesas_administrativas'),
  c('6.6', 'Taxas, licenças e alvarás', 'despesa', 'despesas_administrativas'),
  c('6.7', 'Multas de trânsito e outras', 'despesa', 'outras_despesas'),
  c('6.8', 'Outras despesas administrativas', 'despesa', 'despesas_administrativas'),

  g('7', 'Despesas comerciais', 'despesa', 'despesas_comerciais'),
  c('7.1', 'Comissões de vendas', 'despesa', 'despesas_comerciais'),
  c('7.2', 'Marketing e brindes', 'despesa', 'despesas_comerciais'),

  g('8', 'Resultado financeiro', 'despesa', 'despesas_financeiras'),
  c('8.1', 'Juros e multas pagos', 'despesa', 'despesas_financeiras'),
  c('8.2', 'Tarifas bancárias', 'despesa', 'despesas_financeiras'),
  c('8.3', 'Juros de empréstimos e financiamentos', 'despesa', 'despesas_financeiras'),
  c('8.4', 'Rendimentos de aplicações', 'receita', 'receitas_financeiras'),
  c('8.5', 'Juros recebidos de clientes', 'receita', 'receitas_financeiras'),

  g('9', 'Impostos sobre o lucro', 'despesa', 'impostos_lucro'),
  c('9.1', 'IRPJ e CSLL', 'despesa', 'impostos_lucro'),

  g('10', 'Outras receitas', 'receita', 'outras_receitas'),
  c('10.1', 'Venda de bens do ativo', 'receita', 'outras_receitas'),
  c('10.2', 'Outras receitas não operacionais', 'receita', 'outras_receitas'),

  g('11', 'Investimentos, empréstimos e sócios (fora da DRE)', 'despesa', 'fora_dre'),
  c('11.1', 'Compra de veículos e equipamentos', 'despesa', 'fora_dre'),
  c('11.2', 'Obras e melhorias na usina', 'despesa', 'fora_dre'),
  c('11.3', 'Amortização de empréstimos e financiamentos', 'despesa', 'fora_dre'),
  c('11.4', 'Distribuição de lucros', 'despesa', 'fora_dre'),
  c('11.5', 'Empréstimos e financiamentos recebidos', 'receita', 'fora_dre'),
  c('11.6', 'Aporte dos sócios', 'receita', 'fora_dre'),
];

export const CENTROS_CUSTO_PADRAO = ['Usina', 'Frota', 'Bombas', 'Administrativo', 'Comercial'];

/** Código do pai: '4.2' → '4'; '4' → null. */
export function codigoPai(codigo: string): string | null {
  const i = codigo.lastIndexOf('.');
  return i < 0 ? null : codigo.slice(0, i);
}
