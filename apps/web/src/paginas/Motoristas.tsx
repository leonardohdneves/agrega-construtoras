import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, formatarData, NOMES_FUNCAO, seloVencimento, type Motorista, type Usuario } from '../api';

type Dados = {
  id?: string;
  nome: string;
  telefone: string;
  cpf: string;
  funcao: Motorista['funcao'];
  cnhNumero: string;
  cnhCategoria: string;
  cnhVencimento: string;
  cursos: string;
  usuarioId: string;
};

const VAZIO: Dados = { nome: '', telefone: '', cpf: '', funcao: 'motorista', cnhNumero: '', cnhCategoria: 'E', cnhVencimento: '', cursos: '', usuarioId: '' };

function paraDados(m: Motorista): Dados {
  return {
    id: m.id,
    nome: m.nome,
    telefone: m.telefone ?? '',
    cpf: m.cpf ?? '',
    funcao: m.funcao,
    cnhNumero: m.cnhNumero ?? '',
    cnhCategoria: m.cnhCategoria ?? '',
    cnhVencimento: m.cnhVencimento ?? '',
    cursos: m.cursos.join(', '),
    usuarioId: m.usuarioId ?? '',
  };
}

export function Motoristas() {
  const [lista, setLista] = useState<Motorista[] | null>(null);
  const [logins, setLogins] = useState<Usuario[]>([]);
  const [form, setForm] = useState<Dados | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [mostrarInativos, setMostrarInativos] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [m, u] = await Promise.all([api<{ motoristas: Motorista[] }>('/frota/motoristas'), api<{ usuarios: Usuario[] }>('/usuarios')]);
      setLista(m.motoristas);
      setLogins(u.usuarios.filter((x) => x.perfil === 'motorista' && x.ativo));
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setErro('');
    setAviso('');
    setOcupado(true);
    try {
      const corpo = {
        nome: form.nome,
        telefone: form.telefone,
        cpf: form.cpf,
        funcao: form.funcao,
        cnhNumero: form.cnhNumero,
        cnhCategoria: form.cnhCategoria,
        cnhVencimento: form.cnhVencimento,
        cursos: form.cursos.split(',').map((c) => c.trim()).filter(Boolean),
      };
      let id = form.id;
      if (id) await api(`/frota/motoristas/${id}`, { metodo: 'PATCH', corpo });
      else id = (await api<{ motorista: Motorista }>('/frota/motoristas', { corpo })).motorista.id;
      const atual = lista?.find((m) => m.id === id)?.usuarioId ?? '';
      if (form.usuarioId !== atual) {
        await api(`/frota/motoristas/${id}`, { metodo: 'PATCH', corpo: { usuarioId: form.usuarioId || null } });
      }
      setAviso(form.id ? `${form.nome} atualizado.` : `${form.nome} cadastrado.`);
      setForm(null);
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function alternarAtivo(m: Motorista) {
    setErro('');
    setAviso('');
    setOcupado(true);
    try {
      await api(`/frota/motoristas/${m.id}`, { metodo: 'PATCH', corpo: { ativo: !m.ativo } });
      setAviso(m.ativo ? `${m.nome} foi desativado.` : `${m.nome} voltou a ficar ativo.`);
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const loginsLivres = logins.filter((u) => !lista?.some((m) => m.usuarioId === u.id && m.id !== form?.id));
  const visiveis = (lista ?? []).filter((m) => mostrarInativos || m.ativo);
  const inativos = (lista ?? []).filter((m) => !m.ativo).length;

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Motoristas</h1>
          <span className="muted">Motoristas e operadores de bomba, com CNH e cursos.</span>
        </div>
        {!form && (
          <button className="btn btn-primario" type="button" onClick={() => setForm(VAZIO)}>
            Novo motorista
          </button>
        )}
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}

      {form && (
        <form className="card form" onSubmit={salvar}>
          <h2>{form.id ? `Editar ${form.nome}` : 'Novo motorista'}</h2>
          <div className="campos">
            <div className="campo">
              <label htmlFor="m-nome">Nome</label>
              <input id="m-nome" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="m-funcao">Função</label>
              <select id="m-funcao" value={form.funcao} onChange={(e) => setForm({ ...form, funcao: e.target.value as Dados['funcao'] })}>
                {Object.entries(NOMES_FUNCAO).map(([k, r]) => (
                  <option key={k} value={k}>{r}</option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="m-tel">Telefone</label>
              <input id="m-tel" inputMode="tel" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="m-cpf">CPF</label>
              <input id="m-cpf" className="mono" inputMode="numeric" value={form.cpf} onChange={(e) => setForm({ ...form, cpf: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="m-cnh">Número da CNH</label>
              <input id="m-cnh" className="mono" inputMode="numeric" value={form.cnhNumero} onChange={(e) => setForm({ ...form, cnhNumero: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="m-cat">Categoria da CNH</label>
              <select id="m-cat" value={form.cnhCategoria} onChange={(e) => setForm({ ...form, cnhCategoria: e.target.value })}>
                <option value="">—</option>
                {['B', 'C', 'D', 'E', 'AB', 'AC', 'AD', 'AE'].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="m-venc">Vencimento da CNH</label>
              <input id="m-venc" type="date" value={form.cnhVencimento} onChange={(e) => setForm({ ...form, cnhVencimento: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="m-login">Acesso ao app</label>
              <select id="m-login" value={form.usuarioId} onChange={(e) => setForm({ ...form, usuarioId: e.target.value })}>
                <option value="">Sem acesso</option>
                {loginsLivres.map((u) => (
                  <option key={u.id} value={u.id}>{u.nome} ({u.email})</option>
                ))}
              </select>
              <span className="ajuda">Crie o login em Usuários com o perfil Motorista e ligue aqui.</span>
            </div>
          </div>
          <div className="campo">
            <label htmlFor="m-cursos">Cursos</label>
            <input id="m-cursos" placeholder="Direção defensiva, MOPP, operador de bomba" value={form.cursos} onChange={(e) => setForm({ ...form, cursos: e.target.value })} />
            <span className="ajuda">Separe os cursos por vírgula.</span>
          </div>
          <div className="acoes">
            <button className="btn btn-primario" type="submit" disabled={ocupado}>
              {form.id ? 'Salvar alterações' : 'Cadastrar motorista'}
            </button>
            <button className="btn btn-secundario" type="button" onClick={() => setForm(null)}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="card tabela-caixa">
        {!lista ? (
          <p className="muted">Carregando…</p>
        ) : visiveis.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nenhum motorista cadastrado. Comece pelo botão Novo motorista.</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Função</th>
                <th>CNH</th>
                <th>Vencimento da CNH</th>
                <th>Acesso ao app</th>
                <th><span style={{ position: 'absolute', left: -9999 }}>Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((m) => {
                const s = seloVencimento(m.cnhSituacao, m.cnhDias);
                return (
                  <tr key={m.id} style={m.ativo ? undefined : { opacity: 0.6 }}>
                    <td>
                      {m.nome}
                      {m.cursos.length > 0 && <div className="small muted">{m.cursos.join(' · ')}</div>}
                    </td>
                    <td>{NOMES_FUNCAO[m.funcao]}</td>
                    <td className="mono">{m.cnhCategoria ?? '—'}</td>
                    <td>
                      <span className="mono small">{formatarData(m.cnhVencimento)}</span>{' '}
                      {m.cnhVencimento && <span className={`selo ${s.classe}`}>{s.texto}</span>}
                    </td>
                    <td className="small">{m.usuarioEmail ?? <span className="muted">Sem acesso</span>}</td>
                    <td>
                      <div className="acoes" style={{ flexWrap: 'nowrap' }}>
                        <button className="btn btn-link" type="button" onClick={() => setForm(paraDados(m))}>
                          Editar
                        </button>
                        <button className="btn btn-link" type="button" disabled={ocupado} onClick={() => alternarAtivo(m)}>
                          {m.ativo ? 'Desativar' : 'Reativar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {inativos > 0 && (
        <button className="btn btn-link" type="button" style={{ alignSelf: 'flex-start' }} onClick={() => setMostrarInativos(!mostrarInativos)}>
          {mostrarInativos ? 'Ocultar inativos' : `Mostrar ${inativos} inativo${inativos > 1 ? 's' : ''}`}
        </button>
      )}
    </>
  );
}
