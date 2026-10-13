// Agrega para Construtoras: o produto é fixo. Não há mais a tela que perguntava concreteira ou construtora;
// as funções continuam com o mesmo nome para o restante do app (menu, painel) seguir a identidade da construtora.
import type { ReactNode } from 'react';

export type TipoEmpresa = 'construtora';

export function lerEscolha(): TipoEmpresa {
  return 'construtora';
}

/** Aplica a identidade visual da construtora (azul). */
export function aplicarTipo(t: TipoEmpresa) {
  document.documentElement.dataset.tipo = t;
}
aplicarTipo('construtora');

export function PortaEntrada({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
