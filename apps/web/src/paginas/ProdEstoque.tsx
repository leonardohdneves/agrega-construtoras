import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatarData, formatarMoeda, formatarNumero, hojeLocal, lerNumero, NOMES_UNIDADE, somarDias, type UnidadeInsumo } from '../api';
import { CabecalhoDocumento } from '../componentes/Documento';
import { TabelaRelatorio } from '../componentes/Relatorio';
import { SeletorDias, textoDias, type Dias } from './ProdMotoristas';

type Posicao = {
  id: string; nome: string; tipo: string; unidade: UnidadeInsumo; saldo: number; estoqueMinimo: number | null; consumoDia: number; diasCobertura: number | null;
  situacao: 'ok' | 'abaixo' | 'negativo'; custoUnitario: number | null; custoOrigem: string | null; valor: number | null; ultimaEntrada: string | null;
  ultimoInventario: { data: string; diferenca: number; perda: number | null } | null;
};
type Extrato = {
  insumo: { id: string; nome: string; unidade: UnidadeInsumo }; de: string; ate: string; saldoInicial: number; saldoFinal: number;
  linhas: { data: string; tipo: 'entrada' | 'ajuste' | 'consumo'; quantidade: number; custoUnitario: number | null; descricao: string; notaId: string | null; saldo: number }[];
};
type Inventario = {
  id: string; data: string; observacao: string | null; criadoPor: string | null; ultimo: boolean; valorDiferenca: number;
  itens: { nome: string; unidade: UnidadeInsumo; teorico: number; contado: number; diferenca: number; consumo: number | null; perda: number | null; valor: number | null }[];
};
type Previa = { data: string; ultimo: string | null; itens: { insumoId: string; nome: string; unidade: UnidadeInsumo; teorico: number }[] };

const qtd = (n: number, u: UnidadeInsumo) => `${formatarNumero(n, Math.abs(n) < 100 && n % 1 ? 1 : 0)} ${NOMES_UNIDADE[u]}`;
const pct = (n: number | null) => (n === null ? '—' : `${(n * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`);

export function Estoque() {
  const [aba, setAba] = useState<'posicao' | 'inventarios' | 'contagem'>('posicao');
  const [posicao, setPosicao] = useState<{ insumos: Posicao[]; valorTotal: number } | null>(null);
  const [extrato, setExtrato] = useState<Extrato | null>(null);
  const [insumoExtrato, setInsumoExtrato] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState<Dias>({ de: somarDias(hojeLocal(), -30), ate: hojeLocal() });
  const [inventarios, setInventarios] = useState<Inventario[] | null>(null);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [contagem, setContagem] = useState<Record<string, string>>({});
  const [dataContagem, setDataContagem] = useState(hojeLocal());
  const [observacao, setObservacao] = useState('');
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const carregarPosicao = useCallback(async () => {
    try {
      setPosicao(await api('/prod/estoque'));
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);
  const carregarInventarios = useCallback(async () => {
    try {
      setInventarios((await api<{ inventarios: Inventario[] }>('/prod/inventarios')).inventarios);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, []);
  useEffect(() => {
    carregarPosicao();
    carregarInventarios();
  }, [carregarPosicao, carregarInventarios]);
  useEffect(() => {
    if (!insumoExtrato) return setExtrato(null);
    api<Extrato>(`/prod/estoque/${insumoExtrato}/extrato?de=${periodo.de}&ate=${periodo.ate}`).then(setExtrato).catch((e) => setErro((e as Error).message));
  }, [insumoExtrato, periodo]);
  useEffect(() => {
    if (aba !== 'contagem') return;
    api<Previa>(`/prod/inventarios/previa?data=${dataContagem}`)
      .then((p) => {
        setPrevia(p);
        setContagem((c) => Object.fromEntries(p.itens.map((i) => [i.insumoId, c[i.insumoId] ?? ''])));
      })
      .catch((e) => setErro((e as Error).message));
  }, [aba, dataContagem]);

  async function salvarInventario() {
    if (!previa) return;
    setErro('');
    setAviso('');
    const itens = previa.itens.filter((i) => contagem[i.insumoId]?.trim()).map((i) => ({ insumoId: i.insumoId, contado: lerNumero(contagem[i.insumoId]) }));
    if (!itens.length) return setErro('Informe a contagem de pelo menos um insumo.');
    if (itens.some((i) => i.contado === null || i.contado < 0)) return setErro('Confira os números da contagem.');
    setOcupado(true);
    try {
      await api('/prod/inventarios', { corpo: { data: dataContagem, observacao, itens } });
      setAviso(`Inventário de ${formatarData(dataContagem)} gravado. O estoque foi acertado pela contagem.`);
      setContagem({});
      setObservacao('');
      setAba('inventarios');
      await Promise.all([carregarPosicao(), carregarInventarios()]);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function excluirInventario(v: Inventario) {
    if (!window.confirm(`Excluir o inventário de ${formatarData(v.data)}? O acerto que ele fez no estoque é desfeito.`)) return;
    setErro('');
    try {
      await api(`/prod/inventarios/${v.id}`, { metodo: 'DELETE' });
      setAviso(`Inventário de ${formatarData(v.data)} excluído.`);
      await Promise.all([carregarPosicao(), carregarInventarios()]);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  const abaixo = (posicao?.insumos ?? []).filter((i) => i.situacao !== 'ok').length;

  return (
    <>
      <CabecalhoDocumento
        modulo="Produção"
        titulo={aba === 'posicao' ? 'Estoque de insumos' : aba === 'inventarios' ? 'Inventários' : 'Contagem de estoque'}
        descricao={
          aba === 'posicao'
            ? 'Saldo teórico: entradas das notas e acertos de inventário, menos o consumo das cargas pelo traço.'
            : aba === 'inventarios'
              ? 'Contagens dos silos e baias e a diferença para o saldo teórico (perda).'
              : 'Informe o que foi medido nos silos e baias. A diferença para o teórico acerta o estoque.'
        }
        periodo={aba === 'contagem' ? formatarData(dataContagem) : aba === 'posicao' ? `posição de ${formatarData(hojeLocal())}` : undefined}
      />
      <div className="abas nao-imprimir" role="tablist">
        {(
          [
            ['posicao', 'Posição'],
            ['inventarios', 'Inventários'],
            ['contagem', 'Nova contagem'],
          ] as const
        ).map(([id, t]) => (
          <button key={id} type="button" role="tab" aria-selected={aba === id} className={aba === id ? 'ativa' : ''} onClick={() => setAba(id)}>
            {t}
          </button>
        ))}
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok nao-imprimir" role="status">{aviso}</div>}

      {aba === 'posicao' && (
        <>
          {abaixo > 0 && <div className="alerta alerta-aviso">{abaixo === 1 ? '1 insumo está' : `${abaixo} insumos estão`} abaixo do estoque mínimo. Programe a compra.</div>}
          <TabelaRelatorio
            titulo="Posição de hoje"
            descricao="Toque no insumo para ver as entradas, o consumo e os acertos dia a dia."
            arquivo="estoque-insumos"
            linhas={posicao?.insumos ?? []}
            vazio="Nenhum insumo com controle de estoque. Cadastre em Produção › Insumos."
            colunas={[
              {
                titulo: 'Insumo',
                valor: (i) => i.nome,
                render: (i) => (
                  <button className="link-acao" type="button" onClick={() => setInsumoExtrato(i.id === insumoExtrato ? null : i.id)}>
                    {i.nome}
                  </button>
                ),
              },
              { titulo: 'Saldo', valor: (i) => qtd(i.saldo, i.unidade), destaque: (i) => (i.situacao === 'ok' ? undefined : 'perigo') },
              { titulo: 'Mínimo', valor: (i) => (i.estoqueMinimo === null ? '—' : qtd(i.estoqueMinimo, i.unidade)) },
              { titulo: 'Consumo por dia', valor: (i) => (i.consumoDia ? qtd(i.consumoDia, i.unidade) : '—') },
              { titulo: 'Dá para', valor: (i) => (i.diasCobertura === null ? '—' : `${i.diasCobertura} dias`), destaque: (i) => (i.diasCobertura !== null && i.diasCobertura < 5 ? 'aviso' : undefined) },
              { titulo: 'Custo', valor: (i) => (i.custoUnitario === null ? '—' : `R$ ${i.custoUnitario.toLocaleString('pt-BR', { maximumFractionDigits: 4, minimumFractionDigits: 2 })}/${NOMES_UNIDADE[i.unidade]}`) },
              { titulo: 'Valor em estoque', valor: (i) => i.valor, formato: 'moeda', total: true },
              { titulo: 'Última compra', valor: (i) => i.ultimaEntrada, formato: 'data' },
              { titulo: 'Perda no último inventário', valor: (i) => (i.ultimoInventario ? pct(i.ultimoInventario.perda) : '—') },
            ]}
          />
          {insumoExtrato && (
            <section className="card relatorio">
              <div className="cartao-topo">
                <h2>Movimento de {extrato?.insumo.nome ?? '…'}</h2>
                <button className="btn btn-link nao-imprimir" type="button" onClick={() => setInsumoExtrato(null)}>Fechar</button>
              </div>
              <SeletorDias valor={periodo} aoMudar={setPeriodo} />
              {extrato && (
                <table className="tabela tabela-compacta">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Movimento</th>
                      <th style={{ textAlign: 'right' }}>Quantidade</th>
                      <th style={{ textAlign: 'right' }}>Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{formatarData(somarDias(extrato.de, -1))}</td>
                      <td className="muted">Saldo anterior</td>
                      <td />
                      <td className="mono" style={{ textAlign: 'right' }}>{qtd(extrato.saldoInicial, extrato.insumo.unidade)}</td>
                    </tr>
                    {extrato.linhas.map((l, k) => (
                      <tr key={k}>
                        <td>{formatarData(l.data)}</td>
                        <td>
                          {l.notaId ? <Link to={`/fin/notas/${l.notaId}`}>{l.descricao}</Link> : l.descricao}
                          {l.tipo === 'ajuste' && <span className={`selo ${l.quantidade < 0 ? 'selo-perigo' : 'selo-ok'}`} style={{ marginLeft: 6 }}>{l.quantidade < 0 ? 'falta' : 'sobra'}</span>}
                        </td>
                        <td className={`mono ${l.quantidade < 0 ? 'negativo' : ''}`} style={{ textAlign: 'right' }}>
                          {l.quantidade > 0 ? '+' : ''}
                          {qtd(l.quantidade, extrato.insumo.unidade)}
                        </td>
                        <td className="mono" style={{ textAlign: 'right' }}>{qtd(l.saldo, extrato.insumo.unidade)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {extrato && <p className="small muted">Período: {textoDias(periodo)}</p>}
            </section>
          )}
        </>
      )}

      {aba === 'inventarios' && (
        <>
          {inventarios && inventarios.length === 0 && (
            <div className="card muted">Nenhum inventário ainda. Faça a primeira contagem dos silos e baias em "Nova contagem": ela vira o saldo inicial do estoque.</div>
          )}
          {(inventarios ?? []).map((v) => (
            <section key={v.id} className="card relatorio">
              <div className="cartao-topo">
                <h2>Inventário de {formatarData(v.data)}</h2>
                {v.ultimo && (
                  <button className="btn btn-link nao-imprimir" type="button" onClick={() => excluirInventario(v)}>Excluir</button>
                )}
              </div>
              <p className="small muted" style={{ marginTop: 0 }}>
                {[v.observacao, v.criadoPor ? `por ${v.criadoPor}` : null].filter(Boolean).join(' · ')}
                {v.valorDiferenca ? ` · diferença de ${formatarMoeda(v.valorDiferenca)}` : ''}
              </p>
              <table className="tabela tabela-compacta">
                <thead>
                  <tr>
                    <th>Insumo</th>
                    <th style={{ textAlign: 'right' }}>Teórico</th>
                    <th style={{ textAlign: 'right' }}>Contado</th>
                    <th style={{ textAlign: 'right' }}>Diferença</th>
                    <th style={{ textAlign: 'right' }}>Consumo no período</th>
                    <th style={{ textAlign: 'right' }}>Perda</th>
                    <th style={{ textAlign: 'right' }}>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {v.itens.map((i) => (
                    <tr key={i.nome}>
                      <td>{i.nome}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{qtd(i.teorico, i.unidade)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{qtd(i.contado, i.unidade)}</td>
                      <td className={`mono ${i.diferenca < 0 ? 'negativo' : ''}`} style={{ textAlign: 'right' }}>{qtd(i.diferenca, i.unidade)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{i.consumo === null ? 'contagem inicial' : qtd(i.consumo, i.unidade)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>
                        {i.perda === null ? '—' : <span className={`selo ${i.perda > 0.03 ? 'selo-perigo' : i.perda > 0.015 ? 'selo-aviso' : 'selo-ok'}`}>{pct(i.perda)}</span>}
                      </td>
                      <td className="mono" style={{ textAlign: 'right' }}>{i.valor === null ? '—' : formatarMoeda(i.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </>
      )}

      {aba === 'contagem' && (
        <section className="card form">
          <div className="campos">
            <div className="campo">
              <label htmlFor="inv-data">Data da contagem (fim do dia)</label>
              <input id="inv-data" type="date" max={hojeLocal()} value={dataContagem} onChange={(e) => e.target.value && setDataContagem(e.target.value)} />
            </div>
            <div className="campo" style={{ gridColumn: 'span 2' }}>
              <label htmlFor="inv-obs">Observação</label>
              <input id="inv-obs" placeholder="ex.: medição dos silos com trena e cubagem das baias" value={observacao} onChange={(e) => setObservacao(e.target.value)} />
            </div>
          </div>
          {previa?.ultimo && <p className="small muted" style={{ margin: 0 }}>Última contagem: {formatarData(previa.ultimo)}. A nova precisa ser depois dela.</p>}
          <table className="tabela">
            <thead>
              <tr>
                <th>Insumo</th>
                <th style={{ textAlign: 'right' }}>Saldo teórico</th>
                <th style={{ textAlign: 'right' }}>Contado</th>
                <th style={{ textAlign: 'right' }}>Diferença</th>
              </tr>
            </thead>
            <tbody>
              {(previa?.itens ?? []).map((i) => {
                const c = lerNumero(contagem[i.insumoId] ?? '');
                const dif = c === null ? null : c - i.teorico;
                return (
                  <tr key={i.insumoId}>
                    <td>{i.nome}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{qtd(i.teorico, i.unidade)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        <input
                          aria-label={`Contagem de ${i.nome}`}
                          className="mono"
                          inputMode="decimal"
                          style={{ width: 120, textAlign: 'right' }}
                          value={contagem[i.insumoId] ?? ''}
                          onChange={(e) => setContagem({ ...contagem, [i.insumoId]: e.target.value })}
                        />
                        <span className="small muted">{NOMES_UNIDADE[i.unidade]}</span>
                      </span>
                    </td>
                    <td className={`mono ${dif !== null && dif < 0 ? 'negativo' : ''}`} style={{ textAlign: 'right' }}>{dif === null ? '—' : qtd(dif, i.unidade)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="small muted" style={{ margin: 0 }}>Deixe em branco o que não foi contado. Cimento em kg: 1 tonelada = 1.000 kg.</p>
          <div className="acoes">
            <button className="btn btn-primario" type="button" disabled={ocupado} onClick={salvarInventario}>Gravar inventário</button>
          </div>
        </section>
      )}
    </>
  );
}
