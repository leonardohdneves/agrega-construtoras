// Lista para o comercial: propostas geradas, quem aceitou e o período de testes.
import { useEffect, useState } from 'react';
import { api } from '../api';

type Aceite = {
  cliente: string;
  diasTeste: number;
  expiraEm: string;
  status: 'pendente' | 'aceito' | 'expirada';
  aceitoEm: string | null;
  aceitoPor: string | null;
  documento: string | null;
  testeInicio: string | null;
  testeFim: string | null;
};

const ROTULO: Record<Aceite['status'], string> = { pendente: 'Aguardando aceite', aceito: 'Aceita', expirada: 'Expirada' };
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

export function AceitesProposta() {
  const [lista, setLista] = useState<Aceite[] | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    api<{ aceites: Aceite[] }>('/aceite/admin/aceites')
      .then((r) => setLista(r.aceites))
      .catch((e: Error) => setErro(e.message));
  }, []);

  if (erro) return <div className="alerta alerta-erro" role="alert">{erro}</div>;
  if (!lista) return null;
  if (lista.length === 0) return null;

  return (
    <div className="card tabela-caixa" style={{ marginBottom: 16 }}>
      <h2>Propostas e aceites</h2>
      <table className="tabela">
        <thead>
          <tr>
            <th>Cliente</th>
            <th>Situação</th>
            <th>Aceite</th>
            <th>Teste</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((a, i) => (
            <tr key={`${a.cliente}-${i}`}>
              <td>{a.cliente}</td>
              <td><span className="selo selo-neutro">{ROTULO[a.status]}</span></td>
              <td>
                {a.aceitoEm ? (
                  <>
                    {dataHora(a.aceitoEm)}
                    <div className="ajuda">{a.aceitoPor} · {a.documento}</div>
                  </>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td>
                {a.testeInicio ? `${a.testeInicio} a ${a.testeFim}` : <span className="muted">{a.diasTeste} dias ao aceitar</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
