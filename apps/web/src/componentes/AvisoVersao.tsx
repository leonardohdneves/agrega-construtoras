// Aviso de versão nova: aparece quando o servidor já tem um build mais novo do que a tela aberta.
import { useEffect, useState } from 'react';

async function atualizar() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      // Baixa o service worker novo e espera ele assumir a página (no máximo 5 s) antes de recarregar.
      const assumiu = new Promise<void>((ok) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => ok(), { once: true });
        setTimeout(ok, 5000);
      });
      await reg.update();
      if (reg.installing || reg.waiting) await assumiu;
    }
  } catch {
    // sem service worker: basta recarregar
  }
  location.reload();
}

export function AvisoVersao() {
  const [nova, setNova] = useState(false);
  const [atualizando, setAtualizando] = useState(false);
  useEffect(() => {
    const ouvir = () => setNova(true);
    window.addEventListener('agrega:nova-versao', ouvir);
    return () => window.removeEventListener('agrega:nova-versao', ouvir);
  }, []);
  if (!nova) return null;
  return (
    <div
      role="status"
      className="nao-imprimir"
      style={{
        position: 'fixed', left: 16, right: 16, bottom: 16, zIndex: 1000, maxWidth: 560, margin: '0 auto',
        display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap',
        background: 'var(--surface-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px',
        boxShadow: '0 6px 24px rgba(0,0,0,.18)',
      }}
    >
      <span>Há uma versão nova do Agrega. Atualize para usar as últimas mudanças.</span>
      <button className="btn btn-primario" type="button" disabled={atualizando} onClick={() => { setAtualizando(true); atualizar(); }}>
        {atualizando ? 'Atualizando…' : 'Atualizar agora'}
      </button>
    </div>
  );
}
