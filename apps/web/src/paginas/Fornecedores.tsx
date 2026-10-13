import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, formatarDocumento, type Fornecedor } from '../api';

type Dados = {
  id?: string;
  tipoPessoa: 'PJ' | 'PF';
  cnpjCpf: string;
  razaoSocial: string;
  nomeFantasia: string;
  ramo: string;
  telefone: string;
  email: string;
  cidade: string;
  uf: string;
  chavePix: string;
  observacoes: string;
};

const VAZIO: Dados = { tipoPessoa: 'PJ', cnpjCpf: '', razaoSocial: '', nomeFantasia: '', ramo: '', telefone: '', email: '', cidade: '', uf: '', chavePix: '', observacoes: '' };

function paraDados(f: Fornecedor): Dados {
  return {
    id: f.id,
    tipoPessoa: f.tipoPessoa,
    cnpjCpf: f.cnpjCpf ? formatarDocumento(f.cnpjCpf) : '',
    razaoSocial: f.razaoSocial,
    nomeFantasia: f.nomeFantasia ?? '',
    ramo: f.ramo ?? '',
    telefone: f.telefone ?? '',
    email: f.email ?? '',
    cidade: f.cidade ?? '',
    uf: f.uf ?? '',
    chavePix: f.chavePix ?? '',
    observacoes: f.observacoes ?? '',
  };
}

const TEXTOS = {
  fornecedor: {
    titulo: 'Fornecedores',
    sub: 'Quem vende para a construtora: materiais, serviços, equipamentos e locações.',
    novo: 'Novo fornecedor',
    vazio: 'Nenhum fornecedor cadastrado. Fornecedores também serão criados automaticamente ao importar notas fiscais.',
    ramo: 'Ramo (ex.: cimento, oficina, posto)',
  },
  cliente: {
    titulo: 'Clientes',
    sub: 'Quem compra o concreto: construtoras, incorporadoras, empresas e pessoas físicas.',
    novo: 'Novo cliente',
    vazio: 'Nenhum cliente cadastrado.',
    ramo: 'Segmento (ex.: construtora, obra residencial)',
  },
  credor: {
    titulo: 'Credores',
    sub: 'A quem a construtora deve sem ser por compra: bancos, financiamentos, consórcios, impostos e aluguéis.',
    novo: 'Novo credor',
    vazio: 'Nenhum credor cadastrado.',
    ramo: 'Natureza (ex.: financiamento, tributo, aluguel)',
  },
};

export function Fornecedores({ categoria }: { categoria: 'fornecedor' | 'credor' | 'cliente' }) {
  const t = TEXTOS[categoria];
  const base = categoria === 'cliente' ? '/adm/clientes' : '/adm/fornecedores';
  const [lista, setLista] = useState<Fornecedor[] | null>(null);
  const [form, setForm] = useState<Dados | null>(null);
  const [busca, setBusca] = useState('');
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      if (categoria === 'cliente') setLista((await api<{ clientes: Fornecedor[] }>('/adm/clientes')).clientes);
      else setLista((await api<{ fornecedores: Fornecedor[] }>(`/adm/fornecedores?categoria=${categoria}`)).fornecedores);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [categoria]);

  useEffect(() => {
    setLista(null);
    setForm(null);
    setAviso('');
    carregar();
  }, [carregar]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setErro('');
    setAviso('');
    setOcupado(true);
    try {
      const { id, ...corpo } = form;
      if (id) await api(`${base}/${id}`, { metodo: 'PATCH', corpo });
      else await api(base, { corpo: categoria === 'cliente' ? corpo : { ...corpo, categoria } });
      setAviso(`${form.nomeFantasia || form.razaoSocial} ${id ? 'atualizado' : 'cadastrado'}.`);
      setForm(null);
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function alternar(f: Fornecedor) {
    setOcupado(true);
    try {
      await api(`${base}/${f.id}`, { metodo: 'PATCH', corpo: { ativo: !f.ativo } });
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const termo = busca.trim().toLowerCase();
  const visiveis = (lista ?? []).filter(
    (f) => !termo || [f.razaoSocial, f.nomeFantasia, f.ramo, f.cnpjCpf, f.cidade].some((x) => (x ?? '').toLowerCase().includes(termo.replace(/[./-]/g, '')) || (x ?? '').toLowerCase().includes(termo)),
  );

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>{t.titulo}</h1>
          <span className="muted">{t.sub}</span>
        </div>
        {!form && (
          <button className="btn btn-primario" type="button" onClick={() => setForm(VAZIO)}>
            {t.novo}
          </button>
        )}
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}

      {form && (
        <form className="card form" onSubmit={salvar}>
          <h2>{form.id ? `Editar ${form.nomeFantasia || form.razaoSocial}` : t.novo}</h2>
          <div className="campos">
            <div className="campo">
              <span className="rotulo" id="f-pessoa">Pessoa</span>
              <div className="segmentado" role="group" aria-labelledby="f-pessoa">
                <button type="button" aria-pressed={form.tipoPessoa === 'PJ'} className={form.tipoPessoa === 'PJ' ? 'ativo' : ''} onClick={() => setForm({ ...form, tipoPessoa: 'PJ' })}>
                  Jurídica
                </button>
                <button type="button" aria-pressed={form.tipoPessoa === 'PF'} className={form.tipoPessoa === 'PF' ? 'ativo' : ''} onClick={() => setForm({ ...form, tipoPessoa: 'PF' })}>
                  Física
                </button>
              </div>
            </div>
            <div className="campo">
              <label htmlFor="f-doc">{form.tipoPessoa === 'PJ' ? 'CNPJ' : 'CPF'}</label>
              <input id="f-doc" className="mono" inputMode="numeric" value={form.cnpjCpf} onChange={(e) => setForm({ ...form, cnpjCpf: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="f-razao">{form.tipoPessoa === 'PJ' ? 'Razão social' : 'Nome'}</label>
              <input id="f-razao" value={form.razaoSocial} onChange={(e) => setForm({ ...form, razaoSocial: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="f-fantasia">Nome fantasia / apelido</label>
              <input id="f-fantasia" value={form.nomeFantasia} onChange={(e) => setForm({ ...form, nomeFantasia: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="f-ramo">{t.ramo}</label>
              <input id="f-ramo" value={form.ramo} onChange={(e) => setForm({ ...form, ramo: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="f-tel">Telefone</label>
              <input id="f-tel" inputMode="tel" value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="f-email">E-mail</label>
              <input id="f-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="f-cidade">Cidade</label>
              <input id="f-cidade" value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="f-uf">UF</label>
              <input id="f-uf" maxLength={2} value={form.uf} onChange={(e) => setForm({ ...form, uf: e.target.value.toUpperCase() })} />
            </div>
            <div className="campo">
              <label htmlFor="f-pix">Chave PIX</label>
              <input id="f-pix" value={form.chavePix} onChange={(e) => setForm({ ...form, chavePix: e.target.value })} />
            </div>
          </div>
          <div className="campo">
            <label htmlFor="f-obs">Observações</label>
            <input id="f-obs" value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
          </div>
          <div className="acoes">
            <button className="btn btn-primario" type="submit" disabled={ocupado}>
              {form.id ? 'Salvar alterações' : 'Cadastrar'}
            </button>
            <button className="btn btn-secundario" type="button" onClick={() => setForm(null)}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="filtros">
        <input className="busca" style={{ marginLeft: 0 }} type="search" aria-label="Buscar" placeholder="Buscar nome, CNPJ, ramo ou cidade" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>

      <div className="card tabela-caixa">
        {!lista ? (
          <p className="muted">Carregando…</p>
        ) : visiveis.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>{lista.length ? 'Nenhum cadastro encontrado na busca.' : t.vazio}</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr>
                <th>Nome</th>
                <th>CNPJ / CPF</th>
                <th>{categoria === 'fornecedor' ? 'Ramo' : categoria === 'cliente' ? 'Segmento' : 'Natureza'}</th>
                <th>Contato</th>
                <th>Cidade</th>
                <th><span style={{ position: 'absolute', left: -9999 }}>Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((f) => (
                <tr key={f.id} style={f.ativo ? undefined : { opacity: 0.6 }}>
                  <td>
                    {f.nomeFantasia || f.razaoSocial}
                    {f.nomeFantasia && <div className="small muted">{f.razaoSocial}</div>}
                  </td>
                  <td className="mono small">{formatarDocumento(f.cnpjCpf)}</td>
                  <td className="small">{f.ramo ?? '—'}</td>
                  <td className="small">{[f.telefone, f.email].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="small">{[f.cidade, f.uf].filter(Boolean).join(' / ') || '—'}</td>
                  <td>
                    <div className="acoes" style={{ flexWrap: 'nowrap' }}>
                      <button className="btn btn-link" type="button" onClick={() => { setForm(paraDados(f)); window.scrollTo({ top: 0 }); }}>
                        Editar
                      </button>
                      <button className="btn btn-link" type="button" disabled={ocupado} onClick={() => alternar(f)}>
                        {f.ativo ? 'Desativar' : 'Reativar'}
                      </button>
                    </div>
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
