import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ErroNfe, fecharCentavos, lerNfe } from '../src/lib/nfe.ts';
import { escolherRegra, sugerirPorPalavras } from '../src/lib/sugestoes.ts';

const xml = readFileSync(new URL('./fixtures/nfe-posto.xml', import.meta.url), 'utf8');

test('lê cabeçalho, emitente, destinatário e protocolo da NF-e', () => {
  const n = lerNfe(xml);
  assert.equal(n.chaveAcesso, '17261011222333000181550010000012341000012345');
  assert.equal(n.modelo, 'nfe');
  assert.equal(n.numero, '1234');
  assert.equal(n.serie, '1');
  assert.equal(n.dataEmissao, '2026-09-30');
  assert.equal(n.tipoOperacao, 'saida');
  assert.equal(n.emitente.documento, '11444777000161');
  assert.equal(n.emitente.fantasia, 'POSTO EXEMPLO');
  assert.equal(n.emitente.cidade, 'Palmas');
  assert.equal(n.destinatario?.documento, '11222333000181');
  assert.equal(n.autorizada, true);
  assert.equal(n.informacoes, 'Faturamento quinzenal & frota');
});

test('itens trazem custo efetivo e a soma bate com o total da nota', () => {
  const n = lerNfe(xml);
  assert.equal(n.itens.length, 2);
  const [diesel, arla] = n.itens;
  assert.equal(diesel.descricao, 'OLEO DIESEL S10');
  assert.equal(diesel.quantidade, 3000);
  assert.equal(diesel.valorProduto, 1827000);
  assert.equal(diesel.valorCusto, 1800000); // 18.270 − 270 de desconto
  assert.equal(arla.valorCusto, 72000); // 700 + 15,25 ST + 4,75 IPI
  assert.equal(n.totais.total, 1872000);
  assert.equal(n.itens.reduce((s, i) => s + i.valorCusto, 0), n.totais.total);
  assert.deepEqual(n.duplicatas.map((d) => [d.vencimento, d.valor]), [['2026-10-15', 936000], ['2026-10-30', 936000]]);
  assert.deepEqual(n.formasPagamento, ['15']);
});

test('frete só no total é distribuído pelos itens', () => {
  const x = xml.replace('<vFrete>0.00</vFrete>', '<vFrete>100.00</vFrete>').replace('<vNF>18720.00</vNF>', '<vNF>18820.00</vNF>');
  const n = lerNfe(x);
  assert.equal(n.itens.reduce((s, i) => s + i.valorCusto, 0), 1882000);
  assert.ok(n.itens[0].valorCusto > 1800000);
});

test('recusa arquivos que não são NF-e', () => {
  assert.throws(() => lerNfe('<CompNfse><Nfse><InfNfse>…</InfNfse></Nfse></CompNfse>' + ' '.repeat(60)), /NFS-e/);
  assert.throws(() => lerNfe('<html><body>' + 'x'.repeat(80) + '</body></html>'), ErroNfe);
});

test('fecharCentavos ajusta a diferença no maior valor', () => {
  assert.deepEqual(fecharCentavos([100, 300, 200], 601), [100, 301, 200]);
});

test('sugere categoria por descrição e NCM', () => {
  assert.equal(sugerirPorPalavras('OLEO DIESEL S10', '27101921')?.codigo, '4.1');
  assert.equal(sugerirPorPalavras('ARLA 32 GRANEL', null)?.codigo, '4.4');
  assert.equal(sugerirPorPalavras('Óleo lubrificante 15W40', null)?.codigo, '4.4');
  assert.equal(sugerirPorPalavras('CIMENTO CP II-F 32 granel', null)?.codigo, '3.1');
  assert.equal(sugerirPorPalavras('PNEU 275/80 R22.5', null)?.codigo, '4.3');
  assert.equal(sugerirPorPalavras('Produto qualquer', '25171000')?.codigo, '3.3');
  assert.equal(sugerirPorPalavras('Produto qualquer', null), null);
});

test('regra mais específica vence', () => {
  const regras = [
    { id: 'a', fornecedorId: 'F', textoContem: null, ncm: null, planoContaId: 'geral', centroCustoId: null, veiculoId: null },
    { id: 'b', fornecedorId: 'F', textoContem: 'diesel', ncm: null, planoContaId: 'diesel', centroCustoId: null, veiculoId: null },
    { id: 'c', fornecedorId: null, textoContem: 'diesel', ncm: null, planoContaId: 'outro', centroCustoId: null, veiculoId: null },
  ];
  assert.equal(escolherRegra(regras, 'F', 'ÓLEO DIESEL S10', null)?.id, 'b');
  assert.equal(escolherRegra(regras, 'F', 'ARLA', null)?.id, 'a');
  assert.equal(escolherRegra(regras, 'G', 'Diesel S500', null)?.id, 'c');
  assert.equal(escolherRegra(regras, 'G', 'ARLA', null), null);
});
