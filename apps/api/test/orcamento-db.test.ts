// Planilha orçamentária e orçamento garantidos no banco (migrações 0030 e 0031).
// Roda contra um Postgres de teste: defina TEST_DATABASE_URL (usa o esquema "teste_orc", apagado e recriado).
// O teste aplica as migrações até a 0030, grava um orçamento no formato antigo e só então aplica a 0031,
// para conferir a conversão das linhas antigas.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const URL = process.env.TEST_DATABASE_URL;
const pular = !URL && 'defina TEST_DATABASE_URL para rodar os testes com banco';
const PASTA = path.resolve(import.meta.dirname, '..', 'migrations');
let banco: pg.Pool;
const ids: Record<string, string> = {};

const um = async (sql: string, p: unknown[] = []) => (await banco.query(sql, p)).rows[0].id as string;

async function migrar(filtro: (arquivo: string) => boolean) {
  for (const arquivo of (await readdir(PASTA)).filter((a) => a.endsWith('.sql') && filtro(a)).sort()) {
    await banco.query(await readFile(path.join(PASTA, arquivo), 'utf8'));
  }
}

before(async () => {
  if (!URL) return;
  banco = new pg.Pool({ connectionString: URL, max: 2, options: '-c search_path=teste_orc' });
  await banco.query('DROP SCHEMA IF EXISTS teste_orc CASCADE; CREATE SCHEMA teste_orc');
  await migrar((a) => a < '0031');

  ids.empresa = await um(`INSERT INTO empresas (razao_social, cnpj) VALUES ('Construtora Teste', '11222333000181') RETURNING id`);
  const centro = (nome: string) => um(`INSERT INTO centros_custo (empresa_id, nome) VALUES ($1, $2) RETURNING id`, [ids.empresa, nome]);
  ids.obra = await um(`INSERT INTO obras (empresa_id, codigo, nome, nivel_apropriacao, centro_custo_id) VALUES ($1, 'OB-1', 'Obra', 'etapa', $2) RETURNING id`, [ids.empresa, await centro('Obra')]);
  ids.obra2 = await um(`INSERT INTO obras (empresa_id, codigo, nome, nivel_apropriacao, centro_custo_id) VALUES ($1, 'OB-2', 'Outra', 'obra', $2) RETURNING id`, [ids.empresa, await centro('Outra')]);
  const item = (obra: string, tipo: string, codigo: string) =>
    um(`INSERT INTO obra_itens (obra_id, tipo, codigo, descricao, unidade, preco_centavos) VALUES ($1, $2, $3, $4, 'un', 100) RETURNING id`, [obra, tipo, codigo, `Serviço ${codigo}`]);
  ids.servico = await item(ids.obra, 'composicao', 'S1');
  ids.servico2 = await item(ids.obra, 'composicao', 'S2');
  ids.insumo = await item(ids.obra, 'insumo', 'I1');
  ids.servicoOutraObra = await item(ids.obra2, 'composicao', 'S9');

  // Orçamento no formato antigo: dois serviços na mesma Etapa, e um serviço sem nó (obra sem EAP).
  ids.etapaAntiga = await um(`INSERT INTO eap_nos (obra_id, nivel, codigo, descricao) VALUES ($1, 'etapa', '1', 'Fundação') RETURNING id`, [ids.obra]);
  await banco.query(`INSERT INTO orcamento_itens (obra_id, eap_no_id, obra_item_id, quantidade, ordem) VALUES ($1, $2, $3, 2, 1), ($1, $2, $4, 3, 2)`, [ids.obra, ids.etapaAntiga, ids.servico, ids.servico2]);
  await banco.query(`INSERT INTO orcamento_itens (obra_id, eap_no_id, obra_item_id, quantidade, ordem) VALUES ($1, NULL, $2, 1, 1)`, [ids.obra2, ids.servicoOutraObra]);

  await migrar((a) => a >= '0031');
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
const contar = async (sql: string, p: unknown[] = []) => Number((await banco.query(sql, p)).rows[0].n);
const novaTarefa = (obra: string, codigo: string, pai: string | null = null) =>
  um(`INSERT INTO eap_nos (obra_id, pai_id, nivel, codigo, descricao) VALUES ($1, $2, 'tarefa', $3, 'Tarefa') RETURNING id`, [obra, pai, codigo]);
const lancar = (obra: string, no: string, item: string) => tentar('INSERT INTO orcamento_itens (obra_id, eap_no_id, obra_item_id, quantidade) VALUES ($1, $2, $3, 1)', [obra, no, item]);

test('migração 0031: orçamento antigo vira Tarefas, uma por serviço, com a descrição do serviço', { skip: pular }, async () => {
  const tarefas = (
    await banco.query(
      `SELECT n.codigo, n.pai_id, n.descricao, oi.codigo AS servico FROM orcamento_itens oq JOIN eap_nos n ON n.id = oq.eap_no_id JOIN obra_itens oi ON oi.id = oq.obra_item_id
        WHERE oq.obra_id = $1 ORDER BY n.codigo`,
      [ids.obra],
    )
  ).rows;
  assert.deepEqual(
    tarefas.map((t) => [t.codigo, t.pai_id, t.descricao, t.servico]),
    [
      ['1.1', ids.etapaAntiga, 'Serviço S1', 'S1'],
      ['1.2', ids.etapaAntiga, 'Serviço S2', 'S2'],
    ],
  );
  // Linha sem nó (obra sem EAP) ganhou uma Tarefa na raiz.
  assert.equal(await contar(`SELECT count(*)::int AS n FROM orcamento_itens oq JOIN eap_nos n ON n.id = oq.eap_no_id WHERE oq.obra_id = $1 AND n.nivel = 'tarefa' AND n.pai_id IS NULL`, [ids.obra2]), 1);
  assert.equal(await contar(`SELECT count(*)::int AS n FROM orcamento_itens WHERE eap_no_id IS NULL`), 0);
});

test('banco aceita linha de Obra (nível 1)', { skip: pular }, async () => {
  assert.equal(await tentar(`INSERT INTO eap_nos (obra_id, nivel, codigo, descricao) VALUES ($1, 'obra', '9', 'Bloco B')`, [ids.obra]), '');
});

test('banco aceita serviço da obra numa Tarefa', { skip: pular }, async () => {
  ids.tarefa = await novaTarefa(ids.obra, '2');
  assert.equal(await lancar(ids.obra, ids.tarefa, ids.servico), '');
  assert.equal(await contar('SELECT count(*)::int AS n FROM orcamento_itens WHERE eap_no_id = $1', [ids.tarefa]), 1);
});

test('banco recusa segundo serviço na mesma Tarefa', { skip: pular }, async () => {
  assert.notEqual(await lancar(ids.obra, ids.tarefa, ids.servico2), '');
  assert.equal(await contar('SELECT count(*)::int AS n FROM orcamento_itens WHERE eap_no_id = $1', [ids.tarefa]), 1);
});

test('banco recusa serviço em linha que não é Tarefa', { skip: pular }, async () => {
  assert.match(await lancar(ids.obra, ids.etapaAntiga, ids.servico2), /Tarefa/);
  assert.equal(await contar('SELECT count(*)::int AS n FROM orcamento_itens WHERE eap_no_id = $1', [ids.etapaAntiga]), 0);
});

test('banco recusa insumo no orçamento', { skip: pular }, async () => {
  const t = await novaTarefa(ids.obra, '3');
  assert.match(await lancar(ids.obra, t, ids.insumo), /Só serviços/);
  assert.equal(await contar('SELECT count(*)::int AS n FROM orcamento_itens WHERE obra_item_id = $1', [ids.insumo]), 0);
});

test('banco recusa serviço de outra obra e Tarefa de outra obra', { skip: pular }, async () => {
  const t = await novaTarefa(ids.obra, '4');
  assert.match(await lancar(ids.obra, t, ids.servicoOutraObra), /não está na obra/);
  const t2 = await novaTarefa(ids.obra2, '7');
  assert.match(await lancar(ids.obra, t2, ids.servico2), /Tarefa/);
  assert.equal(await contar('SELECT count(*)::int AS n FROM orcamento_itens WHERE eap_no_id = ANY($1::uuid[])', [[t, t2]]), 0);
});

test('banco recusa trocar o serviço da Tarefa por um insumo', { skip: pular }, async () => {
  assert.match(await tentar('UPDATE orcamento_itens SET obra_item_id = $2 WHERE eap_no_id = $1', [ids.tarefa, ids.insumo]), /Só serviços/);
  assert.equal(await contar('SELECT count(*)::int AS n FROM orcamento_itens WHERE eap_no_id = $1 AND obra_item_id = $2', [ids.tarefa, ids.servico]), 1);
});

test('excluir a Tarefa leva o serviço junto', { skip: pular }, async () => {
  await banco.query('DELETE FROM eap_nos WHERE id = $1', [ids.tarefa]);
  assert.equal(await contar('SELECT count(*)::int AS n FROM orcamento_itens WHERE eap_no_id = $1', [ids.tarefa]), 0);
});

test('estrutura de composição (0029) recusa composição dentro dela mesma', { skip: pular }, async () => {
  const t = await um(`INSERT INTO ref_tabelas (empresa_id, fonte, nome) VALUES ($1, 'proprio', 'T') RETURNING id`, [ids.empresa]);
  const c = await um(`INSERT INTO ref_itens (tabela_id, tipo, codigo, descricao, unidade) VALUES ($1, 'composicao', 'C1', 'C1', 'm2') RETURNING id`, [t]);
  assert.notEqual(await tentar('INSERT INTO ref_composicao_estrutura (composicao_id, item_id, coeficiente) VALUES ($1, $1, 1)', [c]), '');
  assert.equal(await contar('SELECT count(*)::int AS n FROM ref_composicao_estrutura'), 0);
});

test('banco recusa tirar do nível Tarefa a linha que tem serviço (0032) e aceita mudar Etapa para Obra', { skip: pular }, async () => {
  const t = await novaTarefa(ids.obra, '5');
  assert.equal(await lancar(ids.obra, t, ids.servico2), '');
  assert.match(await tentar(`UPDATE eap_nos SET nivel = 'subetapa' WHERE id = $1`, [t]), /serviço lançado/);
  assert.equal(await contar(`SELECT count(*)::int AS n FROM eap_nos WHERE id = $1 AND nivel = 'tarefa'`, [t]), 1);
  assert.equal(await tentar(`UPDATE eap_nos SET nivel = 'obra' WHERE id = $1`, [ids.etapaAntiga]), '');
  assert.equal(await contar(`SELECT count(*)::int AS n FROM eap_nos WHERE id = $1 AND nivel = 'obra'`, [ids.etapaAntiga]), 1);
});

test('renumeração em dois passos não esbarra no código único da obra', { skip: pular }, async () => {
  const a = await um(`INSERT INTO eap_nos (obra_id, nivel, codigo, descricao) VALUES ($1, 'etapa', '50', 'A') RETURNING id`, [ids.obra]);
  const b = await um(`INSERT INTO eap_nos (obra_id, nivel, codigo, descricao) VALUES ($1, 'etapa', '51', 'B') RETURNING id`, [ids.obra]);
  // Troca 50 e 51 (o mesmo SQL de gravarCodigos).
  await banco.query(`UPDATE eap_nos SET codigo = 'tmp-' || id::text WHERE id = ANY($1::uuid[])`, [[a, b]]);
  await banco.query('UPDATE eap_nos n SET codigo = x.codigo FROM unnest($1::uuid[], $2::text[]) AS x(id, codigo) WHERE n.id = x.id', [[a, b], ['51', '50']]);
  const r = (await banco.query('SELECT id, codigo FROM eap_nos WHERE id = ANY($1::uuid[]) ORDER BY codigo', [[a, b]])).rows;
  assert.deepEqual(r.map((x: { id: string }) => x.id), [b, a]);
});
