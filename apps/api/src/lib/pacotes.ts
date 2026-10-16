// Pacotes vendidos do Agrega Construtoras. Cada contrato guarda os módulos liberados e os limites da empresa;
// o administrador do sistema pode ajustar qualquer um deles depois da venda.
import type { Modulo } from './modulos.ts';

export const PACOTES_CONTRATO = ['obra', 'obra_gestao', 'completo', 'personalizado'] as const;
export type PacoteContrato = (typeof PACOTES_CONTRATO)[number];

export const NOMES_PACOTE: Record<PacoteContrato, string> = {
  obra: 'Obra',
  obra_gestao: 'Obra + Gestão',
  completo: 'Completo',
  personalizado: 'Personalizado',
};

type Predefinido = { modulos: Modulo[]; limiteObras: number | null; limiteUsuarios: number | null };

/** Módulos e limites de cada pacote. Personalizado não tem predefinição: o administrador escolhe tudo. */
export const PACOTES: Record<Exclude<PacoteContrato, 'personalizado'>, Predefinido> = {
  obra: { modulos: ['engenharia', 'suprimentos'], limiteObras: 3, limiteUsuarios: 3 },
  obra_gestao: { modulos: ['engenharia', 'suprimentos', 'financeiro', 'gerencial', 'administrativo'], limiteObras: 3, limiteUsuarios: 5 },
  completo: {
    modulos: ['engenharia', 'comercial', 'suprimentos', 'financeiro', 'gerencial', 'administrativo'],
    limiteObras: 10,
    limiteUsuarios: 8,
  },
};

/** Módulos que o contrato sempre inclui, mesmo fora do pacote. */
export const MODULOS_SEMPRE_INCLUIDOS: Modulo[] = ['configuracoes'];
