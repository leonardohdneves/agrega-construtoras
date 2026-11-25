// Conversão da planilha oficial do SINAPI para o CSV padrão: preço da UF (com reserva em SP), composições auxiliares
// desdobradas em insumos, estrutura preservada e conferência com o custo oficial. Com SINAPI_CSV e banco, carrega o CSV inteiro.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { converterSinapiOficial, unidadeSinapi } from '../src/lib/sinapi-oficial.ts';
import { lerCsvReferencia } from '../src/lib/engenharia.ts';
import type { AbaXlsx } from '../src/lib/xlsx-leitura.ts';
import { prepararAppTeste, semBanco, type ContextoTeste } from './apoio/app-teste.ts';

const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

function planilha(): AbaXlsx[] {
  const colInsumo = (uf: string) => 5 + UFS.indexOf(uf);
  const linhaInsumo = (classe: string, cod: string, desc: string, un: string, precos: Record<string, string>) => {
    const l = [classe, cod, desc, un, 'C', ...UFS.map(() => '')];
    for (const [uf, p] of Object.entries(precos)) l[colInsumo(uf)] = p;
    return l;
  };
  const icd: AbaXlsx = {
    nome: 'ICD',
    linhas: [
      ['SINAPI'],
      ['Classificação', 'Código do Insumo', 'Descrição do Insumo', 'Unidade', 'Origem de Preço', ...UFS],
      linhaInsumo('MATERIAL', '1', 'CIMENTO PORTLAND', 'KG', { TO: '2.00', SP: '1.50' }),
      linhaInsumo('MATERIAL', '2', 'AREIA MEDIA', 'M3', { SP: '50.00' }),
      linhaInsumo('MATERIAL', '3', 'ITEM SEM COLETA', 'UN', {}),
    ],
  };
  const analitico: AbaXlsx = {
    nome: 'Analítico',
    linhas: [
      ['SINAPI'],
      ['Grupo', 'Código da Composição', 'Tipo Item', 'Código do Item', 'Descrição', 'Unidade', 'Coeficiente', 'Situação'],
      ['Argamassas', '100', '', '', 'ARGAMASSA TRAÇO 1:3', 'M3', '', 'COM CUSTO'],
      ['Argamassas', '100', 'INSUMO', '1', 'CIMENTO PORTLAND', 'KG', '300', 'COM PREÇO'],
      ['Argamassas', '100', 'INSUMO', '2', 'AREIA MEDIA', 'M3', '1.1', 'COM PREÇO'],
      ['Revestimentos', '200', '', '', 'EMBOÇO INTERNO', 'M2', '', 'COM CUSTO'],
      ['Revestimentos', '200', 'COMPOSICAO', '100', 'ARGAMASSA TRAÇO 1:3', 'M3', '0.02', 'COM CUSTO'],
      ['Revestimentos', '200', 'INSUMO', '1', 'CIMENTO PORTLAND', 'KG', '1', 'COM PREÇO'],
      ['Revestimentos', '300', '', '', 'SERVIÇO COM ITEM SEM PREÇO', 'UN', '', 'SEM CUSTO'],
      ['Revestimentos', '300', 'INSUMO', '3', 'ITEM SEM COLETA', 'UN', '2', 'SEM PREÇO'],
    ],
  };
  const ufLinha = ['', '', '', '', ...UFS.flatMap((u) => [u, ''])];
  const colTo = ufLinha.indexOf('TO');
  const custo = (grupo: string, desc: string, un: string, valor: string) => {
    const l = [grupo, '0', desc, un, ...UFS.flatMap(() => ['', ''])];
    l[colTo] = valor;
    return l;
  };
  const ccd: AbaXlsx = {
    nome: 'CCD',
    linhas: [['SINAPI'], ufLinha, ['Grupo', 'Código da Composição', 'Descrição', 'Unidade', ...UFS.flatMap(() => ['Custo (R$)', '%AS'])], custo('Argamassas', 'ARGAMASSA TRAÇO 1:3', 'M3', '655'), custo('Revestimentos', 'EMBOÇO INTERNO', 'M2', '15.1'), custo('Revestimentos', 'SERVIÇO COM ITEM SEM PREÇO', 'UN', '-')],
  };
  return [icd, analitico, ccd];
}

test('sinapi oficial: unidades de área e volume ficam com expoente', () => {
  assert.equal(unidadeSinapi('M2'), 'm²');
  assert.equal(unidadeSinapi('M3'), 'm³');
  assert.equal(unidadeSinapi('KG'), 'KG');
});

test('sinapi oficial: preço da UF, reserva em SP, auxiliar desdobrada e estrutura preservada', () => {
  const { csv, resumo } = converterSinapiOficial(planilha(), { uf: 'TO', desonerado: true });
  assert.equal(resumo.insumos, 3);
  assert.equal(resumo.insumosPrecoReserva, 1, 'a areia sem coleta em TO usa o preço de SP');
  assert.equal(resumo.insumosSemPreco, 1);
  assert.equal(resumo.composicoes, 3);
  assert.equal(resumo.composicoesSemCusto, 1);
  assert.equal(resumo.conferidas, 2, 'argamassa e emboço batem com o custo oficial');
  assert.equal(resumo.divergentesTotal, 0);
  assert.equal(resumo.semCustoOficial, 1);
  const l = lerCsvReferencia(csv);
  assert.deepEqual(l.erros, []);
  assert.equal(l.insumos.find((i) => i.codigo === '1')!.precoCentavos, 200);
  assert.equal(l.insumos.find((i) => i.codigo === '2')!.precoCentavos, 5000);
  assert.equal(l.composicoes.find((c) => c.codigo === '200')!.unidade, 'm²');
  // Emboço: 0,02 × argamassa (300 de cimento, 1,1 de areia) + 1 de cimento.
  const emboco = l.componentes.filter((k) => k.composicao === '200');
  assert.equal(emboco.find((k) => k.insumo === '1')!.coeficiente, 7);
  assert.equal(emboco.find((k) => k.insumo === '2')!.coeficiente, 0.022);
  assert.deepEqual(
    l.estrutura.filter((e) => e.composicao === '200').map((e) => `${e.tipoItem}:${e.item}:${e.coeficiente}`).sort(),
    ['composicao:100:0.02', 'insumo:1:1'],
  );
});

test('sinapi oficial: sem desoneração exige a aba ISD', () => {
  assert.throws(() => converterSinapiOficial(planilha(), { uf: 'TO', desonerado: false }), /aba ISD/);
});

// ----- Com banco e o CSV real (opcional): SINAPI_CSV=caminho do CSV gerado por scripts/sinapi-para-csv.ts
let ctx: ContextoTeste;
const CSV_REAL = process.env.SINAPI_CSV ?? '';
before(async () => {
  if (semBanco || !CSV_REAL) return;
  ctx = await prepararAppTeste('teste_sinapi_oficial');
});
after(async () => {
  if (ctx) await ctx.fechar();
});

test('sinapi oficial: o CSV inteiro entra como tabela de referência', { skip: semBanco || (!CSV_REAL && 'defina SINAPI_CSV com o CSV gerado') }, async () => {
  const csv = fs.readFileSync(CSV_REAL, 'utf8');
  const t0 = Date.now();
  const r = await ctx.pedir('dono', 'POST', '/api/eng/tabelas', { corpo: { fonte: 'sinapi', nome: 'SINAPI 09/2026 TO', uf: 'TO', mesReferencia: '2026-09', desonerado: true, csv } });
  assert.equal(r.status, 201, JSON.stringify(r.corpo).slice(0, 500));
  console.log(`importação: ${(Date.now() - t0) / 1000}s`, JSON.stringify({ insumos: r.corpo.tabela.insumos, composicoes: r.corpo.tabela.composicoes }));
  assert.ok(r.corpo.tabela.composicoes > 10000);
});
