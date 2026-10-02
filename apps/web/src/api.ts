// Chamadas à API do próprio servidor (mesmo endereço, cookie de sessão).

export class ErroApi extends Error {
  status: number;
  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.status = status;
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
  if (!resp.ok) throw new ErroApi(resp.status, dados?.erro ?? 'Não foi possível concluir. Tente de novo.');
  return dados as T;
}

export type Perfil = 'admin_sistema' | 'dono' | 'gestor' | 'motorista';

export type Usuario = {
  id: string;
  nome: string;
  email: string;
  perfil: Perfil;
  empresaId: string | null;
  telefoneWhatsapp: string | null;
  ativo: boolean;
  ultimoAcesso: string | null;
};

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
};

export const NOMES_PERFIL: Record<Perfil, string> = {
  admin_sistema: 'Administrador do sistema',
  dono: 'Dono',
  gestor: 'Gestor',
  motorista: 'Motorista',
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

export type Motorista = {
  id: string;
  nome: string;
  telefone: string | null;
  cpf: string | null;
  funcao: 'motorista' | 'operador_bomba' | 'motorista_operador';
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

export const NOMES_FUNCAO: Record<Motorista['funcao'], string> = {
  motorista: 'Motorista',
  operador_bomba: 'Operador de bomba',
  motorista_operador: 'Motorista e operador',
};

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
