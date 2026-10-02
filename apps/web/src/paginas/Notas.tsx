import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ErroApi, formatarData, formatarMoeda, hojeLocal, NOMES_MODELO, nomeMes, SELO_NOTA, somarMeses, type NotaFiscal, type NotaResumo } from '../api';

type Filtro = 'todas' | 'rascunho' | 'confirmada' | 'cancelada';
const FILTROS: { id: Filtro; texto: string }[] = [
  { id: 'todas', texto: 'Todas' },
  { id: 'rascunho', texto: 'Para conferir' },
  { id: 'confirmada', texto: 'Lançadas' },
  { id: 'cancelada', texto: 'Canceladas' },
];

type Resultado = { arquivo: string; ok: boolean; texto: string; notaId?: string };

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

  const termo = busca.trim().toLowerCase();
  const visiveis = (lista ?? []).filter((n) => !termo || [n.pessoa, n.numero, n.categorias].some((x) => (x ?? '').toLowerCase().includes(termo)));
  const total = visiveis.filter((n) => n.status === 'confirmada').reduce((s, n) => s + (n.direcao === 'entrada' ? n.total : 0), 0);

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Notas fiscais</h1>
          <span className="muted">Importe o XML ou lance a nota à mão. Depois de conferida, a nota vira despesa (ou receita) com as parcelas a pagar.</span>
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
          <Link className="btn btn-secundario" to="/fin/notas/nova">
            Lançar nota à mão
          </Link>
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}

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
                      {n.origem === 'xml' ? 'XML' : 'Digitada'} · {n.itens} {n.itens === 1 ? 'item' : 'itens'}
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
