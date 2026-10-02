import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { OpcoesCategoria, useCadastros } from './Lancamento';

type Regra = {
  id: string;
  fornecedorId: string | null;
  fornecedorNome: string | null;
  textoContem: string | null;
  ncm: string | null;
  planoNome: string;
  centroNome: string | null;
  veiculoCodigo: string | null;
  origem: 'usuario' | 'aprendida' | 'ia';
  vezesAplicada: number;
  ativo: boolean;
};

const VAZIA = { fornecedorId: '', textoContem: '', ncm: '', planoContaId: '', centroCustoId: '', veiculoId: '' };

export function Regras() {
  const { cadastros, erro: erroCad } = useCadastros();
  const [regras, setRegras] = useState<Regra[] | null>(null);
  const [form, setForm] = useState<typeof VAZIA | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setRegras((await api<{ regras: Regra[] }>('/fin/regras-apropriacao')).regras);
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
    setOcupado(true);
    try {
      await api('/fin/regras-apropriacao', { corpo: form });
      setForm(null);
      setAviso('Regra salva. Ela vale para as próximas notas importadas.');
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function alternar(r: Regra) {
    setErro('');
    try {
      await api(`/fin/regras-apropriacao/${r.id}`, { metodo: 'PATCH', corpo: { ativo: !r.ativo } });
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <Link to="/fin/notas" className="small">← Notas fiscais</Link>
          <h1>Regras de apropriação</h1>
          <span className="muted">
            Dizem em que categoria cada item de nota entra. São criadas sozinhas quando você confirma uma nota, e você pode criar as suas.
          </span>
        </div>
        {!form && (
          <button className="btn btn-primario" type="button" onClick={() => setForm(VAZIA)}>
            Nova regra
          </button>
        )}
      </div>
      {(erro || erroCad) && <div className="alerta alerta-erro" role="alert">{erro || erroCad}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}

      {form && cadastros && (
        <form className="card form" onSubmit={salvar}>
          <h2>Nova regra</h2>
          <p className="small muted" style={{ margin: 0 }}>Preencha pelo menos um critério. Quanto mais específico, mais prioridade a regra tem.</p>
          <div className="campos">
            <div className="campo">
              <label htmlFor="r-forn">Fornecedor</label>
              <select id="r-forn" value={form.fornecedorId} onChange={(e) => setForm({ ...form, fornecedorId: e.target.value })}>
                <option value="">Qualquer fornecedor</option>
                {cadastros.fornecedores.filter((f) => f.ativo).map((f) => (
                  <option key={f.id} value={f.id}>{f.nomeFantasia || f.razaoSocial}</option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="r-texto">Descrição do item contém</label>
              <input id="r-texto" placeholder="Ex.: DIESEL S10" value={form.textoContem} onChange={(e) => setForm({ ...form, textoContem: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="r-ncm">NCM começa com</label>
              <input id="r-ncm" className="mono" inputMode="numeric" placeholder="Ex.: 2710" value={form.ncm} onChange={(e) => setForm({ ...form, ncm: e.target.value })} />
            </div>
          </div>
          <div className="campos">
            <div className="campo">
              <label htmlFor="r-cat">Categoria</label>
              <select id="r-cat" value={form.planoContaId} onChange={(e) => setForm({ ...form, planoContaId: e.target.value })}>
                <OpcoesCategoria plano={cadastros.plano} tipo="despesa" atual={form.planoContaId} />
              </select>
            </div>
            <div className="campo">
              <label htmlFor="r-cc">Centro de custo</label>
              <select id="r-cc" value={form.centroCustoId} onChange={(e) => setForm({ ...form, centroCustoId: e.target.value })}>
                <option value="">—</option>
                {cadastros.centros.filter((c) => c.ativo).map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="r-v">Veículo</label>
              <select id="r-v" value={form.veiculoId} onChange={(e) => setForm({ ...form, veiculoId: e.target.value })}>
                <option value="">—</option>
                {cadastros.veiculos.map((v) => (
                  <option key={v.id} value={v.id}>{v.codigo}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="acoes">
            <button className="btn btn-primario" type="submit" disabled={ocupado}>Salvar regra</button>
            <button className="btn btn-secundario" type="button" onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </form>
      )}

      <div className="card tabela-caixa">
        {!regras ? (
          <p className="muted">Carregando…</p>
        ) : regras.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nenhuma regra ainda. Ao confirmar a primeira nota, as categorias escolhidas viram regras.</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Vai para</th>
                <th>Origem</th>
                <th style={{ textAlign: 'right' }}>Usada</th>
                <th><span style={{ position: 'absolute', left: -9999 }}>Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {regras.map((r) => (
                <tr key={r.id} style={r.ativo ? undefined : { opacity: 0.55 }}>
                  <td className="small">
                    {r.fornecedorNome ? <strong>{r.fornecedorNome}</strong> : 'Qualquer fornecedor'}
                    {r.textoContem && <div>item contém “{r.textoContem}”</div>}
                    {r.ncm && <div className="mono">NCM {r.ncm}…</div>}
                  </td>
                  <td className="small">
                    {r.planoNome}
                    <div className="muted">{[r.centroNome, r.veiculoCodigo].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className="small">{r.origem === 'aprendida' ? 'Aprendida' : r.origem === 'ia' ? 'IA' : 'Criada à mão'}</td>
                  <td className="mono small" style={{ textAlign: 'right' }}>{r.vezesAplicada}×</td>
                  <td>
                    <button className="btn btn-link" type="button" onClick={() => alternar(r)}>
                      {r.ativo ? 'Desativar' : 'Reativar'}
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
