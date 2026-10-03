// Tipos, selos e peças comuns do módulo Suprimentos.
import { useEffect, useState, type ReactNode } from 'react';
import { api, formatarMoeda, lerNumero, type CentroCusto, type Fornecedor, type Insumo } from '../api';

// ---------- Tipos da API ----------
export type StatusSolicitacao = 'aberta' | 'em_cotacao' | 'atendida' | 'cancelada';
export type StatusCotacao = 'aberta' | 'concluida' | 'cancelada';
export type StatusPedido = 'rascunho' | 'aguardando_aprovacao' | 'aprovado' | 'reprovado' | 'enviado' | 'parcial' | 'recebido' | 'encerrado' | 'cancelado';

export type ItemSolicitacao = { id: string; insumoId: string | null; tipo: string | null; descricao: string; unidade: string; quantidade: number; observacao: string | null };
export type Solicitacao = {
  id: string; numero: number; data: string; necessidade: string | null; origem: 'manual' | 'estoque_minimo'; centroCustoId: string | null; centroCusto: string | null;
  observacao: string | null; status: StatusSolicitacao; solicitante: string | null; cotacoes: { id: string; numero: number; status: StatusCotacao }[];
  pedidos: { id: string; numero: number; status: StatusPedido }[]; itens: ItemSolicitacao[];
};
export type SolicitacaoResumo = {
  id: string; numero: number; data: string; necessidade: string | null; origem: 'manual' | 'estoque_minimo'; status: StatusSolicitacao; observacao: string | null;
  solicitante: string | null; itens: number; resumo: string | null; diasAberta: number | null; urgente: boolean;
};
export type SugestaoEstoque = { insumoId: string; nome: string; tipo: string; unidade: string; estoqueMinimo: number; saldo: number; emPedido: number; emSolicitacao: number; diasCobertura: number | null; sugerido: number };

export type OfertaCotacao = { cotacaoFornecedorId: string; precoUnitario: number; total: number };
export type ItemCotacao = {
  id: string; insumoId: string | null; descricao: string; unidade: string; quantidade: number; ofertas: OfertaCotacao[]; menorPrecoId: string | null; vencedorId: string | null;
  justificativa: string | null; foraDoMenor: boolean; totalVencedor: number | null; economiaMaior: number | null; economiaMedia: number | null;
};
export type FornecedorCotacao = {
  id: string; fornecedorId: string; nome: string; razaoSocial: string; documento: string | null; telefone: string | null; email: string | null; cidade: string | null;
  prazoEntregaDias: number | null; condicaoPagamento: string | null; frete: number; validade: string | null; observacao: string | null; itensCotados: number;
  subtotal: number; total: number; completo: boolean; itensVencidos: number; totalVencido: number;
};
export type Cotacao = {
  id: string; numero: number; data: string; prazoResposta: string | null; solicitacaoId: string | null; solicitacaoNumero: number | null; observacao: string | null;
  justificativa: string | null; status: StatusCotacao; criadoPor: string | null; concluidaEm: string | null; fornecedores: FornecedorCotacao[]; itens: ItemCotacao[];
  pedidos: { id: string; numero: number; status: StatusPedido; total: number; fornecedor: string }[];
  resumo: {
    itens: number; itensComVencedor: number; itensForaDoMenor: number; totalEscolhido: number; freteEscolhido: number; economiaMaior: number; economiaMedia: number;
    melhorFornecedorCompleto: { id: string; nome: string; total: number } | null;
  };
};
export type CotacaoResumo = {
  id: string; numero: number; data: string; prazoResposta: string | null; status: StatusCotacao; solicitacaoNumero: number | null; itens: number; fornecedores: number;
  respostas: number; resumo: string | null; pedidos: number;
};

export type ItemPedido = {
  id: string; insumoId: string | null; tipo: string | null; descricao: string; unidade: string; quantidade: number; precoUnitario: number; total: number; recebido: number;
  saldo: number; precoNota: number | null; diferencaPreco: number | null; diferencaQuantidade: number | null;
};
export type Pedido = {
  id: string; numero: number; data: string; status: StatusPedido; fornecedorId: string;
  fornecedor: { nome: string; razaoSocial: string; documento: string | null; telefone: string | null; email: string | null; cidade: string | null };
  cotacaoId: string | null; cotacaoNumero: number | null; solicitacaoId: string | null; solicitacaoNumero: number | null; previsaoEntrega: string | null; atrasado: boolean;
  diasAtraso: number; condicaoPagamento: string | null; localEntrega: string | null; frete: number; subtotal: number; total: number; centroCustoId: string | null;
  centroCusto: string | null; observacao: string | null; criadoPor: string | null; enviadoAprovacaoEm: string | null; aprovadoPor: string | null; aprovadoEm: string | null;
  aprovacaoAutomatica: boolean; motivoReprovacao: string | null; enviadoFornecedorEm: string | null; encerradoMotivo: string | null; itens: ItemPedido[];
  notas: { id: string; numero: string | null; serie: string | null; modelo: string; dataEmissao: string; total: number; status: string; lancada: boolean; itensLigados: number }[];
  divergencias: number; podeAprovar: boolean; regrasAprovacao: string;
};
export type PedidoResumo = {
  id: string; numero: number; data: string; status: StatusPedido; previsaoEntrega: string | null; atrasado: boolean; diasAtraso: number; total: number; fornecedor: string;
  cotacaoNumero: number | null; aprovadoPor: string | null; aprovacaoAutomatica: boolean; resumo: string | null; notas: number;
};
export type Aprovacao = {
  tipo: 'pedido' | 'medicao' | 'autorizacao'; id: string; numero: number; titulo: string; pessoa: string; resumo: string | null; valor: number; enviadoEm: string;
  criadoPor: string | null; link: string; podeAprovar: boolean;
};
export type RegrasAprovacao = { adminAte: number | null; dispensaAte: number | null; texto: string };

// ---------- Selos ----------
export const SELO_SOLICITACAO: Record<StatusSolicitacao, { texto: string; classe: string }> = {
  aberta: { texto: 'Aberta', classe: 'selo-aviso' },
  em_cotacao: { texto: 'Em cotação', classe: 'selo-aviso' },
  atendida: { texto: 'Atendida', classe: 'selo-ok' },
  cancelada: { texto: 'Cancelada', classe: 'selo-neutro' },
};
export const SELO_COTACAO: Record<StatusCotacao, { texto: string; classe: string }> = {
  aberta: { texto: 'Aberta', classe: 'selo-aviso' },
  concluida: { texto: 'Concluída', classe: 'selo-ok' },
  cancelada: { texto: 'Cancelada', classe: 'selo-neutro' },
};
export const SELO_PEDIDO: Record<StatusPedido, { texto: string; classe: string }> = {
  rascunho: { texto: 'Rascunho', classe: 'selo-neutro' },
  aguardando_aprovacao: { texto: 'Aguardando aprovação', classe: 'selo-aviso' },
  aprovado: { texto: 'Aprovado', classe: 'selo-ok' },
  reprovado: { texto: 'Reprovado', classe: 'selo-perigo' },
  enviado: { texto: 'Enviado ao fornecedor', classe: 'selo-ok' },
  parcial: { texto: 'Entrega parcial', classe: 'selo-aviso' },
  recebido: { texto: 'Recebido', classe: 'selo-ok' },
  encerrado: { texto: 'Encerrado com saldo', classe: 'selo-neutro' },
  cancelado: { texto: 'Cancelado', classe: 'selo-neutro' },
};
export function Selo({ s }: { s: { texto: string; classe: string } }) {
  return <span className={`selo ${s.classe}`}>{s.texto}</span>;
}

// ---------- Formatação ----------
export const qtd = (n: number | null | undefined, unidade?: string) =>
  n === null || n === undefined ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}${unidade ? ` ${unidade === 'm3' ? 'm³' : unidade === 'm2' ? 'm²' : unidade}` : ''}`;
/** Preço unitário: até 4 casas quando é fração de centavo (ex.: R$ 0,5634/kg). */
export const precoUn = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—';
  const casas = Math.abs(n) < 10 && Math.round(n * 100) !== n * 100 ? 4 : 2;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: casas });
};
export const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n > 0 ? '+' : ''}${(n * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
export const numeroDoc = (n: number) => String(n).padStart(4, '0');
export const nomeFornecedor = (f: Pick<Fornecedor, 'nomeFantasia' | 'razaoSocial'>) => f.nomeFantasia || f.razaoSocial;
export const campoNumero = (n: number | null | undefined, casas = 3) =>
  n === null || n === undefined ? '' : n.toLocaleString('pt-BR', { maximumFractionDigits: casas, useGrouping: false });

// ---------- Cadastros usados nas telas ----------
export function useCadastrosCompra() {
  const [insumos, setInsumos] = useState<Insumo[]>([]);
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([]);
  const [centros, setCentros] = useState<CentroCusto[]>([]);
  useEffect(() => {
    api<{ insumos: Insumo[] }>('/prod/insumos').then((r) => setInsumos(r.insumos.filter((i) => i.ativo))).catch(() => {});
    api<{ fornecedores: Fornecedor[] }>('/adm/fornecedores?categoria=fornecedor').then((r) => setFornecedores(r.fornecedores.filter((f) => f.ativo))).catch(() => {});
    api<{ centros: CentroCusto[] }>('/fin/centros-custo').then((r) => setCentros(r.centros.filter((c) => c.ativo))).catch(() => {});
  }, []);
  return { insumos, fornecedores, centros };
}

// ---------- Editor de itens (solicitação, cotação e pedido) ----------
export type LinhaEditor = { chave: string; insumoId: string; descricao: string; unidade: string; quantidade: string; preco: string; observacao: string };
let contador = 0;
export const novaLinha = (p: Partial<LinhaEditor> = {}): LinhaEditor => ({ chave: `l${++contador}`, insumoId: '', descricao: '', unidade: 'un', quantidade: '', preco: '', observacao: '', ...p });
export const UNIDADES = ['kg', 't', 'L', 'm3', 'un', 'cx', 'pç', 'm', 'm2', 'h', 'sc', 'vb'];

export function EditorItens({
  linhas,
  aoMudar,
  insumos,
  comPreco = false,
  comObservacao = false,
}: {
  linhas: LinhaEditor[];
  aoMudar: (l: LinhaEditor[]) => void;
  insumos: Insumo[];
  comPreco?: boolean;
  comObservacao?: boolean;
}) {
  const mudar = (chave: string, p: Partial<LinhaEditor>) => aoMudar(linhas.map((l) => (l.chave === chave ? { ...l, ...p } : l)));
  const total = linhas.reduce((s, l) => s + (lerNumero(l.quantidade) ?? 0) * (lerNumero(l.preco) ?? 0), 0);
  return (
    <div className="editor-itens">
      {linhas.map((l, n) => {
        const avulso = !l.insumoId;
        const subtotal = (lerNumero(l.quantidade) ?? 0) * (lerNumero(l.preco) ?? 0);
        return (
          <div key={l.chave} className={`campos editor-linha ${comPreco ? 'com-preco' : ''}`}>
            <div className="campo">
              <label htmlFor={`it-ins-${l.chave}`}>Item {n + 1}</label>
              <select
                id={`it-ins-${l.chave}`}
                value={l.insumoId}
                onChange={(e) => {
                  const ins = insumos.find((i) => i.id === e.target.value);
                  mudar(l.chave, ins ? { insumoId: ins.id, descricao: ins.nome, unidade: ins.unidade } : { insumoId: '', descricao: '', unidade: 'un' });
                }}
              >
                <option value="">Outro item (descrever)</option>
                {insumos.map((i) => (
                  <option key={i.id} value={i.id}>{i.nome}</option>
                ))}
              </select>
            </div>
            {avulso ? (
              <div className="campo">
                <label htmlFor={`it-desc-${l.chave}`}>Descrição</label>
                <input id={`it-desc-${l.chave}`} value={l.descricao} maxLength={200} onChange={(e) => mudar(l.chave, { descricao: e.target.value })} placeholder="Ex.: lona plástica 4×50 m" />
              </div>
            ) : (
              <div className="campo">
                <span className="rotulo">Descrição</span>
                <span className="small" style={{ paddingTop: 10 }}>{l.descricao}</span>
              </div>
            )}
            <div className="campo">
              <label htmlFor={`it-qtd-${l.chave}`}>Quantidade</label>
              <div className="com-sufixo">
                <input id={`it-qtd-${l.chave}`} className="mono" inputMode="decimal" value={l.quantidade} onChange={(e) => mudar(l.chave, { quantidade: e.target.value })} />
                {avulso ? (
                  <select aria-label="Unidade" value={l.unidade} onChange={(e) => mudar(l.chave, { unidade: e.target.value })}>
                    {UNIDADES.map((u) => <option key={u} value={u}>{u === 'm3' ? 'm³' : u === 'm2' ? 'm²' : u}</option>)}
                  </select>
                ) : (
                  <span className="sufixo">{l.unidade === 'm3' ? 'm³' : l.unidade}</span>
                )}
              </div>
            </div>
            {comPreco && (
              <div className="campo">
                <label htmlFor={`it-pre-${l.chave}`}>Preço unitário (R$)</label>
                <input id={`it-pre-${l.chave}`} className="mono" inputMode="decimal" value={l.preco} onChange={(e) => mudar(l.chave, { preco: e.target.value })} />
                <span className="small muted mono">{subtotal ? formatarMoeda(subtotal) : ' '}</span>
              </div>
            )}
            {comObservacao && (
              <div className="campo">
                <label htmlFor={`it-obs-${l.chave}`}>Observação</label>
                <input id={`it-obs-${l.chave}`} value={l.observacao} maxLength={200} onChange={(e) => mudar(l.chave, { observacao: e.target.value })} />
              </div>
            )}
            <div className="campo" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-link" type="button" onClick={() => aoMudar(linhas.filter((x) => x.chave !== l.chave))} disabled={linhas.length === 1}>
                Remover
              </button>
            </div>
          </div>
        );
      })}
      <div className="acoes">
        <button className="btn btn-secundario" type="button" onClick={() => aoMudar([...linhas, novaLinha()])}>+ Item</button>
        {comPreco && <span className="small muted">Itens: <b className="mono">{formatarMoeda(total)}</b></span>}
      </div>
    </div>
  );
}

/** Converte as linhas do editor no corpo da API, com mensagens claras. */
export function itensParaApi(linhas: LinhaEditor[], comPreco = false) {
  return linhas
    .filter((l) => l.insumoId || l.descricao.trim() || l.quantidade.trim())
    .map((l, n) => {
      const q = lerNumero(l.quantidade);
      if (!q || q <= 0) throw new Error(`Item ${n + 1}: informe a quantidade.`);
      const p = comPreco ? lerNumero(l.preco) : null;
      if (comPreco && (p === null || p < 0)) throw new Error(`Item ${n + 1}: informe o preço unitário.`);
      return {
        insumoId: l.insumoId || null,
        descricao: l.insumoId ? null : l.descricao.trim() || null,
        unidade: l.insumoId ? null : l.unidade,
        quantidade: q,
        observacao: l.observacao.trim() || null,
        ...(comPreco ? { precoUnitario: p } : {}),
      };
    });
}

/** Linha de assinatura para documentos impressos. */
export function Assinatura({ nome, papel, detalhe }: { nome: string; papel: string; detalhe?: ReactNode }) {
  return (
    <div className="assinatura">
      <div className="assinatura-linha" />
      <strong>{nome}</strong>
      <span>{papel}</span>
      {detalhe && <span className="small muted">{detalhe}</span>}
    </div>
  );
}
