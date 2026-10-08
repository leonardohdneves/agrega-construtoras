// Produção › Romaneios e etiquetas: documento de entrega de cada carga (NBR 7212, A4 com 2 vias)
// e etiquetas dos corpos de prova (folha A4 de etiquetas adesivas 3 × 8, 70 × 37 mm).
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { agoraLocal, api, diaCurto, formatarCnpj, formatarDocumento, formatarNumero, hojeLocal, somarDias, type Carga } from '../api';
import { qrSvg } from '../qr';
import { useSessao } from '../sessao';

const hora = (iso: string) => agoraLocal(new Date(iso)).slice(11, 16);
const dataBr = (iso: string) => agoraLocal(new Date(iso)).slice(0, 10).split('-').reverse().join('/');
const dataCurta = (d: string) => d.slice(0, 10).split('-').reverse().map((x, i) => (i === 2 ? x.slice(2) : x)).join('/');
const UN: Record<string, string> = { kg: 'kg', L: 'L', m3: 'm³', t: 't', un: 'un' };

function Qr({ texto, mm }: { texto: string; mm: number }) {
  const q = useMemo(() => qrSvg(texto), [texto]);
  return (
    <svg className="qr" viewBox={`0 0 ${q.tamanho} ${q.tamanho}`} style={{ width: `${mm}mm`, height: `${mm}mm` }} shapeRendering="crispEdges" role="img" aria-label={`QR: ${texto}`}>
      <rect width={q.tamanho} height={q.tamanho} fill="#fff" />
      <path d={q.caminho} fill="#000" />
    </svg>
  );
}

/** Define a página de impressão (A4 sem margem) enquanto a tela estiver aberta. */
function usePaginaA4(margem = '0') {
  useEffect(() => {
    const st = document.createElement('style');
    st.dataset.agrega = 'pagina-a4';
    st.textContent = `@page { size: A4 portrait; margin: ${margem}; }`;
    document.head.appendChild(st);
    return () => st.remove();
  }, [margem]);
}

// ---------------------------------------------------------------- seleção
export function ProdRomaneios() {
  const navegar = useNavigate();
  const [dia, setDia] = useState(hojeLocal());
  const [cargas, setCargas] = useState<Carga[] | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState('');
  const hoje = hojeLocal();

  const carregar = useCallback(() => {
    setCargas(null);
    api<{ cargas: Carga[] }>(`/prod/cargas?de=${dia}&ate=${dia}`)
      .then((r) => {
        const lista = [...r.cargas].sort((a, b) => a.dataHora.localeCompare(b.dataHora));
        setCargas(lista);
        setSel(new Set(lista.filter((c) => c.status === 'produzida').map((c) => c.id)));
      })
      .catch((e) => setErro((e as Error).message));
  }, [dia]);
  useEffect(carregar, [carregar]);

  const marcadas = (cargas ?? []).filter((c) => sel.has(c.id));
  const comCps = marcadas.filter((c) => c.status === 'produzida' && ['pendente', 'moldada', 'ativa'].includes(c.amostraStatus ?? ''));
  const todas = !!cargas?.length && cargas.every((c) => sel.has(c.id));
  const alternar = (id: string) => setSel((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Romaneios e etiquetas</h1>
          <span className="muted">Documento de entrega de cada carga (A4, 2 vias) e etiquetas dos corpos de prova (folha A4 de etiquetas 3 × 8).</span>
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div className="filtros">
        <div className="navegar-mes">
          <button className="btn btn-secundario" type="button" aria-label="Dia anterior" onClick={() => setDia(somarDias(dia, -1))}>‹</button>
          <input type="date" value={dia} max={hoje} onChange={(e) => e.target.value && setDia(e.target.value)} aria-label="Dia" />
          <button className="btn btn-secundario" type="button" aria-label="Próximo dia" disabled={dia >= hoje} onClick={() => setDia(somarDias(dia, 1))}>›</button>
          {dia !== hoje && <button className="btn btn-link" type="button" onClick={() => setDia(hoje)}>Hoje</button>}
        </div>
      </div>

      <div className="card barra-impressao">
        <div>
          <b>{marcadas.length}</b> carga(s) marcada(s) · <b>{comCps.length}</b> com etiquetas de CP
        </div>
        <div className="acoes">
          <button className="btn btn-primario" type="button" disabled={!marcadas.length} onClick={() => navegar(`/prod/kit?ids=${marcadas.map((c) => c.id).join(',')}`)}>
            Romaneios e etiquetas das marcadas
          </button>
          <button className="btn btn-secundario" type="button" disabled={!comCps.length} onClick={() => navegar(`/prod/etiquetas/imprimir?ids=${comCps.map((c) => c.id).join(',')}`)}>
            Só as etiquetas
          </button>
        </div>
        <span className="small muted">O sistema lembra a próxima etiqueta livre da folha adesiva deste computador; confira na tela de impressão.</span>
      </div>

      <div className="card tabela-caixa">
        {!cargas ? (
          <p className="muted">Carregando…</p>
        ) : cargas.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nenhuma carga em {diaCurto(dia)}.</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input type="checkbox" aria-label="Marcar todas" checked={todas} onChange={() => setSel(todas ? new Set() : new Set(cargas.map((c) => c.id)))} />
                </th>
                <th>Nº</th>
                <th>Saída</th>
                <th>Traço</th>
                <th style={{ textAlign: 'right' }}>Volume</th>
                <th>Cliente e obra</th>
                <th>Betoneira</th>
                <th>CPs</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cargas.map((c) => (
                <tr key={c.id} style={c.status === 'cancelada' ? { opacity: 0.55 } : undefined}>
                  <td><input type="checkbox" aria-label={`Marcar carga ${c.numero}`} checked={sel.has(c.id)} onChange={() => alternar(c.id)} /></td>
                  <td className="mono">{c.numero}</td>
                  <td className="mono">{hora(c.dataHora)}</td>
                  <td className="mono">{c.tracoCodigo}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{formatarNumero(c.volume, 1)} m³</td>
                  <td>{c.clienteNome ?? '—'}{c.obra && <div className="small muted">{c.obra}</div>}</td>
                  <td className="mono">{c.betoneiraCodigo}</td>
                  <td>
                    {c.status === 'cancelada' ? (
                      <span className="selo selo-neutro">cancelada</span>
                    ) : c.amostraStatus === 'pendente' ? (
                      <span className="selo selo-aviso">a moldar na obra</span>
                    ) : c.amostraStatus === 'moldada' ? (
                      <span className="selo selo-aviso">a receber no lab.</span>
                    ) : c.amostraStatus === 'ativa' ? (
                      <span className="selo selo-ok">no laboratório</span>
                    ) : (
                      <span className="selo selo-neutro">não amostrada</span>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <Link className="btn btn-link" to={`/prod/kit?ids=${c.id}`}>Romaneio e etiquetas</Link>
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

// ---------------------------------------------------------------- romaneio
type Romaneio = {
  id: string; numero: number; dataHora: string; status: string; motivoCancelamento: string | null; volume: number; documento: string | null; observacoes: string | null;
  cliente: { nome: string; razao: string; documento: string | null; telefone: string | null } | null; obra: string | null; endereco: string | null; contato: string | null;
  vendaNumero: number | null; cargaFinal: boolean; traco: { codigo: string; descricao: string | null; fck: number | null; slump: string | null; brita: string | null };
  betoneira: string; placa: string | null; motorista: string | null; bomba: string | null; operadorBomba: string | null; volumeBombeado: number | null; registradoPor: string | null;
  composicao: { nome: string; tipo: string; unidade: string; quantidade: number }[]; aguaCentral: number; aditivos: string[];
  cps: { idade: number; quantidade: number }[];
};

function Campo({ rotulo, children, largo }: { rotulo: string; children?: ReactNode; largo?: boolean }) {
  return (
    <div className={`rc ${largo ? 'rc-largo' : ''}`}>
      <span className="rc-rot">{rotulo}</span>
      <span className="rc-val">{children ?? <span className="rc-linha" />}</span>
    </div>
  );
}

function Via({ r, via }: { r: Romaneio; via: string }) {
  const { empresa } = useSessao();
  const limite = new Date(new Date(r.dataHora).getTime() + 150 * 60_000).toISOString();
  const url = `${window.location.origin}/qual/rastreabilidade/${r.id}`;
  const qtd = (n: number, u: string) => `${formatarNumero(n, n < 100 && !Number.isInteger(n) ? 1 : 0)} ${UN[u] ?? u}`;
  return (
    <section className="via">
      {r.status === 'cancelada' && <div className="via-cancelada">CARGA CANCELADA</div>}
      <header className="via-topo">
        <div className="via-empresa">
          {empresa?.temLogo ? (
            <img src={`/api/empresa/logo?v=${empresa.logoVersao ?? 0}`} alt="" />
          ) : null}
          <div>
            <b>{empresa?.nomeFantasia || empresa?.razaoSocial}</b>
            <span>{empresa?.razaoSocial}{empresa?.cnpj ? ` · CNPJ ${formatarCnpj(empresa.cnpj)}` : ''}</span>
            <span>{[empresa?.telefone, empresa?.cidade && `${empresa.cidade}${empresa.uf ? `/${empresa.uf}` : ''}`].filter(Boolean).join(' · ')}</span>
          </div>
        </div>
        <div className="via-titulo">
          <span>Documento de entrega de concreto · NBR 7212</span>
          <b>Nº {r.numero}</b>
          <span>{dataBr(r.dataHora)} · {via}</span>
        </div>
        <Qr texto={url} mm={19} />
      </header>

      <div className="via-grade g3">
        <Campo rotulo="Cliente">
          <b>{r.cliente?.nome ?? '—'}</b>
          {r.cliente?.documento && <> · {formatarDocumento(r.cliente.documento)}</>}
          {r.cliente?.telefone && <> · {r.cliente.telefone}</>}
        </Campo>
        <Campo rotulo="Obra e endereço">
          {[r.obra, r.endereco].filter(Boolean).join(' · ') || '—'}
          {r.contato && <> · Contato: {r.contato}</>}
        </Campo>
        <Campo rotulo="Venda / remessa">
          {r.vendaNumero ? `Venda nº ${String(r.vendaNumero).padStart(4, '0')}` : 'Avulsa'}
          {r.documento && ` · ${r.documento}`}
          {r.cargaFinal && ' · carga final'}
        </Campo>
      </div>

      <div className="via-grade g6">
        <Campo rotulo="Traço"><b className="mono">{r.traco.codigo}</b></Campo>
        <Campo rotulo="fck">{r.traco.fck ? `${r.traco.fck} MPa` : '—'}</Campo>
        <Campo rotulo="Slump especificado">{r.traco.slump ? `${r.traco.slump} cm` : '—'}</Campo>
        <Campo rotulo="Agregado graúdo (Dmáx)">{r.traco.brita ?? '—'}</Campo>
        <Campo rotulo="Aditivo">{r.aditivos.join(', ') || 'Sem aditivo'}</Campo>
        <Campo rotulo="Volume"><b className="via-volume">{formatarNumero(r.volume, 1)} m³</b></Campo>
      </div>

      <div className="via-grade g3">
        <Campo rotulo="Betoneira e motorista"><span className="mono">{r.betoneira}</span>{r.placa ? ` · ${r.placa}` : ''}{r.motorista ? ` · ${r.motorista}` : ''}</Campo>
        <Campo rotulo="Bomba">{r.bomba ? <><span className="mono">{r.bomba}</span>{r.operadorBomba ? ` · ${r.operadorBomba}` : ''}</> : 'Sem bombeamento'}</Campo>
        <Campo rotulo="Emitido por">{r.registradoPor ?? '—'}</Campo>
      </div>

      <div className="via-grade g-comp">
        <Campo rotulo="Composição da carga" largo>
          {r.composicao.map((c) => `${c.nome} ${qtd(c.quantidade, c.unidade)}`).join(' · ') || '—'}
        </Campo>
        <Campo rotulo="Água na central"><b>{formatarNumero(r.aguaCentral, 0)} L</b></Campo>
        <Campo rotulo="Água máx. na obra">______ L</Campo>
      </div>

      <div className="via-grade g5 via-horas">
        <Campo rotulo="Carregamento (1ª água)"><b className="mono">{hora(r.dataHora)}</b></Campo>
        <Campo rotulo="Lançar até (150 min)"><b className="mono">{hora(limite)}</b></Campo>
        <Campo rotulo="Chegada na obra">__:__</Campo>
        <Campo rotulo="Início da descarga">__:__</Campo>
        <Campo rotulo="Fim da descarga">__:__</Campo>
      </div>

      <div className="via-grade g4">
        <Campo rotulo="Slump na obra">______ cm</Campo>
        <Campo rotulo="Água adicionada na obra">______ L</Campo>
        <Campo rotulo="Aditivo adicionado na obra">________</Campo>
        <Campo rotulo={r.cps.length ? `CPs a moldar (${r.cps.map((c) => `${c.quantidade} × ${c.idade} d`).join(' + ')})` : 'CPs moldados na obra'}>
          {r.cps.length ? <>moldados: ______ <span className="small">(etiquetas anexas)</span></> : '______'}
        </Campo>
      </div>
      <p className="via-aviso">
        Adição de água ou aditivo na obra a pedido do contratante: registrar acima e assinar. Nesse caso a concreteira fica isenta de responsabilidade pelas características do concreto (NBR 7212).
        <span className="via-ass-curta">Ass. do contratante: ____________________</span>
      </p>
      {r.observacoes && <p className="via-obs"><b>Obs.:</b> {r.observacoes}</p>}

      <div className="via-grade g-ass">
        <Campo rotulo="Recebido por (nome)" />
        <Campo rotulo="Documento" />
        <Campo rotulo="Assinatura do recebedor" />
        <Campo rotulo="Assinatura do motorista" />
      </div>
      <footer className="via-rodape">
        Transporte em caminhão-betoneira: até 120 min · lançamento e adensamento: até 150 min da 1ª adição de água · temperatura do concreto no lançamento: 5 °C a 32 °C.
        Documento técnico de entrega; não substitui a NF-e / nota de remessa.
      </footer>
    </section>
  );
}

export function ImprimirRomaneios() {
  const [busca] = useSearchParams();
  const navegar = useNavigate();
  const [lista, setLista] = useState<Romaneio[] | null>(null);
  const [erro, setErro] = useState('');
  usePaginaA4('0');
  useEffect(() => {
    api<{ romaneios: Romaneio[] }>(`/prod/romaneios?ids=${busca.get('ids') ?? ''}`).then((r) => setLista(r.romaneios)).catch((e) => setErro((e as Error).message));
  }, [busca]);
  return (
    <>
      <div className="cabecalho nao-imprimir">
        <div className="titulo">
          <h1>Romaneios</h1>
          <span className="muted">{lista ? `${lista.length} carga(s) · uma folha A4 por carga, com a via do cliente e a via da concreteira.` : 'Carregando…'}</span>
        </div>
        <div className="acoes">
          <button className="btn btn-primario" type="button" disabled={!lista?.length} onClick={() => imprimirParte('romaneio', () => marcarImpressos(lista!.map((r) => r.id), 'romaneio'))}>Imprimir</button>
          <button className="btn btn-secundario" type="button" onClick={() => navegar(-1)}>Voltar</button>
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div className="folhas-impressao secao-romaneio">
        {lista?.map((r) => (
          <div key={r.id} className="folha folha-romaneio">
            <Via r={r} via="Via do cliente" />
            <div className="corte" aria-hidden="true"><span>✂ corte aqui</span></div>
            <Via r={r} via="Via da concreteira" />
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- etiquetas
type Etiqueta = {
  id: string; codigo: string; cargaId: string; cargaNumero: number; idade: number; cp: number; dataMoldagem: string; dataPrevista: string;
  tracoCodigo: string; fck: number | null; clienteNome: string | null; obra: string | null;
};
type RespEtiquetas = { etiquetas: Etiqueta[]; semEtiqueta: { numero: number; status: string }[] };

const POR_FOLHA = 24; // 3 colunas × 8 linhas, 70 × 37 mm
const CHAVE_POSICAO = 'agrega.etiquetas.proxima';

/** Próxima etiqueta livre da folha adesiva que está na impressora deste computador. */
function usePosicaoEtiqueta(inicial?: number): [number, (n: number) => void, (usadas: number) => void] {
  const ler = () => {
    try {
      return Math.min(POR_FOLHA, Math.max(1, Number(localStorage.getItem(CHAVE_POSICAO)) || 1));
    } catch {
      return 1;
    }
  };
  const [pos, setPos] = useState(inicial && inicial >= 1 && inicial <= POR_FOLHA ? inicial : ler());
  const gravar = (n: number) => {
    setPos(n);
    try {
      localStorage.setItem(CHAVE_POSICAO, String(n));
    } catch {
      /* sem armazenamento: só vale nesta tela */
    }
  };
  const avancar = (usadas: number) => gravar(((pos - 1 + usadas) % POR_FOLHA) + 1);
  return [pos, gravar, avancar];
}

function SeletorPosicao({ valor, aoMudar }: { valor: number; aoMudar: (n: number) => void }) {
  return (
    <label className="small">
      próxima etiqueta livre da folha{' '}
      <select value={valor} onChange={(e) => aoMudar(Number(e.target.value))}>
        {Array.from({ length: POR_FOLHA }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
    </label>
  );
}

function FolhasEtiquetas({ etiquetas, inicio }: { etiquetas: Etiqueta[]; inicio: number }) {
  const origem = window.location.origin;
  const folhas = useMemo(() => {
    const cel: (Etiqueta | null)[] = [...Array(inicio - 1).fill(null), ...etiquetas];
    const out: (Etiqueta | null)[][] = [];
    for (let i = 0; i < cel.length; i += POR_FOLHA) out.push(cel.slice(i, i + POR_FOLHA));
    return out;
  }, [etiquetas, inicio]);
  return (
    <>
      {folhas.map((f, k) => (
        <div key={k} className="folha folha-etiquetas">
          {Array.from({ length: POR_FOLHA }, (_, i) => f[i] ?? null).map((e, i) =>
            e ? (
              <div key={i} className="etiqueta-cp">
                <Qr texto={`${origem}/qual/cps?cp=${e.codigo}`} mm={23} />
                <div className="et-txt">
                  <b className="et-cod">{e.codigo}</b>
                  <span><b>{e.tracoCodigo}</b>{e.fck ? ` · fck ${e.fck}` : ''}</span>
                  <span>Carga {e.cargaNumero} · {dataCurta(agoraLocal(new Date(e.dataMoldagem)))}</span>
                  <span><b>Romper {e.idade}d: {dataCurta(e.dataPrevista)}</b></span>
                  <span className="et-cli">{[e.clienteNome, e.obra].filter(Boolean).join(' · ')}</span>
                </div>
              </div>
            ) : (
              <div key={i} className="etiqueta-cp vazia" />
            ),
          )}
        </div>
      ))}
    </>
  );
}

const textoSem = (s: { numero: number; status: string }) =>
  `carga ${s.numero} (${s.status === 'nao_amostrada' ? 'não amostrada' : s.status === 'cancelada' ? 'cancelada' : 'sem corpos de prova'})`;

/** Marca no sistema o que foi impresso (rastreabilidade). */
function marcarImpressos(ids: string[], tipo: 'romaneio' | 'etiquetas') {
  if (ids.length) api('/prod/impressos', { corpo: { ids, tipo } }).catch(() => {});
}

/** Imprime só uma parte da tela (romaneios ou etiquetas) e chama `depois` ao terminar. */
function imprimirParte(parte: 'romaneio' | 'etiquetas' | 'tudo', depois?: () => void) {
  document.documentElement.dataset.imprimir = parte;
  const fim = () => {
    window.removeEventListener('afterprint', fim);
    delete document.documentElement.dataset.imprimir;
    depois?.();
  };
  window.addEventListener('afterprint', fim);
  setTimeout(() => window.print(), 50);
}

export function ImprimirEtiquetas() {
  const [busca] = useSearchParams();
  const navegar = useNavigate();
  const [dados, setDados] = useState<RespEtiquetas | null>(null);
  const [erro, setErro] = useState('');
  const [pos, setPos, avancar] = usePosicaoEtiqueta(Number(busca.get('inicio')) || undefined);
  const ids = (busca.get('ids') ?? '').split(',').filter(Boolean);
  usePaginaA4('0');
  useEffect(() => {
    api<RespEtiquetas>(`/prod/etiquetas?ids=${busca.get('ids') ?? ''}`).then(setDados).catch((e) => setErro((e as Error).message));
  }, [busca]);

  return (
    <>
      <div className="cabecalho nao-imprimir">
        <div className="titulo">
          <h1>Etiquetas dos corpos de prova</h1>
          <span className="muted">
            {dados ? `${dados.etiquetas.length} etiqueta(s) · folha A4 de 24 etiquetas (3 × 8, 70 × 37 mm).` : 'Carregando…'} Use etiqueta sintética resistente à água: os CPs vão para o tanque de cura.
          </span>
        </div>
        <div className="acoes">
          <SeletorPosicao valor={pos} aoMudar={setPos} />
          <button className="btn btn-primario" type="button" disabled={!dados?.etiquetas.length} onClick={() => imprimirParte('etiquetas', () => { avancar(dados!.etiquetas.length); marcarImpressos(ids, 'etiquetas'); })}>
            Imprimir
          </button>
          <button className="btn btn-secundario" type="button" onClick={() => navegar(-1)}>Voltar</button>
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {dados && dados.semEtiqueta.length > 0 && <div className="alerta alerta-aviso nao-imprimir">Sem etiquetas: {dados.semEtiqueta.map(textoSem).join(', ')}.</div>}
      <div className="folhas-impressao secao-etiquetas">{dados && <FolhasEtiquetas etiquetas={dados.etiquetas} inicio={pos} />}</div>
    </>
  );
}

/**
 * Kit da carga para o motorista: romaneio (papel comum, 2 vias) e etiquetas dos CPs (folha adesiva).
 * Duas impressões na mesma tela, porque o papel é diferente; a posição da folha de etiquetas é lembrada.
 */
export function ImprimirKit() {
  const [busca] = useSearchParams();
  const navegar = useNavigate();
  const [lista, setLista] = useState<Romaneio[] | null>(null);
  const [et, setEt] = useState<RespEtiquetas | null>(null);
  const [erro, setErro] = useState('');
  const [feito, setFeito] = useState<{ romaneio: boolean; etiquetas: boolean }>({ romaneio: false, etiquetas: false });
  const [pos, setPos, avancar] = usePosicaoEtiqueta();
  const ids = (busca.get('ids') ?? '').split(',').filter(Boolean);
  usePaginaA4('0');
  useEffect(() => {
    const q = busca.get('ids') ?? '';
    api<{ romaneios: Romaneio[] }>(`/prod/romaneios?ids=${q}`).then((r) => setLista(r.romaneios)).catch((e) => setErro((e as Error).message));
    api<RespEtiquetas>(`/prod/etiquetas?ids=${q}`).then(setEt).catch(() => setEt({ etiquetas: [], semEtiqueta: [] }));
  }, [busca]);
  const n = et?.etiquetas.length ?? 0;

  return (
    <>
      <div className="cabecalho nao-imprimir">
        <div className="titulo">
          <h1>Romaneio e etiquetas para o motorista</h1>
          <span className="muted">
            {lista ? `${lista.length} carga(s)` : 'Carregando…'}
            {et ? ` · ${n} etiqueta(s) de CP` : ''}. O motorista leva o romaneio e as etiquetas para moldar os CPs na obra.
          </span>
        </div>
        <button className="btn btn-secundario" type="button" onClick={() => navegar(-1)}>Voltar</button>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div className="card passos-kit nao-imprimir">
        <div className={`passo-kit ${feito.romaneio ? 'feito' : ''}`}>
          <b>1. Romaneio</b>
          <span className="small muted">Papel A4 comum · {lista?.length ?? 0} folha(s), 2 vias cada</span>
          <button className="btn btn-primario" type="button" disabled={!lista?.length} onClick={() => imprimirParte('romaneio', () => { setFeito((f) => ({ ...f, romaneio: true })); marcarImpressos(ids, 'romaneio'); })}>
            {feito.romaneio ? 'Imprimir de novo' : 'Imprimir romaneio'}
          </button>
        </div>
        <div className={`passo-kit ${feito.etiquetas ? 'feito' : ''}`}>
          <b>2. Etiquetas dos CPs</b>
          <span className="small muted">Coloque a folha adesiva (3 × 8) · {n} etiqueta(s), a partir da nº {pos}</span>
          <SeletorPosicao valor={pos} aoMudar={setPos} />
          <button className="btn btn-primario" type="button" disabled={!n} onClick={() => imprimirParte('etiquetas', () => { setFeito((f) => ({ ...f, etiquetas: true })); avancar(n); marcarImpressos(ids, 'etiquetas'); })}>
            {feito.etiquetas ? 'Imprimir de novo' : 'Imprimir etiquetas'}
          </button>
        </div>
        {et && et.semEtiqueta.length > 0 && <span className="small muted">Sem etiquetas: {et.semEtiqueta.map(textoSem).join(', ')}.</span>}
      </div>
      <div className="folhas-impressao secao-romaneio">
        {lista?.map((r) => (
          <div key={r.id} className="folha folha-romaneio">
            <Via r={r} via="Via do cliente" />
            <div className="corte" aria-hidden="true"><span>✂ corte aqui</span></div>
            <Via r={r} via="Via da concreteira" />
          </div>
        ))}
      </div>
      <div className="folhas-impressao secao-etiquetas">{et && n > 0 && <FolhasEtiquetas etiquetas={et.etiquetas} inicio={pos} />}</div>
    </>
  );
}
