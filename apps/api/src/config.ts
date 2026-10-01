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
  cookieSeguro: producao,
};
