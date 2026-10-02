// Arquivos para demonstrar a importação ao vivo (só no ambiente de teste e só na empresa de demonstração):
// o extrato OFX dos últimos dias do banco e a NF-e do posto da última quinzena fechada.
// Os dois são montados a partir dos dados atuais, então sempre batem com o que está no sistema.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Banco } from '../db.ts';
import { ErroHttp } from '../lib/erros.ts';
import { hojeBrasil } from '../lib/frota.ts';
import { somarDias } from '../lib/financeiro.ts';
import { chaveNfe, cnpjDe, NOME_POSTO, RAIZ_POSTO, util } from '../lib/demo-modelo.ts';
import { empresaDo, exigir } from '../sessao.ts';
import { SQL_SALDO } from './financeiro.ts';

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '');
const valor = (centavos: number) => (centavos / 100).toFixed(2);
const dataOfx = (d: string) => `${d.replace(/-/g, '')}120000[-3:BRT]`;
const xmlTexto = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function rotasDemo(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.addHook('preHandler', exigir(banco, 'dono', 'gestor'));
    app.addHook('preHandler', async (req: FastifyRequest) => {
      const e = (await banco.query('SELECT plano FROM empresas WHERE id = $1', [empresaDo(req)])).rows[0];
      if (e?.plano !== 'demonstracao') throw new ErroHttp(404, 'Disponível só na empresa de demonstração.');
    });

    const enviar = (reply: FastifyReply, nome: string, tipo: string, conteudo: string) =>
      reply.header('Content-Type', tipo).header('Content-Disposition', `attachment; filename="${nome}"`).header('Cache-Control', 'no-store').send(conteudo);

    // ----- Extrato OFX da conta corrente: últimos 7 dias.
    app.get('/extrato.ofx', async (req, reply) => {
      const empresaId = empresaDo(req);
      const hoje = hojeBrasil();
      const de = somarDias(hoje, -7);
      const conta = (
        await banco.query(
          `SELECT c.id, c.agencia, c.conta, (${SQL_SALDO}) AS saldo FROM contas_financeiras c
            WHERE c.empresa_id = $1 AND c.tipo = 'banco' AND c.excluido_em IS NULL ORDER BY c.criado_em LIMIT 1`,
          [empresaId],
        )
      ).rows[0];
      if (!conta) throw new ErroHttp(404, 'Conta bancária não encontrada.');
      const ja = `NOT EXISTS (SELECT 1 FROM extrato_linhas x WHERE x.parcela_id = p.id)`;
      type Linha = { data: string; valor: number; fitid: string; nome: string; memo: string };
      const linhas: Linha[] = [];
      const nomeForma: Record<string, [string, string]> = {
        boleto: ['TITULO COBRANCA', 'PAG BOLETO'], pix: ['PIX RECEBIDO', 'PIX ENVIADO'], transferencia: ['TED RECEBIDA', 'TED ENVIADA'],
        debito_automatico: ['CREDITO', 'DEB AUTOMATICO'], cartao: ['CREDITO', 'PAG CARTAO'],
      };
      // Pagamentos e recebimentos já baixados nesta conta.
      const pagas = (
        await banco.query(
          `SELECT p.id, p.data_pagamento AS data, p.valor_pago_centavos AS v, p.forma_pagamento AS forma, l.tipo, l.descricao,
                  coalesce(f.nome_fantasia, f.razao_social, cl.nome_fantasia, cl.razao_social) AS pessoa
             FROM parcelas p JOIN lancamentos l ON l.id = p.lancamento_id
             LEFT JOIN fornecedores f ON f.id = l.fornecedor_id LEFT JOIN clientes cl ON cl.id = l.cliente_id
            WHERE p.empresa_id = $1 AND p.conta_financeira_id = $2 AND p.status = 'paga' AND l.status = 'confirmado' AND l.excluido_em IS NULL
              AND p.data_pagamento BETWEEN $3 AND $4 AND ${ja}`,
          [empresaId, conta.id, de, hoje],
        )
      ).rows;
      for (const p of pagas) {
        const receita = p.tipo === 'receita';
        linhas.push({
          data: p.data, valor: receita ? Number(p.v) : -Number(p.v), fitid: `P${String(p.id).replace(/-/g, '').slice(0, 14)}`,
          nome: (nomeForma[p.forma] ?? ['CREDITO', 'DEBITO'])[receita ? 0 : 1], memo: p.pessoa ?? p.descricao,
        });
      }
      // Clientes que pagaram no vencimento (ainda em aberto no sistema).
      const abertas = (
        await banco.query(
          `SELECT p.id, p.vencimento AS data, p.valor_centavos AS v, coalesce(cl.nome_fantasia, cl.razao_social) AS pessoa
             FROM parcelas p JOIN lancamentos l ON l.id = p.lancamento_id LEFT JOIN clientes cl ON cl.id = l.cliente_id
            WHERE p.empresa_id = $1 AND l.tipo = 'receita' AND l.status = 'confirmado' AND l.excluido_em IS NULL AND p.status = 'aberta'
              AND p.vencimento BETWEEN $2 AND $3 AND ${ja}
              -- Cliente que já está com outra parcela atrasada não pagou esta também.
              AND NOT EXISTS (SELECT 1 FROM parcelas p2 JOIN lancamentos l2 ON l2.id = p2.lancamento_id
                               WHERE l2.cliente_id = l.cliente_id AND p2.status = 'aberta' AND l2.status = 'confirmado' AND l2.excluido_em IS NULL AND p2.vencimento < $2)`,
          [empresaId, de, somarDias(hoje, -1)],
        )
      ).rows;
      let creditos = 0;
      for (const [i, p] of abertas.entries()) {
        const data = util(p.data) > hoje ? hoje : util(p.data);
        creditos += Number(p.v);
        linhas.push({ data, valor: Number(p.v), fitid: `A${String(p.id).replace(/-/g, '').slice(0, 14)}`, nome: i % 2 ? 'PIX RECEBIDO' : 'TITULO COBRANCA', memo: p.pessoa ?? 'CLIENTE' });
      }
      // Transferências para o caixa.
      const transf = (
        await banco.query(
          `SELECT t.id, t.data, t.valor_centavos AS v, t.conta_destino_id = $2 AS entrada FROM transferencias t
            WHERE t.empresa_id = $1 AND t.excluido_em IS NULL AND (t.conta_origem_id = $2 OR t.conta_destino_id = $2) AND t.data BETWEEN $3 AND $4
              AND NOT EXISTS (SELECT 1 FROM extrato_linhas x WHERE x.transferencia_id = t.id)`,
          [empresaId, conta.id, de, hoje],
        )
      ).rows;
      for (const t of transf) {
        linhas.push({ data: t.data, valor: t.entrada ? Number(t.v) : -Number(t.v), fitid: `T${String(t.id).replace(/-/g, '').slice(0, 14)}`, nome: 'SAQUE', memo: 'SAQUE PARA CAIXA DA USINA' });
      }
      // Tarifa e IOF que ninguém lançou ainda.
      const tarifa = util(`${hoje.slice(0, 7)}-01`) <= hoje ? util(`${hoje.slice(0, 7)}-01`) : de;
      linhas.push({ data: tarifa, valor: -18990, fitid: `TAR${tarifa.replace(/-/g, '')}`, nome: 'TARIFA', memo: 'TARIFA PACOTE SERVICOS' });
      linhas.push({ data: somarDias(hoje, -1), valor: -1473, fitid: `IOF${hoje.replace(/-/g, '')}`, nome: 'IOF', memo: 'IOF SOBRE SALDO DEVEDOR' });
      linhas.sort((a, b) => a.data.localeCompare(b.data) || a.fitid.localeCompare(b.fitid));

      const saldo = Number(conta.saldo) + creditos - 18990 - 1473;
      const transacoes = linhas
        .map(
          (l) => `<STMTTRN>
<TRNTYPE>${l.valor > 0 ? 'CREDIT' : 'DEBIT'}
<DTPOSTED>${dataOfx(l.data)}
<TRNAMT>${valor(l.valor)}
<FITID>${l.fitid}
<NAME>${semAcento(l.nome).slice(0, 32)}
<MEMO>${semAcento(l.memo).toUpperCase().slice(0, 60)}
</STMTTRN>`,
        )
        .join('\n');
      const ofx = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<DTSERVER>${dataOfx(hoje)}
<LANGUAGE>POR
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<STMTRS>
<CURDEF>BRL
<BANKACCTFROM>
<BANKID>999
<BRANCHID>${conta.agencia ?? '0001'}
<ACCTID>${conta.conta ?? '12345-6'}
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>${dataOfx(de)}
<DTEND>${dataOfx(hoje)}
${transacoes}
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>${valor(saldo)}
<DTASOF>${dataOfx(hoje)}
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`;
      return enviar(reply, `extrato-banco-modelo-${hoje}.ofx`, 'application/x-ofx; charset=us-ascii', ofx.replace(/\n/g, '\r\n'));
    });

    // ----- NF-e do posto: última quinzena fechada com abastecimentos ainda sem nota.
    app.get('/nfe-posto.xml', async (req, reply) => {
      const empresaId = empresaDo(req);
      const hoje = hojeBrasil();
      const empresa = (await banco.query('SELECT cnpj, razao_social FROM empresas WHERE id = $1', [empresaId])).rows[0];
      const cnpjPosto = cnpjDe(RAIZ_POSTO);
      const dia = Number(hoje.slice(8, 10));
      // Quinzena fechada mais recente.
      const ate = dia > 15 ? `${hoje.slice(0, 7)}-15` : somarDias(`${hoje.slice(0, 7)}-01`, -1);
      const de = `${ate.slice(0, 8)}${dia > 15 ? '01' : '16'}`;
      const ab = (
        await banco.query(
          `SELECT coalesce(sum(litros), 0) AS litros, coalesce(sum(valor_total_centavos), 0) AS valor, count(*)::int AS n FROM abastecimentos
            WHERE empresa_id = $1 AND excluido_em IS NULL AND origem = 'posto' AND nota_item_id IS NULL
              AND (data_hora AT TIME ZONE 'America/Sao_Paulo')::date BETWEEN $2 AND $3`,
          [empresaId, de, ate],
        )
      ).rows[0];
      if (!ab.n) throw new ErroHttp(404, `Os abastecimentos de ${de.slice(8)}/${de.slice(5, 7)} a ${ate.slice(8)}/${ate.slice(5, 7)} já têm nota.`);
      const ultima = (await banco.query("SELECT max(numero::int) AS n FROM notas_fiscais WHERE empresa_id = $1 AND emitente_documento = $2 AND numero ~ '^[0-9]+$'", [empresaId, cnpjPosto])).rows[0];
      const numero = Number(ultima?.n ?? 18230) + 1;
      const emissao = ate;
      const chave = chaveNfe(emissao, cnpjPosto, numero, 52000000 + numero);
      const litros = Number(ab.litros);
      const vDiesel = Number(ab.valor);
      const arla = Math.round(litros * 0.045);
      const vArla = Math.round(arla * 385);
      const total = vDiesel + vArla;
      const venc = util(somarDias(emissao, 15));
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
<infNFe Id="NFe${chave}" versao="4.00">
<ide><cUF>17</cUF><cNF>${chave.slice(35, 43)}</cNF><natOp>VENDA DE COMBUSTIVEL OU LUBRIFICANTE</natOp><mod>55</mod><serie>1</serie><nNF>${numero}</nNF><dhEmi>${emissao}T08:30:00-03:00</dhEmi><tpNF>1</tpNF><tpEmis>1</tpEmis><cDV>${chave.slice(-1)}</cDV></ide>
<emit><CNPJ>${cnpjPosto}</CNPJ><xNome>${xmlTexto(semAcento(NOME_POSTO).toUpperCase())}</xNome><xFant>POSTO CAPITAL</xFant><enderEmit><xLgr>RODOVIA TO-050 KM 3</xLgr><xMun>Palmas</xMun><UF>TO</UF><fone>6332140000</fone></enderEmit><IE>290000001</IE></emit>
<dest><CNPJ>${empresa.cnpj}</CNPJ><xNome>${xmlTexto(semAcento(empresa.razao_social).toUpperCase())}</xNome><enderDest><xMun>Palmas</xMun><UF>TO</UF></enderDest></dest>
<det nItem="1"><prod><cProd>001</cProd><xProd>OLEO DIESEL B S10</xProd><NCM>27101921</NCM><CFOP>5656</CFOP><uCom>L</uCom><qCom>${litros.toFixed(4)}</qCom><vUnCom>${(vDiesel / 100 / litros).toFixed(10)}</vUnCom><vProd>${valor(vDiesel)}</vProd><comb><cProdANP>820101034</cProdANP><descANP>OLEO DIESEL B S10 - COMUM</descANP></comb></prod><imposto><ICMS><ICMS61><orig>0</orig><CST>61</CST></ICMS61></ICMS></imposto></det>
<det nItem="2"><prod><cProd>050</cProd><xProd>ARLA 32 GRANEL</xProd><NCM>31021010</NCM><CFOP>5102</CFOP><uCom>L</uCom><qCom>${arla.toFixed(4)}</qCom><vUnCom>3.8500000000</vUnCom><vProd>${valor(vArla)}</vProd></prod><imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST></ICMS00></ICMS></imposto></det>
<total><ICMSTot><vProd>${valor(total)}</vProd><vST>0.00</vST><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vIPI>0.00</vIPI><vOutro>0.00</vOutro><vNF>${valor(total)}</vNF></ICMSTot></total>
<cobr><fat><nFat>${numero}</nFat><vOrig>${valor(total)}</vOrig><vLiq>${valor(total)}</vLiq></fat><dup><nDup>001</nDup><dVenc>${venc}</dVenc><vDup>${valor(total)}</vDup></dup></cobr>
<pag><detPag><tPag>15</tPag><vPag>${valor(total)}</vPag></detPag></pag>
<infAdic><infCpl>Faturamento quinzenal de ${de.split('-').reverse().join('/')} a ${ate.split('-').reverse().join('/')}. ${ab.n} abastecimentos da frota.</infCpl></infAdic>
</infNFe></NFe>
<protNFe versao="4.00"><infProt><tpAmb>1</tpAmb><chNFe>${chave}</chNFe><dhRecbto>${emissao}T08:31:12-03:00</dhRecbto><nProt>317${chave.slice(30, 42)}</nProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>
</nfeProc>
`;
      return enviar(reply, `nfe-${numero}-posto-capital.xml`, 'application/xml; charset=utf-8', xml);
    });
  };
}
