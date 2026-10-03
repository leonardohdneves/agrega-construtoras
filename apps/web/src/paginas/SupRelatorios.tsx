import { Link } from 'react-router-dom';
import { formatarData, formatarMoeda } from '../api';
import { SeletorPeriodo } from '../componentes/Periodo';
import { CabecalhoRelatorio, TabelaRelatorio, useRelatorio } from '../componentes/Relatorio';
import { numeroDoc, pct, precoUn, qtd, SELO_PEDIDO, SELO_SOLICITACAO, type StatusPedido, type StatusSolicitacao } from '../componentes/Suprimentos';

type Resp = {
  de: string;
  ate: string;
  resumo: {
    pedidos: number; totalComprado: number; fornecedores: number; emAberto: number; saldoAReceber: number; atrasados: number; economiaMaior: number; economiaMedia: number;
    cotacoes: number; divergencias: number; solicitacoesPendentes: number;
  };
  porFornecedor: { fornecedor: string; pedidos: number; total: number; concluidos: number; atrasados: number }[];
  porItem: { descricao: string; unidade: string; quantidade: number; valor: number; precoMedio: number | null; menorPreco: number | null; maiorPreco: number | null; fornecedores: number }[];
  emAberto: { id: string; numero: number; data: string; fornecedor: string; status: StatusPedido; previsaoEntrega: string | null; diasAtraso: number; total: number; saldo: number; itens: string }[];
  economia: { id: string; numero: number; data: string; itens: number; fornecedores: number; total: number; economiaMaior: number; economiaMedia: number; foraDoMenor: number; justificativa: string | null }[];
  divergencias: { pedido: number; fornecedor: string; nota: string | null; data: string; descricao: string; unidade: string; quantidadePedido: number; quantidadeNota: number; precoPedido: number | null; precoNota: number | null; diferencaPreco: number | null; valorDiferenca: number }[];
  pendentes: { numero: number; data: string; necessidade: string | null; status: StatusSolicitacao; origem: string; solicitante: string | null; itens: string | null; dias: number }[];
};

const ABAS = [
  { id: 'fornecedor', texto: 'Por fornecedor' },
  { id: 'item', texto: 'Por item' },
  { id: 'abertos', texto: 'Em aberto' },
  { id: 'economia', texto: 'Economia' },
  { id: 'divergencias', texto: 'Divergências' },
  { id: 'pendentes', texto: 'Solicitações' },
];

export function SupRelatorios() {
  const { periodo, aba, dados: r, erro, mudar } = useRelatorio<Resp>('/sup/relatorios', 'fornecedor', '3m');
  const sufixo = `${periodo.de}_${periodo.ate}`;
  return (
    <>
      <CabecalhoRelatorio
        modulo="Suprimentos"
        periodo={periodo}
        titulo="Relatórios de compras"
        sub="Pedidos aprovados no período, o que falta receber, quanto as cotações economizaram e onde a nota veio diferente do pedido."
        abas={ABAS}
        aba={aba}
        aoMudar={(id) => mudar({ aba: id })}
        extra={<SeletorPeriodo valor={periodo} aoMudar={(p) => mudar(p)} />}
      />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {r && (
        <div className="grade">
          <div className="card indicador">
            <span className="rotulo-ind">Comprado no período</span>
            <span className="valor-ind mono">{formatarMoeda(r.resumo.totalComprado)}</span>
            <span className="small muted">{r.resumo.pedidos} {r.resumo.pedidos === 1 ? 'pedido' : 'pedidos'} · {r.resumo.fornecedores} {r.resumo.fornecedores === 1 ? 'fornecedor' : 'fornecedores'}</span>
          </div>
          <div className="card indicador">
            <span className="rotulo-ind">A receber (hoje)</span>
            <span className="valor-ind mono">{formatarMoeda(r.resumo.saldoAReceber)}</span>
            <span className="small muted">{r.resumo.emAberto} {r.resumo.emAberto === 1 ? 'pedido' : 'pedidos'} · {r.resumo.atrasados} {r.resumo.atrasados === 1 ? 'atrasado' : 'atrasados'}</span>
          </div>
          <div className="card indicador">
            <span className="rotulo-ind">Economia nas cotações</span>
            <span className="valor-ind mono">{formatarMoeda(r.resumo.economiaMaior)}</span>
            <span className="small muted">sobre o maior preço · {r.resumo.cotacoes} {r.resumo.cotacoes === 1 ? 'cotação' : 'cotações'}</span>
          </div>
          <div className="card indicador">
            <span className="rotulo-ind">Divergências na nota</span>
            <span className="valor-ind mono">{r.resumo.divergencias}</span>
            <span className="small muted">{r.resumo.solicitacoesPendentes} {r.resumo.solicitacoesPendentes === 1 ? 'solicitação pendente' : 'solicitações pendentes'}</span>
          </div>
        </div>
      )}
      {!r ? (
        !erro && <p className="muted">Carregando…</p>
      ) : aba === 'fornecedor' ? (
        <TabelaRelatorio
          titulo="Compras por fornecedor"
          descricao={`Pedidos aprovados com data de ${formatarData(r.de)} a ${formatarData(r.ate)}.`}
          arquivo={`compras_fornecedor_${sufixo}`}
          linhas={r.porFornecedor}
          colunas={[
            { titulo: 'Fornecedor', valor: (l) => l.fornecedor },
            { titulo: 'Pedidos', valor: (l) => l.pedidos, formato: 'numero', total: true },
            { titulo: 'Concluídos', valor: (l) => l.concluidos, formato: 'numero', total: true },
            { titulo: 'Atrasados hoje', valor: (l) => l.atrasados, formato: 'numero', total: true, destaque: (l) => (l.atrasados ? 'perigo' : undefined) },
            { titulo: 'Total', valor: (l) => l.total, formato: 'moeda', total: true },
            { titulo: 'Participação', valor: (l) => (r.resumo.totalComprado ? l.total / r.resumo.totalComprado : null), formato: 'pct' },
          ]}
        />
      ) : aba === 'item' ? (
        <TabelaRelatorio
          titulo="Compras por item"
          descricao="Quantidade e preço dos pedidos aprovados no período; a diferença entre menor e maior preço mostra onde negociar."
          arquivo={`compras_item_${sufixo}`}
          linhas={r.porItem}
          colunas={[
            { titulo: 'Item', valor: (l) => l.descricao },
            { titulo: 'Quantidade', valor: (l) => qtd(l.quantidade, l.unidade) },
            { titulo: 'Preço médio', valor: (l) => l.precoMedio, render: (l) => precoUn(l.precoMedio) },
            { titulo: 'Menor', valor: (l) => l.menorPreco, render: (l) => precoUn(l.menorPreco) },
            { titulo: 'Maior', valor: (l) => l.maiorPreco, render: (l) => precoUn(l.maiorPreco) },
            { titulo: 'Fornecedores', valor: (l) => l.fornecedores, formato: 'numero' },
            { titulo: 'Valor', valor: (l) => l.valor, formato: 'moeda', total: true },
          ]}
        />
      ) : aba === 'abertos' ? (
        <TabelaRelatorio
          titulo="Pedidos em aberto"
          descricao="Pedidos aprovados que ainda não foram recebidos por completo, na data de hoje (não depende do período)."
          arquivo="pedidos_em_aberto"
          linhas={r.emAberto}
          colunas={[
            { titulo: 'Pedido', valor: (l) => numeroDoc(l.numero), render: (l) => <Link to={`/sup/pedidos/${l.id}`}>{numeroDoc(l.numero)}</Link> },
            { titulo: 'Data', valor: (l) => l.data, formato: 'data' },
            { titulo: 'Fornecedor', valor: (l) => l.fornecedor },
            { titulo: 'Situação', valor: (l) => SELO_PEDIDO[l.status].texto },
            { titulo: 'Entrega', valor: (l) => l.previsaoEntrega, formato: 'data', destaque: (l) => (l.diasAtraso ? 'perigo' : undefined) },
            { titulo: 'Atraso', valor: (l) => l.diasAtraso || null, formato: 'numero', destaque: (l) => (l.diasAtraso ? 'perigo' : undefined) },
            { titulo: 'Falta receber', valor: (l) => l.itens },
            { titulo: 'Total', valor: (l) => l.total, formato: 'moeda', total: true },
            { titulo: 'Saldo', valor: (l) => l.saldo, formato: 'moeda', total: true },
          ]}
        />
      ) : aba === 'economia' ? (
        <TabelaRelatorio
          titulo="Economia nas cotações"
          descricao="Cotações concluídas no período. Economia = maior preço cotado menos o escolhido (e o mesmo sobre a média), vezes a quantidade."
          arquivo={`economia_cotacoes_${sufixo}`}
          linhas={r.economia}
          colunas={[
            { titulo: 'Cotação', valor: (l) => numeroDoc(l.numero), render: (l) => <Link to={`/sup/cotacoes/${l.id}`}>{numeroDoc(l.numero)}</Link> },
            { titulo: 'Data', valor: (l) => l.data, formato: 'data' },
            { titulo: 'Itens', valor: (l) => l.itens, formato: 'numero' },
            { titulo: 'Fora do menor', valor: (l) => l.foraDoMenor || null, formato: 'numero', destaque: (l) => (l.foraDoMenor ? 'aviso' : undefined) },
            { titulo: 'Total escolhido', valor: (l) => l.total, formato: 'moeda', total: true },
            { titulo: 'Economia s/ maior', valor: (l) => l.economiaMaior, formato: 'moeda', total: true },
            { titulo: 'Economia s/ média', valor: (l) => l.economiaMedia, formato: 'moeda', total: true },
            { titulo: 'Justificativa', valor: (l) => l.justificativa },
          ]}
        />
      ) : aba === 'divergencias' ? (
        <TabelaRelatorio
          titulo="Divergências no recebimento"
          descricao="Itens de notas emitidas no período cujo preço por unidade passa de 0,5% de diferença do pedido."
          arquivo={`divergencias_${sufixo}`}
          linhas={r.divergencias}
          vazio="Nenhuma nota com preço diferente do pedido no período."
          colunas={[
            { titulo: 'Pedido', valor: (l) => numeroDoc(l.pedido) },
            { titulo: 'Fornecedor', valor: (l) => l.fornecedor },
            { titulo: 'Nota', valor: (l) => l.nota },
            { titulo: 'Emissão', valor: (l) => l.data, formato: 'data' },
            { titulo: 'Item', valor: (l) => l.descricao },
            { titulo: 'Qtd. pedido', valor: (l) => qtd(l.quantidadePedido, l.unidade) },
            { titulo: 'Qtd. nota', valor: (l) => qtd(l.quantidadeNota, l.unidade) },
            { titulo: 'Preço pedido', valor: (l) => l.precoPedido, render: (l) => precoUn(l.precoPedido) },
            { titulo: 'Preço nota', valor: (l) => l.precoNota, render: (l) => precoUn(l.precoNota) },
            { titulo: 'Diferença', valor: (l) => pct(l.diferencaPreco), destaque: (l) => ((l.diferencaPreco ?? 0) > 0 ? 'perigo' : 'ok') },
            { titulo: 'Valor a mais', valor: (l) => l.valorDiferenca, formato: 'moeda', total: true },
          ]}
        />
      ) : (
        <TabelaRelatorio
          titulo="Solicitações pendentes"
          descricao="Solicitações abertas ou em cotação hoje, da mais urgente para a menos urgente."
          arquivo="solicitacoes_pendentes"
          linhas={r.pendentes}
          vazio="Nenhuma solicitação pendente."
          colunas={[
            { titulo: 'Nº', valor: (l) => numeroDoc(l.numero) },
            { titulo: 'Data', valor: (l) => l.data, formato: 'data' },
            { titulo: 'Precisa até', valor: (l) => l.necessidade, formato: 'data' },
            { titulo: 'Situação', valor: (l) => SELO_SOLICITACAO[l.status].texto },
            { titulo: 'Solicitante', valor: (l) => l.solicitante },
            { titulo: 'Itens', valor: (l) => l.itens },
            { titulo: 'Dias', valor: (l) => l.dias, formato: 'numero', destaque: (l) => (l.dias > 7 ? 'aviso' : undefined) },
          ]}
        />
      )}
    </>
  );
}
