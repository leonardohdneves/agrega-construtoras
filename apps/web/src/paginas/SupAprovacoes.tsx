import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, formatarDataHora, formatarMoeda, lerNumero, moedaCampo } from '../api';
import type { Aprovacao, RegrasAprovacao } from '../componentes/Suprimentos';
import { useSessao } from '../sessao';

const CAMINHO_ACAO: Record<Aprovacao['tipo'], string> = { pedido: '/sup/pedidos', medicao: '/sup/medicoes', autorizacao: '/sup/autorizacoes' };

function useAprovacoes() {
  const [dados, setDados] = useState<{ itens: Aprovacao[]; regras: RegrasAprovacao } | null>(null);
  const [erro, setErro] = useState('');
  const carregar = useCallback(() => {
    api<{ itens: Aprovacao[]; regras: RegrasAprovacao }>('/sup/aprovacoes').then(setDados).catch((e) => setErro((e as Error).message));
  }, []);
  useEffect(carregar, [carregar]);
  return { dados, erro, carregar, setErro };
}

/** Lista de pendências com aprovar e reprovar ali mesmo. */
function ListaAprovacoes({ itens, aoMudar, compacta = false }: { itens: Aprovacao[]; aoMudar: () => void; compacta?: boolean }) {
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [reprovar, setReprovar] = useState<{ item: Aprovacao; motivo: string } | null>(null);
  const [erro, setErro] = useState('');

  async function agir(a: Aprovacao, acao: 'aprovar' | 'reprovar', motivo?: string) {
    setErro('');
    setOcupado(a.id);
    try {
      await api(`${CAMINHO_ACAO[a.tipo]}/${a.id}/${acao}`, { metodo: 'POST', corpo: motivo ? { motivo } : undefined });
      setReprovar(null);
      aoMudar();
    } catch (e) {
      setErro((e as Error).message);
    }
    setOcupado(null);
  }

  if (!itens.length) return <p className="muted" style={{ margin: 0 }}>Nada aguardando aprovação.</p>;
  return (
    <>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <ul className="lista-aprovacoes">
        {itens.map((a) => (
          <li key={`${a.tipo}-${a.id}`}>
            <div className="aprov-texto">
              <Link to={a.link}><b>{a.titulo}</b></Link> · {a.pessoa}
              <span className="mono aprov-valor">{formatarMoeda(a.valor)}</span>
              {!compacta && a.resumo && <div className="small muted">{a.resumo}</div>}
              <div className="small muted">
                {a.criadoPor ? `por ${a.criadoPor} · ` : ''}enviado {formatarDataHora(a.enviadoEm)}
              </div>
            </div>
            {a.podeAprovar ? (
              reprovar?.item.id === a.id ? (
                <form
                  className="aprov-acoes"
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault();
                    agir(a, 'reprovar', reprovar.motivo);
                  }}
                >
                  <input aria-label="Motivo da reprovação" placeholder="Motivo" required minLength={3} maxLength={500} value={reprovar.motivo} onChange={(e) => setReprovar({ ...reprovar, motivo: e.target.value })} />
                  <button className="btn btn-perigo" type="submit" disabled={ocupado === a.id}>Reprovar</button>
                  <button className="btn btn-link" type="button" onClick={() => setReprovar(null)}>Voltar</button>
                </form>
              ) : (
                <div className="aprov-acoes">
                  <button className="btn btn-primario" type="button" disabled={ocupado === a.id} onClick={() => agir(a, 'aprovar')}>Aprovar</button>
                  <button className="btn btn-secundario" type="button" disabled={ocupado === a.id} onClick={() => setReprovar({ item: a, motivo: '' })}>Reprovar</button>
                </div>
              )
            ) : (
              <span className="small muted">aguardando quem tem alçada</span>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

/** Card do painel: o que espera aprovação de quem está olhando. */
export function CardAprovacoes() {
  const { dados, carregar } = useAprovacoes();
  if (!dados) return null;
  const minhas = dados.itens.filter((i) => i.podeAprovar);
  const total = minhas.reduce((s, i) => s + i.valor, 0);
  return (
    <section className="card cartao-aprovacoes">
      <div className="cartao-topo">
        <h2>
          Aprovações
          {minhas.length > 0 && <span className="selo selo-aviso" style={{ marginLeft: 8 }}>{minhas.length}</span>}
        </h2>
        <Link to="/sup/aprovacoes" className="small">Ver todas</Link>
      </div>
      {minhas.length > 0 && <p className="small muted" style={{ marginTop: 0 }}>{formatarMoeda(total)} esperando sua decisão.</p>}
      <ListaAprovacoes itens={minhas.slice(0, 5)} aoMudar={carregar} compacta />
    </section>
  );
}

export function SupAprovacoes() {
  const { usuario } = useSessao();
  const { dados, erro, carregar } = useAprovacoes();
  const [regras, setRegras] = useState<{ adminAte: string; dispensaAte: string } | null>(null);
  const [msg, setMsg] = useState('');
  const [erroRegras, setErroRegras] = useState('');
  const dono = usuario?.perfil === 'dono';

  useEffect(() => {
    if (dados && !regras) setRegras({ adminAte: dados.regras.adminAte === null ? '' : moedaCampo(dados.regras.adminAte), dispensaAte: dados.regras.dispensaAte === null ? '' : moedaCampo(dados.regras.dispensaAte) });
  }, [dados, regras]);

  async function salvarRegras(e: FormEvent) {
    e.preventDefault();
    if (!regras) return;
    setMsg('');
    setErroRegras('');
    try {
      await api('/sup/config', { metodo: 'PUT', corpo: { adminAte: regras.adminAte.trim() ? lerNumero(regras.adminAte) : null, dispensaAte: regras.dispensaAte.trim() ? lerNumero(regras.dispensaAte) : null } });
      setMsg('Regras salvas.');
      carregar();
    } catch (err) {
      setErroRegras((err as Error).message);
    }
  }

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Aprovações</h1>
          <span className="muted">{dados?.regras.texto ?? 'Pedidos de compra, medições e pagamentos que esperam aprovação.'}</span>
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div className="card">
        {!dados ? <p className="muted">Carregando…</p> : <ListaAprovacoes itens={dados.itens} aoMudar={carregar} />}
      </div>

      <form className="card form" onSubmit={salvarRegras}>
        <h2>Regras de aprovação</h2>
        <span className="small muted">
          Padrão: o dono aprova tudo. Você pode deixar administradores aprovarem até um valor e dispensar a aprovação de valores pequenos. Quem pode aprovar já aprova ao enviar.
          {!dono && ' Só o dono muda estas regras.'}
        </span>
        {erroRegras && <div className="alerta alerta-erro" role="alert">{erroRegras}</div>}
        {msg && <div className="alerta alerta-ok" role="status">{msg}</div>}
        {regras && (
          <fieldset disabled={!dono} style={{ border: 0, padding: 0, margin: 0 }}>
            <div className="campos">
              <div className="campo">
                <label htmlFor="rg-admin">Administradores aprovam até (R$)</label>
                <input id="rg-admin" className="mono" inputMode="decimal" value={regras.adminAte} onChange={(e) => setRegras({ ...regras, adminAte: e.target.value })} placeholder="Vazio = só o dono" />
              </div>
              <div className="campo">
                <label htmlFor="rg-disp">Dispensa de aprovação até (R$)</label>
                <input id="rg-disp" className="mono" inputMode="decimal" value={regras.dispensaAte} onChange={(e) => setRegras({ ...regras, dispensaAte: e.target.value })} placeholder="Vazio = sempre aprova" />
              </div>
            </div>
            {dono && (
              <div className="acoes">
                <button className="btn btn-primario" type="submit">Salvar regras</button>
              </div>
            )}
          </fieldset>
        )}
      </form>
    </>
  );
}
