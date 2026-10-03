// Regras de quem pode fazer o quê com os usuários da empresa.
import type { Perfil } from './token.ts';

export const PERFIS_EMPRESA: Perfil[] = ['dono', 'gestor', 'operador_usina', 'laboratorista', 'motorista'];

export const NOMES_PERFIL: Record<Perfil, string> = {
  admin_sistema: 'Administrador do sistema',
  dono: 'Dono',
  gestor: 'Gestor',
  motorista: 'Motorista',
  operador_usina: 'Operador de usina',
  laboratorista: 'Laboratorista',
};

/** Perfis com acesso ao módulo Financeiro. */
export function acessaFinanceiro(perfil: Perfil): boolean {
  return perfil === 'dono' || perfil === 'gestor';
}

/** Um administrador pode criar ou alterar um usuário com o perfil `alvo`? (quem chama já é administrador) */
export function podeGerenciarPerfil(quem: Perfil, alvo: Perfil): boolean {
  if (alvo === 'admin_sistema') return false;
  if (quem === 'dono') return true;
  // Os demais administradores cuidam de todos, menos dos donos.
  return alvo !== 'dono';
}

/** Pode alterar os dados cadastrais e fiscais da empresa? */
export function podeEditarEmpresa(perfil: Perfil): boolean {
  return perfil === 'dono';
}
