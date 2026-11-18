import { config } from './config.ts';
import { criarBanco } from './db.ts';
import { aplicarMigracoes } from './migrar.ts';
import { garantirAdmin, garantirConteudoDemo, garantirDemo } from './sementes.ts';
import { garantirConstrutoraModelo } from './lib/construtora-modelo.ts';
import { criarApp } from './app.ts';
import { iniciarAgendamentoBackup } from './lib/backup-job.ts';

const banco = criarBanco(config.databaseUrl);
await aplicarMigracoes(banco);
await garantirAdmin(banco, config.adminEmail, config.adminSenha);
if (config.seedDemo) {
  await garantirDemo(banco, config.demoSenha);
  await garantirConteudoDemo(banco);
}
await garantirConstrutoraModelo(banco, config.cursoSenha);

// OAuth do servidor MCP pela metade: há endereço de retorno autorizado, mas falta o segredo que o servidor MCP apresenta.
if (config.mcpCallbacks.length && !config.mcpApiSecret) {
  console.log('Conexão com assistentes desligada: defina MCP_API_SECRET (32 caracteres ou mais), com o mesmo valor do servidor MCP.');
}

const app = await criarApp(banco);

async function encerrar() {
  await app.close();
  await banco.end();
  process.exit(0);
}
process.on('SIGTERM', encerrar);
process.on('SIGINT', encerrar);

await app.listen({ port: config.porta, host: '0.0.0.0' });
iniciarAgendamentoBackup(banco, (m) => console.log(m));
