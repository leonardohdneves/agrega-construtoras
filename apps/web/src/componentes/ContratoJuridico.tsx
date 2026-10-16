// Minuta jurídica do contrato de prestação de serviços (Suprimentos). O texto sai dos dados do próprio contrato;
// os prazos do termo (vícios e garantia) são preenchidos aqui mesmo e salvos no contrato. Os endereços vêm dos cadastros.
import { useState, type FormEvent } from 'react';
import { api, formatarCnpj, formatarData, formatarDocumento, formatarMoeda, hojeLocal, NOMES_FORMA, type FormaPagamento } from '../api';
import { useSessao } from '../sessao';
import { imprimirPagina } from './Documento';
import { Assinatura, numeroDoc, precoUn, qtd, type Contrato, type Retencoes } from './Suprimentos';

/** Imprime só a minuta (CSS em estilos.css): marca a página e limpa a marca quando a impressão termina. */
function imprimirMinuta() {
  document.documentElement.dataset.impressao = 'minuta';
  window.addEventListener('afterprint', () => delete document.documentElement.dataset.impressao, { once: true });
  imprimirPagina({ orientacao: 'retrato', papel: 'A4' });
}

type Clausula = { titulo: string; paragrafos: string[] };

const pct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const RETENCOES_NOMES: Record<keyof Retencoes, string> = { caucao: 'caução', iss: 'ISS', inss: 'INSS', ir: 'IR', pcc: 'PIS/COFINS/CSLL' };

/** Cláusulas do contrato, do objeto ao foro. Função pura, para o texto ficar igual na tela e na impressão. */
export function clausulasContrato(k: Contrato, contratante: string): Clausula[] {
  const valor = formatarMoeda(k.resumo.valorContrato);
  const retidos = (Object.keys(RETENCOES_NOMES) as (keyof Retencoes)[]).filter((c) => k.retencoes[c] > 0);
  const forma = k.formaPagamento ? NOMES_FORMA[k.formaPagamento as FormaPagamento] ?? k.formaPagamento : 'a combinar';
  const vigencia = k.fim
    ? `de ${formatarData(k.inicio)} a ${formatarData(k.fim)}`
    : `a partir de ${formatarData(k.inicio)}, por prazo indeterminado, até a conclusão dos serviços contratados`;

  return [
    {
      titulo: 'Objeto',
      paragrafos: [
        `A CONTRATADA presta à CONTRATANTE os serviços de ${k.objeto}, na obra indicada pela CONTRATANTE${k.centroCusto ? ` (${k.centroCusto})` : ''}, com a mão de obra, equipamentos e materiais previstos neste contrato.`,
        k.tipo === 'itens'
          ? 'Os serviços, quantidades e preços unitários estão no Anexo I, que faz parte deste contrato.'
          : 'O serviço é contratado por valor global, pago conforme o percentual ou o valor executado em cada medição.',
      ],
    },
    {
      titulo: 'Medição e preço',
      paragrafos: [
        k.tipo === 'itens'
          ? `O valor total do contrato é de ${valor}. Os serviços são medidos por período, pela quantidade efetivamente executada e aprovada pela CONTRATANTE. Os preços unitários são fixos durante a vigência, salvo aditivo escrito.`
          : `O valor global do contrato é de ${valor}. Cada medição informa o percentual ou o valor executado no período, aprovado pela CONTRATANTE.`,
        'Serviços executados fora do escopo contratado só são pagos mediante aditivo por escrito, assinado pelas partes antes da execução.',
      ],
    },
    {
      titulo: 'Vigência',
      paragrafos: [`O contrato vigora ${vigencia}. Prorrogação ou alteração de prazo depende de aditivo escrito.`],
    },
    {
      titulo: 'Pagamento',
      paragrafos: [
        `Cada medição aprovada gera uma autorização de pagamento, paga em até ${k.prazoPagamentoDias} dias após a autorização, pela forma ${forma}, mediante nota fiscal ou recibo emitido pela CONTRATADA.`,
      ],
    },
    {
      titulo: 'Retenções e tributos',
      paragrafos: [
        retidos.length
          ? `Sobre o valor bruto de cada medição incidem as seguintes retenções: ${retidos.map((c) => `${RETENCOES_NOMES[c]} de ${pct(k.retencoes[c])}`).join('; ')}. A caução fica retida e é liberada no encerramento do contrato. Os impostos retidos são recolhidos pela CONTRATANTE nos prazos legais.`
          : 'Não há retenções contratuais. Os tributos incidentes sobre a receita da CONTRATADA são de responsabilidade dela.',
      ],
    },
    {
      titulo: 'Obrigações da CONTRATADA',
      paragrafos: [
        'Executar os serviços com diligência, conforme as especificações, os prazos e o cronograma da obra, e com profissionais habilitados.',
        'Fornecer e exigir o uso de EPIs por sua equipe e cumprir as normas regulamentadoras de segurança e saúde no trabalho aplicáveis.',
        'Manter a obra limpa e organizada e retirar o próprio entulho e equipamentos ao final de cada etapa.',
      ],
    },
    {
      titulo: 'Obrigações da CONTRATANTE',
      paragrafos: [
        'Liberar o acesso à obra, fornecer as informações necessárias à execução e medir e aprovar as medições em prazo razoável.',
        'Pagar as autorizações de pagamento nas datas acordadas.',
      ],
    },
    {
      titulo: 'Encargos trabalhistas, previdenciários e fiscais',
      paragrafos: [
        'A CONTRATADA é a única responsável pelos salários, encargos sociais, FGTS, INSS, seguros e demais obrigações trabalhistas e previdenciárias de seus empregados e subcontratados, e pelos acidentes que eles sofrerem.',
        'A CONTRATADA apresentará, a cada medição ou quando solicitada, as certidões de regularidade trabalhista e previdenciária. Na falta delas, a CONTRATANTE poderá reter pagamentos para cobrir eventuais obrigações não cumpridas, nos termos da legislação aplicável.',
      ],
    },
    {
      titulo: 'Subcontratação',
      paragrafos: ['A CONTRATADA não poderá subcontratar, no todo ou em parte, os serviços sem autorização escrita da CONTRATANTE. Mesmo com autorização, a responsabilidade pelo serviço permanece com a CONTRATADA.'],
    },
    {
      titulo: 'Garantia e correção de vícios',
      paragrafos: [
        `A CONTRATADA corrigirá, sem custo para a CONTRATANTE, os vícios de execução identificados em até ${k.prazoCorrecaoDias ?? '—'} dias após a comunicação, pelo prazo de garantia de ${k.garantiaMeses ?? '—'} meses.`,
      ],
    },
    {
      titulo: 'Responsabilidade por danos',
      paragrafos: ['Cada parte responde pelos danos que causar a terceiros, à obra ou à outra parte por culpa ou dolo, inclusive os causados por seus empregados e subcontratados.'],
    },
    {
      titulo: 'Rescisão',
      paragrafos: [
        'Qualquer parte pode rescindir o contrato por descumprimento da outra que não seja sanado em 10 dias após notificação escrita.',
        'A CONTRATANTE pode rescindir a qualquer tempo, mediante aviso de 30 dias. Nesse caso, pagará os serviços executados e aprovados até a data da rescisão.',
      ],
    },
    {
      titulo: 'Confidencialidade',
      paragrafos: ['As partes mantêm sigilo sobre as informações técnicas e comerciais que receberem uma da outra, pelo prazo de 5 anos após o término do contrato.'],
    },
    {
      titulo: 'Alterações',
      paragrafos: ['Qualquer alteração deste contrato será feita por escrito, por meio de aditivo assinado pelas partes.'],
    },
    {
      titulo: 'Solução de conflitos',
      paragrafos: [
        'Eventuais conflitos decorrentes deste contrato serão resolvidos por arbitragem, administrada pela 1ª Câmara de Conciliação e Arbitragem de Palmas, segundo o regulamento dela, com sede em Palmas/TO. A sentença arbitral é definitiva. As partes podem buscar medidas urgentes no Poder Judiciário.',
      ],
    },
  ].map((c, i) => ({ ...c, titulo: `${i + 1}. ${c.titulo}` }));
}

/** Dados que o termo jurídico exige e que ainda não foram preenchidos no contrato. */
export function pendenciasMinuta(k: Contrato): string[] {
  const p: string[] = [];
  if (!k.enderecoContratante) p.push('endereço da empresa que executa a obra (cadastro da empresa do grupo, na obra)');
  if (!k.enderecoContratada) p.push('endereço do prestador (cadastro do fornecedor)');
  if (!k.prazoCorrecaoDias) p.push('prazo para corrigir vícios (no contrato)');
  if (!k.garantiaMeses) p.push('garantia dos serviços (no contrato)');
  return p;
}

/** Contrato impresso com texto jurídico, com anexo de serviços e assinaturas. */
/** Prazos do termo (vícios e garantia), salvos no contrato direto daqui. */
function PrazosMinuta({ k, aoAtualizar }: { k: Contrato; aoAtualizar: (n: Contrato) => void }) {
  const [dias, setDias] = useState(k.prazoCorrecaoDias ? String(k.prazoCorrecaoDias) : '');
  const [meses, setMeses] = useState(k.garantiaMeses ? String(k.garantiaMeses) : '');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const [salvo, setSalvo] = useState(false);
  const podeSalvar = ['rascunho', 'reprovado', 'vigente'].includes(k.status);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setSalvo(false);
    const d = dias ? Number(dias) : null;
    const m = meses ? Number(meses) : null;
    if (d !== null && (d < 1 || d > 365)) return setErro('Prazo para corrigir vícios: informe de 1 a 365 dias.');
    if (m !== null && (m < 1 || m > 120)) return setErro('Garantia: informe de 1 a 120 meses.');
    setOcupado(true);
    try {
      const r = await api<{ contrato: Contrato }>(`/sup/contratos/${k.id}/prazos`, { metodo: 'PATCH', corpo: { prazoCorrecaoDias: d, garantiaMeses: m } });
      aoAtualizar(r.contrato);
      setSalvo(true);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <form className="nao-imprimir prazos-minuta" onSubmit={salvar}>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {salvo && <div className="alerta alerta-ok" role="status">Prazos salvos no contrato.</div>}
      <div className="campos">
        <div className="campo">
          <label htmlFor="pm-correcao">Prazo para corrigir vícios (dias)</label>
          <input id="pm-correcao" inputMode="numeric" value={dias} disabled={!podeSalvar} onChange={(e) => setDias(e.target.value.replace(/\D/g, ''))} />
        </div>
        <div className="campo">
          <label htmlFor="pm-garantia">Garantia dos serviços (meses)</label>
          <input id="pm-garantia" inputMode="numeric" value={meses} disabled={!podeSalvar} onChange={(e) => setMeses(e.target.value.replace(/\D/g, ''))} />
        </div>
      </div>
      {podeSalvar ? (
        <div className="acoes">
          <button className="btn btn-secundario" type="submit" disabled={ocupado}>{ocupado ? 'Salvando…' : 'Salvar prazos'}</button>
        </div>
      ) : (
        <p className="small muted">Contrato neste status não muda os prazos.</p>
      )}
    </form>
  );
}

export function ContratoJuridico({ k, aoAtualizar }: { k: Contrato; aoAtualizar: (n: Contrato) => void }) {
  const { empresa } = useSessao();
  const contratante = empresa?.razaoSocial || empresa?.nomeFantasia || '[RAZÃO SOCIAL DA CONTRATANTE]';
  const cnpjContratante = empresa?.cnpj ? formatarCnpj(empresa.cnpj) : '[CNPJ]';
  const docContratada = k.fornecedor.documento ? formatarDocumento(k.fornecedor.documento) : '[CNPJ/CPF]';
  const pendencias = pendenciasMinuta(k);
  const clausulas = clausulasContrato(k, contratante);

  return (
    <article className="card minuta-juridica">
      <div className="acoes nao-imprimir">
        <button className="btn btn-primario" type="button" onClick={imprimirMinuta} disabled={pendencias.length > 0}>Imprimir minuta</button>
      </div>
      {pendencias.length > 0 && (
        <div className="alerta alerta-erro nao-imprimir">Antes de imprimir, complete: {pendencias.join('; ')}.</div>
      )}
      <PrazosMinuta k={k} aoAtualizar={aoAtualizar} />
      <div className="alerta alerta-info nao-imprimir">
        Aviso interno: esta minuta precisa ser revisada por advogado antes de ser entregue ao cliente. Este aviso não sai na impressão.
      </div>
      <header className="minuta-cabecalho">
        {empresa?.temLogo && <img className="minuta-logo" src={`/api/empresa/logo?v=${empresa.logoVersao ?? 0}`} alt="" />}
        <div className="minuta-empresa">
          <strong>{contratante}</strong>
          {empresa?.cnpj && <span>CNPJ {cnpjContratante}</span>}
        </div>
      </header>
      <h2>Contrato de prestação de serviços nº {numeroDoc(k.numero)}</h2>
      <p>
        Este contrato é firmado entre <b>{contratante}</b>, CNPJ {cnpjContratante}, com sede em {k.enderecoContratante ?? '—'} (CONTRATANTE), e{' '}
        <b>{k.fornecedor.razaoSocial}</b>, CNPJ/CPF {docContratada}, com sede em {k.enderecoContratada ?? '—'} (CONTRATADA).
      </p>

      {clausulas.map((c) => (
        <section key={c.titulo}>
          <h3>{c.titulo}</h3>
          {c.paragrafos.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </section>
      ))}

      {k.tipo === 'itens' && (
        <section>
          <h3>Anexo I – Serviços e preços</h3>
          <div className="tabela-caixa">
            <table className="tabela tabela-compacta">
              <thead>
                <tr><th>Serviço</th><th style={{ textAlign: 'right' }}>Quantidade</th><th style={{ textAlign: 'right' }}>Preço unitário</th><th style={{ textAlign: 'right' }}>Total</th></tr>
              </thead>
              <tbody>
                {k.itens.map((i) => (
                  <tr key={i.id}>
                    <td>{i.descricao}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{qtd(i.quantidade, i.unidade)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{precoUn(i.precoUnitario)}</td>
                    <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(i.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={3} className="forte">Total do contrato</td><td className="mono forte" style={{ textAlign: 'right' }}>{formatarMoeda(k.resumo.valorContrato)}</td></tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      <p>E, por estarem de acordo, as partes firmam este contrato em duas vias de igual teor, na data abaixo.</p>
      <p className="small muted">{formatarData(k.dataAssinatura ?? hojeLocal())}</p>
      <div className="assinaturas">
        <Assinatura nome={k.fornecedor.razaoSocial} papel="Contratada" />
        <Assinatura nome={contratante} papel="Contratante" />
      </div>
    </article>
  );
}
