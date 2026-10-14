// Restauração do backup completo num banco novo.
// Uso:  DATABASE_URL=postgres://... node scripts/restaurar-backup.ts <pasta-descompactada>
// O banco precisa estar vazio (sem dados nas tabelas do sistema). O script aplica as migrações antes.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { criarBanco, type Banco } from '../src/db.ts';
import { aplicarMigracoes } from '../src/migrar.ts';
import { lerEsquema, ordemRestauracao } from '../src/lib/backup.ts';

type Manifesto = { tipo: string; registros: number; tabelas: { nome: string; registros: number; sha256: string; arquivo: string }[] };

async function main() {
  const pasta = process.argv[2];
  const url = process.env.DATABASE_URL;
  if (!pasta || !url) {
    console.error('Uso: DATABASE_URL=... node scripts/restaurar-backup.ts <pasta-descompactada>');
    process.exit(1);
  }
  const manifesto = JSON.parse(readFileSync(path.join(pasta, 'manifesto.json'), 'utf8')) as Manifesto;
  if (manifesto.tipo !== 'completo') throw new Error('Este arquivo não é um backup completo. Use o backup completo para restaurar.');

  // 1) Confere a integridade de cada arquivo antes de tocar no banco.
  const dados = new Map<string, Buffer>();
  for (const t of manifesto.tabelas) {
    const buf = readFileSync(path.join(pasta, t.arquivo));
    if (createHash('sha256').update(buf).digest('hex') !== t.sha256) throw new Error(`Arquivo ${t.arquivo} não confere com o manifesto (corrompido?).`);
    dados.set(t.nome, buf);
  }
  console.log(`Integridade confirmada: ${manifesto.tabelas.length} tabelas, ${manifesto.registros} registros.`);

  // 2) Prepara o banco com o mesmo esquema do sistema e confere que está vazio.
  const banco: Banco = criarBanco(url);
  await aplicarMigracoes(banco, (m) => console.log(m));
  for (const t of manifesto.tabelas) {
    const n = Number((await banco.query(`SELECT count(*)::int AS n FROM "${t.nome}"`)).rows[0].n);
    if (n > 0) throw new Error(`A tabela ${t.nome} já tem ${n} registros. A restauração só roda em banco vazio.`);
  }

  // 3) Insere tudo numa transação, pais antes de filhos.
  const esquema = await lerEsquema(banco);
  const ordem = ordemRestauracao(esquema).filter((t) => dados.has(t));
  const c = await banco.connect();
  try {
    await c.query('BEGIN');
    await c.query('SAVEPOINT desligar_checagens');
    try {
      await c.query('SET LOCAL session_replication_role = replica'); // desliga checagens de chave estrangeira só nesta transação
    } catch {
      await c.query('ROLLBACK TO SAVEPOINT desligar_checagens');
      console.log('Sem permissão para desligar as checagens; usando a ordem das tabelas.');
    }
    for (const nome of ordem) {
      const json = dados.get(nome)!.toString('utf8');
      await c.query(`INSERT INTO "${nome}" SELECT * FROM json_populate_recordset(NULL::"${nome}", $1::json)`, [json]);
      console.log(`  ${nome}: ${JSON.parse(json).length} registros`);
    }
    // Sequências (colunas com nextval) continuam de onde o backup parou.
    const seqs = (await c.query<{ tabela: string; coluna: string; seq: string }>(
      `SELECT table_name AS tabela, column_name AS coluna, substring(column_default from $1) AS seq
         FROM information_schema.columns WHERE table_schema = 'public' AND column_default LIKE 'nextval%'`,
      ["nextval\\('([^']+)'"],
    )).rows;
    for (const s of seqs) {
      if (!dados.has(s.tabela) || !s.seq) continue;
      await c.query(`SELECT setval($1, COALESCE((SELECT MAX("${s.coluna}") FROM "${s.tabela}"), 1))`, [s.seq]);
    }
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }

  // 4) Confere a contagem final.
  let erros = 0;
  for (const t of manifesto.tabelas) {
    const n = Number((await banco.query(`SELECT count(*)::int AS n FROM "${t.nome}"`)).rows[0].n);
    if (n !== t.registros) {
      erros++;
      console.error(`Divergência em ${t.nome}: esperado ${t.registros}, encontrado ${n}.`);
    }
  }
  await banco.end();
  if (erros) throw new Error(`${erros} tabela(s) com contagem diferente do backup.`);
  console.log('Restauração concluída e conferida.');
}

main().catch((e) => {
  console.error(`Falha na restauração: ${(e as Error).message}`);
  process.exit(1);
});
