// Leitura de composições por IA: arquivos (XLSX, HTML, CSV, PDF) viram o bloco certo, a resposta da IA é conferida e,
// com banco, o lançamento em lote cria insumos e serviços (com serviço dentro de serviço) e recusa ciclo.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { blocoDoArquivo, lerComposicoesIa, tipoDoArquivo } from '../src/lib/composicoes-leitura.ts';
import { lerZip, xlsxParaTexto } from '../src/lib/xlsx-leitura.ts';
import { prepararAppTeste, semBanco, type ContextoTeste } from './apoio/app-teste.ts';

/** Monta um zip (com deflate) para o teste: um .xlsx mínimo é um zip de XML. */
function zip(arquivos: Record<string, string>): Buffer {
  const partes: Buffer[] = [];
  const centrais: Buffer[] = [];
  let off = 0;
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    const nomeB = Buffer.from(nome);
    const dados = deflateRawSync(Buffer.from(conteudo));
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(dados.length, 18);
    local.writeUInt32LE(Buffer.byteLength(conteudo), 22);
    local.writeUInt16LE(nomeB.length, 26);
    partes.push(local, nomeB, dados);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(dados.length, 20);
    cen.writeUInt32LE(Buffer.byteLength(conteudo), 24);
    cen.writeUInt16LE(nomeB.length, 28);
    cen.writeUInt32LE(off, 42);
    centrais.push(cen, nomeB);
    off += 30 + nomeB.length + dados.length;
  }
  const cdir = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(Object.keys(arquivos).length, 8);
  fim.writeUInt16LE(Object.keys(arquivos).length, 10);
  fim.writeUInt32LE(cdir.length, 12);
  fim.writeUInt32LE(off, 16);
  return Buffer.concat([...partes, cdir, fim]);
}

const XLSX_TESTE = zip({
  'xl/sharedStrings.xml': '<sst><si><t>Código</t></si><si><t>Descrição &amp; cia</t></si></sst>',
  'xl/worksheets/sheet1.xml':
    '<worksheet><sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1"><v>2.5</v></c></row>' +
    '<row r="2"><c r="B2" t="inlineStr"><is><t>Brita 1</t></is></c></row>' +
    '</sheetData></worksheet>',
});

test('xlsx: lê as células das abas (texto compartilhado, inline e número)', () => {
  assert.deepEqual(Object.keys(Object.fromEntries(lerZip(XLSX_TESTE))).sort(), ['xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml']);
  const texto = xlsxParaTexto(XLSX_TESTE);
  assert.match(texto, /## Aba sheet1/);
  assert.match(texto, /Código \| Descrição & cia \| 2\.5/);
  assert.match(texto, /\| Brita 1/);
});

test('arquivo: PDF e foto vão como documento ou imagem; planilha, HTML e CSV vão como texto', () => {
  assert.equal(blocoDoArquivo('projeto.pdf', Buffer.from('%PDF-1.4')).type, 'document');
  assert.equal(blocoDoArquivo('foto.jpg', Buffer.from([0xff, 0xd8])).type, 'image');
  assert.equal(blocoDoArquivo('tabela.xlsx', XLSX_TESTE).type, 'text');
  assert.equal(blocoDoArquivo('lista.csv', Buffer.from('a;b\n1;2')).type, 'text');
  const html = blocoDoArquivo('composicoes.html', Buffer.from('<table><tr><th>Item</th><th>Un</th></tr><tr><td>Brita</td><td>m3</td></tr></table>'));
  assert.match((html as { text: string }).text, /Item \| Un/);
  assert.match((html as { text: string }).text, /Brita \| m3/);
  assert.throws(() => blocoDoArquivo('dados.docx', Buffer.from('x')), /Formato não aceito/);
});

test("resposta da IA: o tipo vem da marca do arquivo (C é composição, I é insumo) e a quantidade vira coeficiente", () => {
  const r = lerComposicoesIa({
    servicos: [
      {
        codigo: "100764", descricao: "VIGA METÁLICA", unidade: "KG",
        linhas: [
          { tipo_no_arquivo: "C", codigo: "88278", descricao: "MONTADOR", unidade: "H", quantidade: 0.0123 },
          { tipo_no_arquivo: "I", codigo: "43082", descricao: "PERFIL I", unidade: "KG", quantidade: "1,05" },
          { tipo_no_arquivo: "?", descricao: "Estranho", unidade: "UN", quantidade: 2 },
          { tipo_no_arquivo: "I", descricao: "Sem número", unidade: "UN", quantidade: "x" },
        ],
      },
    ],
    avulsos: [{ tipo_no_arquivo: "Insumo", codigo: "4777", descricao: "CANTONEIRA", unidade: "KG" }],
    pendencias: ["Tabela cortada."],
  });
  const principal = r.itens[0];
  assert.deepEqual([principal.tipo, principal.codigo, principal.componentes.length], ["composicao", "100764", 3]);
  assert.deepEqual(principal.componentes.map((k) => [k.tipo, k.codigo, k.coeficiente]), [["composicao", "88278", 0.0123], ["insumo", "43082", 1.05], ["insumo", "", 2]]);
  const tipos = Object.fromEntries(r.itens.map((x) => [x.descricao, x.tipo]));
  assert.deepEqual(tipos, { "VIGA METÁLICA": "composicao", MONTADOR: "composicao", "PERFIL I": "insumo", Estranho: "insumo", CANTONEIRA: "insumo" });
  assert.ok(r.pendencias.some((p) => /Estranho/.test(p)), "tipo desconhecido é avisado");
  assert.ok(r.pendencias.some((p) => /Sem número/.test(p)), "linha sem quantidade é avisada");
  assert.ok(r.pendencias.includes("Tabela cortada."));
});

test("marca de tipo do arquivo", () => {
  assert.equal(tipoDoArquivo("C"), "composicao");
  assert.equal(tipoDoArquivo("Composição"), "composicao");
  assert.equal(tipoDoArquivo("I"), "insumo");
  assert.equal(tipoDoArquivo("Mão de obra"), "insumo");
  assert.equal(tipoDoArquivo("Equipamento"), "insumo");
  assert.equal(tipoDoArquivo("X"), null);
});

// ----- Com banco: lançamento em lote, reaproveitamento, ciclo e importação com serviço dentro de serviço.
let ctx: ContextoTeste;
before(async () => {
  if (semBanco) return;
  ctx = await prepararAppTeste('teste_composicoes_leitura');
});
after(async () => {
  if (ctx) await ctx.fechar();
});

async function tabelaPropria(nome: string): Promise<string> {
  const r = await ctx.pedir('dono', 'POST', '/api/eng/tabelas', { corpo: { fonte: 'proprio', nome, uf: null, mesReferencia: null, desonerado: false, csv: null } });
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  return r.corpo.tabela.id as string;
}

test('lote: cria insumos e serviços, com serviço dentro de serviço, e cria o insumo que falta', { skip: semBanco }, async () => {
  const tabela = await tabelaPropria('Composições lidas');
  const r = await ctx.pedir('dono', 'POST', `/api/eng/tabelas/${tabela}/itens/lote`, {
    corpo: {
      itens: [
        { tipo: 'insumo', descricao: 'Cimento CP II 50kg', unidade: 'kg' },
        { tipo: 'insumo', descricao: 'Areia média', unidade: 'm3' },
        { tipo: 'composicao', descricao: 'Argamassa traço 1:3', unidade: 'm3', componentes: [
          { descricao: 'Cimento CP II 50kg', coeficiente: 0.3 },
          { descricao: 'Areia média', coeficiente: 1.2 },
        ] },
        { tipo: 'composicao', descricao: 'Emboço interno', unidade: 'm2', componentes: [
          { tipo: 'composicao', descricao: 'Argamassa traço 1:3', coeficiente: 0.02 },
          { tipo: 'insumo', descricao: 'Pedreiro', unidade: 'h', coeficiente: 0.5 },
        ] },
      ],
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(r.corpo.criados, 5, 'cimento, areia, argamassa, emboço e pedreiro');
  assert.equal(r.corpo.composicoes, 2);
  const emboco = r.corpo.itens.find((x: { descricao: string }) => x.descricao === 'Emboço interno');
  assert.ok(emboco, 'o lote devolve os itens de topo');
  const lista = await ctx.pedir('dono', 'GET', `/api/eng/tabelas/${tabela}/itens?tipo=composicao`);
  assert.equal(lista.corpo.itens.find((x: { id: string }) => x.id === emboco.id).componentes, 2);

  // Lançar de novo o que já existe não duplica: tudo é reaproveitado.
  const de_novo = await ctx.pedir('dono', 'POST', `/api/eng/tabelas/${tabela}/itens/lote`, { corpo: { itens: [{ tipo: 'insumo', descricao: 'Cimento CP II 50kg', unidade: 'kg' }] } });
  assert.equal(de_novo.corpo.criados, 0);
});

test('lote: recusa serviço que se usa a si mesmo (ciclo)', { skip: semBanco }, async () => {
  const tabela = await tabelaPropria('Ciclo');
  const r = await ctx.pedir('dono', 'POST', `/api/eng/tabelas/${tabela}/itens/lote`, {
    corpo: {
      itens: [
        { tipo: 'composicao', descricao: 'Serviço A', unidade: 'm2', componentes: [{ tipo: 'composicao', descricao: 'Serviço B', coeficiente: 1 }] },
        { tipo: 'composicao', descricao: 'Serviço B', unidade: 'm2', componentes: [{ tipo: 'composicao', descricao: 'Serviço A', coeficiente: 1 }] },
      ],
    },
  });
  assert.equal(r.status, 400, JSON.stringify(r.corpo));
  assert.match(r.corpo.erro, /ciclo/);
});

test('obra: importar um serviço traz os serviços usados dentro dele', { skip: semBanco }, async () => {
  const tabela = await tabelaPropria('Para obra');
  const lote = await ctx.pedir('dono', 'POST', `/api/eng/tabelas/${tabela}/itens/lote`, {
    corpo: {
      itens: [
        { tipo: 'insumo', descricao: 'Cal hidratada', unidade: 'kg' },
        { tipo: 'composicao', descricao: 'Argamassa de cal', unidade: 'm3', componentes: [{ descricao: 'Cal hidratada', coeficiente: 2 }] },
        { tipo: 'composicao', descricao: 'Reboco externo', unidade: 'm2', componentes: [{ tipo: 'composicao', descricao: 'Argamassa de cal', coeficiente: 0.03 }] },
      ],
    },
  });
  const reboco = lote.corpo.itens.find((x: { descricao: string }) => x.descricao === 'Reboco externo');
  const obra = (await ctx.pedir('dono', 'POST', '/api/eng/obras', { corpo: { nome: 'Obra do reboco' } })).corpo.obra.id as string;
  const imp = await ctx.pedir('dono', 'POST', `/api/eng/obras/${obra}/importar`, { corpo: { tabelaId: tabela, composicaoIds: [reboco.id] } });
  assert.equal(imp.status, 200, JSON.stringify(imp.corpo));
  const itens = (await ctx.pedir('dono', 'GET', `/api/eng/obras/${obra}/itens`)).corpo.itens as { tipo: string; descricao: string }[];
  assert.ok(itens.some((x) => x.tipo === 'composicao' && x.descricao === 'Argamassa de cal'), 'o serviço aninhado entrou na obra');
});

test('tabela própria: um serviço novo pode usar outro serviço como componente', { skip: semBanco }, async () => {
  const tabela = await tabelaPropria('Componente serviço');
  await ctx.pedir('dono', 'POST', `/api/eng/tabelas/${tabela}/itens/lote`, {
    corpo: { itens: [{ tipo: 'composicao', codigo: 'SRV-1', descricao: 'Chapisco', unidade: 'm2', componentes: [] }] },
  });
  const r = await ctx.pedir('dono', 'POST', `/api/eng/tabelas/${tabela}/itens`, {
    corpo: { tipo: 'composicao', descricao: 'Reboco de fachada', unidade: 'm2', componentes: [{ tipo: 'composicao', insumoCodigo: 'SRV-1', coeficiente: 1 }] },
  });
  assert.equal(r.status, 201, JSON.stringify(r.corpo));
  const inexistente = await ctx.pedir('dono', 'POST', `/api/eng/tabelas/${tabela}/itens`, {
    corpo: { tipo: 'composicao', descricao: 'Outro', unidade: 'm2', componentes: [{ tipo: 'composicao', insumoCodigo: 'NAO-EXISTE', coeficiente: 1 }] },
  });
  assert.equal(inexistente.status, 400);
});

test("lote: arquivo com nome muito longo (como os do SINAPI) não é recusado pelo tamanho do nome", { skip: semBanco }, async () => {
  const tabela = await tabelaPropria("Nome longo");
  const nome = "SINAPI 100764_ " + "VIGA METÁLICA ".repeat(30) + ".pdf";
  const r = await ctx.pedir("dono", "POST", `/api/eng/tabelas/${tabela}/composicoes-leitura`, { corpo: { arquivo: Buffer.from("%PDF-1.4").toString("base64"), nome } });
  assert.notEqual(r.status, 400, JSON.stringify(r.corpo));
});
