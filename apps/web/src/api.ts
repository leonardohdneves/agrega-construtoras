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
