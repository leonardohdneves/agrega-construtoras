// Tela de entrada: ao abrir o app na raiz, pergunta se é concreteira ou construtora antes do login.
// A escolha vale para a sessão do navegador (sessionStorage); se a memória do navegador não estiver disponível, a tela aparece de novo.
import { useState, type ReactNode } from 'react';
import { COR_CONCRETEIRA, COR_CONSTRUTORA, Simbolo } from './Logo';

export type TipoEmpresa = 'concreteira' | 'construtora';
const CHAVE = 'agrega.tipo';

function lerEscolha(): TipoEmpresa | null {
  try {
    const v = sessionStorage.getItem(CHAVE);
    return v === 'concreteira' || v === 'construtora' ? v : null;
  } catch {
    return null;
  }
}

function guardarEscolha(t: TipoEmpresa) {
  try {
    sessionStorage.setItem(CHAVE, t);
  } catch {
    /* sem armazenamento: a escolha vale só para esta abertura */
  }
}

export function PortaEntrada({ children }: { children: ReactNode }) {
  const [escolhido, setEscolhido] = useState<TipoEmpresa | null>(() => lerEscolha());
  const naRaiz = window.location.pathname === '/';
  if (escolhido || !naRaiz) return <>{children}</>;

  function escolher(t: TipoEmpresa) {
    guardarEscolha(t);
    // A construtora entra direto em Obras; o roteador só lê o endereço ao montar, então ajusta antes.
    if (t === 'construtora') window.history.replaceState(null, '', '/eng/obras');
    setEscolhido(t);
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
        <BotaoTipo cor={COR_CONCRETEIRA} rotulo="CONCRETEIRA" aoClicar={() => escolher('concreteira')} />
        <BotaoTipo cor={COR_CONSTRUTORA} rotulo="CONSTRUTORA" aoClicar={() => escolher('construtora')} />
      </div>
    </div>
  );
}

function BotaoTipo({ cor, rotulo, aoClicar }: { cor: string; rotulo: string; aoClicar: () => void }) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      style={{
        width: 240,
        padding: '28px 20px',
        display: 'grid',
        justifyItems: 'center',
        gap: 14,
        cursor: 'pointer',
        background: 'transparent',
        color: 'var(--ink)',
        border: '1px solid var(--ink)',
        borderRadius: 16,
        font: 'inherit',
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <Simbolo tamanho={44} cor={cor} />
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 35, letterSpacing: '-0.03em' }}>agrega</span>
      </span>
      <span style={{ fontWeight: 700, letterSpacing: '0.12em', color: cor }}>{rotulo}</span>
    </button>
  );
}
