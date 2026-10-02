import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { categoriaDoExtrato, ErroOfx, lerOfx, valorOfx } from '../src/lib/ofx.ts';

const sgml = readFileSync(new URL('./fixtures/extrato-sgml.ofx', import.meta.url), 'utf8');

test('lê OFX 1.x (SGML) com vírgula decimal e sem FITID', () => {
  const e = lerOfx(sgml);
  assert.equal(e.banco, '0341');
  assert.equal(e.agencia, '0001');
  assert.equal(e.conta, '12345-6');
  assert.equal(e.inicio, '2026-09-01');
  assert.equal(e.fim, '2026-09-30');
  assert.equal(e.saldo, 933020);
  assert.equal(e.dataSaldo, '2026-09-30');
  assert.equal(e.linhas.length, 4);
  assert.deepEqual(e.linhas.map((l) => l.valor), [-150000, 1092000, -8990, -8990]);
  assert.equal(e.linhas[0].documento, '000123');
  assert.equal(e.linhas[1].descricao, 'TED RECEBIDA · CONSTRUTORA HORIZONTE');
  assert.notEqual(e.linhas[2].fitid, e.linhas[3].fitid, 'linhas iguais sem FITID ganham chaves diferentes');
});

test('lê OFX 2.x (XML) de cartão', () => {
  const xml = `<?xml version="1.0"?><?OFX OFXHEADER="200"?><OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><CURDEF>BRL</CURDEF>
  <CCACCTFROM><ACCTID>5555</ACCTID></CCACCTFROM><BANKTRANLIST><DTSTART>20261001</DTSTART><DTEND>20261031</DTEND>
  <STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261003</DTPOSTED><TRNAMT>-250.40</TRNAMT><FITID>abc</FITID><NAME>AUTO PECAS &amp; CIA</NAME></STMTTRN>
  </BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;
  const e = lerOfx(xml);
  assert.equal(e.cartao, true);
  assert.equal(e.conta, '5555');
  assert.equal(e.linhas[0].descricao, 'AUTO PECAS & CIA');
  assert.equal(e.linhas[0].valor, -25040);
});

test('valores e erros', () => {
  assert.equal(valorOfx('1.234,56'), 123456);
  assert.equal(valorOfx('-1,234.56'), -123456);
  assert.equal(valorOfx('+10'), 1000);
  assert.throws(() => lerOfx('qualquer coisa'), ErroOfx);
});

test('sugere categoria para tarifas e rendimentos', () => {
  assert.equal(categoriaDoExtrato('TARIFA PACOTE SERVICOS', -8990), '8.2');
  assert.equal(categoriaDoExtrato('IOF', -120), '8.1');
  assert.equal(categoriaDoExtrato('REND PAGO APLIC AUT', 4500), '8.4');
  assert.equal(categoriaDoExtrato('PIX RECEBIDO', 4500), null);
});
