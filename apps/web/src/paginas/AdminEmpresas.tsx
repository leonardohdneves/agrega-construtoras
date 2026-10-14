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
      <BackupsSistema />

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

type Backup = { id: string; criadoEm: string; tipo: 'automatico' | 'manual'; status: 'ok' | 'erro'; tamanhoBytes: number | null; registros: number | null; tabelas: number | null; erro: string | null };

const formatarTamanho = (b: number | null) => (b === null ? '—' : b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Backup completo do sistema: diário às 03:00 (Brasília), guardado no armazenamento, com retenção de 30 dias. */
function BackupsSistema() {
  const [dados, setDados] = useState<{ armazenamentoConfigurado: boolean; backups: Backup[] } | null>(null);
  const [fazendo, setFazendo] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  const carregar = useCallback(() => {
    api<{ armazenamentoConfigurado: boolean; backups: Backup[] }>('/admin/backups')
      .then(setDados)
      .catch((e) => setErro((e as Error).message));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  async function fazerAgora() {
    setErro('');
    setAviso('');
    setFazendo(true);
    try {
      const r = await api<{ backup: { registros: number; tabelas: number } }>('/admin/backups', { metodo: 'POST' });
      setAviso(`Backup concluído: ${r.backup.registros} registros em ${r.backup.tabelas} tabelas.`);
      carregar();
    } catch (e) {
      setErro((e as Error).message);
      carregar();
    } finally {
      setFazendo(false);
    }
  }

  return (
    <div className="card">
      <div className="cabecalho" style={{ marginBottom: 8 }}>
        <div className="titulo">
          <h2 style={{ margin: 0 }}>Backup do sistema</h2>
          <span className="muted">Todos os dados de todas as construtoras. Backup automático todo dia às 03:00, mantido por 30 dias.</span>
        </div>
        <button className="btn btn-primario" type="button" onClick={fazerAgora} disabled={fazendo || dados?.armazenamentoConfigurado === false}>
          {fazendo ? 'Gerando backup…' : 'Fazer backup agora'}
        </button>
      </div>
      {dados && !dados.armazenamentoConfigurado && (
        <div className="alerta alerta-erro" role="alert">O armazenamento de backups ainda não está configurado no servidor.</div>
      )}
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}
      {!dados ? (
        <p className="muted">Carregando…</p>
      ) : dados.backups.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>Nenhum backup ainda.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="tabela">
            <thead>
              <tr>
                <th>Data</th>
                <th>Tipo</th>
                <th>Situação</th>
                <th className="num">Registros</th>
                <th className="num">Tamanho</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {dados.backups.map((b) => (
                <tr key={b.id}>
                  <td>{new Date(b.criadoEm).toLocaleString('pt-BR')}</td>
                  <td>{b.tipo === 'automatico' ? 'Automático' : 'Manual'}</td>
                  <td>{b.status === 'ok' ? 'Concluído' : <span title={b.erro ?? ''}>Falhou</span>}</td>
                  <td className="num">{b.registros ?? '—'}</td>
                  <td className="num">{formatarTamanho(b.tamanhoBytes)}</td>
                  <td className="acoes">
                    {b.status === 'ok' && <a className="btn" href={`/api/admin/backups/${b.id}/download`} download>Baixar</a>}
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
