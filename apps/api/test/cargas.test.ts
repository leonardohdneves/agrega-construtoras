// P27: as cargas de demonstração (Concreteira Modelo) e da Construtora Modelo num banco vazio, e de novo por cima
// (a troca de versão apaga os dados da empresa e recria). Rode com `npm run test:banco -w apps/api`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepararAppTeste, semBanco, type ContextoTeste } from './apoio/app-teste.ts';
import { garantirConteudoDemo, garantirDemo } from '../src/sementes.ts';
import { CNPJ_CONSTRUTORA, EMAIL_PROFESSOR, garantirConstrutoraModelo } from '../src/lib/construtora-modelo.ts';
import { criarTokenSessao } from '../src/sessao.ts';
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

test('P28: na obra da Construtora Modelo, o total da curva S (em reais) bate com o orçamento sem BDI', { skip: semBanco }, async () => {
  const prof = (await ctx.banco.query('SELECT id, empresa_id FROM usuarios WHERE lower(email) = lower($1)', [EMAIL_PROFESSOR])).rows[0];
  const token = criarTokenSessao({ id: prof.id, empresaId: prof.empresa_id, perfil: 'dono' });
  const get = async (url: string) => (await ctx.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } })).json();
  const obra = (await ctx.banco.query("SELECT id FROM obras WHERE empresa_id = $1 AND codigo = 'OBR-001'", [prof.empresa_id])).rows[0].id;
  const orcamento = await get(`/api/eng/obras/${obra}/orcamento`);
  const curva = await get(`/api/eng/obras/${obra}/relatorios-gerenciais/curva-s`);
  const prevReal = await get(`/api/eng/obras/${obra}/relatorios-gerenciais/previsto-realizado`);
  assert.ok(orcamento.subtotal > 0);
  // A planilha arredonda o preço unitário a centavos antes de multiplicar; o acompanhamento usa o preço exato.
  // Com 52 mil blocos isso dá uns R$ 25. O que importa aqui é a escala: reais, não centavos (100 vezes mais).
  assert.ok(Math.abs(curva.custoTotal / orcamento.subtotal - 1) < 0.001, `curva ${curva.custoTotal} × orçamento ${orcamento.subtotal}`);
  assert.ok(Math.abs(prevReal.totais.custoPrevisto / orcamento.subtotal - 1) < 0.001, `previsto ${prevReal.totais.custoPrevisto} × orçamento ${orcamento.subtotal}`);
});
