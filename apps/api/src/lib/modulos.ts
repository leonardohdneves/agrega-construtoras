// Módulos do Agrega Construtoras e o acesso de cada usuário: o padrão do perfil ou a lista escolhida pelo administrador.
import type { Perfil } from './token.ts';
import { acessaFinanceiro } from './perfis.ts';

export const MODULOS = ['engenharia', 'comercial', 'suprimentos', 'financeiro', 'gerencial', 'administrativo', 'configuracoes'] as const;
export type Modulo = (typeof MODULOS)[number];

/**
 * Módulos da concreteira que não fazem parte da construtora. As rotas ainda existem no código, mas ninguém recebe
 * esses módulos: só as consultas de cadastro (listas) continuam respondendo.
 */
export const MODULOS_RETIRADOS = ['frota', 'producao', 'qualidade'] as const;
type ModuloRota = Modulo | (typeof MODULOS_RETIRADOS)[number];

export const NOMES_MODULO: Record<Modulo, string> = {
  engenharia: 'Engenharia',
  comercial: 'Comercial',
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
  // Saldos e contas são do dono e do perfil Financeiro: o gestor não tem o módulo Financeiro.
  gestor: ['engenharia', 'suprimentos', 'gerencial', 'comercial', 'administrativo'],
  orcamentista: ['engenharia', 'comercial'],
  // Só as obras atribuídas a ele; administra também os contratos e as medições dessas obras.
  engenheiro_obra: ['engenharia'],
  comprador: ['suprimentos'],
  financeiro: ['financeiro', 'gerencial'],
  vendedor: ['comercial'],
  administrativo: ['administrativo', 'suprimentos'],
  // Perfis da concreteira: não são oferecidos na construtora.
  operador_usina: [],
  laboratorista: [],
  motorista: [],
};

/** Perfis cujo acesso é definido só pelos módulos (todas as telas dos módulos que têm). */
export const PERFIS_POR_MODULO: Perfil[] = ['financeiro', 'administrativo', 'vendedor', 'orcamentista', 'comprador'];

/** O dono acessa tudo; os demais, a lista escolhida ou o padrão do perfil. */
export function modulosEfetivos(perfil: Perfil, modulos: string[] | null | undefined): Modulo[] {
  if (perfil === 'dono') return [...MODULOS];
  const lista = modulos ?? MODULOS_PADRAO[perfil] ?? [];
  return MODULOS.filter((m) => lista.includes(m));
}

/** Módulo a que pertence cada endereço da API (null = comum a todos). */
export function moduloDaRota(url: string): ModuloRota | null {
  const p = url.split('?')[0];
  if (p.startsWith('/api/eng')) return 'engenharia';
  if (p.startsWith('/api/com')) return 'comercial';
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

/** Contratos e medições que o engenheiro de obra administra (só das obras atribuídas a ele, conferido na rota). */
const CONTRATOS_DA_OBRA = [/^\/api\/sup\/(contratos|medicoes)(\/|$)/];
/** Listas que o engenheiro de obra usa para preencher contratos e medições. */
const CONSULTAS_ENGENHEIRO = [/^\/api\/fin\/(plano-contas|centros-custo)\/?$/];

/** Do Financeiro, liberado sem o módulo (para o painel e listas); a resposta esconde saldos e contas de quem não pode ver. */
const FINANCEIRO_PARCIAL = [/^\/api\/fin\/resumo\/?$/, /^\/api\/fin\/(contas|plano-contas|centros-custo)\/?$/];

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
  if (o.perfil === 'engenheiro_obra') {
    // Contratos e medições das obras dele (a rota confere a obra); listas de cadastro para preenchê-los.
    if (CONTRATOS_DA_OBRA.some((rx) => rx.test(path))) return true;
    if (consulta || (o.metodo === 'GET' && CONSULTAS_ENGENHEIRO.some((rx) => rx.test(path)))) return true;
    // Engenharia: a rota limita às obras atribuídas.
    if (modulo === 'engenharia' && efetivos.includes('engenharia')) return true;
  }
  // Financeiro: só dono e perfil Financeiro, mesmo que o módulo seja dado a outra pessoa.
  if (modulo === 'financeiro' && !acessaFinanceiro(o.perfil)) {
    const parcial = o.metodo === 'GET' && FINANCEIRO_PARCIAL.some((rx) => rx.test(path));
    return (consulta || parcial) && (porPerfil || PERFIS_POR_MODULO.includes(o.perfil));
  }
  if (!(efetivos as string[]).includes(modulo)) return consulta && (porPerfil || PERFIS_POR_MODULO.includes(o.perfil));
  if (porPerfil) return true;
  if (PERFIS_POR_MODULO.includes(o.perfil)) return true;
  // Módulo dado a mais pelo administrador: acesso completo (as aprovações têm regra própria).
  return !(MODULOS_PADRAO[o.perfil] as string[]).includes(modulo);
}

/** Lista de módulos gravada no usuário, com Configurações garantida para administradores. */
export function listaDoUsuario(perfil: Perfil, modulos: string[] | null | undefined, administrador: boolean): string[] | null {
  if (!administrador || perfil === 'dono') return modulos ?? null;
  const base = modulos ?? MODULOS_PADRAO[perfil] ?? [];
  return base.includes('configuracoes') ? (modulos ?? null) : [...base, 'configuracoes'];
}
