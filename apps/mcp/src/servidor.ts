/**
 * Servidor MCP do Agrega — transporte HTTP (Streamable HTTP) com OAuth 2.1.
 * Para Claude, ChatGPT e outros clientes remotos que conectam por URL.
 *
 * Portado de src/http-server.ts do servidor MCP do AIRO: o fluxo OAuth (metadados, registro dinâmico de
 * clientes, authorize, callback, token, revogação) e o endpoint /mcp são os mesmos. Muda só o que é do
 * produto: a API por trás, a tela de login e o catálogo de ferramentas.
 */

import express from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { API_BASE_URL, areasDoParametro, createMcpServer, createApiClient, getServerInfo } from './nucleo.ts';
import type { ClienteApi as ApiClient } from './lib/cliente-api.ts';
import {
  assinaturaEstavelEntreDeploys,
  segundosAteExpirar,
  emitirClientId,
  lerClientId,
  derivarClientSecret,
  emitirRefreshToken,
  lerRefreshToken,
  emitirAccessToken,
  lerAccessToken,
  subDoJwt,
  revogarJti,
  jtiRevogado,
  limparRevogados,
  ACCESS_TOKEN_TTL_S,
  conferem,
  hashToken,
} from './lib/oauth-tokens.ts';

const app = express();
const PORT = parseInt(process.env.PORT || process.env.MCP_HTTP_PORT || '3001', 10);

// Rede de segurança do processo. O Express 4 não captura rejeição de handler
// async: sem isto, um TypeError em qualquer rota vira unhandledRejection e o
// Node encerra o processo — uma requisição mal formada derrubava TODAS as
// sessões MCP ativas. Os handlers async também são embrulhados (asyncHandler),
// isto aqui é só o último recurso.
process.on('unhandledRejection', (motivo) => {
  console.error('❌ unhandledRejection (processo segue vivo):', (motivo as any)?.message || motivo);
});
process.on('uncaughtException', (erro) => {
  console.error('❌ uncaughtException — encerrando para o Railway reiniciar limpo:', erro?.message || erro);
  process.exit(1);
});

/** Encaminha a rejeição de um handler async para o error handler do Express. */
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res, next).catch(next); };

/** Query params chegam como string, string[] ou objeto (?a[b]=c). Só string serve. */
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

// Configuracao OAuth2
const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID || 'agrega-chatgpt-mcp';
const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET || '';
// Tela de login/autorização do Agrega (apps/web, rota /oauth/authorize).
const AGREGA_AUTHORIZE_URL = process.env.AGREGA_AUTHORIZE_URL || 'http://localhost:5173/oauth/authorize';

// Configuracao de seguranca via env vars
const ALLOWED_REDIRECT_DOMAINS = (process.env.ALLOWED_REDIRECT_DOMAINS || 'chatgpt.com,platform.openai.com,claude.ai,claude.com,anthropic.com')
  .split(',').map(d => d.trim()).filter(Boolean);

// Uma origem com espaço NO MEIO ("https://anthr opic.com", erro de digitação
// no painel) não bate com nada e some da allowlist em silêncio. Espaço não é
// válido em origem, então removemos todos e avisamos no boot.
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => {
    const limpo = o.replace(/\s+/g, '');
    if (limpo !== o.trim()) console.warn(`⚠️  CORS_ALLOWED_ORIGINS: origem com espaço interno corrigida para "${limpo}" — ajuste a variável.`);
    return limpo;
  })
  .filter(Boolean);

// Segredo compartilhado com a API do Agrega: é com ele que este servidor se identifica ao trocar o código de login
// e ao renovar o token (cabeçalho X-MCP-Secret). Em produção é obrigatório; fora dela, o valor fixo é o mesmo da API.
const MCP_API_SECRET = (() => {
  const s = process.env.MCP_API_SECRET?.trim() ?? '';
  if (s.length >= 32) return s;
  // Mesmo critério de produção da API (apps/api/src/config.ts): no Railway vale mesmo sem NODE_ENV.
  if (process.env.NODE_ENV === 'production' || process.env.RAILWAY_ENVIRONMENT_NAME) throw new Error('MCP_API_SECRET e obrigatorio em producao (minimo 32 caracteres, o mesmo valor configurado na API; gere com: openssl rand -hex 32)');
  return 'segredo-local-do-mcp-apenas-para-desenvolvimento';
})();

const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

// URL pública fixa (issuer OAuth, metadata, WWW-Authenticate). Sem ela o
// servidor deriva do header Host — funciona atrás do Railway, mas o issuer
// de um authorization server deve ser constante, não o que o cliente mandou.
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');

// Hosts aceitos no endpoint MCP (proteção a DNS rebinding — spec Transports
// 2025-06-18 pede validação de Origin/Host). Só ativa com PUBLIC_BASE_URL.
const ALLOWED_HOSTS = new Set<string>(
  [
    PUBLIC_BASE_URL ? new URL(PUBLIC_BASE_URL).hostname : '',
    process.env.RAILWAY_PRIVATE_DOMAIN || '',
    ...(process.env.ALLOWED_HOSTS || '').split(','),
    'localhost', '127.0.0.1', '[::1]',
  ].map(h => h.trim().toLowerCase()).filter(Boolean),
);

// TTLs e tetos para limpeza de memoria
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2h SEM ATIVIDADE (deslizante)
const DCR_CLIENT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
// Sem teto, um Bearer qualquer abria sessões (Server + transporte) sem parar
// por 2h cada — DoS de memória sem autenticação.
const MAX_SESSOES_POR_TOKEN = 8;
const MAX_SESSOES_GLOBAL = 1000;

// Trust proxy (Railway, nginx, etc.)
app.set('trust proxy', TRUST_PROXY ? 1 : false);

// Security headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// CORS com allowlist configuravel
app.use(cors({
  origin: (origin, callback) => {
    // Permite requests sem origin (server-to-server, curl, Postman)
    if (!origin) return callback(null, true);
    // Se nenhuma allowlist configurada, permite tudo (modo dev)
    if (CORS_ALLOWED_ORIGINS.length === 0) return callback(null, true);
    if (CORS_ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error('CORS: origem nao permitida'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  // MCP-Protocol-Version e Last-Event-ID fazem parte do Streamable HTTP.
  allowedHeaders: ['Content-Type', 'Authorization', 'X-MCP-Session-Id', 'Mcp-Session-Id', 'Accept', 'MCP-Protocol-Version', 'Last-Event-ID'],
  exposedHeaders: ['X-MCP-Session-Id', 'Mcp-Session-Id'],
}));
// (o `app.options('*', cors())` que existia aqui era inalcançável — o
// middleware acima já responde o preflight — e, se um dia passasse a valer,
// refletiria qualquer origem.)

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting nos endpoints OAuth. Chave = IP + client_id: Claude e ChatGPT
// saem por poucos IPs de egress, e só por IP 50 req/15min bastavam para um
// conector barrar a renovação de todos os usuários do outro.
const oauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 50,
  keyGenerator: (req) => {
    const clientId = typeof req.body?.client_id === 'string' ? req.body.client_id : str(req.query?.client_id) || '';
    return `${ipKeyGenerator(req.ip || '')}|${clientId.slice(0, 80)}`;
  },
  message: { error: 'too_many_requests', error_description: 'Rate limit exceeded. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const dcrLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 10,
  message: { error: 'too_many_requests', error_description: 'Registration limit reached.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// O endpoint MCP não tinha limite nenhum. Generoso de propósito (Claude e
// ChatGPT saem por poucos IPs e uma conversa dispara dezenas de chamadas),
// mas fecha o initialize-em-loop.
const mcpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  message: { jsonrpc: '2.0', error: { code: -32000, message: 'Too many requests' }, id: null },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/oauth/token', oauthLimiter);
app.use('/oauth/authorize', oauthLimiter);
app.use('/oauth/callback', oauthLimiter);
app.use('/oauth/register', dcrLimiter);
app.use(['/mcp', '/sse'], mcpLimiter);

// Logging de requisicoes HTTP (sanitizado)
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.path}`, {
    hasQuery: Object.keys(req.query).length > 0,
    hasBody: Object.keys(req.body || {}).length > 0,
    hasAuth: !!req.headers.authorization
  });
  next();
});

// Armazena transportes ativos por sessao
const transports: Map<string, StreamableHTTPServerTransport> = new Map();

// Armazena codigos de autorizacao temporarios. Todo código nasce amarrado ao
// client e ao redirect_uri do authorize — um código "órfão" (sem client_id)
// podia ser resgatado por qualquer client confidencial.
const authCodes: Map<string, {
  token: string;
  /** Refresh do backend (fluxo por código) — vai dentro do rt2_ pro Claude. */
  backendRefreshToken?: string;
  expiresAt: Date;
  client_id: string;
  redirect_uri: string;
  resource?: string;
  code_challenge?: string;
  code_challenge_method?: 'S256';
}> = new Map();

// Dono de cada sessao (sessionId -> identidade de quem a abriu: hash de
// usuário+client). É o que amarra a sessão ao Bearer: sem isso, qualquer
// token + um Mcp-Session-Id alheio reutilizava o ApiClient (e o JWT) de outro
// usuário. A identidade (e não o token exato) tolera a renovação por refresh:
// o access token muda a cada hora, o usuário não. O ApiClient fica aqui para
// receber o JWT mais novo a cada requisição.
const sessionTokens: Map<string, { tokenHash: string; createdAt: Date; lastActivity: number; client: ApiClient }> = new Map();

/** Fecha o transporte e esquece a sessão (o onclose do transporte limpa os Maps). */
async function encerrarSessao(sessionId: string, motivo: string) {
  const transport = transports.get(sessionId);
  transports.delete(sessionId);
  sessionTokens.delete(sessionId);
  if (!transport) return;
  try {
    await transport.close();
  } catch (err: any) {
    console.warn('⚠️ Falha ao fechar transporte:', err?.message || err);
  }
  console.log(`🧹 Sessao MCP encerrada (${motivo})`);
}

/**
 * Aplica os tetos de sessão ANTES de criar uma nova: por token (8) e global
 * (1000), descartando sempre a mais antiga sem atividade.
 */
async function abrirVagaParaSessao(tokenHash: string) {
  const doToken = [...sessionTokens.entries()]
    .filter(([, s]) => s.tokenHash === tokenHash)
    .sort((a, b) => a[1].lastActivity - b[1].lastActivity);
  while (doToken.length >= MAX_SESSOES_POR_TOKEN) {
    const [id] = doToken.shift()!;
    await encerrarSessao(id, 'teto por token');
  }
  if (sessionTokens.size >= MAX_SESSOES_GLOBAL) {
    const maisAntiga = [...sessionTokens.entries()].sort((a, b) => a[1].lastActivity - b[1].lastActivity)[0];
    if (maisAntiga) await encerrarSessao(maisAntiga[0], 'teto global');
  }
}

// Armazena clientes registrados via DCR
const registeredClients: Map<string, {
  client_secret: string;
  redirect_uris: string[];
  client_name?: string;
  token_endpoint_auth_method: string;
  created_at: Date;
}> = new Map();

// Cliente pré-registrado (ChatGPT, que não faz registro dinâmico): só existe com OAUTH_CLIENT_SECRET definido.
// Sem o segredo ele não é criado — um cliente confidencial de segredo vazio seria resgatável por qualquer um.
if (OAUTH_CLIENT_SECRET) {
  registeredClients.set(OAUTH_CLIENT_ID, {
    client_secret: OAUTH_CLIENT_SECRET,
    redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
    client_name: 'Agrega MCP Client',
    token_endpoint_auth_method: 'client_secret_post',
    created_at: new Date(),
  });
}

// Contexto do authorize até o callback. A CHAVE é interna e aleatória (vai
// pro front como `state`); o state do cliente fica guardado dentro e volta
// pra ele no redirect final. Com o state do cliente como chave, um segundo
// authorize com o mesmo valor sobrescrevia o PKCE/client da vítima.
const pendingAuthorizations: Map<string, {
  code_challenge?: string;
  code_challenge_method?: 'S256';
  client_id: string;
  redirect_uri: string;
  /** O /oauth/callback deste servidor informado à tela de login: a API só troca o código para o mesmo endereço. */
  callback_uri: string;
  client_state?: string;
  resource?: string;
  expiresAt: Date;
}> = new Map();

// O vínculo da conta só sobrevive a deploy se o segredo de assinatura for o
// mesmo entre reinícios. Sem ele, o client_id emitido antes do restart deixa de
// ser reconhecido e o usuário é obrigado a vincular de novo — que é justamente
// o incômodo que isto veio resolver. Barulhento de propósito.
if (assinaturaEstavelEntreDeploys) {
  console.log('🔐 OAuth: client_id e refresh_token assinados com segredo estável — vínculo sobrevive a deploy.');
} else {
  console.warn(
    '⚠️  OAuth SEM segredo estável (defina OAUTH_SIGNING_SECRET ou OAUTH_CLIENT_SECRET): ' +
    'a cada restart os client_id emitidos param de valer e o usuário precisa vincular a conta de novo.',
  );
}

// ============================================
// HELPERS DE SEGURANCA
// ============================================

/**
 * Helper para obter base URL com protocolo correto
 */
const getBaseUrl = (req: Request) => {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL;
  if (TRUST_PROXY) {
    const proto = req.get('x-forwarded-proto') || 'https';
    return `${proto}://${req.get('host')}`;
  }
  return `${req.protocol}://${req.get('host')}`;
};

// ============================================
// LIMPEZA PERIODICA DE MEMORIA
// ============================================

function cleanupAll() {
  const now = Date.now();

  // Auth codes expirados
  for (const [code, data] of authCodes.entries()) {
    if (data.expiresAt.getTime() < now) authCodes.delete(code);
  }

  // Pending authorizations (PKCE state) expirados
  for (const [key, data] of pendingAuthorizations.entries()) {
    if (data.expiresAt.getTime() < now) pendingAuthorizations.delete(key);
  }

  // DCR clients expirados (manter o padrao)
  for (const [id, client] of registeredClients.entries()) {
    if (id === OAUTH_CLIENT_ID) continue;
    if (now - client.created_at.getTime() > DCR_CLIENT_TTL_MS) registeredClients.delete(id);
  }

  // Sessoes sem atividade (TTL deslizante). Fecha o transporte de verdade:
  // só apagar do Map deixava stream SSE órfão e Server vivo até o GC.
  for (const [sessionId, data] of sessionTokens.entries()) {
    if (now - data.lastActivity > SESSION_TTL_MS) {
      void encerrarSessao(sessionId, 'inatividade');
    }
  }

  limparRevogados();
  for (const [jti, r] of refreshRecentes.entries()) if (r.ate < now) refreshRecentes.delete(jti);
}

// Resposta do refresh guardada por 60s por jti: dois refreshes simultâneos do
// MESMO rt2_ (duas abas, retry de rede) recebem a mesma resposta em vez de o
// segundo cair em "refresh já rotacionado" e mandar o usuário logar de novo.
const refreshRecentes: Map<string, { resposta: Record<string, unknown>; ate: number }> = new Map();

const cleanupInterval = setInterval(cleanupAll, 5 * 60 * 1000);
cleanupInterval.unref();

// ============================================
// ENDPOINTS OAUTH2
// ============================================

/**
 * OAuth2 Protected Resource Metadata (RFC 9728)
 */
app.get('/.well-known/oauth-protected-resource', (req: Request, res: Response) => {
  const baseUrl = getBaseUrl(req);

  res.json({
    resource: baseUrl,
    authorization_servers: [baseUrl],
    scopes_supported: ['openid', 'profile', 'agrega'],
    bearer_methods_supported: ['header'],
  });
});

app.get(['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource/sse'], (req: Request, res: Response) => {
  const baseUrl = getBaseUrl(req);
  const rota = req.path.endsWith('/sse') ? '/sse' : '/mcp';

  res.json({
    resource: `${baseUrl}${rota}`,
    authorization_servers: [baseUrl],
    scopes_supported: ['openid', 'profile', 'agrega'],
    bearer_methods_supported: ['header'],
  });
});

/**
 * OAuth2 Authorization Server Metadata (RFC 8414)
 */
const getOAuthMetadata = (req: Request) => {
  const baseUrl = getBaseUrl(req);

  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/oauth/authorize`,
    token_endpoint: `${baseUrl}/oauth/token`,
    registration_endpoint: `${baseUrl}/oauth/register`,
    revocation_endpoint: `${baseUrl}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'none'],
    // OAuth 2.1 / spec MCP: só S256. `plain` expõe o verifier no authorize.
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['openid', 'profile', 'agrega'],
  };
};

app.get('/.well-known/oauth-authorization-server', (req: Request, res: Response) => {
  res.json(getOAuthMetadata(req));
});

app.get('/.well-known/oauth-authorization-server/mcp', (req: Request, res: Response) => {
  res.json(getOAuthMetadata(req));
});

/**
 * OpenID Connect Discovery (alternativo)
 */
app.get('/.well-known/openid-configuration', (req: Request, res: Response) => {
  res.json(getOAuthMetadata(req));
});

/**
 * Dynamic Client Registration (DCR) - RFC 7591
 */
const dcrBodySchema = z.object({
  redirect_uris: z.array(z.string().max(512)).min(1).max(10),
  client_name: z.string().max(120).optional(),
  token_endpoint_auth_method: z.enum(['client_secret_post', 'client_secret_basic', 'none']).optional(),
}).passthrough();

app.post('/oauth/register', (req: Request, res: Response) => {
  const parsed = dcrBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_client_metadata', error_description: 'redirect_uris (array de URLs) e obrigatorio; client_name ate 120 caracteres' });
    return;
  }
  const { redirect_uris, client_name, token_endpoint_auth_method } = parsed.data;

  console.log('📝 DCR Registration request:', { client_name, hasRedirectUris: true });

  // Validar redirect_uris contra dominios permitidos
  const requestedUris: string[] = redirect_uris;

  const allUrisValid = requestedUris.every((uri: string) => {
    try {
      const url = new URL(uri);
      // https obrigatório, exceto loopback (RFC 8252 §7.3) para clientes locais.
      const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return false;
      return ALLOWED_REDIRECT_DOMAINS.some(d => url.hostname === d || url.hostname.endsWith('.' + d));
    } catch {
      return false;
    }
  });

  if (!allUrisValid) {
    res.status(400).json({
      error: 'invalid_redirect_uri',
      error_description: 'Um ou mais redirect_uris nao sao permitidos. Adicione o dominio em ALLOWED_REDIRECT_DOMAINS.',
    });
    return;
  }

  const authMethod = token_endpoint_auth_method || 'client_secret_post';
  const isPublicClient = authMethod === 'none';

  // O client_id CARREGA o cadastro, assinado — em vez de virar chave de um Map
  // que morre no próximo deploy (era isso que forçava o usuário a revincular a
  // conta a cada restart do serviço). O secret é derivado do id, então também
  // não precisa ser guardado.
  const client_id = emitirClientId({
    redirect_uris: requestedUris,
    client_name: client_name || 'MCP Client',
    token_endpoint_auth_method: authMethod,
  });
  const client_secret = isPublicClient ? '' : derivarClientSecret(client_id);

  // Mantém em memória também: dentro deste processo a leitura sai direto, e
  // clientes emitidos antes desta mudança continuam válidos enquanto ele viver.
  registeredClients.set(client_id, {
    client_secret,
    redirect_uris: requestedUris,
    client_name: client_name || 'MCP Client',
    token_endpoint_auth_method: authMethod,
    created_at: new Date(),
  });

  console.log('✅ DCR Client registered', { auth_method: authMethod, sobrevive_a_deploy: assinaturaEstavelEntreDeploys });

  // Resposta conforme RFC 7591. Clientes publicos nao recebem client_secret.
  const response: Record<string, unknown> = {
    client_id,
    client_name: client_name || 'MCP Client',
    redirect_uris: requestedUris,
    token_endpoint_auth_method: authMethod,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    client_id_issued_at: Math.floor(Date.now() / 1000),
  };
  if (!isPublicClient) response.client_secret = client_secret;

  res.status(201).json(response);
});

/**
 * Cadastro do cliente: memória primeiro (inclusive os de antes desta mudança),
 * senão o próprio client_id assinado. É o que faz o vínculo sobreviver a deploy.
 */
function resolverCliente(clientId: string):
  | { client_secret: string; redirect_uris: string[]; token_endpoint_auth_method: string }
  | null {
  const emMemoria = registeredClients.get(clientId);
  if (emMemoria) return emMemoria;

  const assinado = lerClientId(clientId);
  if (!assinado) return null;
  return {
    client_secret: assinado.token_endpoint_auth_method === 'none' ? '' : derivarClientSecret(clientId),
    redirect_uris: assinado.redirect_uris,
    token_endpoint_auth_method: assinado.token_endpoint_auth_method,
  };
}

/**
 * OAuth2 Authorization Endpoint
 * Redireciona o usuario para a pagina de login do Agrega
 */
app.get('/oauth/authorize', (req: Request, res: Response) => {
  const client_id = str(req.query.client_id);
  const redirect_uri = str(req.query.redirect_uri);
  const state = str(req.query.state);
  const response_type = str(req.query.response_type);
  const code_challenge = str(req.query.code_challenge);
  const code_challenge_method = str(req.query.code_challenge_method);
  const resource = str(req.query.resource);

  console.log('🔐 OAuth authorize request:', { client_id: client_id?.slice(0, 24), response_type, has_pkce: !!code_challenge });

  // Valida client_id (memória OU assinatura — o vínculo sobrevive a deploy)
  const registeredClient = client_id ? resolverCliente(client_id) : null;
  if (!registeredClient || !client_id) {
    res.status(400).json({ error: 'invalid_client', error_description: 'Client ID invalido' });
    return;
  }

  // redirect_uri é obrigatório e tem que bater EXATAMENTE com uma registrada
  // do client. Era opcional: sem ele, o destino final ficava por conta do
  // original_redirect_uri que chegava solto na query do callback.
  const requestedRedirect = redirect_uri;
  if (!requestedRedirect || !registeredClient.redirect_uris.includes(requestedRedirect)) {
    res.status(400).json({
      error: 'invalid_request',
      error_description: 'redirect_uri e obrigatorio e precisa estar registrado para este client_id',
    });
    return;
  }

  // RFC 8707: se o cliente disser para qual resource quer o token, só aceita
  // o próprio MCP (a spec MCP manda o cliente enviar; validar aqui evita
  // emitir token para um resource que não somos nós).
  if (resource && !resourceAceito(req, resource)) {
    res.status(400).json({ error: 'invalid_target', error_description: 'resource nao reconhecido por este servidor' });
    return;
  }

  // Valida response_type
  if (response_type !== 'code') {
    res.status(400).json({ error: 'unsupported_response_type', error_description: 'Apenas response_type=code e suportado' });
    return;
  }

  // Cliente publico (sem secret) DEVE usar PKCE
  if (registeredClient.token_endpoint_auth_method === 'none' && !code_challenge) {
    res.status(400).json({
      error: 'invalid_request',
      error_description: 'PKCE (code_challenge) e obrigatorio para clientes publicos',
    });
    return;
  }

  // PKCE só com S256 (`plain` manda o verifier em claro na URL do authorize)
  if (code_challenge && code_challenge_method !== 'S256') {
    res.status(400).json({
      error: 'invalid_request',
      error_description: 'code_challenge_method deve ser S256',
    });
    return;
  }

  // Contexto do fluxo, com chave interna aleatória (ver pendingAuthorizations).
  const stateKey = crypto.randomUUID();
  const callbackUri = `${getBaseUrl(req)}/oauth/callback`;
  pendingAuthorizations.set(stateKey, {
    callback_uri: callbackUri,
    code_challenge,
    code_challenge_method: code_challenge ? 'S256' : undefined,
    client_id,
    redirect_uri: requestedRedirect,
    client_state: state,
    resource,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  // Redireciona para a pagina de login do Agrega. O front devolve
  // `state` (nossa chave) e ecoa original_redirect_uri — que o callback IGNORA:
  // o destino vem do contexto salvo. Fica na URL só por compatibilidade com o
  // front atual, que exige o parâmetro.
  const telaDeLogin = new URL(AGREGA_AUTHORIZE_URL);
  telaDeLogin.searchParams.set('redirect_uri', callbackUri);
  telaDeLogin.searchParams.set('state', stateKey);
  telaDeLogin.searchParams.set('original_redirect_uri', requestedRedirect);
  telaDeLogin.searchParams.set('client_name', nomeDoCliente(client_id));
  telaDeLogin.searchParams.set('client_host', new URL(requestedRedirect).hostname);

  res.redirect(telaDeLogin.toString());
});

/** Nome legível do client (DCR ou pré-registrado) para a tela de consentimento. */
function nomeDoCliente(clientId: string): string {
  const nome = registeredClients.get(clientId)?.client_name || lerClientId(clientId)?.client_name || 'Aplicativo conectado';
  return nome.slice(0, 60);
}

/** O único resource que este servidor protege é ele mesmo (/mcp ou /sse). */
function resourceAceito(req: Request, resource: string): boolean {
  const base = getBaseUrl(req);
  const normalizado = resource.replace(/\/+$/, '');
  return [base, `${base}/mcp`, `${base}/sse`].includes(normalizado);
}

/**
 * OAuth2 Callback Endpoint
 * Recebe o callback do Agrega apos o login bem-sucedido
 */
app.get('/oauth/callback', asyncHandler(async (req: Request, res: Response) => {
  const tokenNaUrl = str(req.query.token);
  const codigoDoFront = str(req.query.code);
  const state = str(req.query.state);
  const error = str(req.query.error);

  console.log('🔙 OAuth callback recebido:', {
    hasToken: !!tokenNaUrl,
    hasCode: !!codigoDoFront,
    hasError: !!error,
  });

  // Porta antiga FECHADA (14/08): JWT cru na URL não é mais aceito — era
  // exatamente o vazamento (log de proxy, histórico, Referer) que o fluxo por
  // código veio eliminar. Se alguém mandar ?token=, recusa e aponta o caminho.
  if (tokenNaUrl) {
    res.status(400).json({
      error: 'unsupported_parameter',
      error_description: 'Token na URL nao e aceito. O fluxo usa ?code= (codigo de uso unico trocado server-to-server).',
    });
    return;
  }

  // O contexto do authorize é OBRIGATÓRIO: sem ele (state desconhecido,
  // expirado ou já usado) não há client, PKCE nem redirect_uri confiáveis —
  // antes o código era emitido mesmo assim, órfão. O destino do redirect é
  // o que foi validado no authorize; o original_redirect_uri da query é ignorado.
  const pending = state ? pendingAuthorizations.get(state) : undefined;
  if (state) pendingAuthorizations.delete(state);
  if (!pending || pending.expiresAt.getTime() < Date.now()) {
    res.status(400).json({
      error: 'invalid_request',
      error_description: 'Contexto de autorizacao invalido ou expirado. Refaca o login a partir do cliente.',
    });
    return;
  }
  const finalRedirectUri = pending.redirect_uri;
  const clientState = pending.client_state;

  // Se houve erro no login
  if (error) {
    const redirectUrl = new URL(finalRedirectUri);
    redirectUrl.searchParams.set('error', error.slice(0, 64));
    if (clientState) redirectUrl.searchParams.set('state', clientState);
    res.redirect(redirectUrl.toString());
    return;
  }

  // O front manda um CÓDIGO de uso único de 60s e o JWT é obtido aqui,
  // server-to-server — a credencial nunca viaja na URL (log de proxy,
  // histórico do navegador e Referer ficam sem nada de útil).
  let token: string | undefined;
  let backendRefreshToken: string | undefined;
  if (codigoDoFront) {
    try {
      const apiBase = API_BASE_URL;
      const resposta = await fetch(`${apiBase}/api/auth/oauth-exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-MCP-Secret': MCP_API_SECRET },
        body: JSON.stringify({ code: codigoDoFront, redirectUri: pending.callback_uri }),
        signal: AbortSignal.timeout(10000),
      });
      if (resposta.ok) {
        const dados = (await resposta.json()) as { token?: string; refreshToken?: string };
        token = dados.token;
        backendRefreshToken = dados.refreshToken;
      } else if (await recusaDeConfiguracao(resposta)) {
        console.error('❌ A API recusou este servidor MCP: confira MCP_API_SECRET (o mesmo valor nos dois servicos).', { status: resposta.status });
      } else {
        console.warn('⚠️ oauth-exchange recusou o codigo', { status: resposta.status });
      }
    } catch (err: any) {
      console.error('❌ Falha ao trocar codigo por token na API do Agrega:', err?.message || err);
    }
  }

  // Valida se recebeu o token
  if (!token) {
    res.status(400).json({ error: 'missing_token', error_description: 'Token nao recebido do Agrega' });
    return;
  }

  // Gera codigo de autorizacao temporario, vinculando PKCE se presente
  const authCode = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // Expira em 10 minutos

  authCodes.set(authCode, {
    token,
    backendRefreshToken,
    expiresAt,
    client_id: pending.client_id,
    redirect_uri: pending.redirect_uri,
    resource: pending.resource,
    code_challenge: pending.code_challenge,
    code_challenge_method: pending.code_challenge_method,
  });

  console.log('✅ Codigo de autorizacao gerado', { pkce_bound: !!pending.code_challenge });

  // Redireciona de volta para o client com o codigo e o state DELE
  const redirectUrl = new URL(finalRedirectUri);
  redirectUrl.searchParams.set('code', authCode);
  if (clientState) redirectUrl.searchParams.set('state', clientState);

  res.redirect(redirectUrl.toString());
}));

/**
 * OAuth2 Token Endpoint
 * Troca o codigo de autorizacao por um access_token
 */
// Tudo string, e nada além disto é lido do body. Um número em client_id era o
// bastante para derrubar o processo (ver asyncHandler).
const tokenBodySchema = z.object({
  grant_type: z.string(),
  code: z.string().optional(),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
  code_verifier: z.string().optional(),
  refresh_token: z.string().optional(),
  redirect_uri: z.string().optional(),
  resource: z.string().optional(),
}).passthrough();

app.post('/oauth/token', asyncHandler(async (req: Request, res: Response) => {
  const parsed = tokenBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_request', error_description: 'Parametros devem ser strings' });
    return;
  }
  let { grant_type, code, client_id, client_secret, code_verifier, refresh_token, redirect_uri, resource } = parsed.data;

  if (resource && !resourceAceito(req, resource)) {
    res.status(400).json({ error: 'invalid_target', error_description: 'resource nao reconhecido por este servidor' });
    return;
  }

  // Suporta client_secret_basic (Authorization: Basic base64(id:secret)) alem de body
  const basicAuth = req.headers.authorization;
  if (basicAuth?.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(basicAuth.slice(6), 'base64').toString('utf8');
      // RFC 6749 §2.3.1: id e secret vêm URL-encoded, e o secret pode conter ':'.
      const sep = decoded.indexOf(':');
      const basicId = decodeURIComponent(sep < 0 ? decoded : decoded.slice(0, sep));
      const basicSecret = sep < 0 ? '' : decodeURIComponent(decoded.slice(sep + 1));
      if (basicId) client_id = client_id || basicId;
      if (basicSecret) client_secret = client_secret || basicSecret;
    } catch {
      // ignora header malformado
    }
  }

  console.log('🎫 OAuth token request:', { grant_type, client_id: client_id?.slice(0, 24), has_verifier: !!code_verifier });

  // Valida grant_type
  if (grant_type !== 'authorization_code' && grant_type !== 'refresh_token') {
    res.status(400).json({ error: 'unsupported_grant_type', error_description: 'Suportados: authorization_code e refresh_token' });
    return;
  }

  // Valida credenciais do cliente
  const registeredClient = client_id ? resolverCliente(client_id) : null;
  if (!registeredClient || !client_id) {
    res.status(401).json({ error: 'invalid_client', error_description: 'Client ID invalido' });
    return;
  }

  // client_secret e obrigatorio EXCETO para clientes publicos (auth_method=none)
  const isPublicClient = registeredClient.token_endpoint_auth_method === 'none';
  if (!isPublicClient) {
    if (!client_secret || !conferem(client_secret, registeredClient.client_secret)) {
      res.status(401).json({ error: 'invalid_client', error_description: 'Client Secret invalido ou ausente' });
      return;
    }
  }

  const aud = `${getBaseUrl(req)}/mcp`;

  // ── Renovação: o cliente troca o refresh por um access novo, sem pedir nada
  // ao usuário. O refresh é auto-contido (cifrado), então vale mesmo depois de
  // um deploy. A rotação é de VERDADE: cada uso renova no backend, que
  // invalida o refresh anterior — um rt2_ vazado morre no primeiro uso do
  // dono (ou denuncia o ladrão, se ele usar antes).
  if (grant_type === 'refresh_token') {
    const dados = lerRefreshToken(refresh_token, { ignorarRevogacao: true });
    if (!dados) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'Refresh token invalido ou expirado' });
      return;
    }
    if (dados.client_id !== client_id) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'Refresh token nao pertence a este client_id' });
      return;
    }

    // Replay do mesmo rt2_ dentro de 60s: mesma resposta (ver refreshRecentes).
    const repetido = refreshRecentes.get(dados.jti);
    if (repetido) {
      res.json(repetido.resposta);
      return;
    }
    if (jtiRevogado(dados.jti)) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'Refresh token ja utilizado ou revogado' });
      return;
    }

    const responder = (jwt: string, brt: string | undefined, origem: string) => {
      const access = emitirAccessToken(jwt, client_id, aud);
      const resposta = {
        access_token: access.token,
        token_type: 'Bearer',
        expires_in: access.expires_in,
        refresh_token: emitirRefreshToken(jwt, client_id, brt),
        scope: 'openid profile agrega',
      };
      // O rt2_ usado morre aqui (memória) e no backend (quando há brt).
      revogarJti(dados.jti, dados.exp ?? Math.floor(Date.now() / 1000) + 60);
      refreshRecentes.set(dados.jti, { resposta, ate: Date.now() + 60 * 1000 });
      console.log(`♻️ Token OAuth renovado por refresh_token (${origem})`, { expires_in: access.expires_in });
      res.json(resposta);
    };

    if (dados.brt) {
      const renovado = await renovarNoBackend(dados.brt);
      if (renovado.ok) {
        responder(renovado.token, renovado.refreshToken, 'JWT novo do backend');
        return;
      }
      // Backend disse que o refresh não vale mais (rotacionado/revogado/usuário
      // inativo): aí sim é re-login.
      if (renovado.status === 401 || renovado.status === 400 || renovado.status === 403) {
        res.status(400).json({ error: 'invalid_grant', error_description: 'Sessao expirada, e necessario autenticar novamente' });
        return;
      }
      // Backend fora do ar / timeout: degrada com o JWT atual se ele ainda
      // vale, em vez de mandar o usuário logar de novo por causa de uma
      // oscilação de rede. O brt é preservado para a próxima tentativa.
      const restante = segundosAteExpirar(dados.t);
      if (restante !== null && restante > 60) {
        responder(dados.t, dados.brt, 'backend indisponivel, JWT atual reaproveitado');
        return;
      }
    } else {
      // rt2_ antigo sem brt: só dá para reaproveitar o JWT enquanto ele vale.
      const restante = segundosAteExpirar(dados.t);
      if (restante !== null && restante > 60) {
        responder(dados.t, undefined, 'sem refresh do backend');
        return;
      }
    }

    res.status(400).json({ error: 'invalid_grant', error_description: 'Sessao expirada, e necessario autenticar novamente' });
    return;
  }

  // Busca o codigo de autorizacao (remove imediatamente para prevenir reuso)
  const authData = code ? authCodes.get(code) : undefined;
  if (code) authCodes.delete(code);

  if (!authData) {
    res.status(400).json({ error: 'invalid_grant', error_description: 'Codigo de autorizacao invalido ou expirado' });
    return;
  }

  // Verifica se o codigo expirou
  if (authData.expiresAt < new Date()) {
    res.status(400).json({ error: 'invalid_grant', error_description: 'Codigo de autorizacao expirado' });
    return;
  }

  // Valida que o code pertence ao client_id que esta resgatando (sempre há um)
  if (authData.client_id !== client_id) {
    res.status(400).json({ error: 'invalid_grant', error_description: 'Codigo nao pertence a este client_id' });
    return;
  }

  // OAuth 2.1 §4.1.3: se o cliente mandar redirect_uri aqui, tem que ser o
  // mesmo do authorize.
  if (redirect_uri && redirect_uri !== authData.redirect_uri) {
    res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri nao confere com o do authorize' });
    return;
  }

  // Valida PKCE se o authorize foi feito com code_challenge (S256 apenas)
  if (authData.code_challenge) {
    if (!code_verifier) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'code_verifier obrigatorio' });
      return;
    }
    const expected = crypto.createHash('sha256').update(code_verifier).digest('base64url');
    if (!conferem(expected, authData.code_challenge)) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'code_verifier nao confere com code_challenge' });
      return;
    }
  } else if (isPublicClient) {
    // Cliente publico sem PKCE nao e permitido
    res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE obrigatorio para clientes publicos' });
    return;
  }

  // Access token PRÓPRIO do MCP (at2_): curto, só vale aqui (aud) e leva o
  // JWT do AIRO cifrado por dentro. O cliente nunca mais vê o JWT cru — e o
  // refresh rt2_ leva o refresh do backend, a chave da renovação sem usuário.
  const access = emitirAccessToken(authData.token, client_id, authData.resource || aud);
  console.log('✅ Token OAuth emitido com sucesso', {
    expires_in: access.expires_in,
    renovacao_sem_usuario: !!authData.backendRefreshToken,
  });

  res.json({
    access_token: access.token,
    token_type: 'Bearer',
    expires_in: access.expires_in,
    refresh_token: emitirRefreshToken(authData.token, client_id, authData.backendRefreshToken),
    scope: 'openid profile agrega',
  });
}));

/** A API respondeu que o problema é o segredo compartilhado (503 = ela não tem; 401 com `codigo` = o nosso não confere)? */
async function recusaDeConfiguracao(resposta: globalThis.Response): Promise<boolean> {
  if (resposta.status === 503) return true;
  if (resposta.status !== 401) return false;
  const corpo = (await resposta.clone().json().catch(() => ({}))) as { codigo?: string };
  return corpo.codigo === 'servidor_mcp_nao_autorizado';
}

/** Renovação server-to-server na API do Agrega (rotaciona o refresh lá). */
async function renovarNoBackend(brt: string): Promise<
  { ok: true; token: string; refreshToken: string } | { ok: false; status: number | null }
> {
  try {
    const apiBase = API_BASE_URL;
    const resposta = await fetch(`${apiBase}/api/auth/oauth-refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-MCP-Secret': MCP_API_SECRET },
      body: JSON.stringify({ refreshToken: brt }),
      signal: AbortSignal.timeout(10000),
    });
    if (resposta.ok) {
      const novo = (await resposta.json()) as { token?: string; refreshToken?: string };
      if (typeof novo.token === 'string' && typeof novo.refreshToken === 'string') {
        return { ok: true, token: novo.token, refreshToken: novo.refreshToken };
      }
      return { ok: false, status: 500 };
    }
    // Segredo ausente ou divergente é problema de configuração, não sessão encerrada: tratar como API fora do ar
    // (status null) faz o token endpoint reaproveitar o JWT atual em vez de mandar todo mundo logar de novo.
    if (await recusaDeConfiguracao(resposta)) {
      console.error('❌ A API recusou este servidor MCP na renovacao: confira MCP_API_SECRET (o mesmo valor nos dois servicos).', { status: resposta.status });
      return { ok: false, status: null };
    }
    console.warn('⚠️ API recusou a renovacao do refresh', { status: resposta.status });
    return { ok: false, status: resposta.status };
  } catch (err: any) {
    console.error('❌ Falha na renovacao server-to-server:', err?.message || err);
    return { ok: false, status: null };
  }
}

/**
 * Revogação (RFC 7009). Access e refresh são auto-contidos, então revogar é
 * lembrar o jti; o refresh do backend é queimado chamando a rotação e
 * descartando o resultado (o backend não tem endpoint de revogação para o
 * MCP). Responde 200 sempre, como manda a RFC — não vaza se o token existia.
 */
const revokeBodySchema = z.object({
  token: z.string(),
  token_type_hint: z.string().optional(),
  client_id: z.string().optional(),
  client_secret: z.string().optional(),
}).passthrough();

app.post('/oauth/revoke', oauthLimiter, asyncHandler(async (req: Request, res: Response) => {
  const parsed = revokeBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_request', error_description: 'token e obrigatorio' });
    return;
  }
  const { token, client_id } = parsed.data;
  const agora = Math.floor(Date.now() / 1000);

  const access = lerAccessToken(token);
  if (access) {
    if (client_id && access.client_id !== client_id) { res.status(200).end(); return; }
    revogarJti(access.jti, access.exp);
    console.log('🚫 Access token revogado');
    res.status(200).end();
    return;
  }

  const refresh = lerRefreshToken(token);
  if (refresh) {
    if (client_id && refresh.client_id !== client_id) { res.status(200).end(); return; }
    revogarJti(refresh.jti, refresh.exp ?? agora + 60);
    refreshRecentes.delete(refresh.jti); // revogado não pode ser "replayado"
    if (refresh.brt) await renovarNoBackend(refresh.brt); // queima a cadeia no backend
    console.log('🚫 Refresh token revogado', { backend: !!refresh.brt });
  }
  res.status(200).end();
}));

// ============================================
// ENDPOINTS MCP
// ============================================

/**
 * Endpoint de health check
 */
app.get('/health', (_req: Request, res: Response) => {
  const info = getServerInfo();
  res.json({
    status: 'ok',
    server: 'mcp-agrega',
    transport: 'streamable-http',
    toolsCount: info.toolsCount,
  });
});

/**
 * Endpoint MCP Streamable HTTP
 * URL para clientes MCP: https://seu-dominio.com/mcp
 * `/sse` e o mesmo handler, mantido para os conectores ja configurados (ChatGPT etc.).
 * A URL terminar em /sse faz o Claude presumir o transporte SSE legado, por isso /mcp.
 *
 * Suporta o novo protocolo Streamable HTTP (2025-03-26):
 * - POST: Envia mensagens JSON-RPC, responde com SSE stream ou JSON
 * - GET: Abre SSE stream para receber mensagens do servidor
 * - DELETE: Encerra sessao
 */
/** 401 no formato que a spec pede (RFC 9728 §5.1): aponta o resource metadata. */
function responder401(req: Request, res: Response, rota: string, descricao: string) {
  const baseUrl = getBaseUrl(req);
  res.setHeader(
    'WWW-Authenticate',
    `Bearer resource="${baseUrl}${rota}", resource_metadata="${baseUrl}/.well-known/oauth-protected-resource${rota}"`,
  );
  res.status(401).json({ error: 'unauthorized', error_description: descricao });
}

app.all(['/mcp', '/sse'], asyncHandler(async (req: Request, res: Response) => {
  // Extrai token do header Authorization
  const authHeader = req.headers['authorization'];
  const userToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const rota = req.path === '/sse' ? '/sse' : '/mcp';

  console.log(`📡 Requisicao MCP ${req.method} ${rota}`, {
    hasToken: !!userToken,
    hasBody: Object.keys(req.body || {}).length > 0,
    sessionId: req.headers['mcp-session-id'] ? 'present' : 'none'
  });

  // Proteção a DNS rebinding: só com PUBLIC_BASE_URL definida (produção).
  if (PUBLIC_BASE_URL) {
    const host = (req.hostname || '').toLowerCase();
    if (!ALLOWED_HOSTS.has(host)) {
      res.status(403).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Host nao permitido' }, id: null });
      return;
    }
  }

  // Se nao tem token, retorna 401 para forcar o fluxo OAuth
  if (!userToken) {
    responder401(req, res, rota, 'Authentication required. Please authenticate via OAuth.');
    return;
  }

  // Só access token emitido POR ESTE servidor (at2_) entra. JWT cru da API,
  // token vencido, revogado ou de outro resource: 401 aqui, como a spec pede
  // (MUST NOT accept tokens not issued for the MCP server). Clientes com o
  // JWT antigo caem no refresh e saem com at2_; sem refresh, relogam.
  const access = lerAccessToken(userToken);
  if (!access) {
    responder401(req, res, rota, 'Token invalido, expirado ou revogado. Renove via refresh_token ou autentique novamente.');
    return;
  }
  const base = getBaseUrl(req);
  if (![base, `${base}/mcp`, `${base}/sse`].includes(access.aud.replace(/\/+$/, ''))) {
    responder401(req, res, rota, 'Token emitido para outro resource');
    return;
  }
  // Identidade = usuário + client. É o que a sessão exige de cada requisição.
  const tokenHash = hashToken(`${subDoJwt(access.t) ?? access.t}|${access.client_id}`);
  const jwtDoUsuario = access.t;

  // Headers para desabilitar buffering em proxies (Railway, nginx, etc.)
  res.setHeader('X-Accel-Buffering', 'no');

  // Verifica se ja existe uma sessao
  const existingSessionId = str(req.headers['mcp-session-id']);
  let transport: StreamableHTTPServerTransport;

  if (existingSessionId && transports.has(existingSessionId)) {
    // A sessão pertence a quem a abriu: sem isto, qualquer Bearer + um
    // Mcp-Session-Id alheio agia com o JWT de outro usuário (inclusive DELETE).
    const dona = sessionTokens.get(existingSessionId);
    if (!dona || !conferem(dona.tokenHash, tokenHash)) {
      res.status(403).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Token does not match session' }, id: null });
      return;
    }
    dona.lastActivity = Date.now();
    // O JWT mais novo (pós-refresh) passa a valer na sessão imediatamente.
    if (dona.client.getToken() !== jwtDoUsuario) dona.client.setToken(jwtDoUsuario);
    transport = transports.get(existingSessionId)!;
    console.log('♻️ Reutilizando sessao existente');
  } else if (!existingSessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
    // Nova sessao - cria servidor e transporte
    console.log('🆕 Criando nova sessao MCP (initialize request)');
    await abrirVagaParaSessao(tokenHash);

    const client = createApiClient(jwtDoUsuario);
    // `?grupos=engenharia,financeiro` no endereço do conector expõe só essas áreas (P37); sem ele, todas.
    const server = createMcpServer(client, areasDoParametro(req.query?.grupos));

    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (sessionId) => {
        console.log('✅ Sessao MCP iniciada');
        transports.set(sessionId, transport);
        sessionTokens.set(sessionId, { tokenHash, createdAt: new Date(), lastActivity: Date.now(), client });
      }
    });

    // Conecta o servidor ao transporte
    await server.connect(transport);

    // Limpa quando a sessao fechar
    transport.onclose = () => {
      for (const [sessionId, t] of transports.entries()) {
        if (t === transport) {
          transports.delete(sessionId);
          sessionTokens.delete(sessionId);
          break;
        }
      }
    };
  } else if (req.method === 'GET' && !existingSessionId) {
    res.status(405).set('Allow', 'POST').json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method Not Allowed: This server does not offer standalone SSE streams. Use POST with initialize request.',
      },
      id: null,
    });
    return;
  } else if (!existingSessionId) {
    res.status(400).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Bad Request: No valid session. Send initialize request first.',
      },
      id: null,
    });
    return;
  } else {
    res.status(404).json({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: 'Session not found',
      },
      id: null,
    });
    return;
  }

  // Processa a requisicao com o transporte
  try {
    await transport.handleRequest(req, res, req.body);
  } catch (error: any) {
    console.error('❌ Erro ao processar requisicao MCP:', error.message);
    if (process.env.NODE_ENV !== 'production') {
      console.error('Stack:', error.stack);
    }
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal error',
        },
        id: null,
      });
    }
  }
}));

// O POST /messages do protocolo HTTP+SSE antigo (2024-11-05) foi removido:
// nenhum SSEServerTransport era criado em lugar nenhum, então a rota só
// respondia 400/404 e servia de oráculo de existência de sessão.

/**
 * Página inicial: só diz o que é e onde conectar (sem dados sensíveis).
 */
app.get('/', (req: Request, res: Response) => {
  res.json({ servidor: 'MCP do Agrega', conectar: `${getBaseUrl(req)}/mcp`, ferramentas: getServerInfo().toolsCount });
});

// ============================================
// ERROR HANDLER (depois de todas as rotas)
// ============================================

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;
  // Origem fora da allowlist: era 500 com HTML do Express; agora 403.
  if (typeof err?.message === 'string' && err.message.startsWith('CORS:')) {
    res.status(403).json({ error: 'forbidden', error_description: 'Origem nao permitida' });
    return;
  }
  // JSON malformado / body grande demais (body-parser)
  if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
    res.status(400).json({ error: 'invalid_request', error_description: 'Corpo da requisicao invalido' });
    return;
  }
  console.error('❌ Erro nao tratado na rota:', err?.message || err);
  if (process.env.NODE_ENV !== 'production') console.error(err?.stack);
  res.status(500).json({ error: 'server_error', error_description: 'Internal error' });
});

/**
 * Inicializa o servidor HTTP
 */
async function main() {
  const info = getServerInfo();

  app.listen(PORT, () => {
    console.log('');
    console.log('🚀 Servidor MCP do Agrega iniciado (HTTP)');
    console.log('═══════════════════════════════════════════════════');
    console.log(`📡 Servidor HTTP:    http://localhost:${PORT}`);
    console.log(`🔗 Endpoint MCP:     http://localhost:${PORT}/mcp (alias /sse)`);
    console.log(`❤️  Health Check:    http://localhost:${PORT}/health`);
    console.log('═══════════════════════════════════════════════════');
    console.log(`🔐 Autenticacao:     OAuth2 (login em ${AGREGA_AUTHORIZE_URL})`);
    console.log(`🌐 API do Agrega:    ${info.apiBaseUrl}`);
    console.log(`🛠️  Ferramentas:      ${info.toolsCount} disponiveis`);
    console.log('═══════════════════════════════════════════════════');
    console.log('');
    console.log('🔐 OAuth2 Endpoints:');
    console.log('   GET  /oauth/authorize');
    console.log('   GET  /oauth/callback');
    console.log('   POST /oauth/token');
    console.log('   POST /oauth/register');
    console.log('   POST /oauth/revoke');
    console.log(`   Access token proprio (at2_), validade ${ACCESS_TOKEN_TTL_S}s; refresh rotacionado no backend`);
    console.log('');
    console.log('🔒 Security:');
    console.log(`   CORS: ${CORS_ALLOWED_ORIGINS.length > 0 ? `${CORS_ALLOWED_ORIGINS.length} origins allowed` : 'all origins (configure CORS_ALLOWED_ORIGINS)'}`);
    console.log(`   Redirect domains: ${ALLOWED_REDIRECT_DOMAINS.join(', ')}`);
    console.log(`   Trust proxy: ${TRUST_PROXY}`);
    console.log(`   URL publica: ${PUBLIC_BASE_URL || '(derivada do header Host — defina PUBLIC_BASE_URL)'}`);
    console.log(`   Sessoes: max ${MAX_SESSOES_POR_TOKEN}/token, ${MAX_SESSOES_GLOBAL} total, TTL ${SESSION_TTL_MS / 60000}min sem atividade`);
    console.log('');
  });
}

main().catch((error) => {
  console.error('❌ Erro fatal ao iniciar servidor HTTP:', error);
  process.exit(1);
});
