import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  formatarDataHoraCurta,
  formatarMoeda,
  formatarNumero,
  type Abastecimento,
  type ConsumoVeiculo,
  type Motorista,
  type Veiculo,
} from '../api';
import { FormAbastecimento } from '../componentes/FormAbastecimento';

const PERIODOS = [7, 30, 90];

export function Abastecimentos() {
  const [dias, setDias] = useState(30);
  const [veiculoId, setVeiculoId] = useState('');
  const [lista, setLista] = useState<Abastecimento[] | null>(null);
  const [consumo, setConsumo] = useState<ConsumoVeiculo[]>([]);
  const [veiculos, setVeiculos] = useState<Veiculo[]>([]);
  const [motoristas, setMotoristas] = useState<Motorista[]>([]);
  const [editando, setEditando] = useState<Abastecimento | null>(null);
  const [excluir, setExcluir] = useState<Abastecimento | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  const carregar = useCallback(async () => {
    try {
      const filtro = `dias=${dias}${veiculoId ? `&veiculoId=${veiculoId}` : ''}`;
      const [a, c] = await Promise.all([
        api<{ abastecimentos: Abastecimento[] }>(`/frota/abastecimentos?${filtro}`),
        api<{ veiculos: ConsumoVeiculo[] }>(`/frota/consumo?dias=${dias}`),
      ]);
      setLista(a.abastecimentos);
      setConsumo(c.veiculos);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [dias, veiculoId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    api<{ veiculos: Veiculo[] }>('/frota/veiculos').then((r) => setVeiculos(r.veiculos)).catch(() => {});
    api<{ motoristas: Motorista[] }>('/frota/motoristas').then((r) => setMotoristas(r.motoristas)).catch(() => {});
  }, []);

  async function confirmarExclusao() {
    if (!excluir) return;
    try {
      await api(`/frota/abastecimentos/${excluir.id}`, { metodo: 'DELETE' });
      setAviso(`Abastecimento do ${excluir.veiculoCodigo} excluído.`);
      setExcluir(null);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  const totLitros = (lista ?? []).reduce((s, a) => s + a.litros, 0);
  const totValor = (lista ?? []).reduce((s, a) => s + (a.valorTotal ?? 0), 0);
  const consumoVisivel = consumo.filter((c) => !veiculoId || c.veiculoId === veiculoId);

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Abastecimentos</h1>
          <span className="muted">Consumo da frota e registros lançados pelos motoristas.</span>
        </div>
        <Link className="btn btn-primario" to="/abastecer">
          Registrar abastecimento
        </Link>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}

      <div className="filtros">
        {PERIODOS.map((p) => (
          <button key={p} type="button" className={`chip ${dias === p ? 'chip-ativo' : ''}`} aria-pressed={dias === p} onClick={() => setDias(p)}>
            {p} dias
          </button>
        ))}
        <select aria-label="Filtrar por veículo" className="busca mono" value={veiculoId} onChange={(e) => setVeiculoId(e.target.value)}>
          <option value="">Todos os veículos</option>
          {veiculos.map((v) => (
            <option key={v.id} value={v.id}>{v.codigo}</option>
          ))}
        </select>
      </div>

      <div className="indicadores">
        <div className="card indicador">
          <span className="rotulo-ind">Abastecimentos</span>
          <span className="valor-ind mono">{lista ? formatarNumero(lista.length) : '—'}</span>
        </div>
        <div className="card indicador">
          <span className="rotulo-ind">Litros</span>
          <span className="valor-ind mono">{lista ? formatarNumero(totLitros) : '—'}</span>
        </div>
        <div className="card indicador">
          <span className="rotulo-ind">Valor informado</span>
          <span className="valor-ind mono">{lista ? formatarMoeda(totValor) : '—'}</span>
        </div>
        <div className="card indicador">
          <span className="rotulo-ind">Preço médio por litro</span>
          <span className="valor-ind mono">{totLitros > 0 && totValor > 0 ? formatarMoeda(totValor / totLitros) : '—'}</span>
        </div>
      </div>

      <div className="card tabela-caixa">
        <h2>Consumo por veículo</h2>
        {consumoVisivel.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Sem abastecimentos no período.</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr>
                <th>Veículo</th>
                <th style={{ textAlign: 'right' }}>Litros</th>
                <th style={{ textAlign: 'right' }}>Rodou</th>
                <th style={{ textAlign: 'right' }}>km/L</th>
                <th style={{ textAlign: 'right' }}>L/h</th>
                <th style={{ textAlign: 'right' }}>Média 90 dias</th>
                <th>Último abastecimento</th>
              </tr>
            </thead>
            <tbody>
              {consumoVisivel.map((c) => (
                <tr key={c.veiculoId}>
                  <td>
                    <Link to={`/frota/veiculos/${c.veiculoId}`} className="mono" style={{ fontWeight: 500 }}>
                      {c.codigo}
                    </Link>
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>{formatarNumero(c.litros)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    {c.km ? `${formatarNumero(c.km)} km` : ''}
                    {c.km && c.horas ? ' · ' : ''}
                    {c.horas ? `${formatarNumero(c.horas)} h` : ''}
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>{c.kmPorLitro ? formatarNumero(c.kmPorLitro, 2) : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{c.litrosPorHora ? formatarNumero(c.litrosPorHora, 1) : '—'}</td>
                  <td className="mono small muted" style={{ textAlign: 'right' }}>
                    {c.media90.kmPorLitro ? `${formatarNumero(c.media90.kmPorLitro, 2)} km/L` : c.media90.litrosPorHora ? `${formatarNumero(c.media90.litrosPorHora, 1)} L/h` : '—'}
                  </td>
                  <td>
                    {c.piora !== null ? (
                      <span className="selo selo-aviso">{formatarNumero(c.piora * 100)}% pior que a média</span>
                    ) : c.ultimo ? (
                      <span className="selo selo-ok">Dentro da média</span>
                    ) : (
                      <span className="selo selo-neutro">Sem cálculo</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editando && (
        <div className="card">
          <h2>Corrigir abastecimento do {editando.veiculoCodigo}</h2>
          <FormAbastecimento
            veiculos={veiculos}
            motoristas={motoristas}
            gestao
            editando={editando}
            aoCancelar={() => setEditando(null)}
            aoSalvar={async (a) => {
              setEditando(null);
              setAviso(`Abastecimento do ${a.veiculoCodigo} corrigido.`);
              await carregar();
            }}
          />
        </div>
      )}

      {excluir && (
        <div className="alerta alerta-aviso" role="alert" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ flex: 1 }}>
            Excluir o abastecimento do {excluir.veiculoCodigo} de {formatarDataHoraCurta(excluir.dataHora)} ({formatarNumero(excluir.litros, 1)} L)?
          </span>
          <button className="btn btn-primario" type="button" onClick={confirmarExclusao}>
            Excluir
          </button>
          <button className="btn btn-secundario" type="button" onClick={() => setExcluir(null)}>
            Manter
          </button>
        </div>
      )}

      <div className="card tabela-caixa">
        <h2>Registros</h2>
        {!lista ? (
          <p className="muted">Carregando…</p>
        ) : lista.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nenhum abastecimento no período.</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr>
                <th>Data</th>
                <th>Veículo</th>
                <th>Motorista</th>
                <th style={{ textAlign: 'right' }}>Litros</th>
                <th style={{ textAlign: 'right' }}>Valor</th>
                <th style={{ textAlign: 'right' }}>Km</th>
                <th style={{ textAlign: 'right' }}>Horímetro</th>
                <th style={{ textAlign: 'right' }}>Consumo</th>
                <th>Nota</th>
                <th><span style={{ position: 'absolute', left: -9999 }}>Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((a) => (
                <tr key={a.id}>
                  <td className="mono small">{formatarDataHoraCurta(a.dataHora)}</td>
                  <td className="mono">{a.veiculoCodigo}</td>
                  <td className="small">{a.motoristaNome ?? '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{formatarNumero(a.litros, 1)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(a.valorTotal)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{formatarNumero(a.km)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{a.horimetro != null ? formatarNumero(a.horimetro, 1) : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    {a.kmPorLitro ? `${formatarNumero(a.kmPorLitro, 2)} km/L` : a.litrosPorHora ? `${formatarNumero(a.litrosPorHora, 1)} L/h` : '—'}
                  </td>
                  <td>{a.temNota ? <span className="selo selo-ok">Com nota</span> : <span className="selo selo-neutro">Sem nota</span>}</td>
                  <td>
                    <div className="acoes" style={{ flexWrap: 'nowrap' }}>
                      <button className="btn btn-link" type="button" onClick={() => { setEditando(a); window.scrollTo({ top: 0 }); }}>
                        Corrigir
                      </button>
                      <button className="btn btn-link" type="button" onClick={() => setExcluir(a)}>
                        Excluir
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
