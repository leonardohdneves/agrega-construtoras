// Módulos do Agrega e o acesso de cada usuário: o padrão do perfil ou a lista escolhida pelo administrador.
import type { Perfil } from './token.ts';

export const MODULOS = ['frota', 'producao', 'qualidade', 'suprimentos', 'financeiro', 'gerencial', 'administrativo', 'configuracoes'] as const;
export type Modulo = (typeof MODULOS)[number];

export const NOMES_MODULO: Record<Modulo, string> = {
  frota: 'Frota',
  producao: 'Produção',
  qualidade: 'Qualidade',
  suprimentos: 'Suprimentos',
  financeiro: 'Financeiro',
  gerencial: 'Gerencial',
  administrativo: 'Administrativo',
  configuracoes: 'Configurações',
};

/** Módulos de cada perfil quando o administrador não escolhe outros. */
export const MODULOS_PADRAO: Record<Perfil, Modulo[]> = {
  admin_sistema: [],
  dono: [...MODULOS],
  gestor: [...MODULOS],
  operador_usina: ['producao'],
  laboratorista: ['qualidade', 'producao'],
  motorista: ['frota', 'producao'],
};

/** O dono acessa tudo; os demais, a lista escolhida ou o padrão do perfil. */
export function modulosEfetivos(perfil: Perfil, modulos: string[] | null | undefined): Modulo[] {
  if (perfil === 'dono') return [...MODULOS];
  const lista = modulos ?? MODULOS_PADRAO[perfil] ?? [];
  return MODULOS.filter((m) => lista.includes(m));
}

/** Módulo a que pertence cada endereço da API (null = comum a todos). */
export function moduloDaRota(url: string): Modulo | null {
  const p = url.split('?')[0];
  if (p.startsWith('/api/frota')) return 'frota';
  if (p.startsWith('/api/prod')) return 'producao';
  if (p.startsWith('/api/qual')) return 'qualidade';
  if (p.startsWith('/api/sup')) return 'suprimentos';
  if (p.startsWith('/api/fin')) return 'financeiro';
  if (p.startsWith('/api/ger')) return 'gerencial';
  if (p.startsWith('/api/adm')) return 'administrativo';
  if (p.startsWith('/api/usuarios')) return 'configuracoes';
  if (p.startsWith('/api/rel/frota')) return 'frota';
  if (p.startsWith('/api/rel/financeiro')) return 'financeiro';
  if (p.startsWith('/api/rel/administrativo')) return 'administrativo';
  if (p.startsWith('/api/rel/configuracoes')) return 'configuracoes';
  if (p.startsWith('/api/rel/')) return 'gerencial';
  return null;
}

/**
 * Consultas de cadastro usadas como listas em outros módulos (veículos, fornecedores, plano de contas…):
 * liberadas pelo perfil, mesmo sem o módulo de origem.
 */
const CONSULTAS = [
  /^\/api\/frota\/veiculos\/?$/,
  /^\/api\/frota\/motoristas\/?$/,
  /^\/api\/adm\/(fornecedores|clientes|credores)\/?$/,
  /^\/api\/fin\/(plano-contas|centros-custo|contas)\/?$/,
  /^\/api\/prod\/(insumos|tracos)\/?$/,
  /^\/api\/usuarios\/?$/,
];

/**
 * Decide o acesso: o perfil precisa estar entre os da rota e o módulo precisa estar liberado.
 * Módulo liberado além do padrão do perfil dá acesso completo a ele.
 */
export function acessoPermitido(o: { perfil: Perfil; modulos: string[] | null; perfisRota: Perfil[]; url: string; metodo: string }): boolean {
  const porPerfil = !o.perfisRota.length || o.perfisRota.includes(o.perfil);
  const modulo = moduloDaRota(o.url);
  if (!modulo || o.perfil === 'admin_sistema') return porPerfil;
  const efetivos = modulosEfetivos(o.perfil, o.modulos);
  const path = o.url.split('?')[0];
  const consulta = o.metodo === 'GET' && CONSULTAS.some((rx) => rx.test(path));
  if (!efetivos.includes(modulo)) return consulta && porPerfil;
  if (porPerfil) return true;
  // Módulo dado a mais pelo administrador: acesso completo (as aprovações têm regra própria).
  return !MODULOS_PADRAO[o.perfil].includes(modulo);
}

/** Lista de módulos gravada no usuário, com Configurações garantida para administradores. */
export function listaDoUsuario(perfil: Perfil, modulos: string[] | null | undefined, administrador: boolean): string[] | null {
  if (!administrador || perfil === 'dono') return modulos ?? null;
  const base = modulos ?? MODULOS_PADRAO[perfil] ?? [];
  return base.includes('configuracoes') ? (modulos ?? null) : [...base, 'configuracoes'];
}
