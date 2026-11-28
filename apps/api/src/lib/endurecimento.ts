// Endurecimento da API (P23): cabeçalhos de segurança, checagem de origem nas escritas, logs sem tokens e versão.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Política de conteúdo das telas. O build do Vite não tem script embutido (só módulos com src), e as únicas origens
 * de fora são as fontes do Google. Estilo embutido continua liberado: o React usa o atributo style.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Ferramentas 3D/5D em /4d/: a leitura de IFC usa WebAssembly, que precisa de 'wasm-unsafe-eval' (sem eval de texto).
 * Só essa pasta recebe a exceção; o resto do sistema segue com a política acima.
 */
export const CSP_4D = CSP.replace("script-src 'self'", "script-src 'self' 'wasm-unsafe-eval'");

/** Cabeçalhos de segurança em toda resposta. HSTS só em produção (no localhost quebraria o http). */
export function cabecalhosSeguranca(producao: boolean) {
  return async (req: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(self)');
    reply.header('Content-Security-Policy', req.url.startsWith('/4d/') ? CSP_4D : CSP);
    if (producao) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    return payload;
  };
}

const ESCRITA = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF (P23): escrita com sessão de cookie vinda de outro site é recusada. Antes, a única defesa era o sameSite lax.
 * Ficam de fora: o Bearer (servidor MCP, sem cookie), pedidos sem Origin (fora do navegador) e pedidos sem cookie de
 * sessão (formulário público de interesse, aceite e assinatura, que não dependem de sessão).
 */
export function conferirOrigem(nomeCookie: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!ESCRITA.has(req.method)) return;
    if (/^Bearer /.test(req.headers.authorization ?? '')) return;
    if (!req.cookies?.[nomeCookie]) return;
    const origem = req.headers.origin;
    if (!origem) return;
    let host: string;
    try {
      host = new URL(origem).host;
    } catch {
      return reply.code(403).send({ erro: 'Origem do pedido não reconhecida.' });
    }
    if (host !== req.host) return reply.code(403).send({ erro: 'Origem do pedido não reconhecida.' });
  };
}

/** Rotas públicas que levam o código ou token no caminho: o log guarda só o começo. */
const COM_TOKEN = /^(\/api\/(?:aceite|assinatura)\/)([^/?]+)/;

/** Endereço para o log, com o token mascarado (P23: o código do aceite e da assinatura ficava inteiro no log). */
export function urlParaLog(url: string): string {
  return url.replace(COM_TOKEN, (_t, base: string, token: string) => `${base}${token.slice(0, 4)}…`);
}

/** Serializador do pedido no log: sem tokens, com o IP que o app considera o do cliente. */
export const serializarPedido = (req: FastifyRequest) => ({
  method: req.method,
  url: urlParaLog(req.url),
  ip: req.ip,
});

/** Versão da API, lida do package.json (antes era fixa em 0.9.0 e o pacote dizia 0.1.0). */
export function versaoDoPacote(): string {
  try {
    const pkg = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '..', '..', 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
