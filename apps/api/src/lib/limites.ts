// Limites de uso por usuário (P19). As rotas de leitura por IA custam chamadas à API da Anthropic e recebem arquivos
// de até 24 MB: sem teto, um usuário logado podia disparar quantas quisesse. A resposta 429 sai em português pelo
// tratador de erros do app.
import type { FastifyRequest } from 'fastify';

/** Chave do limite: o usuário da sessão (cookie ou Bearer); sem sessão, o IP. */
export const porUsuario = (req: FastifyRequest) => (req.sessao?.sub ? `u:${req.sessao.sub}` : `ip:${req.ip}`);

/** Leituras e redações por IA: 20 a cada 10 minutos por usuário. */
export const LIMITE_IA = { rateLimit: { max: 20, timeWindow: '10 minutes', keyGenerator: porUsuario } };
