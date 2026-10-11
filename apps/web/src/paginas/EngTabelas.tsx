// Engenharia · Tabelas de referência: SINAPI (importada, imutável) e tabela própria da empresa (editável).
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, formatarMoeda, lerNumero } from '../api';
import { abrirXlsx, linhasParaTexto, type Planilha } from '../lib/xlsx';

export type Tabela = {
  id: string; fonte: 'sinapi' | 'proprio'; nome: string; uf: string | null; mesReferencia: string | null; desonerado: boolean; insumos: number; composicoes: number; editavel: boolean;
};
type Item = { id: string; tipo: 'insumo' | 'composicao'; codigo: string; descricao: string; unidade: string; grupo: string | null; preco: number | null; componentes: number };
type Componente = { codigo: string; descricao: string; unidade: string; coeficiente: number; precoUnitario: number | null };

const ROTULO_FONTE = { sinapi: 'SINAPI', proprio: 'Própria' } as const;

export function EngTabelas() {
  const navegar = useNavigate();
  const [tabelas, setTabelas] = useState<Tabela[] | null>(null);
  const [erro, setErro] = useState('');
  const [nova, setNova] = useState(false);
  const carregar = () => api<{ tabelas: Tabela[] }>('/eng/tabelas').then((r) => setTabelas(r.tabelas)).catch((e) => setErro((e as Error).message));
  useEffect(() => {
    carregar();
  }, []);

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Tabelas de referência</h1>
          <span className="muted">SINAPI, importada por versão (mês e UF) e imutável; e a tabela própria da empresa, editável.</span>
        </div>
        <div className="acoes">
          <button className="btn btn-primario" type="button" onClick={() => setNova(!nova)} aria-expanded={nova}>{nova ? 'Fechar' : 'Nova tabela'}</button>
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {nova && (
        <NovaTabela
          aoCriar={(id) => navegar(`/eng/tabelas/${id}`)}
        />
      )}
      {tabelas === null && !erro && <p className="muted">Carregando…</p>}
      {tabelas?.length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>Nenhuma tabela ainda. Importe a SINAPI do mês ou crie a tabela própria.</p></div>}
      {tabelas && tabelas.length > 0 && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="tabela">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Fonte</th>
                <th>UF</th>
                <th>Referência</th>
                <th className="num">Insumos</th>
                <th className="num">Composições</th>
              </tr>
            </thead>
            <tbody>
              {tabelas.map((t) => (
                <tr key={t.id}>
                  <td><Link to={`/eng/tabelas/${t.id}`}>{t.nome}</Link></td>
                  <td>{ROTULO_FONTE[t.fonte]}{t.fonte === 'sinapi' && <div className="small muted">{t.desonerado ? 'desonerado' : 'não desonerado'}</div>}</td>
                  <td>{t.uf ?? '—'}</td>
                  <td>{t.mesReferencia ?? '—'}</td>
                  <td className="num">{t.insumos}</td>
                  <td className="num">{t.composicoes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function NovaTabela({ aoCriar }: { aoCriar: (id: string) => void }) {
  const [d, setD] = useState({ fonte: 'sinapi' as 'sinapi' | 'proprio', nome: '', uf: '', mesReferencia: '', desonerado: false });
  const [csv, setCsv] = useState('');
  const [arquivo, setArquivo] = useState('');
  const [erros, setErros] = useState<string[]>([]);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [lendoIa, setLendoIa] = useState(false);
  const [resumoIa, setResumoIa] = useState('');

  const [planilha, setPlanilha] = useState<Planilha | null>(null);
  const [aba, setAba] = useState('');
  const [lendoArquivo, setLendoArquivo] = useState(false);

  async function lerArquivo(f: File | undefined) {
    if (!f) return;
    setErro('');
    setErros([]);
    setResumoIa('');
    setCsv('');
    setPlanilha(null);
    setAba('');
    setArquivo(f.name);
    const nome = f.name.toLowerCase();
    if (nome.endsWith('.xls')) return setErro('Arquivo .xls antigo não é lido. No Excel, use Salvar como › Pasta de Trabalho do Excel (.xlsx).');
    if (!nome.endsWith('.xlsx') && !nome.endsWith('.xlsm')) return setCsv(await f.text());
    setLendoArquivo(true);
    try {
      const p = await abrirXlsx(await f.arrayBuffer());
      if (!p.abas.length) throw new Error('A planilha não tem abas.');
      setPlanilha(p);
      await escolherAba(p, p.abas[0]);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setLendoArquivo(false);
    }
  }

  async function escolherAba(p: Planilha, nome: string) {
    setAba(nome);
    setResumoIa('');
    setErro('');
    setErros([]);
    setLendoArquivo(true);
    try {
      const texto = linhasParaTexto(await p.ler(nome));
      if (!texto) throw new Error(`A aba ${nome} está vazia.`);
      setCsv(texto);
    } catch (err) {
      setCsv('');
      setErro((err as Error).message);
    } finally {
      setLendoArquivo(false);
    }
  }

  // Arquivo fora do formato padrão: a IA descobre as colunas e o sistema gera o CSV padrão para conferência.
  async function lerComIa() {
    setErro('');
    setErros([]);
    setResumoIa('');
    setLendoIa(true);
    try {
      const r = await api<{ csv: string; ignoradas: number; semPreco: number; componentesDescartados: number; contagem: { insumos: number; composicoes: number; componentes: number } }>(
        '/eng/tabelas/converter-ia',
        { corpo: { texto: csv, uf: d.uf || null, desonerado: d.fonte === 'sinapi' ? d.desonerado : false } },
      );
      setCsv(r.csv);
      const n = (x: number) => x.toLocaleString('pt-BR');
      setResumoIa(
        `A IA leu ${aba ? `a aba ${aba}` : 'o arquivo'}: ${n(r.contagem.insumos)} insumos, ${n(r.contagem.composicoes)} composições e ${n(r.contagem.componentes)} componentes.` +
          (r.semPreco ? ` ${n(r.semPreco)} insumos sem preço ficaram de fora.` : '') +
          (r.componentesDescartados ? ` ${n(r.componentesDescartados)} componentes apontam para itens fora do arquivo e ficaram de fora.` : '') +
          (r.ignoradas ? ` ${n(r.ignoradas)} linhas que não são itens (títulos, totais) foram ignoradas.` : '') +
          ' Confira o nome e a referência e crie a tabela.',
      );
    } catch (err) {
      const e2 = err as Error & { dados?: { erros?: string[] } };
      setErro(e2.message);
      setErros((e2 as unknown as { erros?: string[] }).erros ?? []);
    } finally {
      setLendoIa(false);
    }
  }

  const formatoPadrao = (() => {
    const cab = csv.replace(/^﻿/, '').split(/\r?\n/)[0]?.toLowerCase().split(';').map((c) => c.trim()) ?? [];
    return ['tipo', 'codigo', 'descricao', 'unidade', 'preco', 'grupo', 'insumo', 'coeficiente'].every((c) => cab.includes(c));
  })();

  async function criar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setErros([]);
    setOcupado(true);
    try {
      const r = await api<{ tabela: Tabela }>('/eng/tabelas', {
        corpo: { fonte: d.fonte, nome: d.nome, uf: d.uf || null, mesReferencia: d.mesReferencia || null, desonerado: d.fonte === 'sinapi' ? d.desonerado : false, csv: csv || null },
      });
      aoCriar(r.tabela.id);
    } catch (err) {
      const e2 = err as Error & { dados?: { erros?: string[] } };
      setErro(e2.message);
      setErros((e2 as unknown as { erros?: string[] }).erros ?? []);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form className="card form" onSubmit={criar}>
      <h2 style={{ margin: 0 }}>Nova tabela</h2>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {erros.length > 0 && (
        <ul className="small" style={{ color: 'var(--status-danger-ink)', margin: 0 }}>
          {erros.slice(0, 20).map((x) => <li key={x}>{x}</li>)}
        </ul>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <div className="campo">
          <label htmlFor="tb-fonte">Tabela</label>
          <select id="tb-fonte" value={d.fonte} onChange={(e) => setD({ ...d, fonte: e.target.value as 'sinapi' | 'proprio' })}>
            <option value="sinapi">SINAPI (importada)</option>
            <option value="proprio">Própria da empresa</option>
          </select>
        </div>
        <div className="campo">
          <label htmlFor="tb-nome">Nome</label>
          <input id="tb-nome" value={d.nome} onChange={(e) => setD({ ...d, nome: e.target.value })} placeholder={d.fonte === 'sinapi' ? 'SINAPI TO set/2026' : 'Tabela própria'} />
        </div>
        {d.fonte === 'sinapi' && (
          <>
            <div className="campo">
              <label htmlFor="tb-uf">UF</label>
              <input id="tb-uf" maxLength={2} value={d.uf} onChange={(e) => setD({ ...d, uf: e.target.value.toUpperCase() })} />
            </div>
            <div className="campo">
              <label htmlFor="tb-mes">Mês de referência</label>
              <input id="tb-mes" placeholder="AAAA-MM" value={d.mesReferencia} onChange={(e) => setD({ ...d, mesReferencia: e.target.value })} />
            </div>
            <label className="marcar small">
              <input type="checkbox" checked={d.desonerado} onChange={(e) => setD({ ...d, desonerado: e.target.checked })} /> Desonerado
            </label>
          </>
        )}
      </div>
      <div className="campo">
        <label htmlFor="tb-csv">Arquivo CSV ou Excel .xlsx (opcional)</label>
        <input
          id="tb-csv"
          type="file"
          accept=".csv,.txt,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => lerArquivo(e.target.files?.[0])}
        />
        <span className="ajuda">
          Formato padrão: colunas separadas por ponto e vírgula, <code>tipo;codigo;descricao;unidade;preco;grupo;insumo;coeficiente</code>. Tipos: <b>insumo</b>, <b>composicao</b> e <b>componente</b> (um por insumo de cada composição).
          Planilhas da Caixa (.xlsx) e outros layouts são lidos com a IA.
          {arquivo && <> Arquivo: <b>{arquivo}</b>.</>}
        </span>
        {planilha && planilha.abas.length > 1 && (
          <div className="campo" style={{ maxWidth: 360, marginTop: 8 }}>
            <label htmlFor="tb-aba">Aba da planilha</label>
            <select id="tb-aba" value={aba} disabled={lendoArquivo || lendoIa} onChange={(e) => escolherAba(planilha, e.target.value)}>
              {planilha.abas.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        )}
        {lendoArquivo && <p className="small muted" style={{ margin: '8px 0 0' }}>Lendo a planilha…</p>}
        {csv && !formatoPadrao && (
          <div className="alerta alerta-aviso" role="status" style={{ marginTop: 8 }}>
            <p style={{ margin: '0 0 8px' }}>
              {planilha ? 'Planilha fora do formato padrão.' : 'Este arquivo não está no formato padrão.'} A IA identifica as colunas e o sistema converte as linhas.
              {d.fonte === 'sinapi' && !d.uf && <> Informe a <b>UF</b> antes: a planilha da Caixa traz um preço por estado.</>}
            </p>
            <button className="btn btn-secundario" type="button" onClick={lerComIa} disabled={lendoIa || lendoArquivo}>{lendoIa ? 'Lendo com IA…' : 'Ler com IA'}</button>
          </div>
        )}
        {resumoIa && <div className="alerta alerta-ok" role="status" style={{ marginTop: 8 }}>{resumoIa}</div>}
      </div>
      <div className="acoes">
        <button className="btn btn-primario" type="submit" disabled={ocupado || lendoArquivo || lendoIa || d.nome.trim().length < 2 || (!!csv && !formatoPadrao)}>{ocupado ? 'Criando…' : 'Criar tabela'}</button>
      </div>
    </form>
  );
}

export function EngTabelaDetalhe() {
  const { id } = useParams();
  const [tabela, setTabela] = useState<Tabela | null>(null);
  const [itens, setItens] = useState<Item[] | null>(null);
  const [tipo, setTipo] = useState<'' | 'insumo' | 'composicao'>('');
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState<{ item: Item; componentes: Componente[] } | null>(null);
  const [novo, setNovo] = useState(false);
  const [erro, setErro] = useState('');

  const carregarTabela = () => api<{ tabela: Tabela }>(`/eng/tabelas/${id}`).then((r) => setTabela(r.tabela)).catch((e) => setErro((e as Error).message));
  const carregarItens = () => {
    const q = new URLSearchParams();
    if (tipo) q.set('tipo', tipo);
    if (busca.trim()) q.set('busca', busca.trim());
    return api<{ itens: Item[] }>(`/eng/tabelas/${id}/itens?${q}`).then((r) => setItens(r.itens)).catch((e) => setErro((e as Error).message));
  };
  useEffect(() => {
    carregarTabela();
  }, [id]);
  useEffect(() => {
    const t = setTimeout(carregarItens, 200);
    return () => clearTimeout(t);
  }, [id, tipo, busca]);

  async function abrir(item: Item) {
    if (item.tipo !== 'composicao') return setAberto(null);
    const r = await api<{ item: Item; componentes: Componente[] }>(`/eng/tabelas/${id}/itens/${item.id}`);
    setAberto(r);
  }

  async function excluir(item: Item) {
    setErro('');
    try {
      await api(`/eng/tabelas/${id}/itens/${item.id}`, { metodo: 'DELETE' });
      await Promise.all([carregarTabela(), carregarItens()]);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  if (!tabela && !erro) return <p className="muted">Carregando…</p>;

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <Link to="/eng/tabelas" className="small">← Tabelas de referência</Link>
          <h1>{tabela?.nome}</h1>
          <span className="muted">
            {tabela && ROTULO_FONTE[tabela.fonte]}
            {tabela?.uf ? ` · ${tabela.uf}` : ''}
            {tabela?.mesReferencia ? ` · referência ${tabela.mesReferencia}` : ''}
            {tabela?.fonte === 'sinapi' ? ` · ${tabela.desonerado ? 'desonerado' : 'não desonerado'} · somente leitura` : ' · editável'}
          </span>
        </div>
        {tabela?.editavel && (
          <div className="acoes">
            <button className="btn btn-primario" type="button" onClick={() => setNovo(!novo)} aria-expanded={novo}>{novo ? 'Fechar' : 'Novo item'}</button>
          </div>
        )}
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {novo && tabela?.editavel && (
        <NovoItem
          tabelaId={tabela.id}
          aoSalvar={async () => {
            setNovo(false);
            await Promise.all([carregarTabela(), carregarItens()]);
          }}
        />
      )}
      <div className="filtros">
        <div className="campo" style={{ minWidth: 220 }}>
          <label htmlFor="tb-busca">Buscar por código ou descrição</label>
          <input id="tb-busca" value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <div className="segmentado" role="group" aria-label="Tipo">
          {([['', 'Todos'], ['insumo', 'Insumos'], ['composicao', 'Composições']] as const).map(([v, t]) => (
            <button key={v} type="button" aria-pressed={tipo === v} className={tipo === v ? 'ativo' : ''} onClick={() => setTipo(v)}>{t}</button>
          ))}
        </div>
      </div>
      {itens === null && !erro && <p className="muted">Carregando…</p>}
      {itens && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="tabela">
            <thead>
              <tr>
                <th>Código</th>
                <th>Tipo</th>
                <th>Descrição</th>
                <th>Unidade</th>
                <th className="num">Preço</th>
                <th className="nao-imprimir"><span style={{ position: 'absolute', left: -9999 }}>Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {itens.map((i) => (
                <tr key={i.id}>
                  <td className="mono">{i.codigo}</td>
                  <td>{i.tipo === 'insumo' ? 'Insumo' : `Composição (${i.componentes})`}</td>
                  <td>
                    {i.tipo === 'composicao' ? <button className="btn btn-link" type="button" style={{ padding: 0, minHeight: 0 }} onClick={() => abrir(i)}>{i.descricao}</button> : i.descricao}
                  </td>
                  <td>{i.unidade}</td>
                  <td className="num">{i.preco === null ? '—' : formatarMoeda(i.preco)}</td>
                  <td>{tabela?.editavel && <button className="btn btn-link" type="button" onClick={() => excluir(i)}>Excluir</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {itens.length === 0 && <p className="muted" style={{ padding: 12 }}>Nenhum item encontrado.</p>}
        </div>
      )}
      {aberto && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="cabecalho" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>Composição {aberto.item.codigo}: {aberto.item.descricao}</h2>
            <button className="btn btn-link" type="button" onClick={() => setAberto(null)}>Fechar</button>
          </div>
          <table className="tabela">
            <thead>
              <tr><th>Insumo</th><th>Unidade</th><th className="num">Coeficiente</th><th className="num">Preço</th><th className="num">Custo</th></tr>
            </thead>
            <tbody>
              {aberto.componentes.map((k) => (
                <tr key={k.codigo}>
                  <td>{k.codigo} · {k.descricao}</td>
                  <td>{k.unidade}</td>
                  <td className="num">{k.coeficiente.toLocaleString('pt-BR', { maximumFractionDigits: 6 })}</td>
                  <td className="num">{k.precoUnitario === null ? '—' : formatarMoeda(k.precoUnitario)}</td>
                  <td className="num">{k.precoUnitario === null ? '—' : formatarMoeda(k.precoUnitario * k.coeficiente)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted" style={{ marginBottom: 0 }}>Preço unitário da composição: {formatarMoeda(aberto.item.preco)} por {aberto.item.unidade}.</p>
        </div>
      )}
    </>
  );
}

/** Serviço próprio: composição unitária criada na tabela própria da empresa. */
export function NovoServico({ aoSalvar }: { aoSalvar: (mensagem: string) => void }) {
  const [proprias, setProprias] = useState<Tabela[] | null>(null);
  const [tabelaId, setTabelaId] = useState('');
  const [erro, setErro] = useState('');
  useEffect(() => {
    api<{ tabelas: Tabela[] }>('/eng/tabelas')
      .then((r) => {
        const p = r.tabelas.filter((t) => t.fonte === 'proprio' && t.editavel);
        setProprias(p);
        setTabelaId(p[0]?.id ?? '');
      })
      .catch((e) => setErro((e as Error).message));
  }, []);

  if (erro) return <div className="alerta alerta-erro" role="alert">{erro}</div>;
  if (proprias === null) return <p className="muted">Carregando…</p>;
  if (proprias.length === 0)
    return (
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          Antes, crie a tabela própria da empresa em <Link to="/eng/tabelas">Tabelas de referência</Link>. Os serviços próprios ficam nela.
        </p>
      </div>
    );
  const nomeTabela = proprias.find((t) => t.id === tabelaId)?.nome ?? '';
  return (
    <div>
      <div className="campo" style={{ maxWidth: 360, marginBottom: 8 }}>
        <label htmlFor="ns-tabela">Tabela própria</label>
        <select id="ns-tabela" value={tabelaId} onChange={(e) => setTabelaId(e.target.value)}>
          {proprias.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
        </select>
      </div>
      <NovoItem key={tabelaId} tabelaId={tabelaId} soComposicao aoSalvar={() => aoSalvar(`Serviço criado na tabela ${nomeTabela}. Para usar nesta obra, copie-o pela lista abaixo.`)} />
    </div>
  );
}

function NovoItem({ tabelaId, aoSalvar, soComposicao = false }: { tabelaId: string; aoSalvar: () => void; soComposicao?: boolean }) {
  const [d, setD] = useState({ tipo: (soComposicao ? 'composicao' : 'insumo') as 'insumo' | 'composicao', codigo: '', descricao: '', unidade: '', grupo: '', preco: '' });
  const [comp, setComp] = useState([{ insumoCodigo: '', coeficiente: '' }]);
  const [erro, setErro] = useState('');
  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    const componentes = comp.filter((c) => c.insumoCodigo.trim()).map((c) => ({ insumoCodigo: c.insumoCodigo.trim(), coeficiente: lerNumero(c.coeficiente) ?? -1 }));
    if (d.tipo === 'composicao' && componentes.some((c) => c.coeficiente < 0)) return setErro('Confira os coeficientes dos insumos.');
    try {
      await api(`/eng/tabelas/${tabelaId}/itens`, { corpo: { tipo: d.tipo, codigo: d.codigo, descricao: d.descricao, unidade: d.unidade, grupo: d.grupo || null, preco: d.tipo === 'insumo' ? d.preco : null, componentes } });
      setD({ tipo: d.tipo, codigo: '', descricao: '', unidade: '', grupo: '', preco: '' });
      setComp([{ insumoCodigo: '', coeficiente: '' }]);
      aoSalvar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }
  return (
    <form className="card form" onSubmit={salvar}>
      <h2 style={{ margin: 0 }}>{soComposicao ? 'Novo serviço' : 'Novo item'}</h2>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {!soComposicao && (
          <div className="campo">
            <label htmlFor="ni-tipo">Tipo</label>
            <select id="ni-tipo" value={d.tipo} onChange={(e) => setD({ ...d, tipo: e.target.value as 'insumo' | 'composicao' })}>
              <option value="insumo">Insumo</option>
              <option value="composicao">Composição (serviço)</option>
            </select>
          </div>
        )}
        <div className="campo"><label htmlFor="ni-cod">Código</label><input id="ni-cod" value={d.codigo} onChange={(e) => setD({ ...d, codigo: e.target.value })} /></div>
        <div className="campo" style={{ gridColumn: 'span 2' }}><label htmlFor="ni-desc">Descrição</label><input id="ni-desc" value={d.descricao} onChange={(e) => setD({ ...d, descricao: e.target.value })} /></div>
        <div className="campo"><label htmlFor="ni-un">Unidade</label><input id="ni-un" value={d.unidade} onChange={(e) => setD({ ...d, unidade: e.target.value })} /></div>
        {d.tipo === 'insumo' && <div className="campo"><label htmlFor="ni-preco">Preço (R$)</label><input id="ni-preco" inputMode="decimal" value={d.preco} onChange={(e) => setD({ ...d, preco: e.target.value })} /></div>}
      </div>
      {d.tipo === 'composicao' && (
        <div className="campo">
          <span className="rotulo">Insumos da composição</span>
          {comp.map((c, n) => (
            <div key={n} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input aria-label={`Código do insumo ${n + 1}`} placeholder="código do insumo" value={c.insumoCodigo} onChange={(e) => setComp(comp.map((x, i) => (i === n ? { ...x, insumoCodigo: e.target.value } : x)))} />
              <input aria-label={`Coeficiente ${n + 1}`} placeholder="coeficiente" inputMode="decimal" value={c.coeficiente} onChange={(e) => setComp(comp.map((x, i) => (i === n ? { ...x, coeficiente: e.target.value } : x)))} />
            </div>
          ))}
          <button className="btn btn-link" type="button" onClick={() => setComp([...comp, { insumoCodigo: '', coeficiente: '' }])}>+ insumo</button>
          <span className="ajuda">Os insumos precisam existir nesta tabela. O preço da composição é a soma dos insumos × coeficiente.</span>
        </div>
      )}
      <div className="acoes"><button className="btn btn-primario" type="submit" disabled={d.codigo.trim() === '' || d.descricao.trim().length < 2 || d.unidade.trim() === ''}>Adicionar</button></div>
    </form>
  );
}
