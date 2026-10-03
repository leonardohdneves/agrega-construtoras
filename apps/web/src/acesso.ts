// Acesso às telas: o mesmo critério do servidor (perfil da tela + módulos liberados para o usuário).
import type { Modulo, Perfil, Usuario } from './api';

export const MODULOS_PADRAO: Record<Perfil, Modulo[]> = {
  admin_sistema: [],
  dono: ['frota', 'producao', 'qualidade', 'suprimentos', 'financeiro', 'gerencial', 'administrativo', 'configuracoes'],
  gestor: ['frota', 'producao', 'qualidade', 'suprimentos', 'financeiro', 'gerencial', 'administrativo', 'configuracoes'],
  operador_usina: ['producao'],
  laboratorista: ['qualidade', 'producao'],
  motorista: ['frota', 'producao'],
};

/** Módulo de cada tela, pelo endereço. */
export function moduloDaPagina(caminho: string): Modulo | null {
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
  const porPerfil = !perfis || perfis.includes(usuario.perfil);
  const modulo = moduloDaPagina(caminho);
  if (!modulo || usuario.perfil === 'admin_sistema') return porPerfil;
  if (!temModulo(usuario, modulo)) return false;
  return porPerfil || !MODULOS_PADRAO[usuario.perfil].includes(modulo);
}
