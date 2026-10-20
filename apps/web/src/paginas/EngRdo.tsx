// Engenharia · Relatório Diário de Obra (RDO). Organização de referência: diário do Sienge
// (clima por período, mão de obra, equipamentos, atividades executadas, ocorrências, observações e assinatura).
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, formatarData } from '../api';
import { CabecalhoDocumento } from '../componentes/Documento';
import { Assinatura } from '../componentes/Suprimentos';

type Clima = 'bom' | 'nublado' | 'chuva' | 'impraticavel' | '';
const CLIMAS: [Clima, string][] = [['', '—'], ['bom', 'Bom'], ['nublado', 'Nublado'], ['chuva', 'Chuva'], ['impraticavel', 'Impraticável']];
const OCORRENCIAS: [string, string][] = [
  ['falta_material', 'Falta de material'],
  ['falta_mao_obra', 'Falta de mão de obra'],
  ['clima', 'Impedimento climático'],
  ['acidente', 'Acidente de trabalho'],
  ['paralisacao', 'Paralisação'],
  ['visita', 'Visita técnica / fiscalização'],
  ['outra', 'Outra'],
];
const ROTULO_CLIMA = Object.fromEntries(CLIMAS.map(([k, v]) => [k, v])) as Record<string, string>;
const ROTULO_OCORRENCIA = Object.fromEntries(OCORRENCIAS) as Record<string, string>;

type Obra = { id: string; codigo: string; nome: string };
type MaoObra = { funcao: string; empresa: string | null; quantidade: number; horas: number | null };
type Equipamento = { descricao: string; quantidade: number; horas: number | null };
type Atividade = { local: string | null; descricao: string; equipe: string | null; percentual: number | null };
type Ocorrencia = { tipo: string; descricao: string | null };
type Rdo = {
  id: string; numero: number; data: string; climaManha: Clima; climaTarde: Clima; climaNoite: Clima;
  responsavel: string | null; observacoes: string | null; maoDeObra: MaoObra[]; equipamentos: Equipamento[];
  atividades: Atividade[]; ocorrencias: Ocorrencia[];
};
type ResumoRdo = { id: string; numero: number; data: string; climaManha: Clima; climaTarde: Clima; climaNoite: Clima; responsavel: string | null; efetivo: number; ocorrencias: number };

const hojeIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const numero = (v: string) => (v === '' ? null : Number(v.replace(',', '.')));

/** Lista de obras: ponto de entrada do RDO no menu Engenharia. */
export function EngRdoObras() {
  const [obras, setObras] = useState<Obra[] | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    api<Obra[]>('/eng/obras').then(setObras).catch((e) => setErro(e.message));
  }, []);
  return (
    <>
      <CabecalhoDocumento modulo="Engenharia" titulo="Relatório Diário de Obra" descricao="Escolha a obra para ver e lançar os RDOs." />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {!obras ? (
        <p className="muted">Carregando…</p>
      ) : obras.length === 0 ? (
        <p className="muted">Nenhuma obra cadastrada.</p>
      ) : (
        <div className="card tabela-caixa">
          <table className="tabela">
            <thead><tr><th style={{ width: '18%' }}>Código</th><th>Obra</th></tr></thead>
            <tbody>
              {obras.map((o) => (
                <tr key={o.id}>
                  <td className="mono small">{o.codigo}</td>
                  <td><Link to={`/eng/rdo/${o.id}`}>{o.nome}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** RDOs de uma obra, com a criação de um novo RDO para uma data. */
export function EngRdoObra() {
  const { obraId = '' } = useParams();
  const navegar = useNavigate();
  const [dados, setDados] = useState<{ obra: Obra; rdos: ResumoRdo[] } | null>(null);
  const [data, setData] = useState(hojeIso());
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    api<{ obra: Obra; rdos: ResumoRdo[] }>(`/eng/obras/${obraId}/rdos`).then(setDados).catch((e) => setErro(e.message));
  }, [obraId]);

  async function criar(e: FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setErro('');
    try {
      const r = await api<{ id: string }>(`/eng/obras/${obraId}/rdos`, { metodo: 'POST', corpo: { data } });
      navegar(`/eng/rdo/${obraId}/${r.id}`);
    } catch (err) {
      setErro((err as Error).message);
      setOcupado(false);
    }
  }

  if (!dados) return erro ? <div className="alerta alerta-erro" role="alert">{erro}</div> : <p className="muted">Carregando…</p>;
  return (
    <>
      <div className="nao-imprimir"><Link to="/eng/rdo" className="small">← Obras</Link></div>
      <CabecalhoDocumento modulo="Engenharia" titulo="Relatório Diário de Obra" descricao={`Obra ${dados.obra.codigo} · ${dados.obra.nome}`} />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <form className="card form nao-imprimir" onSubmit={criar}>
        <h2>Novo RDO</h2>
        <div className="campos">
          <div className="campo">
            <label htmlFor="rdo-data">Data</label>
            <input id="rdo-data" type="date" value={data} onChange={(e) => setData(e.target.value)} required />
          </div>
        </div>
        <div className="acoes">
          <button className="btn btn-primario" type="submit" disabled={ocupado}>Criar RDO</button>
        </div>
      </form>
      <div className="card tabela-caixa">
        <h2>RDOs lançados <span className="small muted" style={{ fontWeight: 400 }}>· {dados.rdos.length}</span></h2>
        {dados.rdos.length === 0 ? (
          <p className="muted">Nenhum RDO lançado nesta obra.</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr>
                <th style={{ width: '8%' }}>Nº</th><th>Data</th><th>Clima (manhã / tarde / noite)</th>
                <th className="num">Efetivo</th><th className="num">Ocorrências</th><th>Responsável</th>
              </tr>
            </thead>
            <tbody>
              {dados.rdos.map((r) => (
                <tr key={r.id}>
                  <td className="mono"><Link to={`/eng/rdo/${obraId}/${r.id}`}>{r.numero}</Link></td>
                  <td>{formatarData(r.data)}</td>
                  <td>{[r.climaManha, r.climaTarde, r.climaNoite].map((c) => ROTULO_CLIMA[c ?? ''] || '—').join(' / ')}</td>
                  <td className="num">{r.efetivo}</td>
                  <td className="num">{r.ocorrencias}</td>
                  <td>{r.responsavel ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

const vazio = (): Rdo => ({
  id: '', numero: 0, data: hojeIso(), climaManha: '', climaTarde: '', climaNoite: '', responsavel: '', observacoes: '',
  maoDeObra: [], equipamentos: [], atividades: [], ocorrencias: [],
});

/** Um RDO: edição dos campos e visão para impressão (a tabela da impressão é a mesma informação, sem campos). */
export function EngRdoDetalhe() {
  const { obraId = '', rdoId = '' } = useParams();
  const navegar = useNavigate();
  const [obra, setObra] = useState<Obra | null>(null);
  const [r, setR] = useState<Rdo | null>(null);
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    api<{ obra: Obra; rdo: Rdo }>(`/eng/obras/${obraId}/rdos/${rdoId}`)
      .then((d) => { setObra(d.obra); setR(d.rdo); })
      .catch((e) => setErro(e.message));
  }, [obraId, rdoId]);

  const alterar = (campo: Partial<Rdo>) => setR((x) => (x ? { ...x, ...campo } : x));
  const linha = <T,>(lista: T[], i: number, novo: Partial<T>) => lista.map((x, j) => (j === i ? { ...x, ...novo } : x));
  const tirar = <T,>(lista: T[], i: number) => lista.filter((_, j) => j !== i);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!r) return;
    setOcupado(true);
    setErro('');
    setOk('');
    try {
      await api(`/eng/obras/${obraId}/rdos/${rdoId}`, {
        metodo: 'PUT',
        corpo: {
          data: r.data,
          climaManha: r.climaManha || null,
          climaTarde: r.climaTarde || null,
          climaNoite: r.climaNoite || null,
          responsavel: r.responsavel,
          observacoes: r.observacoes,
          maoDeObra: r.maoDeObra.filter((m) => m.funcao.trim()),
          equipamentos: r.equipamentos.filter((m) => m.descricao.trim()),
          atividades: r.atividades.filter((a) => a.descricao.trim()),
          ocorrencias: r.ocorrencias,
        },
      });
      setOk('RDO salvo.');
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  async function excluir() {
    if (!window.confirm('Excluir este RDO? Esta ação não pode ser desfeita.')) return;
    try {
      await api(`/eng/obras/${obraId}/rdos/${rdoId}`, { metodo: 'DELETE' });
      navegar(`/eng/rdo/${obraId}`);
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  if (!r || !obra) return erro ? <div className="alerta alerta-erro" role="alert">{erro}</div> : <p className="muted">Carregando…</p>;
  const titulo = `RDO nº ${r.numero} · ${formatarData(r.data)}`;

  return (
    <>
      <div className="nao-imprimir"><Link to={`/eng/rdo/${obraId}`} className="small">← RDOs da obra</Link></div>
      <CabecalhoDocumento
        modulo="Engenharia"
        titulo={`Relatório Diário de Obra · ${titulo}`}
        descricao={`Obra ${obra.codigo} · ${obra.nome}`}
        logoDireita
        acoes={null}
      />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {ok && <div className="alerta alerta-ok" role="status">{ok}</div>}

      <form className="form rdo-form" onSubmit={salvar}>
        <div className="card nao-imprimir">
          <h2>Dados gerais</h2>
          <div className="campos">
            <div className="campo">
              <label htmlFor="rdo-dt">Data</label>
              <input id="rdo-dt" type="date" value={r.data} onChange={(e) => alterar({ data: e.target.value })} required />
            </div>
            <div className="campo">
              <label htmlFor="rdo-resp">Responsável pelo RDO</label>
              <input id="rdo-resp" value={r.responsavel ?? ''} onChange={(e) => alterar({ responsavel: e.target.value })} />
            </div>
          </div>
        </div>

        <div className="card">
          <h2>Condições climáticas</h2>
          <div className="campos">
            {([['climaManha', 'Manhã'], ['climaTarde', 'Tarde'], ['climaNoite', 'Noite']] as const).map(([campo, rotulo]) => (
              <div className="campo" key={campo}>
                <label htmlFor={`rdo-${campo}`}>{rotulo}</label>
                <select id={`rdo-${campo}`} value={r[campo]} onChange={(e) => alterar({ [campo]: e.target.value as Clima })}>
                  {CLIMAS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>

        <div className="card tabela-caixa">
          <h2>Mão de obra</h2>
          <table className="tabela">
            <thead><tr><th>Função</th><th>Empresa / equipe</th><th className="num" style={{ width: '12%' }}>Quantidade</th><th className="num" style={{ width: '12%' }}>Horas</th><th className="nao-imprimir" /></tr></thead>
            <tbody>
              {r.maoDeObra.map((m, i) => (
                <tr key={i}>
                  <td><input aria-label="Função" value={m.funcao} onChange={(e) => alterar({ maoDeObra: linha(r.maoDeObra, i, { funcao: e.target.value }) })} /></td>
                  <td><input aria-label="Empresa" value={m.empresa ?? ''} onChange={(e) => alterar({ maoDeObra: linha(r.maoDeObra, i, { empresa: e.target.value || null }) })} /></td>
                  <td><input aria-label="Quantidade" className="num" inputMode="numeric" value={m.quantidade} onChange={(e) => alterar({ maoDeObra: linha(r.maoDeObra, i, { quantidade: Number(e.target.value) || 0 }) })} /></td>
                  <td><input aria-label="Horas" className="num" inputMode="decimal" value={m.horas ?? ''} onChange={(e) => alterar({ maoDeObra: linha(r.maoDeObra, i, { horas: numero(e.target.value) }) })} /></td>
                  <td className="nao-imprimir"><button type="button" className="btn btn-link" onClick={() => alterar({ maoDeObra: tirar(r.maoDeObra, i) })}>Remover</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="acoes nao-imprimir">
            <button type="button" className="btn btn-secundario" onClick={() => alterar({ maoDeObra: [...r.maoDeObra, { funcao: '', empresa: null, quantidade: 1, horas: null }] })}>Adicionar função</button>
          </div>
          <p className="small muted" style={{ marginBottom: 0 }}>Efetivo do dia: {r.maoDeObra.reduce((s, m) => s + (m.quantidade || 0), 0)} pessoas.</p>
        </div>

        <div className="card tabela-caixa">
          <h2>Equipamentos</h2>
          <table className="tabela">
            <thead><tr><th>Equipamento</th><th className="num" style={{ width: '12%' }}>Quantidade</th><th className="num" style={{ width: '12%' }}>Horas</th><th className="nao-imprimir" /></tr></thead>
            <tbody>
              {r.equipamentos.map((e, i) => (
                <tr key={i}>
                  <td><input aria-label="Equipamento" value={e.descricao} onChange={(ev) => alterar({ equipamentos: linha(r.equipamentos, i, { descricao: ev.target.value }) })} /></td>
                  <td><input aria-label="Quantidade" className="num" inputMode="numeric" value={e.quantidade} onChange={(ev) => alterar({ equipamentos: linha(r.equipamentos, i, { quantidade: Number(ev.target.value) || 0 }) })} /></td>
                  <td><input aria-label="Horas" className="num" inputMode="decimal" value={e.horas ?? ''} onChange={(ev) => alterar({ equipamentos: linha(r.equipamentos, i, { horas: numero(ev.target.value) }) })} /></td>
                  <td className="nao-imprimir"><button type="button" className="btn btn-link" onClick={() => alterar({ equipamentos: tirar(r.equipamentos, i) })}>Remover</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="acoes nao-imprimir">
            <button type="button" className="btn btn-secundario" onClick={() => alterar({ equipamentos: [...r.equipamentos, { descricao: '', quantidade: 1, horas: null }] })}>Adicionar equipamento</button>
          </div>
        </div>

        <div className="card tabela-caixa">
          <h2>Atividades executadas</h2>
          <table className="tabela">
            <thead><tr><th style={{ width: '14%' }}>Local</th><th>Atividade</th><th style={{ width: '16%' }}>Equipe</th><th className="num" style={{ width: '10%' }}>% do dia</th><th className="nao-imprimir" /></tr></thead>
            <tbody>
              {r.atividades.map((a, i) => (
                <tr key={i}>
                  <td><input aria-label="Local" value={a.local ?? ''} onChange={(e) => alterar({ atividades: linha(r.atividades, i, { local: e.target.value || null }) })} /></td>
                  <td><input aria-label="Atividade" value={a.descricao} onChange={(e) => alterar({ atividades: linha(r.atividades, i, { descricao: e.target.value }) })} /></td>
                  <td><input aria-label="Equipe" value={a.equipe ?? ''} onChange={(e) => alterar({ atividades: linha(r.atividades, i, { equipe: e.target.value || null }) })} /></td>
                  <td><input aria-label="Percentual" className="num" inputMode="decimal" value={a.percentual ?? ''} onChange={(e) => alterar({ atividades: linha(r.atividades, i, { percentual: numero(e.target.value) }) })} /></td>
                  <td className="nao-imprimir"><button type="button" className="btn btn-link" onClick={() => alterar({ atividades: tirar(r.atividades, i) })}>Remover</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="acoes nao-imprimir">
            <button type="button" className="btn btn-secundario" onClick={() => alterar({ atividades: [...r.atividades, { local: null, descricao: '', equipe: null, percentual: null }] })}>Adicionar atividade</button>
          </div>
        </div>

        <div className="card tabela-caixa">
          <h2>Ocorrências</h2>
          <table className="tabela">
            <thead><tr><th style={{ width: '30%' }}>Tipo</th><th>Descrição</th><th className="nao-imprimir" /></tr></thead>
            <tbody>
              {r.ocorrencias.map((o, i) => (
                <tr key={i}>
                  <td>
                    <select aria-label="Tipo" value={o.tipo} onChange={(e) => alterar({ ocorrencias: linha(r.ocorrencias, i, { tipo: e.target.value }) })}>
                      {OCORRENCIAS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                    </select>
                  </td>
                  <td><input aria-label="Descrição" value={o.descricao ?? ''} onChange={(e) => alterar({ ocorrencias: linha(r.ocorrencias, i, { descricao: e.target.value || null }) })} /></td>
                  <td className="nao-imprimir"><button type="button" className="btn btn-link" onClick={() => alterar({ ocorrencias: tirar(r.ocorrencias, i) })}>Remover</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="acoes nao-imprimir">
            <button type="button" className="btn btn-secundario" onClick={() => alterar({ ocorrencias: [...r.ocorrencias, { tipo: 'outra', descricao: null }] })}>Adicionar ocorrência</button>
          </div>
        </div>

        <div className="card nao-imprimir">
          <h2>Observações</h2>
          <textarea aria-label="Observações" rows={4} value={r.observacoes ?? ''} onChange={(e) => alterar({ observacoes: e.target.value || null })} />
        </div>

        <div className="acoes nao-imprimir">
          <button className="btn btn-primario" type="submit" disabled={ocupado}>Salvar RDO</button>
          <button className="btn btn-link" type="button" onClick={excluir}>Excluir RDO</button>
        </div>
      </form>

      <div className="so-imprimir">
        <p className="small"><b>Clima:</b> manhã {ROTULO_CLIMA[r.climaManha ?? ''] || '—'} · tarde {ROTULO_CLIMA[r.climaTarde ?? ''] || '—'} · noite {ROTULO_CLIMA[r.climaNoite ?? ''] || '—'}</p>
        {r.ocorrencias.length > 0 && (
          <p className="small"><b>Ocorrências:</b> {r.ocorrencias.map((o) => `${ROTULO_OCORRENCIA[o.tipo] ?? o.tipo}${o.descricao ? ` (${o.descricao})` : ''}`).join('; ')}.</p>
        )}
        {r.observacoes && <p className="small"><b>Observações:</b> {r.observacoes}</p>}
        <div className="so-imprimir assinaturas">
          <Assinatura nome={r.responsavel ?? ''} papel="Responsável técnico" />
          <Assinatura nome="" papel="Fiscalização / Proprietário" />
        </div>
      </div>
    </>
  );
}
