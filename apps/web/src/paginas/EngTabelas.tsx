// Engenharia · Tabelas de referência: SINAPI (importada, imutável) e tabela própria da empresa (editável).
import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, formatarData, formatarMoeda, lerNumero, type ErroApi } from '../api';
import { abrirXlsx, linhasParaTexto, type Planilha } from '../lib/xlsx';

export type Tabela = {
  id: string; fonte: 'sinapi' | 'proprio'; nome: string; uf: string | null; mesReferencia: string | null; desonerado: boolean; insumos: number; composicoes: number; editavel: boolean;
};
type Item = { id: string; tipo: 'insumo' | 'composicao'; codigo: string; descricao: string; unidade: string; grupo: string | null; preco: number | null; componentes: number; unidadesCompra?: { unidade: string; fator: number }[] };
type EdicaoInsumo = { item: Item; descricao: string; unidade: string; comPreco: boolean; preco: string; linhas: { unidade: string; fator: string }[] };
type Componente = { codigo: string; descricao: string; unidade: string; coeficiente: number; precoUnitario: number | null };
type ItemEstrutura = Componente & { id: string; tipo: 'insumo' | 'composicao' };
export type DetalheComposicao = {
  item: { id: string; codigo: string; descricao: string; unidade: string; preco: number | null };
  componentes: Componente[];
  estrutura?: ItemEstrutura[];
};

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

const CAMPOS = ['tipo', 'codigo', 'descricao', 'unidade', 'preco', 'grupo', 'insumo', 'coeficiente'] as const;
/** Ordem das colunas recortadas para o servidor: os campos padrão e os dados do item na mesma linha (tipo, descrição, unidade, preço). */
const COLUNAS_RECORTE = [...CAMPOS, 'tipoItem', 'descricaoItem', 'unidadeItem', 'precoItem'] as const;
type ValoresTipo = Record<'insumo' | 'composicao' | 'componenteInsumo' | 'componenteComposicao', string | string[] | null>;
type MapaIa = {
  separador: string;
  linhaInicial: number;
  colunas: Partial<Record<(typeof COLUNAS_RECORTE)[number], number | null>>;
  tipoUnico: 'insumo' | 'composicao' | null;
  valoresTipo: ValoresTipo | null;
};
type Conversao = {
  csv: string;
  ignoradas: number;
  semPreco: number;
  componentesDescartados: number;
  auxiliaresAchatadas: number;
  composicoesSemInsumos: number;
  contagem: { insumos: number; composicoes: number; componentes: number };
};

/** Mesma regra do servidor: linhas com algum conteúdo além dos separadores. */
const linhasUteis = (texto: string) => texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.replace(/[;,\t|]/g, '').trim() !== '');
const ehFormatoPadrao = (texto: string) => {
  const cab = linhasUteis(texto)[0]?.toLowerCase().split(';').map((c) => c.trim()) ?? [];
  return CAMPOS.every((c) => cab.includes(c));
};
const errosDe = (err: unknown) => ((err as ErroApi).dados?.erros as string[] | undefined) ?? [];
const fmt = (x: number) => x.toLocaleString('pt-BR');

/**
 * Escolha e leitura do arquivo (CSV ou .xlsx). No formato padrão, devolve o texto como está;
 * fora dele, a IA identifica as colunas e o servidor converte. Devolve ao pai o CSV padrão pronto, ou '' enquanto não houver.
 */
function LeitorArquivo({ id, uf, desonerado, tabelaId, aoMudar }: { id: string; uf: string | null; desonerado: boolean; tabelaId?: string; aoMudar: (csv: string) => void }) {
  const [arquivo, setArquivo] = useState('');
  const [planilha, setPlanilha] = useState<Planilha | null>(null);
  const [aba, setAba] = useState('');
  const [texto, setTexto] = useState('');
  const [lendo, setLendo] = useState<'' | 'arquivo' | 'ia'>('');
  const [resumo, setResumo] = useState<{ texto: string; aviso: boolean } | null>(null);
  const [erro, setErro] = useState('');
  const [erros, setErros] = useState<string[]>([]);

  function usarTexto(t: string) {
    setTexto(t);
    setResumo(null);
    aoMudar(t && ehFormatoPadrao(t) ? t : '');
  }

  async function lerArquivo(f: File | undefined) {
    if (!f) return;
    setErro('');
    setErros([]);
    setPlanilha(null);
    setAba('');
    usarTexto('');
    setArquivo(f.name);
    const nome = f.name.toLowerCase();
    if (nome.endsWith('.xls')) return setErro('Arquivo .xls antigo não é lido. No Excel, use Salvar como › Pasta de Trabalho do Excel (.xlsx).');
    if (!nome.endsWith('.xlsx') && !nome.endsWith('.xlsm')) return usarTexto(await f.text());
    setLendo('arquivo');
    try {
      const p = await abrirXlsx(await f.arrayBuffer());
      if (!p.abas.length) throw new Error('A planilha não tem abas.');
      setPlanilha(p);
      await escolherAba(p, p.abas[0]);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setLendo('');
    }
  }

  async function escolherAba(p: Planilha, nome: string) {
    setAba(nome);
    setErro('');
    setErros([]);
    setLendo('arquivo');
    try {
      const t = linhasParaTexto(await p.ler(nome));
      if (!t) throw new Error(`A aba ${nome} está vazia.`);
      usarTexto(t);
    } catch (err) {
      usarTexto('');
      setErro((err as Error).message);
    } finally {
      setLendo('');
    }
  }

  // 1) a IA vê as primeiras linhas e devolve as colunas; 2) recortamos as colunas úteis da planilha inteira; 3) o servidor converte.
  async function lerComIa() {
    setErro('');
    setErros([]);
    setResumo(null);
    setLendo('ia');
    try {
      const linhas = linhasUteis(texto);
      const { mapa } = await api<{ mapa: MapaIa }>('/eng/tabelas/mapear-ia', { corpo: { amostra: linhas.slice(0, 40).join('\n'), uf, desonerado } });
      // Planilha .xlsx vira texto com ponto e vírgula aqui no navegador: o separador é sempre esse.
      if (planilha) mapa.separador = ';';
      const recortado = linhas
        .slice(mapa.linhaInicial)
        .map((l) => {
          const c = l.split(mapa.separador);
          return COLUNAS_RECORTE.map((k) => {
            const i = mapa.colunas[k];
            return i === null || i === undefined ? '' : (c[i] ?? '').replace(/[;\r\n]/g, ',').trim();
          }).join(';');
        })
        .join('\n');
      const r = await api<Conversao>('/eng/tabelas/converter', { corpo: { texto: recortado, tipoUnico: mapa.tipoUnico, valoresTipo: mapa.valoresTipo, tabelaId: tabelaId ?? null } });
      aoMudar(r.csv);
      const partes = [
        `A IA leu ${aba ? `a aba ${aba}` : 'o arquivo'}: ${fmt(r.contagem.insumos)} insumos e ${fmt(r.contagem.composicoes)} composições (${fmt(r.contagem.componentes)} itens de composição).`,
        r.auxiliaresAchatadas ? `${fmt(r.auxiliaresAchatadas)} composições auxiliares foram desdobradas nos insumos delas.` : '',
        r.semPreco ? `${fmt(r.semPreco)} insumos sem preço ficaram de fora.` : '',
        r.componentesDescartados ? `${fmt(r.componentesDescartados)} itens de composição apontam para códigos que não existem ${tabelaId ? 'nem no arquivo nem na tabela' : 'no arquivo'} e ficaram de fora.` : '',
        r.ignoradas ? `${fmt(r.ignoradas)} linhas que não são itens (títulos, totais) foram ignoradas.` : '',
      ];
      const semInsumos = r.composicoesSemInsumos > 0;
      if (semInsumos) {
        partes.push(
          tabelaId
            ? `${fmt(r.composicoesSemInsumos)} composições ficaram sem nenhum insumo.`
            : `${fmt(r.composicoesSemInsumos)} composições ficaram sem insumos porque os insumos não estão neste arquivo. Para a SINAPI, crie primeiro a tabela com os insumos do mês e depois importe as composições nela (abra a tabela › Importar arquivo).`,
        );
      }
      setResumo({ texto: partes.filter(Boolean).join(' '), aviso: semInsumos });
    } catch (err) {
      setErro((err as Error).message);
      setErros(errosDe(err));
    } finally {
      setLendo('');
    }
  }

  const foraDoPadrao = !!texto && !ehFormatoPadrao(texto);
  return (
    <div className="campo">
      <label htmlFor={`${id}-arquivo`}>Arquivo CSV ou Excel .xlsx</label>
      <input id={`${id}-arquivo`} type="file" accept=".csv,.txt,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => lerArquivo(e.target.files?.[0])} />
      <span className="ajuda">
        Planilhas da Caixa (.xlsx) e outros layouts são lidos com a IA. Formato padrão, sem IA: colunas separadas por ponto e vírgula,{' '}
        <code>tipo;codigo;descricao;unidade;preco;grupo;insumo;coeficiente</code>.{arquivo && <> Arquivo: <b>{arquivo}</b>.</>}
      </span>
      {planilha && planilha.abas.length > 1 && (
        <div className="campo" style={{ maxWidth: 360, marginTop: 8 }}>
          <label htmlFor={`${id}-aba`}>Aba da planilha</label>
          <select id={`${id}-aba`} value={aba} disabled={!!lendo} onChange={(e) => escolherAba(planilha, e.target.value)}>
            {planilha.abas.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      )}
      {lendo === 'arquivo' && <p className="small muted" style={{ margin: '8px 0 0' }}>Lendo a planilha…</p>}
      {erro && <div className="alerta alerta-erro" role="alert" style={{ marginTop: 8 }}>{erro}</div>}
      {erros.length > 0 && (
        <ul className="small" style={{ color: 'var(--status-danger-ink)', margin: '4px 0 0' }}>
          {erros.slice(0, 20).map((x) => <li key={x}>{x}</li>)}
        </ul>
      )}
      {foraDoPadrao && !resumo && (
        <div className="alerta alerta-aviso" role="status" style={{ marginTop: 8 }}>
          <p style={{ margin: '0 0 8px' }}>
            {planilha ? 'Planilha fora do formato padrão.' : 'Este arquivo não está no formato padrão.'} A IA identifica as colunas e o sistema converte as linhas.
            {!uf && <> Informe a <b>UF</b> antes, se a planilha trouxer um preço por estado.</>}
          </p>
          <button className="btn btn-secundario" type="button" onClick={lerComIa} disabled={!!lendo}>{lendo === 'ia' ? 'Lendo com IA…' : 'Ler com IA'}</button>
        </div>
      )}
      {resumo && <div className={`alerta ${resumo.aviso ? 'alerta-aviso' : 'alerta-ok'}`} role="status" style={{ marginTop: 8 }}>{resumo.texto}</div>}
    </div>
  );
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
function nomeSugerido(d: { fonte: string; uf: string; mesReferencia: string; desonerado: boolean }) {
  if (d.fonte !== 'sinapi') return 'Tabela própria';
  const m = /^(\d{4})-(\d{2})$/.exec(d.mesReferencia);
  return ['SINAPI', d.uf || null, m ? `${MESES[Number(m[2]) - 1] ?? m[2]}/${m[1]}` : null, d.desonerado ? 'desonerado' : 'não desonerado'].filter(Boolean).join(' ');
}

function NovaTabela({ aoCriar }: { aoCriar: (id: string) => void }) {
  const [d, setD] = useState({ fonte: 'sinapi' as 'sinapi' | 'proprio', nome: '', uf: '', mesReferencia: '', desonerado: false });
  const [csv, setCsv] = useState('');
  const [erros, setErros] = useState<string[]>([]);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const nome = d.nome.trim() || nomeSugerido(d);

  async function criar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setErros([]);
    setOcupado(true);
    try {
      const r = await api<{ tabela: Tabela }>('/eng/tabelas', {
        corpo: { fonte: d.fonte, nome, uf: d.uf || null, mesReferencia: d.mesReferencia || null, desonerado: d.fonte === 'sinapi' ? d.desonerado : false, csv: csv || null },
      });
      aoCriar(r.tabela.id);
    } catch (err) {
      setErro((err as Error).message);
      setErros(errosDe(err));
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
          <input id="tb-nome" value={d.nome} onChange={(e) => setD({ ...d, nome: e.target.value })} placeholder={nomeSugerido(d)} />
          {!d.nome.trim() && <span className="ajuda">Em branco, a tabela se chama “{nomeSugerido(d)}”.</span>}
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
      <LeitorArquivo id="tb" uf={d.uf || null} desonerado={d.fonte === 'sinapi' && d.desonerado} aoMudar={setCsv} />
      <div className="acoes">
        <button className="btn btn-primario" type="submit" disabled={ocupado || nome.length < 2}>{ocupado ? 'Criando…' : csv ? 'Criar tabela com os itens lidos' : 'Criar tabela vazia'}</button>
      </div>
    </form>
  );
}

/** Importa um arquivo numa tabela que já existe (ex.: as composições da SINAPI na tabela dos insumos do mesmo mês). */
function ImportarNaTabela({ tabela, aoImportar }: { tabela: Tabela; aoImportar: (mensagem: string) => void }) {
  const [csv, setCsv] = useState('');
  const [erro, setErro] = useState('');
  const [erros, setErros] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState(false);
  async function importar() {
    setErro('');
    setErros([]);
    setOcupado(true);
    try {
      const r = await api<{ contagem: { insumos: number; composicoes: number; componentes: number; jaExistiam: number; completadas: number } }>(`/eng/tabelas/${tabela.id}/importar`, { corpo: { csv } });
      const c = r.contagem;
      aoImportar(
        `Importação concluída: ${fmt(c.insumos)} insumos e ${fmt(c.composicoes)} composições novas (${fmt(c.componentes)} itens de composição).` +
          (c.completadas ? ` ${fmt(c.completadas)} composições que estavam sem insumos foram completadas.` : '') +
          (c.jaExistiam ? ` ${fmt(c.jaExistiam)} itens já existiam na tabela e ficaram como estavam.` : ''),
      );
    } catch (err) {
      setErro((err as Error).message);
      setErros(errosDe(err));
    } finally {
      setOcupado(false);
    }
  }
  return (
    <div className="card form">
      <h2 style={{ margin: 0 }}>Importar arquivo nesta tabela</h2>
      <p className="small muted" style={{ margin: 0 }}>
        Acrescenta insumos e composições. As composições podem usar os insumos que já estão na tabela; códigos que já existem ficam como estão.
      </p>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {erros.length > 0 && (
        <ul className="small" style={{ color: 'var(--status-danger-ink)', margin: 0 }}>
          {erros.slice(0, 20).map((x) => <li key={x}>{x}</li>)}
        </ul>
      )}
      <LeitorArquivo id="imp" uf={tabela.uf} desonerado={tabela.desonerado} tabelaId={tabela.id} aoMudar={setCsv} />
      <div className="acoes">
        <button className="btn btn-primario" type="button" onClick={importar} disabled={ocupado || !csv}>{ocupado ? 'Importando…' : 'Importar'}</button>
      </div>
    </div>
  );
}

export function EngTabelaDetalhe() {
  const { id } = useParams();
  const [tabela, setTabela] = useState<Tabela | null>(null);
  const [itens, setItens] = useState<Item[] | null>(null);
  const [tipo, setTipo] = useState<'' | 'insumo' | 'composicao'>('');
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState<{ item: { id: string } } | null>(null);
  const [edicao, setEdicao] = useState<EdicaoInsumo | null>(null);
  const [novo, setNovo] = useState(false);
  const [importar, setImportar] = useState(false);
  const [msg, setMsg] = useState('');
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

  function abrir(item: Item) {
    setAberto(item.tipo === 'composicao' ? { item } : null);
  }

  /** Preço do insumo pela última compra confirmada na obra (convertida para a unidade do cadastro). */
  async function usarUltimaCompra(item: Item) {
    setErro('');
    setMsg('');
    try {
      const r = await api<{ preco: number; data: string }>(`/eng/tabelas/${id}/itens/${item.id}/preco-ultima-compra`, { metodo: 'POST' });
      setMsg(`Preço de ${item.codigo} atualizado pela última compra de ${formatarData(r.data)}: ${formatarMoeda(r.preco)} por ${item.unidade}.`);
      await carregarItens();
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  function abrirEdicao(item: Item) {
    setErro('');
    setEdicao({
      item,
      descricao: item.descricao,
      unidade: item.unidade,
      comPreco: item.preco !== null,
      preco: item.preco === null ? '' : String(item.preco).replace('.', ','),
      linhas: (item.unidadesCompra ?? []).map((u) => ({ unidade: u.unidade, fator: String(u.fator).replace('.', ',') })),
    });
  }

  /** Salva descrição, unidade, preço e unidades de compra do insumo da tabela própria. */
  async function salvarEdicao() {
    if (!edicao) return;
    setErro('');
    const descricao = edicao.descricao.trim();
    const unidade = edicao.unidade.trim();
    if (descricao.length < 2) return setErro('Informe a descrição do insumo.');
    if (!unidade) return setErro('Informe a unidade do orçamento.');
    let preco: number | null = null;
    if (edicao.comPreco) {
      preco = lerNumero(edicao.preco);
      if (preco === null || preco < 0) return setErro('Informe um preço válido.');
    }
    const unidadesCompra: { unidade: string; fator: number }[] = [];
    for (const u of edicao.linhas) {
      if (!u.unidade.trim() && !u.fator.trim()) continue;
      const f = lerNumero(u.fator);
      if (!u.unidade.trim() || f === null || f <= 0) return setErro('Cada unidade de compra precisa de nome e de quantas unidades do orçamento cabem nela.');
      unidadesCompra.push({ unidade: u.unidade.trim(), fator: f });
    }
    try {
      await api(`/eng/tabelas/${id}/itens/${edicao.item.id}`, {
        metodo: 'PUT',
        corpo: { descricao, unidade, precoOrigem: edicao.comPreco ? 'informado' : 'nao_informado', preco, unidadesCompra },
      });
      setMsg(`${edicao.item.codigo} atualizado.`);
      setEdicao(null);
      await carregarItens();
    } catch (e) {
      setErro((e as Error).message);
    }
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
            {tabela?.fonte === 'sinapi' ? ` · ${tabela.desonerado ? 'desonerado' : 'não desonerado'} · itens não editáveis` : ' · editável'}
          </span>
        </div>
        {tabela && (
          <div className="acoes">
            <button className={`btn ${tabela.editavel ? 'btn-secundario' : 'btn-primario'}`} type="button" onClick={() => { setMsg(''); setNovo(false); setImportar(!importar); }} aria-expanded={importar}>
              {importar ? 'Fechar importação' : 'Importar arquivo'}
            </button>
            {tabela.editavel && (
              <button className="btn btn-primario" type="button" onClick={() => { setImportar(false); setNovo(!novo); }} aria-expanded={novo}>{novo ? 'Fechar' : 'Novo item'}</button>
            )}
          </div>
        )}
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {msg && <div className="alerta alerta-ok" role="status">{msg}</div>}
      {importar && tabela && (
        <ImportarNaTabela
          tabela={tabela}
          aoImportar={async (m) => {
            setImportar(false);
            setMsg(m);
            await Promise.all([carregarTabela(), carregarItens()]);
          }}
        />
      )}
      {novo && tabela?.editavel && (
        <NovoItem
          tabelaId={tabela.id}
          aoSalvar={async () => {
            setNovo(false);
            await Promise.all([carregarTabela(), carregarItens()]);
          }}
          aoLote={async (_itens, mensagem) => {
            setNovo(false);
            setMsg(mensagem);
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
                <Fragment key={i.id}>
                <tr>
                  <td className="mono">{i.codigo}</td>
                  <td>{i.tipo === 'insumo' ? 'Insumo' : `Composição (${i.componentes})`}</td>
                  <td>
                    {i.tipo === 'composicao' ? <button className="btn btn-link" type="button" style={{ padding: 0, minHeight: 0 }} onClick={() => abrir(i)}>{i.descricao}</button> : i.descricao}
                  </td>
                  <td>{i.unidade}</td>
                  <td className="num">{i.preco === null ? '—' : formatarMoeda(i.preco)}</td>
                  <td>
                    {tabela?.editavel && i.tipo === 'insumo' && (
                      <button className="btn btn-link" type="button" onClick={() => abrirEdicao(i)}>Editar</button>
                    )}
                    {tabela?.editavel && i.tipo === 'insumo' && (
                      <button className="btn btn-link" type="button" onClick={() => usarUltimaCompra(i)}>Usar última compra</button>
                    )}
                    {tabela?.editavel && <button className="btn btn-link" type="button" onClick={() => excluir(i)}>Excluir</button>}
                  </td>
                </tr>
                {edicao?.item.id === i.id && (
                  <tr>
                    <td colSpan={6} style={{ background: 'var(--surface-sunken)' }}>
                      <div className="form" style={{ padding: 8 }}>
                        <b>Editar insumo {i.codigo}</b>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                          <div className="campo" style={{ gridColumn: 'span 2' }}>
                            <label htmlFor="ei-desc">Descrição</label>
                            <input id="ei-desc" value={edicao.descricao} onChange={(e) => setEdicao({ ...edicao, descricao: e.target.value })} />
                          </div>
                          <div className="campo">
                            <label htmlFor="ei-un">Unidade de orçamento</label>
                            <input id="ei-un" value={edicao.unidade} onChange={(e) => setEdicao({ ...edicao, unidade: e.target.value })} />
                          </div>
                          <div className="campo">
                            <span className="rotulo">Preço</span>
                            <div className="segmentado" role="group" aria-label="Preço do insumo">
                              <button type="button" aria-pressed={!edicao.comPreco} className={!edicao.comPreco ? 'ativo' : ''} onClick={() => setEdicao({ ...edicao, comPreco: false })}>Não registrar agora</button>
                              <button type="button" aria-pressed={edicao.comPreco} className={edicao.comPreco ? 'ativo' : ''} onClick={() => setEdicao({ ...edicao, comPreco: true })}>Informar valor</button>
                            </div>
                            {edicao.comPreco && (
                              <input id="ei-preco" inputMode="decimal" aria-label={`Preço por ${edicao.unidade || 'unidade'} (R$)`} placeholder={`R$ por ${edicao.unidade || 'unidade'}`} value={edicao.preco} onChange={(e) => setEdicao({ ...edicao, preco: e.target.value })} />
                            )}
                          </div>
                        </div>
                        <span className="rotulo">Unidades de compra</span>
                        {edicao.linhas.map((u, n) => (
                          <div key={n} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                            <input aria-label={`Unidade de compra ${n + 1}`} placeholder="ex.: barra" value={u.unidade} style={{ maxWidth: 140 }} onChange={(e) => setEdicao({ ...edicao, linhas: edicao.linhas.map((x, k) => (k === n ? { ...x, unidade: e.target.value } : x)) })} />
                            <span className="small muted">1 {u.unidade.trim() || 'unidade'} =</span>
                            <input aria-label={`Quantos ${edicao.unidade || 'unidades'} cabem em 1 ${u.unidade.trim() || 'unidade'}`} placeholder="ex.: 46,2" inputMode="decimal" value={u.fator} style={{ maxWidth: 120 }} onChange={(e) => setEdicao({ ...edicao, linhas: edicao.linhas.map((x, k) => (k === n ? { ...x, fator: e.target.value } : x)) })} />
                            <span className="small muted">{edicao.unidade || 'unidade'}</span>
                            <button className="btn btn-link" type="button" onClick={() => setEdicao({ ...edicao, linhas: edicao.linhas.filter((_, k) => k !== n) })}>Remover</button>
                          </div>
                        ))}
                        <div><button className="btn btn-link" type="button" onClick={() => setEdicao({ ...edicao, linhas: [...edicao.linhas, { unidade: '', fator: '' }] })}>+ unidade de compra</button></div>
                        <div className="acoes">
                          <button className="btn" type="button" onClick={() => setEdicao(null)}>Cancelar</button>
                          <button className="btn btn-primario" type="button" onClick={salvarEdicao}>Salvar insumo</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
          {itens.length === 0 && <p className="muted" style={{ padding: 12 }}>Nenhum item encontrado.</p>}
        </div>
      )}
      {aberto && <ConferenciaComposicao inicial={aberto.item.id} carregar={(itemId) => api<DetalheComposicao>(`/eng/tabelas/${id}/itens/${itemId}`)} aoFechar={() => setAberto(null)} />}
    </>
  );
}

/**
 * Entrada manual de insumo ou serviço (composição unitária) próprio: o item é criado na tabela própria da empresa
 * e, quando há obra aberta, já é copiado para ela.
 */
export function NovoItemProprio({ tipo, obraId, aoSalvar }: { tipo: 'insumo' | 'composicao'; obraId?: string; aoSalvar: (mensagem: string) => void }) {
  const [proprias, setProprias] = useState<Tabela[] | null>(null);
  const [tabelaId, setTabelaId] = useState('');
  const [erro, setErro] = useState('');
  const [criando, setCriando] = useState(false);
  const carregar = () =>
    api<{ tabelas: Tabela[] }>('/eng/tabelas')
      .then((r) => {
        const p = r.tabelas.filter((t) => t.fonte === 'proprio' && t.editavel);
        setProprias(p);
        setTabelaId((atual) => (p.some((t) => t.id === atual) ? atual : (p[0]?.id ?? '')));
      })
      .catch((e) => setErro((e as Error).message));
  useEffect(() => {
    carregar();
  }, []);

  async function criarTabelaPropria() {
    setErro('');
    setCriando(true);
    try {
      const r = await api<{ tabela: Tabela }>('/eng/tabelas', { corpo: { fonte: 'proprio', nome: 'Tabela própria', uf: null, mesReferencia: null, desonerado: false, csv: null } });
      setTabelaId(r.tabela.id);
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setCriando(false);
    }
  }

  async function salvo(itemId: string) {
    const nome = tipo === 'insumo' ? 'Insumo' : 'Serviço';
    const tabela = proprias?.find((t) => t.id === tabelaId)?.nome ?? 'própria';
    if (!obraId) return aoSalvar(`${nome} criado na tabela ${tabela}.`);
    try {
      await api(`/eng/obras/${obraId}/importar`, {
        corpo: { tabelaId, insumoIds: tipo === 'insumo' ? [itemId] : [], composicaoIds: tipo === 'composicao' ? [itemId] : [] },
      });
      aoSalvar(`${nome} criado na tabela ${tabela} e incluído nesta obra.`);
    } catch (err) {
      aoSalvar(`${nome} criado na tabela ${tabela}, mas não foi incluído na obra: ${(err as Error).message}`);
    }
  }

  /** Itens criados em lote pela importação: quando há obra aberta, já são incluídos nela. */
  async function loteCriado(itens: { id: string; tipo: string }[], mensagem: string) {
    if (!obraId) return aoSalvar(mensagem);
    try {
      await api(`/eng/obras/${obraId}/importar`, {
        corpo: { tabelaId, insumoIds: itens.filter((i) => i.tipo === 'insumo').map((i) => i.id), composicaoIds: itens.filter((i) => i.tipo === 'composicao').map((i) => i.id) },
      });
      aoSalvar(`${mensagem} Incluídos nesta obra.`);
    } catch (err) {
      aoSalvar(`${mensagem} Não foram incluídos na obra: ${(err as Error).message}`);
    }
  }

  if (erro && proprias === null) return <div className="alerta alerta-erro" role="alert">{erro}</div>;
  if (proprias === null) return <p className="muted">Carregando…</p>;
  if (proprias.length === 0)
    return (
      <div className="card">
        {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
        <p className="muted" style={{ marginTop: 0 }}>
          Os {tipo === 'insumo' ? 'insumos' : 'serviços'} próprios ficam na tabela própria da empresa, que ainda não existe.
        </p>
        <button className="btn btn-primario" type="button" onClick={criarTabelaPropria} disabled={criando}>{criando ? 'Criando…' : 'Criar a tabela própria'}</button>
      </div>
    );
  return (
    <div>
      {(
        <div className="campo" style={{ maxWidth: 360, marginBottom: 8 }}>
          <label htmlFor="np-tabela">Tabela que recebe o item</label>
          <select id="np-tabela" value={tabelaId} onChange={(e) => setTabelaId(e.target.value)}>
            {proprias.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
        </div>
      )}
      <NovoItem key={`${tabelaId}-${tipo}`} tabelaId={tabelaId} tipoFixo={tipo} aoSalvar={salvo} obraId={obraId} aoLote={loteCriado} />
    </div>
  );
}

/** Linha da composição em edição: insumo ou serviço escolhido na busca, com o coeficiente digitado. */
type ComponenteEdit = { tipo: 'insumo' | 'composicao'; codigo: string; descricao: string; unidade: string; coeficiente: string };
type ItemBusca = { id: string; tipo: string; codigo: string; descricao: string; unidade: string };
type Existente = { onde: 'obra' | 'tabela'; codigo: string; descricao: string } | null;
type ItemLidoTabela = {
  existente?: Existente;
  sugestoes?: NonNullable<Existente>[];
  tipo: 'insumo' | 'composicao';
  codigo: string;
  descricao: string;
  unidade: string;
  componentes: { tipo: 'insumo' | 'composicao'; codigo: string; descricao: string; unidade: string; coeficiente: number; existente?: Existente }[];
};

/** Campo de código com busca ao vivo na tabela (insumos ou serviços), conforme digita. */
function BuscaComponente({ tabelaId, tipo, valor, onEscolher, rotulo }: { tabelaId: string; tipo: 'insumo' | 'composicao'; valor: string; onEscolher: (item: ItemBusca) => void; rotulo: string }) {
  const [texto, setTexto] = useState(valor);
  const [achados, setAchados] = useState<ItemBusca[]>([]);
  const [aberto, setAberto] = useState(false);
  useEffect(() => setTexto(valor), [valor]);
  useEffect(() => {
    const termo = texto.trim();
    if (!aberto || termo.length < 1) {
      setAchados([]);
      return;
    }
    const t = setTimeout(() => {
      api<{ itens: ItemBusca[] }>(`/eng/tabelas/${tabelaId}/itens?tipo=${tipo}&busca=${encodeURIComponent(termo)}`)
        .then((r) => setAchados(r.itens.slice(0, 8)))
        .catch(() => setAchados([]));
    }, 200);
    return () => clearTimeout(t);
  }, [texto, aberto, tabelaId, tipo]);
  return (
    <div style={{ position: 'relative' }}>
      <input
        aria-label={rotulo}
        autoComplete="off"
        placeholder={tipo === 'insumo' ? 'código ou nome do insumo' : 'código ou nome do serviço'}
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          setAberto(true);
        }}
        onFocus={() => setAberto(true)}
        onBlur={() => setTimeout(() => setAberto(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && achados.length) {
            e.preventDefault();
            onEscolher(achados[0]);
            setAberto(false);
          }
        }}
      />
      {aberto && achados.length > 0 && (
        <ul role="listbox" aria-label={`Resultados para ${rotulo}`} style={{ position: 'absolute', zIndex: 5, left: 0, right: 0, top: '100%', margin: '4px 0 0', padding: 4, listStyle: 'none', maxHeight: 260, overflowY: 'auto', background: 'var(--surface-card)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 6px 18px rgba(0,0,0,.12)' }}>
          {achados.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onEscolher(i);
                  setAberto(false);
                }}
                style={{ width: '100%', textAlign: 'left', background: 'none', border: 0, padding: '6px 8px', cursor: 'pointer', color: 'var(--ink)', font: 'inherit' }}
              >
                <span className="mono small">{i.codigo}</span> · {i.descricao} <span className="small muted">({i.unidade})</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Itens da composição: código (com busca), descrição (preenchida pela escolha) e coeficiente, na mesma linha. */
function EditorComponentes({ tabelaId, valor, onMudar }: { tabelaId: string; valor: ComponenteEdit[]; onMudar: (v: ComponenteEdit[]) => void }) {
  const grade = { display: 'grid', gridTemplateColumns: 'minmax(180px, 1.1fr) minmax(200px, 2fr) 130px 32px', gap: 8, alignItems: 'center' } as const;
  const atualizar = (n: number, campo: Partial<ComponenteEdit>) => onMudar(valor.map((x, i) => (i === n ? { ...x, ...campo } : x)));
  const adicionar = (tipo: 'insumo' | 'composicao') => onMudar([...valor, { tipo, codigo: '', descricao: '', unidade: '', coeficiente: '' }]);
  return (
    <div className="campo">
      <span className="rotulo">Itens da composição</span>
      {valor.length > 0 && (
        <div className="small muted" style={{ ...grade, marginBottom: 2 }}>
          <span>Código</span>
          <span>Descrição</span>
          <span>Coeficiente</span>
          <span />
        </div>
      )}
      {valor.map((c, n) => (
        <div key={n} style={{ ...grade, marginBottom: 6 }}>
          <BuscaComponente
            tabelaId={tabelaId}
            tipo={c.tipo}
            valor={c.codigo}
            rotulo={`Código do ${c.tipo === 'insumo' ? 'insumo' : 'serviço'} ${n + 1}`}
            onEscolher={(item) => atualizar(n, { codigo: item.codigo, descricao: item.descricao, unidade: item.unidade })}
          />
          <input aria-label={`Descrição ${n + 1}`} readOnly value={c.descricao} placeholder="escolha pelo código" style={{ background: 'var(--surface-sunken)' }} />
          <input aria-label={`Coeficiente ${n + 1}`} inputMode="decimal" placeholder="coeficiente" value={c.coeficiente} onChange={(e) => atualizar(n, { coeficiente: e.target.value })} />
          <button className="btn btn-link" type="button" aria-label={`Remover item ${n + 1}`} onClick={() => onMudar(valor.filter((_, i) => i !== n))} style={{ padding: 0 }}>
            ×
          </button>
        </div>
      ))}
      <div className="acoes" style={{ gap: 16 }}>
        <button className="btn btn-link" type="button" onClick={() => adicionar('insumo')}>+ insumo</button>
        <button className="btn btn-link" type="button" onClick={() => adicionar('composicao')}>+ serviço</button>
      </div>
      <span className="ajuda">Insumo ou serviço da tabela própria, escolhido pelo código ou pelo nome. O preço do serviço é a soma dos itens × coeficiente; um serviço pode usar outros serviços.</span>
    </div>
  );
}

function lerEmBase64(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result).split(',')[1] ?? '');
    leitor.onerror = () => reject(new Error('Não consegui ler o arquivo.'));
    leitor.readAsDataURL(arquivo);
  });
}

/** Importação por IA: lê o arquivo, mostra os itens para conferir e lança os marcados na tabela própria. */
function ImportarPorIa({ tabelaId, obraId, aoLancar, aoFechar }: { tabelaId: string; obraId?: string; aoLancar: (itens: { id: string; tipo: string }[], mensagem: string) => void; aoFechar: () => void }) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [lendo, setLendo] = useState(false);
  const [lancando, setLancando] = useState(false);
  const [lidos, setLidos] = useState<ItemLidoTabela[] | null>(null);
  const [pendencias, setPendencias] = useState<string[]>([]);
  const [marcados, setMarcados] = useState<boolean[]>([]);
  // Conciliação manual: o item novo é trocado por um já cadastrado (índice da sugestão escolhida, por linha).
  const [usar, setUsar] = useState<Record<number, number>>({});
  const [erro, setErro] = useState('');

  async function ler() {
    if (!arquivo) return;
    setErro('');
    setLidos(null);
    setLendo(true);
    try {
      const base64 = await lerEmBase64(arquivo);
      const r = await api<{ itens: ItemLidoTabela[]; pendencias: string[] }>(`/eng/tabelas/${tabelaId}/composicoes-leitura`, { corpo: { arquivo: base64, nome: arquivo.name, obraId } });
      setLidos(r.itens);
      setPendencias(r.pendencias);
      setMarcados(r.itens.map((x) => !x.existente));
      setUsar({});
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setLendo(false);
    }
  }

  async function lancar() {
    if (!lidos) return;
    // Item conciliado com um cadastrado não é criado: os serviços que o usam passam a apontar para o cadastrado.
    const troca = new Map<string, NonNullable<Existente>>();
    lidos.forEach((x, i) => {
      const s = usar[i] !== undefined ? x.sugestoes?.[usar[i]] : undefined;
      if (s) troca.set(`${x.tipo}|${x.descricao}`, s);
    });
    const escolhidos = lidos.filter((x, i) => marcados[i] && !troca.has(`${x.tipo}|${x.descricao}`));
    if (escolhidos.length === 0) return setErro('Marque ao menos um item.');
    setErro('');
    setLancando(true);
    try {
      const r = await api<{ criados: number; itens: { id: string; tipo: string }[]; pendencias: string[] }>(`/eng/tabelas/${tabelaId}/itens/lote`, {
        corpo: {
          itens: escolhidos.map((x) => ({
            tipo: x.tipo,
            codigo: x.codigo,
            descricao: x.descricao,
            unidade: x.unidade,
            componentes: x.componentes.map((k) => {
              const s = troca.get(`${k.tipo}|${k.descricao}`);
              return { tipo: k.tipo, codigo: s ? s.codigo : k.codigo, descricao: s ? s.descricao : k.descricao, unidade: k.unidade, coeficiente: k.coeficiente };
            }),
          })),
        },
      });
      const aviso = r.pendencias.length ? ` ${r.pendencias.length} ${r.pendencias.length === 1 ? 'ponto precisa' : 'pontos precisam'} de conferência depois.` : '';
      aoLancar(r.itens, `${r.criados} ${r.criados === 1 ? 'item criado' : 'itens criados'} na tabela própria a partir do arquivo.${aviso}`);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setLancando(false);
    }
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 12, marginBottom: 12, display: 'grid', gap: 10 }}>
      <div className="campo" style={{ margin: 0 }}>
        <label htmlFor="ia-arquivo">Arquivo com insumos e serviços</label>
        <input
          id="ia-arquivo"
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.html,.htm,.xlsx,.csv,.txt,application/pdf,image/png,image/jpeg,image/webp,text/html,text/csv"
          onChange={(e) => {
            setArquivo(e.target.files?.[0] ?? null);
            setLidos(null);
            setErro('');
          }}
        />
        <span className="ajuda">PDF, foto (PNG, JPG, WEBP), HTML, XLSX, CSV ou TXT. Nada entra na tabela antes da sua confirmação.</span>
      </div>
      <div className="acoes">
        <button className="btn btn-primario" type="button" onClick={ler} disabled={!arquivo || lendo}>{lendo ? 'Lendo o arquivo…' : 'Ler com IA'}</button>
        <button className="btn btn-link" type="button" onClick={aoFechar}>Fechar</button>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {lidos && lidos.length === 0 && <p className="muted" style={{ margin: 0 }}>Não encontrei insumos nem serviços neste arquivo.</p>}
      {lidos && lidos.length > 0 && (
        <>
          <p className="ajuda" style={{ margin: 0 }}>{lidos.length} itens lidos; os já cadastrados vêm desmarcados e serão reaproveitados. Nos itens do serviço, ✓ já existe e + será criado.</p>
          <div style={{ overflowX: 'auto' }}>
            <table className="tabela tabela-compacta">
              <thead>
                <tr>
                  <th aria-label="Lançar" />
                  <th>Tipo</th>
                  <th>Código</th>
                  <th>Descrição</th>
                  <th>Un.</th>
                  <th>Situação</th>
                  <th>Itens do serviço (coeficiente)</th>
                </tr>
              </thead>
              <tbody>
                {lidos.map((x, i) => (
                  <tr key={i}>
                    <td>
                      <input type="checkbox" aria-label={`Lançar ${x.descricao}`} checked={!!marcados[i]} onChange={(e) => setMarcados(marcados.map((m, k) => (k === i ? e.target.checked : m)))} />
                    </td>
                    <td>{x.tipo === 'insumo' ? 'Insumo' : 'Serviço'}</td>
                    <td className="mono small">{x.codigo || '—'}</td>
                    <td>{x.descricao}</td>
                    <td>{x.unidade}</td>
                    <td className="small">
                      {x.existente ? `Já cadastrado ${x.existente.onde === 'obra' ? 'na obra' : 'na tabela'} (${x.existente.codigo})` : (
                        <>
                          <div>Novo: entra na tabela de referência</div>
                          {!!x.sugestoes?.length && (
                            <select aria-label={`Conciliar ${x.descricao}`} value={usar[i] ?? ''} onChange={(e) => setUsar({ ...usar, [i]: e.target.value === '' ? undefined! : Number(e.target.value) })} style={{ maxWidth: 260 }}>
                              <option value="">Cadastrar como novo</option>
                              {x.sugestoes.map((s, n) => <option key={n} value={n}>Usar {s.codigo} · {s.descricao}</option>)}
                            </select>
                          )}
                        </>
                      )}
                    </td>
                    <td className="small muted">
                      {x.componentes.length ? x.componentes.map((k) => `${k.existente ? '✓ ' : '+ '}${k.descricao} × ${k.coeficiente.toLocaleString('pt-BR', { maximumFractionDigits: 6 })}`).join('; ') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pendencias.length > 0 && (
            <ul className="ajuda" style={{ margin: 0 }}>
              {pendencias.map((p, k) => (
                <li key={k}>{p}</li>
              ))}
            </ul>
          )}
          <div className="acoes">
            <button className="btn btn-primario" type="button" onClick={lancar} disabled={lancando}>{lancando ? 'Lançando…' : 'Lançar na tabela de referência'}</button>
          </div>
        </>
      )}
    </div>
  );
}

type UnidadeCompraEdit = { unidade: string; fator: string };
function NovoItem({ tabelaId, aoSalvar, tipoFixo, obraId, aoLote }: { tabelaId: string; aoSalvar: (itemId: string) => void; tipoFixo?: 'insumo' | 'composicao'; obraId?: string; aoLote: (itens: { id: string; tipo: string }[], mensagem: string) => void }) {
  const [d, setD] = useState({ tipo: (tipoFixo ?? 'insumo') as 'insumo' | 'composicao', descricao: '', unidade: '', grupo: '', precoOrigem: 'nao_informado' as 'nao_informado' | 'informado', preco: '' });
  const [unidades, setUnidades] = useState<UnidadeCompraEdit[]>([]);
  const [comp, setComp] = useState<ComponenteEdit[]>([]);
  const [importando, setImportando] = useState(false);
  const [erro, setErro] = useState('');
  const base = d.unidade.trim() || 'unidade';
  const eInsumo = d.tipo === 'insumo';

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    const componentes = comp.map((c) => ({ tipo: c.tipo, insumoCodigo: c.codigo.trim(), coeficiente: lerNumero(c.coeficiente) ?? -1 }));
    if (componentes.some((c) => !c.insumoCodigo)) return setErro('Escolha o item de cada linha pelo código, ou remova a linha.');
    if (d.tipo === 'composicao' && componentes.some((c) => c.coeficiente < 0)) return setErro('Confira os coeficientes dos insumos.');
    try {
      const r = await api<{ id: string; codigo: string }>(`/eng/tabelas/${tabelaId}/itens`, {
        corpo: {
          tipo: d.tipo,
          descricao: d.descricao,
          unidade: d.unidade,
          grupo: d.grupo || null,
          precoOrigem: eInsumo ? d.precoOrigem : undefined,
          preco: eInsumo && d.precoOrigem === 'informado' ? d.preco : null,
          unidadesCompra: eInsumo ? unidades.filter((u) => u.unidade.trim()).map((u) => ({ unidade: u.unidade.trim(), fator: u.fator })) : undefined,
          componentes,
        },
      });
      setD({ tipo: d.tipo, descricao: '', unidade: '', grupo: '', precoOrigem: 'nao_informado', preco: '' });
      setUnidades([]);
      setComp([]);
      aoSalvar(r.id);
    } catch (err) {
      setErro((err as Error).message);
    }
  }
  return (
    <form className="card form" onSubmit={salvar}>
      <h2 style={{ margin: 0 }}>{tipoFixo === 'insumo' ? 'Novo insumo' : tipoFixo === 'composicao' ? 'Novo serviço' : 'Novo item'}</h2>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        {!tipoFixo && (
          <div className="campo">
            <label htmlFor="ni-tipo">Tipo</label>
            <select id="ni-tipo" value={d.tipo} onChange={(e) => setD({ ...d, tipo: e.target.value as 'insumo' | 'composicao' })}>
              <option value="insumo">Insumo</option>
              <option value="composicao">Composição (serviço)</option>
            </select>
          </div>
        )}
        <div className="campo">
          <label htmlFor="ni-cod">Código</label>
          <input id="ni-cod" value="Automático" disabled />
          <span className="ajuda">{eInsumo ? 'Recebe o próximo número da tabela (ex.: INS-0001).' : 'Serviço novo recebe o próximo número da tabela própria.'}</span>
        </div>
        <div className="campo" style={{ gridColumn: 'span 2' }}><label htmlFor="ni-desc">Descrição</label><input id="ni-desc" value={d.descricao} onChange={(e) => setD({ ...d, descricao: e.target.value })} /></div>
        <div className="campo">
          <label htmlFor="ni-un">{eInsumo ? 'Unidade de orçamento' : 'Unidade'}</label>
          <input id="ni-un" value={d.unidade} onChange={(e) => setD({ ...d, unidade: e.target.value })} placeholder={eInsumo ? 'ex.: kg' : undefined} />
        </div>
      </div>
      {eInsumo && (
        <>
          <div className="campo" style={{ marginTop: 12 }}>
            <span className="rotulo">Preço</span>
            <div className="segmentado" role="group" aria-label="Preço do insumo" style={{ maxWidth: 420 }}>
              <button type="button" aria-pressed={d.precoOrigem === 'nao_informado'} className={d.precoOrigem === 'nao_informado' ? 'ativo' : ''} onClick={() => setD({ ...d, precoOrigem: 'nao_informado' })}>Não registrar agora</button>
              <button type="button" aria-pressed={d.precoOrigem === 'informado'} className={d.precoOrigem === 'informado' ? 'ativo' : ''} onClick={() => setD({ ...d, precoOrigem: 'informado' })}>Informar valor</button>
            </div>
            {d.precoOrigem === 'informado' && (
              <input id="ni-preco" inputMode="decimal" aria-label="Preço por unidade de orçamento (R$)" placeholder={`R$ por ${base}`} value={d.preco} onChange={(e) => setD({ ...d, preco: e.target.value })} style={{ maxWidth: 220, marginTop: 6 }} />
            )}
            <span className="ajuda">O preço pode ficar para depois. Insumo sem preço aparece na tabela, mas não tem custo até ser informado.</span>
          </div>
          <div className="campo" style={{ marginTop: 12 }}>
            <span className="rotulo">Unidades de compra (opcional)</span>
            {unidades.map((u, n) => (
              <div key={n} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
                <input aria-label={`Unidade de compra ${n + 1}`} placeholder="ex.: barra" value={u.unidade} onChange={(e) => setUnidades(unidades.map((x, i) => (i === n ? { ...x, unidade: e.target.value } : x)))} style={{ maxWidth: 140 }} />
                <span className="small muted">1 {u.unidade.trim() || 'unidade'} =</span>
                <input aria-label={`Quantos ${base} cabem em 1 ${u.unidade.trim() || 'unidade'}`} placeholder="ex.: 46,2" inputMode="decimal" value={u.fator} onChange={(e) => setUnidades(unidades.map((x, i) => (i === n ? { ...x, fator: e.target.value } : x)))} style={{ maxWidth: 120 }} />
                <span className="small muted">{base}</span>
                <button className="btn btn-link" type="button" onClick={() => setUnidades(unidades.filter((_, i) => i !== n))}>Remover</button>
              </div>
            ))}
            <button className="btn btn-link" type="button" onClick={() => setUnidades([...unidades, { unidade: '', fator: '' }])}>+ unidade de compra</button>
            <span className="ajuda">Ex.: o aço é orçado em kg, mas comprado em barra: 1 barra = 46,2 kg. Cada unidade de compra informa quantos {base} tem.</span>
          </div>
        </>
      )}
      {d.tipo === 'composicao' && (
        <>
          <div className="acoes" style={{ marginBottom: 8 }}>
            <button className="btn" type="button" onClick={() => setImportando(!importando)} aria-expanded={importando}>
              {importando ? 'Fechar importação' : 'Importar composições por IA'}
            </button>
          </div>
          {importando && (
            <ImportarPorIa
              tabelaId={tabelaId}
              obraId={obraId}
              aoLancar={(itens, mensagem) => {
                setImportando(false);
                aoLote(itens, mensagem);
              }}
              aoFechar={() => setImportando(false)}
            />
          )}
          <EditorComponentes tabelaId={tabelaId} valor={comp} onMudar={setComp} />
        </>
      )}
      <div className="acoes">
        <button className="btn btn-primario" type="submit" disabled={d.descricao.trim().length < 2 || d.unidade.trim() === '' || (eInsumo && d.precoOrigem === 'informado' && d.preco.trim() === '')}>Adicionar</button>
      </div>
    </form>
  );
}

/**
 * Conferência de uma composição: os itens diretos (insumos e serviços auxiliares) com multiplicador, preço e custo,
 * e os insumos desdobrados que formam o preço. Serviço auxiliar abre a composição dele (com caminho de volta).
 */
export function ConferenciaComposicao({ inicial, carregar, aoFechar }: { inicial: string; carregar: (itemId: string) => Promise<DetalheComposicao>; aoFechar: () => void }) {
  const [pilha, setPilha] = useState<DetalheComposicao[]>([]);
  const [visao, setVisao] = useState<'estrutura' | 'insumos'>('estrutura');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  async function abrir(itemId: string, empilhar: boolean) {
    setErro('');
    setCarregando(true);
    try {
      const d = await carregar(itemId);
      setPilha((p) => (empilhar ? [...p, d] : [d]));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }
  useEffect(() => {
    setVisao('estrutura');
    abrir(inicial, false);
  }, [inicial]);

  const atual = pilha[pilha.length - 1];
  const temEstrutura = !!atual?.estrutura?.length;
  const linhas: ItemEstrutura[] =
    visao === 'estrutura' && temEstrutura ? atual!.estrutura! : (atual?.componentes ?? []).map((k) => ({ ...k, id: '', tipo: 'insumo' as const }));
  const total = linhas.reduce((soma, k) => soma + (k.precoUnitario ?? 0) * k.coeficiente, 0);
  const num = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 7 });

  return (
    <div className="card" style={{ marginTop: 12 }} role="region" aria-label="Composição">
      <div className="cabecalho" style={{ marginBottom: 8 }}>
        <div className="titulo">
          {pilha.length > 1 && (
            <span className="small">
              {pilha.slice(0, -1).map((p, i) => (
                <span key={p.item.id}>
                  <button className="btn btn-link" type="button" style={{ padding: 0, minHeight: 0 }} onClick={() => setPilha(pilha.slice(0, i + 1))}>{p.item.codigo}</button>
                  {' › '}
                </span>
              ))}
              {atual?.item.codigo}
            </span>
          )}
          <h2 style={{ margin: 0 }}>{atual ? `Composição ${atual.item.codigo}: ${atual.item.descricao}` : 'Composição'}</h2>
          {atual && <span className="muted small">Preço unitário: {formatarMoeda(atual.item.preco)} por {atual.item.unidade}</span>}
        </div>
        <button className="btn btn-link" type="button" onClick={aoFechar}>Fechar</button>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {carregando && !atual && <p className="muted">Carregando…</p>}
      {atual && (
        <>
          {temEstrutura && (
            <div className="segmentado" role="group" aria-label="Visão" style={{ marginBottom: 8 }}>
              <button type="button" aria-pressed={visao === 'estrutura'} className={visao === 'estrutura' ? 'ativo' : ''} onClick={() => setVisao('estrutura')}>Insumos e serviços</button>
              <button type="button" aria-pressed={visao === 'insumos'} className={visao === 'insumos' ? 'ativo' : ''} onClick={() => setVisao('insumos')}>Só insumos (desdobrado)</button>
            </div>
          )}
          {linhas.length === 0 ? (
            <p className="muted">Esta composição não tem itens. Reimporte o arquivo da tabela para completar.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Código</th>
                    <th>Descrição</th>
                    <th>Unid.</th>
                    <th className="num">Multiplicador</th>
                    <th className="num">Preço unitário</th>
                    <th className="num">Custo</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((k) => (
                    <tr key={`${k.tipo}:${k.codigo}`}>
                      <td>{k.tipo === 'composicao' ? <span className="selo">Serviço</span> : 'Insumo'}</td>
                      <td className="mono">{k.codigo}</td>
                      <td>
                        {k.tipo === 'composicao' && k.id ? (
                          <button className="btn btn-link" type="button" style={{ padding: 0, minHeight: 0, textAlign: 'left' }} disabled={carregando} onClick={() => abrir(k.id, true)}>{k.descricao}</button>
                        ) : (
                          k.descricao
                        )}
                      </td>
                      <td>{k.unidade}</td>
                      <td className="num">{num(k.coeficiente)}</td>
                      <td className="num">{k.precoUnitario === null ? '—' : formatarMoeda(k.precoUnitario)}</td>
                      <td className="num">{k.precoUnitario === null ? '—' : formatarMoeda(k.precoUnitario * k.coeficiente)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={6} className="num"><b>Total</b></td>
                    <td className="num"><b>{formatarMoeda(total)}</b></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <p className="small muted" style={{ marginBottom: 0 }}>
            {visao === 'estrutura' && temEstrutura
              ? 'Clique num serviço para ver a composição dele. O preço do serviço é a soma dos custos dos seus itens.'
              : 'Insumos finais, com os serviços auxiliares já desdobrados (multiplicadores acumulados).'}
          </p>
        </>
      )}
    </div>
  );
}
