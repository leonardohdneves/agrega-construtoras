// Aplica, em ordem, os arquivos .sql da pasta migrations que ainda não rodaram.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Banco } from './db.ts';

const PASTA = path.resolve(import.meta.dirname, '..', 'migrations');

export async function aplicarMigracoes(banco: Banco, log: (m: string) => void = console.log): Promise<void> {
  const c = await banco.connect();
  try {
    // Trava para duas instâncias não migrarem ao mesmo tempo.
    await c.query('SELECT pg_advisory_lock(727274)');
    await c.query(`CREATE TABLE IF NOT EXISTS migracoes (
      nome text PRIMARY KEY,
      aplicada_em timestamptz NOT NULL DEFAULT now()
    )`);
    const feitas = new Set((await c.query<{ nome: string }>('SELECT nome FROM migracoes')).rows.map((r) => r.nome));
    const arquivos = (await readdir(PASTA)).filter((a) => a.endsWith('.sql')).sort();
    for (const arquivo of arquivos) {
      if (feitas.has(arquivo)) continue;
      const sql = await readFile(path.join(PASTA, arquivo), 'utf8');
      log(`Aplicando migração ${arquivo}`);
      await c.query('BEGIN');
      try {
        await c.query(sql);
        await c.query('INSERT INTO migracoes (nome) VALUES ($1)', [arquivo]);
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    await c.query('SELECT pg_advisory_unlock(727274)').catch(() => {});
    c.release();
  }
}
