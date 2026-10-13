import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useSessao } from '../sessao';
import { Logo } from '../componentes/Logo';

export function Entrar() {
  const { usuario, entrar } = useSessao();
  const navegar = useNavigate();
  const local = useLocation();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  if (usuario) return <Navigate to="/" replace />;

  async function aoEnviar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setEnviando(true);
    try {
      await entrar(email, senha);
      const destino = (local.state as { de?: string } | null)?.de ?? '/';
      navegar(destino, { replace: true });
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="tela-entrar">
      <div className="caixa">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Logo tamanho={36} />
          <span className="muted">ERP para construtoras</span>
        </div>
        <form className="card form" onSubmit={aoEnviar} noValidate>
          <h1 style={{ fontSize: 26 }}>Entrar</h1>
          {erro && (
            <div className="alerta alerta-erro" role="alert">
              {erro}
            </div>
          )}
          <div className="campo">
            <label htmlFor="entrar-email">E-mail</label>
            <input id="entrar-email" type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="campo">
            <label htmlFor="entrar-senha">Senha</label>
            <input id="entrar-senha" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
          </div>
          <button className="btn btn-primario btn-bloco" type="submit" disabled={enviando || !email || !senha}>
            {enviando ? 'Entrando…' : 'Entrar'}
          </button>
          <span className="small muted">Esqueceu a senha? Peça ao dono da empresa para definir uma nova em Usuários.</span>
        </form>
      </div>
    </div>
  );
}
