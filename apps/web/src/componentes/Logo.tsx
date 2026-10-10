export const COR_CONCRETEIRA = '#E8590C';
export const COR_CONSTRUTORA = '#1F5FAD';

export function Simbolo({ tamanho = 28, escuro = false, cor = COR_CONCRETEIRA }: { tamanho?: number; escuro?: boolean; cor?: string }) {
  const pedra = escuro ? '#FFFFFF' : 'var(--ink)';
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="22" cy="40" r="14" fill={cor} />
      <circle cx="45" cy="45" r="10" fill={pedra} />
      <circle cx="38" cy="20" r="9" fill={pedra} />
      <circle cx="54" cy="25" r="5" fill={cor} />
    </svg>
  );
}

export function Logo({ tamanho = 28, escuro = false }: { tamanho?: number; escuro?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <Simbolo tamanho={tamanho} escuro={escuro} />
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: Math.round(tamanho * 0.8),
          letterSpacing: '-0.03em',
          color: escuro ? '#FFFFFF' : 'var(--ink)',
        }}
      >
        agrega
      </span>
    </span>
  );
}
