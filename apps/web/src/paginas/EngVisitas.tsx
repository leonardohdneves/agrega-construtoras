// Acompanhamento por visitas: obra em que a construtora só visita e orienta. No celular o engenheiro abre a visita,
// tira as fotos com a câmera e escreve as anotações. O relatório da visita sai em PDF (Imprimir › Salvar em PDF),
// com a logo e as cores da empresa, para enviar ao cliente.
import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, formatarData, formatarDataHora, formatarCnpj, type TEmpresa } from '../api';
import { AssinaturaPad } from '../componentes/AssinaturaPad';
import { OpcoesPagina, imprimirPagina, usePaginaImpressao } from '../componentes/Documento';
import { comprimirImagem } from '../lib/comprimirFoto';

type ObraVisitas = { id: string; codigo: string; nome: string; cidade: string | null; uf: string | null; status: string; visitas: number; ultimaVisita: string | null };
type Visita = { id: string; numero: number; data: string; responsavel: string | null; observacoes: string | null; fotos: number };
type FotoVisita = { id: string; legenda: string | null; ordem: number };
type Assinatura = { papel: 'responsavel' | 'dono_obra'; nome: string; imagem: string; codigo: string; assinado_em: string };

type VisitaCompleta = {
  visita: { id: string; numero: number; data: string; responsavel: string | null; observacoes: string | null; fotos: FotoVisita[]; assinaturas: Assinatura[] };
  obra: { id: string; codigo: string; nome: string; endereco: string | null; cidade: string | null; uf: string | null; responsavel: string | null };
};

const base = (obraId: string, visitaId?: string) => `/eng/visitas/${obraId}${visitaId ? `/${visitaId}` : ''}`;
/** Caminho da API (sem o prefixo /api, que o cliente já põe). */
const apiBase = (obraId: string, visitaId?: string) => `/eng/obras/${obraId}/visitas${visitaId ? `/${visitaId}` : ''}`;

/** Lista das obras de acompanhamento (o engenheiro vê só as que foram atribuídas a ele). */
export function EngVisitasObras() {
  const [obras, setObras] = useState<ObraVisitas[] | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    api<{ obras: ObraVisitas[] }>('/eng/acompanhamento/obras').then((r) => setObras(r.obras)).catch((e) => setErro((e as Error).message));
  }, []);

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Acompanhamento por visitas</h1>
          <span className="muted">Obras em que você visita e orienta. Cada visita tem fotos, anotações e relatório em PDF.</span>
        </div>
        <div className="acoes nao-imprimir">
          <Link className="btn btn-primario" to="/eng/obras/nova">Nova obra de acompanhamento</Link>
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {!obras && !erro && <p className="muted">Carregando…</p>}
      {obras && obras.length === 0 && (
        <div className="card"><p className="muted" style={{ margin: 0 }}>Nenhuma obra de acompanhamento. Ao cadastrar uma obra, escolha o tipo “Acompanhamento por visitas”.</p></div>
      )}
      {obras && obras.length > 0 && (
        <div className="visitas-lista">
          {obras.map((o) => (
            <Link key={o.id} to={base(o.id)} className="card visitas-obra">
              <b>{o.codigo} · {o.nome}</b>
              <span className="small muted">{[o.cidade, o.uf].filter(Boolean).join('/') || 'Sem cidade'}</span>
              <span className="small">{o.visitas} {o.visitas === 1 ? 'visita' : 'visitas'}{o.ultimaVisita ? ` · última em ${formatarData(o.ultimaVisita)}` : ''}</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

/** Visitas de uma obra: a mais recente primeiro. */
export function EngVisitasObra() {
  const { obraId } = useParams();
  const navegar = useNavigate();
  const [visitas, setVisitas] = useState<Visita[] | null>(null);
  const [obra, setObra] = useState<ObraVisitas | null>(null);
  const [erro, setErro] = useState('');
  const [criando, setCriando] = useState(false);

  useEffect(() => {
    api<{ obras: ObraVisitas[] }>('/eng/acompanhamento/obras')
      .then((r) => setObra(r.obras.find((o) => o.id === obraId) ?? null))
      .catch(() => undefined);
    api<{ visitas: Visita[] }>(`${apiBase(obraId!)}`).then((r) => setVisitas(r.visitas)).catch((e) => setErro((e as Error).message));
  }, [obraId]);

  async function novaVisita() {
    setErro('');
    setCriando(true);
    try {
      const r = await api<{ id: string }>(`${apiBase(obraId!)}`, { metodo: 'POST', corpo: {} });
      navegar(`/eng/visitas/${obraId}/${r.id}`);
    } catch (e) {
      setErro((e as Error).message);
      setCriando(false);
    }
  }

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>{obra ? `${obra.codigo} · ${obra.nome}` : 'Visitas'}</h1>
          <span className="muted">Obra de acompanhamento · sem EAP, orçamento, planejamento ou estoque</span>
        </div>
        <div className="acoes nao-imprimir">
          <Link className="btn" to="/eng/visitas">Todas as obras</Link>
          <button className="btn btn-primario" type="button" disabled={criando} onClick={() => void novaVisita()}>
            {criando ? 'Criando…' : 'Nova visita'}
          </button>
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {!visitas && !erro && <p className="muted">Carregando…</p>}
      {visitas && visitas.length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>Nenhuma visita registrada. Toque em “Nova visita” quando estiver na obra.</p></div>}
      {visitas && visitas.length > 0 && (
        <div className="visitas-lista">
          {visitas.map((v) => (
            <Link key={v.id} to={`/eng/visitas/${obraId}/${v.id}`} className="card visitas-obra">
              <b>Visita nº {v.numero} · {formatarData(v.data)}</b>
              <span className="small muted">{v.responsavel ?? 'Sem responsável informado'} · {v.fotos} {v.fotos === 1 ? 'foto' : 'fotos'}</span>
              {v.observacoes && <span className="small visitas-trecho">{v.observacoes}</span>}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

/** Uma visita: data, responsável, anotações e fotos. Pensada para o celular (câmera direto do campo). */
export function EngVisitaDetalhe() {
  const { obraId, visitaId } = useParams();
  const navegar = useNavigate();
  const [dados, setDados] = useState<VisitaCompleta | null>(null);
  const [data, setData] = useState('');
  const [responsavel, setResponsavel] = useState('');
  // Responsável como está salvo no banco: é o que sai no relatório.
  const [responsavelSalvo, setResponsavelSalvo] = useState('');
  const [linkDono, setLinkDono] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [enviandoFotos, setEnviandoFotos] = useState(false);

  const urlFoto = (fotoId: string) => `/api${apiBase(obraId!, visitaId!)}/fotos/${fotoId}`;

  function carregar() {
    return api<VisitaCompleta>(`${apiBase(obraId!, visitaId!)}`)
      .then((r) => {
        setDados(r);
        setData(r.visita.data);
        setResponsavel(r.visita.responsavel ?? '');
        setResponsavelSalvo(r.visita.responsavel ?? '');
        setObservacoes(r.visita.observacoes ?? '');
        setErro('');
      })
      .catch((e) => setErro((e as Error).message));
  }
  useEffect(() => {
    void carregar();
  }, [obraId, visitaId]);

  /** Assinatura do responsável, desenhada na tela. Se o nome digitado ainda não foi salvo, salva a visita antes. */
  async function assinarResponsavel(imagem: string) {
    const nome = responsavel.trim();
    if (nome.length < 3) {
      setErro('Digite o nome do responsável pela visita antes de assinar.');
      return;
    }
    setErro('');
    setAviso('');
    try {
      if (nome !== responsavelSalvo.trim()) {
        await api(`${apiBase(obraId!, visitaId!)}`, { metodo: 'PUT', corpo: { data, responsavel: nome, observacoes: observacoes.trim() || null } });
      }
      await api(`${apiBase(obraId!, visitaId!)}/assinaturas`, { metodo: 'POST', corpo: { nome, imagem } });
      setAviso('Assinatura do responsável registrada.');
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  /** Link para o dono da obra assinar a visita sem login. */
  async function gerarLinkDono() {
    setErro('');
    try {
      const r = await api<{ caminho: string }>(`${apiBase(obraId!, visitaId!)}/link-assinatura`, { metodo: 'POST', corpo: {} });
      setLinkDono(`${window.location.origin}${r.caminho}`);
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setErro('');
    setAviso('');
    try {
      await api(`${apiBase(obraId!, visitaId!)}`, { metodo: 'PUT', corpo: { data, responsavel: responsavel.trim() || null, observacoes: observacoes.trim() || null } });
      setAviso('Visita salva.');
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  async function enviarFotos(lista: FileList | null, entrada: HTMLInputElement) {
    if (!lista?.length) return;
    setEnviandoFotos(true);
    setErro('');
    setAviso('');
    let enviadas = 0;
    try {
      for (const arquivo of Array.from(lista)) {
        const { imagem, tipo } = await comprimirImagem(arquivo);
        await api(`${apiBase(obraId!, visitaId!)}/fotos`, { metodo: 'POST', corpo: { imagem, tipo, legenda: null } });
        enviadas += 1;
      }
    } catch (err) {
      setErro(`${(err as Error).message}${enviadas ? ` (${enviadas} ${enviadas === 1 ? 'foto enviada' : 'fotos enviadas'} antes do erro)` : ''}`);
    } finally {
      setEnviandoFotos(false);
      entrada.value = '';
      await carregar();
    }
  }

  async function legendaFoto(fotoId: string, legenda: string) {
    const atual = dados?.visita.fotos.find((f) => f.id === fotoId)?.legenda ?? '';
    if (legenda.trim() === atual) return;
    try {
      await api(`${apiBase(obraId!, visitaId!)}/fotos/${fotoId}`, { metodo: 'PUT', corpo: { legenda: legenda.trim() || null } });
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  async function excluirFoto(fotoId: string) {
    if (!window.confirm('Excluir esta foto?')) return;
    try {
      await api(`${apiBase(obraId!, visitaId!)}/fotos/${fotoId}`, { metodo: 'DELETE' });
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  async function excluirVisita() {
    if (!window.confirm('Excluir esta visita, com as fotos e anotações? Isso não pode ser desfeito.')) return;
    try {
      await api(`${apiBase(obraId!, visitaId!)}`, { metodo: 'DELETE' });
      navegar(`/eng/visitas/${obraId}`);
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  if (!dados) return erro ? <div className="alerta alerta-erro" role="alert">{erro}</div> : <p className="muted">Carregando…</p>;
  const { visita, obra } = dados;

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Visita nº {visita.numero} · {obra.codigo}</h1>
          <span className="muted">{obra.nome}</span>
        </div>
        <div className="acoes nao-imprimir">
          <Link className="btn" to={`/eng/visitas/${obraId}`}>Visitas da obra</Link>
          <Link className="btn btn-primario" to={`/eng/visitas/${obraId}/${visitaId}/relatorio`}>Relatório em PDF</Link>
        </div>
        {responsavel.trim() !== responsavelSalvo.trim() && (
          <div className="alerta alerta-aviso nao-imprimir" role="status" style={{ marginTop: 8 }}>
            O responsável pela visita foi alterado e ainda não está salvo. Clique em Salvar visita antes de abrir o relatório, senão ele sai sem o nome.
          </div>
        )}
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}

      <form className="card form" onSubmit={salvar}>
        <h2>Dados da visita</h2>
        <div className="visitas-campos">
          <div className="campo">
            <label htmlFor="vis-data">Data da visita</label>
            <input id="vis-data" type="date" value={data} onChange={(e) => setData(e.target.value)} required />
          </div>
          <div className="campo">
            <label htmlFor="vis-responsavel">Responsável pela visita</label>
            <input id="vis-responsavel" value={responsavel} onChange={(e) => setResponsavel(e.target.value)} placeholder="Nome do engenheiro" maxLength={120} />
          </div>
        </div>
        <div className="campo">
          <label htmlFor="vis-observacoes">Anotações e orientações</label>
          <textarea id="vis-observacoes" rows={8} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} maxLength={8000}
            placeholder="O que foi observado na obra, dúvidas tiradas, orientações dadas ao cliente e à equipe." />
        </div>
        <div className="acoes">
          <button className="btn btn-primario" type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar visita'}</button>
          <button className="btn btn-link" type="button" onClick={() => void excluirVisita()}>Excluir visita</button>
        </div>
      </form>

      <div className="card visitas-bloco" style={{ marginTop: 16 }}>
        <h2>Assinaturas</h2>
        <p className="small muted">Assine na tela do celular. Se o texto ou as fotos da visita mudarem depois, as assinaturas que ficarem desatualizadas são removidas.</p>
        <div style={{ display: 'grid', gap: 20, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ fontSize: 15 }}>Responsável pela visita</h3>
            {visita.assinaturas.find((a) => a.papel === 'responsavel') ? (
              (() => {
                const a = visita.assinaturas.find((x) => x.papel === 'responsavel')!;
                return (
                  <>
                    <img className="assinatura-img" src={a.imagem} alt={`Assinatura de ${a.nome}`} />
                    <p className="small muted">{a.nome} · {formatarDataHora(a.assinado_em)}</p>
                  </>
                );
              })()
            ) : (
              <>
                <p className="small muted">{responsavel.trim() ? `${responsavel.trim()} ainda não assinou.` : 'Digite o nome do responsável pela visita, no campo acima, para assinar.'}</p>
                {responsavel.trim().length >= 3 && <AssinaturaPad rotulo="Registrar assinatura do responsável" aoConfirmar={(img) => void assinarResponsavel(img)} />}
              </>
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ fontSize: 15 }}>Dono da obra</h3>
            {visita.assinaturas.find((a) => a.papel === 'dono_obra') ? (
              (() => {
                const a = visita.assinaturas.find((x) => x.papel === 'dono_obra')!;
                return (
                  <>
                    <img className="assinatura-img" src={a.imagem} alt={`Assinatura de ${a.nome}`} />
                    <p className="small muted">{a.nome} · {formatarDataHora(a.assinado_em)}</p>
                  </>
                );
              })()
            ) : (
              <>
                <p className="small muted">O dono assina pelo link, sem precisar de login.</p>
                <button className="btn" type="button" onClick={() => void gerarLinkDono()}>Gerar link para o dono assinar</button>
                {linkDono && (
                  <div className="campo" style={{ marginTop: 10 }}>
                    <label htmlFor="link-dono">Link para enviar ao dono da obra</label>
                    <input id="link-dono" readOnly value={linkDono} onFocus={(e) => e.currentTarget.select()} />
                    <span className="ajuda">Válido por 30 dias. Gerar um novo link substitui este.</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="card visitas-bloco" style={{ marginTop: 16 }}>
        <h2>Registro fotográfico <span className="small muted" style={{ fontWeight: 400 }}>· {visita.fotos.length} {visita.fotos.length === 1 ? 'foto' : 'fotos'}</span></h2>
        <p className="small muted">No celular, a câmera abre direto. As fotos são reduzidas antes do envio.</p>
        <div className="acoes">
          <label className="btn btn-primario" style={{ cursor: enviandoFotos ? 'progress' : 'pointer' }}>
            {enviandoFotos ? 'Enviando fotos…' : 'Tirar ou escolher fotos'}
            <input type="file" accept="image/*" capture="environment" multiple hidden disabled={enviandoFotos} onChange={(e) => void enviarFotos(e.target.files, e.target)} />
          </label>
        </div>
        {visita.fotos.length > 0 && (
          <div className="visitas-fotos">
            {visita.fotos.map((f, i) => (
              <figure key={f.id} className="visitas-foto">
                <img src={urlFoto(f.id)} alt={f.legenda || `Foto ${i + 1}`} loading="lazy" />
                <input aria-label={`Legenda da foto ${i + 1}`} defaultValue={f.legenda ?? ''} placeholder="Legenda (ex.: fissura no pilar P3)"
                  maxLength={200} onBlur={(e) => void legendaFoto(f.id, e.target.value)} />
                <button type="button" className="btn btn-link small" onClick={() => void excluirFoto(f.id)}>Excluir foto</button>
              </figure>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/** Relatório da visita para o cliente: logo, cores e dados da empresa; sai em PDF pela janela de impressão. */
export function EngVisitaRelatorio() {
  const { obraId, visitaId } = useParams();
  const [dados, setDados] = useState<VisitaCompleta | null>(null);
  const [empresa, setEmpresa] = useState<TEmpresa | null>(null);
  const [erro, setErro] = useState('');
  const [pagina, setPagina] = usePaginaImpressao();

  useEffect(() => {
    api<VisitaCompleta>(`${apiBase(obraId!, visitaId!)}`).then(setDados).catch((e) => setErro((e as Error).message));
    api<{ empresa: TEmpresa }>('/empresa').then((r) => setEmpresa(r.empresa)).catch(() => setEmpresa(null));
  }, [obraId, visitaId]);

  if (!dados) return erro ? <div className="alerta alerta-erro" role="alert">{erro}</div> : <p className="muted">Carregando…</p>;
  const { visita, obra } = dados;
  // Sem cores cadastradas, o relatório usa um padrão neutro.
  const cores = { '--cor-1': empresa?.corPrimaria || '#1f2937', '--cor-2': empresa?.corSecundaria || '#b45309' } as CSSProperties;
  const local = [obra.endereco, [obra.cidade, obra.uf].filter(Boolean).join('/')].filter(Boolean).join(' · ');
  const assinaturaResponsavel = visita.assinaturas.find((a) => a.papel === 'responsavel');
  const assinaturaDono = visita.assinaturas.find((a) => a.papel === 'dono_obra');
  const codigoVerificacao = visita.assinaturas[0]?.codigo ?? '';

  return (
    <>
      <div className="acoes nao-imprimir" style={{ alignItems: 'center' }}>
        <Link className="small" to={`/eng/visitas/${obraId}/${visitaId}`}>← Voltar à visita</Link>
        <OpcoesPagina valor={pagina} aoMudar={setPagina} />
        <button className="btn btn-primario" type="button" onClick={() => imprimirPagina(pagina)}>Imprimir / salvar em PDF</button>
      </div>
      {erro && <div className="alerta alerta-erro nao-imprimir" role="alert">{erro}</div>}

      <article className="rel-visita" style={cores}>
        <header className="rel-cabecalho">
          <div className="rel-empresa">
            {empresa?.temLogo && <img src={`/api/empresa/logo?v=${empresa.logoVersao ?? 0}`} alt="" />}
            <div>
              <b>{empresa?.nomeFantasia || empresa?.razaoSocial || ''}</b>
              {empresa?.cnpj && <span>CNPJ {formatarCnpj(empresa.cnpj)}</span>}
            </div>
          </div>
          <div className="rel-titulo">
            <span>Relatório de visita de acompanhamento</span>
            <b>Visita nº {visita.numero} · {formatarData(visita.data)}</b>
          </div>
        </header>

        <section className="rel-bloco">
          <h2>Obra</h2>
          <dl>
            <div><dt>Código</dt><dd>{obra.codigo}</dd></div>
            <div><dt>Obra</dt><dd>{obra.nome}</dd></div>
            {local && <div><dt>Local</dt><dd>{local}</dd></div>}
            {obra.responsavel && <div><dt>Responsável na obra</dt><dd>{obra.responsavel}</dd></div>}
            <div><dt>Responsável pela visita</dt><dd>{visita.responsavel || '—'}</dd></div>
          </dl>
        </section>

        <section className="rel-bloco">
          <h2>Observações e orientações</h2>
          <p className="rel-texto">{visita.observacoes || 'Sem observações registradas nesta visita.'}</p>
        </section>

        {visita.fotos.length > 0 && (
          <section className="rel-bloco">
            <h2>Registro fotográfico</h2>
            <div className="rel-fotos">
              {visita.fotos.map((f, i) => (
                <figure key={f.id}>
                  <img src={`/api${apiBase(obraId!, visitaId!)}/fotos/${f.id}`} alt={f.legenda || `Foto ${i + 1}`} />
                  <figcaption>Foto {i + 1}{f.legenda ? ` – ${f.legenda}` : ''}</figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}

        <section className="rel-assinaturas">
          <div>
            {assinaturaResponsavel && <img className="rel-assinatura-img" src={assinaturaResponsavel.imagem} alt={`Assinatura de ${assinaturaResponsavel.nome}`} />}
            <span className="rel-linha" />
            <b>{visita.responsavel || ' '}</b>
            <small>Responsável pela visita</small>
            {assinaturaResponsavel && <small>Assinado em {formatarDataHora(assinaturaResponsavel.assinado_em)}</small>}
          </div>
          <div>
            {assinaturaDono && <img className="rel-assinatura-img" src={assinaturaDono.imagem} alt={`Assinatura de ${assinaturaDono.nome}`} />}
            <span className="rel-linha" />
            <b>{assinaturaDono?.nome || ' '}</b>
            <small>Dono da obra</small>
            {assinaturaDono && <small>Assinado em {formatarDataHora(assinaturaDono.assinado_em)}</small>}
          </div>
        </section>

        <footer className="rel-rodape">
          <span>{empresa?.razaoSocial ?? ''}{empresa?.telefone ? ` · ${empresa.telefone}` : ''}{empresa?.email ? ` · ${empresa.email}` : ''}</span>
          <span>Obra {obra.codigo} · Visita nº {visita.numero}{codigoVerificacao ? ` · Código de verificação ${codigoVerificacao}` : ''}</span>
        </footer>
      </article>
    </>
  );
}
