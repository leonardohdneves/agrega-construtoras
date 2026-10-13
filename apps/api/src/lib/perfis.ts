// Regras de quem pode fazer o quê com os usuários da empresa.
import type { Perfil } from './token.ts';

/** Perfis que a construtora pode dar aos seus usuários. */
export const PERFIS_EMPRESA = ['dono', 'gestor', 'orcamentista', 'engenheiro_obra', 'comprador', 'financeiro', 'administrativo', 'vendedor'] as const satisfies readonly Perfil[];

export const NOMES_PERFIL: Record<Perfil, string> = {
  admin_sistema: 'Administrador do sistema',
  dono: 'Dono',
  gestor: 'Gestor',
  orcamentista: 'Orçamentista',
  engenheiro_obra: 'Engenheiro de obra',
  comprador: 'Comprador',
  motorista: 'Motorista',
  operador_usina: 'Operador de usina',
  laboratorista: 'Laboratorista',
  administrativo: 'Administrativo',
  vendedor: 'Comercial',
  financeiro: 'Financeiro',
};

/** Só o dono e o perfil Financeiro veem saldo bancário, contas a pagar e contas a receber. */
export const PERFIS_FINANCEIRO: Perfil[] = ['dono', 'financeiro'];
export function acessaFinanceiro(perfil: Perfil): boolean {
  return PERFIS_FINANCEIRO.includes(perfil);
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
