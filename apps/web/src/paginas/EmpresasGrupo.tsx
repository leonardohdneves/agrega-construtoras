// Empresas do grupo: os CNPJs da empresa, cada um com seu regime tributário. Na obra, o usuário escolhe qual delas a executa,
// e o regime dessa empresa define os impostos da obra.
import { useEffect, useState, type FormEvent } from 'react';
import { api, formatarCnpj } from '../api';

export type EmpresaGrupo = {
  id: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  cnpj: string;
  regimeTributario: 'simples' | 'presumido' | 'real';
  simplesAnexo: string | null;
  simplesFaixa: number | null;
  cidade: string | null;
  uf: string | null;
  ativo: boolean;
};

const ROTULO_REGIME: Record<EmpresaGrupo['regimeTributario'], string> = { simples: 'Simples Nacional', presumido: 'Lucro Presumido', real: 'Lucro Real' };

type Formulario = {
  razaoSocial: string;
  nomeFantasia: string;
  cnpj: string;
  regimeTributario: EmpresaGrupo['regimeTributario'];
  simplesAnexo: string;
  simplesFaixa: string;
  cidade: string;
  uf: string;
  ativo: boolean;
};

const VAZIO: Formulario = { razaoSocial: '', nomeFantasia: '', cnpj: '', regimeTributario: 'simples', simplesAnexo: '', simplesFaixa: '', cidade: '', uf: '', ativo: true };

function paraFormulario(e: EmpresaGrupo): Formulario {
  return {
    razaoSocial: e.razaoSocial,
    nomeFantasia: e.nomeFantasia ?? '',
    cnpj: e.cnpj,
    regimeTributario: e.regimeTributario,
    simplesAnexo: e.simplesAnexo ?? '',
    simplesFaixa: e.simplesFaixa === null ? '' : String(e.simplesFaixa),
    cidade: e.cidade ?? '',
    uf: e.uf ?? '',
    ativo: e.ativo,
  };
}

export function rotuloEmpresaGrupo(e: EmpresaGrupo): string {
  const enquadre = e.regimeTributario === 'simples' && e.simplesAnexo ? ` · anexo ${e.simplesAnexo}, faixa ${e.simplesFaixa ?? '?'}` : '';
  return `${e.razaoSocial} (${ROTULO_REGIME[e.regimeTributario]}${enquadre})`;
}

export function EmpresasGrupo({ podeEditar, aoMudar }: { podeEditar: boolean; aoMudar?: () => void }) {
  const [empresas, setEmpresas] = useState<EmpresaGrupo[] | null>(null);
  const [editando, setEditando] = useState<EmpresaGrupo | 'nova' | null>(null);
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');

  const carregar = () => api<{ empresas: EmpresaGrupo[] }>('/empresa/grupo').then((r) => setEmpresas(r.empresas)).catch((e) => setErro((e as Error).message));
  useEffect(() => { carregar(); }, []);

  return (
    <div className="card form" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: 0 }}>Empresas do grupo</h2>
          <span className="small muted">
            {podeEditar ? 'Cadastre cada CNPJ com seu regime tributário. Na obra, você escolhe a empresa que a executa, e os impostos seguem o regime dela.' : 'Somente o dono cadastra as empresas do grupo.'}
          </span>
        </div>
        {podeEditar && editando === null && <button className="btn btn-primario" type="button" onClick={() => { setErro(''); setOk(''); setEditando('nova'); }}>Nova empresa</button>}
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {ok && <div className="alerta alerta-ok" role="status">{ok}</div>}

      {empresas && empresas.length === 0 && editando === null && <p className="muted" style={{ margin: 0 }}>Nenhuma empresa do grupo cadastrada. As obras usam a empresa logada.</p>}
      {empresas && empresas.length > 0 && editando === null && (
        <table className="tabela">
          <thead>
            <tr><th>Razão social</th><th>CNPJ</th><th>Regime</th><th>Situação</th>{podeEditar && <th className="nao-imprimir" />}</tr>
          </thead>
          <tbody>
            {empresas.map((e) => (
              <tr key={e.id}>
                <td>{e.razaoSocial}</td>
                <td className="mono">{formatarCnpj(e.cnpj)}</td>
                <td>{ROTULO_REGIME[e.regimeTributario]}{e.regimeTributario === 'simples' && e.simplesAnexo ? ` · anexo ${e.simplesAnexo}, faixa ${e.simplesFaixa ?? '?'}` : ''}</td>
                <td>{e.ativo ? 'Ativa' : 'Inativa'}</td>
                {podeEditar && <td className="nao-imprimir"><button className="btn btn-link" type="button" onClick={() => { setErro(''); setOk(''); setEditando(e); }}>Editar</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editando !== null && (
        <FormEmpresaGrupo
          inicial={editando === 'nova' ? null : editando}
          aoSalvar={async (mensagem) => { setEditando(null); setOk(mensagem); await carregar(); aoMudar?.(); }}
          aoCancelar={() => setEditando(null)}
          setErro={setErro}
        />
      )}
    </div>
  );
}

function FormEmpresaGrupo({ inicial, aoSalvar, aoCancelar, setErro }: { inicial: EmpresaGrupo | null; aoSalvar: (mensagem: string) => Promise<void>; aoCancelar: () => void; setErro: (m: string) => void }) {
  const [f, setF] = useState<Formulario>(inicial ? paraFormulario(inicial) : VAZIO);
  const [ocupado, setOcupado] = useState(false);
  const mudar = <K extends keyof Formulario>(campo: K, valor: Formulario[K]) => setF((x) => ({ ...x, [campo]: valor }));

  async function salvar(ev: FormEvent) {
    ev.preventDefault();
    setErro('');
    setOcupado(true);
    const simples = f.regimeTributario === 'simples';
    const corpo = {
      razaoSocial: f.razaoSocial.trim(),
      nomeFantasia: f.nomeFantasia.trim() || null,
      cnpj: f.cnpj.replace(/\D/g, ''),
      regimeTributario: f.regimeTributario,
      simplesAnexo: simples && f.simplesAnexo ? f.simplesAnexo : null,
      simplesFaixa: simples && f.simplesFaixa ? Number(f.simplesFaixa) : null,
      cidade: f.cidade.trim() || null,
      uf: f.uf.trim().toUpperCase() || null,
      ativo: f.ativo,
    };
    try {
      await api(inicial ? `/empresa/grupo/${inicial.id}` : '/empresa/grupo', { metodo: inicial ? 'PUT' : 'POST', corpo });
      await aoSalvar(inicial ? 'Empresa atualizada.' : 'Empresa cadastrada. Ela já pode ser escolhida nas obras.');
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form onSubmit={salvar} style={{ marginTop: 12 }}>
      <h3 style={{ margin: '0 0 8px' }}>{inicial ? 'Editar empresa do grupo' : 'Nova empresa do grupo'}</h3>
      <div className="campos">
        <div className="campo">
          <label htmlFor="eg-razao">Razão social</label>
          <input id="eg-razao" value={f.razaoSocial} onChange={(e) => mudar('razaoSocial', e.target.value)} required />
        </div>
        <div className="campo">
          <label htmlFor="eg-fantasia">Nome fantasia</label>
          <input id="eg-fantasia" value={f.nomeFantasia} onChange={(e) => mudar('nomeFantasia', e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="eg-cnpj">CNPJ</label>
          <input id="eg-cnpj" value={f.cnpj} onChange={(e) => mudar('cnpj', e.target.value)} required />
        </div>
        <div className="campo">
          <label htmlFor="eg-regime">Regime tributário</label>
          <select id="eg-regime" value={f.regimeTributario} onChange={(e) => mudar('regimeTributario', e.target.value as Formulario['regimeTributario'])}>
            <option value="simples">Simples Nacional</option>
            <option value="presumido">Lucro Presumido</option>
            <option value="real">Lucro Real</option>
          </select>
        </div>
        {f.regimeTributario === 'simples' && (
          <>
            <div className="campo">
              <label htmlFor="eg-anexo">Anexo do Simples</label>
              <select id="eg-anexo" value={f.simplesAnexo} onChange={(e) => mudar('simplesAnexo', e.target.value)}>
                <option value="">Escolha…</option>
                {['I', 'II', 'III', 'IV', 'V'].map((a) => <option key={a} value={a}>Anexo {a}</option>)}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="eg-faixa">Faixa de faturamento</label>
              <select id="eg-faixa" value={f.simplesFaixa} onChange={(e) => mudar('simplesFaixa', e.target.value)}>
                <option value="">Escolha…</option>
                {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>Faixa {n}</option>)}
              </select>
            </div>
          </>
        )}
        <div className="campo">
          <label htmlFor="eg-cidade">Cidade</label>
          <input id="eg-cidade" value={f.cidade} onChange={(e) => mudar('cidade', e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="eg-uf">UF</label>
          <input id="eg-uf" maxLength={2} value={f.uf} onChange={(e) => mudar('uf', e.target.value)} />
        </div>
        {inicial && (
          <div className="campo">
            <label><input type="checkbox" checked={f.ativo} onChange={(e) => mudar('ativo', e.target.checked)} /> Empresa ativa</label>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn btn-primario" type="submit" disabled={ocupado}>{ocupado ? 'Salvando…' : 'Salvar'}</button>
        <button className="btn" type="button" onClick={aoCancelar}>Cancelar</button>
      </div>
    </form>
  );
}
