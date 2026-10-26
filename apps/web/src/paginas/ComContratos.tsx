// Comercial · Contratos com clientes: gerados pela aceitação de propostas de obra (substituem as vendas de concreto).
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatarMoeda } from '../api';
import { CabecalhoDocumento } from '../componentes/Documento';
import { Assinatura } from '../componentes/Suprimentos';

type Contrato = {
  id: string; numero: number; tipoNome: string; titulo: string; valorTotal: number; status: 'vigente' | 'encerrado' | 'cancelado';
  propostaId: string; propostaNumero: number; clienteNome: string | null; obraCodigo: string | null; lancamentoId: string | null; criadoEm: string;
};

const numeroFmt = (n: number) => String(n).padStart(4, '0');
const ROTULO: Record<Contrato['status'], string> = { vigente: 'Vigente', encerrado: 'Encerrado', cancelado: 'Cancelado' };
const SELO: Record<Contrato['status'], string> = { vigente: 'selo-ok', encerrado: 'selo-neutro', cancelado: 'selo-perigo' };

export function ComContratos() {
  const [lista, setLista] = useState<Contrato[] | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    api<{ contratos: Contrato[] }>('/com/contratos-cliente')
      .then((r) => setLista(r.contratos))
      .catch((e) => setErro((e as Error).message));
  }, []);

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Contratos</h1>
          <span className="muted">Contratos com clientes. Cada um nasce da aceitação de uma proposta e gera os lançamentos a receber.</span>
        </div>
        <div className="acoes">
          <Link className="btn btn-primario" to="/com/propostas/nova">Nova proposta</Link>
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {lista === null && !erro && <p className="muted">Carregando…</p>}
      {lista?.length === 0 && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>Nenhum contrato ainda. Um contrato surge quando o cliente aceita uma proposta.</p>
        </div>
      )}
      {lista && lista.length > 0 && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="tabela">
            <thead>
              <tr>
                <th>Contrato</th>
                <th>Tipo</th>
                <th>Cliente</th>
                <th>Obra</th>
                <th className="num">Valor</th>
                <th>Situação</th>
                <th>Proposta</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.id}>
                  <td className="mono"><Link to={`/com/contratos/${c.id}`}>Nº {numeroFmt(c.numero)}</Link></td>
                  <td>{c.tipoNome}<div className="small muted">{c.titulo}</div></td>
                  <td>{c.clienteNome ?? <span className="muted">—</span>}</td>
                  <td>{c.obraCodigo ?? <span className="muted">—</span>}</td>
                  <td className="num">{formatarMoeda(c.valorTotal)}</td>
                  <td><span className={`selo ${SELO[c.status]}`}>{ROTULO[c.status]}</span></td>
                  <td><Link to={`/com/propostas/${c.propostaId}`}>{numeroFmt(c.propostaNumero)}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

type ContratoDetalhe = {
  id: string; numero: number; tipoNome: string; titulo: string; clienteNome: string; obraCodigo: string | null;
  valorTotal: number; status: 'vigente' | 'encerrado' | 'cancelado'; propostaId: string; escopo: string | null;
};

/** Contrato de prestação de serviços técnicos: escopo redigido a partir da proposta aceita. */
export function ComContratoDetalhe() {
  const { id } = useParams();
  const [c, setC] = useState<ContratoDetalhe | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    api<{ contrato: ContratoDetalhe }>(`/com/contratos-cliente/${id}`)
      .then((r) => setC(r.contrato))
      .catch((e) => setErro((e as Error).message));
  }, [id]);
  if (erro) return <div className="alerta alerta-erro" role="alert">{erro}</div>;
  if (!c) return <p className="muted">Carregando…</p>;
  return (
    <div className="pagina romaneio">
      <CabecalhoDocumento
        modulo="Comercial"
        titulo={`Contrato nº ${numeroFmt(c.numero)} · ${c.titulo}`}
        descricao={c.tipoNome}
        filtros={[`Cliente: ${c.clienteNome}`, c.obraCodigo ? `Obra: ${c.obraCodigo}` : 'Sem obra vinculada', `Valor: ${formatarMoeda(c.valorTotal)}`, `Situação: ${c.status}`]}
      />
      <div className="nao-imprimir" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Link className="btn btn-secundario" to={`/com/propostas/${c.propostaId}`}>Ver proposta</Link>
        <Link className="btn btn-secundario" to="/com/contratos">Voltar aos contratos</Link>
      </div>
      {c.escopo ? (
        <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.55, margin: 0 }}>{c.escopo}</pre>
      ) : (
        <div className="alerta alerta-aviso">Este contrato foi gerado antes da redação automática do escopo.</div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, marginTop: 40 }}>
        <Assinatura nome="Contratada" papel="Representante legal" />
        <Assinatura nome={c.clienteNome} papel="Contratante" />
      </div>
      <p style={{ marginTop: 28, fontWeight: 600 }}>Testemunhas</p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32, marginTop: 24 }}>
        <p>1. ____________________________________<br />CPF: ______________________</p>
        <p>2. ____________________________________<br />CPF: ______________________</p>
      </div>
    </div>
  );
}
