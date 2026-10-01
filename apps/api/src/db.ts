import pg from 'pg';

export type Banco = pg.Pool;
export type Cliente = pg.PoolClient | pg.Pool;

export function criarBanco(url: string): Banco {
  if (!url) throw new Error('Defina DATABASE_URL.');
  const ssl = /sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined;
  return new pg.Pool({ connectionString: url, max: 10, ssl });
}

export async function emTransacao<T>(banco: Banco, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await banco.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
