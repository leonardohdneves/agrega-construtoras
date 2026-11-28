// Engenharia · Importar quantitativos: lê o projeto (PDF pela IA, ou HTML com tabelas), concilia cada linha com as
// composições e lança no orçamento. Nada entra na planilha antes de o operador marcar e confirmar.
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, lerNumero } from '../api';
import type { ItemObra, Obra } from './EngObras';
import { POSICAO, ROTULO, type Linha } from './EngPlanilha';

type CandidataProjeto = { id: string; tabelaId: string; tabela: string; fonte: string; codigo: string; descricao: string; unidade: string; pontos: number };
/** Quantitativo lido: no IFC vem com o pavimento e o tipo do elemento (a EAP segue os dois). */
type LidoProjeto = { servico: string; descricao: string; unidade: string; quantidade: number; origem: string; candidatas: CandidataProjeto[]; pavimento?: string; tipo?: string };
/** Composição escolhida para a linha: 'cand' = sugerida pelas tabelas da empresa; 'obra' = já na tabela própria da obra. */
type EscolhaProjeto = { marcado: boolean; fonte: 'cand' | 'obra' | ''; refId: string; quantidade: string; descricao: string };

/** Linha marcada para lançar: vem da tabela própria da obra (item) ou de uma sugestão das tabelas (cand). */
type Escolhida = { item: ItemObra | null; cand: CandidataProjeto | null; quantidade: number; descricao: string; ifc: { pavimento: string; tipo: string } | null };

const ROTULO_SERVICO: Record<string, string> = { forma: 'Forma', armacao: 'Armação', concreto: 'Concreto', outro: 'Outro' };

const ehHtml = (arquivo: File | null) => !!arquivo && /\.html?$/i.test(arquivo.name);
const ehIfc = (arquivo: File | null) => !!arquivo && /\.ifc$/i.test(arquivo.name);
const ROTULO_TIPO_IFC: Record<string, string> = { parede: 'Paredes', laje: 'Lajes', pilar: 'Pilares', viga: 'Vigas', porta: 'Portas', janela: 'Janelas' };

/** Cria a linha da EAP uma vez por chave (pavimento ou tipo dentro do pavimento) e devolve o id dela. */
async function garantirNoIfc(cache: Map<string, string>, obraId: string, chave: string, nivel: 'etapa' | 'subetapa', descricao: string, paiId: string | null): Promise<string> {
  const ja = cache.get(chave);
  if (ja) return ja;
  const r = await api<{ id: string }>(`/eng/obras/${obraId}/planilha`, { corpo: { nivel, descricao, paiId } });
  cache.set(chave, r.id);
  return r.id;
}

function lerArquivoBase64(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result).split(',')[1] ?? '');
    leitor.onerror = () => reject(new Error('Não consegui ler o arquivo.'));
    leitor.readAsDataURL(arquivo);
  });
}

export function EngImportarQuantitativos() {
  const [params, setParams] = useSearchParams();
  const [obras, setObras] = useState<Obra[] | null>(null);
  const [obra, setObra] = useState<Obra | null>(null);
  const [itens, setItens] = useState<ItemObra[]>([]);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [erro, setErro] = useState('');
  const escolhida = params.get('obra') ?? obras?.[0]?.id ?? '';

  useEffect(() => {
    api<{ obras: Obra[] }>('/eng/obras')
      .then((r) => setObras(r.obras))
      .catch((e) => setErro((e as Error).message));
  }, []);

  async function carregarItens() {
    if (!escolhida) return;
    try {
      const r = await api<{ itens: ItemObra[] }>(`/eng/obras/${escolhida}/itens`);
      setItens(r.itens);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function carregarPlanilha() {
    if (!escolhida) return;
    try {
      const r = await api<{ linhas: Linha[] }>(`/eng/obras/${escolhida}/planilha`);
      setLinhas(r.linhas);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  useEffect(() => {
    if (!escolhida) return;
    setObra(null);
    Promise.all([
      api<{ obra: Obra }>(`/eng/obras/${escolhida}`),
      api<{ itens: ItemObra[] }>(`/eng/obras/${escolhida}/itens`),
      api<{ linhas: Linha[] }>(`/eng/obras/${escolhida}/planilha`),
    ])
      .then(([o, i, p]) => {
        setObra(o.obra);
        setItens(i.itens);
        setLinhas(p.linhas);
        setErro('');
      })
      .catch((e) => setErro((e as Error).message));
  }, [escolhida]);

  return (
    <>
      <div className="card" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {obras && obras.length > 0 ? (
          <div className="campo" style={{ minWidth: 260, margin: 0 }}>
            <label htmlFor="iq-obra">Obra</label>
            <select id="iq-obra" value={escolhida} onChange={(e) => setParams({ obra: e.target.value })}>
              {obras.map((o) => (
                <option key={o.id} value={o.id}>{o.nome}</option>
              ))}
            </select>
          </div>
        ) : (
          obras && <p className="muted" style={{ margin: 0 }}>Cadastre uma obra para importar quantitativos.</p>
        )}
        {escolhida && (
          <div className="small muted" style={{ marginLeft: 'auto' }}>
            <Link to={`/eng/eap?obra=${escolhida}`}>Ir para EAP e orçamento</Link>
          </div>
        )}
      </div>

      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}

      {obra ? (
        <LeituraProjeto
          key={obra.id}
          obra={obra}
          linhas={linhas}
          itens={itens}
          setErro={setErro}
          aoLancar={carregarPlanilha}
          aoMudarItens={setItens}
          atualizarItens={carregarItens}
        />
      ) : (
        escolhida && <p className="muted">Carregando…</p>
      )}
    </>
  );
}

function LeituraProjeto({
  obra,
  linhas,
  itens,
  setErro,
  aoLancar,
  aoMudarItens,
  atualizarItens,
}: {
  obra: Obra;
  linhas: Linha[];
  itens: ItemObra[];
  setErro: (m: string) => void;
  aoLancar: () => Promise<void>;
  aoMudarItens: (novos: ItemObra[]) => void;
  atualizarItens: () => Promise<void>;
}) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [analisando, setAnalisando] = useState(false);
  const [lancando, setLancando] = useState(false);
  const [lidos, setLidos] = useState<LidoProjeto[] | null>(null);
  const [pendencias, setPendencias] = useState<string[]>([]);
  const [escolhas, setEscolhas] = useState<EscolhaProjeto[]>([]);
  const [pai, setPai] = useState('auto');
  const [feito, setFeito] = useState('');
  // No HTML, a descrição da linha é sempre a da composição escolhida, como está na tabela.
  const [lidoDeHtml, setLidoDeHtml] = useState(false);

  // As mesmas posições da linha "Adicionar linha": etapa, subetapa ou obra.
  const pais = linhas.filter((l) => POSICAO[l.nivel] < POSICAO.tarefa);
  const composicoesDaObra = itens.filter((i) => i.tipo === 'composicao');

  function atualizar(i: number, campo: Partial<EscolhaProjeto>) {
    setEscolhas((es) => es.map((e, k) => (k === i ? { ...e, ...campo } : e)));
  }

  function escolherComposicao(i: number, valor: string) {
    if (!valor) return atualizar(i, { marcado: false, fonte: '', refId: '' });
    const sep = valor.indexOf(':');
    const fonte = valor.slice(0, sep) as 'cand' | 'obra';
    const refId = valor.slice(sep + 1);
    const descricao = fonte === 'obra' ? itens.find((it) => it.id === refId)?.descricao : lidos?.[i]?.candidatas.find((c) => c.id === refId)?.descricao;
    atualizar(i, { marcado: true, fonte, refId, ...(lidoDeHtml && descricao ? { descricao } : {}) });
  }

  async function analisar() {
    if (!arquivo) return setErro('Escolha o arquivo do projeto (PDF, HTML ou IFC).');
    // Acima do limite o servidor recusa o envio inteiro; avisa aqui, antes de subir o arquivo.
    if (ehIfc(arquivo) && arquivo.size > 60 * 1024 * 1024) {
      return setErro(`O modelo tem ${(arquivo.size / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB; o máximo é 60 MB.`);
    }
    setErro('');
    setFeito('');
    setAnalisando(true);
    setLidos(null);
    setLidoDeHtml(ehHtml(arquivo) || ehIfc(arquivo));
    try {
      const base64 = await lerArquivoBase64(arquivo);
      // IFC: volumes por pavimento e tipo (sem IA). HTML: tabelas diretas. PDF: leitura pela IA.
      const rota = ehIfc(arquivo) ? 'leitura-ifc' : ehHtml(arquivo) ? 'leitura-html' : 'leitura-projeto';
      const r = await api<{ itens: LidoProjeto[]; pendencias: string[] }>(`/eng/obras/${obra.id}/${rota}`, { corpo: { arquivo: base64, nome: arquivo.name } });
      setLidos(r.itens);
      setPendencias(r.pendencias);
      setEscolhas(
        r.itens.map((x) => {
          const cand = x.candidatas[0];
          return {
            marcado: !!cand,
            fonte: cand ? 'cand' : '',
            refId: cand?.id ?? '',
            quantidade: x.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 4 }),
            descricao: (ehHtml(arquivo) || ehIfc(arquivo)) && cand ? cand.descricao : x.descricao,
          };
        }),
      );
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAnalisando(false);
    }
  }

  async function lancar() {
    if (!lidos) return;
    const escolhidas = lidos.flatMap<Escolhida>((x, i) => {
      const e = escolhas[i];
      const q = lerNumero(e?.quantidade ?? '');
      if (!e?.marcado || !e.fonte || q === null || q <= 0) return [];
      const descricao = e.descricao.trim();
      const ifc = x.pavimento && x.tipo ? { pavimento: x.pavimento, tipo: x.tipo } : null;
      if (e.fonte === 'obra') {
        const item = itens.find((it) => it.id === e.refId);
        return item ? [{ item, cand: null, quantidade: q, descricao, ifc }] : [];
      }
      const cand = x.candidatas.find((c) => c.id === e.refId);
      return cand ? [{ item: null, cand, quantidade: q, descricao, ifc }] : [];
    });
    if (escolhidas.length === 0) return setErro('Marque ao menos uma linha com composição escolhida e quantidade.');
    setErro('');
    setFeito('');
    setLancando(true);
    let atuais = itens;
    let feitas = 0;
    let falha = '';
    const noIfc = new Map<string, string>();
    try {
      for (const { item: escolhidaDaObra, cand, quantidade, descricao, ifc } of escolhidas) {
        let item = escolhidaDaObra ?? undefined;
        if (!item && cand) {
          // Inclui a composição na obra só se ela ainda não estiver lá (a importação ignora o que já existe).
          item = atuais.find((i) => i.tipo === 'composicao' && i.codigo === cand.codigo);
          if (!item) {
            await api(`/eng/obras/${obra.id}/importar`, { corpo: { tabelaId: cand.tabelaId, composicaoIds: [cand.id] } });
            atuais = (await api<{ itens: ItemObra[] }>(`/eng/obras/${obra.id}/itens`)).itens;
            item = atuais.find((i) => i.tipo === 'composicao' && i.codigo === cand.codigo);
          }
        }
        if (!item) throw new Error('Não consegui incluir uma composição na obra. Atualize a lista de composições e tente de novo.');
        const corpo: Record<string, unknown> = { nivel: 'tarefa', descricao: (lidoDeHtml ? item.descricao : descricao || item.descricao).slice(0, 200), itemId: item.id, quantidade };
        if (ifc) {
          // IFC: etapa = pavimento, subetapa = tipo de elemento; o serviço entra dentro da subetapa.
          const etapaId = await garantirNoIfc(noIfc, obra.id, `e|${ifc.pavimento}`, 'etapa', ifc.pavimento, null);
          corpo.paiId = await garantirNoIfc(noIfc, obra.id, `s|${ifc.pavimento}|${ifc.tipo}`, 'subetapa', ROTULO_TIPO_IFC[ifc.tipo] ?? ifc.tipo, etapaId);
        } else if (pai === 'raiz') corpo.paiId = null;
        else if (pai !== 'auto') corpo.paiId = pai;
        await api(`/eng/obras/${obra.id}/planilha`, { corpo });
        feitas++;
      }
    } catch (e) {
      falha = (e as Error).message;
    } finally {
      aoMudarItens(atuais);
      await aoLancar();
      setLancando(false);
      if (falha) setErro(`${feitas} de ${escolhidas.length} linhas lançadas. ${falha}`);
      else {
        setFeito(`${feitas} ${feitas === 1 ? 'linha lançada' : 'linhas lançadas'} no orçamento.`);
        setLidos(null);
      }
    }
  }

  const comComposicao = escolhas.filter((e) => !!e.fonte).length;

  return (
    <div className="card form">
      <h2 style={{ margin: 0 }}>Importar quantitativos · {obra.nome}</h2>
      <p className="ajuda" style={{ margin: 0 }}>
        PDF: a IA lista os quantitativos de forma, armação e concreto. HTML: o Agrega lê as tabelas com unidade e quantidade e concilia cada linha com as composições. Se faltar uma composição, crie-a em Serviços da obra (abre em nova aba), volte aqui e clique em Atualizar composições. Nada entra no orçamento antes da sua confirmação.
      </p>
      <div className="campo">
        <label htmlFor="lp-arquivo">Projeto (PDF), quantitativos (HTML com tabelas) ou modelo IFC</label>
        <input
          id="lp-arquivo"
          type="file"
          accept="application/pdf,.pdf,text/html,.html,.htm,.ifc"
          onChange={(e) => {
            setArquivo(e.target.files?.[0] ?? null);
            setLidos(null);
            setFeito('');
          }}
        />
      </div>
      <div className="acoes">
        <button className="btn btn-primario" type="button" onClick={analisar} disabled={!arquivo || analisando}>
          {analisando ? 'Lendo o arquivo…' : ehIfc(arquivo) ? 'Ler o modelo IFC' : ehHtml(arquivo) ? 'Ler tabelas do HTML' : 'Ler com IA'}
        </button>
      </div>
      {feito && <p className="ajuda" role="status" style={{ margin: 0 }}>{feito}</p>}

      {lidos && lidos.length === 0 && (
        <>
          <p className="muted" style={{ margin: 0 }}>
            {ehHtml(arquivo) ? 'Não encontrei tabelas de quantitativo (com colunas de unidade e quantidade) neste arquivo.' : 'Não encontrei quantitativos de forma, armação ou concreto neste arquivo.'}
          </p>
          {pendencias.length > 0 && (
            <ul className="ajuda" style={{ margin: '4px 0 0' }}>
              {pendencias.map((p, k) => (
                <li key={k}>{p}</li>
              ))}
            </ul>
          )}
        </>
      )}

      {lidos && lidos.length > 0 && (
        <>
          <p className="ajuda" style={{ margin: 0 }}>
            {comComposicao} de {lidos.length} linhas com composição escolhida ou sugerida.
          </p>
          <div className="acoes">
            <button className="btn" type="button" onClick={atualizarItens}>Atualizar composições</button>
            <span className="small muted">Recarrega a tabela própria da obra com as composições que você acabou de criar.</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="tabela">
              <thead>
                <tr>
                  <th aria-label="Lançar" />
                  <th>Serviço</th>
                  <th style={{ minWidth: 200 }}>Descrição</th>
                  <th className="num">Quant.</th>
                  <th>Unid.</th>
                  <th style={{ minWidth: 300 }}>Composição</th>
                </tr>
              </thead>
              <tbody>
                {lidos.map((x, i) => {
                  const e = escolhas[i];
                  const valor = e?.fonte ? `${e.fonte}:${e.refId}` : '';
                  return (
                    <tr key={i}>
                      <td>
                        <input type="checkbox" aria-label={`Lançar ${x.descricao}`} checked={!!e?.marcado} disabled={!e?.fonte} onChange={(ev) => atualizar(i, { marcado: ev.target.checked })} />
                      </td>
                      <td>{ROTULO_SERVICO[x.servico] ?? 'Outro'}</td>
                      <td>
                        <input aria-label="Descrição da linha" value={e?.descricao ?? ''} maxLength={200} readOnly={lidoDeHtml} title={lidoDeHtml ? 'No HTML, a descrição vem da composição escolhida' : undefined} onChange={(ev) => atualizar(i, { descricao: ev.target.value })} style={{ width: '100%' }} />
                        {x.origem && <div className="ajuda small">{x.origem}</div>}
                      </td>
                      <td className="num">
                        <input aria-label="Quantidade" inputMode="decimal" value={e?.quantidade ?? ''} onChange={(ev) => atualizar(i, { quantidade: ev.target.value })} style={{ width: 90 }} />
                      </td>
                      <td>{x.unidade}</td>
                      <td>
                        <select aria-label="Composição" value={valor} onChange={(ev) => escolherComposicao(i, ev.target.value)} style={{ maxWidth: 360, width: '100%' }}>
                          <option value="">— escolha a composição —</option>
                          {x.candidatas.length > 0 && (
                            <optgroup label="Sugeridas das tabelas da empresa">
                              {x.candidatas.map((c) => (
                                <option key={c.id} value={`cand:${c.id}`}>
                                  {c.codigo} · {c.descricao} ({c.unidade}) · {c.tabela}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {composicoesDaObra.length > 0 && (
                            <optgroup label="Tabela própria da obra">
                              {composicoesDaObra.map((c) => (
                                <option key={c.id} value={`obra:${c.id}`}>
                                  {c.codigo} · {c.descricao} ({c.unidade})
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                        {!e?.fonte && (
                          <div className="small muted" style={{ marginTop: 4 }}>
                            Sem composição para este serviço.{' '}
                            <a href={`/eng/servicos?obra=${obra.id}`} target="_blank" rel="noopener noreferrer">Criar composição na obra</a>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pendencias.length > 0 && (
            <div className="ajuda">
              <b>Avisos da leitura:</b>
              <ul style={{ margin: '4px 0 0' }}>
                {pendencias.map((p, k) => (
                  <li key={k}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="campo">
            <label htmlFor="lp-pai">Entra dentro de</label>
            <select id="lp-pai" value={pai} onChange={(ev) => setPai(ev.target.value)}>
              <option value="auto">Automático</option>
              <option value="raiz">Primeiro nível (sem linha acima)</option>
              {pais.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.codigo} · {ROTULO[l.nivel]} · {l.descricao}
                </option>
              ))}
            </select>
          </div>
          <div className="acoes">
            <button className="btn btn-primario" type="button" onClick={lancar} disabled={lancando}>
              {lancando ? 'Lançando…' : 'Lançar marcadas no orçamento'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
