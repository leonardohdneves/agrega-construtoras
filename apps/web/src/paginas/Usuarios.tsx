import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, formatarDataHora, NOMES_PERFIL, type Perfil, type Usuario } from '../api';
import { useSessao } from '../sessao';

type Novo = { nome: string; email: string; perfil: Exclude<Perfil, 'admin_sistema'>; senha: string; telefoneWhatsapp: string };
const VAZIO: Novo = { nome: '', email: '', perfil: 'motorista', senha: '', telefoneWhatsapp: '' };

function podeGerenciar(quem: Perfil, alvo: Perfil) {
  if (quem === 'dono') return alvo !== 'admin_sistema';
  if (quem === 'gestor') return alvo === 'motorista' || alvo === 'operador_usina' || alvo === 'laboratorista';
  return false;
}

export function Usuarios() {
  const { usuario: eu } = useSessao();
  const [lista, setLista] = useState<Usuario[] | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [novo, setNovo] = useState<Novo | null>(null);
  const [senhaDe, setSenhaDe] = useState<{ id: string; nome: string; senha: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await api<{ usuarios: Usuario[] }>('/usuarios');
      setLista(r.usuarios);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  if (!eu) return null;
  const perfisPermitidos = (['dono', 'gestor', 'operador_usina', 'laboratorista', 'motorista'] as const).filter((p) => podeGerenciar(eu.perfil, p));

  async function executar(acao: () => Promise<void>, mensagem: string) {
    setErro('');
    setAviso('');
    setOcupado(true);
    try {
      await acao();
      setAviso(mensagem);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function criar(ev: FormEvent) {
    ev.preventDefault();
    if (!novo) return;
    await executar(async () => {
      await api('/usuarios', { corpo: novo });
      setNovo(null);
    }, `${novo.nome} foi cadastrado. Passe o e-mail e a senha inicial para a pessoa.`);
  }

  async function definirSenha(ev: FormEvent) {
    ev.preventDefault();
    if (!senhaDe) return;
    await executar(async () => {
      await api(`/usuarios/${senhaDe.id}`, { metodo: 'PATCH', corpo: { senha: senhaDe.senha } });
      setSenhaDe(null);
    }, `Nova senha definida para ${senhaDe.nome}.`);
  }

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Usuários</h1>
          <span className="muted">Quem acessa o Agrega nesta empresa e com qual perfil.</span>
        </div>
        {!novo && (
          <button className="btn btn-primario" type="button" onClick={() => setNovo({ ...VAZIO, perfil: perfisPermitidos[perfisPermitidos.length - 1] })}>
            Novo usuário
          </button>
        )}
      </div>

      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}

      {novo && (
        <form className="card form" onSubmit={criar}>
          <h2>Novo usuário</h2>
          <div className="campos">
            <div className="campo">
              <label htmlFor="nu-nome">Nome</label>
              <input id="nu-nome" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="nu-email">E-mail (usado para entrar)</label>
              <input id="nu-email" type="email" value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="nu-perfil">Perfil</label>
              <select id="nu-perfil" value={novo.perfil} onChange={(e) => setNovo({ ...novo, perfil: e.target.value as Novo['perfil'] })}>
                {perfisPermitidos.map((p) => (
                  <option key={p} value={p}>
                    {NOMES_PERFIL[p]}
                  </option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="nu-whats">WhatsApp (opcional)</label>
              <input id="nu-whats" inputMode="tel" value={novo.telefoneWhatsapp} onChange={(e) => setNovo({ ...novo, telefoneWhatsapp: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="nu-senha">Senha inicial</label>
              <input id="nu-senha" type="text" autoComplete="new-password" value={novo.senha} onChange={(e) => setNovo({ ...novo, senha: e.target.value })} />
              <span className="ajuda">Mínimo de 8 caracteres. A pessoa pode trocar depois em Minha conta.</span>
            </div>
          </div>
          <div className="acoes">
            <button className="btn btn-primario" type="submit" disabled={ocupado}>
              Cadastrar
            </button>
            <button className="btn btn-secundario" type="button" onClick={() => setNovo(null)}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {senhaDe && (
        <form className="card form" onSubmit={definirSenha}>
          <h2>Nova senha para {senhaDe.nome}</h2>
          <div className="campo" style={{ maxWidth: 360 }}>
            <label htmlFor="ns-senha">Nova senha</label>
            <input id="ns-senha" type="text" autoComplete="new-password" value={senhaDe.senha} onChange={(e) => setSenhaDe({ ...senhaDe, senha: e.target.value })} />
            <span className="ajuda">Mínimo de 8 caracteres.</span>
          </div>
          <div className="acoes">
            <button className="btn btn-primario" type="submit" disabled={ocupado}>
              Definir senha
            </button>
            <button className="btn btn-secundario" type="button" onClick={() => setSenhaDe(null)}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="card tabela-caixa">
        {!lista ? (
          <p className="muted">Carregando…</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr>
                <th>Nome</th>
                <th>E-mail</th>
                <th>Perfil</th>
                <th>Último acesso</th>
                <th>Situação</th>
                <th>
                  <span style={{ position: 'absolute', left: -9999 }}>Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lista.map((u) => {
                const gerencia = podeGerenciar(eu.perfil, u.perfil) && u.id !== eu.id;
                return (
                  <tr key={u.id}>
                    <td>
                      {u.nome}
                      {u.id === eu.id && <span className="small muted"> (você)</span>}
                    </td>
                    <td className="small">{u.email}</td>
                    <td>
                      {gerencia && eu.perfil === 'dono' ? (
                        <select
                          aria-label={`Perfil de ${u.nome}`}
                          value={u.perfil}
                          disabled={ocupado}
                          onChange={(e) =>
                            executar(() => api(`/usuarios/${u.id}`, { metodo: 'PATCH', corpo: { perfil: e.target.value } }), `Perfil de ${u.nome} alterado.`)
                          }
                          style={{ height: 36, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface-card)', color: 'var(--ink)', padding: '0 8px' }}
                        >
                          {(['dono', 'gestor', 'operador_usina', 'laboratorista', 'motorista'] as const).map((p) => (
                            <option key={p} value={p}>
                              {NOMES_PERFIL[p]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        NOMES_PERFIL[u.perfil]
                      )}
                    </td>
                    <td className="small mono">{formatarDataHora(u.ultimoAcesso)}</td>
                    <td>
                      <span className={`selo ${u.ativo ? 'selo-ok' : 'selo-neutro'}`}>{u.ativo ? 'Ativo' : 'Desativado'}</span>
                    </td>
                    <td>
                      {gerencia && (
                        <div className="acoes" style={{ flexWrap: 'nowrap' }}>
                          <button className="btn btn-link" type="button" disabled={ocupado} onClick={() => setSenhaDe({ id: u.id, nome: u.nome, senha: '' })}>
                            Nova senha
                          </button>
                          <button
                            className="btn btn-link"
                            type="button"
                            disabled={ocupado}
                            onClick={() =>
                              executar(
                                () => api(`/usuarios/${u.id}`, { metodo: 'PATCH', corpo: { ativo: !u.ativo } }),
                                u.ativo ? `${u.nome} não acessa mais o sistema.` : `${u.nome} voltou a ter acesso.`,
                              )
                            }
                          >
                            {u.ativo ? 'Desativar' : 'Reativar'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
