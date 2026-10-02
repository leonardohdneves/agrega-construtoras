import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  api,
  CLASSE_STATUS_VEICULO,
  formatarNumero,
  formatarPlaca,
  NOMES_STATUS_VEICULO,
  NOMES_TIPO_VEICULO,
  type StatusVeiculo,
  type Veiculo,
} from '../api';
import { FormVeiculo, dadosDoVeiculo } from '../componentes/FormVeiculo';

type Filtro = 'todos' | StatusVeiculo;

export function Veiculos() {
  const navegar = useNavigate();
  const [lista, setLista] = useState<Veiculo[] | null>(null);
  const [erro, setErro] = useState('');
  const [novo, setNovo] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [busca, setBusca] = useState('');

  const carregar = useCallback(async () => {
    try {
      setLista((await api<{ veiculos: Veiculo[] }>('/frota/veiculos')).veiculos);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  const contagem = useMemo(() => {
    const c: Record<string, number> = { todos: 0, disponivel: 0, manutencao: 0, parado: 0, inativo: 0 };
    for (const v of lista ?? []) {
      c[v.status]++;
      if (v.status !== 'inativo') c.todos++;
    }
    return c;
  }, [lista]);

  const visiveis = (lista ?? []).filter((v) => {
    if (filtro === 'todos' ? v.status === 'inativo' : v.status !== filtro) return false;
    const t = busca.trim().toUpperCase();
    return !t || v.codigo.includes(t) || (v.placa ?? '').includes(t.replace(/[^A-Z0-9]/g, '')) || (v.marcaModelo ?? '').toUpperCase().includes(t);
  });

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Veículos</h1>
          <span className="muted">Betoneiras, bombas e veículos de apoio da frota.</span>
        </div>
        {!novo && (
          <button className="btn btn-primario" type="button" onClick={() => setNovo(true)}>
            Novo veículo
          </button>
        )}
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}

      {novo && (
        <FormVeiculo
          titulo="Novo veículo"
          rotuloSalvar="Cadastrar veículo"
          inicial={dadosDoVeiculo()}
          aoCancelar={() => setNovo(false)}
          aoSalvar={async (d) => {
            const r = await api<{ veiculo: Veiculo }>('/frota/veiculos', { corpo: d });
            setNovo(false);
            navegar(`/frota/veiculos/${r.veiculo.id}`);
          }}
        />
      )}

      <div className="filtros" role="group" aria-label="Filtrar por situação">
        {(['todos', 'disponivel', 'manutencao', 'parado', 'inativo'] as Filtro[]).map((f) => (
          <button key={f} type="button" className={`chip ${filtro === f ? 'chip-ativo' : ''}`} aria-pressed={filtro === f} onClick={() => setFiltro(f)}>
            {f === 'todos' ? 'Em operação' : NOMES_STATUS_VEICULO[f]} <span className="mono">{contagem[f]}</span>
          </button>
        ))}
        <input className="busca" type="search" aria-label="Buscar veículo" placeholder="Buscar código, placa ou modelo" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>

      <div className="card tabela-caixa">
        {!lista ? (
          <p className="muted">Carregando…</p>
        ) : visiveis.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            {lista.length === 0 ? 'Nenhum veículo cadastrado. Comece pelo botão Novo veículo.' : 'Nenhum veículo neste filtro.'}
          </p>
        ) : (
          <table className="tabela">
            <thead>
              <tr>
                <th>Veículo</th>
                <th>Tipo</th>
                <th>Placa</th>
                <th style={{ textAlign: 'right' }}>Km</th>
                <th style={{ textAlign: 'right' }}>Horímetro</th>
                <th>Documentos</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((v) => (
                <tr key={v.id}>
                  <td>
                    <Link to={`/frota/veiculos/${v.id}`} className="mono" style={{ fontWeight: 500 }}>
                      {v.codigo}
                    </Link>
                    <div className="small muted">{v.marcaModelo ?? ''}</div>
                  </td>
                  <td>
                    {NOMES_TIPO_VEICULO[v.tipo]}
                    {v.capacidadeM3 ? <span className="small muted"> · {formatarNumero(v.capacidadeM3, 0)} m³</span> : null}
                    {v.alcanceLancaM ? <span className="small muted"> · {formatarNumero(v.alcanceLancaM, 0)} m</span> : null}
                  </td>
                  <td className="mono">{formatarPlaca(v.placa)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{formatarNumero(v.kmAtual)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{formatarNumero(v.horimetroAtual)} h</td>
                  <td>
                    {v.docsVencidos ? (
                      <span className="selo selo-perigo">{v.docsVencidos} vencido{v.docsVencidos > 1 ? 's' : ''}</span>
                    ) : v.docsVencendo ? (
                      <span className="selo selo-aviso">{v.docsVencendo} a vencer</span>
                    ) : (
                      <span className="selo selo-ok">Em dia</span>
                    )}
                  </td>
                  <td>
                    <span className={`selo ${CLASSE_STATUS_VEICULO[v.status]}`}>{NOMES_STATUS_VEICULO[v.status]}</span>
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
