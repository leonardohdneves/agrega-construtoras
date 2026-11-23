// Administrador do sistema · Histórico do contrato de uma construtora: o cadastro e cada alteração de pacote, módulos,
// recursos do canteiro, limites e período de teste, com data, quem alterou e o que mudou.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';

type Registro = { id: string; quando: string; quem: string | null; tipo: 'cadastro' | 'alteracao'; mudancas: string[] };
type Resposta = { empresa: { nome: string }; historico: Registro[] };

const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function AdminContratoHistorico() {
  const { id = '' } = useParams();
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    setDados(null);
    setErro('');
    api<Resposta>(`/admin/empresas/${id}/contrato/historico`).then(setDados).catch((e) => setErro((e as Error).message));
  }, [id]);

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Histórico do contrato</h1>
          <span className="muted">{dados ? dados.empresa.nome : 'Carregando…'}</span>
        </div>
        <div className="acoes nao-imprimir">
          <Link className="btn" to="/admin/empresas">Voltar às construtoras</Link>
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {dados && dados.historico.length === 0 && <p className="muted">Nenhum registro de contrato para esta empresa.</p>}
      {dados && dados.historico.length > 0 && (
        <div className="card">
          <table className="tabela">
            <thead>
              <tr><th>Data</th><th>Quem alterou</th><th>O que mudou</th></tr>
            </thead>
            <tbody>
              {dados.historico.map((h) => (
                <tr key={h.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{dataHora(h.quando)}</td>
                  <td>{h.quem ?? '—'}</td>
                  <td>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {h.mudancas.map((m, i) => <li key={i}>{m}</li>)}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
