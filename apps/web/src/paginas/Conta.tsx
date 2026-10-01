import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, NOMES_PERFIL } from '../api';
import { useSessao } from '../sessao';

export function Conta() {
  const { usuario, sair } = useSessao();
  const navegar = useNavigate();
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');
  const [salvando, setSalvando] = useState(false);
  if (!usuario) return null;

  async function trocar(ev: FormEvent) {
    ev.preventDefault();
    setErro('');
    setOk('');
    setSalvando(true);
    try {
      await api('/auth/senha', { metodo: 'PUT', corpo: { senhaAtual: atual, novaSenha: nova } });
      setAtual('');
      setNova('');
      setOk('Senha alterada.');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Minha conta</h1>
          <span className="muted">
            {usuario.nome} · {usuario.email} · {NOMES_PERFIL[usuario.perfil]}
          </span>
        </div>
      </div>
      <form className="card form" onSubmit={trocar} style={{ maxWidth: 520 }}>
        <h2>Trocar senha</h2>
        {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
        {ok && <div className="alerta alerta-ok" role="status">{ok}</div>}
        <div className="campo">
          <label htmlFor="conta-atual">Senha atual</label>
          <input id="conta-atual" type="password" autoComplete="current-password" value={atual} onChange={(e) => setAtual(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="conta-nova">Nova senha</label>
          <input id="conta-nova" type="password" autoComplete="new-password" value={nova} onChange={(e) => setNova(e.target.value)} />
          <span className="ajuda">Mínimo de 8 caracteres.</span>
        </div>
        <div className="acoes">
          <button className="btn btn-primario" type="submit" disabled={salvando || !atual || !nova}>
            {salvando ? 'Salvando…' : 'Trocar senha'}
          </button>
        </div>
      </form>
      <div>
        <button
          className="btn btn-secundario"
          type="button"
          onClick={async () => {
            await sair();
            navegar('/entrar');
          }}
        >
          Sair do Agrega
        </button>
      </div>
    </>
  );
}
