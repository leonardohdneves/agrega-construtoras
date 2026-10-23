// Patrimônio da construtora: ferramentas e equipamentos próprios, com retirada e devolução por obra e depreciação linear.
import { useEffect, useState, type FormEvent } from 'react';
import { api, formatarData, formatarMoeda, lerNumero, moedaCampo } from '../api';
import { useSessao } from '../sessao';

type Bem = {
  id: string; codigo: string; nome: string; marca: string | null; serie: string | null; dataAquisicao: string;
  valorAquisicao: number; valorResidual: number; vidaUtilMeses: number; status: string;
  obraId: string | null; obraCodigo: string | null; obraNome: string | null; responsavel: string | null;
  depreciacao: { mensal: number; acumulada: number; contabil: number; mesesUsados: number };
};
type Movimento = { tipo: string; data: string; responsavel: string | null; estado: string | null; observacao: string | null; obra: string; registradoPor: string | null };
type Obra = { id: string; codigo: string; nome: string };

const ROTULO_STATUS: Record<string, string> = { disponivel: 'Disponível', em_uso: 'Em uso', manutencao: 'Em manutenção', baixado: 'Baixado' };
const FORM_VAZIO = { nome: '', marca: '', serie: '', dataAquisicao: '', valorAquisicao: '', valorResidual: '', vidaUtilMeses: '' };

export function SupPatrimonio() {
  const { usuario } = useSessao();
  const cadastro = !!usuario && (usuario.administrador || usuario.perfil === 'dono' || usuario.perfil === 'gestor');
  const [bens, setBens] = useState<Bem[] | null>(null);
  const [obras, setObras] = useState<Obra[]>([]);
  const [selecionado, setSelecionado] = useState<{ bem: Bem; movimentos: Movimento[] } | null>(null);
  const [novo, setNovo] = useState(false);
  const [form, setForm] = useState(FORM_VAZIO);
  const [retirada, setRetirada] = useState({ obraId: '', responsavel: '', observacao: '' });
  const [devolucao, setDevolucao] = useState({ estado: 'disponivel', observacao: '' });
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const carregarLista = () => api<{ bens: Bem[] }>('/sup/patrimonio').then((r) => setBens(r.bens)).catch((e) => setErro((e as Error).message));
  useEffect(() => {
    carregarLista();
    api<{ obras: Obra[] }>('/eng/obras').then((r) => setObras(r.obras)).catch(() => setObras([]));
  }, []);

  async function abrir(id: string) {
    setErro('');
    setAviso('');
    try {
      const r = await api<{ bem: Bem; movimentos: Movimento[] }>(`/sup/patrimonio/${id}`);
      setSelecionado(r);
      setRetirada({ obraId: '', responsavel: '', observacao: '' });
      setDevolucao({ estado: 'disponivel', observacao: '' });
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function executar(caminho: string, corpo: unknown, msg: string, metodo = 'POST') {
    setErro('');
    setAviso('');
    setOcupado(true);
    try {
      await api(caminho, { metodo, corpo });
      setAviso(msg);
      await carregarLista();
      if (selecionado) await abrir(selecionado.bem.id);
      if (metodo === 'POST' && caminho === '/sup/patrimonio') setNovo(false);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  function salvarNovo(e: FormEvent) {
    e.preventDefault();
    const corpo = {
      nome: form.nome,
      marca: form.marca,
      serie: form.serie,
      dataAquisicao: form.dataAquisicao,
      valorAquisicao: form.valorAquisicao,
      valorResidual: form.valorResidual || '0',
      vidaUtilMeses: form.vidaUtilMeses,
    };
    const valor = lerNumero(form.valorAquisicao);
    if (!valor || valor <= 0) return setErro('Informe o valor de aquisição.');
    executar('/sup/patrimonio', corpo, 'Bem cadastrado.');
    setForm(FORM_VAZIO);
  }

  function retirar(e: FormEvent) {
    e.preventDefault();
    if (!selecionado) return;
    executar(`/sup/patrimonio/${selecionado.bem.id}/retirar`, retirada, 'Retirada registrada.');
  }

  function devolver(e: FormEvent) {
    e.preventDefault();
    if (!selecionado) return;
    executar(`/sup/patrimonio/${selecionado.bem.id}/devolver`, devolucao, 'Devolução registrada.');
  }

  const bem = selecionado?.bem;

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Ferramentas e equipamentos</h1>
          <span className="muted">Patrimônio próprio: retirada e devolução por obra, com depreciação linear pela vida útil.</span>
        </div>
        {cadastro && (
          <div className="acoes">
            <button className="btn btn-primario" type="button" onClick={() => setNovo((v) => !v)}>{novo ? 'Fechar cadastro' : 'Cadastrar bem'}</button>
          </div>
        )}
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}

      {novo && cadastro && (
        <form className="card form" onSubmit={salvarNovo}>
          <h2>Novo bem</h2>
          <div className="campos">
            <div className="campo largo">
              <label htmlFor="pt-nome">Nome</label>
              <input id="pt-nome" value={form.nome} placeholder="Ex.: Furadeira de impacto" onChange={(e) => setForm({ ...form, nome: e.target.value })} required />
            </div>
            <div className="campo">
              <label htmlFor="pt-marca">Marca</label>
              <input id="pt-marca" value={form.marca} onChange={(e) => setForm({ ...form, marca: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="pt-serie">Número de série</label>
              <input id="pt-serie" value={form.serie} onChange={(e) => setForm({ ...form, serie: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="pt-data">Data de aquisição</label>
              <input id="pt-data" type="date" value={form.dataAquisicao} onChange={(e) => setForm({ ...form, dataAquisicao: e.target.value })} required />
            </div>
            <div className="campo">
              <label htmlFor="pt-valor">Valor de aquisição (R$)</label>
              <input id="pt-valor" className="mono" inputMode="decimal" value={form.valorAquisicao} onChange={(e) => setForm({ ...form, valorAquisicao: e.target.value })} required />
            </div>
            <div className="campo">
              <label htmlFor="pt-residual">Valor residual (R$)</label>
              <input id="pt-residual" className="mono" inputMode="decimal" value={form.valorResidual} placeholder="0,00" onChange={(e) => setForm({ ...form, valorResidual: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="pt-vida">Vida útil (meses)</label>
              <input id="pt-vida" inputMode="numeric" value={form.vidaUtilMeses} onChange={(e) => setForm({ ...form, vidaUtilMeses: e.target.value })} required />
            </div>
          </div>
          <div className="acoes">
            <button className="btn btn-primario" type="submit" disabled={ocupado}>Cadastrar</button>
          </div>
        </form>
      )}

      <div className="card">
        {bens === null ? <p className="muted">Carregando…</p> : bens.length === 0 ? <p className="muted">Nenhum bem cadastrado.</p> : (
          <table className="tabela">
            <thead>
              <tr><th>Código</th><th>Bem</th><th>Situação</th><th>Obra</th><th>Responsável</th><th className="n">Depreciação/mês</th><th className="n">Valor contábil</th><th></th></tr>
            </thead>
            <tbody>
              {bens.map((b) => (
                <tr key={b.id}>
                  <td className="mono">{b.codigo}</td>
                  <td>{b.nome}{b.marca ? <span className="small muted"> · {b.marca}</span> : null}</td>
                  <td>{ROTULO_STATUS[b.status] ?? b.status}</td>
                  <td>{b.obraCodigo ? `${b.obraCodigo} · ${b.obraNome}` : '—'}</td>
                  <td>{b.responsavel ?? '—'}</td>
                  <td className="n mono">{formatarMoeda(b.depreciacao.mensal)}</td>
                  <td className="n mono">{formatarMoeda(b.depreciacao.contabil)}</td>
                  <td><button className="btn btn-link" type="button" onClick={() => abrir(b.id)}>Abrir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {bem && selecionado && (
        <div className="card">
          <div className="cabecalho">
            <div className="titulo">
              <h2>{bem.codigo} · {bem.nome}</h2>
              <span className="muted">{ROTULO_STATUS[bem.status] ?? bem.status}{bem.obraCodigo ? ` · ${bem.obraCodigo} · ${bem.obraNome}` : ''}{bem.responsavel ? ` · ${bem.responsavel}` : ''}</span>
            </div>
          </div>
          <div className="campos">
            <div className="campo"><span className="small muted">Aquisição</span><b>{formatarData(bem.dataAquisicao)} · {formatarMoeda(bem.valorAquisicao)}</b></div>
            <div className="campo"><span className="small muted">Vida útil</span><b>{bem.vidaUtilMeses} meses (residual {formatarMoeda(bem.valorResidual)})</b></div>
            <div className="campo"><span className="small muted">Depreciação mensal</span><b>{formatarMoeda(bem.depreciacao.mensal)}</b></div>
            <div className="campo"><span className="small muted">Depreciação acumulada</span><b>{formatarMoeda(bem.depreciacao.acumulada)} ({bem.depreciacao.mesesUsados} de {bem.vidaUtilMeses} meses)</b></div>
            <div className="campo"><span className="small muted">Valor contábil</span><b>{formatarMoeda(bem.depreciacao.contabil)}</b></div>
          </div>

          {bem.status === 'disponivel' && (
            <form className="form" onSubmit={retirar} style={{ marginTop: 16 }}>
              <h3>Retirar para uma obra</h3>
              <div className="campos">
                <div className="campo">
                  <label htmlFor="pt-obra">Obra</label>
                  <select id="pt-obra" value={retirada.obraId} onChange={(e) => setRetirada({ ...retirada, obraId: e.target.value })} required>
                    <option value="">Escolha a obra</option>
                    {obras.map((o) => <option key={o.id} value={o.id}>{o.codigo} · {o.nome}</option>)}
                  </select>
                </div>
                <div className="campo">
                  <label htmlFor="pt-resp">Quem está retirando</label>
                  <input id="pt-resp" value={retirada.responsavel} onChange={(e) => setRetirada({ ...retirada, responsavel: e.target.value })} required />
                </div>
                <div className="campo largo">
                  <label htmlFor="pt-obs-ret">Observação</label>
                  <input id="pt-obs-ret" value={retirada.observacao} onChange={(e) => setRetirada({ ...retirada, observacao: e.target.value })} />
                </div>
              </div>
              <div className="acoes"><button className="btn btn-primario" type="submit" disabled={ocupado}>Registrar retirada</button></div>
            </form>
          )}

          {bem.status === 'em_uso' && (
            <form className="form" onSubmit={devolver} style={{ marginTop: 16 }}>
              <h3>Devolver</h3>
              <div className="campos">
                <div className="campo">
                  <label htmlFor="pt-estado">Estado ao devolver</label>
                  <select id="pt-estado" value={devolucao.estado} onChange={(e) => setDevolucao({ ...devolucao, estado: e.target.value })}>
                    <option value="disponivel">Bom, disponível</option>
                    <option value="manutencao">Precisa de manutenção</option>
                  </select>
                </div>
                <div className="campo largo">
                  <label htmlFor="pt-obs-dev">Observação</label>
                  <input id="pt-obs-dev" value={devolucao.observacao} onChange={(e) => setDevolucao({ ...devolucao, observacao: e.target.value })} />
                </div>
              </div>
              <div className="acoes"><button className="btn btn-primario" type="submit" disabled={ocupado}>Registrar devolução</button></div>
            </form>
          )}

          {cadastro && bem.status !== 'em_uso' && (
            <div className="acoes" style={{ marginTop: 16 }}>
              {bem.status !== 'disponivel' && <button className="btn btn-secundario" type="button" disabled={ocupado} onClick={() => executar(`/sup/patrimonio/${bem.id}/situacao`, { status: 'disponivel' }, 'Bem marcado como disponível.')}>Marcar como disponível</button>}
              {bem.status !== 'manutencao' && <button className="btn btn-secundario" type="button" disabled={ocupado} onClick={() => executar(`/sup/patrimonio/${bem.id}/situacao`, { status: 'manutencao' }, 'Bem enviado para manutenção.')}>Enviar para manutenção</button>}
              {bem.status !== 'baixado' && <button className="btn btn-link" type="button" disabled={ocupado} onClick={() => executar(`/sup/patrimonio/${bem.id}/situacao`, { status: 'baixado' }, 'Bem baixado.')}>Dar baixa</button>}
            </div>
          )}

          <h3 style={{ marginTop: 16 }}>Histórico</h3>
          {selecionado.movimentos.length === 0 ? <p className="muted">Sem retiradas ou devoluções.</p> : (
            <table className="tabela">
              <thead><tr><th>Data</th><th>Movimento</th><th>Obra</th><th>Responsável</th><th>Estado</th><th>Registrado por</th><th>Observação</th></tr></thead>
              <tbody>
                {selecionado.movimentos.map((m, i) => (
                  <tr key={i}>
                    <td>{formatarData(m.data)}</td>
                    <td>{m.tipo === 'retirada' ? 'Retirada' : 'Devolução'}</td>
                    <td>{m.obra}</td>
                    <td>{m.responsavel ?? '—'}</td>
                    <td>{m.estado === 'manutencao' ? 'Em manutenção' : m.estado === 'disponivel' ? 'Disponível' : '—'}</td>
                    <td>{m.registradoPor ?? '—'}</td>
                    <td>{m.observacao ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
