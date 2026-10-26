// Financeiro · Recibo de recebimento: emitido depois da baixa, com os dados da parcela paga.
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatarData, formatarDocumento, formatarMoeda, NOMES_FORMA, type FormaPagamento } from '../api';
import { CabecalhoDocumento } from '../componentes/Documento';
import { valorExtenso } from '../componentes/extenso';
import { Assinatura } from '../componentes/Suprimentos';

type Recibo = {
  empresa: { nome: string; cnpj: string | null };
  pagador: { nome: string; documento: string | null };
  valor: number;
  referente: string;
  documento: string | null;
  parcela: string;
  vencimento: string;
  dataPagamento: string;
  forma: FormaPagamento | null;
  conta: string | null;
  contratoNumero: number | null;
  emitidoEm: string;
};

export function ReciboRecebimento() {
  const { id } = useParams();
  const [r, setR] = useState<Recibo | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    api<{ recibo: Recibo }>(`/fin/parcelas/${id}/recibo`).then((x) => setR(x.recibo)).catch((e) => setErro((e as Error).message));
  }, [id]);
  if (erro) return <div className="alerta alerta-erro" role="alert">{erro}</div>;
  if (!r) return <p className="muted">Carregando…</p>;
  return (
    <div className="pagina romaneio">
      <CabecalhoDocumento
        modulo="Financeiro"
        titulo="Recibo de recebimento"
        filtros={[`Parcela ${r.parcela}`, `Data do pagamento: ${formatarData(r.dataPagamento)}`, r.conta ? `Conta: ${r.conta}` : '']}
      />
      <div className="nao-imprimir" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Link className="btn btn-secundario" to="/fin/pagar-receber">Voltar</Link>
      </div>
      <div className="card" style={{ padding: 20, lineHeight: 1.7 }}>
        <p style={{ fontSize: 16 }}>
          Recebi de <strong>{r.pagador.nome}</strong>{r.pagador.documento ? ` (${formatarDocumento(r.pagador.documento)})` : ''} a importância de{' '}
          <strong>{formatarMoeda(r.valor)}</strong> ({valorExtenso(r.valor)}).
        </p>
        <p>Referente a: {r.referente}{r.documento ? ` · ${r.documento}` : ''}.</p>
        <p>
          Parcela {r.parcela}, com vencimento em {formatarData(r.vencimento)}, paga em {formatarData(r.dataPagamento)}
          {r.forma ? ` por ${NOMES_FORMA[r.forma]}` : ''}.
        </p>
        {r.contratoNumero && <p className="small muted">Contrato nº {String(r.contratoNumero).padStart(4, '0')}.</p>}
      </div>
      <p style={{ marginTop: 16 }}>{r.empresa.nome}{r.empresa.cnpj ? ` · CNPJ ${formatarDocumento(r.empresa.cnpj)}` : ''}</p>
      <p className="small muted">Emitido em {formatarData(r.emitidoEm)}.</p>
      <div style={{ marginTop: 40 }}>
        <Assinatura nome={r.empresa.nome} papel="Recebedor" />
      </div>
    </div>
  );
}
