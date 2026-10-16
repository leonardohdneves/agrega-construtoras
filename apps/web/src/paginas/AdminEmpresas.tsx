import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, formatarCnpj, type Empresa, type PacoteContrato } from '../api';

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

/** Pacotes vendidos. Os valores preenchem o formulário; o servidor confirma e grava. */
const PACOTES_TELA: { v: PacoteContrato; nome: string; resumo: string }[] = [
  { v: 'obra', nome: 'Obra', resumo: 'Engenharia e Suprimentos (estoque e compras)' },
  { v: 'obra_gestao', nome: 'Obra + Gestão', resumo: 'Obra mais Financeiro, Gerencial e Administrativo' },
  { v: 'completo', nome: 'Completo', resumo: 'Todos os módulos, incluindo Comercial' },
  { v: 'personalizado', nome: 'Personalizado', resumo: 'Você escolhe os módulos e os limites' },
];
const PREDEFINIDO: Record<Exclude<PacoteContrato, 'personalizado'>, { modulos: string[]; obras: number; usuarios: number }> = {
  obra: { modulos: ['engenharia', 'suprimentos'], obras: 3, usuarios: 3 },
  obra_gestao: { modulos: ['engenharia', 'suprimentos', 'financeiro', 'gerencial', 'administrativo'], obras: 3, usuarios: 5 },
  completo: { modulos: ['engenharia', 'comercial', 'suprimentos', 'financeiro', 'gerencial', 'administrativo'], obras: 10, usuarios: 8 },
};
const MODULOS_CONTRATO: [string, string][] = [
  ['engenharia', 'Engenharia'],
  ['comercial', 'Comercial'],
  ['suprimentos', 'Suprimentos'],
  ['financeiro', 'Financeiro'],
  ['gerencial', 'Gerencial'],
  ['administrativo', 'Administrativo'],
];

type EdicaoContrato = { id: string; nome: string; pacote: PacoteContrato; modulos: string[]; limiteObras: string; limiteUsuarios: string };

function editarContrato(e: Empresa): EdicaoContrato {
  return {
    id: e.id,
    nome: e.nomeFantasia || e.razaoSocial,
    pacote: e.contrato?.pacote ?? 'completo',
    modulos: (e.contrato?.modulos ?? []).filter((m) => m !== 'configuracoes'),
    limiteObras: e.contrato?.limiteObras?.toString() ?? '',
    limiteUsuarios: e.contrato?.limiteUsuarios?.toString() ?? '',
  };
}

/** Campo de limite: vazio = sem limite. Devolve null se o valor for inválido. */
function lerLimite(v: string): number | null | undefined {
  if (v.trim() === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function ContratoEmpresa({ edicao, aoMudar, aoSalvar, aoFechar, salvando }: { edicao: EdicaoContrato; aoMudar: (e: EdicaoContrato) => void; aoSalvar: (ev: FormEvent) => void; aoFechar: () => void; salvando: boolean }) {
  function escolherPacote(pacote: PacoteContrato) {
    if (pacote === 'personalizado') return aoMudar({ ...edicao, pacote });
    const p = PREDEFINIDO[pacote];
    aoMudar({ ...edicao, pacote, modulos: p.modulos, limiteObras: String(p.obras), limiteUsuarios: String(p.usuarios) });
  }
  function alternarModulo(m: string) {
    const modulos = edicao.modulos.includes(m) ? edicao.modulos.filter((x) => x !== m) : [...edicao.modulos, m];
    aoMudar({ ...edicao, modulos });
  }
  return (
    <form className="card form" onSubmit={aoSalvar}>
      <h2>Contrato de {edicao.nome}</h2>
      <div className="campos">
        <div className="campo">
          <label htmlFor="ct-pacote">Pacote</label>
          <select id="ct-pacote" value={edicao.pacote} onChange={(e) => escolherPacote(e.target.value as PacoteContrato)}>
            {PACOTES_TELA.map((p) => (
              <option key={p.v} value={p.v}>
                {p.nome}
              </option>
            ))}
          </select>
          <span className="ajuda">{PACOTES_TELA.find((p) => p.v === edicao.pacote)?.resumo}</span>
        </div>
        <div className="campo">
          <label htmlFor="ct-obras">Limite de obras ativas</label>
          <input id="ct-obras" inputMode="numeric" value={edicao.limiteObras} placeholder="Sem limite" onChange={(e) => aoMudar({ ...edicao, limiteObras: e.target.value })} />
          <span className="ajuda">Obras concluídas não contam.</span>
        </div>
        <div className="campo">
          <label htmlFor="ct-usuarios">Limite de usuários ativos</label>
          <input id="ct-usuarios" inputMode="numeric" value={edicao.limiteUsuarios} placeholder="Sem limite" onChange={(e) => aoMudar({ ...edicao, limiteUsuarios: e.target.value })} />
        </div>
      </div>
      {edicao.pacote === 'personalizado' ? (
        <fieldset className="campo">
          <legend className="rotulo">Módulos liberados</legend>
          {MODULOS_CONTRATO.map(([v, nome]) => (
            <label key={v} style={{ display: 'block' }}>
              <input type="checkbox" checked={edicao.modulos.includes(v)} onChange={() => alternarModulo(v)} /> {nome}
            </label>
          ))}
          <span className="ajuda">Configurações está sempre liberado.</span>
        </fieldset>
      ) : (
        <p className="ajuda">Módulos do pacote: {PREDEFINIDO[edicao.pacote].modulos.map((m) => MODULOS_CONTRATO.find(([v]) => v === m)?.[1]).join(', ')}, mais Configurações.</p>
      )}
      <div className="acoes">
        <button className="btn btn-primario" type="submit" disabled={salvando}>
          {salvando ? 'Salvando…' : 'Salvar contrato'}
        </button>
        <button className="btn btn-secundario" type="button" onClick={aoFechar}>
          Fechar
        </button>
      </div>
    </form>
  );
}

export function AdminEmpresas() {
  const [lista, setLista] = useState<Empresa[] | null>(null);
  const [nova, setNova] = useState<Nova | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [contrato, setContrato] = useState<EdicaoContrato | null>(null);

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

  async function salvarContrato(ev: FormEvent) {
    ev.preventDefault();
    if (!contrato) return;
    const obras = lerLimite(contrato.limiteObras);
    const usuarios = lerLimite(contrato.limiteUsuarios);
    if (obras === undefined || usuarios === undefined) {
      setErro('Os limites precisam ser números inteiros maiores que zero (ou vazios, para sem limite).');
      return;
    }
    setErro('');
    setAviso('');
    setSalvando(true);
    try {
      await api(`/admin/empresas/${contrato.id}/contrato`, {
        metodo: 'PUT',
        corpo: { pacote: contrato.pacote, modulos: contrato.pacote === 'personalizado' ? contrato.modulos : undefined, limiteObras: obras, limiteUsuarios: usuarios },
      });
      setAviso(`Contrato de ${contrato.nome} salvo. Os novos limites valem a partir de agora.`);
      setContrato(null);
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

      {contrato && (
        <ContratoEmpresa
          edicao={contrato}
          aoMudar={setContrato}
          aoSalvar={salvarContrato}
          aoFechar={() => setContrato(null)}
          salvando={salvando}
        />
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
                <th>Contrato</th>
                <th></th>
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
                    <span className="selo selo-neutro">{e.contrato?.nomePacote ?? e.plano}</span>
                    <div className="ajuda">
                      Obras: {e.contrato?.limiteObras ?? 'sem limite'} · Usuários: {e.contrato?.limiteUsuarios ?? 'sem limite'}
                    </div>
                  </td>
                  <td>
                    <button className="btn btn-link" type="button" onClick={() => setContrato(editarContrato(e))}>
                      Editar contrato
                    </button>
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
