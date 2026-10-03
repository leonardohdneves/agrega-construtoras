import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, formatarData, formatarDataHora, formatarDocumento, formatarMoeda, hojeLocal, lerNumero, moedaCampo, NOMES_FORMA, somarDias, type FormaPagamento } from '../api';
import { CabecalhoDocumento } from '../componentes/Documento';
import {
  Assinatura,
  campoNumero,
  numeroDoc,
  precoUn,
  qtd,
  Selo,
  SELO_AUTORIZACAO,
  SELO_MEDICAO,
  textoRetencoes,
  type Contrato,
  type ContratoResumo,
  type Medicao,
  type MedicaoResumo,
  type Retencoes,
} from '../componentes/Suprimentos';

const FILTROS = [
  { id: '', texto: 'Recentes' },
  { id: 'aprovacao', texto: 'Para aprovar' },
  { id: 'autorizar', texto: 'Falta autorizar pagamento' },
  { id: 'aprovadas', texto: 'Aprovadas' },
  { id: 'canceladas', texto: 'Reprovadas e canceladas' },
];
const pctTxt = (n: number) => `${(n * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

export function SupMedicoes() {
  const [params, setParams] = useSearchParams();
  const filtro = params.get('status') ?? '';
  const [lista, setLista] = useState<MedicaoResumo[] | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    setLista(null);
    api<{ medicoes: MedicaoResumo[] }>(`/sup/medicoes${filtro ? `?status=${filtro}` : ''}`)
      .then((r) => setLista(r.medicoes))
      .catch((e) => setErro((e as Error).message));
  }, [filtro]);
  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Medições</h1>
          <span className="muted">O que cada prestador executou no período. Aprovada, a medição vira autorização de pagamento.</span>
        </div>
        <Link className="btn btn-primario" to="/sup/medicoes/nova">Nova medição</Link>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div className="abas" role="tablist">
        {FILTROS.map((f) => (
          <button key={f.id} type="button" role="tab" aria-selected={filtro === f.id} className={filtro === f.id ? 'ativa' : ''} onClick={() => setParams(f.id ? { status: f.id } : {}, { replace: true })}>
            {f.texto}
          </button>
        ))}
      </div>
      <div className="card tabela-caixa">
        {!lista ? (
          <p className="muted">Carregando…</p>
        ) : lista.length === 0 ? (
          <p className="muted">Nenhuma medição aqui.</p>
        ) : (
          <table className="tabela">
            <thead><tr><th>Nº</th><th>Contrato</th><th>Período</th><th style={{ textAlign: 'right' }}>Valor</th><th>Situação</th><th>Pagamento</th></tr></thead>
            <tbody>
              {lista.map((m) => (
                <tr key={m.id}>
                  <td className="mono"><Link to={`/sup/medicoes/${m.id}`}>{numeroDoc(m.numero)}</Link></td>
                  <td>
                    <b>{m.fornecedor}</b> <span className="small muted">· contrato {numeroDoc(m.contratoNumero)} · {m.sequencia}ª medição</span>
                    <div className="small">{m.objeto}</div>
                  </td>
                  <td>{formatarData(m.periodoInicio)} a {formatarData(m.periodoFim)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(m.valor)}</td>
                  <td><Selo s={SELO_MEDICAO[m.status]} /></td>
                  <td className="small">
                    {m.autorizacao ? <Link to={`/sup/autorizacoes/${m.autorizacao.id}`}>AP nº {numeroDoc(m.autorizacao.numero)}</Link> : m.status === 'aprovada' ? <span className="tom-aviso">falta autorizar</span> : '—'}
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

// ---------- Formulário ----------
function FormMedicao({ contrato, inicial, aoSalvar, aoCancelar }: { contrato: Contrato; inicial?: Medicao; aoSalvar: (m: Medicao) => void; aoCancelar?: () => void }) {
  const ultima = [...contrato.medicoes].filter((m) => m.status !== 'cancelada' && m.id !== inicial?.id).sort((a, b) => b.sequencia - a.sequencia)[0];
  const [f, setF] = useState({
    periodoInicio: inicial?.periodoInicio ?? (ultima ? somarDias(ultima.periodoFim, 1) : contrato.inicio),
    periodoFim: inicial?.periodoFim ?? hojeLocal(),
    data: inicial?.data ?? hojeLocal(),
    observacao: inicial?.observacao ?? '',
  });
  const [qs, setQs] = useState<Record<string, string>>(() => Object.fromEntries((inicial?.itens ?? []).map((i) => [i.contratoItemId, i.atual ? campoNumero(i.atual) : ''])));
  const [modoGlobal, setModoGlobal] = useState<'valor' | 'percentual'>('valor');
  const [valorGlobal, setValorGlobal] = useState(inicial && contrato.tipo === 'global' ? moedaCampo(inicial.valor) : '');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const total =
    contrato.tipo === 'itens'
      ? contrato.itens.reduce((s, i) => s + (lerNumero(qs[i.id] ?? '') ?? 0) * i.precoUnitario, 0)
      : modoGlobal === 'valor'
        ? lerNumero(valorGlobal) ?? 0
        : ((lerNumero(valorGlobal) ?? 0) * (contrato.valorGlobal ?? 0)) / 100;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    try {
      const corpo: Record<string, unknown> = { contratoId: contrato.id, ...f, observacao: f.observacao || null };
      if (contrato.tipo === 'itens') {
        corpo.itens = contrato.itens.map((i) => ({ contratoItemId: i.id, quantidade: lerNumero(qs[i.id] ?? '') ?? 0 })).filter((x) => x.quantidade > 0);
        if (!(corpo.itens as unknown[]).length) throw new Error('Informe a quantidade executada de pelo menos um item.');
      } else {
        const v = lerNumero(valorGlobal);
        if (!v || v <= 0) throw new Error(modoGlobal === 'valor' ? 'Informe o valor executado.' : 'Informe o percentual executado.');
        corpo[modoGlobal] = v;
      }
      setOcupado(true);
      const r = inicial
        ? await api<{ medicao: Medicao }>(`/sup/medicoes/${inicial.id}`, { metodo: 'PUT', corpo })
        : await api<{ medicao: Medicao }>('/sup/medicoes', { corpo });
      aoSalvar(r.medicao);
    } catch (err) {
      setErro((err as Error).message);
      setOcupado(false);
    }
  }

  return (
    <form className="card form" onSubmit={salvar}>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div className="campos">
        <div className="campo">
          <label htmlFor="md-ini">Período de</label>
          <input id="md-ini" type="date" value={f.periodoInicio} onChange={(e) => setF({ ...f, periodoInicio: e.target.value })} required />
        </div>
        <div className="campo">
          <label htmlFor="md-fim">até</label>
          <input id="md-fim" type="date" value={f.periodoFim} onChange={(e) => setF({ ...f, periodoFim: e.target.value })} required />
        </div>
        <div className="campo">
          <label htmlFor="md-data">Data da medição</label>
          <input id="md-data" type="date" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} />
        </div>
      </div>
      {contrato.tipo === 'itens' ? (
        <table className="tabela tabela-compacta">
          <thead>
            <tr><th>Serviço</th><th style={{ textAlign: 'right' }}>Contratado</th><th style={{ textAlign: 'right' }}>Saldo</th><th style={{ textAlign: 'right' }}>Preço</th><th>Executado no período</th><th style={{ textAlign: 'right' }}>Valor</th></tr>
          </thead>
          <tbody>
            {contrato.itens.map((i) => {
              const q = lerNumero(qs[i.id] ?? '') ?? 0;
              // Saldo disponível para esta medição = saldo aprovado − pendentes de outras medições.
              const proprio = inicial?.itens.find((x) => x.contratoItemId === i.id)?.atual ?? 0;
              const disponivel = i.saldo - i.pendente + proprio;
              return (
                <tr key={i.id}>
                  <td>{i.descricao}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{qtd(i.quantidade, i.unidade)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{qtd(disponivel, i.unidade)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{precoUn(i.precoUnitario)}</td>
                  <td>
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <input aria-label={`Executado de ${i.descricao}`} className="mono" inputMode="decimal" style={{ maxWidth: 120 }} value={qs[i.id] ?? ''} onChange={(e) => setQs({ ...qs, [i.id]: e.target.value })} />
                      <span className="small muted">{i.unidade}</span>
                    </span>
                    {q > disponivel + 0.0005 && <div className="small tom-perigo">passa do saldo</div>}
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>{q ? formatarMoeda(q * i.precoUnitario) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="campos">
          <div className="campo">
            <span className="rotulo" id="md-modo">Informar</span>
            <div className="segmentado" role="group" aria-labelledby="md-modo">
              {(['valor', 'percentual'] as const).map((t) => (
                <button key={t} type="button" aria-pressed={modoGlobal === t} className={modoGlobal === t ? 'ativo' : ''} onClick={() => setModoGlobal(t)}>
                  {t === 'valor' ? 'Valor (R$)' : '% do contrato'}
                </button>
              ))}
            </div>
          </div>
          <div className="campo">
            <label htmlFor="md-val">{modoGlobal === 'valor' ? 'Valor executado (R$)' : 'Percentual executado (%)'}</label>
            <input id="md-val" className="mono" inputMode="decimal" value={valorGlobal} onChange={(e) => setValorGlobal(e.target.value)} />
            <span className="small muted">Contrato {formatarMoeda(contrato.valorGlobal)} · saldo {formatarMoeda(contrato.resumo.saldo - contrato.resumo.pendente + (inicial?.valor ?? 0))}</span>
          </div>
        </div>
      )}
      <p className="small" style={{ margin: 0 }}>
        Valor da medição: <b className="mono">{formatarMoeda(total)}</b> · retenções do contrato: {textoRetencoes(contrato.retencoes)}
      </p>
      <div className="campo">
        <label htmlFor="md-obs">Observação</label>
        <textarea id="md-obs" rows={2} maxLength={1000} value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} placeholder="Frentes de serviço, ocorrências, fotos arquivadas…" />
      </div>
      <div className="acoes">
        <button className="btn btn-primario" type="submit" disabled={ocupado}>{ocupado ? 'Salvando…' : inicial ? 'Salvar alterações' : 'Salvar medição'}</button>
        {aoCancelar && <button className="btn btn-secundario" type="button" onClick={aoCancelar}>Cancelar</button>}
      </div>
    </form>
  );
}

export function NovaMedicao() {
  const navegar = useNavigate();
  const [params, setParams] = useSearchParams();
  const contratoId = params.get('contrato') ?? '';
  const [vigentes, setVigentes] = useState<ContratoResumo[]>([]);
  const [contrato, setContrato] = useState<Contrato | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    api<{ contratos: ContratoResumo[] }>('/sup/contratos?status=vigente').then((r) => setVigentes(r.contratos)).catch((e) => setErro((e as Error).message));
  }, []);
  useEffect(() => {
    setContrato(null);
    if (contratoId) api<{ contrato: Contrato }>(`/sup/contratos/${contratoId}`).then((r) => setContrato(r.contrato)).catch((e) => setErro((e as Error).message));
  }, [contratoId]);
  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <Link to="/sup/medicoes" className="small">← Medições</Link>
          <h1>Nova medição</h1>
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div className="card form">
        <div className="campo">
          <label htmlFor="nm-ct">Contrato</label>
          <select id="nm-ct" value={contratoId} onChange={(e) => setParams(e.target.value ? { contrato: e.target.value } : {}, { replace: true })}>
            <option value="">Escolha o contrato vigente</option>
            {vigentes.map((k) => <option key={k.id} value={k.id}>{numeroDoc(k.numero)} · {k.fornecedor} · {k.objeto}</option>)}
          </select>
        </div>
      </div>
      {contrato && contrato.status !== 'vigente' && <div className="alerta alerta-erro">Este contrato não está vigente.</div>}
      {contrato && contrato.status === 'vigente' && <FormMedicao contrato={contrato} aoSalvar={(m) => navegar(`/sup/medicoes/${m.id}`, { replace: true })} />}
    </>
  );
}

// ---------- Autorização a partir da medição ----------
function FormAutorizacao({ m, aoCriar, aoFechar }: { m: Medicao; aoCriar: (id: string) => void; aoFechar: () => void }) {
  const [f, setF] = useState({
    vencimento: somarDias(hojeLocal(), m.contrato.prazoPagamentoDias),
    documento: '',
    formaPagamento: m.contrato.formaPagamento ?? '',
    observacao: '',
  });
  const [ret, setRet] = useState<Record<keyof Retencoes, string>>(() =>
    Object.fromEntries((['caucao', 'iss', 'inss', 'ir', 'pcc'] as const).map((k) => [k, moedaCampo(m.retencoesPrevistas[k])])) as Record<keyof Retencoes, string>,
  );
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const somaRet = (Object.keys(ret) as (keyof Retencoes)[]).reduce((s, k) => s + (lerNumero(ret[k]) ?? 0), 0);
  const liquido = Math.round((m.valor - somaRet) * 100) / 100;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setOcupado(true);
    try {
      const r = await api<{ autorizacao: { id: string } }>('/sup/autorizacoes', {
        corpo: {
          medicaoId: m.id,
          vencimento: f.vencimento,
          documento: f.documento || null,
          formaPagamento: f.formaPagamento || null,
          observacao: f.observacao || null,
          retencoes: Object.fromEntries((Object.keys(ret) as (keyof Retencoes)[]).map((k) => [k, lerNumero(ret[k]) ?? 0])),
        },
      });
      aoCriar(r.autorizacao.id);
    } catch (err) {
      setErro((err as Error).message);
      setOcupado(false);
    }
  }

  return (
    <form className="card form nao-imprimir" onSubmit={salvar}>
      <h2>Autorização de pagamento</h2>
      <span className="small muted">As retenções vêm das % do contrato. Ajuste se a nota de serviço trouxer valores diferentes.</span>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div className="campos">
        <div className="campo">
          <label htmlFor="ap-doc">Nota de serviço / documento</label>
          <input id="ap-doc" maxLength={80} value={f.documento} onChange={(e) => setF({ ...f, documento: e.target.value })} placeholder="Ex.: NFS-e 1234" />
        </div>
        <div className="campo">
          <label htmlFor="ap-venc">Vencimento</label>
          <input id="ap-venc" type="date" value={f.vencimento} onChange={(e) => setF({ ...f, vencimento: e.target.value })} required />
        </div>
        <div className="campo">
          <label htmlFor="ap-forma">Forma de pagamento</label>
          <select id="ap-forma" value={f.formaPagamento} onChange={(e) => setF({ ...f, formaPagamento: e.target.value })}>
            <option value="">A combinar</option>
            {(Object.keys(NOMES_FORMA) as FormaPagamento[]).map((k) => <option key={k} value={k}>{NOMES_FORMA[k]}</option>)}
          </select>
        </div>
      </div>
      <div className="campos">
        {(['caucao', 'iss', 'inss', 'ir', 'pcc'] as const).map((k) => (
          <div className="campo" key={k}>
            <label htmlFor={`ap-${k}`}>{{ caucao: 'Caução', iss: 'ISS', inss: 'INSS', ir: 'IR', pcc: 'PIS/COFINS/CSLL' }[k]} (R$){m.contrato.retencoes[k] ? ` · ${m.contrato.retencoes[k].toLocaleString('pt-BR')}%` : ''}</label>
            <input id={`ap-${k}`} className="mono" inputMode="decimal" value={ret[k]} onChange={(e) => setRet({ ...ret, [k]: e.target.value })} />
          </div>
        ))}
      </div>
      <p style={{ margin: 0 }}>
        Bruto <b className="mono">{formatarMoeda(m.valor)}</b> − retenções <b className="mono">{formatarMoeda(somaRet)}</b> = líquido a pagar <b className="mono">{formatarMoeda(liquido)}</b>
      </p>
      <div className="campo">
        <label htmlFor="ap-obs">Observação</label>
        <input id="ap-obs" maxLength={500} value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} placeholder="Dados bancários, instruções…" />
      </div>
      <div className="acoes">
        <button className="btn btn-primario" type="submit" disabled={ocupado || liquido <= 0}>Emitir autorização</button>
        <button className="btn btn-secundario" type="button" onClick={aoFechar}>Fechar</button>
      </div>
    </form>
  );
}

// ---------- Detalhe: boletim de medição ----------
export function MedicaoDetalhe() {
  const { id } = useParams();
  const navegar = useNavigate();
  const [m, setM] = useState<Medicao | null>(null);
  const [contrato, setContrato] = useState<Contrato | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [modo, setModo] = useState<'editar' | 'reprovar' | 'autorizar' | null>(null);
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(() => {
    api<{ medicao: Medicao }>(`/sup/medicoes/${id}`).then((r) => setM(r.medicao)).catch((e) => setErro((e as Error).message));
  }, [id]);
  useEffect(carregar, [carregar]);
  useEffect(() => {
    if (modo === 'editar' && m) api<{ contrato: Contrato }>(`/sup/contratos/${m.contratoId}`).then((r) => setContrato(r.contrato)).catch((e) => setErro((e as Error).message));
  }, [modo, m]);

  async function executar(rota: string, msg: string, corpo?: unknown) {
    if (!m) return;
    setErro('');
    setAviso('');
    setOcupado(true);
    try {
      setM((await api<{ medicao: Medicao }>(`/sup/medicoes/${m.id}/${rota}`, { metodo: 'POST', corpo })).medicao);
      setAviso(msg);
      setModo(null);
      setMotivo('');
    } catch (e) {
      setErro((e as Error).message);
    }
    setOcupado(false);
  }

  if (!m) return erro ? <div className="alerta alerta-erro">{erro}</div> : <p className="muted">Carregando…</p>;
  const editavel = m.status === 'rascunho' || m.status === 'reprovada';
  const k = m.contrato;

  return (
    <>
      <div className="nao-imprimir">
        <Link to="/sup/medicoes" className="small">← Medições</Link> · <Link to={`/sup/contratos/${m.contratoId}`} className="small">Contrato {numeroDoc(k.numero)}</Link>
      </div>
      <CabecalhoDocumento
        modulo="Suprimentos"
        titulo={`Boletim de medição · ${m.sequencia}ª medição`}
        descricao={`Contrato nº ${numeroDoc(k.numero)} · ${k.objeto}`}
        filtros={[`Período: ${formatarData(m.periodoInicio)} a ${formatarData(m.periodoFim)}`, `Medição nº ${numeroDoc(m.numero)}`, `Data: ${formatarData(m.data)}`, `Situação: ${SELO_MEDICAO[m.status].texto}`]}
      />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}
      {m.status === 'reprovada' && m.motivoReprovacao && <div className="alerta alerta-erro nao-imprimir">Reprovada por {m.aprovadoPor ?? '—'}: {m.motivoReprovacao}. Ajuste e envie de novo.</div>}
      {m.status === 'aguardando_aprovacao' && <div className="alerta alerta-info nao-imprimir">Aguardando aprovação desde {formatarDataHora(m.enviadoAprovacaoEm)}. {m.regrasAprovacao}</div>}

      {modo === 'editar' ? (
        contrato ? <FormMedicao contrato={contrato} inicial={m} aoSalvar={(n) => { setM(n); setModo(null); setAviso('Medição alterada.'); }} aoCancelar={() => setModo(null)} /> : <p className="muted">Carregando…</p>
      ) : (
        <>
          <div className="card doc-partes">
            <div>
              <span className="rotulo">Contratada</span>
              <strong>{k.fornecedor.razaoSocial}</strong>
              {k.fornecedor.documento && <span>CNPJ/CPF {formatarDocumento(k.fornecedor.documento)}</span>}
            </div>
            <div>
              <span className="rotulo">Contrato</span>
              <span>Valor {formatarMoeda(m.totais.contrato)} · {k.tipo === 'itens' ? 'por itens' : 'valor global'}</span>
              <span>Retenções: {textoRetencoes(k.retencoes)}</span>
            </div>
          </div>

          {k.tipo === 'itens' ? (
            <div className="card tabela-caixa">
              <table className="tabela tabela-compacta boletim">
                <thead>
                  <tr>
                    <th rowSpan={2}>Serviço</th>
                    <th rowSpan={2} style={{ textAlign: 'right' }}>Contratado</th>
                    <th rowSpan={2} style={{ textAlign: 'right' }}>Preço</th>
                    <th colSpan={3} style={{ textAlign: 'center' }}>Quantidade</th>
                    <th rowSpan={2} style={{ textAlign: 'right' }}>Saldo</th>
                    <th rowSpan={2} style={{ textAlign: 'right' }}>Valor no período</th>
                  </tr>
                  <tr><th style={{ textAlign: 'right' }}>Anterior</th><th style={{ textAlign: 'right' }}>No período</th><th style={{ textAlign: 'right' }}>Acumulado</th></tr>
                </thead>
                <tbody>
                  {m.itens.map((i) => (
                    <tr key={i.contratoItemId}>
                      <td>{i.descricao}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{qtd(i.quantidadeContrato, i.unidade)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{precoUn(i.precoUnitario)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{qtd(i.anterior)}</td>
                      <td className="mono forte" style={{ textAlign: 'right' }}>{qtd(i.atual)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{qtd(i.acumulado)} <span className="small muted">({pctTxt(i.percentualAcumulado)})</span></td>
                      <td className="mono" style={{ textAlign: 'right' }}>{qtd(i.saldo)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(i.valorAtual)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="card tabela-caixa">
            <h2>Resumo financeiro</h2>
            <table className="tabela tabela-compacta">
              <tbody>
                <tr><td>Valor do contrato</td><td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(m.totais.contrato)}</td></tr>
                <tr><td>Medido anteriormente (aprovado)</td><td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(m.totais.anterior)}</td></tr>
                <tr><td className="forte">Esta medição</td><td className="mono forte" style={{ textAlign: 'right' }}>{formatarMoeda(m.totais.atual)}</td></tr>
                <tr><td>Acumulado ({pctTxt(m.totais.percentualAcumulado)})</td><td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(m.totais.acumulado)}</td></tr>
                <tr><td>Saldo do contrato</td><td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(m.totais.saldo)}</td></tr>
              </tbody>
            </table>
            {(Object.values(k.retencoes).some((v) => v > 0)) && (
              <p className="small" style={{ marginBottom: 0 }}>
                Retenções previstas: caução {formatarMoeda(m.retencoesPrevistas.caucao)} · impostos {formatarMoeda(m.retencoesPrevistas.iss + m.retencoesPrevistas.inss + m.retencoesPrevistas.ir + m.retencoesPrevistas.pcc)} · líquido previsto <b className="mono">{formatarMoeda(m.retencoesPrevistas.liquido)}</b>
              </p>
            )}
            {m.observacao && <p className="small"><b>Observação:</b> {m.observacao}</p>}
          </div>

          {m.autorizacao && (
            <div className="alerta alerta-info nao-imprimir">
              Pagamento: <Link to={`/sup/autorizacoes/${m.autorizacao.id}`}>autorização nº {numeroDoc(m.autorizacao.numero)}</Link> · <Selo s={SELO_AUTORIZACAO[m.autorizacao.status]} />
            </div>
          )}

          {modo === 'autorizar' && <FormAutorizacao m={m} aoCriar={(aid) => navegar(`/sup/autorizacoes/${aid}`)} aoFechar={() => setModo(null)} />}

          {modo === 'reprovar' && (
            <form className="card form nao-imprimir" onSubmit={(e) => { e.preventDefault(); executar('reprovar', 'Medição reprovada.', { motivo }); }}>
              <div className="campo">
                <label htmlFor="md-mot">Motivo da reprovação</label>
                <input id="md-mot" maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} required />
              </div>
              <div className="acoes">
                <button className="btn btn-perigo" type="submit" disabled={ocupado}>Reprovar</button>
                <button className="btn btn-secundario" type="button" onClick={() => setModo(null)}>Voltar</button>
              </div>
            </form>
          )}

          {!modo && (
            <div className="acoes nao-imprimir">
              {editavel && (
                <>
                  <button className="btn btn-primario" type="button" disabled={ocupado} onClick={() => executar('enviar-aprovacao', m.podeAprovar ? 'Medição aprovada.' : 'Medição enviada para aprovação.')}>
                    {m.podeAprovar ? 'Aprovar medição' : 'Enviar para aprovação'}
                  </button>
                  <button className="btn btn-secundario" type="button" onClick={() => setModo('editar')}>Editar</button>
                </>
              )}
              {m.status === 'aguardando_aprovacao' && m.podeAprovar && (
                <>
                  <button className="btn btn-primario" type="button" disabled={ocupado} onClick={() => executar('aprovar', 'Medição aprovada.')}>Aprovar</button>
                  <button className="btn btn-secundario" type="button" onClick={() => setModo('reprovar')}>Reprovar</button>
                </>
              )}
              {m.status === 'aprovada' && !m.autorizacao && <button className="btn btn-primario" type="button" onClick={() => setModo('autorizar')}>Gerar autorização de pagamento</button>}
              {m.status !== 'cancelada' && !m.autorizacao && <button className="btn btn-link" type="button" disabled={ocupado} onClick={() => executar('cancelar', 'Medição cancelada.')}>Cancelar medição</button>}
            </div>
          )}

          <div className="assinaturas">
            <Assinatura nome={k.fornecedor.razaoSocial} papel="Contratada · de acordo" />
            <Assinatura nome={m.criadoPor ?? ''} papel="Medido por (fiscal)" />
            <Assinatura
              nome={m.aprovacaoAutomatica ? 'Aprovação automática' : m.status === 'aprovada' ? m.aprovadoPor ?? '' : ''}
              papel="Aprovado por"
              detalhe={m.status === 'aprovada' && m.aprovadoEm ? `em ${formatarDataHora(m.aprovadoEm)}` : 'aguardando aprovação'}
            />
          </div>
        </>
      )}
    </>
  );
}
