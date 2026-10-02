import { useEffect, useState, type FormEvent } from 'react';
import { api, formatarCnpj, type Empresa as TEmpresa } from '../api';
import { useSessao } from '../sessao';

const CAMPOS_ALIQUOTA: Record<TEmpresa['regimeTributario'], { chave: string; rotulo: string }[]> = {
  simples: [{ chave: 'simples', rotulo: 'Alíquota efetiva do Simples (%)' }],
  presumido: [
    { chave: 'pis', rotulo: 'PIS (%)' },
    { chave: 'cofins', rotulo: 'COFINS (%)' },
    { chave: 'iss', rotulo: 'ISS (%)' },
    { chave: 'icms', rotulo: 'ICMS (%)' },
    { chave: 'irpj', rotulo: 'IRPJ efetivo sobre a receita (%)' },
    { chave: 'csll', rotulo: 'CSLL efetiva sobre a receita (%)' },
  ],
  real: [
    { chave: 'pis', rotulo: 'PIS (%)' },
    { chave: 'cofins', rotulo: 'COFINS (%)' },
    { chave: 'iss', rotulo: 'ISS (%)' },
    { chave: 'icms', rotulo: 'ICMS (%)' },
    { chave: 'irpj', rotulo: 'IRPJ sobre o lucro (%)' },
    { chave: 'csll', rotulo: 'CSLL sobre o lucro (%)' },
  ],
};

type Formulario = {
  razaoSocial: string;
  nomeFantasia: string;
  cnpj: string;
  regimeTributario: TEmpresa['regimeTributario'];
  aliquotas: Record<string, string>;
  telefone: string;
  email: string;
  cidade: string;
  uf: string;
};

function paraFormulario(e: TEmpresa): Formulario {
  return {
    razaoSocial: e.razaoSocial,
    nomeFantasia: e.nomeFantasia ?? '',
    cnpj: formatarCnpj(e.cnpj),
    regimeTributario: e.regimeTributario,
    aliquotas: Object.fromEntries(Object.entries(e.aliquotasDre ?? {}).map(([k, v]) => [k, String(v).replace('.', ',')])),
    telefone: e.telefone ?? '',
    email: e.email ?? '',
    cidade: e.cidade ?? '',
    uf: e.uf ?? '',
  };
}

export function Empresa() {
  const { usuario, recarregar } = useSessao();
  const podeEditar = usuario?.perfil === 'dono';
  const [f, setF] = useState<Formulario | null>(null);
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    api<{ empresa: TEmpresa }>('/empresa')
      .then((r) => setF(paraFormulario(r.empresa)))
      .catch((e) => setErro(e.message));
  }, []);

  function mudar<K extends keyof Formulario>(campo: K, valor: Formulario[K]) {
    setF((atual) => (atual ? { ...atual, [campo]: valor } : atual));
    setOk('');
  }

  async function salvar(ev: FormEvent) {
    ev.preventDefault();
    if (!f) return;
    setErro('');
    setOk('');
    setSalvando(true);
    try {
      const chaves = CAMPOS_ALIQUOTA[f.regimeTributario].map((c) => c.chave);
      const aliquotasDre: Record<string, number> = {};
      for (const k of chaves) {
        const v = (f.aliquotas[k] ?? '').trim();
        if (v) aliquotasDre[k] = Number(v.replace(',', '.'));
      }
      const r = await api<{ empresa: TEmpresa }>('/empresa', {
        metodo: 'PUT',
        corpo: { ...f, aliquotas: undefined, aliquotasDre },
      });
      setF(paraFormulario(r.empresa));
      setOk('Dados da empresa salvos.');
      await recarregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  if (!f) return erro ? <div className="alerta alerta-erro">{erro}</div> : <p className="muted">Carregando…</p>;

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Empresa</h1>
          <span className="muted">{podeEditar ? 'Dados cadastrais e fiscais usados nos relatórios.' : 'Somente o dono pode alterar estes dados.'}</span>
        </div>
      </div>
      <form className="form" onSubmit={salvar}>
        {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
        {ok && <div className="alerta alerta-ok" role="status">{ok}</div>}
        <fieldset disabled={!podeEditar} style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card form">
            <h2>Identificação</h2>
            <div className="campos">
              <div className="campo">
                <label htmlFor="emp-razao">Razão social</label>
                <input id="emp-razao" value={f.razaoSocial} onChange={(e) => mudar('razaoSocial', e.target.value)} />
              </div>
              <div className="campo">
                <label htmlFor="emp-fantasia">Nome fantasia</label>
                <input id="emp-fantasia" value={f.nomeFantasia} onChange={(e) => mudar('nomeFantasia', e.target.value)} />
              </div>
              <div className="campo">
                <label htmlFor="emp-cnpj">CNPJ</label>
                <input id="emp-cnpj" className="mono" inputMode="numeric" value={f.cnpj} onChange={(e) => mudar('cnpj', e.target.value)} />
              </div>
              <div className="campo">
                <label htmlFor="emp-tel">Telefone</label>
                <input id="emp-tel" inputMode="tel" value={f.telefone} onChange={(e) => mudar('telefone', e.target.value)} />
              </div>
              <div className="campo">
                <label htmlFor="emp-email">E-mail</label>
                <input id="emp-email" type="email" value={f.email} onChange={(e) => mudar('email', e.target.value)} />
              </div>
              <div className="campo">
                <label htmlFor="emp-cidade">Cidade</label>
                <input id="emp-cidade" value={f.cidade} onChange={(e) => mudar('cidade', e.target.value)} />
              </div>
              <div className="campo">
                <label htmlFor="emp-uf">UF</label>
                <input id="emp-uf" maxLength={2} value={f.uf} onChange={(e) => mudar('uf', e.target.value.toUpperCase())} />
              </div>
            </div>
          </div>
          <div className="card form">
            <h2>Tributação na DRE</h2>
            <span className="small muted">Define como os impostos sobre vendas são deduzidos da receita na DRE gerencial.</span>
            <div className="campos">
              <div className="campo">
                <label htmlFor="emp-regime">Regime tributário</label>
                <select id="emp-regime" value={f.regimeTributario} onChange={(e) => mudar('regimeTributario', e.target.value as Formulario['regimeTributario'])}>
                  <option value="simples">Simples Nacional</option>
                  <option value="presumido">Lucro Presumido</option>
                  <option value="real">Lucro Real</option>
                </select>
              </div>
              {CAMPOS_ALIQUOTA[f.regimeTributario].map((c) => (
                <div className="campo" key={c.chave}>
                  <label htmlFor={`emp-aliq-${c.chave}`}>{c.rotulo}</label>
                  <input
                    id={`emp-aliq-${c.chave}`}
                    className="mono"
                    inputMode="decimal"
                    value={f.aliquotas[c.chave] ?? ''}
                    onChange={(e) => mudar('aliquotas', { ...f.aliquotas, [c.chave]: e.target.value })}
                  />
                </div>
              ))}
            </div>
          </div>
        </fieldset>
        {podeEditar && (
          <div className="acoes">
            <button className="btn btn-primario" type="submit" disabled={salvando}>
              {salvando ? 'Salvando…' : 'Salvar alterações'}
            </button>
          </div>
        )}
      </form>
    </>
  );
}
