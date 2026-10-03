import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, formatarData, formatarDataHora, formatarDocumento, formatarMoeda, NOMES_FORMA, type FormaPagamento } from '../api';
import { CabecalhoDocumento } from '../componentes/Documento';
import { Assinatura, numeroDoc, porExtenso, Selo, SELO_AUTORIZACAO, type Autorizacao, type AutorizacaoResumo } from '../componentes/Suprimentos';
import { useSessao } from '../sessao';

const FILTROS = [
  { id: '', texto: 'Recentes' },
  { id: 'aprovacao', texto: 'Para aprovar' },
  { id: 'aprovadas', texto: 'Aprovadas' },
  { id: 'canceladas', texto: 'Reprovadas e canceladas' },
];

export function SupAutorizacoes() {
  const [params, setParams] = useSearchParams();
  const filtro = params.get('status') ?? '';
  const [lista, setLista] = useState<AutorizacaoResumo[] | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    setLista(null);
    api<{ autorizacoes: AutorizacaoResumo[] }>(`/sup/autorizacoes${filtro ? `?status=${filtro}` : ''}`)
      .then((r) => setLista(r.autorizacoes))
      .catch((e) => setErro((e as Error).message));
  }, [filtro]);
  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Autorizações de pagamento</h1>
          <span className="muted">Ordem de pagamento das medições (bruto − retenções = líquido). Aprovada, vira conta a pagar no Financeiro.</span>
        </div>
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
          <p className="muted">Nenhuma autorização aqui. Elas nascem das medições aprovadas.</p>
        ) : (
          <table className="tabela">
            <thead><tr><th>Nº</th><th>Prestador</th><th>Referência</th><th>Vencimento</th><th style={{ textAlign: 'right' }}>Bruto</th><th style={{ textAlign: 'right' }}>Líquido</th><th>Situação</th></tr></thead>
            <tbody>
              {lista.map((a) => (
                <tr key={a.id}>
                  <td className="mono"><Link to={`/sup/autorizacoes/${a.id}`}>{numeroDoc(a.numero)}</Link></td>
                  <td>{a.fornecedor}</td>
                  <td className="small">
                    {a.tipo === 'caucao' ? 'Liberação da caução' : `${a.medicaoSequencia}ª medição`} · contrato {numeroDoc(a.contratoNumero)}
                    <div className="muted">{a.objeto}</div>
                  </td>
                  <td>{formatarData(a.vencimento)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(a.bruto)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(a.liquido)}</td>
                  <td>
                    <Selo s={SELO_AUTORIZACAO[a.status]} />
                    {a.pago && <div className="small">paga</div>}
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

// ---------- Ordem de pagamento com recibo ----------
export function AutorizacaoDetalhe() {
  const { id } = useParams();
  const { empresa } = useSessao();
  const [a, setA] = useState<Autorizacao | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [reprovar, setReprovar] = useState<string | null>(null);

  const carregar = useCallback(() => {
    api<{ autorizacao: Autorizacao }>(`/sup/autorizacoes/${id}`).then((r) => setA(r.autorizacao)).catch((e) => setErro((e as Error).message));
  }, [id]);
  useEffect(carregar, [carregar]);

  async function executar(rota: string, msg: string, corpo?: unknown) {
    if (!a) return;
    setErro('');
    setAviso('');
    setOcupado(true);
    try {
      setA((await api<{ autorizacao: Autorizacao }>(`/sup/autorizacoes/${a.id}/${rota}`, { metodo: 'POST', corpo })).autorizacao);
      setAviso(msg);
      setReprovar(null);
    } catch (e) {
      setErro((e as Error).message);
    }
    setOcupado(false);
  }

  if (!a) return erro ? <div className="alerta alerta-erro">{erro}</div> : <p className="muted">Carregando…</p>;
  const f = a.contrato.fornecedor;
  const ref = a.tipo === 'caucao'
    ? `liberação da caução retida no contrato nº ${numeroDoc(a.contrato.numero)} (${a.contrato.objeto})`
    : `${a.medicao!.sequencia}ª medição do contrato nº ${numeroDoc(a.contrato.numero)} (${a.contrato.objeto}), período de ${formatarData(a.medicao!.periodoInicio)} a ${formatarData(a.medicao!.periodoFim)}`;
  const aprovada = a.status === 'aprovada';
  const linhasRet = (
    [
      ['caucao', 'Caução retida', a.contrato.retencoes.caucao, a.caucao],
      ['iss', 'ISS retido', a.contrato.retencoes.iss, a.iss],
      ['inss', 'INSS retido', a.contrato.retencoes.inss, a.inss],
      ['ir', 'IR retido', a.contrato.retencoes.ir, a.ir],
      ['pcc', 'PIS/COFINS/CSLL retidos', a.contrato.retencoes.pcc, a.pcc],
    ] as const
  ).filter(([, , , v]) => v > 0);
  const cidade = empresa?.cidade ? `${empresa.cidade}${empresa.uf ? `/${empresa.uf}` : ''}` : '____________________';

  return (
    <>
      <div className="nao-imprimir">
        <Link to="/sup/autorizacoes" className="small">← Autorizações</Link> · <Link to={`/sup/contratos/${a.contratoId}`} className="small">Contrato {numeroDoc(a.contrato.numero)}</Link>
        {a.medicao && <> · <Link to={`/sup/medicoes/${a.medicao.id}`} className="small">Medição</Link></>}
      </div>
      <CabecalhoDocumento
        modulo="Suprimentos"
        titulo={`Ordem de pagamento nº ${numeroDoc(a.numero)}`}
        descricao={`Autorização de pagamento referente à ${ref}.`}
        filtros={[`Emissão: ${formatarData(a.data)}`, `Vencimento: ${formatarData(a.vencimento)}`, a.documento ? `Documento: ${a.documento}` : '', `Situação: ${SELO_AUTORIZACAO[a.status].texto}`]}
      />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}
      {a.status === 'aguardando_aprovacao' && <div className="alerta alerta-info nao-imprimir">Aguardando aprovação. {a.regrasAprovacao} Ao aprovar, a conta a pagar é criada no Financeiro.</div>}
      {a.status === 'reprovada' && a.motivoReprovacao && <div className="alerta alerta-erro nao-imprimir">Reprovada por {a.aprovadoPor ?? '—'}: {a.motivoReprovacao}</div>}

      <div className="card doc-partes">
        <div>
          <span className="rotulo">Beneficiário</span>
          <strong>{f.razaoSocial}</strong>
          {f.documento && <span>CNPJ/CPF {formatarDocumento(f.documento)}</span>}
          {(f.telefone || f.email) && <span>{[f.telefone, f.email].filter(Boolean).join(' · ')}</span>}
          {f.chavePix && <span>Chave PIX: {f.chavePix}</span>}
        </div>
        <div>
          <span className="rotulo">Pagamento</span>
          <span>Vencimento: <b>{formatarData(a.vencimento)}</b></span>
          <span>Forma: {a.formaPagamento ? NOMES_FORMA[a.formaPagamento as FormaPagamento] ?? a.formaPagamento : 'a combinar'}</span>
          <span>Categoria: {a.contrato.planoConta}{a.contrato.centroCusto ? ` · ${a.contrato.centroCusto}` : ''}</span>
        </div>
      </div>

      <div className="card tabela-caixa">
        <table className="tabela tabela-compacta ordem-valores">
          <tbody>
            <tr><td className="forte">{a.tipo === 'caucao' ? 'Caução a liberar' : 'Valor bruto da medição'}</td><td className="mono forte" style={{ textAlign: 'right' }}>{formatarMoeda(a.bruto)}</td></tr>
            {linhasRet.map(([k, nome, pct, v]) => (
              <tr key={k}><td>(−) {nome}{pct ? ` · ${pct.toLocaleString('pt-BR')}%` : ''}</td><td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(v)}</td></tr>
            ))}
            <tr className="linha-liquido"><td className="forte">Líquido a pagar</td><td className="mono forte" style={{ textAlign: 'right' }}>{formatarMoeda(a.liquido)}</td></tr>
          </tbody>
        </table>
        <p className="small" style={{ marginBottom: 0 }}>Valor líquido por extenso: <i>{porExtenso(a.liquido)}</i>.</p>
        {a.observacao && <p className="small"><b>Observação:</b> {a.observacao}</p>}
        {a.impostos > 0 && <p className="small muted nao-imprimir" style={{ marginBottom: 0 }}>Os impostos retidos ({formatarMoeda(a.impostos)}) são recolhidos pela {empresa?.nomeFantasia ?? 'empresa'} e entram como conta a pagar separada.</p>}
      </div>

      {aprovada && (a.parcelas.length > 0 || a.parcelasImpostos.length > 0) && (
        <div className="card tabela-caixa nao-imprimir">
          <h2>Contas a pagar geradas</h2>
          <table className="tabela tabela-compacta">
            <thead><tr><th>Conta</th><th>Vencimento</th><th style={{ textAlign: 'right' }}>Valor</th><th>Situação</th></tr></thead>
            <tbody>
              {a.parcelas.map((p) => (
                <tr key={`f${p.numero}`}><td>{f.nome} (líquido)</td><td>{formatarData(p.vencimento)}</td><td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(p.valor)}</td><td>{p.status === 'paga' ? `paga em ${formatarData(p.pagoEm)}` : p.status === 'cancelada' ? 'cancelada' : 'em aberto'}</td></tr>
              ))}
              {a.parcelasImpostos.map((p) => (
                <tr key={`i${p.numero}`}><td>{p.observacao}</td><td>{formatarData(p.vencimento)}</td><td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(p.valor)}</td><td>{p.status === 'paga' ? 'paga' : p.status === 'cancelada' ? 'cancelada' : 'em aberto'}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="small" style={{ marginBottom: 0 }}>Pague em <Link to="/fin/pagar-receber">Contas a pagar e receber</Link>.</p>
        </div>
      )}

      {reprovar !== null ? (
        <form className="card form nao-imprimir" onSubmit={(e) => { e.preventDefault(); executar('reprovar', 'Autorização reprovada.', { motivo: reprovar }); }}>
          <div className="campo">
            <label htmlFor="ap-mot">Motivo da reprovação</label>
            <input id="ap-mot" maxLength={500} value={reprovar} onChange={(e) => setReprovar(e.target.value)} required />
          </div>
          <div className="acoes">
            <button className="btn btn-perigo" type="submit" disabled={ocupado}>Reprovar</button>
            <button className="btn btn-secundario" type="button" onClick={() => setReprovar(null)}>Voltar</button>
          </div>
        </form>
      ) : (
        <div className="acoes nao-imprimir">
          {a.status === 'aguardando_aprovacao' && a.podeAprovar && (
            <>
              <button className="btn btn-primario" type="button" disabled={ocupado} onClick={() => executar('aprovar', 'Autorização aprovada. A conta a pagar foi criada no Financeiro.')}>Aprovar e gerar conta a pagar</button>
              <button className="btn btn-secundario" type="button" onClick={() => setReprovar('')}>Reprovar</button>
            </>
          )}
          {(a.status === 'aguardando_aprovacao' || (aprovada && !a.parcelas.some((p) => p.status === 'paga'))) && (
            <button className="btn btn-link" type="button" disabled={ocupado} onClick={() => executar('cancelar', aprovada ? 'Autorização cancelada e contas a pagar canceladas.' : 'Autorização cancelada.')}>
              Cancelar autorização
            </button>
          )}
        </div>
      )}

      <div className="assinaturas assinatura-unica">
        <Assinatura
          nome={a.aprovacaoAutomatica ? 'Aprovação automática (alçada)' : aprovada ? a.aprovadoPor ?? '' : ''}
          papel="Autorizado por"
          detalhe={aprovada && a.aprovadoEm ? `em ${formatarDataHora(a.aprovadoEm)}` : 'aguardando aprovação'}
        />
      </div>

      <section className="recibo">
        <div className="recibo-corte" aria-hidden="true"><span>✂ recortar aqui</span></div>
        <div className="recibo-topo">
          <h2>Recibo</h2>
          <span className="recibo-valor mono">{formatarMoeda(a.liquido)}</span>
        </div>
        <p>
          Recebi(emos) de <b>{empresa?.razaoSocial}</b>{empresa?.cnpj ? `, CNPJ ${formatarDocumento(empresa.cnpj)},` : ''} a importância de <b>{formatarMoeda(a.liquido)}</b> ({porExtenso(a.liquido)}), referente à {ref}, conforme a ordem de pagamento nº {numeroDoc(a.numero)}
          {a.documento ? ` e o documento ${a.documento}` : ''}.
          {linhasRet.length > 0 && ` Valor bruto de ${formatarMoeda(a.bruto)}, com retenções de ${formatarMoeda(a.bruto - a.liquido)}.`} Para clareza, firmo(amos) o presente recibo, dando plena quitação do valor recebido.
        </p>
        <p className="recibo-data">{cidade}, _____ de ____________________ de {a.vencimento.slice(0, 4)}.</p>
        <div className="assinaturas">
          <Assinatura nome={f.razaoSocial} papel="Recebedor (fornecedor)" detalhe={f.documento ? `CNPJ/CPF ${formatarDocumento(f.documento)}` : undefined} />
          <Assinatura
            nome={a.aprovacaoAutomatica ? '' : aprovada ? a.aprovadoPor ?? '' : ''}
            papel={`Autorizou o pagamento · ${empresa?.nomeFantasia || empresa?.razaoSocial || ''}`}
            detalhe={aprovada && a.aprovadoEm ? `autorizado em ${formatarData(a.aprovadoEm.slice(0, 10))}` : undefined}
          />
        </div>
      </section>
      <p className="small muted nao-imprimir">Emitida em {formatarData(a.data)} por {a.criadoPor ?? '—'}.</p>
    </>
  );
}
