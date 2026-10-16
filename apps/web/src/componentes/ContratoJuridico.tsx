// Minuta jurídica do contrato de prestação de serviços (Suprimentos). O texto sai dos dados do próprio contrato;
// o que o sistema não sabe (endereços, foro, garantia, prazo de correção) fica entre colchetes para preencher antes de assinar.
import { formatarCnpj, formatarData, formatarDocumento, formatarMoeda, hojeLocal, NOMES_FORMA, type FormaPagamento } from '../api';
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
        'A CONTRATADA corrigirá, sem custo para a CONTRATANTE, os vícios de execução identificados em até [PRAZO] dias após a comunicação, pelo prazo de garantia de [PRAZO DE GARANTIA].',
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
        'A CONTRATANTE pode rescindir a qualquer tempo, mediante aviso de [PRAZO DE AVISO] dias. Nesse caso, pagará os serviços executados e aprovados até a data da rescisão.',
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
      titulo: 'Foro',
      paragrafos: ['Fica eleito o foro da comarca de [CIDADE/UF], com exclusão de qualquer outro, para dirimir as controvérsias deste contrato.'],
    },
  ].map((c, i) => ({ ...c, titulo: `${i + 1}. ${c.titulo}` }));
}

/** Contrato impresso com texto jurídico, com anexo de serviços e assinaturas. */
export function ContratoJuridico({ k }: { k: Contrato }) {
  const { empresa } = useSessao();
  const contratante = empresa?.razaoSocial || empresa?.nomeFantasia || '[RAZÃO SOCIAL DA CONTRATANTE]';
  const cnpjContratante = empresa?.cnpj ? formatarCnpj(empresa.cnpj) : '[CNPJ]';
  const docContratada = k.fornecedor.documento ? formatarDocumento(k.fornecedor.documento) : '[CNPJ/CPF]';
  const enderecoContratada = k.fornecedor.cidade ? `${k.fornecedor.cidade}` : '[ENDEREÇO DA CONTRATADA]';
  const clausulas = clausulasContrato(k, contratante);

  return (
    <article className="card minuta-juridica">
      <div className="acoes nao-imprimir">
        <button className="btn btn-primario" type="button" onClick={imprimirMinuta}>Imprimir minuta</button>
      </div>
      <div className="alerta alerta-info nao-imprimir">
        Aviso interno: esta minuta precisa ser revisada por advogado antes de ser entregue ao cliente. Os campos entre colchetes precisam ser preenchidos. Este aviso não sai na impressão.
      </div>
      <h2>Contrato de prestação de serviços nº {numeroDoc(k.numero)}</h2>
      <p>
        Este contrato é firmado entre <b>{contratante}</b>, CNPJ {cnpjContratante}, com sede em [ENDEREÇO DA CONTRATANTE] (CONTRATANTE), e{' '}
        <b>{k.fornecedor.razaoSocial}</b>, CNPJ/CPF {docContratada}, com sede em {enderecoContratada} (CONTRATADA).
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
