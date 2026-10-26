import { useCallback, useEffect, useMemo, useState, type FormEvent, type MouseEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, formatarData, hojeLocal, lerNumero, somarDias, type PlanoConta } from '../api';
import { CabecalhoDocumento } from '../componentes/Documento';
import { SeletorBusca } from '../componentes/SeletorBusca';
import {
  Assinatura,
  nomeFornecedor,
  numeroDoc,
  qtd,
  Selo,
  SELO_COTACAO,
  SELO_PEDIDO,
  SELO_SOLICITACAO,
  unidadeTexto,
  useCadastrosCompra,
  type Solicitacao,
  type SolicitacaoResumo,
  type TipoSolicitacao,
} from '../componentes/Suprimentos';
import { ROTULO_NIVEL } from './EngObras';

const FILTROS = [
  { id: '', texto: 'Em andamento' },
  { id: 'finalizada', texto: 'Finalizadas' },
  { id: 'atendida', texto: 'Atendidas' },
  { id: 'cancelada', texto: 'Canceladas' },
];

type ObraLista = { id: string; codigo: string; nome: string; ativo?: boolean };
/** Insumo da obra (necessidade de compra) já apropriado a um nó da EAP. */
type Necessidade = {
  id: string; codigo: string; descricao: string; unidade: string; eapNoId: string | null; eapCodigo: string | null; eapDescricao: string | null;
  unidadeCompra: string | null; quantidadeCompra: number | null;
  quantidade: number; dataNecessaria: string | null; status: 'pendente' | 'solicitada' | 'comprada' | 'cancelada';
};

const ordenarEap = (a: { eapCodigo: string | null; descricao: string }, b: { eapCodigo: string | null; descricao: string }) =>
  (a.eapCodigo ?? '').localeCompare(b.eapCodigo ?? '', 'pt-BR', { numeric: true }) || a.descricao.localeCompare(b.descricao, 'pt-BR');

const CAMINHO_LISTA: Record<TipoSolicitacao, string> = { insumo: '/sup/solicitacoes', servico: '/sup/solicitacoes-servico' };

export function SupSolicitacoes({ tipo = 'insumo' }: { tipo?: TipoSolicitacao }) {
  const [params, setParams] = useSearchParams();
  const filtro = params.get('status') ?? '';
  const [lista, setLista] = useState<SolicitacaoResumo[] | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    setLista(null);
    const q = new URLSearchParams({ tipo });
    if (filtro) q.set('status', filtro);
    api<{ solicitacoes: SolicitacaoResumo[] }>(`/sup/solicitacoes?${q}`)
      .then((r) => setLista(r.solicitacoes))
      .catch((e) => setErro((e as Error).message));
  }, [filtro, tipo]);

  const servico = tipo === 'servico';
  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>{servico ? 'Solicitação de serviços' : 'Solicitações de compra'}</h1>
          <span className="muted">
            {servico
              ? 'Serviços cadastrados na obra (composições). Finalizada e cotada, cada fornecedor vencedor recebe um contrato.'
              : 'Cada solicitação é de uma obra e usa os insumos apropriados à EAP. Finalizada, ela vai para a cotação.'}
          </span>
        </div>
        <div className="acoes">
          <Link className="btn btn-primario" to={`${CAMINHO_LISTA[tipo]}/nova`}>{servico ? 'Nova solicitação de serviços' : 'Nova solicitação'}</Link>
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div className="segmentado" role="group" aria-label="Situação" style={{ maxWidth: 640 }}>
        {FILTROS.map((f) => (
          <button key={f.id} type="button" aria-pressed={filtro === f.id} className={filtro === f.id ? 'ativo' : ''} onClick={() => setParams(f.id ? { status: f.id } : {}, { replace: true })}>
            {f.texto}
          </button>
        ))}
      </div>
      <div className="card tabela-caixa">
        {!lista ? (
          <p className="muted">Carregando…</p>
        ) : lista.length === 0 ? (
          <p className="muted">Nenhuma solicitação {filtro ? 'nesta situação' : 'em andamento'}.</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Obra</th>
                <th>Data</th>
                <th>Itens</th>
                <th>Precisa até</th>
                <th>Solicitante</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((s) => (
                <tr key={s.id}>
                  <td className="mono"><Link to={`/sup/solicitacoes/${s.id}`}>{numeroDoc(s.numero)}</Link></td>
                  <td className="small">{s.obra ? `${s.obra.codigo} · ${s.obra.nome}` : '—'}</td>
                  <td>{formatarData(s.data)}</td>
                  <td>{s.itens} {servico ? (s.itens === 1 ? 'serviço' : 'serviços') : s.itens === 1 ? 'insumo' : 'insumos'}<div className="small muted">{s.resumo}</div></td>
                  <td className={s.urgente ? 'tom-perigo' : ''}>{s.necessidade ? formatarData(s.necessidade) : '—'}</td>
                  <td className="small">{s.solicitante ?? '—'}</td>
                  <td>
                    <Selo s={SELO_SOLICITACAO[s.status]} />
                    {s.diasAberta !== null && s.diasAberta > 0 && <div className="small muted">há {s.diasAberta} {s.diasAberta === 1 ? 'dia' : 'dias'}</div>}
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

// ---------- Formulário (nova e edição): obra e insumos apropriados ----------
const indentoEapSol = (codigo: string) => codigo.split('.').length - 1;
type InsumoPlanilha = { id: string; codigo: string; descricao: string; unidade: string; unidadesCompra: { unidade: string; fator: number }[] };
type NoEapLista = { id: string; nivel: string; codigo: string; descricao: string };
/** Insumo escolhido direto na planilha da obra, ainda não gravado na solicitação. */
type NovoItem = { chave: string; obraItemId: string; eapNoId: string | null; codigo: string; descricao: string; unidade: string; eapCodigo: string | null; quantidade: number; dataNecessaria: string | null; unidadeCompra: string | null; fatorCompra: number | null };

function FormSolicitacao({ inicial, aoSalvar, aoCancelar, aoSujar }: { inicial?: Solicitacao; aoSalvar: (s: Solicitacao) => void; aoCancelar?: () => void; aoSujar?: (sujo: boolean) => void }) {
  const [obras, setObras] = useState<ObraLista[]>([]);
  const [f, setF] = useState({
    obraId: inicial?.obraId ?? '',
    data: inicial?.data ?? hojeLocal(),
    necessidade: inicial?.necessidade ?? somarDias(hojeLocal(), 7),
    observacao: inicial?.observacao ?? '',
  });
  const [necessidades, setNecessidades] = useState<Necessidade[] | null>(null);
  const [insumos, setInsumos] = useState<InsumoPlanilha[]>([]);
  const [nos, setNos] = useState<NoEapLista[]>([]);
  const [nivel, setNivel] = useState<string>('');
  const [marcadas, setMarcadas] = useState<Set<string>>(() => new Set(inicial?.itens.map((i) => i.necessidadeId).filter((x): x is string => !!x) ?? []));
  const [novos, setNovos] = useState<NovoItem[]>([]);
  // Quantidades alteradas nos insumos já salvos nesta solicitação (gravadas ao salvar).
  const [qtdEditada, setQtdEditada] = useState<Record<string, number>>({});
  const [editandoQtd, setEditandoQtd] = useState<{ id: string; texto: string } | null>(null);
  // Estoque da obra por insumo e etapa: mostra se o item pedido já está em estoque e onde.
  const [estoqueObra, setEstoqueObra] = useState<{ obraItemId: string; saldo: number; unidade: string; apropriacoes: { eapNoId: string; eapCodigo: string; quantidade: number }[] }[]>([]);
  useEffect(() => {
    if (!f.obraId) { setEstoqueObra([]); return; }
    api<{ itens: { obraItemId: string; saldo: number; unidade: string; apropriacoes: { eapNoId: string; eapCodigo: string; quantidade: number }[] }[] }>(`/sup/estoque?obraId=${f.obraId}`)
      .then((r) => setEstoqueObra(r.itens))
      .catch(() => setEstoqueObra([]));
  }, [f.obraId]);
  const [add, setAdd] = useState({ obraItemId: '', dataNecessaria: '', unidade: '' });
  // Apropriação do insumo escolhido: uma linha por nó da EAP, cada uma com a sua quantidade.
  const [linhas, setLinhas] = useState<{ eapNoId: string; quantidade: string }[]>([{ eapNoId: '', quantidade: '' }]);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    api<{ obras: ObraLista[] }>('/eng/obras')
      .then((r) => setObras(r.obras.filter((o) => o.ativo !== false)))
      .catch((e) => setErro((e as Error).message));
  }, []);

  // Ao escolher a obra: nível de apropriação, insumos da planilha, nós da EAP desse nível e necessidades pendentes.
  useEffect(() => {
    setNovos([]);
    setAdd({ obraItemId: '', dataNecessaria: '', unidade: '' });
    setLinhas([{ eapNoId: '', quantidade: '' }]);
    if (!f.obraId) {
      setNecessidades(null);
      setInsumos([]);
      setNos([]);
      setNivel('');
      return;
    }
    setNecessidades(null);
    Promise.all([
      api<{ obra: { nivelApropriacao: string } }>(`/eng/obras/${f.obraId}`),
      api<{ itens: InsumoPlanilha[] }>(`/eng/obras/${f.obraId}/itens?tipo=insumo`),
      api<{ nos: NoEapLista[] }>(`/eng/obras/${f.obraId}/eap`),
      api<{ necessidades: Necessidade[] }>(`/eng/obras/${f.obraId}/necessidades`),
    ])
      .then(([o, i, e, n]) => {
        setNivel(o.obra.nivelApropriacao);
        setInsumos(i.itens);
        setNos(e.nos.filter((x) => x.nivel === o.obra.nivelApropriacao));
        setNecessidades(n.necessidades);
      })
      .catch((e) => setErro((e as Error).message));
  }, [f.obraId]);

  // Pendentes com apropriação à EAP (ou já desta solicitação), para incluir sem reescolher o insumo.
  const disponiveis = useMemo(() => {
    const doAtual = new Set(inicial?.itens.map((i) => i.necessidadeId) ?? []);
    return (necessidades ?? []).filter((n) => (n.status === 'pendente' || doAtual.has(n.id)) && n.eapNoId).sort(ordenarEap);
  }, [necessidades, inicial]);
  const semEap = (necessidades ?? []).filter((n) => n.status === 'pendente' && !n.eapNoId).length;
  const totalItens = marcadas.size + novos.length;
  const insumoEscolhido = insumos.find((x) => x.id === add.obraItemId);
  const unidadeDoPedido = insumoEscolhido ? (insumoEscolhido.unidadesCompra.find((u) => u.unidade === add.unidade)?.unidade ?? insumoEscolhido.unidade) : '';
  const totalApropriado = linhas.reduce((s, l) => s + (lerNumero(l.quantidade) ?? 0), 0);

  function confirmarQtd(id: string) {
    if (!editandoQtd) return;
    const q = lerNumero(editandoQtd.texto);
    if (q === null || q <= 0) return setErro('Informe uma quantidade maior que zero.');
    setErro('');
    setQtdEditada({ ...qtdEditada, [id]: q });
    setEditandoQtd(null);
  }

  function alternar(id: string) {
    setMarcadas((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  function incluirNovo() {
    setErro('');
    const insumo = insumos.find((x) => x.id === add.obraItemId);
    if (!insumo) return setErro('Escolha o insumo da planilha.');
    const compra = add.unidade ? insumo.unidadesCompra.find((u) => u.unidade === add.unidade) : undefined;
    const usados = new Set<string>();
    const incluidos: NovoItem[] = [];
    for (const [k, l] of linhas.entries()) {
      if (nivel !== 'obra' && !l.eapNoId) return setErro(`Linha ${k + 1}: escolha o nó da EAP (${(ROTULO_NIVEL as Record<string, string>)[nivel] ?? nivel}).`);
      if (l.eapNoId && usados.has(l.eapNoId)) return setErro(`Linha ${k + 1}: este nó da EAP já está na apropriação. Use uma linha só para ele.`);
      if (l.eapNoId) usados.add(l.eapNoId);
      const q = lerNumero(l.quantidade);
      if (q === null || q <= 0) return setErro(`Linha ${k + 1}: informe uma quantidade maior que zero.`);
      const no = nos.find((x) => x.id === l.eapNoId);
      incluidos.push({
        chave: `n${Date.now()}${novos.length + k}`,
        obraItemId: insumo.id,
        eapNoId: nivel === 'obra' ? null : l.eapNoId,
        codigo: insumo.codigo,
        descricao: insumo.descricao,
        unidade: insumo.unidade,
        eapCodigo: no?.codigo ?? null,
        quantidade: q,
        dataNecessaria: add.dataNecessaria || null,
        unidadeCompra: compra?.unidade ?? null,
        fatorCompra: compra?.fator ?? null,
      });
    }
    setNovos([...novos, ...incluidos]);
    setAdd({ obraItemId: '', dataNecessaria: '', unidade: '' });
    setLinhas([{ eapNoId: '', quantidade: '' }]);
  }

  // Insumos incluídos e ainda não salvos: a tela avisa antes de sair.
  useEffect(() => { if (!inicial) aoSujar?.(novos.length > 0 && !ocupado); }, [novos.length, ocupado, inicial, aoSujar]);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    if (!f.obraId) return setErro('Escolha a obra.');
    if (totalItens === 0) return setErro('Inclua pelo menos um insumo.');
    setOcupado(true);
    try {
      const corpo = {
        obraId: f.obraId,
        data: f.data,
        necessidade: f.necessidade || null,
        observacao: f.observacao || null,
        itens: [
          ...[...marcadas].map((necessidadeId) => ({ necessidadeId, observacao: null, ...(qtdEditada[necessidadeId] !== undefined ? { quantidade: qtdEditada[necessidadeId] } : {}) })),
          ...novos.map((n) => ({ obraItemId: n.obraItemId, eapNoId: n.eapNoId, quantidade: n.quantidade, unidade: n.unidadeCompra, dataNecessaria: n.dataNecessaria, observacao: null })),
        ],
      };
      const r = inicial
        ? await api<{ solicitacao: Solicitacao }>(`/sup/solicitacoes/${inicial.id}`, { metodo: 'PUT', corpo })
        : await api<{ solicitacao: Solicitacao }>('/sup/solicitacoes', { corpo });
      aoSalvar(r.solicitacao);
    } catch (err) {
      setErro((err as Error).message);
      setOcupado(false);
    }
  }

  return (
    <form className="card form" onSubmit={salvar}>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div className="campos">
        <div className="campo">
          <label htmlFor="sol-obra">Obra</label>
          <select id="sol-obra" value={f.obraId} onChange={(e) => { setF({ ...f, obraId: e.target.value }); setMarcadas(new Set()); }}>
            <option value="">Escolha a obra</option>
            {obras.map((o) => <option key={o.id} value={o.id}>{o.codigo} · {o.nome}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="sol-data">Data</label>
          <input id="sol-data" type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="sol-nec">Precisa até</label>
          <input id="sol-nec" type="date" value={f.necessidade ?? ''} onChange={(e) => setF({ ...f, necessidade: e.target.value })} />
        </div>
      </div>

      <h2>Insumos da planilha</h2>
      {!f.obraId && <p className="muted small">Escolha a obra para ver os insumos da planilha dela.</p>}
      {f.obraId && necessidades === null && <p className="muted small">Carregando insumos…</p>}
      {f.obraId && necessidades !== null && (
        <>
          <div className="campos editor-linha">
            <SeletorBusca
              id="sol-ins"
              label="Insumo"
              opcoes={insumos.map((i) => ({ id: i.id, rotulo: `${i.codigo} · ${i.descricao}` }))}
              valor={add.obraItemId}
              onChange={(v) => setAdd({ ...add, obraItemId: v, unidade: '' })}
              vazio="Escolha o insumo"
              resultadosVisiveis
            />
            {(() => {
              const ins = insumos.find((x) => x.id === add.obraItemId);
              if (!ins) return null;
              return (
                <div className="campo">
                  <label htmlFor="sol-un">Unidade do pedido</label>
                  <select id="sol-un" value={add.unidade} onChange={(e) => setAdd({ ...add, unidade: e.target.value })}>
                    <option value="">{ins.unidade} (orçamento)</option>
                    {ins.unidadesCompra.map((u) => <option key={u.unidade} value={u.unidade}>{u.unidade} (1 {u.unidade} = {u.fator.toLocaleString('pt-BR')} {ins.unidade})</option>)}
                  </select>
                  {ins.unidadesCompra.length === 0 && <span className="ajuda">Sem outra unidade de compra cadastrada para este insumo.</span>}
                </div>
              );
            })()}
            {add.obraItemId && (() => {
              const e = estoqueObra.find((x) => x.obraItemId === add.obraItemId);
              return (
                <p className="small muted" style={{ flexBasis: '100%', margin: '0 0 8px' }}>
                  {e ? `Em estoque: ${e.saldo.toLocaleString('pt-BR')} ${e.unidade}` : 'Sem estoque deste insumo nesta obra.'}
                  {e && e.apropriacoes.length > 0 && ` · por etapa: ${e.apropriacoes.map((x) => `${x.eapCodigo} ${x.quantidade.toLocaleString('pt-BR')}`).join(' · ')}`}
                </p>
              );
            })()}
            <div className="campo">
              <label htmlFor="sol-dn">Precisa até (insumo)</label>
              <input id="sol-dn" type="date" value={add.dataNecessaria} onChange={(e) => setAdd({ ...add, dataNecessaria: e.target.value })} />
            </div>
          </div>
          {add.obraItemId && linhas.map((l, k) => {
            const nesta = estoqueObra.find((x) => x.obraItemId === add.obraItemId)?.apropriacoes.find((x) => x.eapNoId === l.eapNoId);
            const atualizar = (campos: Partial<{ eapNoId: string; quantidade: string }>) => setLinhas(linhas.map((x, i) => (i === k ? { ...x, ...campos } : x)));
            return (
              <div key={k} className="campos editor-linha">
                {nivel !== 'obra' && (
                  <div className="campo">
                    <label htmlFor={`sol-no-${k}`}>Nó da EAP ({(ROTULO_NIVEL as Record<string, string>)[nivel] ?? nivel})</label>
                    <select id={`sol-no-${k}`} value={l.eapNoId} onChange={(e) => atualizar({ eapNoId: e.target.value })}>
                      <option value="">Escolha…</option>
                      {nos.map((n) => <option key={n.id} value={n.id}>{' '.repeat(indentoEapSol(n.codigo))}{n.codigo} · {n.descricao}</option>)}
                    </select>
                    {l.eapNoId && nesta && <span className="ajuda">Nesta etapa já há {nesta.quantidade.toLocaleString('pt-BR')} {estoqueObra.find((x) => x.obraItemId === add.obraItemId)?.unidade ?? ''} em estoque.</span>}
                  </div>
                )}
                <div className="campo">
                  <label htmlFor={`sol-qtd-${k}`}>Quantidade{unidadeDoPedido ? ` (${unidadeDoPedido})` : ''}</label>
                  <input id={`sol-qtd-${k}`} className="mono" inputMode="decimal" value={l.quantidade} onChange={(e) => atualizar({ quantidade: e.target.value })} />
                </div>
                {nivel !== 'obra' && linhas.length > 1 && (
                  <div className="campo">
                    <span className="ajuda">&nbsp;</span>
                    <button className="btn btn-link" type="button" onClick={() => setLinhas(linhas.filter((_, i) => i !== k))}>Remover nó</button>
                  </div>
                )}
              </div>
            );
          })}
          {add.obraItemId && linhas.length > 1 && (
            <p className="small muted" style={{ marginTop: 0 }}>Total apropriado: {qtd(totalApropriado, unidadeDoPedido)}.</p>
          )}
          <div className="acoes">
            {add.obraItemId && nivel !== 'obra' && (
              <button className="btn btn-link" type="button" onClick={() => setLinhas([...linhas, { eapNoId: '', quantidade: '' }])}>+ Apropriar em outro nó da EAP</button>
            )}
            <button className="btn btn-secundario" type="button" onClick={incluirNovo}>Incluir insumo</button>
          </div>
        </>
      )}

      {inicial && inicial.itens.some((i) => i.necessidadeId && marcadas.has(i.necessidadeId)) && (
        <>
          <h2>Insumos desta solicitação</h2>
          <div style={{ overflowX: 'auto' }}>
            <table className="tabela">
              <thead>
                <tr><th>EAP</th><th>Insumo</th><th>Un.</th><th className="num">Quantidade</th><th style={{ width: 230 }} /></tr>
              </thead>
              <tbody>
                {inicial.itens.filter((i) => i.necessidadeId && marcadas.has(i.necessidadeId)).map((i) => (
                  <tr key={i.id}>
                    <td className="mono small">{i.eapCodigo ?? '—'}</td>
                    <td>{i.descricao}</td>
                    <td>{unidadeTexto(i.unidade)}</td>
                    <td className="num">
                      {qtd(qtdEditada[i.necessidadeId as string] ?? i.quantidade, i.unidade)}
                      {qtdEditada[i.necessidadeId as string] !== undefined && <div className="small muted">alterada</div>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {editandoQtd?.id === i.necessidadeId ? (
                        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                          <input aria-label="Nova quantidade" className="mono" style={{ width: 90 }} inputMode="decimal" value={editandoQtd.texto} onChange={(e) => setEditandoQtd({ id: editandoQtd.id, texto: e.target.value })} />
                          <button className="btn btn-link" type="button" onClick={() => confirmarQtd(i.necessidadeId as string)}>Confirmar</button>
                          <button className="btn btn-link" type="button" onClick={() => setEditandoQtd(null)}>Cancelar</button>
                        </span>
                      ) : (
                        <span style={{ display: 'inline-flex', gap: 12 }}>
                          <button className="btn btn-link" type="button" onClick={() => setEditandoQtd({ id: i.necessidadeId as string, texto: String(qtdEditada[i.necessidadeId as string] ?? i.quantidade).replace('.', ',') })}>Editar quantidade</button>
                          <button className="btn btn-link" type="button" onClick={() => alternar(i.necessidadeId as string)}>Excluir</button>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ marginTop: 0 }}>Excluir tira o insumo desta solicitação ao salvar. Ele volta para a lista de pendentes da obra.</p>
        </>
      )}

      {novos.length > 0 && (
        <table className="tabela">
          <thead>
            <tr><th>EAP</th><th>Insumo</th><th>Un.</th><th className="num">Quantidade</th><th>Precisa até</th><th style={{ width: 90 }} /></tr>
          </thead>
          <tbody>
            {novos.map((n) => (
              <tr key={n.chave}>
                <td className="mono small">{n.eapCodigo ?? '—'}</td>
                <td>{n.descricao}<div className="small muted mono">{n.codigo}</div></td>
                <td>{unidadeTexto(n.unidadeCompra ?? n.unidade)}</td>
                <td className="num">{qtd(n.quantidade, n.unidadeCompra ?? n.unidade)}{n.fatorCompra ? <div className="small muted">= {qtd(n.quantidade * n.fatorCompra, n.unidade)}</div> : null}</td>
                <td>{n.dataNecessaria ? formatarData(n.dataNecessaria) : '—'}</td>
                <td><button className="btn btn-link" type="button" onClick={() => setNovos(novos.filter((x) => x.chave !== n.chave))}>Remover</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {f.obraId && necessidades !== null && disponiveis.length > 0 && (
        <>
          <h2>Já apropriados e pendentes</h2>
          <p className="small muted" style={{ marginTop: 0 }}>Insumos lançados antes em Engenharia › Obras (apropriação) que ainda não foram pedidos.</p>
          <div style={{ overflowX: 'auto' }}>
            <table className="tabela">
              <thead>
                <tr>
                  <th style={{ width: 40 }} />
                  <th>EAP</th>
                  <th>Insumo</th>
                  <th>Un.</th>
                  <th className="num">Quantidade</th>
                  <th>Precisa até</th>
                </tr>
              </thead>
              <tbody>
                {disponiveis.map((n) => (
                  <tr key={n.id}>
                    <td>
                      <input type="checkbox" aria-label={`Incluir ${n.descricao}`} checked={marcadas.has(n.id)} onChange={() => alternar(n.id)} />
                    </td>
                    <td className="mono small">{n.eapCodigo} <span className="muted">{n.eapDescricao}</span></td>
                    <td>{n.descricao}<div className="small muted mono">{n.codigo}</div></td>
                    <td>{unidadeTexto(n.unidadeCompra ?? n.unidade)}</td>
                    <td className="num">{qtd(n.quantidadeCompra ?? n.quantidade, n.unidadeCompra ?? n.unidade)}</td>
                    <td>{n.dataNecessaria ? formatarData(n.dataNecessaria) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {semEap > 0 && <p className="small tom-perigo">{semEap} insumo(s) pendente(s) desta obra ainda não estão apropriados a um nó da EAP e não podem ser comprados.</p>}

      <div className="campo">
        <label htmlFor="sol-obs">Observação</label>
        <textarea id="sol-obs" rows={2} maxLength={500} value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} placeholder="Onde será usado, marca preferida, urgência…" />
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>{totalItens} {totalItens === 1 ? 'insumo na solicitação' : 'insumos na solicitação'}.</p>
      {!inicial && <p className="small muted" style={{ marginTop: 0 }}>O Salvar guarda a solicitação como aberta: você pode sair, voltar em Solicitações, completar os insumos e registrar quando terminar.</p>}
      <div className="acoes">
        <button className="btn btn-primario" type="submit" disabled={ocupado || !f.obraId || totalItens === 0}>{ocupado ? 'Salvando…' : inicial ? 'Salvar alterações' : 'Salvar'}</button>
        {aoCancelar && <button className="btn btn-secundario" type="button" onClick={aoCancelar}>Cancelar</button>}
      </div>
    </form>
  );
}

// ---------- Formulário de serviços: composições cadastradas na obra ----------
type ComposicaoPlanilha = { id: string; codigo: string; descricao: string; unidade: string };
type LinhaOrcamento = { id: string; obraItemId: string; eapNoId: string | null; codigo: string; descricao: string; unidade: string; eapCodigo: string | null; eapDescricao: string | null };
type OpcaoServico = { id: string; rotulo: string; obraItemId: string; eapNoId: string | null };
/** Uma opção por nó da EAP em que o serviço está no orçamento (com o código do nó); serviço fora do orçamento por nó segue sem nó. */
function opcoesDeServico(composicoes: ComposicaoPlanilha[], linhas: LinhaOrcamento[]): OpcaoServico[] {
  const noOrcamento = new Set(linhas.map((l) => l.obraItemId));
  const doOrcamento = linhas.map((l) => ({ id: `l:${l.id}`, rotulo: `${l.eapCodigo ? `${l.eapCodigo}${l.eapDescricao ? ` ${l.eapDescricao}` : ''} · ` : ''}${l.codigo} · ${l.descricao}`, obraItemId: l.obraItemId, eapNoId: l.eapNoId }));
  const semNo = composicoes.filter((i) => !noOrcamento.has(i.id)).map((i) => ({ id: `s:${i.id}`, rotulo: `${i.codigo} · ${i.descricao}`, obraItemId: i.id, eapNoId: null }));
  return [...doOrcamento, ...semNo];
}
type SaldoServico = { orcado: number; contratado: number; medido: number; saldoContratar: number; unidade: string | null };
type NovoServico = { chave: string; obraItemId: string; eapNoId: string | null; codigo: string | null; descricao: string; unidade: string; eapCodigo: string | null; quantidade: number };

/** Nome completo da conta com as categorias acima dela, ex.: "3 · Despesas › 3.7 · Serviços Terceirizados". */
function caminhoConta(p: PlanoConta, todas: PlanoConta[]): string {
  const porId = new Map(todas.map((x) => [x.id, x]));
  const partes: string[] = [];
  const vistas = new Set<string>();
  for (let atual: PlanoConta | undefined = p; atual && !vistas.has(atual.id); atual = atual.paiId ? porId.get(atual.paiId) : undefined) {
    vistas.add(atual.id);
    partes.unshift(`${atual.codigo} · ${atual.nome}`);
  }
  return partes.join(' › ');
}

function FormServico({ inicial, aoSalvar, aoCancelar }: { inicial?: Solicitacao; aoSalvar: (s: Solicitacao) => void; aoCancelar?: () => void }) {
  const [obras, setObras] = useState<ObraLista[]>([]);
  const [planos, setPlanos] = useState<PlanoConta[]>([]);
  const [contas, setContas] = useState<PlanoConta[]>([]);
  const [f, setF] = useState({
    obraId: inicial?.obraId ?? '',
    data: inicial?.data ?? hojeLocal(),
    necessidade: inicial?.necessidade ?? '',
    planoContaId: inicial?.planoContaId ?? '',
    observacao: inicial?.observacao ?? '',
  });
  const [composicoes, setComposicoes] = useState<ComposicaoPlanilha[] | null>(null);
  const [linhas, setLinhas] = useState<LinhaOrcamento[]>([]);
  const [saldo, setSaldo] = useState<SaldoServico | null>(null);
  const [nos, setNos] = useState<NoEapLista[]>([]);
  const [nivel, setNivel] = useState<string>('');
  const [novos, setNovos] = useState<NovoServico[]>(() =>
    (inicial?.itens ?? [])
      .filter((i) => i.obraItemId)
      .map((i) => ({ chave: i.id, obraItemId: i.obraItemId as string, eapNoId: i.eapNoId, codigo: null, descricao: i.descricao, unidade: i.unidade, eapCodigo: i.eapCodigo, quantidade: i.quantidade })),
  );
  const [add, setAdd] = useState({ obraItemId: '', eapNoId: '', quantidade: '' });
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    api<{ obras: ObraLista[] }>('/eng/obras')
      .then((r) => setObras(r.obras.filter((o) => o.ativo !== false)))
      .catch((e) => setErro((e as Error).message));
    api<{ contas: PlanoConta[] }>('/fin/plano-contas')
      .then((r) => {
        const ativas = r.contas.filter((p) => p.tipo === 'despesa' && p.ativo);
        setContas(ativas);
        setPlanos(ativas.filter((p) => p.aceitaLancamento));
      })
      .catch((e) => setErro((e as Error).message));
  }, []);

  // Saldo do serviço escolhido na obra: orçado, já contratado, já medido e o que ainda pode ser contratado.
  useEffect(() => {
    setSaldo(null);
    if (!f.obraId || !add.obraItemId) return;
    let vivo = true;
    api<{ saldo: SaldoServico }>(`/sup/servicos/${add.obraItemId}/saldo?obraId=${f.obraId}`)
      .then((r) => {
        if (vivo) setSaldo(r.saldo);
      })
      .catch(() => {
        if (vivo) setSaldo(null);
      });
    return () => {
      vivo = false;
    };
  }, [f.obraId, add.obraItemId]);

  // Só carrega os dados da obra; a troca de obra (no onChange) é que limpa os serviços já escolhidos.
  useEffect(() => {
    if (!f.obraId) {
      setComposicoes(null);
      setNos([]);
      setNivel('');
      return;
    }
    setComposicoes(null);
    Promise.all([
      api<{ obra: { nivelApropriacao: string } }>(`/eng/obras/${f.obraId}`),
      api<{ itens: ComposicaoPlanilha[]; linhas: LinhaOrcamento[] }>(`/eng/obras/${f.obraId}/itens?tipo=composicao`),
      api<{ nos: NoEapLista[] }>(`/eng/obras/${f.obraId}/eap`),
    ])
      .then(([o, i, e]) => {
        setNivel(o.obra.nivelApropriacao);
        setComposicoes(i.itens);
        setLinhas(i.linhas ?? []);
        setNos(e.nos.filter((x) => x.nivel === o.obra.nivelApropriacao));
      })
      .catch((e) => setErro((e as Error).message));
  }, [f.obraId]);

  function trocarObra(obraId: string) {
    setF({ ...f, obraId });
    setNovos([]);
    setAdd({ obraItemId: '', eapNoId: '', quantidade: '' });
  }

  function incluirNovo() {
    setErro('');
    const servico = composicoes?.find((x) => x.id === add.obraItemId);
    if (!servico) return setErro('Escolha o serviço cadastrado na obra.');
    if (nivel !== 'obra' && !add.eapNoId) return setErro(`Escolha o nó da EAP (${(ROTULO_NIVEL as Record<string, string>)[nivel] ?? nivel}).`);
    const q = lerNumero(add.quantidade);
    if (q === null || q <= 0) return setErro('Informe uma quantidade maior que zero.');
    const no = nos.find((x) => x.id === add.eapNoId);
    setNovos([...novos, {
      chave: `s${Date.now()}${novos.length}`,
      obraItemId: servico.id,
      eapNoId: nivel === 'obra' ? null : add.eapNoId,
      codigo: servico.codigo,
      descricao: servico.descricao,
      unidade: servico.unidade,
      eapCodigo: no?.codigo ?? null,
      quantidade: q,
    }]);
    setAdd({ obraItemId: '', eapNoId: '', quantidade: '' });
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    if (!f.obraId) return setErro('Escolha a obra.');
    if (!f.planoContaId) return setErro('Escolha a categoria (plano de contas) do serviço.');
    if (novos.length === 0) return setErro('Inclua pelo menos um serviço.');
    setOcupado(true);
    try {
      const corpo = {
        tipo: 'servico' as const,
        obraId: f.obraId,
        data: f.data,
        necessidade: f.necessidade || null,
        observacao: f.observacao || null,
        planoContaId: f.planoContaId,
        itens: novos.map((n) => ({ obraItemId: n.obraItemId, eapNoId: n.eapNoId, quantidade: n.quantidade, observacao: null })),
      };
      const r = inicial
        ? await api<{ solicitacao: Solicitacao }>(`/sup/solicitacoes/${inicial.id}`, { metodo: 'PUT', corpo })
        : await api<{ solicitacao: Solicitacao }>('/sup/solicitacoes', { corpo });
      aoSalvar(r.solicitacao);
    } catch (err) {
      setErro((err as Error).message);
      setOcupado(false);
    }
  }

  return (
    <form className="card form" onSubmit={salvar}>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div className="campos">
        <div className="campo">
          <label htmlFor="serv-obra">Obra</label>
          <select id="serv-obra" value={f.obraId} onChange={(e) => trocarObra(e.target.value)}>
            <option value="">Escolha a obra</option>
            {obras.map((o) => <option key={o.id} value={o.id}>{o.codigo} · {o.nome}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="serv-data">Data</label>
          <input id="serv-data" type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="serv-nec">Precisa até</label>
          <input id="serv-nec" type="date" value={f.necessidade ?? ''} onChange={(e) => setF({ ...f, necessidade: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="serv-cat">Categoria (plano de contas)</label>
          <select id="serv-cat" value={f.planoContaId} onChange={(e) => setF({ ...f, planoContaId: e.target.value })}>
            <option value="">Escolha…</option>
            {planos.map((p) => <option key={p.id} value={p.id}>{caminhoConta(p, contas)}</option>)}
          </select>
        </div>
      </div>

      <h2>Serviços da obra</h2>
      {!f.obraId && <p className="muted small">Escolha a obra para ver os serviços cadastrados nela.</p>}
      {f.obraId && composicoes === null && <p className="muted small">Carregando serviços…</p>}
      {f.obraId && composicoes !== null && (
        <>
          {composicoes.length === 0 && <p className="small muted">Esta obra ainda não tem serviços cadastrados no orçamento.</p>}
          <div className="campos editor-linha">
            <SeletorBusca
              id="serv-item"
              label="Serviço"
              opcoes={opcoesDeServico(composicoes, linhas).map((o) => ({ id: o.id, rotulo: o.rotulo }))}
              valor={opcoesDeServico(composicoes, linhas).find((o) => o.obraItemId === add.obraItemId && (o.eapNoId ?? '') === add.eapNoId)?.id ?? ''}
              onChange={(v) => {
                const o = opcoesDeServico(composicoes, linhas).find((x) => x.id === v);
                setAdd({ ...add, obraItemId: o?.obraItemId ?? '', eapNoId: o?.eapNoId ?? '' });
              }}
              vazio="Escolha o serviço"
              listaCompleta
            />
            {nivel !== 'obra' && add.obraItemId && !add.eapNoId && (
              <div className="campo">
                <label htmlFor="serv-no">Nó da EAP ({(ROTULO_NIVEL as Record<string, string>)[nivel] ?? nivel})</label>
                <select id="serv-no" value={add.eapNoId} onChange={(e) => setAdd({ ...add, eapNoId: e.target.value })}>
                  <option value="">Escolha…</option>
                  {nos.map((n) => <option key={n.id} value={n.id}>{' '.repeat(indentoEapSol(n.codigo))}{n.codigo} · {n.descricao}</option>)}
                </select>
              </div>
            )}
            <div className="campo">
              <label htmlFor="serv-qtd">Quantidade</label>
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <input id="serv-qtd" className="mono" inputMode="decimal" value={add.quantidade} onChange={(e) => setAdd({ ...add, quantidade: e.target.value })} />
                {(() => {
                  const unidade = composicoes?.find((i) => i.id === add.obraItemId)?.unidade;
                  return unidade ? <span className="small muted">({unidadeTexto(unidade)})</span> : null;
                })()}
              </span>
            </div>
          </div>
          {saldo && (
            <div className="alerta" role="status" style={{ marginTop: 8 }}>
              <b>Referência da obra:</b> orçado {qtd(saldo.orcado, saldo.unidade ?? undefined)} · já contratado {qtd(saldo.contratado, saldo.unidade ?? undefined)} · já medido {qtd(saldo.medido, saldo.unidade ?? undefined)} ·{' '}
              <b>saldo a contratar {qtd(saldo.saldoContratar, saldo.unidade ?? undefined)}</b>
            </div>
          )}
          <div className="acoes">
            <button className="btn btn-secundario" type="button" onClick={incluirNovo}>Incluir serviço</button>
          </div>
        </>
      )}

      {novos.length > 0 && (
        <table className="tabela">
          <thead>
            <tr><th>EAP</th><th>Serviço</th><th>Un.</th><th className="num">Quantidade</th><th style={{ width: 90 }} /></tr>
          </thead>
          <tbody>
            {novos.map((n) => (
              <tr key={n.chave}>
                <td className="mono small">{n.eapCodigo ?? '—'}</td>
                <td>{n.descricao}{n.codigo && <div className="small muted mono">{n.codigo}</div>}</td>
                <td>{unidadeTexto(n.unidade)}</td>
                <td className="num">{qtd(n.quantidade, n.unidade)}</td>
                <td><button className="btn btn-link" type="button" onClick={() => setNovos(novos.filter((x) => x.chave !== n.chave))}>Remover</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="campo">
        <label htmlFor="serv-obs">Observação</label>
        <textarea id="serv-obs" rows={2} maxLength={500} value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} placeholder="Local, condições, prazo de execução…" />
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>{novos.length} {novos.length === 1 ? 'serviço na solicitação' : 'serviços na solicitação'}.</p>
      <div className="acoes">
        <button className="btn btn-primario" type="submit" disabled={ocupado || !f.obraId || !f.planoContaId || novos.length === 0}>{ocupado ? 'Salvando…' : inicial ? 'Salvar alterações' : 'Registrar solicitação'}</button>
        {aoCancelar && <button className="btn btn-secundario" type="button" onClick={aoCancelar}>Cancelar</button>}
      </div>
    </form>
  );
}

export function NovaSolicitacao({ tipo = 'insumo' }: { tipo?: TipoSolicitacao }) {
  const navegar = useNavigate();
  const servico = tipo === 'servico';
  const [sujo, setSujo] = useState(false);
  const aoSalvar = (s: Solicitacao) => { setSujo(false); navegar(`/sup/solicitacoes/${s.id}`, { replace: true }); };
  // Sair com insumos não salvos perde a lista: pede confirmação ao fechar a aba ou recarregar.
  useEffect(() => {
    if (!sujo) return;
    const aviso = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', aviso);
    return () => window.removeEventListener('beforeunload', aviso);
  }, [sujo]);
  const confirmaSaida = (e: MouseEvent<HTMLAnchorElement>) => {
    if (sujo && !window.confirm('Há insumos não salvos nesta solicitação. Sair agora perde a lista. Continuar?')) e.preventDefault();
  };
  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <Link to={CAMINHO_LISTA[tipo]} className="small" onClick={confirmaSaida}>← {servico ? 'Solicitação de serviços' : 'Solicitações'}</Link>
          <h1>{servico ? 'Nova solicitação de serviços' : 'Nova solicitação de compra'}</h1>
        </div>
      </div>
      {servico ? <FormServico aoSalvar={aoSalvar} /> : <FormSolicitacao aoSalvar={aoSalvar} aoSujar={setSujo} />}
    </>
  );
}

// ---------- Detalhe ----------
export function SolicitacaoDetalhe() {
  const { id } = useParams();
  const navegar = useNavigate();
  const { fornecedores } = useCadastrosCompra();
  const [s, setS] = useState<Solicitacao | null>(null);
  const [erro, setErro] = useState('');
  const [editar, setEditar] = useState(false);
  const [cotar, setCotar] = useState<{ fornecedorIds: string[]; prazoResposta: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(() => {
    api<{ solicitacao: Solicitacao }>(`/sup/solicitacoes/${id}`).then((r) => setS(r.solicitacao)).catch((e) => setErro((e as Error).message));
  }, [id]);
  useEffect(carregar, [carregar]);

  async function acao(caminho: 'finalizar' | 'reabrir' | 'cancelar', pergunta?: string) {
    if (!s) return;
    if (pergunta && !window.confirm(pergunta)) return;
    setErro('');
    setOcupado(true);
    try {
      setS((await api<{ solicitacao: Solicitacao }>(`/sup/solicitacoes/${s.id}/${caminho}`, { metodo: 'POST' })).solicitacao);
    } catch (e) {
      setErro((e as Error).message);
    }
    setOcupado(false);
  }

  async function criarCotacao(e: FormEvent) {
    e.preventDefault();
    if (!s || !cotar) return;
    setErro('');
    if (cotar.fornecedorIds.length === 0) return setErro('Escolha pelo menos um fornecedor.');
    setOcupado(true);
    try {
      const r = await api<{ cotacao: { id: string } }>('/sup/cotacoes', { corpo: { solicitacaoId: s.id, prazoResposta: cotar.prazoResposta || null, fornecedorIds: cotar.fornecedorIds } });
      navegar(`/sup/cotacoes/${r.cotacao.id}`);
    } catch (err) {
      setErro((err as Error).message);
      setOcupado(false);
    }
  }

  if (!s) return erro ? <div className="alerta alerta-erro">{erro}</div> : <p className="muted">Carregando…</p>;
  const emAberto = s.status === 'aberta' || s.status === 'finalizada' || s.status === 'em_cotacao';
  const servico = s.tipo === 'servico';

  return (
    <>
      <div className="nao-imprimir">
        <Link to={CAMINHO_LISTA[s.tipo]} className="small">← {servico ? 'Solicitação de serviços' : 'Solicitações'}</Link>
      </div>
      <CabecalhoDocumento
        modulo="Suprimentos"
        titulo={`${servico ? 'Solicitação de serviços' : 'Solicitação de compra'} nº ${numeroDoc(s.numero)}`}
        descricao={s.obra ? `Obra ${s.obra.codigo} · ${s.obra.nome}` : undefined}
        filtros={[`Data: ${formatarData(s.data)}`, s.necessidade ? `Precisa até: ${formatarData(s.necessidade)}` : '', `Situação: ${SELO_SOLICITACAO[s.status].texto}`]}
        logoDireita
      />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}

      {editar ? (
        servico ? (
          <FormServico inicial={s} aoSalvar={(n) => { setS(n); setEditar(false); }} aoCancelar={() => setEditar(false)} />
        ) : (
          <FormSolicitacao inicial={s} aoSalvar={(n) => { setS(n); setEditar(false); }} aoCancelar={() => setEditar(false)} />
        )
      ) : (
        <>
          <div className="card tabela-caixa solicitacao-itens">
            <h2>{servico ? 'Serviços' : 'Insumos'} <span className="small muted" style={{ fontWeight: 400 }}>· {s.itens.length} {s.itens.length === 1 ? 'item' : 'itens'}</span></h2>
            <table className="tabela">
              <thead>
                <tr><th style={{ width: '18%' }}>Código</th><th>{servico ? 'Serviço' : 'Insumo'}</th><th className="num" style={{ width: '16%' }}>Quantidade</th></tr>
              </thead>
              <tbody>
                {s.itens.map((i) => (
                  <tr key={i.id}>
                    <td className="mono small">{i.codigo ?? '—'}</td>
                    <td>{i.descricao}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{qtd(i.quantidade, i.unidade)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {s.observacao && <p className="small" style={{ marginBottom: 0 }}><b>Observação:</b> {s.observacao}</p>}
            <p className="small muted" style={{ marginBottom: 0 }}>Solicitado por {s.solicitante ?? '—'}{s.finalizadaEm ? ` · finalizada em ${formatarData(s.finalizadaEm.slice(0, 10))}` : ''}.</p>
          </div>

          {(s.cotacoes.length > 0 || s.pedidos.length > 0) && (
            <div className="card">
              <h2>Andamento</h2>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {s.cotacoes.map((c) => (
                  <li key={c.id}>
                    <Link to={`/sup/cotacoes/${c.id}`}>Cotação nº {numeroDoc(c.numero)}</Link> <Selo s={SELO_COTACAO[c.status]} />
                  </li>
                ))}
                {s.pedidos.map((p) => (
                  <li key={p.id}>
                    <Link to={`/sup/pedidos/${p.id}`}>Pedido de compra nº {numeroDoc(p.numero)}</Link> <Selo s={SELO_PEDIDO[p.status]} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {emAberto && !cotar && (
            <div className="acoes nao-imprimir">
              {s.status === 'aberta' && (
                <>
                  <button className="btn btn-primario" type="button" disabled={ocupado} onClick={() => acao('finalizar')}>Registrar solicitação</button>
                  <button className="btn btn-link" type="button" onClick={() => setEditar(true)}>Editar</button>
                </>
              )}
              {s.status === 'finalizada' && (
                <>
                  <button className="btn btn-primario" type="button" onClick={() => setCotar({ fornecedorIds: [], prazoResposta: somarDias(hojeLocal(), 3) })}>Cotar com fornecedores</button>
                  <button className="btn btn-link" type="button" disabled={ocupado} onClick={() => acao('reabrir')}>Reabrir para editar</button>
                </>
              )}
              <button className="btn btn-link" type="button" disabled={ocupado} onClick={() => acao('cancelar', 'Cancelar esta solicitação? Os insumos voltam a ficar pendentes na obra.')}>
                Cancelar solicitação
              </button>
            </div>
          )}

          {cotar && (
            <form className="card form nao-imprimir" onSubmit={criarCotacao}>
              <h2>Cotar com fornecedores</h2>
              <span className="small muted">Escolha até 10 fornecedores. Depois você lança o preço de cada um e o sistema monta o mapa.</span>
              <div className="lista-marcar">
                {fornecedores.map((f) => (
                  <label key={f.id} className="marcar">
                    <input
                      type="checkbox"
                      checked={cotar.fornecedorIds.includes(f.id)}
                      onChange={(e) => setCotar({ ...cotar, fornecedorIds: e.target.checked ? [...cotar.fornecedorIds, f.id].slice(0, 10) : cotar.fornecedorIds.filter((x) => x !== f.id) })}
                    />
                    <span>{nomeFornecedor(f)}{f.ramo ? <span className="small muted"> · {f.ramo}</span> : null}</span>
                  </label>
                ))}
              </div>
              <div className="campos">
                <div className="campo">
                  <label htmlFor="cot-prazo">Prazo para resposta</label>
                  <input id="cot-prazo" type="date" value={cotar.prazoResposta} onChange={(e) => setCotar({ ...cotar, prazoResposta: e.target.value })} />
                </div>
              </div>
              <div className="acoes">
                <button className="btn btn-primario" type="submit" disabled={ocupado}>Criar cotação</button>
                <button className="btn btn-secundario" type="button" onClick={() => setCotar(null)}>Voltar</button>
              </div>
            </form>
          )}

          <div className="so-imprimir assinaturas assinaturas-compactas">
            <Assinatura nome={s.solicitante ?? ''} papel="Solicitante" />
            <Assinatura nome="" papel="Aprovação / Compras" />
          </div>
        </>
      )}
    </>
  );
}
