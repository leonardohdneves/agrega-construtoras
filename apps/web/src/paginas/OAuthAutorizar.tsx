// Tela de autorização do servidor MCP (assistentes de IA como Claude e ChatGPT), no mesmo desenho do AIRO.
// O servidor MCP manda o usuário para cá; depois do login a tela volta para ele com um CÓDIGO de uso único
// (60 segundos) — nunca com o token de sessão, que só é entregue de servidor para servidor.
// Não cria sessão do Agrega neste navegador: o usuário está autorizando um aplicativo externo.
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Logo } from '../componentes/Logo';

/** Texto curto e sem quebras: o nome vem do cadastro que o próprio aplicativo fez. */
const limpar = (valor: string | null, max: number) => (valor ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function OAuthAutorizar() {
  const [params] = useSearchParams();
  const redirectUri = params.get('redirect_uri');
  const state = params.get('state');
  const originalRedirectUri = params.get('original_redirect_uri');
  const nomeCliente = limpar(params.get('client_name'), 60) || 'Um aplicativo conectado';
  const hostCliente = limpar(params.get('client_host'), 80);

  const [destinoOk, setDestinoOk] = useState<boolean | null>(null);
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!redirectUri) return setDestinoOk(false);
    api<{ permitido: boolean }>(`/auth/oauth-destino?redirect_uri=${encodeURIComponent(redirectUri)}`)
      .then((r) => setDestinoOk(r.permitido))
      .catch(() => setDestinoOk(false));
  }, [redirectUri]);

  /** Volta ao servidor MCP com o código (ou com o erro), repassando o `state` que ele mandou. */
  function voltar(campos: Record<string, string>) {
    const destino = new URL(redirectUri!);
    for (const [chave, valor] of Object.entries(campos)) destino.searchParams.set(chave, valor);
    if (state) destino.searchParams.set('state', state);
    if (originalRedirectUri) destino.searchParams.set('original_redirect_uri', originalRedirectUri);
    window.location.href = destino.toString();
  }

  async function aoEnviar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setEnviando(true);
    try {
      const r = await api<{ code: string }>('/auth/oauth-login', { corpo: { email, senha, redirectUri } });
      voltar({ code: r.code });
    } catch (err) {
      setErro((err as Error).message);
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
        {destinoOk === null ? (
          <div className="card form">
            <span className="muted">Conferindo o pedido…</span>
          </div>
        ) : !destinoOk ? (
          <div className="card form">
            <h1 style={{ fontSize: 22 }}>Pedido de conexão inválido</h1>
            <div className="alerta alerta-erro" role="alert">
              Este endereço não veio de um assistente autorizado. Comece a conexão de novo pelo aplicativo (Claude ou ChatGPT).
            </div>
          </div>
        ) : (
          <form className="card form" onSubmit={aoEnviar} noValidate>
            <h1 style={{ fontSize: 26 }}>Autorizar acesso</h1>
            <div className="alerta">
              <strong>{nomeCliente}</strong>
              {hostCliente && <span className="muted"> ({hostCliente})</span>} está pedindo acesso aos dados da sua construtora no Agrega. Ele verá e fará o que o seu
              usuário pode ver e fazer. Entre para autorizar.
            </div>
            {erro && (
              <div className="alerta alerta-erro" role="alert">
                {erro}
              </div>
            )}
            <div className="campo">
              <label htmlFor="oauth-email">E-mail</label>
              <input id="oauth-email" type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="campo">
              <label htmlFor="oauth-senha">Senha</label>
              <input id="oauth-senha" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
            </div>
            <button className="btn btn-primario btn-bloco" type="submit" disabled={enviando || !email || !senha}>
              {enviando ? 'Autorizando…' : 'Entrar e autorizar'}
            </button>
            <button className="btn btn-bloco" type="button" disabled={enviando} onClick={() => voltar({ error: 'access_denied' })}>
              Cancelar
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
