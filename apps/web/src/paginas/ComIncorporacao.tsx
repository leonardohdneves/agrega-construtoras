// Comercial · Incorporação: estudos aprovados do Viabiliza importados para o Agrega.
// Entra com o mesmo e-mail e senha do Viabiliza (a senha não é guardada) e importa só estudos aprovados.
import { useEffect, useState, type FormEvent } from 'react';
import { api, formatarMoeda } from '../api';

type Estudo = { id: string; nome: string; cidade: string | null; uf: string | null; versaoEstudo: string; aprovadoEm: string };
type Divergencia = { codigoExterno: string; motivo: 'preco' | 'removida' | 'permuta'; precoContrato: number | null; precoEstudo: number | null };
type Totais = { recebidas: number; criar: number; atualizar: number; divergencias: number; removidas: number };
type Emp = { id: string; nome: string; cidade: string | null; uf: string | null; versaoEstudo: string; importadoEm: string; unidades: number; disponiveis: number; vendidasOuReservadas: number };
type Unidade = { id: string; codigoExterno: string; nome: string; tipologia: string | null; areaPrivativa: number; preco: number; situacao: string };
type Detalhe = { empreendimento: { id: string; nome: string; versaoEstudo: string }; unidades: Unidade[]; ultimaImportacao: { importadoEm: string; totais: Totais; divergencias: Divergencia[] } | null };

const ROTULO: Record<string, string> = { disponivel: 'Disponível', reservada: 'Reservada', vendida: 'Vendida', permuta: 'Permuta', removida_do_estudo: 'Removida do estudo' };
const MOTIVO: Record<Divergencia['motivo'], string> = { preco: 'Preço mudou no estudo (mantido o do contrato)', removida: 'Saiu do estudo (unidade já vendida ou reservada)', permuta: 'Virou permuta no estudo (unidade já vendida)' };

export function ComIncorporacao() {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [estudos, setEstudos] = useState<Estudo[] | null>(null);
  const [emps, setEmps] = useState<Emp[] | null>(null);
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null);
  const [resultado, setResultado] = useState<{ nome: string; totais: Totais; divergencias: Divergencia[] } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');

  const carregarEmps = () => api<{ empreendimentos: Emp[] }>('/com/incorporacao/empreendimentos').then((r) => setEmps(r.empreendimentos)).catch((e) => setErro((e as Error).message));
  useEffect(() => {
    carregarEmps();
  }, []);

  async function buscar(ev: FormEvent) {
    ev.preventDefault();
    setErro('');
    setOcupado(true);
    try {
      const r = await api<{ estudos: Estudo[] }>('/com/incorporacao/estudos-disponiveis', { corpo: { email, senha } });
      setEstudos(r.estudos);
      setSenha('');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function importar(est: Estudo) {
    setErro('');
    setResultado(null);
    setOcupado(true);
    try {
      const r = await api<{ empreendimentoId: string; importacao: { totais: Totais; divergencias: Divergencia[] } }>('/com/incorporacao/importar', { corpo: { email, senha, estudoId: est.id } });
      setResultado({ nome: est.nome, totais: r.importacao.totais, divergencias: r.importacao.divergencias });
      setEstudos(null);
      setSenha('');
      await carregarEmps();
      await abrir(r.empreendimentoId);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function abrir(id: string) {
    setDetalhe(null);
    try {
      setDetalhe(await api<Detalhe>(`/com/incorporacao/empreendimentos/${id}`));
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Incorporação</h1>
          <span className="muted">Estudos aprovados no Viabiliza. Estrutura, nomes e valores vêm de lá; a venda das unidades é controlada aqui.</span>
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}

      <form className="card form" onSubmit={buscar} style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0 }}>Importar do Viabiliza</h2>
        <p className="ajuda" style={{ marginTop: 0 }}>Use o mesmo e-mail e a mesma senha do Viabiliza. A senha não fica guardada.</p>
        <div className="campos">
          <div className="campo"><label htmlFor="inc-email">E-mail do Viabiliza</label><input id="inc-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="campo"><label htmlFor="inc-senha">Senha</label><input id="inc-senha" type="password" required value={senha} onChange={(e) => setSenha(e.target.value)} /></div>
        </div>
        <div className="acoes"><button className="btn btn-primario" type="submit" disabled={ocupado}>{ocupado ? 'Aguarde…' : 'Buscar estudos aprovados'}</button></div>
      </form>

      {estudos && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h2 style={{ marginTop: 0 }}>Estudos aprovados</h2>
          {estudos.length === 0 ? <p className="muted">Nenhum estudo aprovado disponível para este usuário.</p> : (
            <table className="tabela">
              <thead><tr><th>Empreendimento</th><th>Versão</th><th>Aprovado em</th><th /></tr></thead>
              <tbody>
                {estudos.map((s) => (
                  <tr key={s.id}>
                    <td>{s.nome}<div className="small muted">{[s.cidade, s.uf].filter(Boolean).join('/')}</div></td>
                    <td>{s.versaoEstudo}</td>
                    <td>{s.aprovadoEm}</td>
                    <td><button className="btn btn-secundario" type="button" disabled={ocupado} onClick={() => importar(s)}>Importar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {resultado && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h2 style={{ marginTop: 0 }}>Importação concluída: {resultado.nome}</h2>
          <p>
            {resultado.totais.criar} criada(s), {resultado.totais.atualizar} atualizada(s), {resultado.totais.removidas} removida(s) do estudo, {resultado.totais.divergencias} divergência(s).
          </p>
          {resultado.divergencias.length > 0 && (
            <ul>{resultado.divergencias.map((d) => <li key={d.codigoExterno}><b>{d.codigoExterno}</b>: {MOTIVO[d.motivo]}</li>)}</ul>
          )}
        </div>
      )}

      <div className="card" style={{ padding: 0, overflowX: 'auto', marginBottom: 12 }}>
        <h2 style={{ margin: '12px 16px' }}>Empreendimentos importados</h2>
        {emps?.length === 0 && <p className="muted" style={{ margin: '0 16px 16px' }}>Nenhum ainda.</p>}
        {emps && emps.length > 0 && (
          <table className="tabela">
            <thead><tr><th>Empreendimento</th><th>Versão</th><th className="num">Unidades</th><th className="num">Disponíveis</th><th className="num">Reservadas/vendidas</th></tr></thead>
            <tbody>
              {emps.map((e) => (
                <tr key={e.id}>
                  <td><button className="btn btn-secundario" type="button" onClick={() => abrir(e.id)}>{e.nome}</button></td>
                  <td>{e.versaoEstudo}</td>
                  <td className="num">{e.unidades}</td>
                  <td className="num">{e.disponiveis}</td>
                  <td className="num">{e.vendidasOuReservadas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {detalhe && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <h2 style={{ margin: '12px 16px' }}>Unidades · {detalhe.empreendimento.nome}</h2>
          <table className="tabela">
            <thead><tr><th>Unidade</th><th>Tipologia</th><th className="num">Área (m²)</th><th className="num">Preço</th><th>Situação</th></tr></thead>
            <tbody>
              {detalhe.unidades.map((u) => (
                <tr key={u.id}>
                  <td>{u.nome}</td>
                  <td>{u.tipologia ?? '—'}</td>
                  <td className="num">{u.areaPrivativa.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                  <td className="num">{formatarMoeda(u.preco)}</td>
                  <td>{ROTULO[u.situacao] ?? u.situacao}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
