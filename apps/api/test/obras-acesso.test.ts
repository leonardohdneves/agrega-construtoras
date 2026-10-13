// Engenheiro de obra: regras de endereço (sem banco) e obras, contratos e medições limitados às obras atribuídas
// (com banco: defina TEST_DATABASE_URL; usa o esquema "teste_acesso", apagado e recriado).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { centrosPermitidos, obrasPermitidas, regraEngenheiroEngenharia } from '../src/lib/obras-acesso.ts';

test('engenheiro de obra: o que pode em cada endereço da Engenharia', () => {
  const r = regraEngenheiroEngenharia;
  assert.deepEqual(r('GET', '/obras'), { tipo: 'lista' });
  assert.deepEqual(r('GET', '/panorama'), { tipo: 'lista' });
  assert.deepEqual(r('POST', '/obras'), { tipo: 'negado' });
  assert.deepEqual(r('GET', '/obras/abc'), { tipo: 'obra', obraId: 'abc' });
  // o cadastro da obra (nome, BDI, responsáveis) é do dono e do gestor
  assert.deepEqual(r('PUT', '/obras/abc'), { tipo: 'negado' });
  assert.deepEqual(r('DELETE', '/obras/abc'), { tipo: 'negado' });
  // dentro da obra: planilha, planejamento, necessidades
  assert.deepEqual(r('PUT', '/obras/abc/planejamento/9'), { tipo: 'obra', obraId: 'abc' });
  assert.deepEqual(r('POST', '/obras/abc/necessidades'), { tipo: 'obra', obraId: 'abc' });
  assert.deepEqual(r('GET', '/obras/abc/relatorio-orcamento'), { tipo: 'obra', obraId: 'abc' });
  // tabelas de referência: só consulta
  assert.deepEqual(r('GET', '/tabelas'), { tipo: 'consulta' });
  assert.deepEqual(r('GET', '/tabelas/t1/itens'), { tipo: 'consulta' });
  assert.deepEqual(r('POST', '/tabelas/t1/importar'), { tipo: 'negado' });
  assert.deepEqual(r('POST', '/tabelas/mapear-ia'), { tipo: 'negado' });
  assert.deepEqual(r('GET', '/engenheiros'), { tipo: 'negado' });
});

const URL = process.env.TEST_DATABASE_URL;
const pular = !URL && 'defina TEST_DATABASE_URL para rodar os testes com banco';
const PASTA = path.resolve(import.meta.dirname, '..', 'migrations');
let banco: pg.Pool;
const ids: Record<string, string> = {};
const um = async (sql: string, p: unknown[] = []) => (await banco.query(sql, p)).rows[0].id as string;

before(async () => {
  if (!URL) return;
  banco = new pg.Pool({ connectionString: URL, max: 2, options: '-c search_path=teste_acesso' });
  await banco.query('DROP SCHEMA IF EXISTS teste_acesso CASCADE; CREATE SCHEMA teste_acesso');
  for (const arquivo of (await readdir(PASTA)).filter((a) => a.endsWith('.sql')).sort()) await banco.query(await readFile(path.join(PASTA, arquivo), 'utf8'));

  ids.empresa = await um(`INSERT INTO empresas (razao_social, cnpj) VALUES ('Construtora Teste', '11222333000181') RETURNING id`);
  ids.outraEmpresa = await um(`INSERT INTO empresas (razao_social, cnpj) VALUES ('Outra Construtora', '11444777000161') RETURNING id`);
  const usuario = (empresa: string, nome: string, perfil: string) =>
    um(`INSERT INTO usuarios (empresa_id, nome, email, senha_hash, perfil) VALUES ($1, $2, $3, 'x', $4) RETURNING id`, [empresa, nome, `${nome.toLowerCase()}@t.test`, perfil]);
  ids.eng1 = await usuario(ids.empresa, 'Ana', 'engenheiro_obra');
  ids.eng2 = await usuario(ids.empresa, 'Bruno', 'engenheiro_obra');
  ids.orc = await usuario(ids.empresa, 'Carla', 'orcamentista');
  ids.comp = await usuario(ids.empresa, 'Davi', 'comprador');
  ids.engOutra = await usuario(ids.outraEmpresa, 'Eva', 'engenheiro_obra');

  const centro = (empresa: string, nome: string) => um(`INSERT INTO centros_custo (empresa_id, nome) VALUES ($1, $2) RETURNING id`, [empresa, nome]);
  ids.ccA = await centro(ids.empresa, 'Obra A');
  ids.ccB = await centro(ids.empresa, 'Obra B');
  ids.ccOutra = await centro(ids.outraEmpresa, 'Obra X');
  const obra = (empresa: string, codigo: string, cc: string) =>
    um(`INSERT INTO obras (empresa_id, codigo, nome, nivel_apropriacao, centro_custo_id) VALUES ($1, $2, $2, 'etapa', $3) RETURNING id`, [empresa, codigo, cc]);
  ids.obraA = await obra(ids.empresa, 'OB-A', ids.ccA);
  ids.obraB = await obra(ids.empresa, 'OB-B', ids.ccB);
  ids.obraX = await obra(ids.outraEmpresa, 'OB-X', ids.ccOutra);
  await banco.query('INSERT INTO obra_responsaveis (obra_id, usuario_id) VALUES ($1, $2), ($3, $4)', [ids.obraA, ids.eng1, ids.obraX, ids.engOutra]);

  ids.fornecedor = await um(`INSERT INTO fornecedores (empresa_id, razao_social) VALUES ($1, 'Empreiteira') RETURNING id`, [ids.empresa]);
  ids.conta = await um(`INSERT INTO plano_contas (empresa_id, codigo, nome, tipo, linha_dre) VALUES ($1, '3.1', 'Serviços de terceiros', 'despesa', 'custo_producao') RETURNING id`, [ids.empresa]);
  const contrato = (numero: number, cc: string) =>
    um(
      `INSERT INTO contratos (empresa_id, numero, fornecedor_id, objeto, inicio, plano_conta_id, centro_custo_id) VALUES ($1, $2, $3, 'Mão de obra', '2026-10-01', $4, $5) RETURNING id`,
      [ids.empresa, numero, ids.fornecedor, ids.conta, cc],
    );
  ids.contratoA = await contrato(1, ids.ccA);
  ids.contratoB = await contrato(2, ids.ccB);
});

after(async () => {
  if (!URL) return;
  await banco.query('DROP SCHEMA IF EXISTS teste_acesso CASCADE');
  await banco.end();
});

test('migração 0038: perfis novos e responsáveis por obra', { skip: pular }, async () => {
  const perfis = (await banco.query(`SELECT perfil::text AS p FROM usuarios WHERE empresa_id = $1 ORDER BY nome`, [ids.empresa])).rows.map((r) => r.p);
  assert.deepEqual(perfis, ['engenheiro_obra', 'engenheiro_obra', 'orcamentista', 'comprador']);
  // a mesma pessoa não é atribuída duas vezes à mesma obra
  let erro = '';
  await banco.query('INSERT INTO obra_responsaveis (obra_id, usuario_id) VALUES ($1, $2)', [ids.obraA, ids.eng1]).catch((e: Error) => (erro = e.message));
  await new Promise((r) => setTimeout(r, 60));
  await banco.query('SELECT 1').catch((e: Error) => (erro ||= e.message));
  assert.match(erro, /duplicate|duplicad|obra_responsaveis_pkey/i);
});

test('engenheiro de obra vê só as obras atribuídas a ele, na empresa dele', { skip: pular }, async () => {
  assert.deepEqual(await obrasPermitidas(banco as any, ids.empresa, { id: ids.eng1, perfil: 'engenheiro_obra' }), [ids.obraA]);
  assert.deepEqual(await obrasPermitidas(banco as any, ids.empresa, { id: ids.eng2, perfil: 'engenheiro_obra' }), []);
  // atribuição em outra empresa não vale aqui
  assert.deepEqual(await obrasPermitidas(banco as any, ids.empresa, { id: ids.engOutra, perfil: 'engenheiro_obra' }), []);
  // demais perfis: sem filtro
  assert.equal(await obrasPermitidas(banco as any, ids.empresa, { id: ids.orc, perfil: 'orcamentista' }), null);
  assert.equal(await obrasPermitidas(banco as any, ids.empresa, { id: ids.comp, perfil: 'comprador' }), null);

  // o mesmo filtro da lista de obras (GET /api/eng/obras)
  const lista = async (engenheiro: string | null) =>
    (
      await banco.query(
        `SELECT o.codigo FROM obras o WHERE o.empresa_id = $1 AND o.ativo
           AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM obra_responsaveis r WHERE r.obra_id = o.id AND r.usuario_id = $2)) ORDER BY o.codigo`,
        [ids.empresa, engenheiro],
      )
    ).rows.map((r) => r.codigo);
  assert.deepEqual(await lista(ids.eng1), ['OB-A']);
  assert.deepEqual(await lista(ids.eng2), []);
  assert.deepEqual(await lista(null), ['OB-A', 'OB-B']);
});

test('contratos do engenheiro de obra: só os do centro de custo das obras dele', { skip: pular }, async () => {
  const centros = await centrosPermitidos(banco as any, ids.empresa, { id: ids.eng1, perfil: 'engenheiro_obra' });
  assert.deepEqual(centros, [ids.ccA]);
  assert.equal(await centrosPermitidos(banco as any, ids.empresa, { id: ids.orc, perfil: 'orcamentista' }), null);
  // o mesmo filtro da lista de contratos (GET /api/sup/contratos)
  const lista = async (cs: string[] | null) =>
    (await banco.query(`SELECT numero FROM contratos WHERE empresa_id = $1 AND ($2::uuid[] IS NULL OR centro_custo_id = ANY($2::uuid[])) ORDER BY numero`, [ids.empresa, cs])).rows.map((r) =>
      Number(r.numero),
    );
  assert.deepEqual(await lista(centros), [1]);
  assert.deepEqual(await lista([]), []);
  assert.deepEqual(await lista(null), [1, 2]);
});
