// P27: as cargas de demonstração (Concreteira Modelo) e da Construtora Modelo num banco vazio, e de novo por cima
// (a troca de versão apaga os dados da empresa e recria). Rode com `npm run test:banco -w apps/api`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepararAppTeste, semBanco, type ContextoTeste } from './apoio/app-teste.ts';
import { garantirConteudoDemo, garantirDemo } from '../src/sementes.ts';
import { CNPJ_CONSTRUTORA, garantirConstrutoraModelo } from '../src/lib/construtora-modelo.ts';
import { CNPJ_DEMO } from '../src/lib/demo.ts';

let ctx: ContextoTeste;
before(async () => {
  if (!semBanco) ctx = await prepararAppTeste('teste_cargas');
});
after(async () => {
  if (ctx) await ctx.fechar();
});

const SENHA = 'Carga#Teste2026';

async function contar(cnpj: string, tabela: string) {
  const r = await ctx.banco.query(`SELECT count(*)::int AS n FROM ${tabela} t JOIN empresas e ON e.id = t.empresa_id WHERE e.cnpj = $1`, [cnpj]);
  return r.rows[0].n as number;
}


for (const rodada of ['banco vazio', 'recarga por troca de versão']) {
  test(`P27: Concreteira Modelo (${rodada})`, { skip: semBanco }, async () => {
    if (rodada !== 'banco vazio') await ctx.banco.query("DELETE FROM marcas_sistema WHERE chave = 'demo_versao'");
    const log: string[] = [];
    await garantirDemo(ctx.banco, SENHA, (m) => log.push(m));
    await garantirConteudoDemo(ctx.banco, (m) => log.push(m));
    assert.ok(log.some((m) => m.startsWith('Demonstração recriada')), log.join('\n'));
    const cnpj = CNPJ_DEMO;
    assert.ok((await contar(cnpj, 'lancamentos')) > 0);
  });

  test(`P27: Construtora Modelo (${rodada})`, { skip: semBanco }, async () => {
    if (rodada !== 'banco vazio') await ctx.banco.query("DELETE FROM marcas_sistema WHERE chave = 'construtora_modelo_versao'");
    const log: string[] = [];
    await garantirConstrutoraModelo(ctx.banco, SENHA, (m) => log.push(m));
    assert.ok(log.some((m) => m.startsWith('Obra modelo da Construtora Modelo criada')), log.join('\n'));
    const cnpj = CNPJ_CONSTRUTORA;
    assert.ok((await contar(cnpj, 'obras')) > 0, 'a Construtora Modelo abre com obras');
  });
}
