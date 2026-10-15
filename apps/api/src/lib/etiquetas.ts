// Etiqueta (QR) de cada entrada de nota: o código identifica o lançamento de estoque que o almoxarife lê na saída.
export const PREFIXO_ETIQUETA = 'AGREGA-ETQ:';

export function chaveEtiqueta(id: string): string {
  return `${PREFIXO_ETIQUETA}${id}`;
}

/** Id da etiqueta a partir do texto lido (aceita o código completo ou só o id). */
export function idDaEtiqueta(texto: string): string | null {
  const m = texto.trim().match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0].toLowerCase() : null;
}
