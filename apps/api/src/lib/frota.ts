// Regras de vencimento de documentos e CNH, e formatos da frota.

export const DIAS_AVISO = 30;

export type SituacaoVencimento = 'vencido' | 'vencendo' | 'em_dia' | 'sem_data';

/** Data de hoje no fuso de Brasília, como 'AAAA-MM-DD'. */
export function hojeBrasil(agora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}

/** Dias corridos de `de` até `ate` (datas 'AAAA-MM-DD'). Negativo se `ate` já passou. */
export function diasEntre(de: string, ate: string): number {
  const a = Date.UTC(+de.slice(0, 4), +de.slice(5, 7) - 1, +de.slice(8, 10));
  const b = Date.UTC(+ate.slice(0, 4), +ate.slice(5, 7) - 1, +ate.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

export function situacaoVencimento(vencimento: string | null | undefined, hoje: string, aviso = DIAS_AVISO): { situacao: SituacaoVencimento; dias: number | null } {
  if (!vencimento) return { situacao: 'sem_data', dias: null };
  const dias = diasEntre(hoje, vencimento);
  if (dias < 0) return { situacao: 'vencido', dias };
  if (dias <= aviso) return { situacao: 'vencendo', dias };
  return { situacao: 'em_dia', dias };
}

/** Placa no padrão antigo (ABC1234) ou Mercosul (ABC1D23). Devolve em maiúsculas, sem hífen, ou null se inválida. */
export function normalizarPlaca(valor: string): string | null {
  const p = (valor ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(p) ? p : null;
}

export function formatarPlaca(p: string | null): string {
  if (!p) return '';
  return /^[A-Z]{3}[0-9]{4}$/.test(p) ? `${p.slice(0, 3)}-${p.slice(3)}` : p;
}

export function cpfValido(valor: string): boolean {
  const c = (valor ?? '').replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  for (const n of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(c[i]) * (n + 1 - i);
    const d = ((soma * 10) % 11) % 10;
    if (d !== Number(c[n])) return false;
  }
  return true;
}

export const NOMES_TIPO_VEICULO = {
  betoneira: 'Betoneira',
  bomba_lanca: 'Bomba lança',
  bomba_estacionaria: 'Bomba estacionária',
  apoio: 'Apoio',
  pa_carregadeira: 'Pá-carregadeira',
} as const;

export const NOMES_TIPO_DOCUMENTO = {
  crlv: 'CRLV',
  licenciamento: 'Licenciamento',
  seguro: 'Seguro',
  ipva: 'IPVA',
  tacografo: 'Aferição do tacógrafo',
  outro: 'Outro',
} as const;
