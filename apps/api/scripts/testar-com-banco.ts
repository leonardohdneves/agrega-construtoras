// Roda os testes da API com um Postgres 18 temporário (pacote embedded-postgres), sem instalar nada na máquina.
// Liga o banco numa pasta temporária, passa TEST_DATABASE_URL para os testes, e no fim desliga e apaga tudo.
// Uso: npm run test:banco -w apps/api            (todos os testes)
//      npm run test:banco -w apps/api -- test/rotas-base.test.ts   (só alguns arquivos)
// Não roda como root (o Postgres recusa), por isso fica fora do build do Railway.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

/** Uma porta livre qualquer, para não brigar com outro Postgres da máquina. */
function portaLivre(): Promise<number> {
  return new Promise((ok, erro) => {
    const s = createServer();
    s.once('error', erro);
    s.listen(0, '127.0.0.1', () => {
      const porta = (s.address() as { port: number }).port;
      s.close(() => ok(porta));
    });
  });
}

const pasta = mkdtempSync(path.join(tmpdir(), 'agrega-pg-'));
const porta = await portaLivre();
const SENHA = 'teste';
const pg = new EmbeddedPostgres({
  databaseDir: pasta,
  port: porta,
  user: 'postgres',
  password: SENHA,
  persistent: false,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  onLog: () => {},
  onError: (e) => console.error('[postgres]', e),
});

let codigo = 1;
try {
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('agrega_teste');
  const url = `postgres://postgres:${SENHA}@127.0.0.1:${porta}/agrega_teste`;
  const arquivos = process.argv.slice(2);
  const r = spawnSync(process.execPath, ['--test', ...(arquivos.length ? arquivos : ['test/**/*.test.ts'])], {
    cwd: path.resolve(import.meta.dirname, '..'),
    stdio: 'inherit',
    env: { ...process.env, TEST_DATABASE_URL: url },
  });
  codigo = r.status ?? 1;
} finally {
  await pg.stop().catch(() => {});
  rmSync(pasta, { recursive: true, force: true });
}
process.exit(codigo);
