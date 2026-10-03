import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, formatarDataHora, MODULOS, NOMES_MODULO, NOMES_PERFIL, type Modulo, type Perfil, type Usuario } from '../api';
import { MODULOS_PADRAO } from '../acesso';
import { useSessao } from '../sessao';

type PerfilEmpresa = Exclude<Perfil, 'admin_sistema'>;
const PERFIS: PerfilEmpresa[] = ['dono', 'gestor', 'operador_usina', 'laboratorista', 'motorista'];

type Acesso = { perfil: PerfilEmpresa; administrador: boolean; padrao: boolean; modulos: Modulo[] };
type Novo = { nome: string; email: string; senha: string; telefoneWhatsapp: string } & Acesso;
const VAZIO: Novo = { nome: '', email: '', senha: '', telefoneWhatsapp: '', perfil: 'motorista', administrador: false, padrao: true, modulos: MODULOS_PADRAO.motorista };

/** Quem não é dono cuida de todos, menos dos donos. */
function podeGerenciar(eu: Usuario, alvo: Perfil) {
  if (!eu.administrador || alvo === 'admin_sistema') return false;
  return eu.perfil === 'dono' || alvo !== 'dono';
}

const DESCRICAO_MODULO: Record<Modulo, string> = {
  frota: 'Veículos, abastecimento, manutenção e OS',
  producao: 'Cargas, traços, estoque, produção e escala',
  qualidade: 'Corpos de prova, resultados, laudos e ensaios',
  suprimentos: 'Compras, cotações, pedidos e contratos',
  financeiro: 'Contas, lançamentos, notas e bancos',
  gerencial: 'DRE, fluxo de caixa, custo por veículo e indicadores',
  administrativo: 'Clientes, fornecedores e colaboradores',
  configuracoes: 'Empresa, usuários e relatórios de uso',
};

/** Perfil, administrador e módulos: o padrão do perfil vem marcado e pode ser mudado. */
function EditorAcesso({ valor, aoMudar, eu }: { valor: Acesso; aoMudar: (a: Acesso) => void; eu: Usuario }) {
  const perfis = PERFIS.filter((p) => podeGerenciar(eu, p));
  const dono = valor.perfil === 'dono';
  return (
    <>
      <div className="campos">
        <div className="campo">
          <label htmlFor="ac-perfil">Perfil</label>
          <select
            id="ac-perfil"
            value={valor.perfil}
            onChange={(e) => {
              const p = e.target.value as PerfilEmpresa;
              aoMudar({ ...valor, perfil: p, padrao: true, modulos: MODULOS_PADRAO[p], administrador: p === 'dono' ? true : valor.administrador });
            }}
          >
            {perfis.map((p) => (
              <option key={p} value={p}>{NOMES_PERFIL[p]}</option>
            ))}
          </select>
        </div>
      </div>
      <label className="marcar">
        <input type="checkbox" checked={dono || valor.administrador} disabled={dono} onChange={(e) => aoMudar({ ...valor, administrador: e.target.checked })} />
        Administrador: cadastra usuários e define os acessos{dono ? ' (o dono é sempre administrador)' : ''}
      </label>
      <fieldset className="card" style={{ margin: 0, padding: 14 }}>
        <legend className="small" style={{ fontWeight: 600 }}>Módulos que acessa</legend>
        {dono ? (
          <p className="small muted" style={{ margin: 0 }}>O dono acessa todos os módulos.</p>
        ) : (
          <>
            <label className="marcar" style={{ marginTop: 0 }}>
              <input type="checkbox" checked={valor.padrao} onChange={(e) => aoMudar({ ...valor, padrao: e.target.checked, modulos: e.target.checked ? MODULOS_PADRAO[valor.perfil] : valor.modulos })} />
              Usar o padrão do perfil {NOMES_PERFIL[valor.perfil]}
            </label>
            <div className="grupo-marcar" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
              {MODULOS.map((m) => {
                const marcado = valor.modulos.includes(m) || (m === 'configuracoes' && valor.administrador);
                const extra = !MODULOS_PADRAO[valor.perfil].includes(m);
                return (
                  <label key={m} className="marcar" style={{ alignItems: 'flex-start', margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={marcado}
                      disabled={valor.padrao || (m === 'configuracoes' && valor.administrador)}
                      onChange={(e) => aoMudar({ ...valor, modulos: e.target.checked ? [...valor.modulos, m] : valor.modulos.filter((x) => x !== m) })}
                    />
                    <span>
                      <b>{NOMES_MODULO[m]}</b>
                      {marcado && extra && !valor.padrao && <span className="selo selo-aviso" style={{ marginLeft: 6 }}>fora do padrão</span>}
                      <span className="small muted" style={{ display: 'block' }}>{DESCRICAO_MODULO[m]}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="small muted" style={{ marginBottom: 0 }}>
              Módulo fora do padrão do perfil dá acesso completo a ele. Aprovações seguem as regras de cada módulo. Administradores sempre acessam Configurações.
            </p>
          </>
        )}
      </fieldset>
    </>
  );
}

function deUsuario(u: Usuario): Acesso {
  const perfil = u.perfil as PerfilEmpresa;
  return { perfil, administrador: u.administrador, padrao: u.modulos === null, modulos: u.modulos ?? MODULOS_PADRAO[perfil] };
}

const corpoAcesso = (a: Acesso) => ({ perfil: a.perfil, administrador: a.perfil === 'dono' || a.administrador, modulos: a.padrao || a.perfil === 'dono' ? null : a.modulos });

export function Usuarios() {
  const { usuario: eu } = useSessao();
  const [lista, setLista] = useState<Usuario[] | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [novo, setNovo] = useState<Novo | null>(null);
  const [acesso, setAcesso] = useState<{ id: string; nome: string; a: Acesso } | null>(null);
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
  const admin = eu.administrador;

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
    if (!novo.padrao && novo.perfil !== 'dono' && novo.modulos.length === 0) return setErro('Marque pelo menos um módulo.');
    await executar(async () => {
      await api('/usuarios', { corpo: { nome: novo.nome, email: novo.email, senha: novo.senha, telefoneWhatsapp: novo.telefoneWhatsapp, ...corpoAcesso(novo) } });
      setNovo(null);
    }, `${novo.nome} foi cadastrado. Passe o e-mail e a senha inicial para a pessoa.`);
  }

  async function salvarAcesso(ev: FormEvent) {
    ev.preventDefault();
    if (!acesso) return;
    if (!acesso.a.padrao && acesso.a.perfil !== 'dono' && acesso.a.modulos.length === 0) return setErro('Marque pelo menos um módulo.');
    await executar(async () => {
      await api(`/usuarios/${acesso.id}`, { metodo: 'PATCH', corpo: corpoAcesso(acesso.a) });
      setAcesso(null);
    }, `Acesso de ${acesso.nome} atualizado. Vale a partir da próxima tela que a pessoa abrir.`);
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
          <h1>Usuários e acessos</h1>
          <span className="muted">Quem acessa o Agrega, com qual perfil e em quais módulos.</span>
        </div>
        {admin && !novo && (
          <button className="btn btn-primario" type="button" onClick={() => setNovo(VAZIO)}>
            Novo usuário
          </button>
        )}
      </div>

      {!admin && <div className="alerta alerta-info">Só administradores cadastram usuários e mudam os acessos. Fale com o dono da empresa.</div>}
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
              <label htmlFor="nu-whats">WhatsApp (opcional)</label>
              <input id="nu-whats" inputMode="tel" value={novo.telefoneWhatsapp} onChange={(e) => setNovo({ ...novo, telefoneWhatsapp: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="nu-senha">Senha inicial</label>
              <input id="nu-senha" type="text" autoComplete="new-password" value={novo.senha} onChange={(e) => setNovo({ ...novo, senha: e.target.value })} />
              <span className="ajuda">Mínimo de 8 caracteres. A pessoa pode trocar depois em Minha conta.</span>
            </div>
          </div>
          <EditorAcesso eu={eu} valor={novo} aoMudar={(a) => setNovo({ ...novo, ...a })} />
          <div className="acoes">
            <button className="btn btn-primario" type="submit" disabled={ocupado}>Cadastrar</button>
            <button className="btn btn-secundario" type="button" onClick={() => setNovo(null)}>Cancelar</button>
          </div>
        </form>
      )}

      {acesso && (
        <form className="card form" onSubmit={salvarAcesso}>
          <h2>Acesso de {acesso.nome}</h2>
          <EditorAcesso eu={eu} valor={acesso.a} aoMudar={(a) => setAcesso({ ...acesso, a })} />
          <div className="acoes">
            <button className="btn btn-primario" type="submit" disabled={ocupado}>Salvar acesso</button>
            <button className="btn btn-secundario" type="button" onClick={() => setAcesso(null)}>Cancelar</button>
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
            <button className="btn btn-primario" type="submit" disabled={ocupado}>Definir senha</button>
            <button className="btn btn-secundario" type="button" onClick={() => setSenhaDe(null)}>Cancelar</button>
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
                <th>Perfil</th>
                <th>Módulos</th>
                <th>Último acesso</th>
                <th>Situação</th>
                <th>
                  <span style={{ position: 'absolute', left: -9999 }}>Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lista.map((u) => {
                const gerencia = podeGerenciar(eu, u.perfil) && u.id !== eu.id;
                return (
                  <tr key={u.id}>
                    <td>
                      {u.nome}
                      {u.id === eu.id && <span className="small muted"> (você)</span>}
                      <div className="small muted">{u.email}</div>
                    </td>
                    <td>
                      {NOMES_PERFIL[u.perfil]}
                      {u.administrador && <div><span className="selo selo-neutro">administrador</span></div>}
                    </td>
                    <td className="small">
                      {u.perfil === 'dono' ? 'Todos' : u.modulosEfetivos.map((m) => NOMES_MODULO[m]).join(', ')}
                      {u.modulos !== null && u.perfil !== 'dono' && <div><span className="selo selo-aviso">fora do padrão</span></div>}
                    </td>
                    <td className="small mono">{formatarDataHora(u.ultimoAcesso)}</td>
                    <td>
                      <span className={`selo ${u.ativo ? 'selo-ok' : 'selo-neutro'}`}>{u.ativo ? 'Ativo' : 'Desativado'}</span>
                    </td>
                    <td>
                      {gerencia && (
                        <div className="acoes" style={{ flexWrap: 'nowrap' }}>
                          <button className="btn btn-link" type="button" disabled={ocupado} onClick={() => { setNovo(null); setAcesso({ id: u.id, nome: u.nome, a: deUsuario(u) }); }}>
                            Acesso
                          </button>
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
