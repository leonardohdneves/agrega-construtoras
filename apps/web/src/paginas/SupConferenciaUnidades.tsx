import { useEffect, useState } from 'react';
import { api, lerNumero } from '../api';

type Linha = {
  id: string;
  notaNumero: string | null;
  notaStatus: string;
  notaDescricao: string;
  notaUnidade: string | null;
  quantidade: number;
  fatorEstoque: number | null;
  insumoNome: string;
  insumoUnidade: string;
  pedidoNumero: number;
  pedidoUnidade: string;
};

const numero = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 4 });

export function SupConferenciaUnidades() {
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [fatores, setFatores] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState<string | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  async function carregar() {
    try {
      const r = await api<{ linhas: Linha[] }>('/sup/conferencia-unidades');
      setLinhas(r.linhas);
      setFatores(Object.fromEntries(r.linhas.map((l) => [l.id, l.fatorEstoque === null ? '' : String(l.fatorEstoque).replace('.', ',')])));
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  async function salvar(l: Linha) {
    const fator = lerNumero(fatores[l.id] ?? '');
    setErro('');
    setAviso('');
    if (!fator || fator <= 0) {
      setErro(`Informe quantos ${l.insumoUnidade} vale 1 ${l.notaUnidade || 'unidade'} da nota (${l.insumoNome}).`);
      return;
    }
    setSalvando(l.id);
    try {
      await api(`/fin/notas/itens/${l.id}`, { metodo: 'PATCH', corpo: { fatorEstoque: fator } });
      setAviso(`Fator de ${l.insumoNome} salvo na nota ${l.notaNumero ?? ''}.`);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(null);
    }
  }

  return (
    <div className="pagina">
      <h1>Conferência de unidades do estoque</h1>
      <p className="small muted">
        Insumos cuja unidade é diferente da unidade do pedido de compra. A unidade do insumo fica como está; aqui você informa quanto
        do insumo vale cada unidade da nota, para o estoque bater com o pedido.
      </p>
      {erro && <div className="erro">{erro}</div>}
      {aviso && <div className="aviso">{aviso}</div>}
      {linhas === null && !erro && <p className="muted">Carregando…</p>}
      {linhas && linhas.length === 0 && <p className="muted">Nenhuma divergência de unidade entre insumos e pedidos.</p>}
      {linhas && linhas.length > 0 && (
        <div className="tabela-wrap">
          <table className="tabela">
            <thead>
              <tr>
                <th>Insumo</th>
                <th>Unidade do insumo</th>
                <th>Pedido</th>
                <th>Unidade do pedido</th>
                <th>Nota</th>
                <th>Item da nota</th>
                <th style={{ textAlign: 'right' }}>Qtd. nota</th>
                <th>Unidade da nota</th>
                <th>Fator: unid. do insumo por 1 unid. da nota</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.id}>
                  <td>{l.insumoNome}</td>
                  <td>{l.insumoUnidade}</td>
                  <td>nº {l.pedidoNumero}</td>
                  <td>{l.pedidoUnidade}</td>
                  <td>{l.notaNumero ?? '—'}</td>
                  <td className="small">{l.notaDescricao}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{numero(l.quantidade)}</td>
                  <td>{l.notaUnidade || '—'}</td>
                  <td>
                    <input
                      aria-label={`Fator de ${l.insumoNome}`}
                      className="mono"
                      inputMode="decimal"
                      style={{ width: 110 }}
                      value={fatores[l.id] ?? ''}
                      onChange={(e) => setFatores({ ...fatores, [l.id]: e.target.value })}
                    />
                  </td>
                  <td>
                    <button className="btn btn-primario" type="button" disabled={salvando === l.id} onClick={() => salvar(l)}>
                      Salvar
                    </button>
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
