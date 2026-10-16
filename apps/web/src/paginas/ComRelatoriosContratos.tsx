// Comercial · Relatório de contratos com clientes no período, por tipo e por cliente.
import { useEffect, useState } from 'react';
import { api, formatarMoeda } from '../api';

type Linha = { nome: string; contratos: number; valor: number };
type Resposta = { de: string; ate: string; total: { contratos: number; valor: number }; porTipo: Linha[]; porCliente: Linha[] };

function primeiroDia(mes: string) {
  return `${mes}-01`;
}
function ultimoDia(mes: string) {
  const [a, m] = mes.split('-').map(Number);
  return new Date(a, m, 0).toISOString().slice(0, 10);
}

function Tabela({ titulo, linhas }: { titulo: string; linhas: Linha[] }) {
  return (
    <div className="card" style={{ padding: 0, overflowX: 'auto', marginBottom: 12 }}>
      <h2 style={{ margin: '12px 16px' }}>{titulo}</h2>
      {linhas.length === 0 ? (
        <p className="muted" style={{ margin: '0 16px 16px' }}>Nenhum contrato no período.</p>
      ) : (
        <table className="tabela">
          <thead>
            <tr>
              <th>Nome</th>
              <th className="num">Contratos</th>
              <th className="num">Valor contratado</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.nome}>
                <td>{l.nome}</td>
                <td className="num">{l.contratos}</td>
                <td className="num">{formatarMoeda(l.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function ComRelatoriosContratos() {
  const hoje = new Date();
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  const [de, setDe] = useState(mesAtual);
  const [ate, setAte] = useState(mesAtual);
  const [r, setR] = useState<Resposta | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    setR(null);
    setErro('');
    api<Resposta>(`/com/contratos-cliente/relatorio?de=${primeiroDia(de)}&ate=${ultimoDia(ate)}`)
      .then(setR)
      .catch((e) => setErro((e as Error).message));
  }, [de, ate]);

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Relatórios comerciais</h1>
          <span className="muted">Contratos com clientes criados no período, por tipo de contrato e por cliente.</span>
        </div>
      </div>
      <div className="acoes" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <div className="campo"><label htmlFor="rel-de">De (mês)</label><input id="rel-de" type="month" value={de} onChange={(e) => e.target.value && setDe(e.target.value)} /></div>
        <div className="campo"><label htmlFor="rel-ate">Até (mês)</label><input id="rel-ate" type="month" value={ate} onChange={(e) => e.target.value && setAte(e.target.value)} /></div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {!r && !erro && <p className="muted">Carregando…</p>}
      {r && (
        <>
          <div className="grade">
            <div className="card indicador"><span className="rotulo-ind">Contratos</span><span className="valor-ind mono">{r.total.contratos}</span></div>
            <div className="card indicador"><span className="rotulo-ind">Valor contratado</span><span className="valor-ind mono">{formatarMoeda(r.total.valor)}</span></div>
          </div>
          <Tabela titulo="Por tipo de contrato" linhas={r.porTipo} />
          <Tabela titulo="Por cliente" linhas={r.porCliente} />
        </>
      )}
    </>
  );
}
