// Escopo do contrato de prestação de serviços técnicos, redigido a partir da proposta aceita.
// Os dados vêm da própria proposta (objeto, itens, prazos, parcelas e textos preenchidos); nada é inventado.
import { NOMES_TIPO, type TipoProposta } from './propostas-obra.ts';

export type DadosEscopo = {
  numero: number;
  tipo: string;
  titulo: string;
  clienteNome: string;
  contratada: string;
  objeto: string | null;
  endereco: string | null;
  prazoDias: number | null;
  validadeDias: number;
  condicoes: string | null;
  parametros: Record<string, any>;
  valorTotalCentavos: number;
  itens: { descricao: string; unidade: string | null; quantidade: number; precoCentavos: number }[];
  parcelas: { descricao: string; vencimento: string; valorCentavos: number }[];
};

const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const data = (iso: string) => iso.split('-').reverse().join('/');
const campo = (c: Record<string, string> | undefined, k: string, reserva: string) => (c?.[k]?.trim() ? c[k].trim() : reserva);

export function montarEscopoContrato(d: DadosEscopo): string {
  const campos = (d.parametros?.campos ?? {}) as Record<string, string>;
  const tipoNome = NOMES_TIPO[d.tipo as TipoProposta] ?? d.tipo;
  const prazoEntrega = d.parametros?.prazoEntregaDias ?? d.prazoDias;
  const linhas: string[] = [];
  const add = (t = '') => linhas.push(t);

  add(`CONTRATO DE PRESTAÇÃO DE SERVIÇOS TÉCNICOS Nº ${String(d.numero).padStart(4, '0')}`);
  add(`Contratante: ${d.clienteNome}`);
  add(`Contratada: ${d.contratada}`);
  add(`Tipo de serviço: ${tipoNome}`);
  add();

  add('CLÁUSULA 1ª · OBJETO');
  add(`1.1. Prestação de serviços técnicos referentes a: ${d.objeto?.trim() || d.titulo}.`);
  if (d.endereco?.trim()) add(`1.2. Local de execução: ${d.endereco.trim()}.`);
  add();

  add('CLÁUSULA 2ª · ESCOPO');
  if (d.itens.length) {
    d.itens.forEach((i, k) => add(`2.${k + 1}. ${i.descricao}${i.quantidade !== 1 ? ` (${i.quantidade.toLocaleString('pt-BR')} ${i.unidade || 'un'})` : ''}.`));
  } else {
    add('2.1. Serviços conforme o objeto acima.');
  }
  add(`2.${d.itens.length + 1}. Não estão incluídos no escopo: ${campo(campos, 'naoIncluidos', 'o que não estiver expressamente descrito neste contrato')}.`);
  add();

  add('CLÁUSULA 3ª · PRAZO');
  if (prazoEntrega) add(`3.1. Prazo de execução e entrega: ${prazoEntrega} dias corridos, contados da assinatura deste contrato.`);
  else add('3.1. Prazo de execução: conforme o cronograma acordado entre as partes.');
  add('3.2. Atrasos causados pelo contratante, por condições climáticas adversas ou por alterações de escopo serão tratados por aditivo de prazo.');
  add();

  add('CLÁUSULA 4ª · VALOR E FORMA DE PAGAMENTO');
  add(`4.1. Valor total: ${reais(d.valorTotalCentavos)}.`);
  add(`4.2. Meio de pagamento: ${campo(campos, 'meioPagamento', 'a combinar')}.`);
  d.parcelas.forEach((p, k) => add(`4.${k + 3}. ${p.descricao}: ${reais(p.valorCentavos)}, com vencimento em ${data(p.vencimento)}.`));
  add(`4.${d.parcelas.length + 3}. O atraso no pagamento sujeitará o valor em aberto a multa de 2% e juros de 1% ao mês, além de correção monetária pelo índice ${campo(campos, 'indiceCorrecao', 'a combinar')}.`);
  add();

  add('CLÁUSULA 5ª · REAJUSTE');
  add(`5.1. ${campo(campos, 'reajuste', 'Sem reajuste durante a validade da proposta')}.`);
  add();

  add('CLÁUSULA 6ª · RESPONSABILIDADES');
  add('6.1. Cabe à contratada: a execução técnica dos serviços e a emissão dos documentos técnicos acordados.');
  add('6.2. Cabe ao contratante: franquear o acesso ao local, fornecer as informações e os projetos necessários e efetuar os pagamentos no prazo.');
  add();

  if (d.condicoes?.trim()) {
    add('CLÁUSULA 7ª · CONDIÇÕES GERAIS');
    add(d.condicoes.trim());
    add();
  }

  add(`CLÁUSULA ${d.condicoes?.trim() ? '8ª' : '7ª'} · FORO`);
  add(`Fica eleito o foro da comarca de ${campo(campos, 'cidadeForo', '____________')} para dirimir eventuais questões decorrentes deste contrato.`);
  return linhas.join('\n');
}
