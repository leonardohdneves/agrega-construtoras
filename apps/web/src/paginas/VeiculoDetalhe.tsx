import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  api,
  CLASSE_STATUS_VEICULO,
  formatarData,
  formatarMoeda,
  formatarNumero,
  formatarPlaca,
  NOMES_STATUS_VEICULO,
  NOMES_TIPO_DOCUMENTO,
  NOMES_TIPO_VEICULO,
  seloVencimento,
  formatarDataHoraCurta,
  textoFalta,
  CLASSE_STATUS_OS,
  NOMES_STATUS_OS,
  type Abastecimento,
  type ItemManutencao,
  type OrdemServico,
  type ConsumoVeiculo,
  type DocumentoVeiculo,
  type Veiculo,
} from '../api';
import { FormVeiculo, dadosDoVeiculo } from '../componentes/FormVeiculo';

type DadosDoc = { id?: string; tipo: DocumentoVeiculo['tipo']; descricao: string; numero: string; vencimento: string; valor: string };
const SELO_REVISAO: Record<ItemManutencao['situacao'], { texto: string; classe: string }> = {
  vencida: { texto: 'Vencida', classe: 'selo-perigo' },
  proxima: { texto: 'Próxima', classe: 'selo-aviso' },
  em_dia: { texto: 'Em dia', classe: 'selo-ok' },
  sem_registro: { texto: 'Sem registro', classe: 'selo-neutro' },
};
const DOC_VAZIO: DadosDoc = { tipo: 'licenciamento', descricao: '', numero: '', vencimento: '', valor: '' };

export function VeiculoDetalhe() {
  const { id } = useParams();
  const [v, setV] = useState<Veiculo | null>(null);
  const [docs, setDocs] = useState<DocumentoVeiculo[]>([]);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [editando, setEditando] = useState(false);
  const [doc, setDoc] = useState<DadosDoc | null>(null);
  const [excluir, setExcluir] = useState<DocumentoVeiculo | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [consumo, setConsumo] = useState<ConsumoVeiculo | null>(null);
  const [abast, setAbast] = useState<Abastecimento[]>([]);
  const [revisoes, setRevisoes] = useState<ItemManutencao[]>([]);
  const [ordens, setOrdens] = useState<OrdemServico[]>([]);

  useEffect(() => {
    api<{ veiculos: ConsumoVeiculo[] }>('/frota/consumo?dias=30')
      .then((r) => setConsumo(r.veiculos.find((c) => c.veiculoId === id) ?? null))
      .catch(() => {});
    api<{ abastecimentos: Abastecimento[] }>(`/frota/abastecimentos?dias=90&veiculoId=${id}`)
      .then((r) => setAbast(r.abastecimentos.slice(0, 6)))
      .catch(() => {});
    api<{ itens: ItemManutencao[] }>(`/frota/manutencao?veiculoId=${id}`)
      .then((r) => setRevisoes(r.itens.sort((a, b) => (b.uso ?? -1) - (a.uso ?? -1))))
      .catch(() => {});
    api<{ ordens: OrdemServico[] }>(`/frota/os?veiculoId=${id}&dias=365`)
      .then((r) => setOrdens(r.ordens))
      .catch(() => {});
  }, [id]);

  const carregar = useCallback(async () => {
    try {
      const r = await api<{ veiculo: Veiculo; documentos: DocumentoVeiculo[] }>(`/frota/veiculos/${id}`);
      setV(r.veiculo);
      setDocs(r.documentos);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  async function salvarDoc(e: FormEvent) {
    e.preventDefault();
    if (!doc) return;
    setErro('');
    setAviso('');
    setOcupado(true);
    try {
      const corpo = { tipo: doc.tipo, descricao: doc.descricao, numero: doc.numero, vencimento: doc.vencimento, valor: doc.valor };
      if (doc.id) await api(`/frota/documentos/${doc.id}`, { metodo: 'PATCH', corpo });
      else await api(`/frota/veiculos/${id}/documentos`, { corpo });
      setAviso(doc.id ? 'Documento atualizado.' : 'Documento cadastrado.');
      setDoc(null);
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function confirmarExclusao() {
    if (!excluir) return;
    setOcupado(true);
    try {
      await api(`/frota/documentos/${excluir.id}`, { metodo: 'DELETE' });
      setAviso('Documento removido.');
      setExcluir(null);
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  if (!v) return erro ? <div className="alerta alerta-erro">{erro}</div> : <p className="muted">Carregando…</p>;
  const bomba = v.tipo === 'bomba_lanca' || v.tipo === 'bomba_estacionaria';
  const custoOS = ordens.filter((o) => o.status === 'concluida').reduce((t, o) => t + o.total, 0);

  return (
    <>
      <Link to="/frota/veiculos" className="small" style={{ fontWeight: 600, textDecoration: 'none' }}>
        ‹ Veículos
      </Link>
      <div className="cabecalho">
        <div className="titulo">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <h1 className="mono" style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{v.codigo}</h1>
            <span className={`selo ${CLASSE_STATUS_VEICULO[v.status]}`}>{NOMES_STATUS_VEICULO[v.status]}</span>
          </div>
          <span className="muted">
            {NOMES_TIPO_VEICULO[v.tipo]}
            {v.marcaModelo ? ` · ${v.marcaModelo}` : ''}
            {v.ano ? ` · ${v.ano}` : ''} · placa <span className="mono">{formatarPlaca(v.placa)}</span>
          </span>
        </div>
        {!editando && (
          <div className="acoes">
            <Link className="btn btn-secundario" to={`/frota/os/nova?veiculoId=${v.id}`}>
              Abrir OS
            </Link>
            <button className="btn btn-secundario" type="button" onClick={() => setEditando(true)}>
              Editar veículo
            </button>
          </div>
        )}
      </div>

      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}

      {editando ? (
        <FormVeiculo
          titulo="Editar veículo"
          rotuloSalvar="Salvar alterações"
          inicial={dadosDoVeiculo(v)}
          aoCancelar={() => setEditando(false)}
          aoSalvar={async (d) => {
            const r = await api<{ veiculo: Veiculo }>(`/frota/veiculos/${v.id}`, { metodo: 'PATCH', corpo: d });
            setV(r.veiculo);
            setEditando(false);
            setAviso('Veículo atualizado.');
          }}
        />
      ) : (
        <div className="indicadores">
          <div className="card indicador">
            <span className="rotulo-ind">Odômetro</span>
            <span className="valor-ind mono">{formatarNumero(v.kmAtual)} km</span>
          </div>
          <div className="card indicador">
            <span className="rotulo-ind">Horímetro</span>
            <span className="valor-ind mono">{formatarNumero(v.horimetroAtual)} h</span>
          </div>
          <div className="card indicador">
            <span className="rotulo-ind">{bomba ? 'Alcance da lança' : 'Capacidade'}</span>
            <span className="valor-ind mono">
              {bomba ? (v.alcanceLancaM ? `${formatarNumero(v.alcanceLancaM)} m` : '—') : v.capacidadeM3 ? `${formatarNumero(v.capacidadeM3, 1)} m³` : '—'}
            </span>
          </div>
          <div className="card indicador">
            <span className="rotulo-ind">Consumo (30 dias)</span>
            <span className="valor-ind mono">
              {consumo?.kmPorLitro ? `${formatarNumero(consumo.kmPorLitro, 2)} km/L` : consumo?.litrosPorHora ? `${formatarNumero(consumo.litrosPorHora, 1)} L/h` : '—'}
            </span>
            {consumo?.kmPorLitro && consumo.litrosPorHora ? <span className="small mono muted">{formatarNumero(consumo.litrosPorHora, 1)} L/h</span> : null}
            {consumo?.piora != null && <span className="selo selo-aviso" style={{ alignSelf: 'flex-start' }}>Último {formatarNumero(consumo.piora * 100)}% pior</span>}
          </div>
          <div className="card indicador">
            <span className="rotulo-ind">Diesel (30 dias)</span>
            <span className="valor-ind mono">{consumo ? `${formatarNumero(consumo.litros)} L` : '—'}</span>
            {consumo && consumo.valor > 0 ? <span className="small mono muted">{formatarMoeda(consumo.valor)}</span> : null}
          </div>
        </div>
      )}

      {abast.length > 0 && (
        <div className="card tabela-caixa">
          <div className="cabecalho" style={{ marginBottom: 12 }}>
            <h2>Últimos abastecimentos</h2>
            <Link to="/frota/abastecimentos" className="small" style={{ fontWeight: 600, textDecoration: 'none' }}>
              Todos ›
            </Link>
          </div>
          <table className="tabela">
            <thead>
              <tr>
                <th>Data</th>
                <th>Motorista</th>
                <th style={{ textAlign: 'right' }}>Litros</th>
                <th style={{ textAlign: 'right' }}>Km</th>
                <th style={{ textAlign: 'right' }}>km/L</th>
                <th style={{ textAlign: 'right' }}>L/h</th>
              </tr>
            </thead>
            <tbody>
              {abast.map((a) => (
                <tr key={a.id}>
                  <td className="mono small">{formatarDataHoraCurta(a.dataHora)}</td>
                  <td className="small">{a.motoristaNome ?? '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{formatarNumero(a.litros, 1)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{formatarNumero(a.km)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{a.kmPorLitro ? formatarNumero(a.kmPorLitro, 2) : '—'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{a.litrosPorHora ? formatarNumero(a.litrosPorHora, 1) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card tabela-caixa">
        <div className="cabecalho" style={{ marginBottom: 12 }}>
          <h2>Manutenção</h2>
          <span className="small muted">
            Custo em 12 meses: <span className="mono" style={{ fontWeight: 600, color: 'var(--ink)' }}>{formatarMoeda(custoOS)}</span>
          </span>
        </div>
        {ordens.length > 0 && (
          <table className="tabela" style={{ marginBottom: 16 }}>
            <thead>
              <tr>
                <th>OS</th>
                <th>Abertura</th>
                <th>Serviço / defeito</th>
                <th>Situação</th>
                <th style={{ textAlign: 'right' }}>Custo</th>
              </tr>
            </thead>
            <tbody>
              {ordens.slice(0, 8).map((o) => (
                <tr key={o.id}>
                  <td className="mono"><Link to={`/frota/os/${o.id}`} style={{ fontWeight: 600 }}>#{o.numero}</Link></td>
                  <td className="mono small">{formatarData(o.abertura)}</td>
                  <td className="small">{o.tipo === 'preventiva' ? 'Preventiva · ' : 'Corretiva · '}{o.descricao}</td>
                  <td><span className={`selo ${CLASSE_STATUS_OS[o.status]}`}>{NOMES_STATUS_OS[o.status]}</span></td>
                  <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(o.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {revisoes.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Sem plano de manutenção para este veículo. <Link to="/frota/manutencao">Configure o plano</Link>.
          </p>
        ) : (
          <ul className="lista-alertas">
            {revisoes.map((r) => {
              const s = SELO_REVISAO[r.situacao];
              return (
                <li key={r.planoId}>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: 500 }}>{r.item}</span>
                    <div className="small muted">
                      {textoFalta(r)}
                      {r.ultimaData ? ` · última em ${formatarData(r.ultimaData)}` : ''}
                    </div>
                  </span>
                  <span className={`selo ${s.classe}`}>{s.texto}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="card">
        <div className="cabecalho" style={{ marginBottom: 12 }}>
          <h2>Documentos</h2>
          {!doc && (
            <button className="btn btn-primario" type="button" onClick={() => setDoc(DOC_VAZIO)}>
              Novo documento
            </button>
          )}
        </div>

        {doc && (
          <form className="form" onSubmit={salvarDoc} style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid var(--divider)' }}>
            <div className="campos">
              <div className="campo">
                <label htmlFor="d-tipo">Tipo</label>
                <select id="d-tipo" value={doc.tipo} onChange={(e) => setDoc({ ...doc, tipo: e.target.value as DadosDoc['tipo'] })}>
                  {Object.entries(NOMES_TIPO_DOCUMENTO).map(([k, r]) => (
                    <option key={k} value={k}>{r}</option>
                  ))}
                </select>
              </div>
              <div className="campo">
                <label htmlFor="d-venc">Vencimento</label>
                <input id="d-venc" type="date" value={doc.vencimento} onChange={(e) => setDoc({ ...doc, vencimento: e.target.value })} />
              </div>
              <div className="campo">
                <label htmlFor="d-valor">Valor (R$)</label>
                <input id="d-valor" className="mono" inputMode="decimal" value={doc.valor} onChange={(e) => setDoc({ ...doc, valor: e.target.value })} />
              </div>
              <div className="campo">
                <label htmlFor="d-num">Número / apólice</label>
                <input id="d-num" value={doc.numero} onChange={(e) => setDoc({ ...doc, numero: e.target.value })} />
              </div>
              <div className="campo">
                <label htmlFor="d-desc">Descrição</label>
                <input id="d-desc" value={doc.descricao} onChange={(e) => setDoc({ ...doc, descricao: e.target.value })} />
              </div>
            </div>
            <div className="acoes">
              <button className="btn btn-primario" type="submit" disabled={ocupado}>
                {doc.id ? 'Salvar documento' : 'Cadastrar documento'}
              </button>
              <button className="btn btn-secundario" type="button" onClick={() => setDoc(null)}>
                Cancelar
              </button>
            </div>
          </form>
        )}

        {excluir && (
          <div className="alerta alerta-aviso" role="alert" style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ flex: 1 }}>Remover o documento {NOMES_TIPO_DOCUMENTO[excluir.tipo]} deste veículo?</span>
            <button className="btn btn-primario" type="button" disabled={ocupado} onClick={confirmarExclusao}>
              Remover
            </button>
            <button className="btn btn-secundario" type="button" onClick={() => setExcluir(null)}>
              Manter
            </button>
          </div>
        )}

        {docs.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Nenhum documento cadastrado. Cadastre licenciamento, seguro, IPVA e tacógrafo para receber os alertas de vencimento.
          </p>
        ) : (
          <div className="tabela-caixa">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Vencimento</th>
                  <th style={{ textAlign: 'right' }}>Valor</th>
                  <th>Situação</th>
                  <th><span style={{ position: 'absolute', left: -9999 }}>Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => {
                  const s = seloVencimento(d.situacao, d.dias);
                  return (
                    <tr key={d.id}>
                      <td>
                        {NOMES_TIPO_DOCUMENTO[d.tipo]}
                        {(d.descricao || d.numero) && <div className="small muted">{[d.numero, d.descricao].filter(Boolean).join(' · ')}</div>}
                      </td>
                      <td className="mono">{formatarData(d.vencimento)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(d.valor)}</td>
                      <td><span className={`selo ${s.classe}`}>{s.texto}</span></td>
                      <td>
                        <div className="acoes" style={{ flexWrap: 'nowrap' }}>
                          <button
                            className="btn btn-link"
                            type="button"
                            onClick={() =>
                              setDoc({
                                id: d.id,
                                tipo: d.tipo,
                                descricao: d.descricao ?? '',
                                numero: d.numero ?? '',
                                vencimento: d.vencimento ?? '',
                                valor: d.valor === null ? '' : formatarNumero(d.valor, 2),
                              })
                            }
                          >
                            Editar
                          </button>
                          <button className="btn btn-link" type="button" onClick={() => setExcluir(d)}>
                            Remover
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
