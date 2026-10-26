// Modo de uso do mesmo app: "campo" (telas da obra) ou "erp" (sistema completo).
// A escolha do usuário neste aparelho vence; sem escolha, a sugestão vem da tela e do toque.
// Só afeta a tela inicial: as permissões continuam as do perfil.
export type Modo = 'campo' | 'erp';

/** Perfis que têm telas de campo. Os demais seguem sempre para o ERP. */
export const PERFIS_CAMPO = ['dono', 'gestor', 'almoxarife', 'engenheiro_obra'] as const;

const CHAVE = 'agrega-modo';

function lerEscolha(): Modo | null {
  try {
    const v = localStorage.getItem(CHAVE);
    return v === 'campo' || v === 'erp' ? v : null;
  } catch {
    return null;
  }
}

function sugestao(): Modo {
  try {
    const telaPequena = window.matchMedia('(max-width: 720px)').matches;
    const toque = window.matchMedia('(pointer: coarse)').matches;
    return telaPequena && toque ? 'campo' : 'erp';
  } catch {
    return 'erp';
  }
}

export function modoAtual(): Modo {
  return lerEscolha() ?? sugestao();
}

export function salvarModo(m: Modo): void {
  try {
    localStorage.setItem(CHAVE, m);
  } catch {
    // Sem armazenamento (navegação privada), a escolha vale só nesta sessão.
  }
}
