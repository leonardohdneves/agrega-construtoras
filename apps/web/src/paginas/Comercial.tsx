// Módulo Comercial: vendas lançadas pelo vendedor, aprovação do dono ou gestor e relatórios por vendedor e por cliente.
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  api,
  diaCurto,
  formatarData,
  formatarDataHora,
  formatarMoeda,
  formatarNumero,
  hojeLocal,
  lerNumero,
  moedaCampo,
  SELO_VENDA,
  somarDias,
  type StatusVenda,
  type Venda,
} from '../api';
import { TabelaRelatorio } from '../componentes/Relatorio';
import { SeletorPeriodo, type Periodo } from '../componentes/Periodo';
import { useSessao } from '../sessao';
import { podeAcessar } from '../acesso';

const m3 = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${formatarNumero(n, Number.isInteger(n) ? 0 : 1)} m³`);
const campoNum = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n).replace('.', ','));

type Opcoes = {
  clientes: { id: string; nome: string; cidade: string | null }[];
  tracos: { id: string; codigo: string; descricao: string | null; fck: number | null; slump: string | null }[];
  vendedores: { id: string; nome: string }[];
  ultimoPreco: Record<string, number>;
  gestao: boolean;
};

function Selo({ s }: { s: StatusVenda }) {
  return <span className={`selo ${SELO_VENDA[s].classe}`}>{SELO_VENDA[s].texto}</span>;
}

/** Barra de entrega: quanto do volume vendido já saiu da usina. */
export function BarraEntrega({ v }: { v: Pick<Venda, 'volume' | 'entregue'> }) {
  const pct = v.volume ? Math.min(100, Math.round((v.entregue / v.volume) * 100)) : 0;
  return (
    <div className="barra-entrega" title={`${m3(v.entregue)} de ${m3(v.volume)}`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------- formulário
type Dados = {
  vendedorId: string;
  clienteId: string;
  obra: string;
  endereco: string;
  contato: string;
  tracoId: string;
  volume: string;
  dataEntrega: string;
  horaEntrega: string;
  bombeamento: boolean;
  precoM3: string;
  taxaBomba: string;
  formaPagamento: string;
  prazos: string;
  observacoes: string;
};

const FORMAS: [string, string][] = [['boleto', 'Boleto'], ['pix', 'PIX'], ['transferencia', 'Transferência'], ['cartao', 'Cartão'], ['dinheiro', 'Dinheiro'], ['cheque', 'Cheque'], ['permuta', 'Permuta']];
const PRAZOS_RAPIDOS: [string, string][] = [['0', 'À vista'], ['28', '28 dias'], ['30/60', '30/60'], ['30/60/90', '30/60/90']];
/** "30/60" → [30, 60]; "à vista" ou "0" → [0]. */
export function lerPrazos(t: string): number[] | null {
  const x = t.trim().toLowerCase();
  if (!x) return null;
  if (/vista/.test(x)) return [0];
  const v = x.split(/[\/;,+ ]+/).filter(Boolean).map(Number);
  return v.length && v.every((n) => Number.isInteger(n) && n >= 0 && n <= 365) ? v : null;
}
export const textoPrazos = (p: number[] | null) => (!p?.length ? '—' : p.length === 1 && p[0] === 0 ? 'À vista' : `${p.join('/')} dias`);

function deVenda(v: Venda): Dados {
  return {
    vendedorId: v.vendedorId,
    clienteId: v.clienteId,
    obra: v.obra ?? '',
    endereco: v.endereco ?? '',
    contato: v.contato ?? '',
    tracoId: v.tracoId,
    volume: campoNum(v.volume),
    dataEntrega: v.dataEntrega,
    horaEntrega: v.horaEntrega ?? '',
    bombeamento: v.bombeamento,
    precoM3: moedaCampo(v.precoM3),
    taxaBomba: v.taxaBomba === null ? '' : moedaCampo(v.taxaBomba),
    formaPagamento: v.formaPagamento ?? 'boleto',
    prazos: v.prazosDias?.join('/') ?? '',
    observacoes: v.observacoes ?? '',
  };
}

/** Dados vindos de uma proposta aceita: o formulário de venda já abre preenchido. */
export type PropostaBase = { propostaId: string; numero: number; clienteId: string; tracoId: string; obra: string | null; endereco: string | null; volume: number; precoM3: number; condicoes: string | null };

function FormVenda({ editando, inicial }: { editando?: Venda; inicial?: PropostaBase }) {
  const navegar = useNavigate();
  const [op, setOp] = useState<Opcoes | null>(null);
  const [d, setD] = useState<Dados>(() =>
    editando
      ? deVenda(editando)
      : {
          vendedorId: '', clienteId: inicial?.clienteId ?? '', obra: inicial?.obra ?? '', endereco: inicial?.endereco ?? '', contato: '', tracoId: inicial?.tracoId ?? '',
          volume: inicial ? String(inicial.volume).replace('.', ',') : '', dataEntrega: somarDias(hojeLocal(), 1), horaEntrega: '07:30', bombeamento: false,
          precoM3: inicial ? String(inicial.precoM3).replace('.', ',') : '', taxaBomba: '', formaPagamento: 'boleto', prazos: '28',
          observacoes: inicial ? `Venda da proposta nº ${String(inicial.numero).padStart(4, '0')}.` : '',
        },
  );
  const [novoCliente, setNovoCliente] = useState<{ razaoSocial: string; cnpjCpf: string; telefone: string; cidade: string; uf: string } | null>(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    api<Opcoes>('/com/opcoes').then(setOp).catch((e) => setErro((e as Error).message));
  }, []);

  const volume = lerNumero(d.volume) ?? 0;
  const preco = lerNumero(d.precoM3) ?? 0;
  const taxa = d.bombeamento ? (lerNumero(d.taxaBomba) ?? 0) : 0;
  const total = Math.round((volume * preco + taxa) * 100) / 100;
  const referencia = d.tracoId ? op?.ultimoPreco[d.tracoId] : undefined;

  function escolherTraco(id: string) {
    setD((x) => ({ ...x, tracoId: id, precoM3: x.precoM3 || (op?.ultimoPreco[id] ? moedaCampo(op.ultimoPreco[id]) : '') }));
  }

  async function criarCliente() {
    if (!novoCliente) return;
    setErro('');
    try {
      const r = await api<{ cliente: Opcoes['clientes'][number] }>('/com/clientes', { corpo: novoCliente });
      setOp((o) => (o ? { ...o, clientes: [...o.clientes, r.cliente].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')) } : o));
      setD((x) => ({ ...x, clienteId: r.cliente.id }));
      setNovoCliente(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function salvar(e: FormEvent, enviar: boolean) {
    e.preventDefault();
    setErro('');
    if (!d.clienteId) return setErro('Escolha o cliente.');
    if (!d.tracoId) return setErro('Escolha o traço.');
    if (!volume) return setErro('Informe o volume vendido em m³.');
    if (!d.dataEntrega) return setErro('Informe a data da entrega.');
    if (lerNumero(d.precoM3) === null) return setErro('Informe o preço por m³.');
    const prazos = lerPrazos(d.prazos);
    if (d.prazos.trim() && !prazos) return setErro('Prazos inválidos. Use dias separados por barra, ex.: 28 ou 30/60 (0 = à vista).');
    if (enviar && !prazos) return setErro('Informe a condição de pagamento (prazos em dias).');
    setOcupado(true);
    try {
      const corpo = {
        vendedorId: d.vendedorId || null,
        clienteId: d.clienteId,
        obra: d.obra,
        endereco: d.endereco,
        contato: d.contato,
        tracoId: d.tracoId,
        volume,
        dataEntrega: d.dataEntrega,
        horaEntrega: d.horaEntrega || null,
        bombeamento: d.bombeamento,
        precoM3: preco,
        taxaBomba: d.bombeamento && d.taxaBomba.trim() ? lerNumero(d.taxaBomba) : null,
        formaPagamento: d.formaPagamento || null,
        prazosDias: prazos,
        observacoes: d.observacoes,
        enviar,
      };
      const r = editando
        ? await api<{ venda: Venda }>(`/com/vendas/${editando.id}`, { metodo: 'PUT', corpo })
        : await api<{ venda: Venda }>('/com/vendas', { corpo });
      if (!editando && inicial) await api(`/com/propostas/${inicial.propostaId}/vincular`, { corpo: { vendaId: r.venda.id } }).catch(() => {});
      navegar(`/com/vendas/${r.venda.id}`, {
        replace: true,
        state: { aviso: enviar ? `Venda nº ${String(r.venda.numero).padStart(4, '0')} enviada para aprovação.` : `Venda nº ${String(r.venda.numero).padStart(4, '0')} salva como rascunho.` },
      });
    } catch (err) {
      setErro((err as Error).message);
      setOcupado(false);
    }
  }

  if (!op) return erro ? <div className="alerta alerta-erro" role="alert">{erro}</div> : <p className="muted">Carregando…</p>;
  return (
    <form className="card form" onSubmit={(e) => salvar(e, true)}>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {editando?.status === 'reprovada' && editando.motivo && (
        <div className="alerta alerta-aviso">Reprovada: {editando.motivo}</div>
      )}
      <h2>Cliente e obra</h2>
      <div className="campos">
        <div className="campo">
          <label htmlFor="v-cli">Cliente</label>
          <select id="v-cli" value={d.clienteId} onChange={(e) => setD({ ...d, clienteId: e.target.value })}>
            <option value="">Escolha</option>
            {op.clientes.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}{c.cidade ? ` · ${c.cidade}` : ''}</option>
            ))}
          </select>
          {!novoCliente && (
            <button className="btn btn-link" type="button" style={{ alignSelf: 'flex-start', padding: 0 }} onClick={() => setNovoCliente({ razaoSocial: '', cnpjCpf: '', telefone: '', cidade: '', uf: '' })}>
              + Cliente novo
            </button>
          )}
        </div>
        <div className="campo">
          <label htmlFor="v-obra">Obra</label>
          <input id="v-obra" value={d.obra} placeholder="ex.: Laje do 2º pavimento" onChange={(e) => setD({ ...d, obra: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="v-end">Endereço da entrega</label>
          <input id="v-end" value={d.endereco} onChange={(e) => setD({ ...d, endereco: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="v-cont">Contato na obra</label>
          <input id="v-cont" value={d.contato} placeholder="Nome e telefone" onChange={(e) => setD({ ...d, contato: e.target.value })} />
        </div>
      </div>
      {novoCliente && (
        <div className="caixa-destaque">
          <strong>Cliente novo</strong>
          <div className="campos">
            <div className="campo">
              <label htmlFor="nc-nome">Nome ou razão social</label>
              <input id="nc-nome" value={novoCliente.razaoSocial} onChange={(e) => setNovoCliente({ ...novoCliente, razaoSocial: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="nc-doc">CPF ou CNPJ</label>
              <input id="nc-doc" className="mono" inputMode="numeric" value={novoCliente.cnpjCpf} onChange={(e) => setNovoCliente({ ...novoCliente, cnpjCpf: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="nc-tel">Telefone</label>
              <input id="nc-tel" value={novoCliente.telefone} onChange={(e) => setNovoCliente({ ...novoCliente, telefone: e.target.value })} />
            </div>
            <div className="campo">
              <label htmlFor="nc-cid">Cidade</label>
              <input id="nc-cid" value={novoCliente.cidade} onChange={(e) => setNovoCliente({ ...novoCliente, cidade: e.target.value })} />
            </div>
            <div className="campo" style={{ maxWidth: 90 }}>
              <label htmlFor="nc-uf">UF</label>
              <input id="nc-uf" maxLength={2} value={novoCliente.uf} onChange={(e) => setNovoCliente({ ...novoCliente, uf: e.target.value.toUpperCase() })} />
            </div>
          </div>
          <div className="acoes">
            <button className="btn btn-secundario" type="button" onClick={criarCliente}>Cadastrar cliente</button>
            <button className="btn btn-link" type="button" onClick={() => setNovoCliente(null)}>Voltar</button>
          </div>
          <span className="small muted">O cadastro completo fica em Administrativo › Clientes.</span>
        </div>
      )}

      <h2>Concreto e entrega</h2>
      <div className="campos">
        <div className="campo">
          <label htmlFor="v-traco">Traço</label>
          <select id="v-traco" value={d.tracoId} onChange={(e) => escolherTraco(e.target.value)}>
            <option value="">Escolha</option>
            {op.tracos.map((t) => (
              <option key={t.id} value={t.id}>{t.codigo}{t.descricao ? ` · ${t.descricao}` : ''}</option>
            ))}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="v-vol">Volume (m³)</label>
          <input id="v-vol" className="mono" inputMode="decimal" placeholder="ex.: 24" value={d.volume} onChange={(e) => setD({ ...d, volume: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="v-data">Data da entrega</label>
          <input id="v-data" type="date" value={d.dataEntrega} onChange={(e) => setD({ ...d, dataEntrega: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="v-hora">Hora da primeira carga</label>
          <input id="v-hora" type="time" value={d.horaEntrega} onChange={(e) => setD({ ...d, horaEntrega: e.target.value })} />
        </div>
      </div>
      <label className="marcar">
        <input type="checkbox" checked={d.bombeamento} onChange={(e) => setD({ ...d, bombeamento: e.target.checked })} />
        Entrega com bombeamento
      </label>

      <h2>Preço e pagamento</h2>
      <div className="campos">
        <div className="campo">
          <label htmlFor="v-preco">Preço por m³ (R$)</label>
          <input id="v-preco" className="mono" inputMode="decimal" value={d.precoM3} onChange={(e) => setD({ ...d, precoM3: e.target.value })} />
          {referencia !== undefined && <span className="small muted">Última venda aprovada deste traço: {formatarMoeda(referencia)}/m³</span>}
        </div>
        {d.bombeamento && (
          <div className="campo">
            <label htmlFor="v-taxa">Taxa de bombeamento (R$)</label>
            <input id="v-taxa" className="mono" inputMode="decimal" placeholder="0,00" value={d.taxaBomba} onChange={(e) => setD({ ...d, taxaBomba: e.target.value })} />
          </div>
        )}
        <div className="campo">
          <label htmlFor="v-forma">Forma de pagamento</label>
          <select id="v-forma" value={d.formaPagamento} onChange={(e) => setD({ ...d, formaPagamento: e.target.value })}>
            {FORMAS.map(([k, t]) => (
              <option key={k} value={k}>{t}</option>
            ))}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="v-prazos">Prazos (dias)</label>
          <input id="v-prazos" className="mono" placeholder="ex.: 28 ou 30/60 · 0 = à vista" value={d.prazos} onChange={(e) => setD({ ...d, prazos: e.target.value })} />
          <span className="chips-rapidos">
            {PRAZOS_RAPIDOS.map(([k, t]) => (
              <button key={k} type="button" className={`chip chip-mini ${d.prazos === k ? 'chip-ativo' : ''}`} onClick={() => setD({ ...d, prazos: k })}>{t}</button>
            ))}
          </span>
        </div>
        {op.gestao && op.vendedores.length > 0 && (
          <div className="campo">
            <label htmlFor="v-vend">Vendedor</label>
            <select id="v-vend" value={d.vendedorId} onChange={(e) => setD({ ...d, vendedorId: e.target.value })}>
              <option value="">Eu mesmo</option>
              {op.vendedores.map((v) => (
                <option key={v.id} value={v.id}>{v.nome}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div className="campo">
        <label htmlFor="v-obs">Observações para a usina</label>
        <textarea id="v-obs" rows={2} value={d.observacoes} onChange={(e) => setD({ ...d, observacoes: e.target.value })} />
      </div>

      <div className="total-venda">
        <span className="muted">
          {m3(volume)} × {formatarMoeda(preco)}{taxa ? ` + bombeamento ${formatarMoeda(taxa)}` : ''}
        </span>
        <strong className="mono">{formatarMoeda(total)}</strong>
      </div>

      <div className="acoes">
        <button className="btn btn-primario" type="submit" disabled={ocupado}>Enviar para aprovação</button>
        <button className="btn btn-secundario" type="button" disabled={ocupado} onClick={(e) => salvar(e as unknown as FormEvent, false)}>
          Salvar rascunho
        </button>
        <Link className="btn btn-link" to={editando ? `/com/vendas/${editando.id}` : '/com/vendas'}>Cancelar</Link>
      </div>
      <span className="small muted">Depois de aprovada pelo dono ou pelo gestor, a venda aparece na programação de entregas da Produção.</span>
    </form>
  );
}

export function NovaVenda() {
  const local = useLocation();
  const inicial = (local.state as { proposta?: PropostaBase } | null)?.proposta;
  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Nova venda</h1>
          <span className="muted">{inicial ? `Criada a partir da proposta nº ${String(inicial.numero).padStart(4, '0')}. Confira a data da entrega.` : 'Cliente, concreto, data da entrega e preço.'}</span>
        </div>
      </div>
      <FormVenda inicial={inicial} />
    </>
  );
}

export function EditarVenda() {
  const { id } = useParams();
  const [v, setV] = useState<Venda | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    api<{ venda: Venda }>(`/com/vendas/${id}`).then((r) => setV(r.venda)).catch((e) => setErro((e as Error).message));
  }, [id]);
  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Alterar venda {v ? `nº ${String(v.numero).padStart(4, '0')}` : ''}</h1>
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {v && <FormVenda editando={v} />}
    </>
  );
}

// ---------------------------------------------------------------- lista
const FILTROS: { id: '' | StatusVenda; texto: string }[] = [
  { id: '', texto: 'Todas' },
  { id: 'aguardando_aprovacao', texto: 'Aguardando aprovação' },
  { id: 'aprovada', texto: 'Aprovadas' },
  { id: 'rascunho', texto: 'Rascunhos' },
  { id: 'reprovada', texto: 'Reprovadas' },
  { id: 'concluida', texto: 'Entregues' },
  { id: 'cancelada', texto: 'Canceladas' },
];

export function ComVendas() {
  const { usuario } = useSessao();
  const local = useLocation();
  const gestao = usuario?.perfil === 'dono' || usuario?.perfil === 'gestor';
  const [status, setStatus] = useState<'' | StatusVenda>('');
  const [busca, setBusca] = useState('');
  const [vendas, setVendas] = useState<Venda[] | null>(null);
  const [erro, setErro] = useState('');
  const aviso = (local.state as { aviso?: string } | null)?.aviso;

  useEffect(() => {
    setVendas(null);
    api<{ vendas: Venda[] }>(`/com/vendas${status ? `?status=${status}` : ''}`).then((r) => setVendas(r.vendas)).catch((e) => setErro((e as Error).message));
  }, [status]);

  const lista = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return (vendas ?? []).filter((v) => !b || `${v.numero} ${v.clienteNome} ${v.obra ?? ''} ${v.tracoCodigo} ${v.vendedorNome}`.toLowerCase().includes(b));
  }, [vendas, busca]);

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Vendas</h1>
          <span className="muted">{gestao ? 'Todas as vendas da equipe.' : 'Suas vendas e a situação de cada uma.'}</span>
        </div>
        <Link className="btn btn-primario" to="/com/vendas/nova">Nova venda</Link>
      </div>
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div className="filtros">
        {FILTROS.map((f) => (
          <button key={f.id} type="button" className={`chip ${status === f.id ? 'chip-ativo' : ''}`} aria-pressed={status === f.id} onClick={() => setStatus(f.id)}>
            {f.texto}
          </button>
        ))}
        <input type="search" placeholder="Buscar cliente, obra ou nº" aria-label="Buscar" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>
      <div className="card tabela-caixa">
        {!vendas ? (
          <p className="muted">Carregando…</p>
        ) : lista.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nenhuma venda.</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Entrega</th>
                <th>Cliente e obra</th>
                <th>Traço</th>
                <th style={{ textAlign: 'right' }}>Volume</th>
                <th style={{ textAlign: 'right' }}>Valor</th>
                {gestao && <th>Vendedor</th>}
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((v) => (
                <tr key={v.id}>
                  <td className="mono"><Link to={`/com/vendas/${v.id}`}>{String(v.numero).padStart(4, '0')}</Link></td>
                  <td className="mono">{diaCurto(v.dataEntrega)}{v.horaEntrega ? ` ${v.horaEntrega}` : ''}</td>
                  <td>
                    <Link to={`/com/vendas/${v.id}`}>{v.clienteNome}</Link>
                    {v.obra && <div className="small muted">{v.obra}</div>}
                  </td>
                  <td className="mono">{v.tracoCodigo}{v.bombeamento && <div className="small muted">com bomba</div>}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    {m3(v.volume)}
                    {(v.status === 'aprovada' || v.status === 'concluida') && <div className="small muted">entregue {m3(v.entregue)}</div>}
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(v.valorTotal)}</td>
                  {gestao && <td>{v.vendedorNome}</td>}
                  <td><Selo s={v.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- detalhe
type Detalhe = {
  venda: Venda;
  cargas: { id: string; numero: number; dataHora: string; volume: number; devolvido: number; status: string; betoneira: string; motorista: string | null; cargaFinal: boolean; descargaEm: string | null; slumpEntrega: number | null }[];
  pode: { editar: boolean; enviar: boolean; aprovar: boolean; cancelar: boolean; finalizar: boolean };
  adicionais: { id: string; tipo: string; descricao: string; valor: number; criadoPor: string | null }[];
  faturamento: {
    m3Carregado: number; m3Devolvido: number; m3Liquido: number; concreto: number; bomba: number; adicionais: { tipo: string; descricao: string; valor: number }[]; total: number;
    ultimaEntrega: string | null; parcelas: { numero: number; vencimento: string; valor: number; status: string }[];
  };
};

const TIPOS_ADICIONAL: [string, string][] = [['feriado', 'Feriado / fim de semana'], ['hora_excedente', 'Horas excedidas'], ['equipamento_parado', 'Equipamento parado'], ['volume_minimo', 'Complemento de volume mínimo'], ['outro', 'Outro']];

/** Finalizar a entrega: adicionais contratuais e a conta a receber nas parcelas da condição de pagamento. */
function Faturamento({ r, aoMudar }: { r: Detalhe; aoMudar: (aviso: string) => void }) {
  const { usuario } = useSessao();
  const v = r.venda;
  const f = r.faturamento;
  const [ad, setAd] = useState<{ tipo: string; descricao: string; valor: string }[]>([]);
  const [prazos, setPrazos] = useState(v.prazosDias?.join('/') ?? '');
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const somaNovos = ad.reduce((s, a) => s + (lerNumero(a.valor) ?? 0), 0);
  const total = Math.round((f.total + somaNovos) * 100) / 100;
  const veFin = usuario?.perfil === 'dono' || usuario?.perfil === 'financeiro';

  async function finalizar() {
    setErro('');
    const p = lerPrazos(prazos);
    if (!p) return setErro('Informe os prazos em dias (ex.: 28 ou 30/60; 0 = à vista).');
    for (const a of ad) if (!a.descricao.trim() || !(lerNumero(a.valor) ?? 0)) return setErro('Preencha a descrição e o valor de cada adicional, ou tire a linha.');
    setOcupado(true);
    try {
      await api(`/com/vendas/${v.id}/finalizar-entrega`, {
        corpo: { adicionais: ad.map((a) => ({ tipo: a.tipo, descricao: a.descricao, valor: lerNumero(a.valor) })), prazosDias: p },
      });
      aoMudar(`Entrega finalizada: ${formatarMoeda(total)} lançados em Contas a receber.`);
    } catch (err) {
      setErro((err as Error).message);
    }
    setOcupado(false);
  }

  const linhas = (
    <table className="tabela tabela-compacta">
      <tbody>
        <tr>
          <td>
            Concreto: {m3(f.m3Liquido)} × {formatarMoeda(v.precoM3)}
            {f.m3Devolvido > 0 && <div className="small muted">{m3(f.m3Carregado)} carregados − {m3(f.m3Devolvido)} devolvidos</div>}
          </td>
          <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(f.concreto)}</td>
        </tr>
        {f.bomba > 0 && (
          <tr>
            <td>Taxa de bombeamento</td>
            <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(f.bomba)}</td>
          </tr>
        )}
        {f.adicionais.map((a, i) => (
          <tr key={i}>
            <td>{a.descricao} <span className="small muted">· adicional</span></td>
            <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(a.valor)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  if (v.entregaFinalizadaEm) {
    return (
      <section className="card">
        <h2>Faturamento</h2>
        {linhas}
        <div className="total-venda"><span className="muted">Total faturado</span><strong className="mono">{formatarMoeda(f.total)}</strong></div>
        {f.parcelas.length > 0 ? (
          <>
            <p className="small" style={{ margin: '0 0 6px' }}>Em Contas a receber · {textoPrazos(v.prazosDias)}{v.formaPagamento ? ` · ${v.formaPagamento}` : ''}:</p>
            <ul className="lista-simples">
              {f.parcelas.map((p) => (
                <li key={p.numero} className="small">
                  Parcela {p.numero}: <b className="mono">{formatarMoeda(p.valor)}</b> vence {formatarData(p.vencimento)}{p.status === 'paga' ? ' · recebida' : ''}
                </li>
              ))}
            </ul>
            {veFin && v.lancamentoId && <Link className="btn btn-link" to={`/fin/lancamentos/${v.lancamentoId}`}>Ver o lançamento</Link>}
          </>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>Entrega finalizada em {formatarDataHora(v.entregaFinalizadaEm)}; faturada fora do Comercial.</p>
        )}
      </section>
    );
  }
  if (!r.pode.finalizar) {
    if (v.status !== 'aprovada' && v.status !== 'concluida') return null;
    return (
      <section className="card">
        <h2>Faturamento</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Quando o operador registrar a <b>carga final</b> (ou as cargas somarem o volume vendido), o vendedor finaliza a entrega aqui e o valor vai para Contas a receber.
          {f.m3Liquido > 0 && <> Até agora: {m3(f.m3Liquido)} entregues · {formatarMoeda(f.total)}.</>}
        </p>
      </section>
    );
  }
  return (
    <section className="card form">
      <h2>Finalizar entrega</h2>
      <p className="small muted" style={{ margin: 0 }}>A carga final já saiu. Confira o entregue, lance os adicionais do contrato e finalize: o total vai para Contas a receber.</p>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {linhas}
      <h3 style={{ margin: '4px 0 0', fontSize: 15 }}>Adicionais contratuais</h3>
      {ad.map((a, i) => (
        <div key={i} className="linha-adicional">
          <select aria-label="Tipo do adicional" value={a.tipo} onChange={(e) => setAd(ad.map((x, j) => (j === i ? { ...x, tipo: e.target.value, descricao: x.descricao || (TIPOS_ADICIONAL.find((t) => t[0] === e.target.value)?.[1] ?? '') } : x)))}>
            {TIPOS_ADICIONAL.map(([k, t]) => (
              <option key={k} value={k}>{t}</option>
            ))}
          </select>
          <input aria-label="Descrição do adicional" placeholder="Descrição (ex.: 2 h de espera)" value={a.descricao} onChange={(e) => setAd(ad.map((x, j) => (j === i ? { ...x, descricao: e.target.value } : x)))} />
          <input aria-label="Valor do adicional" className="mono" inputMode="decimal" placeholder="R$" value={a.valor} onChange={(e) => setAd(ad.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)))} />
          <button className="btn btn-link" type="button" onClick={() => setAd(ad.filter((_, j) => j !== i))}>Tirar</button>
        </div>
      ))}
      <button className="btn btn-secundario" type="button" style={{ justifySelf: 'start' }} onClick={() => setAd([...ad, { tipo: 'hora_excedente', descricao: 'Horas excedidas', valor: '' }])}>
        + Adicional (feriado, horas excedidas, equipamento parado…)
      </button>
      <div className="campos">
        <div className="campo">
          <label htmlFor="f-prazos">Prazos (dias)</label>
          <input id="f-prazos" className="mono" value={prazos} onChange={(e) => setPrazos(e.target.value)} />
          <span className="small muted">Contados a partir da última entrega{f.ultimaEntrega ? ` (${formatarData(f.ultimaEntrega)})` : ''}.</span>
        </div>
      </div>
      <div className="total-venda"><span className="muted">Total a receber</span><strong className="mono">{formatarMoeda(total)}</strong></div>
      <div className="acoes">
        <button className="btn btn-primario" type="button" disabled={ocupado} onClick={finalizar}>Finalizar entrega e lançar a receber</button>
      </div>
    </section>
  );
}

export function VendaDetalhe() {
  const { usuario } = useSessao();
  const { id } = useParams();
  const local = useLocation();
  const [r, setR] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState((local.state as { aviso?: string } | null)?.aviso ?? '');
  const [motivo, setMotivo] = useState<{ acao: 'reprovar' | 'cancelar'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(() => {
    api<Detalhe>(`/com/vendas/${id}`).then(setR).catch((e) => setErro((e as Error).message));
  }, [id]);
  useEffect(carregar, [carregar]);

  async function agir(acao: 'enviar' | 'aprovar' | 'reprovar' | 'cancelar', texto?: string) {
    setErro('');
    setOcupado(true);
    try {
      await api(`/com/vendas/${id}/${acao}`, { corpo: texto ? { motivo: texto } : {} });
      setAviso({ enviar: 'Venda enviada para aprovação.', aprovar: 'Venda aprovada: já está na programação de entregas da Produção.', reprovar: 'Venda reprovada.', cancelar: 'Venda cancelada.' }[acao]);
      setMotivo(null);
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
    setOcupado(false);
  }

  if (!r) return erro ? <div className="alerta alerta-erro" role="alert">{erro}</div> : <p className="muted">Carregando…</p>;
  const v = r.venda;
  const rastrear = podeAcessar(usuario, ['dono', 'gestor', 'laboratorista'], '/qual/rastreabilidade');
  const linhas: [string, ReactNode][] = [
    ['Cliente', <>{v.clienteNome}{v.clienteTelefone ? <span className="muted"> · {v.clienteTelefone}</span> : null}</>],
    ['Obra', v.obra ?? '—'],
    ['Endereço', v.endereco ?? '—'],
    ['Contato na obra', v.contato ?? '—'],
    ['Traço', <><span className="mono">{v.tracoCodigo}</span>{v.tracoDescricao ? ` · ${v.tracoDescricao}` : ''}</>],
    ['Volume', <span className="mono">{m3(v.volume)}</span>],
    ['Entrega', `${formatarData(v.dataEntrega)}${v.horaEntrega ? ` às ${v.horaEntrega}` : ''}${v.bombeamento ? ' · com bombeamento' : ''}`],
    ['Preço', <span className="mono">{formatarMoeda(v.precoM3)}/m³{v.taxaBomba ? ` + bombeamento ${formatarMoeda(v.taxaBomba)}` : ''}</span>],
    ['Condição de pagamento', v.prazosDias ? `${textoPrazos(v.prazosDias)}${v.formaPagamento ? ` · ${FORMAS.find((x) => x[0] === v.formaPagamento)?.[1] ?? v.formaPagamento}` : ''}` : v.condicaoPagamento ?? '—'],
    ['Vendedor', v.vendedorNome],
    ['Observações', v.observacoes ?? '—'],
  ];
  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Venda nº {String(v.numero).padStart(4, '0')} <Selo s={v.status} /></h1>
          <span className="muted">{v.clienteNome}{v.obra ? ` · ${v.obra}` : ''}</span>
        </div>
        <Link className="btn btn-secundario" to="/com/vendas">Vendas</Link>
      </div>
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {v.motivo && (v.status === 'reprovada' || v.status === 'cancelada' || v.status === 'concluida') && (
        <div className={`alerta ${v.status === 'reprovada' ? 'alerta-aviso' : 'alerta-info'}`}>
          {v.status === 'reprovada' ? 'Motivo da reprovação' : v.status === 'cancelada' ? 'Motivo do cancelamento' : 'Encerrada'}: {v.motivo}
        </div>
      )}

      <div className="grade-larga">
        <div className="card">
          <dl className="lista-dados">
            {linhas.map(([k, val]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{val}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="card">
          <h2>Valor</h2>
          <p className="valor-ind mono" style={{ margin: '0 0 12px' }}>{formatarMoeda(v.valorTotal)}</p>
          <dl className="lista-dados">
            <div><dt>Lançada</dt><dd>{formatarDataHora(v.criadoEm)}{v.criadoPor ? ` por ${v.criadoPor}` : ''}</dd></div>
            {v.enviadoEm && <div><dt>Enviada para aprovação</dt><dd>{formatarDataHora(v.enviadoEm)}</dd></div>}
            {v.aprovadoEm && <div><dt>Aprovada</dt><dd>{formatarDataHora(v.aprovadoEm)}{v.aprovadoPor ? ` por ${v.aprovadoPor}` : ''}</dd></div>}
          </dl>
          {(v.status === 'aprovada' || v.status === 'concluida') && (
            <>
              <h2 style={{ marginTop: 16 }}>Entrega</h2>
              <BarraEntrega v={v} />
              <p className="small" style={{ margin: '6px 0 0' }}>
                {m3(v.entregue)} entregues em {v.cargas} carga{v.cargas === 1 ? '' : 's'} · faltam <b>{m3(v.saldo)}</b>
                {v.devolvido > 0 && <span className="texto-perigo"> · voltou {m3(v.devolvido)}</span>}
              </p>
            </>
          )}
          <div className="acoes" style={{ marginTop: 16 }}>
            {r.pode.aprovar && (
              <>
                <button className="btn btn-primario" type="button" disabled={ocupado} onClick={() => agir('aprovar')}>Aprovar</button>
                <button className="btn btn-secundario" type="button" disabled={ocupado} onClick={() => setMotivo({ acao: 'reprovar', texto: '' })}>Reprovar</button>
              </>
            )}
            {r.pode.enviar && <button className="btn btn-primario" type="button" disabled={ocupado} onClick={() => agir('enviar')}>Enviar para aprovação</button>}
            {r.pode.editar && <Link className="btn btn-secundario" to={`/com/vendas/${v.id}/editar`}>Alterar</Link>}
            {r.pode.cancelar && <button className="btn btn-link" type="button" disabled={ocupado} onClick={() => setMotivo({ acao: 'cancelar', texto: '' })}>Cancelar venda</button>}
          </div>
          {motivo && (
            <form
              className="aprov-acoes"
              style={{ marginTop: 12 }}
              onSubmit={(e) => {
                e.preventDefault();
                agir(motivo.acao, motivo.texto);
              }}
            >
              <input aria-label="Motivo" placeholder={motivo.acao === 'reprovar' ? 'Motivo da reprovação' : 'Motivo do cancelamento'} required minLength={3} maxLength={500} value={motivo.texto} onChange={(e) => setMotivo({ ...motivo, texto: e.target.value })} />
              <button className="btn btn-perigo" type="submit" disabled={ocupado}>{motivo.acao === 'reprovar' ? 'Reprovar' : 'Cancelar venda'}</button>
              <button className="btn btn-link" type="button" onClick={() => setMotivo(null)}>Voltar</button>
            </form>
          )}
        </div>
      </div>

      <Faturamento r={r} aoMudar={(a) => { setAviso(a); carregar(); }} />

      {r.cargas.length > 0 && (
        <div className="card tabela-caixa">
          <h2>Cargas desta venda</h2>
          <table className="tabela tabela-compacta">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Saída</th>
                <th>Betoneira e motorista</th>
                <th style={{ textAlign: 'right' }}>Volume</th>
              </tr>
            </thead>
            <tbody>
              {r.cargas.map((c) => (
                <tr key={c.id} style={c.status === 'cancelada' ? { opacity: 0.55 } : undefined}>
                  <td className="mono">{c.numero}</td>
                  <td className="mono">{formatarDataHora(c.dataHora)}</td>
                  <td>
                    <span className="mono">{c.betoneira}</span>{c.motorista ? ` · ${c.motorista}` : ''}
                    <div className="small muted">
                      {c.status === 'cancelada' ? '' : c.descargaEm ? `entregue${c.slumpEntrega !== null ? ` · slump obra ${formatarNumero(c.slumpEntrega, 1)} cm` : ''}` : 'a caminho'}
                      {c.cargaFinal && ' · carga final'}
                      {rastrear && <> · <Link to={`/qual/rastreabilidade/${c.id}`}>rastrear</Link></>}
                    </div>
                  </td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    {m3(c.volume)}
                    {c.status === 'cancelada' ? <div className="small muted">cancelada</div> : c.devolvido > 0 ? <div className="small texto-perigo">voltou {m3(c.devolvido)}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- relatórios
type LinhaRel = { id: string; nome: string; vendas: number; m3: number; valor: number; entregue: number; pendentes: number; reprovadas: number };
type RespRel = { de: string; ate: string; total: { vendas: number; m3: number; valor: number; entregue: number; pendentes: number }; precoMedio: number | null; porVendedor: LinhaRel[]; porCliente: LinhaRel[] };

const fimDoMes = (m: string) => {
  const [a, mm] = m.split('-').map(Number);
  return new Date(Date.UTC(a, mm, 0)).toISOString().slice(0, 10);
};

export function ComRelatorios() {
  const { usuario } = useSessao();
  const gestao = usuario?.perfil === 'dono' || usuario?.perfil === 'gestor';
  const mes = hojeLocal().slice(0, 7);
  const [periodo, setPeriodo] = useState<Periodo>({ de: mes, ate: mes });
  const [r, setR] = useState<RespRel | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    setR(null);
    api<RespRel>(`/com/relatorios?de=${periodo.de}-01&ate=${fimDoMes(periodo.ate)}`).then(setR).catch((e) => setErro((e as Error).message));
  }, [periodo]);
  const colunas = (rotulo: string) => [
    { titulo: rotulo, valor: (l: LinhaRel) => l.nome },
    { titulo: 'Vendas', valor: (l: LinhaRel) => l.vendas, formato: 'numero' as const, total: true },
    { titulo: 'Vendido (m³)', valor: (l: LinhaRel) => l.m3, formato: 'decimal' as const, total: true },
    { titulo: 'Valor vendido', valor: (l: LinhaRel) => l.valor, formato: 'moeda' as const, total: true },
    { titulo: 'Preço médio/m³', valor: (l: LinhaRel) => (l.m3 ? Math.round((l.valor / l.m3) * 100) / 100 : null), formato: 'moeda' as const },
    { titulo: 'Entregue (m³)', valor: (l: LinhaRel) => l.entregue, formato: 'decimal' as const, total: true },
    { titulo: 'Aguardando', valor: (l: LinhaRel) => l.pendentes, formato: 'numero' as const, total: true },
  ];
  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Relatórios comerciais</h1>
          <span className="muted">Vendas aprovadas pela data de entrega{gestao ? ', por vendedor e por cliente' : ''}.</span>
        </div>
      </div>
      <SeletorPeriodo valor={periodo} aoMudar={setPeriodo} />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {!r ? (
        <p className="muted">Carregando…</p>
      ) : (
        <>
          <div className="grade">
            <div className="card indicador"><span className="rotulo-ind">Vendas aprovadas</span><span className="valor-ind mono">{r.total.vendas}</span></div>
            <div className="card indicador"><span className="rotulo-ind">Volume vendido</span><span className="valor-ind mono">{m3(r.total.m3)}</span></div>
            <div className="card indicador"><span className="rotulo-ind">Valor vendido</span><span className="valor-ind mono">{formatarMoeda(r.total.valor)}</span></div>
            <div className="card indicador"><span className="rotulo-ind">Preço médio</span><span className="valor-ind mono">{r.precoMedio === null ? '—' : `${formatarMoeda(r.precoMedio)}/m³`}</span></div>
          </div>
          {gestao && <TabelaRelatorio titulo="Por vendedor" colunas={colunas('Vendedor')} linhas={r.porVendedor} arquivo={`vendas-por-vendedor-${periodo.de}-${periodo.ate}`} />}
          <TabelaRelatorio titulo="Por cliente" colunas={colunas('Cliente')} linhas={r.porCliente} arquivo={`vendas-por-cliente-${periodo.de}-${periodo.ate}`} limite={20} />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------- início do vendedor
/** Valor estimado a faturar: entregue menos devolvido × preço, mais a bomba (os adicionais entram na hora de finalizar). */
const estimativa = (v: Venda) => Math.round(((v.entregue - v.devolvido) * v.precoM3 + (v.bombeamento ? (v.taxaBomba ?? 0) : 0)) * 100) / 100;

/** Painel do vendedor: vendas com a carga final já registrada, para finalizar ali mesmo. */
function EntregasParaFinalizar({ vendas, aoMudar }: { vendas: Venda[]; aoMudar: () => void }) {
  const [aberta, setAberta] = useState<Detalhe | null>(null);
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [aviso, setAviso] = useState('');
  const [erro, setErro] = useState('');
  const lista = vendas.filter((v) => v.status === 'concluida' && !v.entregaFinalizadaEm && !v.lancamentoId).sort((a, b) => a.dataEntrega.localeCompare(b.dataEntrega));

  async function abrir(v: Venda) {
    setErro('');
    setAviso('');
    if (aberta?.venda.id === v.id) return setAberta(null);
    setAbrindo(v.id);
    try {
      setAberta(await api<Detalhe>(`/com/vendas/${v.id}`));
    } catch (e) {
      setErro((e as Error).message);
    }
    setAbrindo(null);
  }

  if (!lista.length && !aviso) return null;
  return (
    <section className="card">
      <div className="cartao-topo">
        <h2>
          Entregas para finalizar {lista.length > 0 && <span className="selo selo-aviso" style={{ marginLeft: 6 }}>{lista.length}</span>}
        </h2>
      </div>
      <p className="small muted" style={{ marginTop: 0 }}>A carga final já saiu. Confira o entregue, lance os adicionais do contrato e finalize: o valor vai para Contas a receber.</p>
      {aviso && <div className="alerta alerta-ok" role="status">{aviso}</div>}
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <ul className="lista-finalizar">
        {lista.map((v) => (
          <li key={v.id}>
            <div className="linha-finalizar">
              <div style={{ minWidth: 0 }}>
                <Link to={`/com/vendas/${v.id}`}><b>nº {String(v.numero).padStart(4, '0')} · {v.clienteNome}</b></Link>
                <div className="small muted">
                  {v.obra ? `${v.obra} · ` : ''}{m3(Math.round((v.entregue - v.devolvido) * 100) / 100)} entregues de {v.tracoCodigo} · entrega {diaCurto(v.dataEntrega)}
                </div>
              </div>
              <span className="mono" style={{ textAlign: 'right' }}>
                {formatarMoeda(estimativa(v))}
                <div className="small muted" style={{ fontFamily: 'var(--font-sans)' }}>sem adicionais</div>
              </span>
              <button className={`btn ${aberta?.venda.id === v.id ? 'btn-secundario' : 'btn-primario'}`} type="button" disabled={abrindo === v.id} onClick={() => abrir(v)}>
                {aberta?.venda.id === v.id ? 'Fechar' : abrindo === v.id ? 'Abrindo…' : 'Finalizar'}
              </button>
            </div>
            {aberta?.venda.id === v.id && (
              <div className="finalizar-inline">
                <Faturamento
                  r={aberta}
                  aoMudar={(a) => {
                    setAviso(`Venda nº ${String(v.numero).padStart(4, '0')}: ${a}`);
                    setAberta(null);
                    aoMudar();
                  }}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function InicioVendedor() {
  const [vendas, setVendas] = useState<Venda[] | null>(null);
  const [rel, setRel] = useState<RespRel | null>(null);
  const carregar = useCallback(() => {
    api<{ vendas: Venda[] }>('/com/vendas').then((r) => setVendas(r.vendas)).catch(() => setVendas([]));
    api<RespRel>('/com/relatorios').then(setRel).catch(() => {});
  }, []);
  useEffect(carregar, [carregar]);
  const hoje = hojeLocal();
  const proximas = (vendas ?? []).filter((v) => v.status === 'aprovada' && v.dataEntrega >= hoje).sort((a, b) => `${a.dataEntrega} ${a.horaEntrega ?? ''}`.localeCompare(`${b.dataEntrega} ${b.horaEntrega ?? ''}`)).slice(0, 6);
  const pendentes = (vendas ?? []).filter((v) => ['aguardando_aprovacao', 'reprovada', 'rascunho'].includes(v.status));
  return (
    <>
      <div className="card form">
        <h2>Fechou uma venda?</h2>
        <p className="muted" style={{ margin: 0 }}>Lance a venda e envie para aprovação. Aprovada, ela entra na programação da usina.</p>
        <Link to="/com/vendas/nova" className="btn btn-primario btn-bloco">Nova venda</Link>
      </div>
      {vendas && <EntregasParaFinalizar vendas={vendas} aoMudar={carregar} />}
      {rel && (
        <div className="grade">
          <div className="card indicador"><span className="rotulo-ind">Vendido no mês</span><span className="valor-ind mono">{formatarMoeda(rel.total.valor)}</span></div>
          <div className="card indicador"><span className="rotulo-ind">Volume</span><span className="valor-ind mono">{m3(rel.total.m3)}</span></div>
          <div className="card indicador"><span className="rotulo-ind">Entregue</span><span className="valor-ind mono">{m3(rel.total.entregue)}</span></div>
          <div className="card indicador"><span className="rotulo-ind">Aguardando aprovação</span><span className="valor-ind mono">{rel.total.pendentes}</span></div>
        </div>
      )}
      <div className="grade-larga">
        <div className="card">
          <div className="cartao-topo">
            <h2>Precisa de você</h2>
            <Link className="btn btn-link" to="/com/vendas">Todas</Link>
          </div>
          {!vendas ? (
            <p className="muted">Carregando…</p>
          ) : pendentes.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Nenhuma venda pendente.</p>
          ) : (
            <ul className="lista-simples">
              {pendentes.map((v) => (
                <li key={v.id}>
                  <div>
                    <Link to={`/com/vendas/${v.id}`}>nº {String(v.numero).padStart(4, '0')} · {v.clienteNome}</Link> <Selo s={v.status} />
                  </div>
                  <div className="small muted">{m3(v.volume)} de {v.tracoCodigo} para {diaCurto(v.dataEntrega)}{v.motivo && v.status === 'reprovada' ? ` · ${v.motivo}` : ''}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <h2>Próximas entregas</h2>
          {!vendas ? (
            <p className="muted">Carregando…</p>
          ) : proximas.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Nenhuma entrega aprovada pela frente.</p>
          ) : (
            <ul className="lista-simples">
              {proximas.map((v) => (
                <li key={v.id}>
                  <Link to={`/com/vendas/${v.id}`}>{diaCurto(v.dataEntrega)}{v.horaEntrega ? ` ${v.horaEntrega}` : ''} · {v.clienteNome}</Link>
                  <div className="small muted">{m3(v.volume)} de {v.tracoCodigo}{v.obra ? ` · ${v.obra}` : ''}</div>
                  <BarraEntrega v={v} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
