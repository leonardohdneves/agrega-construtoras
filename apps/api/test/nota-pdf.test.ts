import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lerPdf, linhasDoTexto, ErroPdf } from '../src/lib/pdf.ts';
import { completarLeitura, completarPelaChave, interpretarNotaPdf, leituraSuficiente, notaVazia } from '../src/lib/nota-pdf.ts';
import { acharChave, acharChaveNfse, chaveDoTexto, chavePlausivel, chaveValida, codificarCode128C, decodificarCode128, largurasDaLinha, partesDaChave, partesDaChaveNfse } from '../src/lib/code128.ts';
import { gerarDanfeExemplo } from '../src/lib/pdf-exemplo.ts';
import { notaDaIa } from '../src/lib/ia-nota.ts';

const pdf = (nome: string) => readFileSync(new URL(`./fixtures/${nome}`, import.meta.url));
const EMPRESA = '11222333000181';

test('lê texto com fontes Type0/ToUnicode (PDF do navegador) na ordem da página', () => {
  const linhas = linhasDoTexto(lerPdf(pdf('nfse.pdf')).itens).map((l) => l.texto);
  assert.equal(linhas[0], 'PREFEITURA MUNICIPAL DE PALMAS');
  assert.ok(linhas.includes('NOTA FISCAL DE SERVIÇOS ELETRÔNICA - NFS-e'));
  assert.ok(linhas.some((l) => l.startsWith('Nome/Razão Social: MECÂNICA PESADA TOCANTINS LTDA')));
});

test('arquivo que não é PDF é recusado', () => {
  assert.throws(() => lerPdf(Buffer.from('<nfeProc>…</nfeProc>')), ErroPdf);
});

test('DANFE de compra: chave pelo código de barras, totais, itens e parcelas', () => {
  const n = interpretarNotaPdf(lerPdf(pdf('danfe-compra.pdf')), { cnpjEmpresa: EMPRESA });
  assert.equal(n.tipo, 'nfe');
  assert.equal(n.chaveAcesso, '17261011444777000161550010000123451000043211');
  assert.equal(n.chaveVia, 'codigo_barras');
  assert.equal(n.numero, '12345');
  assert.equal(n.serie, '1');
  assert.equal(n.dataEmissao, '2026-10-05');
  assert.deepEqual(n.emitente, { documento: '11444777000161', nome: 'AREIAL RIO TOCANTINS LTDA' });
  assert.equal(n.destinatario?.documento, EMPRESA);
  assert.deepEqual(n.totais, { produtos: 1200000, frete: 75000, seguro: 0, desconto: 12000, outras: 0, ipi: 0, icmsSt: 0, total: 1263000 });
  assert.deepEqual(n.itens.map((i) => [i.descricao, i.ncm, i.unidade, i.quantidade, i.valor]), [
    ['AREIA MEDIA LAVADA', '25051000', 'M3', 300, 750000],
    ['PEDRISCO 0 GRANITICO PARA CONCRETO USINADO', '25171000', 'T', 150, 450000],
  ]);
  assert.deepEqual(n.duplicatas, [
    { numero: '001', vencimento: '2026-11-04', valor: 631500 },
    { numero: '002', vencimento: '2026-12-04', valor: 631500 },
  ]);
  assert.deepEqual(n.conferir, []);
  assert.ok(leituraSuficiente(n));
});

test('DANFE emitido pela própria empresa vira nota de venda (cliente = destinatário)', () => {
  const n = interpretarNotaPdf(lerPdf(pdf('danfe-venda.pdf')), { cnpjEmpresa: EMPRESA });
  assert.equal(n.emitente?.documento, EMPRESA);
  assert.deepEqual(n.destinatario, { documento: '45987123000104', nome: 'CONSTRUTORA PALMAS NORTE LTDA' });
  assert.equal(n.totais.outras, 45000);
  assert.equal(n.totais.total, 918000);
  assert.equal(n.itens[0].descricao, 'CONCRETO USINADO FCK 25 MPA BRITA 1');
});

test('NFS-e: prestador, discriminação e retenções como desconto (paga o líquido)', () => {
  const n = interpretarNotaPdf(lerPdf(pdf('nfse.pdf')), { cnpjEmpresa: EMPRESA });
  assert.equal(n.tipo, 'nfse');
  assert.equal(n.numero, '2026/000458');
  assert.equal(n.dataEmissao, '2026-10-03');
  assert.deepEqual(n.emitente, { documento: '23456789000195', nome: 'MECÂNICA PESADA TOCANTINS LTDA' });
  assert.equal(n.totais.produtos, 380000);
  assert.equal(n.totais.desconto, 24700);
  assert.equal(n.totais.total, 355300);
  assert.match(n.itens[0].descricao, /^Revisão do sistema hidráulico/);
  assert.equal(n.avisos.length, 1);
});

test('recibo: CPF do emitente, valor e "referente a"', () => {
  const n = interpretarNotaPdf(lerPdf(pdf('recibo.pdf')), { cnpjEmpresa: EMPRESA });
  assert.equal(n.tipo, 'recibo');
  assert.deepEqual(n.emitente, { documento: '52998224725', nome: 'JOÃO CARLOS FERREIRA' });
  assert.equal(n.totais.total, 85000);
  assert.equal(n.dataEmissao, '2026-10-02');
  assert.equal(n.itens[0].descricao, 'Frete de areia (2 viagens) da jazida até a usina');
});

test('DANFE gerado pelo exemplo é lido de volta (Helvetica, conteúdo comprimido)', () => {
  const chave = '17261022975318000120550010000204171000044170';
  const c = chaveValida(chave) ? chave : chave.slice(0, 43) + [...Array(10).keys()].find((d) => chaveValida(chave.slice(0, 43) + d));
  const arquivo = gerarDanfeExemplo({
    chave: c, numero: 20417, serie: 1, emissao: '2026-10-07',
    emitente: { nome: 'AREIAL RIO TOCANTINS LTDA', cnpj: '22975318000120', endereco: 'ROD. TO-010, KM 8' },
    destinatario: { nome: 'CONCRETEIRA MODELO LTDA', cnpj: EMPRESA }, natureza: 'VENDA',
    itens: [{ codigo: 'AR-02', descricao: 'AREIA MEDIA LAVADA', ncm: '25051000', cfop: '5101', unidade: 'M3', quantidade: 120, unitario: 92, total: 11040 }],
    frete: 480, desconto: 0, duplicatas: [{ numero: '001', vencimento: '2026-11-06', valor: 11520 }], informacoes: 'Pedido 318.',
  });
  const n = interpretarNotaPdf(lerPdf(arquivo), { cnpjEmpresa: EMPRESA });
  assert.equal(n.chaveAcesso, c);
  assert.equal(n.totais.total, 1152000);
  assert.equal(n.itens.length, 1);
  assert.equal(n.duplicatas.length, 1);
  assert.equal(n.informacoes, 'Pedido 318.');
});

test('Code 128: codifica e decodifica, inclusive de trás para frente e com tinta "engordando" as barras', () => {
  const chave = '17261011444777000161550010000123451000043211';
  const mod = codificarCode128C(chave);
  assert.equal(decodificarCode128(mod), chave);
  // Barras 0,6 módulo mais grossas e espaços mais finos.
  const borrado = mod.map((w, i) => (i % 2 === 0 ? w * 3 + 1.8 : w * 3 - 1.8));
  assert.equal(decodificarCode128(borrado), chave);
  // Lixo antes e depois.
  assert.equal(decodificarCode128([5, 3, 9, 1, ...mod.map((w) => w * 2), 7, 2]), chave);
});

test('Code 128 em pixels: linha de imagem em baixa resolução com borda suavizada', () => {
  const chave = '17261011444777000161550010000123451000043211';
  const mod = 1.7; // ~150 dpi com módulo de 0,27 mm
  const larguras = codificarCode128C(chave);
  const total = Math.ceil(larguras.reduce((s, w) => s + w, 0) * mod) + 40;
  const px = new Float32Array(total).fill(240);
  let x = 20;
  larguras.forEach((w, i) => {
    if (i % 2 === 0) for (let p = Math.floor(x); p < Math.ceil(x + w * mod); p++) px[p] = 240 - 230 * Math.max(0, Math.min(1, Math.min(p + 1, x + w * mod) - Math.max(p, x)));
    x += w * mod;
  });
  assert.equal(decodificarCode128(largurasDaLinha(Array.from(px, Math.round), 0, total)), chave);
});

test('chave de acesso: dígito verificador, partes e busca no texto', () => {
  assert.ok(chaveValida('17261011444777000161550010000123451000043211'));
  assert.ok(!chaveValida('17261011444777000161550010000123451000043212'));
  assert.deepEqual(partesDaChave('17261011444777000161550010000123451000043211'), {
    uf: '17', anoMes: '2026-10', documento: '11444777000161', modelo: '55', serie: '1', numero: '12345', tipoEmissao: '1',
  });
  assert.equal(acharChave('CHAVE DE ACESSO\n1726 1011 4447 7700 0161 5500 1000 0123 4510 0004 3211\n'), '17261011444777000161550010000123451000043211');
  // Números colados de uma tabela não viram chave.
  assert.equal(acharChave('300,0000 25,0000 7.500,00 0,00 12345678901234567890 1234'), null);
  assert.ok(!chavePlausivel('00000000000000000000000000000000000000000000'));
});

test('leitura pela chave completa número, série, emitente e mês', () => {
  const n = completarPelaChave({ ...notaVazia(), chaveAcesso: '17261011444777000161550010000123451000043211' });
  assert.equal(n.tipo, 'nfe');
  assert.equal(n.numero, '12345');
  assert.equal(n.emitente?.documento, '11444777000161');
  assert.equal(n.dataEmissao, '2026-10-01');
  assert.deepEqual(n.conferir, ['dataEmissao']);
});

test('resposta da IA vira nota em centavos; NFS-e soma retenções ao desconto; sem itens vira item único', () => {
  const n = completarLeitura(
    notaDaIa({ legivel: true, tipo: 'nfse', numero: '458', data_emissao: '2026-10-03', emitente_documento: '23.456.789/0001-95', emitente_nome: 'Mecânica', valor_produtos: 3800, retencoes: 247, valor_total: 3553, itens: [], duvidas: ['itens'] }),
  );
  assert.equal(n.emitente?.documento, '23456789000195');
  assert.equal(n.totais.desconto, 24700);
  assert.equal(n.totais.total, 355300);
  assert.equal(n.itens.length, 1);
  assert.equal(n.itens[0].valor, 380000);
  assert.deepEqual(n.conferir, ['itens']);
  assert.equal(notaDaIa({ legivel: false }).textoUtil, false);
});

test('o decodificador do navegador é cópia exata do da API', () => {
  const api = readFileSync(new URL('../src/lib/code128.ts', import.meta.url), 'utf8');
  const web = readFileSync(new URL('../../web/src/code128.ts', import.meta.url), 'utf8');
  assert.equal(web, api);
});

test('NFS-e do padrão nacional (DANFSe): chave de 50 dígitos, prestador, descrição e valor líquido', () => {
  const n = interpretarNotaPdf(lerPdf(pdf('danfse-nacional.pdf')), { cnpjEmpresa: EMPRESA });
  assert.equal(n.tipo, 'nfse');
  assert.equal(n.chaveAcesso, '17210001223456789000195000000000045826101234567895');
  assert.equal(n.numero, '458');
  assert.equal(n.dataEmissao, '2026-10-03');
  assert.deepEqual(n.emitente, { documento: '23456789000195', nome: 'MECÂNICA PESADA TOCANTINS LTDA' });
  assert.deepEqual(n.destinatario, { documento: EMPRESA, nome: 'CONCRETEIRA MODELO LTDA' });
  assert.equal(n.totais.produtos, 380000);
  assert.equal(n.totais.total, 355300);
  assert.match(n.itens[0].descricao, /^Revisão do sistema hidráulico/);
  assert.ok(leituraSuficiente(n));
});

test('chave da NFS-e nacional: partes, busca no texto e texto colado ou de QR code', () => {
  const c = '17210001223456789000195000000000045826101234567895';
  assert.deepEqual(partesDaChaveNfse(c), { municipio: '1721000', documento: '23456789000195', numero: '458', anoMes: '2026-10' });
  assert.equal(acharChaveNfse('Chave de Acesso da NFS-e\n17210 00122 34567 89000 19500 00000 00045 82610 12345 67895'), c);
  assert.equal(chaveDoTexto(`https://www.nfse.gov.br/consultapublica/?tpc=1&chave=${c}`), c);
  assert.equal(chaveDoTexto(' 1726 1011 4447 7700 0161 5500 1000 0123 4510 0004 3211 '), '17261011444777000161550010000123451000043211');
  assert.equal(chaveDoTexto('sem chave aqui 123'), null);
  const n = completarPelaChave({ ...notaVazia(), chaveAcesso: c });
  assert.equal(n.tipo, 'nfse');
  assert.equal(n.numero, '458');
  assert.equal(n.emitente?.documento, '23456789000195');
});

test('itens que não fecham com o valor dos produtos continuam listados, com aviso e para conferir', () => {
  const n = completarLeitura(
    notaDaIa({
      legivel: true, tipo: 'nfe', numero: '78373', valor_produtos: '1.500,00', valor_total: 1500,
      itens: [
        { descricao: 'CIMENTO CP II-F 32 SC 50KG', quantidade: '20', valor_unitario: '35,90', valor_total: '718,00' },
        { descricao: 'ARGAMASSA AC-I 20KG', quantidade: 10, valor_unitario: 18.5 },
      ],
    }),
  );
  assert.deepEqual(n.itens.map((i) => [i.descricao, i.quantidade, i.valor]), [
    ['CIMENTO CP II-F 32 SC 50KG', 20, 71800],
    ['ARGAMASSA AC-I 20KG', 10, 18500],
  ]);
  assert.ok(n.conferir.includes('itens'));
  assert.match(n.avisos.join(' '), /soma dos itens lidos \(R\$\s?903,00\) é diferente do valor dos produtos na nota \(R\$\s?1\.500,00\)/);
});
