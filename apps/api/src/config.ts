// Configuração lida das variáveis de ambiente.
import { randomBytes } from 'node:crypto';

const producao = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT_NAME;

function segredoJwt(): string {
  const s = process.env.JWT_SECRET ?? '';
  if (s.length >= 32) return s;
  if (producao) {
    throw new Error('Defina JWT_SECRET com pelo menos 32 caracteres nas variáveis do serviço.');
  }
  // Desenvolvimento local: segredo temporário (as sessões caem a cada reinício).
  return randomBytes(48).toString('hex');
}

/** Fora de produção há um valor fixo, igual ao do servidor MCP, para os dois se entenderem sem configuração. */
function segredoMcp(): string {
  const s = process.env.MCP_API_SECRET?.trim() ?? '';
  if (s.length >= 32) return s;
  return producao ? '' : 'segredo-local-do-mcp-apenas-para-desenvolvimento';
}

export const config = {
  producao,
  porta: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? '',
  jwtSecret: segredoJwt(),
  ambiente: process.env.RAILWAY_ENVIRONMENT_NAME ?? (producao ? 'production' : 'local'),
  adminEmail: process.env.ADMIN_EMAIL?.trim() || '',
  adminSenha: process.env.ADMIN_SENHA || '',
  seedDemo: process.env.SEED_DEMO === 'true',
  demoSenha: process.env.DEMO_SENHA || '',
  cursoSenha: process.env.CURSO_SENHA || '',
  cookieSeguro: producao,
  // Endereços /oauth/callback dos servidores MCP autorizados a receber o código de login (separados por vírgula).
  // Segredo compartilhado com o servidor MCP: só quem o apresenta troca o código de login e renova o token (P38).
  // Em produção, sem ele (mínimo de 32 caracteres) essas duas rotas recusam tudo.
  mcpApiSecret: segredoMcp(),
  mcpCallbacks: (process.env.MCP_CALLBACK_URLS ?? (producao ? '' : 'http://localhost:3001/oauth/callback')).split(',').map((s) => s.trim()).filter(Boolean),
};
