// Aplica, em ordem, os arquivos .sql da pasta migrations que ainda não rodaram.
import { createHash } from 'node:crypto';
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
    // Hash de cada arquivo aplicado (P23): editar uma migração que já rodou passava despercebido.
    await c.query('ALTER TABLE migracoes ADD COLUMN IF NOT EXISTS checksum text');
    const feitas = new Map((await c.query<{ nome: string; checksum: string | null }>('SELECT nome, checksum FROM migracoes')).rows.map((r) => [r.nome, r.checksum]));
    const arquivos = (await readdir(PASTA)).filter((a) => a.endsWith('.sql')).sort();
    for (const arquivo of arquivos) {
      const sql = await readFile(path.join(PASTA, arquivo), 'utf8');
      const soma = checksum(sql);
      if (feitas.has(arquivo)) {
        const gravada = feitas.get(arquivo);
        // Migrações de antes do checksum ganham o hash agora; as demais são conferidas (só avisa: não trava o deploy).
        if (!gravada) await c.query('UPDATE migracoes SET checksum = $2 WHERE nome = $1', [arquivo, soma]);
        else if (gravada !== soma) log(`Atenção: a migração ${arquivo} foi alterada depois de aplicada. Mudanças no banco vão numa migração nova.`);
        continue;
      }
      log(`Aplicando migração ${arquivo}`);
      await c.query('BEGIN');
      try {
        await c.query(sql);
        await c.query('INSERT INTO migracoes (nome, checksum) VALUES ($1, $2)', [arquivo, soma]);
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

/** SHA-256 do arquivo, sem diferença entre fim de linha do Windows e do Linux. */
export function checksum(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}
