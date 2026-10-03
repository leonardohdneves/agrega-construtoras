import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, formatarData, formatarDocumento, formatarMoeda, hojeLocal, lerNumero, moedaCampo, NOMES_FORMA, type FormaPagamento, type PlanoConta } from '../api';
import { CabecalhoDocumento } from '../componentes/Documento';
import {
  Assinatura,
  campoNumero,
  nomeFornecedor,
  numeroDoc,
  precoUn,
  qtd,
  Selo,
  SELO_AUTORIZACAO,
  SELO_CONTRATO,
  SELO_MEDICAO,
  textoRetencoes,
  UNIDADES,
  useCadastrosCompra,
  type Contrato,
  type ContratoResumo,
  type Retencoes,
} from '../componentes/Suprimentos';

const FILTROS = [
  { id: '', texto: 'Em andamento' },
  { id: 'encerrado', texto: 'Encerrados' },
  { id: 'cancelado', texto: 'Cancelados' },
];
const pctTxt = (n: number) => `${(n * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

export function SupContratos() {
  const [params, setParams] = useSearchParams();
  const filtro = params.get('status') ?? '';
  const [lista, setLista] = useState<ContratoResumo[] | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    setLista(null);
    api<{ contratos: ContratoResumo[] }>(`/sup/contratos${filtro ? `?status=${filtro}` : ''}`)
      .then((r) => setLista(r.contratos))
      .catch((e) => setErro((e as Error).message));
  }, [filtro]);

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Contratos</h1>
          <span className="muted">Serviços contratados com prestadores, medidos por período. Cada medição aprovada vira autorização de pagamento e conta a pagar.</span>
        </div>
        <Link className="btn btn-primario" to="/sup/contratos/novo">Novo contrato</Link>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div className="segmentado tres-opcoes" role="group" aria-label="Situação" style={{ maxWidth: 480 }}>
        {FILTROS.map((f) => (
          <button key={f.id} type="button" aria-pressed={filtro === f.id} className={filtro === f.id ? 'ativo' : ''} onClick={() => setParams(f.id ? { status: f.id } : {}, { replace: true })}>
            {f.texto}
          </button>
        ))}
      </div>
      <div className="card tabela-caixa">
        {!lista ? (
          <p className="muted">Carregando…</p>
        ) : lista.length === 0 ? (
          <p className="muted">Nenhum contrato aqui.</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr><th>Nº</th><th>Prestador e objeto</th><th>Vigência</th><th style={{ textAlign: 'right' }}>Valor</th><th style={{ textAlign: 'right' }}>Medido</th><th style={{ textAlign: 'right' }}>Saldo</th><th>Situação</th></tr>
            </thead>
            <tbody>
              {lista.map((k) => (
                <tr key={k.id}>
                  <td className="mono"><Link to={`/sup/contratos/${k.id}`}>{numeroDoc(k.numero)}</Link></td>
                  <td>
                    <b>{k.fornecedor}</b>
                    <div className="small">{k.objeto}</div>
                  </td>
                  <td className={k.vencido ? 'tom-perigo' : ''}>
                    {formatarData(k.inicio)}{k.fim ? ` a ${formatarData(k.fim)}` : ''}
                    {k.vencido && <div className="small">vigência vencida</div>}
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(k.valor)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    {formatarMoeda(k.medido)}
                    <div className="small muted">{pctTxt(k.percentualMedido)}</div>
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(k.saldo)}</td>
                  <td>
                    <Selo s={SELO_CONTRATO[k.status]} />
                    {k.medicoesPendentes > 0 && <div className="small tom-aviso">{k.medicoesPendentes} {k.medicoesPendentes === 1 ? 'medição pendente' : 'medições pendentes'}</div>}
                    {k.medicoesSemAutorizacao > 0 && <div className="small tom-aviso">{k.medicoesSemAutorizacao} sem autorização de pagamento</div>}
                    {k.status === 'encerrado' && k.caucaoALiberar > 0 && <div className="small tom-aviso">caução a liberar {formatarMoeda(k.caucaoALiberar)}</div>}
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
type LinhaItem = { chave: string; id: string | null; descricao: string; unidade: string; quantidade: string; preco: string; medido: number };
let seq = 0;
const novaLinhaItem = (p: Partial<LinhaItem> = {}): LinhaItem => ({ chave: `c${++seq}`, id: null, descricao: '', unidade: 'h', quantidade: '', preco: '', medido: 0, ...p });
const RET_VAZIA: Record<keyof Retencoes, string> = { caucao: '', iss: '', inss: '', ir: '', pcc: '' };

function FormContrato({ inicial, aoSalvar, aoCancelar }: { inicial?: Contrato; aoSalvar: (k: Contrato) => void; aoCancelar?: () => void }) {
  const { fornecedores, centros } = useCadastrosCompra();
  const [planos, setPlanos] = useState<PlanoConta[]>([]);
  useEffect(() => {
    api<{ contas: PlanoConta[] }>('/fin/plano-contas').then((r) => setPlanos(r.contas.filter((p) => p.tipo === 'despesa' && p.aceitaLancamento && p.ativo))).catch(() => {});
  }, []);
  const [f, setF] = useState({
    fornecedorId: inicial?.fornecedorId ?? '',
    objeto: inicial?.objeto ?? '',
    tipo: inicial?.tipo ?? ('itens' as 'itens' | 'global'),
    dataAssinatura: inicial?.dataAssinatura ?? hojeLocal(),
    inicio: inicial?.inicio ?? hojeLocal(),
    fim: inicial?.fim ?? '',
    valorGlobal: inicial?.valorGlobal ? moedaCampo(inicial.valorGlobal) : '',
    planoContaId: inicial?.planoContaId ?? '',
    centroCustoId: inicial?.centroCustoId ?? '',
    prazoPagamentoDias: String(inicial?.prazoPagamentoDias ?? 15),
    formaPagamento: inicial?.formaPagamento ?? '',
    observacao: inicial?.observacao ?? '',
  });
  const [usaRet, setUsaRet] = useState(!!inicial && Object.values(inicial.retencoes).some((v) => v > 0));
  const [ret, setRet] = useState<Record<keyof Retencoes, string>>(
    inicial ? (Object.fromEntries(Object.entries(inicial.retencoes).map(([k, v]) => [k, v ? String(v).replace('.', ',') : ''])) as Record<keyof Retencoes, string>) : RET_VAZIA,
  );
  const [linhas, setLinhas] = useState<LinhaItem[]>(
    inicial?.itens.length
      ? inicial.itens.map((i) => novaLinhaItem({ id: i.id, descricao: i.descricao, unidade: i.unidade, quantidade: campoNumero(i.quantidade), preco: campoNumero(i.precoUnitario, 4), medido: i.medido + i.pendente }))
      : [novaLinhaItem()],
  );
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const temMedicao = !!inicial && inicial.medicoes.some((m) => ['rascunho', 'aguardando_aprovacao', 'aprovada'].includes(m.status));
  const totalItens = linhas.reduce((s, l) => s + (lerNumero(l.quantidade) ?? 0) * (lerNumero(l.preco) ?? 0), 0);
  const mudarLinha = (chave: string, p: Partial<LinhaItem>) => setLinhas(linhas.map((l) => (l.chave === chave ? { ...l, ...p } : l)));

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    try {
      if (!f.fornecedorId) throw new Error('Escolha o prestador.');
      if (!f.planoContaId) throw new Error('Escolha a categoria do plano de contas.');
      const itens =
        f.tipo === 'itens'
          ? linhas
              .filter((l) => l.descricao.trim() || l.quantidade.trim())
              .map((l, n) => {
                const q = lerNumero(l.quantidade);
                const p = lerNumero(l.preco);
                if (!l.descricao.trim()) throw new Error(`Item ${n + 1}: descreva o serviço.`);
                if (!q || q <= 0) throw new Error(`Item ${n + 1}: informe a quantidade.`);
                if (p === null || p < 0) throw new Error(`Item ${n + 1}: informe o preço unitário.`);
                return { id: l.id, descricao: l.descricao.trim(), unidade: l.unidade, quantidade: q, precoUnitario: p };
              })
          : [];
      const retencoes = Object.fromEntries((Object.keys(RET_VAZIA) as (keyof Retencoes)[]).map((k) => [k, usaRet ? lerNumero(ret[k]) ?? 0 : 0]));
      setOcupado(true);
      const corpo = {
        ...f,
        fim: f.fim || null,
        dataAssinatura: f.dataAssinatura || null,
        valorGlobal: f.tipo === 'global' ? lerNumero(f.valorGlobal) : null,
        centroCustoId: f.centroCustoId || null,
        prazoPagamentoDias: Math.max(0, Math.round(Number(f.prazoPagamentoDias) || 0)),
        formaPagamento: f.formaPagamento || null,
        observacao: f.observacao || null,
        retencoes,
        itens,
      };
      const r = inicial
        ? await api<{ contrato: Contrato }>(`/sup/contratos/${inicial.id}`, { metodo: 'PUT', corpo })
        : await api<{ contrato: Contrato }>('/sup/contratos', { corpo });
      aoSalvar(r.contrato);
    } catch (err) {
      setErro((err as Error).message);
      setOcupado(false);
    }
  }

  return (
    <form className="card form" onSubmit={salvar}>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {inicial?.status === 'vigente' && <div className="alerta alerta-info">Contrato vigente: as mudanças ficam registradas como aditivo. Itens já medidos não podem sair nem ficar abaixo do medido.</div>}
      <div className="campos">
        <div className="campo">
          <label htmlFor="ct-forn">Prestador</label>
          <select id="ct-forn" value={f.fornecedorId} disabled={temMedicao} onChange={(e) => setF({ ...f, fornecedorId: e.target.value })} required>
            <option value="">Escolha o prestador</option>
            {fornecedores.map((x) => <option key={x.id} value={x.id}>{nomeFornecedor(x)}</option>)}
          </select>
        </div>
        <div className="campo" style={{ gridColumn: 'span 2' }}>
          <label htmlFor="ct-obj">Objeto</label>
          <input id="ct-obj" maxLength={300} value={f.objeto} onChange={(e) => setF({ ...f, objeto: e.target.value })} placeholder="Ex.: manutenção mecânica da central dosadora" required />
        </div>
      </div>
      <div className="campos">
        <div className="campo">
          <span className="rotulo" id="ct-tipo">Forma de medir</span>
          <div className="segmentado" role="group" aria-labelledby="ct-tipo">
            {(['itens', 'global'] as const).map((t) => (
              <button key={t} type="button" disabled={temMedicao} aria-pressed={f.tipo === t} className={f.tipo === t ? 'ativo' : ''} onClick={() => setF({ ...f, tipo: t })}>
                {t === 'itens' ? 'Por itens' : 'Valor global'}
              </button>
            ))}
          </div>
        </div>
        <div className="campo">
          <label htmlFor="ct-ass">Assinatura</label>
          <input id="ct-ass" type="date" value={f.dataAssinatura} onChange={(e) => setF({ ...f, dataAssinatura: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="ct-ini">Início da vigência</label>
          <input id="ct-ini" type="date" value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} required />
        </div>
        <div className="campo">
          <label htmlFor="ct-fim">Fim da vigência</label>
          <input id="ct-fim" type="date" value={f.fim} onChange={(e) => setF({ ...f, fim: e.target.value })} />
        </div>
      </div>

      {f.tipo === 'itens' ? (
        <>
          <h2>Itens do contrato</h2>
          <div className="editor-itens">
            {linhas.map((l, n) => (
              <div key={l.chave} className="campos editor-linha">
                <div className="campo" style={{ gridColumn: 'span 2' }}>
                  <label htmlFor={`ci-d-${l.chave}`}>Serviço {n + 1}</label>
                  <input id={`ci-d-${l.chave}`} maxLength={200} value={l.descricao} onChange={(e) => mudarLinha(l.chave, { descricao: e.target.value })} placeholder="Ex.: hora técnica de mecânico" />
                </div>
                <div className="campo">
                  <label htmlFor={`ci-q-${l.chave}`}>Quantidade</label>
                  <div className="com-sufixo">
                    <input id={`ci-q-${l.chave}`} className="mono" inputMode="decimal" value={l.quantidade} onChange={(e) => mudarLinha(l.chave, { quantidade: e.target.value })} />
                    <select aria-label="Unidade" value={l.unidade} onChange={(e) => mudarLinha(l.chave, { unidade: e.target.value })}>
                      {[...new Set([l.unidade, ...UNIDADES, 'mês', 'diária'])].map((u) => <option key={u} value={u}>{u === 'm3' ? 'm³' : u === 'm2' ? 'm²' : u}</option>)}
                    </select>
                  </div>
                  {l.medido > 0 && <span className="small muted">já medido: {qtd(l.medido)}</span>}
                </div>
                <div className="campo">
                  <label htmlFor={`ci-p-${l.chave}`}>Preço unitário (R$)</label>
                  <input id={`ci-p-${l.chave}`} className="mono" inputMode="decimal" value={l.preco} onChange={(e) => mudarLinha(l.chave, { preco: e.target.value })} />
                </div>
                <div className="campo" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn btn-link" type="button" disabled={linhas.length === 1 || l.medido > 0} onClick={() => setLinhas(linhas.filter((x) => x.chave !== l.chave))}>Remover</button>
                </div>
              </div>
            ))}
            <div className="acoes">
              <button className="btn btn-secundario" type="button" onClick={() => setLinhas([...linhas, novaLinhaItem()])}>+ Item</button>
              <span className="small muted">Valor do contrato: <b className="mono">{formatarMoeda(totalItens)}</b></span>
            </div>
          </div>
        </>
      ) : (
        <div className="campos">
          <div className="campo">
            <label htmlFor="ct-global">Valor global (R$)</label>
            <input id="ct-global" className="mono" inputMode="decimal" value={f.valorGlobal} onChange={(e) => setF({ ...f, valorGlobal: e.target.value })} />
            <span className="small muted">Cada medição informa o valor ou o % executado no período.</span>
          </div>
        </div>
      )}

      <h2>Pagamento e apropriação</h2>
      <div className="campos">
        <div className="campo">
          <label htmlFor="ct-plano">Categoria (plano de contas)</label>
          <select id="ct-plano" value={f.planoContaId} onChange={(e) => setF({ ...f, planoContaId: e.target.value })} required>
            <option value="">Escolha a categoria</option>
            {planos.map((p) => <option key={p.id} value={p.id}>{p.codigo} {p.nome}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="ct-cc">Centro de custo</label>
          <select id="ct-cc" value={f.centroCustoId} onChange={(e) => setF({ ...f, centroCustoId: e.target.value })}>
            <option value="">Não informado</option>
            {centros.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="ct-prazo">Prazo de pagamento (dias)</label>
          <input id="ct-prazo" inputMode="numeric" value={f.prazoPagamentoDias} onChange={(e) => setF({ ...f, prazoPagamentoDias: e.target.value.replace(/\D/g, '') })} />
        </div>
        <div className="campo">
          <label htmlFor="ct-forma">Forma de pagamento</label>
          <select id="ct-forma" value={f.formaPagamento} onChange={(e) => setF({ ...f, formaPagamento: e.target.value })}>
            <option value="">A combinar</option>
            {(Object.keys(NOMES_FORMA) as FormaPagamento[]).map((k) => <option key={k} value={k}>{NOMES_FORMA[k]}</option>)}
          </select>
        </div>
      </div>

      <label className="marcar">
        <input type="checkbox" checked={usaRet} onChange={(e) => setUsaRet(e.target.checked)} />
        <span>Este contrato tem retenções (caução e impostos retidos na fonte)</span>
      </label>
      {usaRet && (
        <div className="campos">
          {(['caucao', 'iss', 'inss', 'ir', 'pcc'] as const).map((k) => (
            <div className="campo" key={k}>
              <label htmlFor={`ret-${k}`}>{{ caucao: 'Caução (%)', iss: 'ISS (%)', inss: 'INSS (%)', ir: 'IR (%)', pcc: 'PIS/COFINS/CSLL (%)' }[k]}</label>
              <input id={`ret-${k}`} className="mono" inputMode="decimal" value={ret[k]} onChange={(e) => setRet({ ...ret, [k]: e.target.value })} placeholder="0" />
            </div>
          ))}
          <span className="small muted" style={{ gridColumn: '1 / -1' }}>
            Calculadas sobre o valor bruto de cada medição. A caução fica retida e é liberada no encerramento; os impostos viram conta a pagar no dia 20 do mês seguinte (confira o vencimento de cada tributo no Financeiro).
          </span>
        </div>
      )}

      <div className="campo">
        <label htmlFor="ct-obs">Observação</label>
        <textarea id="ct-obs" rows={2} maxLength={1000} value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} />
      </div>
      <div className="acoes">
        <button className="btn btn-primario" type="submit" disabled={ocupado}>{ocupado ? 'Salvando…' : inicial ? 'Salvar alterações' : 'Salvar contrato'}</button>
        {aoCancelar && <button className="btn btn-secundario" type="button" onClick={aoCancelar}>Cancelar</button>}
      </div>
    </form>
  );
}

export function NovoContrato() {
  const navegar = useNavigate();
  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <Link to="/sup/contratos" className="small">← Contratos</Link>
          <h1>Novo contrato</h1>
          <span className="muted">Salvo como rascunho. Ative quando estiver assinado para começar a medir.</span>
        </div>
      </div>
      <FormContrato aoSalvar={(k) => navegar(`/sup/contratos/${k.id}`, { replace: true })} />
    </>
  );
}

// ---------- Detalhe ----------
export function ContratoDetalhe() {
  const { id } = useParams();
  const navegar = useNavigate();
  const [k, setK] = useState<Contrato | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [editar, setEditar] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(() => {
    api<{ contrato: Contrato }>(`/sup/contratos/${id}`).then((r) => setK(r.contrato)).catch((e) => setErro((e as Error).message));
  }, [id]);
  useEffect(carregar, [carregar]);

  async function acao(rota: string, msg: string) {
    if (!k) return;
    setErro('');
    setAviso('');
    setOcupado(true);
    try {
      setK((await api<{ contrato: Contrato }>(`/sup/contratos/${k.id}/${rota}`, { metodo: 'POST' })).contrato);
      setAviso(msg);
    } catch (e) {
      setErro((e as Error).message);
    }
    setOcupado(false);
  }

  async function liberarCaucao() {
    if (!k) return;
    setErro('');
    setOcupado(true);
    try {
      const r = await api<{ autorizacao: { id: string } }>('/sup/autorizacoes', { corpo: { contratoId: k.id, tipo: 'caucao' } });
      navegar(`/sup/autorizacoes/${r.autorizacao.id}`);
    } catch (e) {
      setErro((e as Error).message);
      setOcupado(false);
    }
  }

  if (!k) return erro ? <div className="alerta alerta-erro">{erro}</div> : <p className="muted">Carregando…</p>;
  const r = k.resumo;

  return (
    <>
      <div className="nao-imprimir">
        <Link to="/sup/contratos" className="small">← Contratos</Link>
      </div>
      <CabecalhoDocumento
        modulo="Suprimentos"
        titulo={`Contrato nº ${numeroDoc(k.numero)} · ${k.objeto}`}
        filtros={[
          `Vigência: ${formatarData(k.inicio)}${k.fim ? ` a ${formatarData(k.fim)}` : ' (sem fim)'}`,
          k.tipo === 'itens' ? 'Medição por itens' : 'Valor global',
          textoRetencoes(k.retencoes),
          `Situação: ${SELO_CONTRATO[k.status].texto}`,
        ]}
      />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}
      {k.vencido && <div className="alerta alerta-erro nao-imprimir">A vigência terminou em {formatarData(k.fim)}. Faça um aditivo de prazo ou encerre o contrato.</div>}

      {editar ? (
        <FormContrato inicial={k} aoSalvar={(n) => { setK(n); setEditar(false); setAviso('Contrato alterado.'); }} aoCancelar={() => setEditar(false)} />
      ) : (
        <>
          <div className="grade">
            <div className="card indicador">
              <span className="rotulo-ind">Valor do contrato</span>
              <span className="valor-ind mono">{formatarMoeda(r.valorContrato)}</span>
              <span className="small muted">saldo {formatarMoeda(r.saldo)}</span>
            </div>
            <div className="card indicador">
              <span className="rotulo-ind">Medido (aprovado)</span>
              <span className="valor-ind mono">{formatarMoeda(r.medido)}</span>
              <span className="small muted">{pctTxt(r.percentualMedido)} do contrato{r.pendente ? ` · ${formatarMoeda(r.pendente)} pendente` : ''}</span>
            </div>
            <div className="card indicador">
              <span className="rotulo-ind">Pago ao prestador</span>
              <span className="valor-ind mono">{formatarMoeda(r.pago)}</span>
              <span className="small muted">de {formatarMoeda(r.liquidoAutorizado)} autorizado (líquido)</span>
            </div>
            <div className="card indicador">
              <span className="rotulo-ind">Retido</span>
              <span className="valor-ind mono">{formatarMoeda(r.caucaoRetida - r.caucaoLiberada)}</span>
              <span className="small muted">caução · impostos retidos {formatarMoeda(r.impostosRetidos)}</span>
            </div>
          </div>

          <div className="card doc-partes">
            <div>
              <span className="rotulo">Contratada</span>
              <strong>{k.fornecedor.razaoSocial}</strong>
              {k.fornecedor.documento && <span>CNPJ/CPF {formatarDocumento(k.fornecedor.documento)}</span>}
              {(k.fornecedor.telefone || k.fornecedor.email) && <span>{[k.fornecedor.telefone, k.fornecedor.email].filter(Boolean).join(' · ')}</span>}
              {k.fornecedor.chavePix && <span>PIX: {k.fornecedor.chavePix}</span>}
            </div>
            <div>
              <span className="rotulo">Pagamento e apropriação</span>
              <span>{k.prazoPagamentoDias} dias após a autorização{k.formaPagamento ? ` · ${NOMES_FORMA[k.formaPagamento as FormaPagamento] ?? k.formaPagamento}` : ''}</span>
              <span>Categoria: {k.planoConta}</span>
              {k.centroCusto && <span>Centro de custo: {k.centroCusto}</span>}
              {k.dataAssinatura && <span>Assinado em {formatarData(k.dataAssinatura)}</span>}
            </div>
          </div>

          {k.tipo === 'itens' && (
            <div className="card tabela-caixa">
              <h2>Itens e saldo</h2>
              <table className="tabela tabela-compacta">
                <thead>
                  <tr><th>Serviço</th><th style={{ textAlign: 'right' }}>Contratado</th><th style={{ textAlign: 'right' }}>Preço</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Medido</th><th style={{ textAlign: 'right' }}>Saldo</th></tr>
                </thead>
                <tbody>
                  {k.itens.map((i) => (
                    <tr key={i.id}>
                      <td>{i.descricao}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{qtd(i.quantidade, i.unidade)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{precoUn(i.precoUnitario)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(i.total)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>
                        {qtd(i.medido, i.unidade)}
                        {i.pendente > 0 && <div className="small muted">+{qtd(i.pendente)} pendente</div>}
                      </td>
                      <td className={`mono ${i.saldo <= 0 ? 'tom-aviso' : ''}`} style={{ textAlign: 'right' }}>{qtd(i.saldo, i.unidade)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td colSpan={3} className="forte">Total</td><td className="mono forte" style={{ textAlign: 'right' }}>{formatarMoeda(r.valorContrato)}</td><td className="mono forte" style={{ textAlign: 'right' }}>{formatarMoeda(r.medido)}</td><td className="mono forte" style={{ textAlign: 'right' }}>{formatarMoeda(r.saldo)}</td></tr>
                </tfoot>
              </table>
            </div>
          )}

          <div className="card tabela-caixa">
            <div className="cartao-topo">
              <h2>Medições</h2>
              {k.status === 'vigente' && <Link className="btn btn-primario nao-imprimir" to={`/sup/medicoes/nova?contrato=${k.id}`}>Nova medição</Link>}
            </div>
            {k.medicoes.length === 0 ? (
              <p className="muted">{k.status === 'rascunho' ? 'Ative o contrato para lançar medições.' : 'Nenhuma medição ainda.'}</p>
            ) : (
              <table className="tabela tabela-compacta">
                <thead><tr><th>Medição</th><th>Período</th><th style={{ textAlign: 'right' }}>Valor</th><th>Situação</th><th>Pagamento</th></tr></thead>
                <tbody>
                  {k.medicoes.map((m) => (
                    <tr key={m.id}>
                      <td><Link to={`/sup/medicoes/${m.id}`}>{m.sequencia}ª medição</Link> <span className="small muted mono">nº {numeroDoc(m.numero)}</span></td>
                      <td>{formatarData(m.periodoInicio)} a {formatarData(m.periodoFim)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(m.valor)}</td>
                      <td><Selo s={SELO_MEDICAO[m.status]} /></td>
                      <td className="small">
                        {m.autorizacao ? <Link to={`/sup/autorizacoes/${m.autorizacao.id}`}>Autorização nº {numeroDoc(m.autorizacao.numero)}</Link> : m.status === 'aprovada' ? <span className="tom-aviso">falta autorizar</span> : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {k.autorizacoes.length > 0 && (
            <div className="card tabela-caixa">
              <h2>Autorizações de pagamento</h2>
              <table className="tabela tabela-compacta">
                <thead><tr><th>Nº</th><th>Referência</th><th>Vencimento</th><th style={{ textAlign: 'right' }}>Bruto</th><th style={{ textAlign: 'right' }}>Retenções</th><th style={{ textAlign: 'right' }}>Líquido</th><th style={{ textAlign: 'right' }}>Pago</th><th>Situação</th></tr></thead>
                <tbody>
                  {k.autorizacoes.map((a) => (
                    <tr key={a.id}>
                      <td className="mono"><Link to={`/sup/autorizacoes/${a.id}`}>{numeroDoc(a.numero)}</Link></td>
                      <td>{a.tipo === 'caucao' ? 'Liberação da caução' : `${a.medicaoSequencia}ª medição`}</td>
                      <td>{formatarData(a.vencimento)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(a.bruto)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(a.caucao + a.impostos)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(a.liquido)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(a.pago)}</td>
                      <td><Selo s={SELO_AUTORIZACAO[a.status]} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {k.observacao && <p className="small"><b>Observação:</b> {k.observacao}</p>}

          <div className="acoes nao-imprimir">
            {k.status === 'rascunho' && <button className="btn btn-primario" type="button" disabled={ocupado} onClick={() => acao('ativar', 'Contrato ativado. Já pode lançar medições.')}>Ativar contrato</button>}
            {(k.status === 'rascunho' || k.status === 'vigente') && <button className="btn btn-secundario" type="button" onClick={() => setEditar(true)}>{k.status === 'vigente' ? 'Aditivo / editar' : 'Editar'}</button>}
            {k.status === 'vigente' && <button className="btn btn-secundario" type="button" disabled={ocupado} onClick={() => acao('encerrar', 'Contrato encerrado.')}>Encerrar contrato</button>}
            {k.status === 'encerrado' && r.caucaoALiberar > 0 && (
              <button className="btn btn-primario" type="button" disabled={ocupado} onClick={liberarCaucao}>Liberar caução ({formatarMoeda(r.caucaoALiberar)})</button>
            )}
            {k.status === 'encerrado' && <button className="btn btn-link" type="button" disabled={ocupado} onClick={() => acao('reabrir', 'Contrato reaberto.')}>Reabrir</button>}
            {(k.status === 'rascunho' || (k.status === 'vigente' && k.medicoes.every((m) => ['reprovada', 'cancelada'].includes(m.status)))) && (
              <button className="btn btn-link" type="button" disabled={ocupado} onClick={() => acao('cancelar', 'Contrato cancelado.')}>Cancelar contrato</button>
            )}
          </div>

          <div className="so-imprimir assinaturas">
            <Assinatura nome={k.fornecedor.razaoSocial} papel="Contratada" />
            <Assinatura nome={k.criadoPor ?? ''} papel="Contratante" />
          </div>
        </>
      )}
    </>
  );
}
