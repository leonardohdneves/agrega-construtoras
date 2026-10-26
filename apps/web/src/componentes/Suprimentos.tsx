// Tipos, selos e peças comuns do módulo Suprimentos.
import { useEffect, useState, type ReactNode } from 'react';
import { api, type AtuacaoFornecedor, type CentroCusto, type Fornecedor } from '../api';

// ---------- Tipos da API ----------
export type StatusSolicitacao = 'aberta' | 'finalizada' | 'em_cotacao' | 'atendida' | 'cancelada';
export type StatusCotacao = 'aberta' | 'concluida' | 'cancelada';
export type StatusPedido = 'rascunho' | 'aguardando_aprovacao' | 'aprovado' | 'reprovado' | 'enviado' | 'parcial' | 'recebido' | 'encerrado' | 'cancelado';

/** Insumo da obra (necessidade) apropriado a um nó da EAP. Os campos de EAP vêm do planejamento/orçamento da obra. */
export type ItemEap = { eapNoId: string | null; eapCodigo: string | null; eapDescricao: string | null };
export type ObraRef = { id: string; codigo: string; nome: string };
export type ItemSolicitacao = ItemEap & {
  codigo?: string | null;
  id: string; necessidadeId: string | null; obraItemId: string | null; descricao: string; unidade: string; quantidade: number; observacao: string | null;
};
export type TipoSolicitacao = 'insumo' | 'servico';
/** Escopo do serviço: o que a contratada fornece (direciona a minuta do contrato). */
export type EscopoServico = 'mo' | 'eq' | 'mat' | 'mat_mo' | 'mat_mo_eq' | 'mo_eq' | 'mat_eq';
/** Atuações do fornecedor que atendem cada escopo (escopo combinado: basta uma delas). */
const ATUACAO_DO_ESCOPO: Record<EscopoServico, AtuacaoFornecedor[]> = {
  mo: ['mo'],
  eq: ['eq'],
  mat: ['mat'],
  mat_mo: ['mat', 'mo'],
  mat_mo_eq: ['mat', 'mo', 'eq'],
  mo_eq: ['mo', 'eq'],
  mat_eq: ['mat', 'eq'],
};
export function fornecedorAtendeEscopo(atuacao: AtuacaoFornecedor[] | null | undefined, escopo: EscopoServico | null | undefined): boolean {
  if (!escopo) return true;
  return (atuacao ?? []).some((a) => ATUACAO_DO_ESCOPO[escopo].includes(a));
}
export const ESCOPOS_SERVICO: { valor: EscopoServico; rotulo: string }[] = [
  { valor: 'mo', rotulo: 'Somente mão de obra' },
  { valor: 'eq', rotulo: 'Somente locação de equipamento' },
  { valor: 'mat', rotulo: 'Somente material' },
  { valor: 'mat_mo', rotulo: 'Material e mão de obra' },
  { valor: 'mat_mo_eq', rotulo: 'Material, mão de obra e equipamento' },
  { valor: 'mo_eq', rotulo: 'Mão de obra e equipamento' },
  { valor: 'mat_eq', rotulo: 'Material e equipamento' },
];
export type Solicitacao = {
  id: string; numero: number; data: string; necessidade: string | null; obraId: string | null; obra: ObraRef | null; centroCustoId: string | null; centroCusto: string | null; tipo: TipoSolicitacao; planoContaId: string | null; escopo: EscopoServico | null;
  observacao: string | null; status: StatusSolicitacao; finalizadaEm: string | null; solicitante: string | null; cotacoes: { id: string; numero: number; status: StatusCotacao }[];
  pedidos: { id: string; numero: number; status: StatusPedido }[]; itens: ItemSolicitacao[];
};
export type SolicitacaoResumo = {
  id: string; numero: number; data: string; necessidade: string | null; obra: ObraRef | null; status: StatusSolicitacao; finalizadaEm: string | null; observacao: string | null; tipo: TipoSolicitacao;
  solicitante: string | null; itens: number; resumo: string | null; diasAberta: number | null; urgente: boolean;
};

export type OfertaCotacao = { cotacaoFornecedorId: string; precoUnitario: number; total: number };
export type ItemCotacao = ItemEap & {
  id: string; solicitacaoItemId: string | null; necessidadeId: string | null; obraItemId: string | null; codigo: string | null; descricao: string; unidade: string; quantidade: number; ofertas: OfertaCotacao[]; menorPrecoId: string | null; vencedorId: string | null;
  justificativa: string | null; foraDoMenor: boolean; totalVencedor: number | null; economiaMaior: number | null; economiaMedia: number | null;
};
export type FornecedorCotacao = {
  id: string; fornecedorId: string; nome: string; razaoSocial: string; documento: string | null; telefone: string | null; email: string | null; cidade: string | null;
  prazoEntregaDias: number | null; condicaoPagamento: string | null; frete: number; desconto: number; validade: string | null; observacao: string | null; itensCotados: number;
  subtotal: number; total: number; completo: boolean; itensVencidos: number; totalVencido: number;
};
export type Cotacao = {
  id: string; numero: number; data: string; prazoResposta: string | null; solicitacaoId: string | null; solicitacaoNumero: number | null; observacao: string | null;
  justificativa: string | null; status: StatusCotacao; criadoPor: string | null; concluidaEm: string | null; fornecedores: FornecedorCotacao[]; itens: ItemCotacao[];
  pedidos: { id: string; numero: number; status: StatusPedido; total: number; fornecedor: string }[];
  resumo: {
    itens: number; itensComVencedor: number; itensForaDoMenor: number; totalEscolhido: number; freteEscolhido: number; economiaMaior: number; economiaMedia: number;
    melhorFornecedorCompleto: { id: string; nome: string; total: number } | null;
  };
};
export type CotacaoResumo = {
  id: string; numero: number; data: string; prazoResposta: string | null; status: StatusCotacao; solicitacaoNumero: number | null; itens: number; fornecedores: number;
  respostas: number; resumo: string | null; pedidos: number;
};

export type ItemPedido = ItemEap & {
  id: string; obraItemId: string | null; necessidadeId: string | null; codigo: string | null; descricao: string; unidade: string; quantidade: number; precoUnitario: number; total: number; recebido: number;
  saldo: number; precoNota: number | null; diferencaPreco: number | null; diferencaQuantidade: number | null;
};
export type Pedido = {
  id: string; numero: number; data: string; status: StatusPedido; fornecedorId: string;
  fornecedor: { nome: string; razaoSocial: string; documento: string | null; telefone: string | null; email: string | null; cidade: string | null };
  cotacaoId: string | null; cotacaoNumero: number | null; solicitacaoId: string | null; solicitacaoNumero: number | null; previsaoEntrega: string | null; atrasado: boolean;
  entregaObra: { codigo: string; nome: string; endereco: string | null; cidade: string | null; contatoNome: string | null; contatoTelefone: string | null; referencia: string | null } | null;
  diasAtraso: number; condicaoPagamento: string | null; localEntrega: string | null; frete: number;
  freteTipo: 'transportadora' | 'proprio' | null; transportadora: { id: string; nome: string } | null;
  subtotal: number; total: number; centroCustoId: string | null;
  centroCusto: string | null; observacao: string | null; criadoPor: string | null; enviadoAprovacaoEm: string | null; aprovadoPor: string | null; aprovadoEm: string | null;
  aprovacaoAutomatica: boolean; motivoReprovacao: string | null; enviadoFornecedorEm: string | null; encerradoMotivo: string | null; itens: ItemPedido[];
  notas: { id: string; numero: string | null; serie: string | null; modelo: string; dataEmissao: string; total: number; status: string; lancada: boolean; itensLigados: number }[];
  divergencias: number; podeAprovar: boolean; regrasAprovacao: string;
};
export type PedidoResumo = {
  id: string; numero: number; data: string; status: StatusPedido; previsaoEntrega: string | null; atrasado: boolean; diasAtraso: number; total: number; fornecedor: string;
  cotacaoNumero: number | null; aprovadoPor: string | null; aprovacaoAutomatica: boolean; resumo: string | null; notas: number;
};
export type Aprovacao = {
  tipo: 'pedido' | 'contrato' | 'medicao' | 'autorizacao' | 'venda'; id: string; numero: number; titulo: string; pessoa: string; resumo: string | null; valor: number; enviadoEm: string;
  criadoPor: string | null; link: string; podeAprovar: boolean;
};
export type RegrasAprovacao = { adminAte: number | null; dispensaAte: number | null; texto: string };

// ---------- Selos ----------
export const SELO_SOLICITACAO: Record<StatusSolicitacao, { texto: string; classe: string }> = {
  aberta: { texto: 'Aberta', classe: 'selo-aviso' },
  finalizada: { texto: 'Finalizada', classe: 'selo-ok' },
  em_cotacao: { texto: 'Em cotação', classe: 'selo-aviso' },
  atendida: { texto: 'Atendida', classe: 'selo-ok' },
  cancelada: { texto: 'Cancelada', classe: 'selo-neutro' },
};
export const SELO_COTACAO: Record<StatusCotacao, { texto: string; classe: string }> = {
  aberta: { texto: 'Aberta', classe: 'selo-aviso' },
  concluida: { texto: 'Concluída', classe: 'selo-ok' },
  cancelada: { texto: 'Cancelada', classe: 'selo-neutro' },
};
export const SELO_PEDIDO: Record<StatusPedido, { texto: string; classe: string }> = {
  rascunho: { texto: 'Rascunho', classe: 'selo-neutro' },
  aguardando_aprovacao: { texto: 'Aguardando aprovação', classe: 'selo-aviso' },
  aprovado: { texto: 'Aprovado', classe: 'selo-ok' },
  reprovado: { texto: 'Reprovado', classe: 'selo-perigo' },
  enviado: { texto: 'Enviado ao fornecedor', classe: 'selo-ok' },
  parcial: { texto: 'Entrega parcial', classe: 'selo-aviso' },
  recebido: { texto: 'Recebido', classe: 'selo-ok' },
  encerrado: { texto: 'Encerrado com saldo', classe: 'selo-neutro' },
  cancelado: { texto: 'Cancelado', classe: 'selo-neutro' },
};
export function Selo({ s }: { s: { texto: string; classe: string } }) {
  return <span className={`selo ${s.classe}`}>{s.texto}</span>;
}

// ---------- Formatação ----------
export const qtd = (n: number | null | undefined, unidade?: string) =>
  n === null || n === undefined ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}${unidade ? ` ${unidade === 'm3' ? 'm³' : unidade === 'm2' ? 'm²' : unidade}` : ''}`;
/** Preço unitário: até 4 casas quando é fração de centavo (ex.: R$ 0,5634/kg). */
export const precoUn = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—';
  const casas = Math.abs(n) < 10 && Math.round(n * 100) !== n * 100 ? 4 : 2;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: casas });
};
export const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n > 0 ? '+' : ''}${(n * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
export const numeroDoc = (n: number) => String(n).padStart(4, '0');
export const nomeFornecedor = (f: Pick<Fornecedor, 'nomeFantasia' | 'razaoSocial'>) => f.nomeFantasia || f.razaoSocial;
export const campoNumero = (n: number | null | undefined, casas = 3) =>
  n === null || n === undefined ? '' : n.toLocaleString('pt-BR', { maximumFractionDigits: casas, useGrouping: false });

// ---------- Cadastros usados nas telas ----------
export function useCadastrosCompra() {
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [centros, setCentros] = useState<CentroCusto[]>([]);
  useEffect(() => {
    api<{ fornecedores: Fornecedor[] }>('/adm/fornecedores?categoria=fornecedor').then((r) => setFornecedores(r.fornecedores.filter((f) => f.ativo))).catch(() => {});
    api<{ centros: CentroCusto[] }>('/fin/centros-custo').then((r) => setCentros(r.centros.filter((c) => c.ativo))).catch(() => {});
  }, []);
  return { fornecedores, centros };
}

export const UNIDADES = ['kg', 't', 'L', 'm3', 'un', 'cx', 'pç', 'm', 'm2', 'h', 'sc', 'vb'];

/** Rótulo de unidade para a tela (m³, m²). */
export const unidadeTexto = (u: string) => (u === 'm3' ? 'm³' : u === 'm2' ? 'm²' : u);

/** Linha de assinatura para documentos impressos. */
export function Assinatura({ nome, papel, detalhe }: { nome: string; papel: string; detalhe?: ReactNode }) {
  return (
    <div className="assinatura">
      <div className="assinatura-linha" />
      <strong>{nome}</strong>
      <span>{papel}</span>
      {detalhe && <span className="small muted">{detalhe}</span>}
    </div>
  );
}

// ---------- Contratos, medições e autorizações ----------
export type StatusContrato = 'rascunho' | 'aguardando_aprovacao' | 'reprovado' | 'vigente' | 'encerrado' | 'cancelado';
export type StatusMedicao = 'rascunho' | 'aguardando_aprovacao' | 'aprovada' | 'reprovada' | 'cancelada';
export type StatusAutorizacao = 'aguardando_aprovacao' | 'aprovada' | 'reprovada' | 'cancelada';
export type Retencoes = { caucao: number; iss: number; inss: number; ir: number; pcc: number };
export type FornecedorDoc = { nome: string; razaoSocial: string; documento: string | null; telefone: string | null; email: string | null; cidade: string | null; chavePix?: string | null };

export type Contrato = {
  id: string; numero: number; status: StatusContrato; enviadoAprovacaoEm: string | null; aprovadoPor: string | null; aprovadoEm: string | null; aprovacaoAutomatica: boolean;
  motivoReprovacao: string | null; podeAprovar: boolean; regrasAprovacao: string; fornecedorId: string; fornecedor: FornecedorDoc; objeto: string; tipo: 'itens' | 'global';
  dataAssinatura: string | null; inicio: string; fim: string | null; vencido: boolean; valorGlobal: number | null; planoContaId: string; planoConta: string;
  centroCustoId: string | null; centroCusto: string | null; prazoPagamentoDias: number; formaPagamento: string | null; retencoes: Retencoes; observacao: string | null;
  enderecoContratante: string | null; enderecoContratada: string | null; prazoCorrecaoDias: number | null; garantiaMeses: number | null;
  encerradoEm: string | null; criadoPor: string | null;
  itens: { id: string; codigo: string | null; descricao: string; unidade: string; quantidade: number; precoUnitario: number; total: number; medido: number; pendente: number; saldo: number; valorMedido: number }[];
  medicoes: { id: string; numero: number; sequencia: number; periodoInicio: string; periodoFim: string; data: string; valor: number; status: StatusMedicao; autorizacao: { id: string; numero: number; status: StatusAutorizacao } | null }[];
  autorizacoes: { id: string; numero: number; tipo: 'medicao' | 'caucao'; data: string; vencimento: string; bruto: number; caucao: number; impostos: number; liquido: number; pago: number; status: StatusAutorizacao; medicaoSequencia: number | null }[];
  resumo: {
    valorContrato: number; medido: number; pendente: number; saldo: number; percentualMedido: number; autorizado: number; liquidoAutorizado: number; pago: number;
    impostosRetidos: number; caucaoRetida: number; caucaoLiberada: number; caucaoALiberar: number; medicoesPendentes: number; medicoesSemAutorizacao: number;
  };
};
export type ContratoResumo = {
  id: string; numero: number; status: StatusContrato; fornecedor: string; objeto: string; tipo: 'itens' | 'global'; inicio: string; fim: string | null; vencido: boolean;
  valor: number; medido: number; saldo: number; percentualMedido: number; pago: number; medicoesPendentes: number; medicoesSemAutorizacao: number; caucaoALiberar: number;
};
export type Medicao = {
  id: string; numero: number; sequencia: number; contratoId: string;
  contrato: { numero: number; objeto: string; tipo: 'itens' | 'global'; fornecedor: FornecedorDoc; retencoes: Retencoes; valor: number; status: StatusContrato; prazoPagamentoDias: number; formaPagamento: string | null };
  periodoInicio: string; periodoFim: string; data: string; valor: number; observacao: string | null; status: StatusMedicao; criadoPor: string | null;
  base: 'quantidades' | 'percentual' | 'valor' | null; percentual: number | null;
  descontos: { id: string; descricao: string; valor: number }[]; totalDescontos: number;
  enviadoAprovacaoEm: string | null; aprovadoPor: string | null; aprovadoEm: string | null; aprovacaoAutomatica: boolean; motivoReprovacao: string | null;
  itens: { contratoItemId: string; descricao: string; unidade: string; quantidadeContrato: number; precoUnitario: number; totalContrato: number; anterior: number; atual: number; acumulado: number; saldo: number; valorAnterior: number; valorAtual: number; percentualAcumulado: number }[];
  totais: { contrato: number; anterior: number; atual: number; acumulado: number; saldo: number; percentualAcumulado: number };
  retencoesPrevistas: Retencoes & { liquido: number; descontos: number; liquidoAPagar: number };
  autorizacao: { id: string; numero: number; status: StatusAutorizacao } | null;
  podeAprovar: boolean; regrasAprovacao: string;
};
export type MedicaoResumo = {
  id: string; numero: number; sequencia: number; periodoInicio: string; periodoFim: string; data: string; valor: number; status: StatusMedicao; contratoNumero: number;
  objeto: string; fornecedor: string; autorizacao: { id: string; numero: number; status: StatusAutorizacao } | null;
};
export type ParcelaAut = { numero: number; vencimento: string; valor: number; status: string; pagoEm: string | null; observacao: string | null };
export type Autorizacao = {
  id: string; numero: number; tipo: 'medicao' | 'caucao'; contratoId: string;
  contrato: { numero: number; objeto: string; fornecedor: FornecedorDoc; planoConta: string; centroCusto: string | null; retencoes: Retencoes };
  medicao: { id: string; numero: number; sequencia: number; periodoInicio: string; periodoFim: string } | null;
  data: string; vencimento: string; bruto: number; caucao: number; iss: number; inss: number; ir: number; pcc: number; impostos: number; liquido: number;
  descontos: number;
  documento: string | null; formaPagamento: string | null; observacao: string | null; status: StatusAutorizacao; criadoPor: string | null; enviadoAprovacaoEm: string;
  aprovadoPor: string | null; aprovadoEm: string | null; aprovacaoAutomatica: boolean; motivoReprovacao: string | null; lancamentoId: string | null;
  lancamentoImpostosId: string | null; parcelas: ParcelaAut[]; parcelasImpostos: ParcelaAut[]; pago: boolean; podeAprovar: boolean; regrasAprovacao: string;
};
export type AutorizacaoResumo = {
  id: string; numero: number; tipo: 'medicao' | 'caucao'; data: string; vencimento: string; bruto: number; liquido: number; status: StatusAutorizacao; contratoNumero: number;
  objeto: string; fornecedor: string; medicaoSequencia: number | null; pago: boolean;
};

export const SELO_CONTRATO: Record<StatusContrato, { texto: string; classe: string }> = {
  rascunho: { texto: 'Rascunho', classe: 'selo-neutro' },
  aguardando_aprovacao: { texto: 'Aguardando aprovação', classe: 'selo-aviso' },
  reprovado: { texto: 'Reprovado', classe: 'selo-perigo' },
  vigente: { texto: 'Vigente', classe: 'selo-ok' },
  encerrado: { texto: 'Encerrado', classe: 'selo-neutro' },
  cancelado: { texto: 'Cancelado', classe: 'selo-neutro' },
};
export const SELO_MEDICAO: Record<StatusMedicao, { texto: string; classe: string }> = {
  rascunho: { texto: 'Rascunho', classe: 'selo-neutro' },
  aguardando_aprovacao: { texto: 'Aguardando aprovação', classe: 'selo-aviso' },
  aprovada: { texto: 'Aprovada', classe: 'selo-ok' },
  reprovada: { texto: 'Reprovada', classe: 'selo-perigo' },
  cancelada: { texto: 'Cancelada', classe: 'selo-neutro' },
};
export const SELO_AUTORIZACAO: Record<StatusAutorizacao, { texto: string; classe: string }> = {
  aguardando_aprovacao: { texto: 'Aguardando aprovação', classe: 'selo-aviso' },
  aprovada: { texto: 'Aprovada', classe: 'selo-ok' },
  reprovada: { texto: 'Reprovada', classe: 'selo-perigo' },
  cancelada: { texto: 'Cancelada', classe: 'selo-neutro' },
};
export const NOMES_RETENCAO: Record<keyof Retencoes, string> = { caucao: 'Caução', iss: 'ISS', inss: 'INSS', ir: 'IR', pcc: 'PIS/COFINS/CSLL' };
export const textoRetencoes = (r: Retencoes) =>
  (Object.keys(NOMES_RETENCAO) as (keyof Retencoes)[]).filter((k) => r[k] > 0).map((k) => `${NOMES_RETENCAO[k]} ${r[k].toLocaleString('pt-BR')}%`).join(' · ') || 'Sem retenções';

// ---------- Valor por extenso (recibos) ----------
const UNID = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZ = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CEM = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
function ate999(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100), r = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CEM[c]);
  if (r < 20) { if (r) partes.push(UNID[r]); }
  else { partes.push(DEZ[Math.floor(r / 10)] + (r % 10 ? ` e ${UNID[r % 10]}` : '')); }
  return partes.join(' e ');
}
function inteiroPorExtenso(n: number): string {
  if (n === 0) return 'zero';
  const grupos: number[] = [];
  while (n > 0) { grupos.push(n % 1000); n = Math.floor(n / 1000); }
  const nomes = [['', ''], ['mil', 'mil'], ['milhão', 'milhões'], ['bilhão', 'bilhões']];
  const partes: { txt: string; valor: number }[] = [];
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i];
    if (!g) continue;
    const txt = i === 1 && g === 1 ? 'mil' : `${ate999(g)}${i ? ` ${g === 1 ? nomes[i][0] : nomes[i][1]}` : ''}`;
    partes.push({ txt, valor: g });
  }
  // "e" antes do último grupo quando ele é menor que 100 ou centena redonda.
  return partes.map((p, i) => (i > 0 && i === partes.length - 1 && (p.valor < 100 || p.valor % 100 === 0) ? `e ${p.txt}` : p.txt)).join(' ');
}
export function porExtenso(valor: number): string {
  const centavos = Math.round(Math.abs(valor) * 100);
  const reais = Math.floor(centavos / 100), cents = centavos % 100;
  const partes: string[] = [];
  if (reais) {
    const milhoesRedondos = reais >= 1_000_000 && reais % 1_000_000 === 0;
    partes.push(`${inteiroPorExtenso(reais)}${milhoesRedondos ? ' de' : ''} ${reais === 1 ? 'real' : 'reais'}`);
  }
  if (cents) partes.push(`${inteiroPorExtenso(cents)} ${cents === 1 ? 'centavo' : 'centavos'}`);
  return partes.join(' e ') || 'zero real';
}
