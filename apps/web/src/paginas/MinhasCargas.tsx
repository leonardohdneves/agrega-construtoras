// App do motorista: cargas registradas para ele na central, etapas da viagem e slump medido na obra.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { agoraLocal, api, formatarNumero, lerNumero } from '../api';

type MinhaCarga = {
  id: string; numero: number; dataHora: string; tracoCodigo: string; slumpTraco: string | null; volume: number; clienteNome: string | null; clienteTelefone: string | null;
  obra: string | null; endereco: string | null; contato: string | null; observacoes: string | null; betoneiraCodigo: string; bombaCodigo: string | null;
  vendaNumero: number | null; saidaEm: string | null; chegadaEm: string | null; descargaEm: string | null; slumpEntrega: number | null; devolvido: number; obsMotorista: string | null;
  amostraStatus: string | null; cpsPrevistos: number; cpsMoldados: number | null;
};

const hora = (iso: string | null) => (iso ? agoraLocal(new Date(iso)).slice(11, 16) : '—');
const m3 = (n: number) => `${formatarNumero(n, Number.isInteger(n) ? 0 : 1)} m³`;

function Etapas({ c }: { c: MinhaCarga }) {
  const passos: [string, string | null][] = [
    ['Carregada', c.dataHora],
    ['Saiu', c.saidaEm],
    ['Chegou', c.chegadaEm],
    ['Descarregou', c.descargaEm],
  ];
  return (
    <ol className="etapas-carga" aria-label="Etapas da viagem">
      {passos.map(([t, q]) => (
        <li key={t} className={q ? 'feita' : ''}>
          <span className="ponto" aria-hidden="true" />
          <span className="small">{t}</span>
          <span className="mono small">{hora(q)}</span>
        </li>
      ))}
    </ol>
  );
}

function CartaoCarga({ c, aoMudar }: { c: MinhaCarga; aoMudar: () => void }) {
  const [form, setForm] = useState<{ slump: string; devolvido: string; observacao: string; cps: string; semCps: boolean; motivo: string } | null>(null);
  const moldar = c.amostraStatus === 'pendente' && c.cpsPrevistos > 0;
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function etapa(e: 'saida' | 'chegada' | 'descarga', corpo: Record<string, unknown> = {}) {
    setErro('');
    setOcupado(true);
    try {
      await api(`/prod/minhas-cargas/${c.id}/etapa`, { corpo: { etapa: e, ...corpo } });
      setForm(null);
      aoMudar();
    } catch (err) {
      setErro((err as Error).message);
    }
    setOcupado(false);
  }

  function concluir(ev: FormEvent) {
    ev.preventDefault();
    if (!form) return;
    const slump = lerNumero(form.slump);
    if (slump === null) return setErro('Informe o slump medido na obra, em cm.');
    let cps: Record<string, unknown> = {};
    if (moldar) {
      if (form.semCps) {
        if (form.motivo.trim().length < 3) return setErro('Informe o motivo de não moldar os CPs.');
        cps = { cpsMoldados: 0, motivoSemCps: form.motivo };
      } else {
        const n = Number(form.cps);
        if (!Number.isInteger(n) || n <= 0) return setErro('Informe quantos CPs você moldou.');
        cps = { cpsMoldados: n };
      }
    }
    etapa('descarga', { slump, devolvido: form.devolvido.trim() ? lerNumero(form.devolvido) : 0, observacao: form.observacao, ...cps });
  }

  const pendente = !c.descargaEm;
  return (
    <article className={`card carga-motorista ${pendente ? 'em-andamento' : ''}`}>
      <div className="cartao-topo">
        <h2 style={{ margin: 0 }}>
          Carga nº {c.numero} <span className="small muted">· {hora(c.dataHora)}</span>
        </h2>
        <span className={`selo ${pendente ? 'selo-aviso' : 'selo-ok'}`}>{pendente ? (c.saidaEm ? 'Em viagem' : 'Na central') : 'Entregue'}</span>
      </div>
      <div className="carga-destino">
        <b>{c.clienteNome ?? 'Cliente não informado'}</b>
        {c.obra && <span>{c.obra}</span>}
        {c.endereco && <span className="muted">{c.endereco}</span>}
        {c.contato && <span className="muted">Contato: {c.contato}</span>}
      </div>
      <div className="carga-dados">
        <span><span className="muted small">Traço</span><b className="mono">{c.tracoCodigo}</b></span>
        <span><span className="muted small">Volume</span><b className="mono">{m3(c.volume)}</b></span>
        <span><span className="muted small">Betoneira</span><b className="mono">{c.betoneiraCodigo}</b></span>
        {c.slumpTraco && <span><span className="muted small">Slump do traço</span><b className="mono">{c.slumpTraco} cm</b></span>}
        {c.bombaCodigo && <span><span className="muted small">Bomba</span><b className="mono">{c.bombaCodigo}</b></span>}
      </div>
      {c.observacoes && <p className="small" style={{ margin: 0 }}>Obs.: {c.observacoes}</p>}
      {moldar && !c.descargaEm && (
        <div className="alerta alerta-info" style={{ margin: 0 }}>
          Moldar <b>{c.cpsPrevistos} corpos de prova</b> na obra. As etiquetas vão com o romaneio: cole uma em cada CP.
        </div>
      )}
      <Etapas c={c} />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {pendente ? (
        form ? (
          <form className="form" onSubmit={concluir}>
            <div className="campos">
              <div className="campo">
                <label htmlFor={`sl-${c.id}`}>Slump medido na obra (cm)</label>
                <input id={`sl-${c.id}`} className="mono" inputMode="decimal" autoFocus placeholder="ex.: 10" value={form.slump} onChange={(e) => setForm({ ...form, slump: e.target.value })} />
              </div>
              <div className="campo">
                <label htmlFor={`dv-${c.id}`}>Concreto que voltou (m³)</label>
                <input id={`dv-${c.id}`} className="mono" inputMode="decimal" placeholder="0" value={form.devolvido} onChange={(e) => setForm({ ...form, devolvido: e.target.value })} />
              </div>
            </div>
            {moldar && (
              <div className="caixa-destaque">
                {!form.semCps && (
                  <div className="campo" style={{ maxWidth: 220 }}>
                    <label htmlFor={`cp-${c.id}`}>CPs moldados na obra</label>
                    <input id={`cp-${c.id}`} className="mono" inputMode="numeric" value={form.cps} onChange={(e) => setForm({ ...form, cps: e.target.value.replace(/\D/g, '') })} />
                  </div>
                )}
                <label className="marcar">
                  <input type="checkbox" checked={form.semCps} onChange={(e) => setForm({ ...form, semCps: e.target.checked })} />
                  Não moldei os CPs
                </label>
                {form.semCps && (
                  <div className="campo">
                    <label htmlFor={`mt-${c.id}`}>Motivo</label>
                    <input id={`mt-${c.id}`} value={form.motivo} placeholder="ex.: cliente dispensou, sem moldes" onChange={(e) => setForm({ ...form, motivo: e.target.value })} />
                  </div>
                )}
              </div>
            )}
            <div className="campo">
              <label htmlFor={`ob-${c.id}`}>Observação</label>
              <input id={`ob-${c.id}`} value={form.observacao} placeholder="Opcional" onChange={(e) => setForm({ ...form, observacao: e.target.value })} />
            </div>
            <div className="acoes">
              <button className="btn btn-primario" type="submit" disabled={ocupado}>Concluir descarga</button>
              <button className="btn btn-link" type="button" onClick={() => setForm(null)}>Voltar</button>
            </div>
          </form>
        ) : (
          <div className="acoes">
            {!c.saidaEm && <button className="btn btn-primario" type="button" disabled={ocupado} onClick={() => etapa('saida')}>Saí da usina</button>}
            {c.saidaEm && !c.chegadaEm && <button className="btn btn-primario" type="button" disabled={ocupado} onClick={() => etapa('chegada')}>Cheguei na obra</button>}
            <button className={`btn ${c.chegadaEm ? 'btn-primario' : 'btn-secundario'}`} type="button" disabled={ocupado} onClick={() => setForm({ slump: '', devolvido: '', observacao: '', cps: String(c.cpsPrevistos || ''), semCps: false, motivo: '' })}>
              Descarga concluída
            </button>
          </div>
        )
      ) : (
        <p className="small" style={{ margin: 0 }}>
          Slump na obra: <b className="mono">{c.slumpEntrega === null ? '—' : `${formatarNumero(c.slumpEntrega, 1)} cm`}</b>
          {c.devolvido > 0 && <> · voltou <b className="mono">{m3(c.devolvido)}</b></>}
          {c.obsMotorista && <> · {c.obsMotorista}</>}
          {c.cpsMoldados !== null && <> · CPs moldados: <b className="mono">{c.cpsMoldados}</b></>}
        </p>
      )}
    </article>
  );
}

/** Cargas do motorista: as abertas primeiro. `compacta` mostra só as que ainda não foram descarregadas. */
export function MinhasCargas({ compacta = false }: { compacta?: boolean }) {
  const [cargas, setCargas] = useState<MinhaCarga[] | null>(null);
  const [erro, setErro] = useState('');
  const carregar = useCallback(() => {
    api<{ cargas: MinhaCarga[] }>('/prod/minhas-cargas').then((r) => setCargas(r.cargas)).catch((e) => setErro((e as Error).message));
  }, []);
  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 60_000);
    return () => clearInterval(t);
  }, [carregar]);
  if (erro) return compacta ? null : <div className="alerta alerta-aviso">{erro}</div>;
  if (!cargas) return compacta ? null : <p className="muted">Carregando…</p>;
  const lista = compacta ? cargas.filter((c) => !c.descargaEm) : cargas;
  if (compacta && !lista.length) return null;
  return (
    <section className="minhas-cargas">
      <h2>{compacta ? 'Sua carga na central' : 'Cargas de hoje'}</h2>
      {lista.length === 0 ? <p className="muted">Nenhuma carga registrada para você hoje.</p> : lista.map((c) => <CartaoCarga key={c.id} c={c} aoMudar={carregar} />)}
    </section>
  );
}

export function PaginaMinhasCargas() {
  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Minhas cargas</h1>
          <span className="muted">Registre a saída, a chegada e o slump medido na obra.</span>
        </div>
      </div>
      <MinhasCargas />
    </>
  );
}
