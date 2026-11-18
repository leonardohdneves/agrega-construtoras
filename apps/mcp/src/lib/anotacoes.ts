// Anotações MCP (readOnlyHint/destructiveHint) derivadas do nome da ferramenta — mesma regra do servidor MCP do AIRO:
// prefixo de leitura ou nome exato; qualquer outro nome é tratado como escrita.

const PREFIXOS_LEITURA = [
  'listar_', 'buscar_', 'obter_', 'relatorio_', 'situacao_', 'resumo_', 'extrato_', 'indicadores_', 'historico_',
  'curva_', 'previa_', 'simular_', 'calcular_', 'verificar_', 'contar_', 'detalhar_',
];
const LEITURA_EXATA = new Set(['usuario_atual', 'saldos_contas']);
const PREFIXOS_DESTRUTIVOS = ['remover_', 'cancelar_', 'estornar_', 'excluir_', 'apagar_', 'revogar_', 'desvincular_'];

export interface Anotacoes {
  readOnlyHint: boolean;
  destructiveHint?: boolean;
}

export function anotacoesDaFerramenta(nome: string): Anotacoes {
  const n = nome.toLowerCase();
  if (LEITURA_EXATA.has(n) || PREFIXOS_LEITURA.some((p) => n.startsWith(p))) return { readOnlyHint: true };
  if (PREFIXOS_DESTRUTIVOS.some((p) => n.startsWith(p))) return { readOnlyHint: false, destructiveHint: true };
  return { readOnlyHint: false };
}
