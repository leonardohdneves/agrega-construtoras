// Leitura de quantitativos em HTML estático: tabelas, números brasileiros, grupos de itens e classificação do serviço.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classificarServico, geraTabelasPorScript, numeroBrasileiro, quantitativosDasTabelas, tabelasDoHtml, textoDoHtml } from '../src/lib/leitura-html.ts';

const CONTENCAO = `
<h2>2 Quantitativo da contenção</h2>
<table>
  <tr><th>Item</th><th>Un</th><th>Quantidade</th><th>Fonte</th><th>Critério</th></tr>
  <tr><td colspan="5">1. Mureta guia</td></tr>
  <tr><td>Concreto C30</td><td>m³</td><td>43,0</td><td>Revit</td><td>390,8 m de mureta</td></tr>
  <tr><td>F&ocirc;rma (face livre)</td><td>m&sup2;</td><td>430</td><td>Revit</td><td>Uma face por mureta</td></tr>
  <tr><td>Aço CA-60 Ø6,3 + CA-50 Ø10</td><td>kg</td><td>1.672</td><td>GH</td><td>+10%</td></tr>
  <tr><td colspan="5">2. Cortina</td></tr>
  <tr><td>Aço CA-50 Ø10 (N3)</td><td>kg</td><td>-</td><td>GH, a confirmar</td><td></td></tr>
</table>`;

const LAJES = `
<h3>4 Quantitativo das lajes por camada</h3>
<table>
  <tr><th>Camada</th><th>Item</th><th>Un</th><th>Por m²</th><th>Por pavimento</th><th>Total (18 pav.)</th><th>Critério</th></tr>
  <tr><td>Área</td><td>Laje steel deck</td><td>m²</td><td>1,000</td><td>1.330</td><td>23.940</td><td>Torre</td></tr>
  <tr><td>6</td><td>Concreto C30 bombeado</td><td>m³</td><td>0,090</td><td>119,2</td><td>2.145,3</td><td>0,087 m³/m²</td></tr>
  <tr><td>-</td><td>Escoramento</td><td>m²</td><td>-</td><td>-</td><td>-</td><td>Dispensado</td></tr>
</table>`;

test('html: textos e entidades', () => {
  assert.equal(textoDoHtml('F&ocirc;rma&nbsp;de <b>viga</b> m&sup2; &amp; &#176; A&Ccedil;O &aacute;'), 'Fôrma de viga m² & ° AÇO á');
});

test('html: número no formato brasileiro', () => {
  assert.equal(numeroBrasileiro('1.172,4'), 1172.4);
  assert.equal(numeroBrasileiro('0,087'), 0.087);
  assert.equal(numeroBrasileiro('1.672'), 1672, 'ponto de milhar sem decimal');
  assert.equal(numeroBrasileiro('257'), 257);
  assert.equal(numeroBrasileiro('-'), null);
  assert.equal(numeroBrasileiro(''), null);
  assert.equal(numeroBrasileiro('abc'), null);
});

test('html: tabelas com o título do bloco e sem script', () => {
  const tabelas = tabelasDoHtml(`<script>var x = "<table><tr><td>falso</td></tr></table>";</script>${CONTENCAO}${LAJES}`);
  assert.equal(tabelas.length, 2);
  assert.equal(tabelas[0].titulo, '2 Quantitativo da contenção');
  assert.deepEqual(tabelas[0].linhas[0], ['Item', 'Un', 'Quantidade', 'Fonte', 'Critério']);
});

test('html: quantitativos com grupo, unidade e número; linhas sem número ficam de fora', () => {
  const { itens, pendencias } = quantitativosDasTabelas(tabelasDoHtml(CONTENCAO));
  assert.deepEqual(itens.map((i) => [i.descricao, i.unidade, i.quantidade, i.servico]), [
    ['Concreto C30', 'm³', 43, 'concreto'],
    ['Fôrma (face livre)', 'm²', 430, 'forma'],
    ['Aço CA-60 Ø6,3 + CA-50 Ø10', 'kg', 1672, 'armacao'],
  ]);
  assert.match(itens[0].origem, /Quantitativo da contenção · 1\. Mureta guia/);
  assert.ok(pendencias.some((p) => /não é número/.test(p)) === false, 'o "-" é só vazio, não aviso');
});

test('html: coluna "Total" quando não há "Quantidade", e a descrição vem da coluna "Item"', () => {
  const { itens } = quantitativosDasTabelas(tabelasDoHtml(LAJES));
  assert.deepEqual(itens.map((i) => [i.descricao, i.quantidade]), [
    ['Laje steel deck', 23940],
    ['Concreto C30 bombeado', 2145.3],
  ]);
});

test('html: tabela sem unidade e quantidade é ignorada com aviso', () => {
  const html = '<h2>Cargas</h2><table><tr><th>Peça</th><th>Esforço</th><th>Resultado</th></tr><tr><td>Laje</td><td>46,7</td><td>6,71</td></tr></table>';
  const { itens, pendencias } = quantitativosDasTabelas(tabelasDoHtml(html));
  assert.equal(itens.length, 0);
  assert.ok(pendencias.some((p) => /Cargas/.test(p)));
});

test('html: classificação do serviço pela descrição', () => {
  assert.equal(classificarServico('Fôrma das vigas inclinadas'), 'forma');
  assert.equal(classificarServico('Concreto C30 bombeado'), 'concreto');
  assert.equal(classificarServico('Fôrma do concreto aparente'), 'forma', 'forma vem antes de concreto');
  assert.equal(classificarServico('Aço CA-50 dos pilares'), 'armacao');
  assert.equal(classificarServico('Tela soldada Q75'), 'armacao');
  assert.equal(classificarServico('Conector stud Ø19'), 'outro');
});

test('html: visualizador que monta as tabelas por script é reconhecido', () => {
  const visualizador = '<html><body><table id="tbQ"></table><script>document.getElementById("tbQ").innerHTML = "<tr><td>x</td></tr>";</script></body></html>';
  assert.equal(tabelasDoHtml(visualizador).length, 0);
  assert.equal(geraTabelasPorScript(visualizador, 0), true);
  assert.equal(geraTabelasPorScript(CONTENCAO, 1), false);
});

// ----- Rota com banco: o HTML é lido e conciliado com as composições cadastradas da empresa.
import { before, after } from 'node:test';
import { prepararAppTeste, semBanco, type ContextoTeste } from './apoio/app-teste.ts';

let ctx: ContextoTeste;
before(async () => {
  if (semBanco) return;
  ctx = await prepararAppTeste('teste_leitura_html');
});
after(async () => {
  if (ctx) await ctx.fechar();
});

const b64 = (html: string) => Buffer.from(html, 'utf8').toString('base64');

test('rota: HTML estático é lido e as composições cadastradas são sugeridas', { skip: semBanco }, async () => {
  const obra = (await ctx.pedir('dono', 'POST', '/api/eng/obras', { corpo: { nome: 'Obra do HTML' } })).corpo.obra.id as string;
  const tabela = (await ctx.banco.query(`INSERT INTO ref_tabelas (empresa_id, fonte, nome) VALUES ($1, 'proprio', 'Composições próprias') RETURNING id`, [ctx.empresas.a])).rows[0].id as string;
  const comp = async (codigo: string, descricao: string, unidade: string) =>
    (await ctx.banco.query(`INSERT INTO ref_itens (tabela_id, tipo, codigo, descricao, unidade) VALUES ($1, 'composicao', $2, $3, $4) RETURNING id`, [tabela, codigo, descricao, unidade])).rows[0].id as string;
  const forma = await comp('F1', 'Forma de madeira para fundação, e=17 mm', 'm²');
  await comp('C1', 'Concreto usinado bombeável fck 30 MPa', 'm³');

  const r = await ctx.pedir('dono', 'POST', `/api/eng/obras/${obra}/leitura-html`, { corpo: { arquivo: b64(CONTENCAO), nome: 'contencao.html' } });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(r.corpo.tabelasLidas, 1);
  const itens = r.corpo.itens as { descricao: string; quantidade: number; servico: string; candidatas: { id: string; codigo: string }[] }[];
  assert.deepEqual(itens.map((i) => [i.servico, i.quantidade]), [['concreto', 43], ['forma', 430], ['armacao', 1672]]);
  assert.equal(itens.find((i) => i.servico === 'forma')!.candidatas[0].id, forma, 'sugere a composição de forma cadastrada');
  assert.equal(itens.find((i) => i.servico === 'concreto')!.candidatas[0].codigo, 'C1');
  assert.deepEqual(itens.find((i) => i.servico === 'armacao')!.candidatas, [], 'sem composição de armação cadastrada');
});

test('rota: visualizador por script e arquivo que não é HTML', { skip: semBanco }, async () => {
  const obra = (await ctx.pedir('dono', 'POST', '/api/eng/obras', { corpo: { nome: 'Obra do script' } })).corpo.obra.id as string;
  const visualizador = '<html><body><table id="tbQ"></table><script>document.getElementById("tbQ").innerHTML = "<tr><td>x</td></tr>";</script></body></html>';
  const r = await ctx.pedir('dono', 'POST', `/api/eng/obras/${obra}/leitura-html`, { corpo: { arquivo: b64(visualizador) } });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.itens.length, 0);
  assert.match(r.corpo.pendencias[0], /monta as tabelas por script/);
  assert.equal((await ctx.pedir('dono', 'POST', `/api/eng/obras/${obra}/leitura-html`, { corpo: { arquivo: b64('{"json": true}') } })).status, 400);
  assert.equal((await ctx.pedir('dono', 'POST', `/api/eng/obras/${obra}/leitura-html`, { empresa: 'b', corpo: { arquivo: b64(CONTENCAO) } })).status, 404, 'obra de outra empresa');
});
