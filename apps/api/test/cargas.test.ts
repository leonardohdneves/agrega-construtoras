// P27: as cargas de demonstração (Concreteira Modelo) e da Construtora Modelo num banco vazio, e de novo por cima
// (a troca de versão apaga os dados da empresa e recria). Rode com `npm run test:banco -w apps/api`.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prepararAppTeste, semBanco, type ContextoTeste } from './apoio/app-teste.ts';
import { garantirAdmin, garantirConteudoDemo, garantirDemo } from '../src/sementes.ts';
import { conferirSenha, gerarHashSenha } from '../src/lib/senha.ts';
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

test('P21: a senha do administrador trocada pela tela sobrevive a um reinício', { skip: semBanco }, async () => {
  const email = 'admin-p21@sistema.teste';
  await garantirAdmin(ctx.banco, email, 'SenhaDoAmbiente#1', () => {});
  const novaHash = await gerarHashSenha('SenhaDaTela#2');
  await ctx.banco.query('UPDATE usuarios SET senha_hash = $2 WHERE lower(email) = $1', [email, novaHash]);
  await garantirAdmin(ctx.banco, email, 'SenhaDoAmbiente#1', () => {}); // "reinício" sem ADMIN_REDEFINIR
  const hash = (await ctx.banco.query('SELECT senha_hash FROM usuarios WHERE lower(email) = $1', [email])).rows[0].senha_hash;
  assert.ok(await conferirSenha('SenhaDaTela#2', hash), 'a senha da tela continua valendo');
  await garantirAdmin(ctx.banco, email, 'SenhaDoAmbiente#1', () => {}, true); // com ADMIN_REDEFINIR=1
  const hash2 = (await ctx.banco.query('SELECT senha_hash FROM usuarios WHERE lower(email) = $1', [email])).rows[0].senha_hash;
  assert.ok(await conferirSenha('SenhaDoAmbiente#1', hash2), 'ADMIN_REDEFINIR=1 redefine');
});

test('P21: ADMIN_EMAIL de um usuário de empresa não o transforma em administrador', { skip: semBanco }, async () => {
  const empresa = (await ctx.banco.query("SELECT id FROM empresas LIMIT 1")).rows[0].id;
  await ctx.banco.query("INSERT INTO usuarios (empresa_id, nome, email, senha_hash, perfil) VALUES ($1, 'Gestora', 'gestora-p21@empresa.teste', 'x', 'gestor')", [empresa]);
  const log: string[] = [];
  await garantirAdmin(ctx.banco, 'gestora-p21@empresa.teste', 'Qualquer#1', (m) => log.push(m), true);
  const u = (await ctx.banco.query("SELECT perfil, empresa_id FROM usuarios WHERE email = 'gestora-p21@empresa.teste'")).rows[0];
  assert.equal(u.perfil, 'gestor');
  assert.equal(u.empresa_id, empresa);
  assert.ok(log.some((m) => m.includes('usuário de empresa')));
});
