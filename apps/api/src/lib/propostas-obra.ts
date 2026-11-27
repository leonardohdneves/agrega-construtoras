// Propostas de execução de obras: cálculo do valor, das parcelas e das regras de cada tipo.
// Valores em reais no cálculo; o banco guarda centavos. Todas as regras de cada tipo ficam aqui.
import { ErroHttp } from './erros.ts';
import { somarDias, somarMeses } from './financeiro.ts';

export const TIPOS_PROPOSTA = ['acompanhamento', 'administracao', 'preco_global', 'preco_unitario', 'laudo', 'servicos_tecnicos'] as const;
export type TipoProposta = (typeof TIPOS_PROPOSTA)[number];

export const NOMES_TIPO: Record<TipoProposta, string> = {
  acompanhamento: 'Acompanhamento de obra',
  administracao: 'Administração de obra',
  preco_global: 'Contrato de preço global',
  preco_unitario: 'Contrato de preços unitários',
  laudo: 'Laudos técnicos',
  servicos_tecnicos: 'Serviços técnicos',
};

export type ItemProposta = { descricao: string; unidade: string; quantidade: number; precoUnitario: number; obraItemId?: string | null };
export type Marco = { descricao: string; percentual: number; dias: number };
export type Parametros = {
  dataInicio: string; // AAAA-MM-DD: primeiro vencimento (ou início do prazo)
  meses?: number; // acompanhamento e administração
  // acompanhamento: 'valor_mensal' (honorário fixo) ou 'percentual_obra' (percentual do valor da obra, dividido pelos meses)
  modo?: 'valor_mensal' | 'percentual_obra';
  honorarioMensal?: number;
  percentualObra?: number;
  // administração: taxa sobre o custo direto ou sobre o valor da obra; paga em parcelas mensais
  taxaPct?: number;
  baseAdm?: 'custo_direto' | 'valor_obra';
  valorBaseInformado?: number;
  // preço global: valor informado (quando não vem do orçamento) e marcos de pagamento
  valorInformado?: number;
  // forma de pagamento do preço global: marcos (percentuais e dias) ou medição (mensal, valor dividido igualmente)
  formaPagamento?: 'marcos' | 'medicao';
  numeroMedicoes?: number;
  // serviços técnicos: entrada e saldo; pagamentos intermediários iguais entre a aceitação e a entrega; ou cronograma próprio (marcos)
  modoPagamento?: 'entrada_saldo' | 'intermediarios' | 'cronograma';
  numeroIntermediarios?: number;
  marcos?: Marco[];
  // preço unitário: número de parcelas mensais do total estimado
  numeroParcelas?: number;
  // laudo: percentual pago na aceitação e prazo de entrega do saldo
  entradaPct?: number;
  prazoEntregaDias?: number;
  campos?: Record<string, string>;
  // desconto sobre o preço proposto (percentual) e observações para o cliente
  descontoPct?: number;
  observacoes?: string;
};
export type Contexto = { valorObra: number; custoDireto: number }; // reais: venda do orçamento (com BDI) e custo direto

export type Parcela = { descricao: string; vencimento: string; valor: number };
export type Resultado = { valorTotal: number; parcelas: Parcela[]; itens: (ItemProposta & { valor: number })[]; valorSemDesconto?: number; descontoValor?: number };

const dec = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const cent = (r: number) => Math.round(r * 100);
const reais = (c: number) => c / 100;

/** Divide um valor em n parcelas em centavos, deixando a diferença de arredondamento na última. */
export function dividir(totalCentavos: number, n: number): number[] {
  const base = Math.floor(totalCentavos / n);
  const partes = Array.from({ length: n }, () => base);
  partes[n - 1] += totalCentavos - base * n;
  return partes;
}

function exigir(condicao: unknown, mensagem: string): asserts condicao {
  if (!condicao) throw new ErroHttp(400, mensagem);
}

/**
 * Calcula o valor total, as parcelas e os itens de uma proposta, já com o desconto sobre o preço proposto.
 * O desconto reduz o total e cada parcela na mesma proporção; a diferença de centavos vai para a última parcela.
 */
export function calcularProposta(tipo: TipoProposta, origemPreco: 'orcamento' | 'informado', p: Parametros, itens: ItemProposta[], ctx: Contexto | null): Resultado {
  const base = calcularBase(tipo, origemPreco, p, itens, ctx);
  const pct = dec(p.descontoPct ?? null) ?? 0;
  exigir(pct >= 0 && pct < 100, 'O desconto deve estar entre 0 e 99,99%.');
  const totalC = cent(base.valorTotal);
  if (pct === 0 || totalC === 0) return base;
  const novoC = Math.round(totalC * (1 - pct / 100));
  const valores = base.parcelas.map((x) => Math.round(cent(x.valor) * (novoC / totalC)));
  if (valores.length) valores[valores.length - 1] += novoC - valores.reduce((t, v) => t + v, 0);
  return { valorTotal: reais(novoC), parcelas: base.parcelas.map((x, i) => ({ ...x, valor: reais(valores[i]) })), itens: base.itens, valorSemDesconto: reais(totalC), descontoValor: reais(totalC - novoC) };
}

function calcularBase(tipo: TipoProposta, origemPreco: 'orcamento' | 'informado', p: Parametros, itens: ItemProposta[], ctx: Contexto | null): Resultado {
  exigir(p.dataInicio && /^\d{4}-\d{2}-\d{2}$/.test(p.dataInicio), 'Informe a data de início.');
  const orcamento = origemPreco === 'orcamento';
  exigir(!orcamento || ctx, 'Escolha a obra para puxar o preço do orçamento.');

  if (tipo === 'acompanhamento' || tipo === 'administracao') {
    const meses = Math.trunc(dec(p.meses ?? null) ?? 0);
    exigir(meses >= 1 && meses <= 120, 'Informe o número de meses (1 a 120).');
    let total: number;
    if (tipo === 'acompanhamento') {
      if (p.modo === 'percentual_obra') {
        exigir(orcamento, 'O honorário por percentual da obra precisa do orçamento da obra.');
        exigir(dec(p.percentualObra) !== null && p.percentualObra! > 0, 'Informe o percentual sobre a obra.');
        total = ctx!.valorObra * (p.percentualObra! / 100);
      } else {
        exigir(dec(p.honorarioMensal) !== null && p.honorarioMensal! > 0, 'Informe o honorário mensal.');
        total = p.honorarioMensal! * meses;
      }
    } else {
      exigir(dec(p.taxaPct) !== null && p.taxaPct! > 0 && p.taxaPct! <= 100, 'Informe a taxa de administração (0 a 100%).');
      let base: number;
      if (orcamento) base = p.baseAdm === 'custo_direto' ? ctx!.custoDireto : ctx!.valorObra;
      else {
        exigir(dec(p.valorBaseInformado) !== null && p.valorBaseInformado! > 0, 'Informe o valor da obra sobre o qual incide a taxa.');
        base = p.valorBaseInformado!;
      }
      total = base * (p.taxaPct! / 100);
    }
    const parcelas = dividir(cent(total), meses).map((c, i) => ({ descricao: `Mensalidade ${i + 1}/${meses}`, vencimento: somarMeses(p.dataInicio, i), valor: reais(c) }));
    return { valorTotal: reais(cent(total)), parcelas, itens: [] };
  }

  if (tipo === 'preco_global') {
    let total: number;
    if (orcamento) total = ctx!.valorObra;
    else {
      exigir(dec(p.valorInformado) !== null && p.valorInformado! > 0, 'Informe o valor do contrato.');
      total = p.valorInformado!;
    }
    if (p.formaPagamento === 'medicao') {
      const n = Math.trunc(dec(p.numeroMedicoes ?? null) ?? 0);
      exigir(n >= 1 && n <= 120, 'Informe o número de medições (1 a 120).');
      const parcelas = dividir(cent(total), n).map((c, i) => ({ descricao: `Medição ${i + 1}/${n}`, vencimento: somarMeses(p.dataInicio, i), valor: reais(c) }));
      return { valorTotal: reais(cent(total)), parcelas, itens: [] };
    }
    const marcos = p.marcos ?? [];
    exigir(marcos.length >= 1, 'Informe ao menos um marco de pagamento.');
    const soma = marcos.reduce((s, m) => s + m.percentual, 0);
    exigir(Math.abs(soma - 100) < 0.001, `Os marcos de pagamento somam ${soma.toLocaleString('pt-BR')}%; precisam somar 100%.`);
    const valores = marcos.map((m) => Math.round(cent(total) * (m.percentual / 100)));
    valores[valores.length - 1] += cent(total) - valores.reduce((s, v) => s + v, 0);
    const parcelas = marcos.map((m, i) => ({ descricao: m.descricao, vencimento: somarDias(p.dataInicio, m.dias), valor: reais(valores[i]) }));
    return { valorTotal: reais(cent(total)), parcelas, itens: [] };
  }

  // preço unitário, laudos e serviços técnicos: total = soma das quantidades estimadas × preço unitário
  exigir(itens.length >= 1, tipo === 'laudo' ? 'Inclua ao menos um laudo.' : tipo === 'servicos_tecnicos' ? 'Inclua ao menos um serviço técnico.' : 'Inclua ao menos um item.');
  for (const it of itens) {
    exigir(it.descricao.trim(), 'Descreva cada item.');
    exigir(it.quantidade > 0, `Quantidade inválida em "${it.descricao}".`);
    exigir(it.precoUnitario >= 0, `Preço inválido em "${it.descricao}".`);
  }
  const itensCalc = itens.map((it) => ({ ...it, valor: reais(Math.round(cent(it.quantidade * it.precoUnitario))) }));
  const totalC = itensCalc.reduce((s, it) => s + cent(it.valor), 0);

  if (tipo === 'preco_unitario') {
    const n = Math.trunc(dec(p.numeroParcelas ?? null) ?? 1);
    exigir(n >= 1 && n <= 120, 'Informe o número de parcelas (1 a 120).');
    const parcelas = dividir(totalC, n).map((c, i) => ({ descricao: `Parcela ${i + 1}/${n}`, vencimento: somarMeses(p.dataInicio, i), valor: reais(c) }));
    return { valorTotal: reais(totalC), parcelas, itens: itensCalc };
  }

  if (tipo === 'servicos_tecnicos' && p.modoPagamento === 'cronograma') {
    const marcos = p.marcos ?? [];
    exigir(marcos.length >= 1, 'Informe ao menos uma parcela no cronograma.');
    const soma = marcos.reduce((s, m) => s + m.percentual, 0);
    exigir(Math.abs(soma - 100) < 0.001, `As parcelas do cronograma somam ${soma.toLocaleString('pt-BR')}%; precisam somar 100%.`);
    const valores = marcos.map((m) => Math.round(totalC * (m.percentual / 100)));
    valores[valores.length - 1] += totalC - valores.reduce((s, v) => s + v, 0);
    const parcelas = marcos.map((m, i) => ({ descricao: m.descricao, vencimento: somarDias(p.dataInicio, m.dias), valor: reais(valores[i]) }));
    return { valorTotal: reais(totalC), parcelas, itens: itensCalc };
  }
  if (tipo === 'servicos_tecnicos' && p.modoPagamento === 'intermediarios') {
    const n = Math.trunc(dec(p.numeroIntermediarios ?? null) ?? 0);
    exigir(n >= 1 && n <= 24, 'Informe o número de pagamentos intermediários (1 a 24).');
    const entradaPct = dec(p.entradaPct ?? null) ?? 0;
    exigir(entradaPct >= 0 && entradaPct < 100, 'A entrada deve estar entre 0 e 100%, sem chegar a 100%.');
    const prazo = Math.trunc(dec(p.prazoEntregaDias ?? null) ?? 0);
    exigir(prazo >= 1, 'Informe o prazo de entrega dos serviços.');
    const entrada = Math.round(totalC * (entradaPct / 100));
    // O restante é dividido em n intermediários iguais mais o saldo final, na entrega; os intermediários são espaçados igualmente entre a aceitação e a entrega.
    const partes = dividir(totalC - entrada, n + 1);
    const parcelas: Parcela[] = [];
    if (entrada > 0) parcelas.push({ descricao: 'Entrada na aceitação', vencimento: p.dataInicio, valor: reais(entrada) });
    for (let i = 0; i < n; i++) parcelas.push({ descricao: `Pagamento intermediário ${i + 1}/${n}`, vencimento: somarDias(p.dataInicio, Math.round((prazo * (i + 1)) / (n + 1))), valor: reais(partes[i]) });
    parcelas.push({ descricao: 'Saldo na entrega dos trabalhos', vencimento: somarDias(p.dataInicio, prazo), valor: reais(partes[n]) });
    return { valorTotal: reais(totalC), parcelas, itens: itensCalc };
  }

  // laudo e serviços técnicos: entrada na aceitação e saldo na entrega
  const entradaPct = dec(p.entradaPct ?? null) ?? 0;
  exigir(entradaPct >= 0 && entradaPct <= 100, 'A entrada deve estar entre 0 e 100%.');
  const prazo = Math.trunc(dec(p.prazoEntregaDias ?? null) ?? 0);
  exigir(entradaPct === 100 || prazo >= 1, 'Informe o prazo de entrega dos laudos.');
  const entrada = Math.round(totalC * (entradaPct / 100));
  const parcelas: Parcela[] = [];
  if (entrada > 0) parcelas.push({ descricao: 'Entrada na aceitação', vencimento: p.dataInicio, valor: reais(entrada) });
  if (totalC - entrada > 0) parcelas.push({ descricao: tipo === 'laudo' ? 'Saldo na entrega dos laudos' : 'Saldo na entrega dos trabalhos', vencimento: somarDias(p.dataInicio, prazo), valor: reais(totalC - entrada) });
  return { valorTotal: reais(totalC), parcelas, itens: itensCalc };
}

/** Confere se o total das parcelas fecha com o total da proposta (centavos). */
export function fechaParcelas(total: number, parcelas: Parcela[]): boolean {
  return parcelas.reduce((s, p) => s + cent(p.valor), 0) === cent(total);
}
