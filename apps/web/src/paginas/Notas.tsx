import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { LeitorCodigo } from '../componentes/LeitorCodigo';
import { chaveDoArquivoDeImagem, chaveNoPdf } from '../leitorBarras';
import { api, ErroApi, formatarChave, formatarData, formatarMoeda, hojeLocal, NOMES_MODELO, nomeMes, SELO_NOTA, somarMeses, type NotaFiscal, type NotaResumo } from '../api';

type Filtro = 'todas' | 'rascunho' | 'confirmada' | 'cancelada';
const FILTROS: { id: Filtro; texto: string }[] = [
  { id: 'todas', texto: 'Todas' },
  { id: 'rascunho', texto: 'Para conferir' },
  { id: 'confirmada', texto: 'Lançadas' },
  { id: 'cancelada', texto: 'Canceladas' },
];

type Resultado = { arquivo: string; ok: boolean; texto: string; notaId?: string };

const COMO_LIDA: Record<string, string> = { leitor: 'lida pelo Agrega', ia: 'lida pela IA', codigo_barras: 'pela chave do código de barras' };
const CAMPOS_CONFERIR: Record<string, string> = { dataEmissao: 'data', fornecedor: 'fornecedor', itens: 'itens', total: 'total' };

function base64(arquivo: Blob): Promise<string> {
  return new Promise((ok, falha) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1] ?? '');
    r.onerror = () => falha(new Error('Não consegui abrir o arquivo.'));
    r.readAsDataURL(arquivo);
  });
}

function textoNota(n: NotaFiscal) {
  return `${NOMES_MODELO[n.modelo]} ${n.numero ?? 's/n'} · ${n.fornecedorNome ?? n.clienteNome ?? n.emitenteNome ?? 'sem fornecedor'} · ${formatarMoeda(n.totais.total)}`;
}

export const ORIGEM_NOTA: Record<NotaFiscal['origem'], string> = { xml: 'XML', manual: 'Digitada', ia_whatsapp: 'WhatsApp', pdf: 'PDF', chave: 'Código de barras' };

export function Notas() {
  const [params, setParams] = useSearchParams();
  const mes = /^\d{4}-\d{2}$/.test(params.get('mes') ?? '') ? params.get('mes')! : hojeLocal().slice(0, 7);
  const filtro = (FILTROS.some((f) => f.id === params.get('situacao')) ? params.get('situacao') : 'todas') as Filtro;
  const [lista, setLista] = useState<NotaResumo[] | null>(null);
  const [rascunhos, setRascunhos] = useState(0);
  const [erro, setErro] = useState('');
  const [importando, setImportando] = useState(false);
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [busca, setBusca] = useState('');
  const arquivo = useRef<HTMLInputElement>(null);
  const arquivoPdf = useRef<HTMLInputElement>(null);
  const [progresso, setProgresso] = useState('');
  const [leitor, setLeitor] = useState(false);
  const [criandoChave, setCriandoChave] = useState(false);
  const navegar = useNavigate();
  const [ia, setIa] = useState<boolean | null>(null);
  useEffect(() => {
    api<{ ia: boolean }>('/fin/notas/leitura').then((r) => setIa(r.ia)).catch(() => setIa(null));
  }, []);

  const carregar = useCallback(async () => {
    setLista(null);
    try {
      const de = `${mes}-01`;
      const r = await api<{ notas: NotaResumo[]; rascunhos: number }>(`/fin/notas?de=${de}&ate=${somarMeses(de, 1)}${filtro !== 'todas' ? `&status=${filtro}` : ''}`);
      setLista(r.notas);
      setRascunhos(r.rascunhos);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [mes, filtro]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  const ir = (p: Record<string, string>) => setParams({ mes, situacao: filtro, ...p }, { replace: true });

  async function importar(arquivos: FileList | null) {
    if (!arquivos?.length) return;
    setErro('');
    setImportando(true);
    const res: Resultado[] = [];
    for (const f of Array.from(arquivos)) {
      try {
        if (f.size > 4_000_000) throw new Error('Arquivo grande demais para um XML de nota.');
        const xml = await f.text();
        const r = await api<{ nota: NotaFiscal }>('/fin/notas/xml', { corpo: { xml } });
        const n = r.nota;
        res.push({
          arquivo: f.name,
          ok: true,
          notaId: n.id,
          texto: `NF ${n.numero ?? ''} · ${n.fornecedorNome ?? n.clienteNome ?? n.emitenteNome ?? ''} · ${formatarMoeda(n.totais.total)}${n.fornecedorNovo ? ' · fornecedor cadastrado agora' : ''}`,
        });
      } catch (e) {
        res.push({ arquivo: f.name, ok: false, texto: (e as Error).message, notaId: e instanceof ErroApi ? e.dados.notaId : undefined });
      }
    }
    setResultados(res);
    setImportando(false);
    if (arquivo.current) arquivo.current.value = '';
    await carregar();
  }

  async function importarPdf(arquivos: FileList | null) {
    if (!arquivos?.length) return;
    setErro('');
    setImportando(true);
    const lista = Array.from(arquivos);
    const res: Resultado[] = [];
    for (const [k, f] of lista.entries()) {
      setProgresso(lista.length > 1 ? `Lendo ${k + 1} de ${lista.length}…` : 'Lendo a nota…');
      try {
        const pdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
        const tipo = pdf ? 'application/pdf' : f.type;
        if (!pdf && !/^image\/(jpeg|png|webp)$/.test(f.type)) throw new Error('Envie o PDF da nota ou uma foto (JPG ou PNG).');
        if (f.size > 10 * 1024 * 1024) throw new Error('Arquivo grande demais (máximo 10 MB).');
        // Código de barras em imagem (PDF escaneado ou foto): lido aqui no navegador.
        const chave = pdf ? await chaveNoPdf(new Uint8Array(await f.arrayBuffer())).catch(() => null) : await chaveDoArquivoDeImagem(f);
        const r = await api<{ nota: NotaFiscal; metodo: string }>('/fin/notas/pdf', { corpo: { arquivo: await base64(f), nome: f.name, tipo, chave } });
        const n = r.nota;
        const conferir = (n.leitura?.conferir ?? []).map((c) => CAMPOS_CONFERIR[c]).filter(Boolean);
        res.push({
          arquivo: f.name,
          ok: true,
          notaId: n.id,
          texto: `${textoNota(n)} · ${COMO_LIDA[r.metodo] ?? 'lida'}${n.fornecedorNovo ? ' · fornecedor cadastrado agora' : ''}${conferir.length ? ` · conferir: ${conferir.join(', ')}` : ''}`,
        });
      } catch (e) {
        res.push({ arquivo: f.name, ok: false, texto: (e as Error).message, notaId: e instanceof ErroApi ? e.dados.notaId : undefined });
      }
    }
    setProgresso('');
    setResultados(res);
    setImportando(false);
    if (arquivoPdf.current) arquivoPdf.current.value = '';
    await carregar();
  }

  async function criarPelaChave(chave: string) {
    setErro('');
    setCriandoChave(true);
    try {
      const r = await api<{ nota: NotaFiscal }>('/fin/notas/chave', { corpo: { chave } });
      navegar(`/fin/notas/${r.nota.id}`);
    } catch (e) {
      const id = e instanceof ErroApi ? e.dados.notaId : undefined;
      setResultados([{ arquivo: formatarChave(chave), ok: false, texto: (e as Error).message, notaId: id }]);
      setLeitor(false);
    }
    setCriandoChave(false);
  }

  const termo = busca.trim().toLowerCase();
  const visiveis = (lista ?? []).filter((n) => !termo || [n.pessoa, n.numero, n.categorias].some((x) => (x ?? '').toLowerCase().includes(termo)));
  const total = visiveis.filter((n) => n.status === 'confirmada').reduce((s, n) => s + (n.direcao === 'entrada' ? n.total : 0), 0);

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Notas fiscais</h1>
          <span className="muted">Importe o XML ou o PDF, leia o código de barras ou lance a nota à mão. Depois de conferida, a nota vira despesa (ou receita) com as parcelas a pagar.</span>
        </div>
        <div className="acoes">
          <input
            ref={arquivo}
            type="file"
            accept=".xml,text/xml,application/xml"
            multiple
            hidden
            onChange={(e) => importar(e.target.files)}
          />
          <button className="btn btn-primario" type="button" disabled={importando} onClick={() => arquivo.current?.click()}>
            {importando ? 'Importando…' : 'Importar XML'}
          </button>
          <input ref={arquivoPdf} type="file" accept=".pdf,application/pdf,image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => importarPdf(e.target.files)} />
          <button className="btn btn-secundario" type="button" disabled={importando} onClick={() => arquivoPdf.current?.click()}>
            Importar PDF
          </button>
          <button className="btn btn-secundario" type="button" aria-pressed={leitor} onClick={() => setLeitor(!leitor)}>
            Código de barras
          </button>
          <Link className="btn btn-secundario" to="/fin/notas/nova">
            Lançar nota à mão
          </Link>
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {progresso && (
        <div className="alerta alerta-info" role="status">
          {progresso} {ia ? 'O Agrega lê o PDF; o que ele não conseguir vai para a IA.' : 'O Agrega lê o texto e o código de barras do PDF.'}
        </div>
      )}
      {leitor && <LeitorCodigo aoLer={criarPelaChave} aoFechar={() => setLeitor(false)} ocupado={criandoChave} />}

      {resultados.length > 0 && (
        <div className="card">
          <div className="cabecalho" style={{ marginBottom: 8 }}>
            <h2>Resultado da importação</h2>
            <button className="btn btn-link" type="button" onClick={() => setResultados([])}>
              Fechar
            </button>
          </div>
          <ul className="lista-alertas">
            {resultados.map((r, i) => (
              <li key={i}>
                <span style={{ minWidth: 0 }}>
                  <span className="small mono">{r.arquivo}</span>
                  <div className="small">{r.texto}</div>
                </span>
                {r.notaId ? (
                  <Link to={`/fin/notas/${r.notaId}`} className={`selo ${r.ok ? 'selo-aviso' : 'selo-neutro'}`} style={{ textDecoration: 'none' }}>
                    {r.ok ? 'Conferir ›' : 'Ver nota ›'}
                  </Link>
                ) : (
                  <span className="selo selo-perigo">Não importada</span>
                )}
              </li>
            ))}
          </ul>
          {ia === false && resultados.some((r) => !r.ok || r.texto.includes('pela chave')) && (
            <p className="small muted" style={{ margin: '8px 0 0' }}>
              A leitura por IA está desligada: de PDF escaneado e de foto, o Agrega só lê a chave do código de barras. Para ligar, o administrador cadastra a chave da IA (variável ANTHROPIC_API_KEY) no servidor.
            </p>
          )}
        </div>
      )}

      <div className="filtros">
        {FILTROS.map((f) => (
          <button key={f.id} type="button" className={`chip ${filtro === f.id ? 'chip-ativo' : ''}`} aria-pressed={filtro === f.id} onClick={() => ir({ situacao: f.id })}>
            {f.texto}
            {f.id === 'rascunho' && rascunhos > 0 && <span className="mono"> {rascunhos}</span>}
          </button>
        ))}
        {filtro !== 'rascunho' && (
          <span className="acoes" style={{ gap: 4 }}>
            <button className="btn btn-link" type="button" aria-label="Mês anterior" onClick={() => ir({ mes: somarMeses(`${mes}-01`, -1).slice(0, 7) })}>
              ‹
            </button>
            <span style={{ fontWeight: 600, textTransform: 'capitalize' }}>{nomeMes(mes)}</span>
            <button className="btn btn-link" type="button" aria-label="Próximo mês" onClick={() => ir({ mes: somarMeses(`${mes}-01`, 1).slice(0, 7) })}>
              ›
            </button>
          </span>
        )}
        <input className="busca" type="search" aria-label="Buscar" placeholder="Buscar fornecedor, número ou categoria" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>

      <div className="card tabela-caixa">
        {!lista ? (
          <p className="muted">Carregando…</p>
        ) : visiveis.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            {lista.length ? 'Nenhuma nota encontrada na busca.' : filtro === 'rascunho' ? 'Nenhuma nota esperando conferência.' : 'Nenhuma nota neste mês. Importe o XML que o fornecedor enviou por e-mail.'}
          </p>
        ) : (
          <table className="tabela">
            <thead>
              <tr>
                <th>Emissão</th>
                <th>Nota</th>
                <th>Fornecedor / cliente</th>
                <th>Categorias</th>
                <th>Situação</th>
                <th style={{ textAlign: 'right' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((n) => (
                <tr key={n.id}>
                  <td className="mono small">{formatarData(n.dataEmissao)}</td>
                  <td>
                    <Link to={`/fin/notas/${n.id}`} style={{ fontWeight: 600 }}>
                      {NOMES_MODELO[n.modelo]} {n.numero ?? 's/n'}
                    </Link>
                    <div className="small muted">
                      {n.direcao === 'saida' ? 'Venda · ' : ''}
                      {ORIGEM_NOTA[n.origem] ?? 'Digitada'} · {n.itens} {n.itens === 1 ? 'item' : 'itens'}
                    </div>
                  </td>
                  <td className="small">{n.pessoa ?? '—'}</td>
                  <td className="small">
                    {n.categorias ?? '—'}
                    {n.semCategoria > 0 && n.status !== 'cancelada' && <div className="small" style={{ color: 'var(--status-warn-ink)' }}>{n.semCategoria} sem categoria</div>}
                  </td>
                  <td>
                    <span className={`selo ${SELO_NOTA[n.status].classe}`}>{SELO_NOTA[n.status].texto}</span>
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(n.total)}</td>
                </tr>
              ))}
            </tbody>
            {total > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={5} className="small muted">Compras lançadas nesta lista</td>
                  <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{formatarMoeda(total)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
      <p className="small muted">
        As categorias que você escolhe são lembradas para as próximas notas do mesmo fornecedor. <Link to="/fin/regras">Ver regras de apropriação</Link>.
      </p>
    </>
  );
}
