import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, formatarMoeda, formatarNumero, NOMES_TIPO_VEICULO, type TipoVeiculo } from '../api';
import { ATALHOS, SeletorPeriodo, type Periodo } from '../componentes/Periodo';
import { CabecalhoDocumento, textoPeriodo } from '../componentes/Documento';

type Linha = {
  veiculoId: string;
  codigo: string;
  tipo: TipoVeiculo;
  status: string;
  categorias: { codigo: string; nome: string; valor: number }[];
  lancado: number;
  semNota: { diesel: number; abastecimentos: number; manutencao: number; ordens: number };
  total: number;
  km: number;
  horas: number;
  litros: number;
  custoKm: number | null;
  custoHora: number | null;
  m3: number;
  custoM3: number | null;
};
type Resp = { meses: string[]; de: string; ate: string; veiculos: Linha[]; semVeiculo: { codigo: string; nome: string; valor: number }[]; total: number };

export function CustoVeiculo() {
  const [params, setParams] = useSearchParams();
  const padrao = ATALHOS.find((a) => a.id === '3m')!.periodo();
  const periodo: Periodo = { de: params.get('de') ?? padrao.de, ate: params.get('ate') ?? padrao.ate };
  const [r, setR] = useState<Resp | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    setR(null);
    try {
      setR(await api<Resp>(`/ger/custo-veiculo?de=${periodo.de}&ate=${periodo.ate}`));
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [periodo.de, periodo.ate]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  const veics = (r?.veiculos ?? []).slice().sort((a, b) => b.total - a.total);
  const betoneiras = veics.filter((v) => !v.tipo.startsWith('bomba'));
  const bombas = veics.filter((v) => v.tipo.startsWith('bomba'));
  const somaKm = betoneiras.reduce((s, v) => s + v.km, 0);
  const somaCustoBet = betoneiras.reduce((s, v) => s + v.total, 0);
  const somaHoras = bombas.reduce((s, v) => s + v.horas, 0);
  const somaCustoBomba = bombas.reduce((s, v) => s + v.total, 0);
  const semNota = veics.reduce((s, v) => s + v.semNota.diesel + v.semNota.manutencao, 0);
  const semVeiculo = (r?.semVeiculo ?? []).reduce((s, x) => s + x.valor, 0);

  return (
    <>
      <CabecalhoDocumento
        modulo="Gerencial · Frota"
        titulo="Custo por veículo"
        descricao="Diesel, manutenção, pneus, documentos e seguros de cada caminhão e bomba, com o custo por km ou por hora."
        periodo={textoPeriodo(periodo.de, periodo.ate)}
      />
      <div className="nao-imprimir">
        <SeletorPeriodo valor={periodo} aoMudar={(p) => setParams({ de: p.de, ate: p.ate }, { replace: true })} />
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {!r ? (
        !erro && <p className="muted">Carregando…</p>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi">
              <span className="kpi-rotulo">Custo da frota no período</span>
              <span className="kpi-valor">{formatarMoeda(r.total + semVeiculo)}</span>
              <span className="kpi-detalhe">{semVeiculo ? `inclui ${formatarMoeda(semVeiculo)} sem veículo` : 'tudo atribuído a veículos'}</span>
            </div>
            <div className="kpi">
              <span className="kpi-rotulo">Betoneiras e apoio · R$/km</span>
              <span className="kpi-valor">{somaKm > 0 ? formatarMoeda(somaCustoBet / somaKm) : '—'}</span>
              <span className="kpi-detalhe">{formatarNumero(somaKm)} km rodados</span>
            </div>
            <div className="kpi">
              <span className="kpi-rotulo">Bombas · R$/hora</span>
              <span className="kpi-valor">{somaHoras > 0 ? formatarMoeda(somaCustoBomba / somaHoras) : '—'}</span>
              <span className="kpi-detalhe">{formatarNumero(somaHoras)} h trabalhadas</span>
            </div>
            <Link to="/fin/notas" className={`kpi ${semNota ? 'kpi-aviso' : ''}`}>
              <span className="kpi-rotulo">Registros ainda sem nota</span>
              <span className="kpi-valor">{formatarMoeda(semNota)}</span>
              <span className="kpi-detalhe">abastecimentos e OS sem nota ligada</span>
            </Link>
          </div>

          <section className="card tabela-caixa relatorio">
            {veics.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>Nenhum custo de veículo no período.</p>
            ) : (
              <table className="tabela tabela-compacta">
                <thead>
                  <tr>
                    <th>Veículo</th>
                    <th style={{ textAlign: 'right' }}>Lançado</th>
                    <th style={{ textAlign: 'right' }} title="Abastecimentos e OS que ainda não têm nota ligada">Sem nota</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th style={{ textAlign: 'right' }}>Uso</th>
                    <th style={{ textAlign: 'right' }}>Custo por uso</th>
                    <th style={{ textAlign: 'right' }} title="Betoneira: m³ transportados. Bomba: m³ bombeados.">m³</th>
                    <th style={{ textAlign: 'right' }}>Custo por m³</th>
                  </tr>
                </thead>
                <tbody>
                  {veics.map((v) => {
                    const bomba = v.tipo.startsWith('bomba');
                    const sn = v.semNota.diesel + v.semNota.manutencao;
                    const abrir = aberto === v.veiculoId;
                    return (
                      <Fragment key={v.veiculoId}>
                        <tr>
                          <td>
                            <button type="button" className="dre-abrir" aria-expanded={abrir} onClick={() => setAberto(abrir ? null : v.veiculoId)}>
                              <span aria-hidden="true">{abrir ? '▾' : '▸'}</span> <span className="mono" style={{ fontWeight: 600 }}>{v.codigo}</span>
                            </button>
                            <div className="small muted">{NOMES_TIPO_VEICULO[v.tipo]}</div>
                          </td>
                          <td className="mono num">{v.lancado ? formatarMoeda(v.lancado) : <span className="muted">—</span>}</td>
                          <td className="mono num">{sn ? <span style={{ color: 'var(--status-warn-ink)' }}>{formatarMoeda(sn)}</span> : <span className="muted">—</span>}</td>
                          <td className="mono num forte">{formatarMoeda(v.total)}</td>
                          <td className="mono num small">{bomba ? `${formatarNumero(v.horas)} h` : `${formatarNumero(v.km)} km`}</td>
                          <td className="mono num">
                            {bomba ? (v.custoHora !== null ? `${formatarMoeda(v.custoHora)}/h` : '—') : v.custoKm !== null ? `${formatarMoeda(v.custoKm)}/km` : '—'}
                          </td>
                          <td className="mono num small">{v.m3 ? formatarNumero(v.m3) : <span className="muted">—</span>}</td>
                          <td className="mono num">{v.custoM3 !== null ? `${formatarMoeda(v.custoM3)}/m³` : '—'}</td>
                        </tr>
                        {abrir && (
                          <tr className="linha-form">
                            <td colSpan={8}>
                              <ul className="linhas">
                                {v.categorias.map((c) => (
                                  <li key={c.codigo}>
                                    <span className="linha-texto">
                                      <span>
                                        <span className="mono muted">{c.codigo}</span> {c.nome}
                                      </span>
                                    </span>
                                    <span className="linha-valor">{formatarMoeda(c.valor)}</span>
                                  </li>
                                ))}
                                {v.semNota.diesel > 0 && (
                                  <li>
                                    <span className="linha-texto">
                                      <span>Diesel sem nota</span>
                                      <span className="linha-sub">{v.semNota.abastecimentos} abastecimento(s) ainda não ligados a uma nota</span>
                                    </span>
                                    <span className="linha-valor tom-aviso">{formatarMoeda(v.semNota.diesel)}</span>
                                  </li>
                                )}
                                {v.semNota.manutencao > 0 && (
                                  <li>
                                    <span className="linha-texto">
                                      <span>Manutenção sem nota</span>
                                      <span className="linha-sub">{v.semNota.ordens} OS concluída(s) sem nota ligada</span>
                                    </span>
                                    <span className="linha-valor tom-aviso">{formatarMoeda(v.semNota.manutencao)}</span>
                                  </li>
                                )}
                                <li>
                                  <span className="linha-texto">
                                    <span>Diesel abastecido</span>
                                    <span className="linha-sub">
                                      {!bomba && v.km > 0 && v.litros > 0 ? `${formatarNumero(v.km / v.litros, 2)} km/L` : bomba && v.horas > 0 && v.litros > 0 ? `${formatarNumero(v.litros / v.horas, 1)} L/h` : ''}
                                    </span>
                                  </span>
                                  <span className="linha-valor">{formatarNumero(v.litros)} L</span>
                                </li>
                              </ul>
                              <Link to={`/frota/veiculos/${v.veiculoId}`} className="small">Abrir a ficha do {v.codigo} ›</Link>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          {r.semVeiculo.length > 0 && (
            <div className="card">
              <div className="cartao-topo">
                <h2>Custos da frota sem veículo</h2>
              </div>
              <p className="small muted" style={{ marginTop: 0 }}>
                Despesas da frota lançadas sem veículo (seguro da frota toda, diesel do tanque próprio…). Para entrarem no custo de cada caminhão, informe o veículo na nota ou no lançamento.
              </p>
              <ul className="linhas">
                {r.semVeiculo.map((x) => (
                  <li key={x.codigo}>
                    <span className="linha-texto">
                      <span>
                        <span className="mono muted">{x.codigo}</span> {x.nome}
                      </span>
                    </span>
                    <span className="linha-valor">{formatarMoeda(x.valor)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="small muted">
            "Lançado" vem das notas e lançamentos confirmados com veículo (pela competência). "Sem nota" são abastecimentos de posto e OS concluídas que ainda não foram ligados a uma nota; quando a nota for ligada, o valor passa para "Lançado" sem contar duas vezes.
          </p>
        </>
      )}
    </>
  );
}
