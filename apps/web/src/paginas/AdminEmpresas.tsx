import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, formatarCnpj, type Empresa } from '../api';

type Nova = {
  razaoSocial: string;
  nomeFantasia: string;
  cnpj: string;
  regimeTributario: 'simples' | 'presumido' | 'real';
  cidade: string;
  uf: string;
  dono: { nome: string; email: string; senha: string };
};

const VAZIA: Nova = { razaoSocial: '', nomeFantasia: '', cnpj: '', regimeTributario: 'simples', cidade: '', uf: '', dono: { nome: '', email: '', senha: '' } };
const REGIMES = { simples: 'Simples Nacional', presumido: 'Lucro Presumido', real: 'Lucro Real' };

export function AdminEmpresas() {
  const [lista, setLista] = useState<Empresa[] | null>(null);
  const [nova, setNova] = useState<Nova | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setLista((await api<{ empresas: Empresa[] }>('/admin/empresas')).empresas);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  async function criar(ev: FormEvent) {
    ev.preventDefault();
    if (!nova) return;
    setErro('');
    setAviso('');
    setSalvando(true);
    try {
      await api('/admin/empresas', { corpo: { ...nova, aliquotasDre: {} } });
      setAviso(`${nova.nomeFantasia || nova.razaoSocial} foi cadastrada. Passe o e-mail e a senha inicial ao dono.`);
      setNova(null);
      await carregar();
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
          <h1>Construtoras</h1>
          <span className="muted">Empresas clientes do Agrega.</span>
        </div>
        {!nova && (
          <button className="btn btn-primario" type="button" onClick={() => setNova(VAZIA)}>
            Nova construtora
          </button>
        )}
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}

      {nova && (
        <form className="card form" onSubmit={criar}>
          <h2>Nova construtora</h2>
          <div className="campos">
            <div className="campo">
              <label htmlFor="ne-razao">Razão social</label>
              <input id="ne-razao" value={nova.razaoSocial} onChange={(e) => setNova({ ...nova, razaoSocial: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="ne-fantasia">Nome fantasia</label>
              <input id="ne-fantasia" value={nova.nomeFantasia} onChange={(e) => setNova({ ...nova, nomeFantasia: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="ne-cnpj">CNPJ</label>
              <input id="ne-cnpj" className="mono" inputMode="numeric" value={nova.cnpj} onChange={(e) => setNova({ ...nova, cnpj: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="ne-regime">Regime tributário</label>
              <select id="ne-regime" value={nova.regimeTributario} onChange={(e) => setNova({ ...nova, regimeTributario: e.target.value as Nova['regimeTributario'] })}>
                {Object.entries(REGIMES).map(([v, r]) => (
                  <option key={v} value={v}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="ne-cidade">Cidade</label>
              <input id="ne-cidade" value={nova.cidade} onChange={(e) => setNova({ ...nova, cidade: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="ne-uf">UF</label>
              <input id="ne-uf" maxLength={2} value={nova.uf} onChange={(e) => setNova({ ...nova, uf: e.target.value.toUpperCase() })} />
            </div>
          </div>
          <h2 style={{ marginTop: 8 }}>Dono da construtora</h2>
          <div className="campos">
            <div className="campo">
              <label htmlFor="ne-dono-nome">Nome</label>
              <input id="ne-dono-nome" value={nova.dono.nome} onChange={(e) => setNova({ ...nova, dono: { ...nova.dono, nome: e.target.value } })} />
            </div>
            <div className="campo">
              <label htmlFor="ne-dono-email">E-mail</label>
              <input id="ne-dono-email" type="email" value={nova.dono.email} onChange={(e) => setNova({ ...nova, dono: { ...nova.dono, email: e.target.value } })} />
            </div>
            <div className="campo">
              <label htmlFor="ne-dono-senha">Senha inicial</label>
              <input id="ne-dono-senha" type="text" autoComplete="new-password" value={nova.dono.senha} onChange={(e) => setNova({ ...nova, dono: { ...nova.dono, senha: e.target.value } })} />
              <span className="ajuda">Mínimo de 8 caracteres.</span>
            </div>
          </div>
          <div className="acoes">
            <button className="btn btn-primario" type="submit" disabled={salvando}>
              {salvando ? 'Cadastrando…' : 'Cadastrar construtora'}
            </button>
            <button className="btn btn-secundario" type="button" onClick={() => setNova(null)}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="card tabela-caixa">
        {!lista ? (
          <p className="muted">Carregando…</p>
        ) : lista.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Nenhuma construtora cadastrada ainda.
          </p>
        ) : (
          <table className="tabela">
            <thead>
              <tr>
                <th>Construtora</th>
                <th>CNPJ</th>
                <th>Cidade</th>
                <th>Regime</th>
                <th>Usuários</th>
                <th>Plano</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((e) => (
                <tr key={e.id}>
                  <td>{e.nomeFantasia || e.razaoSocial}</td>
                  <td className="mono small">{formatarCnpj(e.cnpj)}</td>
                  <td>{[e.cidade, e.uf].filter(Boolean).join(' / ') || '—'}</td>
                  <td>{REGIMES[e.regimeTributario]}</td>
                  <td className="mono">{e.totalUsuarios ?? 0}</td>
                  <td>
                    <span className="selo selo-neutro">{e.plano}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
