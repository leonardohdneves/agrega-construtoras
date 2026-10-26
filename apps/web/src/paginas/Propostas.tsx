// Comercial · Propostas de execução de obras: cinco tipos, preço do orçamento ou informado.
// Aceita pelo cliente, gera o contrato e os lançamentos em contas a receber.
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, formatarData, formatarMoeda, lerNumero } from '../api';
import { useSessao } from '../sessao';
import { CabecalhoDocumento } from '../componentes/Documento';
import { Assinatura } from '../componentes/Suprimentos';

type Tipo = 'acompanhamento' | 'administracao' | 'preco_global' | 'preco_unitario' | 'laudo';
type Origem = 'orcamento' | 'informado';
type Status = 'rascunho' | 'enviada' | 'aceita' | 'recusada' | 'cancelada';

const TIPOS: { id: Tipo; nome: string; ajuda: string; origens: Origem[]; dataLabel: string }[] = [
  {
    id: 'acompanhamento',
    nome: 'Acompanhamento de obra',
    ajuda: 'Honorário mensal fixo, ou um percentual do valor da obra dividido pelos meses. Cobre o período de acompanhamento da obra.',
    origens: ['orcamento', 'informado'],
    dataLabel: 'Início do acompanhamento',
  },
  {
    id: 'administracao',
    nome: 'Administração de obra',
    ajuda: 'Taxa de administração sobre o custo direto ou sobre o valor da obra, paga em parcelas mensais.',
    origens: ['orcamento', 'informado'],
    dataLabel: 'Início da administração',
  },
  {
    id: 'preco_global',
    nome: 'Contrato de preço global',
    ajuda: 'Valor fechado para a obra inteira, recebido por marcos de medição. Os percentuais dos marcos precisam somar 100%.',
    origens: ['orcamento', 'informado'],
    dataLabel: 'Data de assinatura (base dos marcos)',
  },
  {
    id: 'preco_unitario',
    nome: 'Contrato de preços unitários',
    ajuda: 'Serviços com quantidade estimada e preço unitário. O total é a soma; o recebimento segue um número de parcelas mensais.',
    origens: ['orcamento', 'informado'],
    dataLabel: 'Início dos pagamentos',
  },
  {
    id: 'laudo',
    nome: 'Laudos técnicos',
    ajuda: 'Laudos avulsos com preço informado: uma entrada na aceitação e o saldo na entrega dos laudos.',
    origens: ['informado'],
    dataLabel: 'Data da aceitação (entrada)',
  },
];
// Campos do modelo de proposta de laudo que o usuário preenche no formulário.
const CAMPOS_LAUDO: { id: string; rotulo: string; exemplo: string; largo?: boolean }[] = [
  { id: 'naoIncluidos', rotulo: 'Não incluído nesta proposta (exclusões)', exemplo: 'Ex.: taxas, projetos complementares', largo: true },
  { id: 'meioPagamento', rotulo: 'Meio de pagamento', exemplo: 'Ex.: PIX ou boleto' },
  { id: 'indiceCorrecao', rotulo: 'Índice de correção monetária (atraso)', exemplo: 'Ex.: IPCA' },
  { id: 'reajuste', rotulo: 'Reajuste', exemplo: 'Ex.: sem reajuste durante a validade da proposta', largo: true },
  { id: 'cidadeForo', rotulo: 'Cidade do foro e da assinatura', exemplo: 'Ex.: Palmas/TO' },
  { id: 'responsavelTecnico', rotulo: 'Responsável técnico', exemplo: 'Nome do engenheiro' },
  { id: 'crea', rotulo: 'CREA', exemplo: 'Número do CREA' },
  { id: 'documentoCliente', rotulo: 'CPF/CNPJ do cliente', exemplo: '000.000.000-00' },
];
const infoTipo = (t: Tipo) => TIPOS.find((x) => x.id === t) ?? TIPOS[0];
const ROTULO: Record<Status, string> = { rascunho: 'Rascunho', enviada: 'Enviada', aceita: 'Aceita', recusada: 'Recusada', cancelada: 'Cancelada' };
const SELO: Record<Status, string> = { rascunho: 'selo-neutro', enviada: 'selo-aviso', aceita: 'selo-ok', recusada: 'selo-perigo', cancelada: 'selo-neutro' };
const numeroFmt = (n: number) => String(n).padStart(4, '0');
const hoje = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const campo = (n: unknown) => (n === null || n === undefined || n === '' ? '' : String(n).replace('.', ','));
const gestao = (perfil?: string) => perfil === 'dono' || perfil === 'gestor';

type Opcoes = {
  clientes: { id: string; nome: string }[];
  obras: { id: string; codigo: string; nome: string; bdi: number; custoDireto: number; valorObra: number }[];
};
type Servico = { id: string; codigo: string; descricao: string; unidade: string; preco: number };
type Parcela = { descricao: string; vencimento: string; valor: number };
type Previa = { valorTotal: number; parcelas: Parcela[] };
type Linha = { obraItemId: string | null; descricao: string; unidade: string; quantidade: string; precoUnitario: string };
type Marco = { descricao: string; percentual: string; dias: string };
type Form = {
  tipo: Tipo; clienteId: string; obraId: string; titulo: string; objeto: string; endereco: string; prazoDias: string; validadeDias: string;
  origemPreco: Origem; dataInicio: string; meses: string; modo: 'valor_mensal' | 'percentual_obra'; honorarioMensal: string; percentualObra: string;
  taxaPct: string; baseAdm: 'custo_direto' | 'valor_obra'; valorBaseInformado: string; valorInformado: string; marcos: Marco[];
  numeroParcelas: string; entradaPct: string; prazoEntregaDias: string; itens: Linha[]; condicoes: string;
  campos: Record<string, string>;
};
type Detalhe = {
  id: string; numero: number; tipo: Tipo; tipoNome: string; titulo: string; status: Status; valorTotal: number; origemPreco: Origem;
  clienteId: string; clienteNome: string | null; obraId: string | null; obraCodigo: string | null; objeto: string | null; endereco: string | null;
  prazoDias: number | null; validadeDias: number; parametros: Record<string, any>; condicoes: string | null; enviadaEm: string | null;
  decididaEm: string | null; contratoNumero: number | null; criadoEm: string;
  itens: { obraItemId: string | null; descricao: string; unidade: string; quantidade: number; precoUnitario: number }[];
  parcelas: Parcela[];
};

const FORM_VAZIO: Form = {
  tipo: 'acompanhamento', clienteId: '', obraId: '', titulo: '', objeto: '', endereco: '', prazoDias: '', validadeDias: '30',
  origemPreco: 'informado', dataInicio: '', meses: '', modo: 'valor_mensal', honorarioMensal: '', percentualObra: '', taxaPct: '',
  baseAdm: 'custo_direto', valorBaseInformado: '', valorInformado: '', marcos: [{ descricao: '', percentual: '', dias: '' }],
  numeroParcelas: '', entradaPct: '50', prazoEntregaDias: '', itens: [], condicoes: '', campos: {},
};

function deProposta(p: Detalhe): Form {
  const q = p.parametros ?? {};
  return {
    ...FORM_VAZIO,
    tipo: p.tipo,
    clienteId: p.clienteId,
    obraId: p.obraId ?? '',
    titulo: p.titulo,
    objeto: p.objeto ?? '',
    endereco: p.endereco ?? '',
    prazoDias: campo(p.prazoDias),
    validadeDias: String(p.validadeDias),
    origemPreco: p.origemPreco,
    dataInicio: q.dataInicio ?? hoje(),
    meses: campo(q.meses),
    modo: q.modo ?? 'valor_mensal',
    honorarioMensal: campo(q.honorarioMensal),
    percentualObra: campo(q.percentualObra),
    taxaPct: campo(q.taxaPct),
    baseAdm: q.baseAdm ?? 'custo_direto',
    valorBaseInformado: campo(q.valorBaseInformado),
    valorInformado: campo(q.valorInformado),
    marcos: Array.isArray(q.marcos) ? q.marcos.map((m: any) => ({ descricao: m.descricao, percentual: campo(m.percentual), dias: campo(m.dias) })) : FORM_VAZIO.marcos,
    numeroParcelas: campo(q.numeroParcelas),
    entradaPct: campo(q.entradaPct),
    prazoEntregaDias: campo(q.prazoEntregaDias),
    campos: (q.campos as Record<string, string>) ?? {},
    itens: p.itens.map((i) => ({ obraItemId: i.obraItemId, descricao: i.descricao, unidade: i.unidade, quantidade: campo(i.quantidade), precoUnitario: campo(i.precoUnitario) })),
    condicoes: p.condicoes ?? '',
  };
}

/** Corpo enviado ao servidor. Números vazios viram undefined; o servidor valida e calcula. */
function corpoDe(f: Form) {
  const n = (s: string) => lerNumero(s) ?? undefined;
  return {
    tipo: f.tipo,
    clienteId: f.clienteId,
    obraId: f.obraId || null,
    titulo: f.titulo.trim(),
    objeto: f.objeto,
    endereco: f.endereco,
    prazoDias: n(f.prazoDias) ?? null,
    validadeDias: n(f.validadeDias) ?? 30,
    origemPreco: f.origemPreco,
    parametros: {
      dataInicio: f.dataInicio,
      meses: n(f.meses),
      modo: f.modo,
      honorarioMensal: n(f.honorarioMensal),
      percentualObra: n(f.percentualObra),
      taxaPct: n(f.taxaPct),
      baseAdm: f.baseAdm,
      valorBaseInformado: n(f.valorBaseInformado),
      valorInformado: n(f.valorInformado),
      // Marcos só valem para preço global; nos outros tipos a linha vazia não deve travar a prévia.
      marcos: f.tipo === 'preco_global' ? f.marcos.map((m) => ({ descricao: m.descricao, percentual: n(m.percentual) ?? 0, dias: n(m.dias) ?? 0 })) : undefined,
      numeroParcelas: n(f.numeroParcelas),
      entradaPct: n(f.entradaPct),
      prazoEntregaDias: n(f.prazoEntregaDias),
      campos: f.campos,
    },
    itens: f.itens.map((i) => ({
      obraItemId: i.obraItemId,
      descricao: i.descricao,
      unidade: i.unidade || 'un',
      quantidade: n(i.quantidade) ?? 0,
      precoUnitario: n(i.precoUnitario) ?? 0,
    })),
    condicoes: f.condicoes,
  };
}

function ErroCampo({ erro }: { erro: string }) {
  return erro ? <div className="alerta alerta-erro" role="alert">{erro}</div> : null;
}

export function ComPropostas() {
  const [lista, setLista] = useState<Detalhe[] | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    api<{ propostas: Array<Record<string, any>> }>('/com/obra-propostas')
      .then((r) => setLista(r.propostas as Detalhe[]))
      .catch((e) => setErro((e as Error).message));
  }, []);

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Propostas</h1>
          <span className="muted">Propostas para execução de obras. Aceitas pelo cliente, geram contrato e lançamentos em contas a receber.</span>
        </div>
        <div className="acoes">
          <Link className="btn btn-primario" to="/com/propostas/nova">Nova proposta</Link>
        </div>
      </div>
      <ErroCampo erro={erro} />
      {lista === null && !erro && <p className="muted">Carregando…</p>}
      {lista?.length === 0 && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>Nenhuma proposta ainda. Crie a primeira escolhendo o tipo, o cliente e a origem do preço.</p>
        </div>
      )}
      {lista && lista.length > 0 && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="tabela">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Tipo</th>
                <th>Cliente</th>
                <th>Obra</th>
                <th className="num">Valor</th>
                <th>Situação</th>
                <th>Contrato</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((p) => (
                <tr key={p.id}>
                  <td className="mono"><Link to={`/com/propostas/${p.id}`}>{numeroFmt(p.numero)}</Link></td>
                  <td>{p.tipoNome}<div className="small muted">{p.titulo}</div></td>
                  <td>{p.clienteNome}</td>
                  <td>{p.obraCodigo ?? <span className="muted">—</span>}</td>
                  <td className="num">{formatarMoeda(p.valorTotal)}</td>
                  <td><span className={`selo ${SELO[p.status]}`}>{ROTULO[p.status]}</span></td>
                  <td>{p.contratoNumero ? `Nº ${numeroFmt(p.contratoNumero)}` : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function PropostaForm({ editando }: { editando?: Detalhe }) {
  const navegar = useNavigate();
  const [op, setOp] = useState<Opcoes | null>(null);
  const [f, setF] = useState<Form>(() => (editando ? deProposta(editando) : { ...FORM_VAZIO, dataInicio: hoje() }));
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [erroPrevia, setErroPrevia] = useState('');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const info = infoTipo(f.tipo);
  const obra = op?.obras.find((o) => o.id === f.obraId) ?? null;
  const usaOrcamento = f.origemPreco === 'orcamento';

  function set<K extends keyof Form>(k: K, v: Form[K]) {
    setF((x) => ({ ...x, [k]: v }));
  }

  function mudarTipo(t: Tipo) {
    const origens = infoTipo(t).origens;
    setF((x) => ({ ...x, tipo: t, origemPreco: origens.includes(x.origemPreco) ? x.origemPreco : 'informado' }));
  }

  function mudarOrigem(o: Origem) {
    // Ao informar o preço, a ligação com serviços do orçamento se desfaz.
    setF((x) => ({ ...x, origemPreco: o, itens: o === 'informado' ? x.itens.map((i) => ({ ...i, obraItemId: null })) : x.itens }));
  }

  useEffect(() => {
    api<Opcoes>('/com/obra-propostas/opcoes').then(setOp).catch((e) => setErro((e as Error).message));
  }, []);

  // Serviços do orçamento da obra escolhida (para contratos de preços unitários com preço do orçamento).
  useEffect(() => {
    let cancelado = false;
    if (!f.obraId) {
      setServicos([]);
      return;
    }
    api<{ servicos: Servico[] }>(`/com/obra-propostas/servicos?obraId=${f.obraId}`)
      .then((r) => !cancelado && setServicos(r.servicos))
      .catch((e) => !cancelado && setErro((e as Error).message));
    return () => {
      cancelado = true;
    };
  }, [f.obraId]);

  // Prévia do cálculo, com atraso para não consultar a cada tecla.
  useEffect(() => {
    let cancelado = false;
    const t = setTimeout(() => {
      api<Previa>('/com/obra-propostas/calcular', { corpo: corpoDe(f) })
        .then((r) => {
          if (cancelado) return;
          setPrevia(r);
          setErroPrevia('');
        })
        .catch((e) => {
          if (cancelado) return;
          setPrevia(null);
          setErroPrevia((e as Error).message);
        });
    }, 400);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [f]);

  // Itens (preços unitários e laudos)
  function novaLinha(): Linha {
    return { obraItemId: null, descricao: '', unidade: 'un', quantidade: '1', precoUnitario: '' };
  }
  function atualizarItem(i: number, parcial: Partial<Linha>) {
    setF((x) => ({ ...x, itens: x.itens.map((it, k) => (k === i ? { ...it, ...parcial } : it)) }));
  }
  function escolherServico(i: number, id: string) {
    const s = servicos.find((x) => x.id === id);
    if (!s) return atualizarItem(i, { obraItemId: null });
    atualizarItem(i, { obraItemId: s.id, descricao: `${s.codigo} · ${s.descricao}`, unidade: s.unidade, precoUnitario: campo(s.preco) });
  }
  function removerItem(i: number) {
    setF((x) => ({ ...x, itens: x.itens.filter((_, k) => k !== i) }));
  }

  // Marcos (preço global)
  function atualizarMarco(i: number, parcial: Partial<Marco>) {
    setF((x) => ({ ...x, marcos: x.marcos.map((m, k) => (k === i ? { ...m, ...parcial } : m)) }));
  }
  const somaMarcos = f.marcos.reduce((s, m) => s + (lerNumero(m.percentual) ?? 0), 0);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setOcupado(true);
    try {
      const corpo = corpoDe(f);
      const r = editando
        ? await api<{ id: string }>(`/com/obra-propostas/${editando.id}`, { metodo: 'PUT', corpo })
        : await api<{ id: string }>('/com/obra-propostas', { corpo });
      navegar(`/com/propostas/${r.id}`);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  const mostraItens = f.tipo === 'preco_unitario' || f.tipo === 'laudo';
  const precoDoOrcamento = usaOrcamento && f.tipo === 'preco_unitario';

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>{editando ? `Editar proposta ${numeroFmt(editando.numero)}` : 'Nova proposta de obra'}</h1>
          <span className="muted">{info.ajuda}</span>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(260px, 340px)', gap: 16, alignItems: 'start' }}>
        <form className="card form" onSubmit={salvar}>
          <ErroCampo erro={erro} />

          <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>1. Tipo e partes</h2>
          <div className="campos">
            <div className="campo">
              <label htmlFor="p-tipo">Tipo de proposta</label>
              <select id="p-tipo" value={f.tipo} onChange={(e) => mudarTipo(e.target.value as Tipo)}>
                {TIPOS.map((t) => (
                  <option key={t.id} value={t.id}>{t.nome}</option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="p-cli">Cliente</label>
              <select id="p-cli" value={f.clienteId} onChange={(e) => set('clienteId', e.target.value)} required>
                <option value="">Escolha o cliente</option>
                {op?.clientes.map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="p-obra">Obra {usaOrcamento ? '(obrigatória para o orçamento)' : '(opcional)'}</label>
              <select id="p-obra" value={f.obraId} onChange={(e) => set('obraId', e.target.value)}>
                <option value="">Sem obra vinculada</option>
                {op?.obras.map((o) => (
                  <option key={o.id} value={o.id}>{o.codigo} · {o.nome}</option>
                ))}
              </select>
            </div>
            <div className="campo" style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="p-titulo">Título da proposta</label>
              <input id="p-titulo" value={f.titulo} onChange={(e) => set('titulo', e.target.value)} placeholder="Ex.: Administração da obra Residencial Vale Verde" required />
            </div>
            <div className="campo" style={{ gridColumn: '1 / -1' }}>
              <label htmlFor="p-objeto">Objeto (o que está incluído)</label>
              <textarea id="p-objeto" rows={3} value={f.objeto} onChange={(e) => set('objeto', e.target.value)} />
            </div>
            <div className="campo">
              <label htmlFor="p-end">Endereço da obra</label>
              <input id="p-end" value={f.endereco} onChange={(e) => set('endereco', e.target.value)} />
            </div>
            <div className="campo">
              <label htmlFor="p-prazo">Prazo de execução (dias)</label>
              <input id="p-prazo" inputMode="numeric" value={f.prazoDias} onChange={(e) => set('prazoDias', e.target.value)} />
            </div>
            <div className="campo">
              <label htmlFor="p-validade">Validade da proposta (dias)</label>
              <input id="p-validade" inputMode="numeric" value={f.validadeDias} onChange={(e) => set('validadeDias', e.target.value)} />
            </div>
            <div className="campo">
              <label htmlFor="p-inicio">{info.dataLabel}</label>
              <input id="p-inicio" type="date" value={f.dataInicio} onChange={(e) => set('dataInicio', e.target.value)} required />
            </div>
          </div>

          <h2 style={{ fontSize: 16, margin: '20px 0 8px' }}>2. Origem do preço</h2>
          {info.origens.length > 1 ? (
            <div className="segmentado" role="group" aria-label="Origem do preço" style={{ maxWidth: 480 }}>
              <button type="button" aria-pressed={f.origemPreco === 'orcamento'} className={f.origemPreco === 'orcamento' ? 'ativo' : ''} onClick={() => mudarOrigem('orcamento')}>
                Puxar do orçamento da obra
              </button>
              <button type="button" aria-pressed={f.origemPreco === 'informado'} className={f.origemPreco === 'informado' ? 'ativo' : ''} onClick={() => mudarOrigem('informado')}>
                Informar valores
              </button>
            </div>
          ) : (
            <p className="muted small" style={{ margin: 0 }}>Laudos técnicos têm preço informado pelo usuário.</p>
          )}
          {usaOrcamento && (
            <div className="alerta" style={{ marginTop: 10 }}>
              {obra ? (
                <>
                  <strong>{obra.codigo} · {obra.nome}</strong>: custo direto {formatarMoeda(obra.custoDireto)}, BDI {obra.bdi.toLocaleString('pt-BR')}%, valor da obra {formatarMoeda(obra.valorObra)}.
                </>
              ) : (
                'Escolha a obra para puxar os valores do orçamento.'
              )}
            </div>
          )}

          <h2 style={{ fontSize: 16, margin: '20px 0 8px' }}>3. Condições do tipo</h2>
          <div className="campos">
            {f.tipo === 'acompanhamento' && (
              <>
                <div className="campo" style={{ gridColumn: '1 / -1' }}>
                  <span className="small muted">Forma de cobrança</span>
                  <div className="segmentado" role="group" aria-label="Forma de cobrança" style={{ maxWidth: 480 }}>
                    <button type="button" aria-pressed={f.modo === 'valor_mensal'} className={f.modo === 'valor_mensal' ? 'ativo' : ''} onClick={() => set('modo', 'valor_mensal')}>Honorário mensal fixo</button>
                    <button type="button" disabled={!usaOrcamento} aria-pressed={f.modo === 'percentual_obra'} className={f.modo === 'percentual_obra' ? 'ativo' : ''} onClick={() => set('modo', 'percentual_obra')}>
                      Percentual da obra
                    </button>
                  </div>
                  {!usaOrcamento && <span className="small muted">O percentual sobre a obra precisa do orçamento da obra.</span>}
                </div>
                {f.modo === 'valor_mensal' ? (
                  <div className="campo">
                    <label htmlFor="p-hon">Honorário mensal (R$)</label>
                    <input id="p-hon" inputMode="decimal" value={f.honorarioMensal} onChange={(e) => set('honorarioMensal', e.target.value)} />
                  </div>
                ) : (
                  <div className="campo">
                    <label htmlFor="p-perc">Percentual sobre o valor da obra (%)</label>
                    <input id="p-perc" inputMode="decimal" value={f.percentualObra} onChange={(e) => set('percentualObra', e.target.value)} />
                  </div>
                )}
                <div className="campo">
                  <label htmlFor="p-meses">Duração (meses)</label>
                  <input id="p-meses" inputMode="numeric" value={f.meses} onChange={(e) => set('meses', e.target.value)} />
                </div>
              </>
            )}

            {f.tipo === 'administracao' && (
              <>
                {usaOrcamento ? (
                  <div className="campo">
                    <label htmlFor="p-base">Base de cálculo da taxa</label>
                    <select id="p-base" value={f.baseAdm} onChange={(e) => set('baseAdm', e.target.value as Form['baseAdm'])}>
                      <option value="custo_direto">Custo direto da obra</option>
                      <option value="valor_obra">Valor da obra (com BDI)</option>
                    </select>
                  </div>
                ) : (
                  <div className="campo">
                    <label htmlFor="p-basev">Valor da obra sobre o qual incide a taxa (R$)</label>
                    <input id="p-basev" inputMode="decimal" value={f.valorBaseInformado} onChange={(e) => set('valorBaseInformado', e.target.value)} />
                  </div>
                )}
                <div className="campo">
                  <label htmlFor="p-taxa">Taxa de administração (%)</label>
                  <input id="p-taxa" inputMode="decimal" value={f.taxaPct} onChange={(e) => set('taxaPct', e.target.value)} />
                </div>
                <div className="campo">
                  <label htmlFor="p-meses2">Parcelas mensais (meses)</label>
                  <input id="p-meses2" inputMode="numeric" value={f.meses} onChange={(e) => set('meses', e.target.value)} />
                </div>
              </>
            )}

            {f.tipo === 'preco_global' && (
              <div className="campo">
                <label htmlFor="p-valor">Valor do contrato (R$)</label>
                {usaOrcamento ? (
                  <input id="p-valor" value={obra ? formatarMoeda(obra.valorObra) : ''} disabled />
                ) : (
                  <input id="p-valor" inputMode="decimal" value={f.valorInformado} onChange={(e) => set('valorInformado', e.target.value)} />
                )}
              </div>
            )}

            {f.tipo === 'preco_unitario' && (
              <div className="campo">
                <label htmlFor="p-nparc">Número de parcelas mensais</label>
                <input id="p-nparc" inputMode="numeric" value={f.numeroParcelas} onChange={(e) => set('numeroParcelas', e.target.value)} />
              </div>
            )}

            {f.tipo === 'laudo' && (
              <>
                <div className="campo">
                  <label htmlFor="p-entrada">Entrada na aceitação (%)</label>
                  <input id="p-entrada" inputMode="decimal" value={f.entradaPct} onChange={(e) => set('entradaPct', e.target.value)} />
                </div>
                <div className="campo">
                  <label htmlFor="p-prazoent">Prazo de entrega dos laudos (dias)</label>
                  <input id="p-prazoent" inputMode="numeric" value={f.prazoEntregaDias} onChange={(e) => set('prazoEntregaDias', e.target.value)} />
                </div>
                <p className="small muted" style={{ gridColumn: '1 / -1', margin: 0 }}>
                  {(() => {
                    const ent = Math.min(100, Math.max(0, lerNumero(f.entradaPct) ?? 0));
                    return `Pagamento: ${ent.toLocaleString('pt-BR')}% na aceitação e ${(100 - ent).toLocaleString('pt-BR')}% na entrega dos laudos. Padrão: 50% + 50%.`;
                  })()}
                </p>
              </>
            )}
          </div>

          {f.tipo === 'laudo' && (
            <div className="card" style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 14, margin: '0 0 4px' }}>Textos da proposta</h3>
              <p className="small muted" style={{ margin: '0 0 10px' }}>Preencha o que deve aparecer na impressão. Campo vazio sai como linha em branco para escrever à mão.</p>
              <div className="campos">
                {CAMPOS_LAUDO.map((c) => (
                  <div className="campo" key={c.id} style={c.largo ? { gridColumn: '1 / -1' } : undefined}>
                    <label htmlFor={`cl-${c.id}`}>{c.rotulo}</label>
                    <input id={`cl-${c.id}`} value={f.campos[c.id] ?? ''} placeholder={c.exemplo} onChange={(e) => set('campos', { ...f.campos, [c.id]: e.target.value })} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {f.tipo === 'preco_global' && (
            <>
              <h3 style={{ fontSize: 14, margin: '16px 0 6px' }}>Marcos de pagamento</h3>
              {f.marcos.map((m, i) => (
                <div key={i} className="editor-linha" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 110px 120px auto', gap: 8, alignItems: 'end', marginBottom: 8 }}>
                  <div className="campo">
                    <label htmlFor={`m-d-${i}`}>Marco</label>
                    <input id={`m-d-${i}`} value={m.descricao} onChange={(e) => atualizarMarco(i, { descricao: e.target.value })} placeholder="Ex.: Fundação concluída" />
                  </div>
                  <div className="campo">
                    <label htmlFor={`m-p-${i}`}>% do valor</label>
                    <input id={`m-p-${i}`} inputMode="decimal" value={m.percentual} onChange={(e) => atualizarMarco(i, { percentual: e.target.value })} />
                  </div>
                  <div className="campo">
                    <label htmlFor={`m-n-${i}`}>Dias após o início</label>
                    <input id={`m-n-${i}`} inputMode="numeric" value={m.dias} onChange={(e) => atualizarMarco(i, { dias: e.target.value })} />
                  </div>
                  <button type="button" className="btn btn-link" onClick={() => set('marcos', f.marcos.filter((_, k) => k !== i))} disabled={f.marcos.length === 1}>Remover</button>
                </div>
              ))}
              <div className="acoes" style={{ justifyContent: 'space-between' }}>
                <button type="button" className="btn btn-secundario" onClick={() => set('marcos', [...f.marcos, { descricao: '', percentual: '', dias: '' }])}>Adicionar marco</button>
                <span className="small" style={{ color: Math.abs(somaMarcos - 100) < 0.001 ? undefined : 'var(--erro, #b42318)' }}>
                  Soma dos marcos: {somaMarcos.toLocaleString('pt-BR')}% (precisa ser 100%)
                </span>
              </div>
            </>
          )}

          {mostraItens && (
            <>
              <h3 style={{ fontSize: 14, margin: '16px 0 6px' }}>{f.tipo === 'laudo' ? 'Laudos' : 'Serviços'}</h3>
              {f.itens.length === 0 && <p className="muted small">Nenhum item. Adicione ao menos um.</p>}
              {f.itens.map((it, i) => {
                const subtotal = (lerNumero(it.quantidade) ?? 0) * (lerNumero(it.precoUnitario) ?? 0);
                return (
                  <div key={i} className="editor-linha" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) 110px 80px 120px 120px auto', gap: 8, alignItems: 'end', marginBottom: 8 }}>
                    {precoDoOrcamento ? (
                      <div className="campo">
                        <label htmlFor={`i-s-${i}`}>Serviço do orçamento</label>
                        <select id={`i-s-${i}`} value={it.obraItemId ?? ''} onChange={(e) => escolherServico(i, e.target.value)}>
                          <option value="">{obra ? 'Escolha o serviço' : 'Escolha a obra primeiro'}</option>
                          {servicos.map((s) => (
                            <option key={s.id} value={s.id}>{s.codigo} · {s.descricao}</option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div className="campo">
                        <label htmlFor={`i-d-${i}`}>{f.tipo === 'laudo' ? 'Laudo' : 'Serviço'}</label>
                        <input id={`i-d-${i}`} value={it.descricao} onChange={(e) => atualizarItem(i, { descricao: e.target.value })} />
                      </div>
                    )}
                    <div className="campo">
                      <label htmlFor={`i-q-${i}`}>Quantidade</label>
                      <input id={`i-q-${i}`} inputMode="decimal" value={it.quantidade} onChange={(e) => atualizarItem(i, { quantidade: e.target.value })} />
                    </div>
                    <div className="campo">
                      <label htmlFor={`i-u-${i}`}>Unidade</label>
                      <input id={`i-u-${i}`} value={it.unidade} onChange={(e) => atualizarItem(i, { unidade: e.target.value })} />
                    </div>
                    <div className="campo">
                      <label htmlFor={`i-p-${i}`}>Preço unitário</label>
                      <input id={`i-p-${i}`} inputMode="decimal" value={it.precoUnitario} disabled={precoDoOrcamento && !!it.obraItemId} onChange={(e) => atualizarItem(i, { precoUnitario: e.target.value })} />
                    </div>
                    <div className="campo">
                      <label>Subtotal</label>
                      <input value={formatarMoeda(subtotal)} disabled />
                    </div>
                    <button type="button" className="btn btn-link" onClick={() => removerItem(i)}>Remover</button>
                  </div>
                );
              })}
              <button type="button" className="btn btn-secundario" onClick={() => set('itens', [...f.itens, novaLinha()])}>Adicionar {f.tipo === 'laudo' ? 'laudo' : 'serviço'}</button>
            </>
          )}

          <h2 style={{ fontSize: 16, margin: '20px 0 8px' }}>4. Condições gerais</h2>
          <div className="campo">
            <textarea id="p-cond" rows={4} value={f.condicoes} onChange={(e) => set('condicoes', e.target.value)} placeholder="Forma de pagamento, reajuste, responsabilidades, exclusões…" />
          </div>

          <div className="acoes" style={{ marginTop: 16 }}>
            <button type="submit" className="btn btn-primario" disabled={ocupado || !op}>{ocupado ? 'Salvando…' : 'Salvar rascunho'}</button>
            <Link className="btn btn-secundario" to={editando ? `/com/propostas/${editando.id}` : '/com/propostas'}>Cancelar</Link>
          </div>
        </form>

        <aside className="card" style={{ position: 'sticky', top: 16 }}>
          <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Prévia do cálculo</h2>
          {erroPrevia && <div className="alerta alerta-aviso" style={{ marginBottom: 8 }}>{erroPrevia}</div>}
          {previa ? (
            <>
              <div className="small muted">Valor total da proposta</div>
              <div style={{ fontSize: 24, fontWeight: 600, marginBottom: 12 }}>{formatarMoeda(previa.valorTotal)}</div>
              {previa.parcelas.length > 0 && (
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Parcela</th>
                      <th>Vencimento</th>
                      <th className="num">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previa.parcelas.map((p, i) => (
                      <tr key={i}>
                        <td>{p.descricao}</td>
                        <td>{formatarData(p.vencimento)}</td>
                        <td className="num">{formatarMoeda(p.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="small muted" style={{ marginTop: 10 }}>
                Ao ser aceita pelo cliente, a proposta gera o contrato e estes lançamentos em contas a receber.
              </p>
            </>
          ) : (
            !erroPrevia && <p className="muted small">Preencha os campos para ver o cálculo.</p>
          )}
        </aside>
      </div>
    </>
  );
}

export function PropostaNova() {
  return <PropostaForm />;
}

export function PropostaEditar() {
  const { id } = useParams();
  const [p, setP] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    api<{ proposta: Detalhe }>(`/com/obra-propostas/${id}`)
      .then((r) => setP(r.proposta))
      .catch((e) => setErro((e as Error).message));
  }, [id]);

  if (erro) return <ErroCampo erro={erro} />;
  if (!p) return <p className="muted">Carregando…</p>;
  if (p.status !== 'rascunho') return <div className="alerta alerta-aviso">Só é possível editar proposta em rascunho.</div>;
  return <PropostaForm key={p.id} editando={p} />;
}

export function PropostaDetalhe() {
  const { id } = useParams();
  const { usuario } = useSessao();
  const pode = gestao(usuario?.perfil);
  const [p, setP] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [contrato, setContrato] = useState<{ numero: number } | null>(null);
  const [revisao, setRevisao] = useState<{ resumo: string; problemas: { campo: string; trecho: string; tipo: string; gravidade: 'erro' | 'atencao' | 'sugestao'; explicacao: string; sugestao: string }[] } | null>(null);
  const [revisando, setRevisando] = useState(false);
  async function revisarIa() {
    if (!id) return;
    setRevisando(true);
    setErro('');
    try {
      setRevisao(await api(`/com/obra-propostas/${id}/revisar-ia`, { metodo: 'POST', corpo: {} }));
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setRevisando(false);
    }
  }

  function carregar() {
    api<{ proposta: Detalhe }>(`/com/obra-propostas/${id}`)
      .then((r) => setP(r.proposta))
      .catch((e) => setErro((e as Error).message));
  }

  useEffect(() => {
    carregar();
  }, [id]);

  async function acao(caminho: string, confirmacao?: string) {
    if (confirmacao && !window.confirm(confirmacao)) return;
    setErro('');
    setOcupado(true);
    try {
      const r = await api<{ ok?: boolean; contrato?: { numero: number } }>(`/com/obra-propostas/${id}${caminho}`, { metodo: 'POST' });
      if (r.contrato) setContrato(r.contrato);
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  if (!p) return erro ? <ErroCampo erro={erro} /> : <p className="muted">Carregando…</p>;
  const info = infoTipo(p.tipo);
  const q = p.parametros ?? {};
  const aceitavel = p.status === 'enviada' && pode;

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Proposta {numeroFmt(p.numero)} · {p.tipoNome}</h1>
          <span className="muted">{p.titulo}</span>
        </div>
        <div className="acoes">
          <span className={`selo ${SELO[p.status]}`}>{ROTULO[p.status]}</span>
          {p.status === 'rascunho' && <Link className="btn btn-secundario" to={`/com/propostas/${p.id}/editar`}>Editar</Link>}
          <Link className="btn btn-secundario" to={`/com/propostas/${p.id}/imprimir`}>Imprimir</Link>
          {pode && <button type="button" className="btn btn-secundario" disabled={revisando} onClick={revisarIa}>{revisando ? 'Revisando…' : 'Revisar com IA'}</button>}
          {p.status === 'rascunho' && <button type="button" className="btn btn-primario" disabled={ocupado} onClick={() => acao('/enviar')}>Marcar como enviada</button>}
          {aceitavel && (
            <button
              type="button"
              className="btn btn-primario"
              disabled={ocupado}
              onClick={() => acao('/aceitar', 'Aceitar esta proposta gera o contrato e os lançamentos a receber. Confirmar?')}
            >
              Registrar aceitação
            </button>
          )}
          {aceitavel && <button type="button" className="btn btn-secundario" disabled={ocupado} onClick={() => acao('/recusar', 'Registrar a recusa desta proposta?')}>Registrar recusa</button>}
          {(p.status === 'rascunho' || p.status === 'enviada') && (
            <button type="button" className="btn btn-link" disabled={ocupado} onClick={() => acao('/cancelar', 'Cancelar esta proposta?')}>Cancelar proposta</button>
          )}
        </div>
      </div>
      <ErroCampo erro={erro} />
      {revisao && (
        <div className="card" style={{ marginBottom: 12 }} role="status">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
            <div>
              <strong>Revisão por IA</strong>
              <p className="small" style={{ margin: '4px 0 0' }}>{revisao.resumo}</p>
            </div>
            <button type="button" className="btn btn-link" onClick={() => setRevisao(null)}>Fechar</button>
          </div>
          {revisao.problemas.length === 0 ? (
            <p className="small muted" style={{ marginTop: 8 }}>Nenhum problema encontrado no texto.</p>
          ) : (
            <ul style={{ marginTop: 8, paddingLeft: 18 }}>
              {revisao.problemas.map((x, i) => (
                <li key={i} style={{ marginBottom: 8 }}>
                  <span className={`selo ${x.gravidade === 'erro' ? 'selo-perigo' : x.gravidade === 'atencao' ? 'selo-aviso' : 'selo-neutro'}`}>
                    {x.gravidade === 'erro' ? 'Erro' : x.gravidade === 'atencao' ? 'Atenção' : 'Sugestão'}
                  </span>{' '}
                  <strong>{x.campo}</strong> · {x.tipo}
                  <div className="small">Trecho: “{x.trecho}”</div>
                  <div className="small">{x.explicacao}</div>
                  <div className="small"><strong>Sugestão:</strong> {x.sugestao}</div>
                </li>
              ))}
            </ul>
          )}
          <p className="small muted" style={{ marginTop: 8 }}>A IA só aponta. Corrija na edição da proposta, se for o caso.</p>
        </div>
      )}
      {contrato && (
        <div className="alerta" role="status">
          Proposta aceita. Contrato nº {numeroFmt(contrato.numero)} gerado e lançamentos criados em{' '}
          {pode ? <Link to="/fin/pagar-receber">contas a pagar e receber</Link> : 'contas a receber'}.
        </div>
      )}
      {p.status === 'aceita' && p.contratoNumero && !contrato && (
        <div className="alerta" role="status">
          Contrato nº {numeroFmt(p.contratoNumero)} gerado; lançamentos criados em contas a receber.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(260px, 340px)', gap: 16, alignItems: 'start' }}>
        <div className="card">
          <div className="campos">
            <div className="campo"><span className="small muted">Cliente</span><div>{p.clienteNome}</div></div>
            <div className="campo"><span className="small muted">Obra</span><div>{p.obraCodigo ?? '—'}</div></div>
            <div className="campo"><span className="small muted">Origem do preço</span><div>{p.origemPreco === 'orcamento' ? 'Orçamento da obra' : 'Informado'}</div></div>
            <div className="campo"><span className="small muted">Validade</span><div>{p.validadeDias} dias</div></div>
            <div className="campo"><span className="small muted">Prazo de execução</span><div>{p.prazoDias ? `${p.prazoDias} dias` : '—'}</div></div>
            <div className="campo"><span className="small muted">Endereço</span><div>{p.endereco || '—'}</div></div>
          </div>
          {p.objeto && <p style={{ whiteSpace: 'pre-wrap', marginTop: 12 }}>{p.objeto}</p>}
          <p className="small muted" style={{ marginTop: 8 }}>{info.ajuda}</p>

          {p.tipo === 'acompanhamento' && (
            <p className="small">
              {q.modo === 'percentual_obra' ? `${q.percentualObra}% do valor da obra` : `Honorário mensal de ${formatarMoeda(Number(q.honorarioMensal))}`} · {q.meses} meses
            </p>
          )}
          {p.tipo === 'administracao' && (
            <p className="small">Taxa de {q.taxaPct}% sobre {q.baseAdm === 'valor_obra' ? 'o valor da obra' : 'o custo direto'} · {q.meses} parcelas mensais</p>
          )}

          {p.itens.length > 0 && (
            <>
              <h3 style={{ fontSize: 14, margin: '16px 0 6px' }}>{p.tipo === 'laudo' ? 'Laudos' : 'Serviços'}</h3>
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Descrição</th>
                    <th className="num">Quantidade</th>
                    <th>Unidade</th>
                    <th className="num">Preço unit.</th>
                    <th className="num">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {p.itens.map((i, k) => (
                    <tr key={k}>
                      <td>{i.descricao}</td>
                      <td className="num">{i.quantidade.toLocaleString('pt-BR')}</td>
                      <td>{i.unidade}</td>
                      <td className="num">{formatarMoeda(i.precoUnitario)}</td>
                      <td className="num">{formatarMoeda(i.quantidade * i.precoUnitario)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {p.condicoes && (
            <>
              <h3 style={{ fontSize: 14, margin: '16px 0 6px' }}>Condições</h3>
              <p style={{ whiteSpace: 'pre-wrap' }}>{p.condicoes}</p>
            </>
          )}
        </div>

        <aside className="card">
          <div className="small muted">Valor total</div>
          <div style={{ fontSize: 24, fontWeight: 600, marginBottom: 12 }}>{formatarMoeda(p.valorTotal)}</div>
          <table className="tabela">
            <thead>
              <tr>
                <th>Recebimento</th>
                <th>Vencimento</th>
                <th className="num">Valor</th>
              </tr>
            </thead>
            <tbody>
              {p.parcelas.map((x, i) => (
                <tr key={i}>
                  <td>{x.descricao}</td>
                  <td>{formatarData(x.vencimento)}</td>
                  <td className="num">{formatarMoeda(x.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted" style={{ marginTop: 10 }}>
            {p.enviadaEm ? `Enviada em ${formatarData(p.enviadaEm.slice(0, 10))}. ` : ''}
            {p.decididaEm ? `Decidida em ${formatarData(p.decididaEm.slice(0, 10))}.` : ''}
          </p>
        </aside>
      </div>
    </>
  );
}


// Valor por extenso (reais e centavos), para o texto do modelo de laudo.
const UNIDADES_EXT = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS_EXT = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS_EXT = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
function ate999(n: number): string {
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100);
  const r = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CENTENAS_EXT[c]);
  if (r) partes.push(r < 20 ? UNIDADES_EXT[r] : DEZENAS_EXT[Math.floor(r / 10)] + (r % 10 ? ` e ${UNIDADES_EXT[r % 10]}` : ''));
  return partes.join(' e ');
}
function porExtenso(n: number): string {
  if (n === 0) return 'zero';
  const partes: string[] = [];
  const mi = Math.floor(n / 1000000);
  const mil = Math.floor((n % 1000000) / 1000);
  const resto = n % 1000;
  if (mi) partes.push(mi === 1 ? 'um milhão' : `${ate999(mi)} milhões`);
  if (mil) partes.push(mil === 1 ? 'mil' : `${ate999(mil)} mil`);
  if (resto) partes.push(ate999(resto));
  return partes.join(' e ');
}
function valorExtenso(valor: number): string {
  const reais = Math.floor(valor);
  const centavos = Math.round((valor - reais) * 100);
  let t = `${porExtenso(reais)} ${reais === 1 ? 'real' : 'reais'}`;
  if (centavos) t += ` e ${porExtenso(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`;
  return t;
}

/** Texto padrão de proposta técnica para laudos, pronto para impressão com linhas de assinatura. */
function LaudoImpressao({ p, nomeEmpresa }: { p: Detalhe; nomeEmpresa: string }) {
  const q = p.parametros ?? {};
  const entrada = p.parcelas.find((x) => x.descricao.startsWith('Entrada'));
  const saldo = p.parcelas.find((x) => x.descricao.startsWith('Saldo'));
  const pctEntrada = Number(q.entradaPct ?? 0);
  const linha = (n: number) => <span style={{ display: 'inline-block', minWidth: n, borderBottom: '1px solid currentColor' }}>&nbsp;</span>;
  const c = (q.campos ?? {}) as Record<string, string>;
  const preenchido = (k: string, n: number) => (c[k]?.trim() ? <>{c[k].trim()}</> : linha(n));
  const secao = (t: string) => <h3 style={{ fontSize: 14, margin: '14px 0 6px' }}>{t}</h3>;
  return (
    <div className="pagina romaneio">
      <CabecalhoDocumento
        modulo="Comercial"
        titulo={`Proposta técnica nº ${numeroFmt(p.numero)} · ${p.titulo}`}
        descricao="Laudos técnicos"
        filtros={[`Cliente: ${p.clienteNome ?? '—'}`, `CPF/CNPJ: ${c.documentoCliente?.trim() || ' '.repeat(20)}`, p.obraCodigo ? `Obra: ${p.obraCodigo}` : 'Sem obra vinculada', `Emissão: ${formatarData(p.criadoEm)}`, `Validade: ${p.validadeDias} dias`]}
      />
      <p style={{ margin: '0 0 6px' }}><strong>Obra:</strong> {p.endereco || '—'}</p>

      {secao('1. Objeto')}
      <p style={{ whiteSpace: 'pre-wrap' }}>{p.objeto || '—'}</p>

      {secao('2. Escopo técnico')}
      <p>2.1. A execução seguirá as normas técnicas brasileiras aplicáveis (ABNT), as especificações do projeto e as boas práticas de engenharia.</p>
      <p>2.2. Os laudos incluídos nesta proposta são:</p>
      <ol>
        {p.itens.map((i, k) => (
          <li key={k}>{i.descricao}{Number(i.quantidade) !== 1 ? ` (${Number(i.quantidade).toLocaleString('pt-BR')} ${i.unidade || 'un'})` : ''}</li>
        ))}
      </ol>
      <p>2.3. Não estão incluídos nesta proposta: {preenchido('naoIncluidos', 320)}</p>

      {secao('3. Prazo')}
      <p>3.1. Prazo de entrega dos laudos: {q.prazoEntregaDias ?? p.prazoDias ?? '—'} dias corridos, contados da aceitação.</p>
      <p>3.2. Eventuais atrasos causados pelo cliente, por condições climáticas adversas ou por alterações de escopo serão tratados por aditivo de prazo.</p>

      {secao('4. Preço e forma de pagamento')}
      <p>4.1. Valor total: <strong>{formatarMoeda(p.valorTotal)} ({valorExtenso(p.valorTotal)})</strong>.</p>
      <p>
        4.2. Forma de pagamento: {pctEntrada.toLocaleString('pt-BR')}% na aceitação da proposta
        {entrada ? ` (${formatarMoeda(entrada.valor)})` : ''} e {(100 - pctEntrada).toLocaleString('pt-BR')}% na entrega dos laudos
        {saldo ? ` (${formatarMoeda(saldo.valor)})` : ''}.
      </p>
      <p>4.3. Os pagamentos serão realizados por {preenchido('meioPagamento', 160)}, com vencimentos conforme o quadro abaixo.</p>
      {p.parcelas.length > 0 && (
        <table className="tabela">
          <thead><tr><th>Pagamento</th><th>Vencimento</th><th className="num">Valor</th></tr></thead>
          <tbody>
            {p.parcelas.map((x, i) => (
              <tr key={i}><td>{x.descricao}</td><td>{formatarData(x.vencimento)}</td><td className="num">{formatarMoeda(x.valor)}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <p>4.4. O atraso no pagamento sujeitará o valor em aberto a multa de 2% e juros de 1% ao mês, além de correção monetária pelo índice {preenchido('indiceCorrecao', 120)}.</p>

      {secao('5. Responsabilidades')}
      <p>5.1. Cabe à contratada: a execução técnica dos laudos e a emissão dos documentos técnicos acordados.</p>
      <p>5.2. Cabe ao cliente: franquear o acesso ao local, fornecer as informações e os projetos necessários e efetuar os pagamentos no prazo.</p>

      {secao('6. Reajuste')}
      <p>{preenchido('reajuste', 420)}</p>

      {secao('7. Aceite')}
      <p>7.1. A aceitação desta proposta, por escrito ou pelo pagamento da primeira parcela, implica a concordância com todas as condições acima.</p>
      <p>7.2. Após a aceitação, será gerado o contrato de prestação de serviços, que prevalecerá sobre esta proposta.</p>

      {secao('8. Foro')}
      <p>Fica eleito o foro da comarca de {preenchido('cidadeForo', 200)} para dirimir eventuais questões decorrentes desta proposta.</p>

      <p style={{ marginTop: 16 }}>{preenchido('cidadeForo', 200)}, {linha(40)} de {linha(120)} de {linha(60)}.</p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, marginTop: 36 }}>
        <Assinatura nome={nomeEmpresa} papel="Pela contratada" detalhe={<>Responsável técnico: {c.responsavelTecnico?.trim() || linha(200)}<br />CREA: {c.crea?.trim() || linha(120)}</>} />
        <Assinatura nome={p.clienteNome ?? 'Cliente'} papel="Pelo cliente" detalhe={<>CPF/CNPJ: {c.documentoCliente?.trim() || linha(160)}</>} />
      </div>

      <p style={{ marginTop: 28, fontWeight: 600 }}>Testemunhas</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, marginTop: 24 }}>
        <p>1. {linha(260)}<br />CPF: {linha(180)}</p>
        <p>2. {linha(260)}<br />CPF: {linha(180)}</p>
      </div>
      <p className="small muted" style={{ marginTop: 16 }}>Proposta válida por {p.validadeDias} dias a partir da emissão.</p>
      <Link className="btn btn-secundario nao-imprimir" to={`/com/propostas/${p.id}`} style={{ marginTop: 16 }}>Voltar à proposta</Link>
    </div>
  );
}

/** Proposta para impressão: cabeçalho do sistema, cliente, objeto, preço, pagamento e assinaturas. */
export function PropostaImprimir() {
  const { id } = useParams();
  const { empresa } = useSessao();
  const [p, setP] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    api<{ proposta: Detalhe }>(`/com/obra-propostas/${id}`)
      .then((r) => setP(r.proposta))
      .catch((e) => setErro((e as Error).message));
  }, [id]);
  if (erro) return <ErroCampo erro={erro} />;
  if (!p) return <p className="muted">Carregando…</p>;
  const q = p.parametros ?? {};
  const nomeEmpresa = empresa?.nomeFantasia || empresa?.razaoSocial || 'Empresa';
  if (p.tipo === 'laudo') return <LaudoImpressao p={p} nomeEmpresa={nomeEmpresa} />;
  return (
    <div className="pagina romaneio">
      <CabecalhoDocumento
        modulo="Comercial"
        titulo={`Proposta nº ${numeroFmt(p.numero)} · ${p.titulo}`}
        descricao={p.tipoNome}
        filtros={[
          `Cliente: ${p.clienteNome ?? '—'}`,
          p.obraCodigo ? `Obra: ${p.obraCodigo}` : 'Sem obra vinculada',
          `Validade: ${p.validadeDias} dias`,
          p.prazoDias ? `Prazo de execução: ${p.prazoDias} dias` : '',
        ].filter(Boolean)}
      />
      {p.objeto && (
        <section style={{ marginBottom: 14 }}>
          <h3>Objeto</h3>
          <p style={{ whiteSpace: 'pre-wrap' }}>{p.objeto}</p>
          {p.endereco && <p className="small">Endereço da obra: {p.endereco}</p>}
        </section>
      )}
      {p.itens.length > 0 && (
        <section style={{ marginBottom: 14 }}>
          <h3>{p.tipo === 'laudo' ? 'Laudos' : 'Serviços'}</h3>
          <table className="tabela">
            <thead><tr><th>Descrição</th><th>Unid.</th><th className="num">Qtd.</th><th className="num">Preço unit.</th><th className="num">Total</th></tr></thead>
            <tbody>
              {p.itens.map((i, k) => (
                <tr key={k}>
                  <td>{i.descricao}</td><td>{i.unidade || '—'}</td>
                  <td className="num">{Number(i.quantidade).toLocaleString('pt-BR')}</td>
                  <td className="num">{formatarMoeda(i.precoUnitario)}</td>
                  <td className="num">{formatarMoeda(i.quantidade * i.precoUnitario)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {p.tipo === 'acompanhamento' && (
        <p className="small">Forma de cobrança: {q.modo === 'percentual_obra' ? `${q.percentualObra}% do valor da obra, em ${q.meses} parcelas mensais` : `honorário mensal de ${formatarMoeda(Number(q.honorarioMensal))} por ${q.meses} meses`}.</p>
      )}
      <section style={{ marginBottom: 14 }}>
        <h3>Valor total: {formatarMoeda(p.valorTotal)}</h3>
        {p.parcelas.length > 0 && (
          <table className="tabela">
            <thead><tr><th>Pagamento</th><th>Vencimento</th><th className="num">Valor</th></tr></thead>
            <tbody>
              {p.parcelas.map((x, i) => (
                <tr key={i}><td>{x.descricao}</td><td>{formatarData(x.vencimento)}</td><td className="num">{formatarMoeda(x.valor)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {p.condicoes && (
        <section style={{ marginBottom: 14 }}>
          <h3>Condições gerais</h3>
          <p style={{ whiteSpace: 'pre-wrap' }}>{p.condicoes}</p>
        </section>
      )}
      <p className="small muted">Proposta válida por {p.validadeDias} dias a partir da emissão.</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, marginTop: 40 }}>
        <Assinatura nome={nomeEmpresa} papel="Pela contratada" />
        <Assinatura nome={p.clienteNome ?? 'Cliente'} papel="Pelo cliente" />
      </div>
      <Link className="btn btn-secundario nao-imprimir" to={`/com/propostas/${p.id}`} style={{ marginTop: 16 }}>Voltar à proposta</Link>
    </div>
  );
}
