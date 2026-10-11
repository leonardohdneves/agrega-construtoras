// Orçamento só com serviços da obra, garantido no banco (gatilho da migração 0030).
// Roda contra um Postgres de teste: defina TEST_DATABASE_URL (o banco é apagado e recriado no esquema "teste_orc").
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { aplicarMigracoes } from '../src/migrar.ts';

const URL = process.env.TEST_DATABASE_URL;
const pular = !URL && 'defina TEST_DATABASE_URL para rodar os testes com banco';
let banco: pg.Pool;
const ids: Record<string, string> = {};

before(async () => {
  if (!URL) return;
  banco = new pg.Pool({ connectionString: URL, max: 2, options: '-c search_path=teste_orc' });
  await banco.query('DROP SCHEMA IF EXISTS teste_orc CASCADE; CREATE SCHEMA teste_orc');
  await aplicarMigracoes(banco, () => {});
  const um = async (sql: string, p: unknown[] = []) => (await banco.query(sql, p)).rows[0].id as string;
  ids.empresa = await um(`INSERT INTO empresas (razao_social, cnpj) VALUES ('Construtora Teste', '11222333000181') RETURNING id`);
  ids.centro = await um(`INSERT INTO centros_custo (empresa_id, nome) VALUES ($1, 'Obra teste') RETURNING id`, [ids.empresa]);
  ids.centro2 = await um(`INSERT INTO centros_custo (empresa_id, nome) VALUES ($1, 'Outra obra') RETURNING id`, [ids.empresa]);
  ids.obra = await um(`INSERT INTO obras (empresa_id, codigo, nome, nivel_apropriacao, centro_custo_id) VALUES ($1, 'OB-1', 'Obra', 'obra', $2) RETURNING id`, [ids.empresa, ids.centro]);
  ids.obra2 = await um(`INSERT INTO obras (empresa_id, codigo, nome, nivel_apropriacao, centro_custo_id) VALUES ($1, 'OB-2', 'Outra', 'obra', $2) RETURNING id`, [ids.empresa, ids.centro2]);
  const item = (obra: string, tipo: string, codigo: string) =>
    um(`INSERT INTO obra_itens (obra_id, tipo, codigo, descricao, unidade, preco_centavos) VALUES ($1, $2, $3, $3, 'un', 100) RETURNING id`, [obra, tipo, codigo]);
  ids.servico = await item(ids.obra, 'composicao', 'S1');
  ids.insumo = await item(ids.obra, 'insumo', 'I1');
  ids.servicoOutraObra = await item(ids.obra2, 'composicao', 'S2');
});

after(async () => {
  if (!URL) return;
  await banco.query('DROP SCHEMA IF EXISTS teste_orc CASCADE');
  await banco.end();
});

// A prova é o estado do banco depois da tentativa (vale para o pg real e para o shim local via psql,
// em que a mensagem de erro pode chegar atrasada).
async function tentar(sql: string, params: unknown[]): Promise<string> {
  let erro = '';
  await banco.query(sql, params).catch((e: Error) => (erro = e.message));
  await new Promise((r) => setTimeout(r, 60));
  await banco.query('SELECT 1 AS ok').catch((e: Error) => (erro ||= e.message));
  return erro;
}
const linhasDoItem = async (item: string) => Number((await banco.query('SELECT count(*)::int AS n FROM orcamento_itens WHERE obra_item_id = $1', [item])).rows[0].n);
const lancar = (obra: string, item: string) => tentar('INSERT INTO orcamento_itens (obra_id, obra_item_id, quantidade) VALUES ($1, $2, 1)', [obra, item]);

test('banco aceita serviço da própria obra no orçamento', { skip: pular }, async () => {
  assert.equal(await lancar(ids.obra, ids.servico), '');
  assert.equal(await linhasDoItem(ids.servico), 1);
});

test('banco recusa insumo no orçamento', { skip: pular }, async () => {
  assert.match(await lancar(ids.obra, ids.insumo), /Só serviços/);
  assert.equal(await linhasDoItem(ids.insumo), 0);
});

test('banco recusa serviço de outra obra no orçamento', { skip: pular }, async () => {
  assert.match(await lancar(ids.obra, ids.servicoOutraObra), /não está na obra/);
  assert.equal(await linhasDoItem(ids.servicoOutraObra), 0);
});

test('banco recusa trocar a linha do orçamento para um insumo', { skip: pular }, async () => {
  assert.match(await tentar('UPDATE orcamento_itens SET obra_item_id = $2 WHERE obra_item_id = $1', [ids.servico, ids.insumo]), /Só serviços/);
  assert.equal(await linhasDoItem(ids.insumo), 0);
  assert.equal(await linhasDoItem(ids.servico), 1);
});

test('estrutura de composição: tabela da migração 0029 existe e recusa composição dentro dela mesma', { skip: pular }, async () => {
  const t = (await banco.query(`INSERT INTO ref_tabelas (empresa_id, fonte, nome) VALUES ($1, 'proprio', 'T') RETURNING id`, [ids.empresa])).rows[0].id;
  const c = (await banco.query(`INSERT INTO ref_itens (tabela_id, tipo, codigo, descricao, unidade) VALUES ($1, 'composicao', 'C1', 'C1', 'm2') RETURNING id`, [t])).rows[0].id;
  assert.notEqual(await tentar('INSERT INTO ref_composicao_estrutura (composicao_id, item_id, coeficiente) VALUES ($1, $1, 1)', [c]), '');
  assert.equal(Number((await banco.query('SELECT count(*)::int AS n FROM ref_composicao_estrutura', [])).rows[0].n), 0);
});
