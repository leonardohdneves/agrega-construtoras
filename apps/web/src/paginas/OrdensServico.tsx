import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, CLASSE_STATUS_OS, formatarData, formatarMoeda, NOMES_STATUS_OS, type OrdemServico, type Veiculo } from '../api';

type Filtro = 'abertas' | 'concluida' | 'cancelada' | 'todas';
const FILTROS: { id: Filtro; texto: string }[] = [
  { id: 'abertas', texto: 'Abertas' },
  { id: 'concluida', texto: 'Concluídas' },
  { id: 'cancelada', texto: 'Canceladas' },
  { id: 'todas', texto: 'Todas' },
];

export function OrdensServico() {
  const [filtro, setFiltro] = useState<Filtro>('abertas');
  const [veiculoId, setVeiculoId] = useState('');
  const [dias, setDias] = useState(90);
  const [veiculos, setVeiculos] = useState<Veiculo[]>([]);
  const [ordens, setOrdens] = useState<OrdemServico[] | null>(null);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    setOrdens(null);
    try {
      const q = new URLSearchParams({ dias: String(dias) });
      if (filtro !== 'todas') q.set('status', filtro);
      if (veiculoId) q.set('veiculoId', veiculoId);
      setOrdens((await api<{ ordens: OrdemServico[] }>(`/frota/os?${q}`)).ordens);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [filtro, veiculoId, dias]);

  useEffect(() => {
    carregar();
  }, [carregar]);
  useEffect(() => {
    api<{ veiculos: Veiculo[] }>('/frota/veiculos').then((r) => setVeiculos(r.veiculos)).catch(() => {});
  }, []);

  const total = (ordens ?? []).reduce((s, o) => s + (o.status === 'cancelada' ? 0 : o.total), 0);

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Ordens de serviço</h1>
          <span className="muted">Manutenções preventivas e corretivas. Ao abrir uma OS o veículo pode ficar em manutenção até ser liberado.</span>
        </div>
        <Link className="btn btn-primario" to="/frota/os/nova">
          Abrir ordem de serviço
        </Link>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}

      <div className="filtros">
        {FILTROS.map((f) => (
          <button key={f.id} type="button" className={`chip ${filtro === f.id ? 'chip-ativo' : ''}`} aria-pressed={filtro === f.id} onClick={() => setFiltro(f.id)}>
            {f.texto}
          </button>
        ))}
        <select aria-label="Filtrar por veículo" className="busca mono" value={veiculoId} onChange={(e) => setVeiculoId(e.target.value)}>
          <option value="">Todos os veículos</option>
          {veiculos.map((v) => (
            <option key={v.id} value={v.id}>
              {v.codigo}
            </option>
          ))}
        </select>
        {filtro !== 'abertas' && (
          <select aria-label="Período" className="busca" style={{ marginLeft: 0 }} value={dias} onChange={(e) => setDias(Number(e.target.value))}>
            <option value={30}>Últimos 30 dias</option>
            <option value={90}>Últimos 90 dias</option>
            <option value={365}>Últimos 12 meses</option>
          </select>
        )}
      </div>

      <div className="card tabela-caixa">
        {!ordens ? (
          <p className="muted">Carregando…</p>
        ) : ordens.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            {filtro === 'abertas' ? 'Nenhuma ordem de serviço aberta. A frota está liberada.' : 'Nenhuma ordem de serviço no período.'}
          </p>
        ) : (
          <table className="tabela">
            <thead>
              <tr>
                <th>OS</th>
                <th>Veículo</th>
                <th>Tipo</th>
                <th>Serviço / defeito</th>
                <th>Oficina</th>
                <th>Abertura</th>
                <th>Dias</th>
                <th>Situação</th>
                <th style={{ textAlign: 'right' }}>Custo</th>
              </tr>
            </thead>
            <tbody>
              {ordens.map((o) => (
                <tr key={o.id}>
                  <td className="mono">
                    <Link to={`/frota/os/${o.id}`} style={{ fontWeight: 600 }}>
                      #{o.numero}
                    </Link>
                  </td>
                  <td className="mono">{o.veiculoCodigo}</td>
                  <td className="small">{o.tipo === 'preventiva' ? 'Preventiva' : 'Corretiva'}</td>
                  <td className="small" style={{ maxWidth: 320 }}>{o.descricao}</td>
                  <td className="small">{o.oficina === 'interna' ? 'Própria' : o.fornecedorNome ?? 'Externa'}</td>
                  <td className="mono small">{formatarData(o.abertura)}</td>
                  <td className="mono small">{o.dias ?? '—'}</td>
                  <td>
                    <span className={`selo ${CLASSE_STATUS_OS[o.status]}`}>{NOMES_STATUS_OS[o.status]}</span>
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(o.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={8} className="small muted">
                  {ordens.length} {ordens.length === 1 ? 'ordem' : 'ordens'}
                </td>
                <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{formatarMoeda(total)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </>
  );
}
