import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type Empresa, type Usuario } from './api';

type Sessao = {
  carregando: boolean;
  usuario: Usuario | null;
  empresa: Empresa | null;
  entrar: (email: string, senha: string) => Promise<void>;
  sair: () => Promise<void>;
  recarregar: () => Promise<void>;
};

const Contexto = createContext<Sessao | null>(null);

export function ProvedorSessao({ children }: { children: ReactNode }) {
  const [carregando, setCarregando] = useState(true);
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [empresa, setEmpresa] = useState<Empresa | null>(null);

  const recarregar = useCallback(async () => {
    try {
      const r = await api<{ usuario: Usuario; empresa: Empresa | null }>('/auth/eu');
      setUsuario(r.usuario);
      setEmpresa(r.empresa);
    } catch {
      setUsuario(null);
      setEmpresa(null);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    recarregar();
  }, [recarregar]);

  const entrar = useCallback(
    async (email: string, senha: string) => {
      await api('/auth/entrar', { corpo: { email, senha } });
      await recarregar();
    },
    [recarregar],
  );

  const sair = useCallback(async () => {
    await api('/auth/sair', { metodo: 'POST' }).catch(() => {});
    setUsuario(null);
    setEmpresa(null);
  }, []);

  return <Contexto.Provider value={{ carregando, usuario, empresa, entrar, sair, recarregar }}>{children}</Contexto.Provider>;
}

export function useSessao(): Sessao {
  const s = useContext(Contexto);
  if (!s) throw new Error('useSessao fora do ProvedorSessao');
  return s;
}
