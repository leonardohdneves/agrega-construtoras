// Acesso às telas: o mesmo critério do servidor (perfil da tela + módulos liberados para o usuário).
import type { Modulo, Perfil, Usuario } from './api';

// Cópia do padrão do servidor (lib/modulos.ts), usada antes de a lista de usuários carregar e para abrir as telas.
// Ao mudar o padrão no servidor, mude aqui também (P14); a tela de usuários já usa o do servidor.
export const MODULOS_PADRAO: Record<Perfil, Modulo[]> = {
  admin_sistema: [],
  dono: ['engenharia', 'comercial', 'incorporacao', 'laudos', 'suprimentos', 'financeiro', 'gerencial', 'administrativo', 'configuracoes'],
  // Almoxarife: só Suprimentos › Estoque (entradas, etiquetas, saídas e funcionários).
  almoxarife: ['suprimentos'],
  // O gestor tem o módulo Financeiro, com saldos e contas, como o dono e o perfil Financeiro.
  gestor: ['engenharia', 'suprimentos', 'financeiro', 'gerencial', 'comercial', 'incorporacao', 'laudos', 'administrativo'],
  orcamentista: ['engenharia', 'comercial'],
  // Só as obras atribuídas a ele; administra também os contratos e as medições dessas obras.
  engenheiro_obra: ['engenharia'],
  // Só as obras atribuídas a ele, em consulta (canteiro e boletins).
  mestre_obra: ['engenharia'],
  comprador: ['suprimentos'],
  financeiro: ['financeiro', 'gerencial'],
  vendedor: ['comercial'],
  administrativo: ['administrativo', 'suprimentos'],
  // Perfis da concreteira: não são oferecidos na construtora.
  operador_usina: [],
  laboratorista: [],
  motorista: [],
};

/** Perfis que a construtora pode dar aos usuários, na ordem da tela de usuários. */
export const PERFIS_CONSTRUTORA = ['dono', 'gestor', 'orcamentista', 'engenheiro_obra', 'mestre_obra', 'comprador', 'financeiro', 'administrativo', 'vendedor', 'almoxarife'] as const;

/** Só o dono e o perfil Financeiro veem saldo bancário, contas a pagar e a receber. */
export const PERFIS_FINANCEIRO: Perfil[] = ['dono', 'gestor', 'financeiro'];
/** Perfis cujo acesso é definido só pelos módulos que têm. */
export const PERFIS_POR_MODULO: Perfil[] = ['financeiro', 'administrativo', 'vendedor', 'orcamentista', 'comprador'];

/** Módulo de cada tela, pelo endereço. */
export function moduloDaPagina(caminho: string): Modulo | null {
  if (caminho.startsWith('/eng')) return 'engenharia';
  if (caminho.startsWith('/com')) return 'comercial';
  if (caminho.startsWith('/laudos')) return 'laudos';
  if (caminho.startsWith('/frota') || caminho.startsWith('/abastecer')) return 'frota';
  if (caminho.startsWith('/prod') || caminho.startsWith('/minha-')) return 'producao';
  if (caminho.startsWith('/qual')) return 'qualidade';
  if (caminho.startsWith('/sup')) return 'suprimentos';
  if (caminho.startsWith('/fin')) return 'financeiro';
  if (caminho.startsWith('/ger')) return 'gerencial';
  if (caminho.startsWith('/adm')) return 'administrativo';
  if (caminho.startsWith('/empresa') || caminho.startsWith('/usuarios') || caminho.startsWith('/config')) return 'configuracoes';
  return null;
}

export function temModulo(usuario: Usuario | null, modulo: Modulo): boolean {
  return !!usuario && (usuario.modulosEfetivos ?? []).includes(modulo);
}

/** Pode abrir a tela? Módulo liberado além do padrão do perfil dá acesso a todas as telas dele. */
export function podeAcessar(usuario: Usuario | null, perfis: Perfil[] | undefined, caminho: string): boolean {
  if (!usuario) return false;
  if (usuario.perfil === 'almoxarife') return /^\/sup\/(estoque|pedidos|patrimonio)(\/|$)/.test(caminho) && temModulo(usuario, 'suprimentos');
  const porPerfil = !perfis || perfis.includes(usuario.perfil);
  const modulo = moduloDaPagina(caminho);
  if (!modulo || usuario.perfil === 'admin_sistema') return porPerfil;
  // Mestre de obra: só consulta a Engenharia das obras dele (o servidor confere a obra e barra as alterações).
  if (usuario.perfil === 'mestre_obra') return modulo === 'engenharia' && temModulo(usuario, 'engenharia');
  if (usuario.perfil === 'engenheiro_obra') {
    // Engenharia (as obras dele, conferidas no servidor) e os contratos e medições dessas obras.
    if (/^\/sup\/(contratos|medicoes|patrimonio)(\/|$)/.test(caminho)) return true;
    return modulo === 'engenharia' && temModulo(usuario, 'engenharia');
  }
  if (modulo === 'financeiro' && !PERFIS_FINANCEIRO.includes(usuario.perfil)) return false;
  // O fluxo de caixa mostra saldos: só dono e Financeiro.
  if (caminho.startsWith('/ger/fluxo') && !PERFIS_FINANCEIRO.includes(usuario.perfil)) return false;
  if (!temModulo(usuario, modulo)) return false;
  return porPerfil || PERFIS_POR_MODULO.includes(usuario.perfil) || !MODULOS_PADRAO[usuario.perfil].includes(modulo);
}
