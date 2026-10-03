// Chamadas à API do próprio servidor (mesmo endereço, cookie de sessão).

export class ErroApi extends Error {
  status: number;
  dados: Record<string, any>;
  constructor(status: number, mensagem: string, dados: Record<string, any> = {}) {
    super(mensagem);
    this.status = status;
    this.dados = dados;
  }
}

export async function api<T = any>(caminho: string, opcoes: { metodo?: string; corpo?: unknown } = {}): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(`/api${caminho}`, {
      method: opcoes.metodo ?? (opcoes.corpo ? 'POST' : 'GET'),
      credentials: 'same-origin',
      headers: opcoes.corpo ? { 'Content-Type': 'application/json' } : undefined,
      body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
    });
  } catch {
    throw new ErroApi(0, 'Sem conexão com o servidor. Verifique a internet e tente de novo.');
  }
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new ErroApi(resp.status, dados?.erro ?? 'Não foi possível concluir. Tente de novo.', dados ?? {});
  return dados as T;
}

export type Perfil = 'admin_sistema' | 'dono' | 'gestor' | 'motorista' | 'operador_usina' | 'laboratorista';

export type Usuario = {
  id: string;
  nome: string;
  email: string;
  perfil: Perfil;
  empresaId: string | null;
  telefoneWhatsapp: string | null;
  ativo: boolean;
  ultimoAcesso: string | null;
  administrador: boolean;
  /** null = segue o padrão do perfil */
  modulos: Modulo[] | null;
  modulosEfetivos: Modulo[];
};

export const MODULOS = ['frota', 'producao', 'qualidade', 'suprimentos', 'financeiro', 'gerencial', 'administrativo', 'configuracoes'] as const;
export type Modulo = (typeof MODULOS)[number];
export const NOMES_MODULO: Record<Modulo, string> = {
  frota: 'Frota', producao: 'Produção', qualidade: 'Qualidade', suprimentos: 'Suprimentos', financeiro: 'Financeiro',
  gerencial: 'Gerencial', administrativo: 'Administrativo', configuracoes: 'Configurações',
};
export type Impressao = { orientacao: 'retrato' | 'paisagem'; papel: 'A4' | 'Carta' | 'Oficio' };

export type Empresa = {
  id: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  cnpj: string;
  regimeTributario: 'simples' | 'presumido' | 'real';
  aliquotasDre: Record<string, number>;
  telefone: string | null;
  email: string | null;
  cidade: string | null;
  uf: string | null;
  plano: string;
  ativo: boolean;
  totalUsuarios?: number;
  temLogo?: boolean;
  logoVersao?: number | null;
  impressao?: Impressao;
};

export const NOMES_PERFIL: Record<Perfil, string> = {
  admin_sistema: 'Administrador do sistema',
  dono: 'Dono',
  gestor: 'Gestor',
  motorista: 'Motorista',
  operador_usina: 'Operador de usina',
  laboratorista: 'Laboratorista',
};

export function formatarCnpj(c: string): string {
  const d = (c ?? '').replace(/\D/g, '');
  if (d.length !== 14) return c;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

export function formatarDataHora(iso: string | null): string {
  if (!iso) return 'Nunca';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

// ---------- Frota ----------
export type TipoVeiculo = 'betoneira' | 'bomba_lanca' | 'bomba_estacionaria' | 'apoio' | 'pa_carregadeira';
export type StatusVeiculo = 'disponivel' | 'manutencao' | 'parado' | 'inativo';
export type Situacao = 'vencido' | 'vencendo' | 'em_dia' | 'sem_data';

export type Veiculo = {
  id: string;
  codigo: string;
  tipo: TipoVeiculo;
  placa: string | null;
  marcaModelo: string | null;
  ano: number | null;
  capacidadeM3: number | null;
  alcanceLancaM: number | null;
  kmAtual: number;
  horimetroAtual: number;
  status: StatusVeiculo;
  observacoes: string | null;
  docsVencidos?: number;
  docsVencendo?: number;
};

export type DocumentoVeiculo = {
  id: string;
  veiculoId: string;
  tipo: 'crlv' | 'licenciamento' | 'seguro' | 'ipva' | 'tacografo' | 'outro';
  descricao: string | null;
  numero: string | null;
  vencimento: string | null;
  valor: number | null;
  situacao: Situacao;
  dias: number | null;
};

export type Funcao = 'motorista' | 'operador_bomba' | 'motorista_operador' | 'operador_usina' | 'mecanico' | 'laboratorista' | 'administrativo' | 'vendedor' | 'outro';
export type Motorista = {
  id: string;
  nome: string;
  telefone: string | null;
  cpf: string | null;
  funcao: Funcao;
  cargo: string | null;
  email: string | null;
  dataAdmissao: string | null;
  observacoes: string | null;
  cnhNumero: string | null;
  cnhCategoria: string | null;
  cnhVencimento: string | null;
  cnhSituacao: Situacao;
  cnhDias: number | null;
  cursos: string[];
  ativo: boolean;
  usuarioId: string | null;
  usuarioEmail: string | null;
};

export type Alerta = {
  tipo: 'documento' | 'cnh';
  referencia: string;
  veiculoId?: string;
  motoristaId?: string;
  item: string;
  descricao: string | null;
  vencimento: string;
  situacao: Situacao;
  dias: number;
};

export const NOMES_TIPO_VEICULO: Record<TipoVeiculo, string> = {
  betoneira: 'Betoneira',
  bomba_lanca: 'Bomba lança',
  bomba_estacionaria: 'Bomba estacionária',
  apoio: 'Apoio',
  pa_carregadeira: 'Pá-carregadeira',
};

export const NOMES_STATUS_VEICULO: Record<StatusVeiculo, string> = {
  disponivel: 'Disponível',
  manutencao: 'Na oficina',
  parado: 'Parado',
  inativo: 'Inativo',
};

export const CLASSE_STATUS_VEICULO: Record<StatusVeiculo, string> = {
  disponivel: 'selo-ok',
  manutencao: 'selo-aviso',
  parado: 'selo-perigo',
  inativo: 'selo-neutro',
};

export const NOMES_TIPO_DOCUMENTO: Record<DocumentoVeiculo['tipo'], string> = {
  crlv: 'CRLV',
  licenciamento: 'Licenciamento',
  seguro: 'Seguro',
  ipva: 'IPVA',
  tacografo: 'Aferição do tacógrafo',
  outro: 'Outro',
};

export const NOMES_FUNCAO: Record<Funcao, string> = {
  motorista: 'Motorista',
  operador_bomba: 'Operador de bomba',
  motorista_operador: 'Motorista e operador',
  operador_usina: 'Operador de usina',
  mecanico: 'Mecânico',
  laboratorista: 'Laboratorista',
  administrativo: 'Administrativo',
  vendedor: 'Vendedor',
  outro: 'Outra função',
};
export const FUNCOES_FROTA: Funcao[] = ['motorista', 'operador_bomba', 'motorista_operador'];

export function formatarPlaca(p: string | null): string {
  if (!p) return '—';
  return /^[A-Z]{3}[0-9]{4}$/.test(p) ? `${p.slice(0, 3)}-${p.slice(3)}` : p;
}

export function formatarNumero(n: number | null | undefined, casas = 0): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

export function formatarMoeda(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatarData(iso: string | null): string {
  if (!iso) return '—';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

/** Texto e classe do selo de vencimento. */
export function seloVencimento(s: Situacao, dias: number | null): { texto: string; classe: string } {
  if (s === 'sem_data' || dias === null) return { texto: 'Sem vencimento', classe: 'selo-neutro' };
  if (s === 'vencido') return { texto: dias === -1 ? 'Venceu ontem' : `Venceu há ${-dias} dias`, classe: 'selo-perigo' };
  if (s === 'vencendo') return { texto: dias === 0 ? 'Vence hoje' : dias === 1 ? 'Vence amanhã' : `Vence em ${dias} dias`, classe: 'selo-aviso' };
  return { texto: 'Em dia', classe: 'selo-ok' };
}

// ---------- Abastecimento ----------
export type Abastecimento = {
  id: string;
  veiculoId: string;
  veiculoCodigo: string;
  motoristaId: string | null;
  motoristaNome: string | null;
  dataHora: string;
  litros: number;
  valorTotal: number | null;
  precoLitro: number | null;
  km: number | null;
  horimetro: number | null;
  origem: 'posto' | 'tanque_proprio';
  posto: string | null;
  tanqueCheio: boolean;
  observacoes: string | null;
  temNota: boolean;
  kmRodados: number | null;
  horas: number | null;
  kmPorLitro: number | null;
  litrosPorHora: number | null;
};

export type ConsumoVeiculo = {
  veiculoId: string;
  codigo: string;
  tipo: TipoVeiculo;
  abastecimentos: number;
  litros: number;
  valor: number;
  km: number;
  horas: number;
  kmPorLitro: number | null;
  litrosPorHora: number | null;
  media90: { kmPorLitro: number | null; litrosPorHora: number | null };
  ultimo: { kmPorLitro: number | null; litrosPorHora: number | null } | null;
  ultimaData: string | null;
  piora: number | null;
};

/** Converte número digitado no padrão brasileiro ("1.234,5") em número. */
export function lerNumero(s: string): number | null {
  const t = (s ?? '').trim().replace(/\s/g, '');
  if (!t) return null;
  let n = t;
  if (t.includes(',')) n = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) n = t.replace(/\./g, '');
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

/** Data e hora local de Brasília no formato do campo datetime-local. */
export function agoraLocal(d = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

export function formatarDataHoraCurta(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ---------- Administrativo ----------
export type Fornecedor = {
  id: string;
  categoria: 'fornecedor' | 'credor';
  tipoPessoa: 'PJ' | 'PF';
  cnpjCpf: string | null;
  razaoSocial: string;
  nomeFantasia: string | null;
  ramo: string | null;
  telefone: string | null;
  email: string | null;
  cidade: string | null;
  uf: string | null;
  chavePix: string | null;
  observacoes: string | null;
  ativo: boolean;
};

export function formatarDocumento(d: string | null): string {
  if (!d) return '—';
  if (d.length === 14) return formatarCnpj(d);
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return d;
}

// ---------- Manutenção ----------
export type Plano = {
  id: string;
  tipoVeiculo: TipoVeiculo | null;
  item: string;
  intervaloKm: number | null;
  intervaloHoras: number | null;
  intervaloDias: number | null;
  ativo: boolean;
};

export type ItemManutencao = {
  veiculoId: string;
  codigo: string;
  tipoVeiculo: TipoVeiculo;
  planoId: string;
  item: string;
  intervaloKm: number | null;
  intervaloHoras: number | null;
  intervaloDias: number | null;
  ultimaKm: number | null;
  ultimaHoras: number | null;
  ultimaData: string | null;
  situacao: 'vencida' | 'proxima' | 'em_dia' | 'sem_registro';
  proximaKm: number | null;
  proximaHoras: number | null;
  proximaData: string | null;
  faltaKm: number | null;
  faltaHoras: number | null;
  faltaDias: number | null;
  uso: number | null;
};

export type ItemOS = { id: string; tipo: 'peca' | 'mao_de_obra' | 'servico'; descricao: string; quantidade: number; valorUnitario: number; total: number; planoId: string | null; planoItem: string | null; temNota: boolean };
export type OrdemServico = {
  id: string;
  numero: number;
  veiculoId: string;
  veiculoCodigo: string;
  tipo: 'preventiva' | 'corretiva';
  descricao: string;
  abertura: string;
  conclusao: string | null;
  dias: number | null;
  km: number | null;
  horimetro: number | null;
  oficina: 'interna' | 'externa';
  fornecedorId: string | null;
  fornecedorNome: string | null;
  status: 'aberta' | 'em_andamento' | 'concluida' | 'cancelada';
  observacoes: string | null;
  total: number;
  itens: ItemOS[];
};

export const NOMES_STATUS_OS: Record<OrdemServico['status'], string> = { aberta: 'Aberta', em_andamento: 'Em andamento', concluida: 'Concluída', cancelada: 'Cancelada' };
export const CLASSE_STATUS_OS: Record<OrdemServico['status'], string> = { aberta: 'selo-aviso', em_andamento: 'selo-aviso', concluida: 'selo-ok', cancelada: 'selo-neutro' };
export const NOMES_ITEM_OS: Record<ItemOS['tipo'], string> = { peca: 'Peça', mao_de_obra: 'Mão de obra', servico: 'Serviço' };

/** Texto curto do que falta para a revisão (o critério mais próximo). */
export function textoFalta(i: Pick<ItemManutencao, 'situacao' | 'faltaKm' | 'faltaHoras' | 'faltaDias'>): string {
  if (i.situacao === 'sem_registro') return 'Sem registro da última execução';
  const partes: { v: number; t: string }[] = [];
  if (i.faltaKm !== null) partes.push({ v: i.faltaKm, t: `${formatarNumero(Math.abs(i.faltaKm))} km` });
  if (i.faltaHoras !== null) partes.push({ v: i.faltaHoras * 30, t: `${formatarNumero(Math.abs(i.faltaHoras))} h` });
  if (i.faltaDias !== null) partes.push({ v: i.faltaDias * 400, t: `${formatarNumero(Math.abs(i.faltaDias))} ${Math.abs(i.faltaDias) === 1 ? 'dia' : 'dias'}` });
  const vencidos = partes.filter((p) => p.v < 0);
  if (vencidos.length) return `Passou ${vencidos.map((p) => p.t).join(' e ')}`;
  const menor = partes.sort((a, b) => a.v - b.v)[0];
  return menor ? `Faltam ${menor.t}` : '—';
}

export function intervaloTexto(p: Pick<Plano, 'intervaloKm' | 'intervaloHoras' | 'intervaloDias'>): string {
  const t: string[] = [];
  if (p.intervaloKm) t.push(`${formatarNumero(p.intervaloKm)} km`);
  if (p.intervaloHoras) t.push(`${formatarNumero(p.intervaloHoras)} h`);
  if (p.intervaloDias) t.push(`${formatarNumero(p.intervaloDias)} dias`);
  return t.join(' ou ');
}

// ---------- Financeiro ----------
export type TipoLanc = 'receita' | 'despesa';
export type ContaFinanceira = {
  id: string;
  nome: string;
  tipo: 'banco' | 'caixa' | 'cartao' | 'aplicacao';
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  saldoInicial: number;
  dataSaldoInicial: string;
  saldo: number;
  ativo: boolean;
};
export type LinhaDre =
  | 'receita_bruta' | 'deducoes' | 'custo_producao' | 'custo_frota' | 'custo_pessoal' | 'despesas_pessoal' | 'despesas_administrativas'
  | 'despesas_comerciais' | 'receitas_financeiras' | 'despesas_financeiras' | 'outras_receitas' | 'outras_despesas' | 'impostos_lucro' | 'fora_dre';
export type PlanoConta = { id: string; codigo: string; nome: string; tipo: TipoLanc; linhaDre: LinhaDre; paiId: string | null; aceitaLancamento: boolean; ativo: boolean };
export type CentroCusto = { id: string; nome: string; ativo: boolean };
export type SituacaoParcela = 'paga' | 'cancelada' | 'vencida' | 'vence_hoje' | 'a_vencer';
export type Parcela = {
  id: string;
  lancamentoId: string;
  numero: number;
  totalParcelas: number | null;
  vencimento: string;
  valor: number;
  status: 'aberta' | 'paga' | 'cancelada';
  situacao: SituacaoParcela;
  dataPagamento: string | null;
  juros: number;
  desconto: number;
  valorPago: number | null;
  contaId: string | null;
  contaNome: string | null;
  forma: FormaPagamento | null;
  observacoes: string | null;
  tipo?: TipoLanc;
  descricao?: string;
  documento?: string | null;
  pessoa?: string | null;
  categorias?: string | null;
  competencia?: string;
};
export type Apropriacao = {
  id: string;
  planoContaId: string;
  planoCodigo: string;
  planoNome: string;
  centroCustoId: string | null;
  centroNome: string | null;
  veiculoId: string | null;
  veiculoCodigo: string | null;
  descricao: string | null;
  valor: number;
};
export type Lancamento = {
  id: string;
  tipo: TipoLanc;
  competencia: string;
  descricao: string;
  documento: string | null;
  valorTotal: number;
  clienteId: string | null;
  clienteNome: string | null;
  fornecedorId: string | null;
  fornecedorNome: string | null;
  origem: string;
  notaId: string | null;
  status: 'rascunho' | 'aguardando_conferencia' | 'confirmado' | 'cancelado';
  recorrencia: 'nenhuma' | 'semanal' | 'mensal' | 'anual';
  recorrenciaOrdem: number | null;
  recorrenciaTotal: number | null;
  observacoes: string | null;
  apropriacoes: Apropriacao[];
  parcelas: Parcela[];
};
export type LancamentoResumo = {
  id: string;
  tipo: TipoLanc;
  competencia: string;
  descricao: string;
  documento: string | null;
  valorTotal: number;
  status: Lancamento['status'];
  recorrencia: Lancamento['recorrencia'];
  recorrenciaOrdem: number | null;
  pessoa: string | null;
  categorias: string | null;
  veiculos: string | null;
  parcelas: number;
  pagas: number;
  valorAberto: number;
  proximoVencimento: string | null;
};
export type FormaPagamento = 'pix' | 'boleto' | 'transferencia' | 'cartao' | 'dinheiro' | 'cheque' | 'debito_automatico';
export const NOMES_FORMA: Record<FormaPagamento, string> = {
  pix: 'PIX', boleto: 'Boleto', transferencia: 'Transferência', cartao: 'Cartão', dinheiro: 'Dinheiro', cheque: 'Cheque', debito_automatico: 'Débito automático',
};
export const NOMES_TIPO_CONTA: Record<ContaFinanceira['tipo'], string> = { banco: 'Conta bancária', caixa: 'Caixa', cartao: 'Cartão de crédito', aplicacao: 'Aplicação' };
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
  fora_dre: 'Fora da DRE (investimentos, empréstimos, sócios)',
};
export const SELO_PARCELA: Record<SituacaoParcela, { texto: string; classe: string }> = {
  paga: { texto: 'Paga', classe: 'selo-ok' },
  cancelada: { texto: 'Cancelada', classe: 'selo-neutro' },
  vencida: { texto: 'Vencida', classe: 'selo-perigo' },
  vence_hoje: { texto: 'Vence hoje', classe: 'selo-aviso' },
  a_vencer: { texto: 'A vencer', classe: 'selo-neutro' },
};

export const hojeLocal = () => agoraLocal().slice(0, 10);

/** Soma meses mantendo o dia (ajusta para o último dia do mês). */
export function somarMeses(data: string, meses: number): string {
  const [a, m, d] = data.split('-').map(Number);
  const total = a * 12 + (m - 1) + meses;
  const ano = Math.floor(total / 12);
  const mes = total % 12;
  const ultimo = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  return `${ano}-${String(mes + 1).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`;
}
export function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export function nomeMes(aaaamm: string): string {
  const [a, m] = aaaamm.split('-').map(Number);
  return `${MESES[m - 1]} de ${a}`;
}

/** Divide o total em parcelas iguais (a sobra dos centavos vai na primeira). */
export function dividirParcelas(total: number, quantidade: number, primeiro: string, intervaloDias: number | 'mensal') {
  const centavos = Math.round(total * 100);
  const n = Math.max(1, Math.floor(quantidade));
  const base = Math.floor(centavos / n);
  const resto = centavos - base * n;
  return Array.from({ length: n }, (_, i) => ({
    vencimento: intervaloDias === 'mensal' ? somarMeses(primeiro, i) : somarDias(primeiro, i * intervaloDias),
    valor: (base + (i === 0 ? resto : 0)) / 100,
  }));
}

/** Valor para campo de texto no padrão brasileiro, sem "R$". */
export function moedaCampo(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------- Notas fiscais ----------
export type StatusNota = 'rascunho' | 'aguardando_conferencia' | 'confirmada' | 'cancelada';
export type ModeloNota = 'nfe' | 'nfce' | 'nfse' | 'cte' | 'cupom' | 'recibo' | 'outro';
export type ItemNota = {
  id: string;
  numeroItem: number;
  codigoProduto: string | null;
  descricao: string;
  ncm: string | null;
  cfop: string | null;
  unidade: string | null;
  quantidade: number;
  valorProduto: number;
  valorCusto: number;
  planoContaId: string | null;
  planoCodigo: string | null;
  planoNome: string | null;
  centroCustoId: string | null;
  centroNome: string | null;
  veiculoId: string | null;
  veiculoCodigo: string | null;
  insumoId: string | null;
  insumoNome: string | null;
  insumoUnidade: UnidadeInsumo | null;
  fatorEstoque: number | null;
  sugestao: 'regra' | 'palavras' | 'fornecedor' | null;
  abastecimentos: { quantidade: number; litros: number; valor: number; veiculos: string | null } | null;
  os: { quantidade: number; valor: number; ordens: string | null } | null;
};
export type NotaFiscal = {
  id: string;
  direcao: 'entrada' | 'saida';
  tipo: TipoLanc;
  modelo: ModeloNota;
  chaveAcesso: string | null;
  numero: string | null;
  serie: string | null;
  dataEmissao: string;
  competencia: string;
  fornecedorId: string | null;
  fornecedorNome: string | null;
  fornecedorNovo: boolean;
  clienteId: string | null;
  clienteNome: string | null;
  emitenteNome: string | null;
  emitenteDocumento: string | null;
  naturezaOperacao: string | null;
  totais: { produtos: number; frete: number; seguro: number; desconto: number; outras: number; ipi: number; icmsSt: number; total: number };
  formaPagamento: FormaPagamento | null;
  informacoes: string | null;
  observacoes: string | null;
  avisos: string[];
  origem: 'manual' | 'xml' | 'ia_whatsapp';
  status: StatusNota;
  temXml: boolean;
  conferidoEm: string | null;
  lancamento: { id: string; status: string; parcelas: number; pagas: number } | null;
  pendencias: string[];
  itens: ItemNota[];
  duplicatas: { id: string; numero: string | null; vencimento: string; valor: number }[];
};
export type NotaResumo = {
  id: string;
  direcao: 'entrada' | 'saida';
  modelo: ModeloNota;
  numero: string | null;
  serie: string | null;
  dataEmissao: string;
  competencia: string;
  total: number;
  status: StatusNota;
  origem: NotaFiscal['origem'];
  lancamentoId: string | null;
  pessoa: string | null;
  itens: number;
  semCategoria: number;
  categorias: string | null;
};
export const NOMES_MODELO: Record<ModeloNota, string> = { nfe: 'NF-e', nfce: 'NFC-e', nfse: 'NFS-e', cte: 'CT-e', cupom: 'Cupom fiscal', recibo: 'Recibo', outro: 'Outro documento' };
export const SELO_NOTA: Record<StatusNota, { texto: string; classe: string }> = {
  rascunho: { texto: 'Para conferir', classe: 'selo-aviso' },
  aguardando_conferencia: { texto: 'Para conferir', classe: 'selo-aviso' },
  confirmada: { texto: 'Lançada', classe: 'selo-ok' },
  cancelada: { texto: 'Cancelada', classe: 'selo-neutro' },
};
export const TEXTO_SUGESTAO: Record<NonNullable<ItemNota['sugestao']>, string> = {
  regra: 'sugerida: já usada antes com este fornecedor',
  palavras: 'sugerida pela descrição do item',
  fornecedor: 'sugerida: categoria habitual do fornecedor',
};
export function formatarChave(c: string | null): string {
  return c ? c.replace(/(\d{4})(?=\d)/g, '$1 ') : '—';
}

// ---------------------------------------------------------------- Produção
export type TipoInsumo = 'cimento' | 'areia' | 'brita' | 'aditivo' | 'agua' | 'fibra' | 'outro';
export type UnidadeInsumo = 'kg' | 'L' | 'm3' | 't' | 'un';
export const NOMES_TIPO_INSUMO: Record<TipoInsumo, string> = { cimento: 'Cimento', areia: 'Areia', brita: 'Brita', aditivo: 'Aditivo', agua: 'Água', fibra: 'Fibra', outro: 'Outro' };
export const NOMES_UNIDADE: Record<UnidadeInsumo, string> = { kg: 'kg', L: 'L', m3: 'm³', t: 't', un: 'un' };
export type Insumo = {
  id: string; nome: string; tipo: TipoInsumo; unidade: UnidadeInsumo; custoUnitario: number | null; estoqueMinimo: number | null; ativo: boolean; usadoEmTracos: number;
  controlaEstoque: boolean; custoOrigem: 'notas' | 'cadastro' | null; custoAtualizadoEm: string | null;
};
export type ItemTraco = { insumoId: string; nome: string; tipo: TipoInsumo; unidade: UnidadeInsumo; quantidade: number; custo: number | null };
export type Traco = {
  id: string; codigo: string; descricao: string | null; fck: number | null; slump: string | null; brita: string | null; observacoes: string | null; ativo: boolean;
  itens: ItemTraco[]; cimentoKgM3: number; custoM3: number | null; custoIncompleto: boolean;
};
export type Carga = {
  id: string; numero: number; dataHora: string; dia: string; tracoId: string; tracoCodigo: string; volume: number; clienteId: string | null; clienteNome: string | null;
  obra: string | null; betoneiraId: string; betoneiraCodigo: string; motoristaId: string | null; motoristaNome: string | null; bombaId: string | null; bombaCodigo: string | null;
  operadorBombaId: string | null; operadorBombaNome: string | null; volumeBombeado: number | null; devolvido: number; documento: string | null; observacoes: string | null;
  status: 'produzida' | 'cancelada'; motivoCancelamento: string | null; registradoPor: string | null; slump: number | null;
};
export type OpcoesCarga = {
  tracos: { id: string; codigo: string; descricao: string | null; fck: number | null; slump: string | null }[];
  betoneiras: { id: string; codigo: string; placa: string | null; capacidade: number | null; status: StatusVeiculo }[];
  bombas: { id: string; codigo: string; placa: string | null; status: StatusVeiculo }[];
  pessoas: { id: string; nome: string; funcao: Funcao; escala: string | null }[];
  clientes: { id: string; nome: string }[];
  motoristaDaBetoneira: Record<string, string>;
};
export type ProducaoPessoa = {
  pessoaId: string; nome: string; funcao: Funcao; entregas: number; m3Entregue: number; valorEntregas: number; bombeamentos: number; m3Bombeado: number;
  valorBombeamento: number; total: number; diasTrabalhados: number;
};
export type LinhaProducao = {
  cargaId: string; numero: number; dia: string; dataHora: string; pessoaId: string; pessoaNome: string; funcao: Funcao; papel: 'entrega' | 'bombeamento';
  tracoCodigo: string; clienteNome: string | null; obra: string | null; veiculoCodigo: string | null; m3: number; valorM3: number | null; valor: number;
};
export type ValoresVigentes = { motorista: { valorM3: number; vigencia: string } | null; operadorBomba: { valorM3: number; vigencia: string } | null };
export type ItemEscala = { motoristaId: string; nome: string; funcao: Funcao; entrada: string | null; folga: boolean; observacao: string | null };

/** "2026-10-02" → "sexta-feira, 2 de outubro de 2026" */
export function dataPorExtenso(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
/** "2026-10-02" → "sex, 02/10" */
export function diaCurto(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return `${d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')}, ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

// ---------------------------------------------------------------- Qualidade
export type ConfigQualidade = { idades: number[]; cpsPorIdade: number; idadeControle: number; diametroMm: number; responsavelNome: string | null; responsavelRegistro: string | null };
export type CpAromper = {
  id: string; amostraId: string; idade: number; numero: number; previsto: string; atraso: number; cargaNumero: number; moldagem: string; tracoCodigo: string; fck: number | null;
  clienteNome: string | null; obra: string | null; betoneiraCodigo: string; slump: number | null; anterior: number | null;
};
export type Amostra = {
  amostraId: string; cargaId: string; numero: number; dataHora: string; dia: string; tracoId: string; tracoCodigo: string; fck: number | null; slumpTraco: string | null;
  faixa: [number, number] | null; volume: number; clienteId: string | null; clienteNome: string | null; obra: string | null; betoneiraCodigo: string; documento: string | null;
  slump: number | null; slumpFora: boolean | null; temperatura: number | null; moldadoPor: string | null; observacao: string | null; status: 'ativa' | 'cancelada';
  idades: { idade: number; previsto: string; cps: { id: string; numero: number; resistencia: number | null; situacao: 'aguardando' | 'rompido' | 'descartado'; dataRuptura: string | null }[]; exemplar: number | null }[];
  resultadoControle: number | null; conforme: boolean | null;
};
export type ResumoQualidade = {
  cargas: number; m3: number; exemplares: number; aguardando: number; media: number | null; desvio: number | null; minimo: number | null; fck: number | null;
  fckEstimado: number | null; abaixoFck: number; conforme: boolean | null; slumpMedidos: number; slumpFora: number;
};
export type Equipamento = {
  id: string; nome: string; tipo: 'balanca' | 'prensa' | 'cone_slump' | 'termometro' | 'molde' | 'outro'; identificacao: string | null; ultimaCalibracao: string | null;
  validadeDias: number | null; proximaCalibracao: string | null; dias: number | null; situacao: 'vencido' | 'vencendo' | 'em_dia' | 'sem_data'; certificado: string | null;
  laboratorio: string | null; observacoes: string | null; ativo: boolean;
};
export const NOMES_TIPO_EQUIP: Record<Equipamento['tipo'], string> = { balanca: 'Balança', prensa: 'Prensa', cone_slump: 'Cone de slump', termometro: 'Termômetro', molde: 'Moldes', outro: 'Outro' };
/** 31.5 → "31,5 MPa" */
export const mpa = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MPa`);
