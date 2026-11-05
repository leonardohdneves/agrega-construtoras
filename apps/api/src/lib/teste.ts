// Período de teste da construtora: enquanto vigente, valem os limites do teste (1 obra e 3 usuários).
// Terminado o teste, valem os limites do contrato.

export const LIMITES_TESTE = { obras: 1, usuarios: 3 } as const;

/** Expressão SQL: o teste está vigente hoje (data de Brasília entre início e fim). */
export const SQL_EM_TESTE = `(teste_inicio IS NOT NULL AND teste_fim IS NOT NULL AND (now() AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN teste_inicio AND teste_fim)`;

export function limitesVigentes(e: { limite_obras: number | null; limite_usuarios: number | null; em_teste: boolean }) {
  if (e.em_teste) return { obras: LIMITES_TESTE.obras, usuarios: LIMITES_TESTE.usuarios, emTeste: true };
  return { obras: e.limite_obras, usuarios: e.limite_usuarios, emTeste: false };
}
