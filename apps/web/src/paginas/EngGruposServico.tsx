import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';

type Grupo = { id: string; nome: string; ordem: number; servicos: number };

/** Cadastro dos grupos de serviços da empresa (criação, edição e remoção). */
export function EngGruposServico() {
  const [grupos, setGrupos] = useState<Grupo[] | null>(null);
  const [novo, setNovo] = useState('');
  const [editando, setEditando] = useState<{ id: string; nome: string } | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  function carregar() {
    api<{ grupos: Grupo[] }>('/eng/servico-grupos')
      .then((r) => setGrupos(r.grupos))
      .catch((e) => setErro((e as Error).message));
  }
  useEffect(() => {
    carregar();
  }, []);

  async function executar(fn: () => Promise<unknown>, msg: string) {
    setErro('');
    setAviso('');
    setOcupado(true);
    try {
      await fn();
      setAviso(msg);
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function criarSugeridos() {
    setErro('');
    setAviso('');
    setOcupado(true);
    try {
      const r = await api<{ criados: number }>('/eng/servico-grupos/sugeridos', { metodo: 'POST', corpo: {} });
      setAviso(r.criados ? `${r.criados} grupo(s) sugerido(s) criado(s).` : 'Os grupos sugeridos já existem.');
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function adicionar(e: FormEvent) {
    e.preventDefault();
    const nome = novo.trim();
    if (!nome) return;
    await executar(() => api('/eng/servico-grupos', { metodo: 'POST', corpo: { nome } }), `Grupo "${nome}" criado.`);
    setNovo('');
  }

  async function salvarEdicao() {
    if (!editando) return;
    const nome = editando.nome.trim();
    await executar(() => api(`/eng/servico-grupos/${editando.id}`, { metodo: 'PUT', corpo: { nome } }), 'Grupo atualizado.');
    setEditando(null);
  }

  async function excluir(g: Grupo) {
    const texto = g.servicos ? ` Os ${g.servicos} serviço(s) ligados a ele ficarão sem grupo.` : '';
    if (!window.confirm(`Excluir o grupo "${g.nome}"?${texto}`)) return;
    await executar(() => api(`/eng/servico-grupos/${g.id}`, { metodo: 'DELETE' }), `Grupo "${g.nome}" excluído.`);
  }

  return (
    <div className="pagina">
      <h1>Grupos de serviços</h1>
      <p className="small muted">
        Famílias de serviços (por exemplo, Fundação, Alvenaria, Instalações). Os serviços de cada obra aparecem agrupados por aqui.
      </p>

      <form onSubmit={adicionar} className="row" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', marginBottom: 16 }}>
        <label style={{ flex: '1 1 260px', minWidth: 0 }}>
          <span className="small muted">Novo grupo</span>
          <input value={novo} maxLength={80} placeholder="Ex.: Fundação e estrutura" onChange={(e) => setNovo(e.target.value)} />
        </label>
        <button className="btn btn-primario" type="submit" disabled={ocupado || !novo.trim()}>
          Criar grupo
        </button>
      </form>

      <div className="acoes" style={{ marginBottom: 16, alignItems: 'center' }}>
        <button className="btn" type="button" disabled={ocupado} onClick={criarSugeridos}>
          Criar grupos sugeridos
        </button>
        <span className="small muted">Cria os 15 grupos sugeridos de frentes de obra. Os que já existem são mantidos.</span>
      </div>

      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}

      {grupos === null && !erro && <p className="muted">Carregando…</p>}
      {grupos && grupos.length === 0 && <p className="muted">Nenhum grupo cadastrado ainda.</p>}
      {grupos && grupos.length > 0 && (
        <div className="tabela-wrap">
          <table className="tabela">
            <thead>
              <tr>
                <th>Grupo</th>
                <th className="n">Serviços nas obras</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => (
                <tr key={g.id}>
                  <td>
                    {editando?.id === g.id ? (
                      <input
                        aria-label="Nome do grupo"
                        value={editando.nome}
                        maxLength={80}
                        autoFocus
                        onChange={(e) => setEditando({ id: g.id, nome: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') salvarEdicao();
                          if (e.key === 'Escape') setEditando(null);
                        }}
                      />
                    ) : (
                      g.nome
                    )}
                  </td>
                  <td className="n">{g.servicos}</td>
                  <td className="acoes">
                    {editando?.id === g.id ? (
                      <>
                        <button className="btn btn-primario" type="button" disabled={ocupado || !editando.nome.trim()} onClick={salvarEdicao}>Salvar</button>
                        <button className="btn" type="button" onClick={() => setEditando(null)}>Cancelar</button>
                      </>
                    ) : (
                      <>
                        <button className="btn" type="button" onClick={() => setEditando({ id: g.id, nome: g.nome })}>Editar</button>
                        <button className="btn" type="button" disabled={ocupado} onClick={() => excluir(g)}>Excluir</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
