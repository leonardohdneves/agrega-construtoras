/**
 * Portado do servidor MCP do AIRO (src/lib/oauth-tokens.ts), sem mudança de comportamento.
 *
 * Peças do OAuth que precisam sobreviver a restart do processo.
 *
 * O problema que isto resolve: o servidor guardava clientes DCR, códigos e
 * sessões em Map de memória. Todo deploy do Railway zerava tudo, e o client_id
 * que o Claude tinha em mãos passava a dar 401 invalid_client — o usuário era
 * obrigado a vincular a conta de novo, sem nada ter expirado de verdade.
 *
 * A saída é não guardar: o client_id e o refresh_token carregam os próprios
 * dados, ASSINADOS com HMAC. Validar vira recalcular a assinatura, então
 * qualquer instância (depois de qualquer restart) reconhece o que ela mesma
 * emitiu — desde que o segredo seja estável entre deploys.
 */

import crypto from 'crypto';

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf as any).toString('base64url');

/**
 * Segredo de assinatura. Em ordem: OAUTH_SIGNING_SECRET (dedicado) →
 * OAUTH_CLIENT_SECRET (já existe no ambiente) → efêmero.
 *
 * Com segredo efêmero tudo continua FUNCIONANDO, mas volta a morrer no
 * restart — é o comportamento antigo, e o log diz isso na cara.
 */
function resolverSegredo(): { secret: string; estavel: boolean } {
  const dedicado = process.env.OAUTH_SIGNING_SECRET?.trim();
  if (dedicado && dedicado.length >= 32) return { secret: dedicado, estavel: true };

  // Em produção não há fallback: o OAUTH_CLIENT_SECRET é entregue ao ChatGPT
  // (é o secret do client pré-registrado) — não pode ser a chave que cifra o
  // refresh token de todo mundo. Falha no boot, de propósito.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('OAUTH_SIGNING_SECRET e obrigatorio em producao (minimo 32 caracteres; gere com: openssl rand -hex 32)');
  }

  const clientSecret = process.env.OAUTH_CLIENT_SECRET?.trim();
  if (clientSecret && clientSecret.length >= 16) return { secret: clientSecret, estavel: true };

  return { secret: crypto.randomBytes(32).toString('hex'), estavel: false };
}

const { secret: SIGNING_SECRET, estavel: SEGREDO_ESTAVEL } = resolverSegredo();

export const assinaturaEstavelEntreDeploys = SEGREDO_ESTAVEL;

function assinar(payload: string, escopo: string): string {
  return crypto.createHmac('sha256', SIGNING_SECRET).update(`${escopo}:${payload}`).digest('base64url');
}

/** Comparação em tempo constante (evita distinguir assinatura errada por timing). */
export function conferem(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Hash curto de um token para usar como chave de Map e em comparações: o
 * token em si nunca fica guardado em memória além do ApiClient da sessão.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('base64url');
}

function empacotar(dados: unknown, escopo: string, prefixo: string): string {
  const payload = b64url(JSON.stringify(dados));
  return `${prefixo}${payload}.${assinar(payload, escopo)}`;
}

function desempacotar<T>(token: unknown, escopo: string, prefixo: string): T | null {
  // O body é JSON: client_id pode chegar como número/objeto. Sem este guard o
  // `.startsWith` lança TypeError dentro de um handler async — e no Express 4
  // isso vira unhandledRejection e derruba o processo inteiro.
  if (typeof token !== 'string' || !token.startsWith(prefixo)) return null;
  const corpo = token.slice(prefixo.length);
  const corte = corpo.lastIndexOf('.');
  if (corte < 1) return null;
  const payload = corpo.slice(0, corte);
  const assinatura = corpo.slice(corte + 1);
  if (!conferem(assinatura, assinar(payload, escopo))) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

// ── Validade real do access_token ────────────────────────────────────────────

/**
 * Segundos até o JWT expirar, lidos do próprio `exp`.
 *
 * O servidor respondia `expires_in: 86400` fixo enquanto o token do Agrega vale
 * 7 dias: o cliente acreditava no número, dava a credencial por vencida em 24h
 * e — sem refresh — pedia login de novo, com o token ainda bom por mais 6 dias.
 * Só decodifica o payload (não valida assinatura): quem valida de verdade é a
 * API do Agrega a cada chamada.
 */
export function segundosAteExpirar(jwt: unknown): number | null {
  if (typeof jwt !== 'string') return null;
  const partes = jwt.split('.');
  if (partes.length < 2) return null;
  try {
    const payload = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
    if (typeof payload?.exp !== 'number') return null;
    const restante = payload.exp - Math.floor(Date.now() / 1000);
    return restante > 0 ? restante : 0;
  } catch {
    return null;
  }
}

// ── Cliente DCR sem estado ───────────────────────────────────────────────────

export interface DadosCliente {
  redirect_uris: string[];
  client_name: string;
  token_endpoint_auth_method: string;
  iat: number;
}

const PREFIXO_CLIENTE = 'mcp2_';

export function emitirClientId(dados: Omit<DadosCliente, 'iat'>): string {
  return empacotar({ ...dados, iat: Math.floor(Date.now() / 1000) }, 'client', PREFIXO_CLIENTE);
}

export function lerClientId(clientId: unknown): DadosCliente | null {
  return desempacotar<DadosCliente>(clientId, 'client', PREFIXO_CLIENTE);
}

/**
 * client_secret derivado do próprio client_id — não precisa ser guardado:
 * conferir é recalcular.
 */
export function derivarClientSecret(clientId: string): string {
  return crypto.createHmac('sha256', SIGNING_SECRET).update(`secret:${clientId}`).digest('hex');
}

// ── Tokens cifrados (access e refresh) ──────────────────────────────────────
//
// CRIPTOGRAFADOS (AES-256-GCM, que também autentica — adulterou, não
// decifra). O regime cifrado existe porque os dois carregam credenciais do
// backend (o JWT do usuário e o refresh rotativo): assinar não basta quando
// o conteúdo em si é segredo. O rt1_ (assinado, legível) foi DESLIGADO em
// 14/08 — só existiu por algumas horas entre dois deploys.

const chaveAes = crypto.createHash('sha256').update(`aes:${SIGNING_SECRET}`).digest();

function cifrar(dados: unknown, prefixo: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', chaveAes, iv);
  const cifrado = Buffer.concat([cipher.update(JSON.stringify(dados), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${prefixo}${b64url(Buffer.concat([iv, tag, cifrado]))}`;
}

function decifrar<T>(token: unknown, prefixo: string): T | null {
  if (typeof token !== 'string' || !token.startsWith(prefixo)) return null;
  try {
    const blob = Buffer.from(token.slice(prefixo.length), 'base64url');
    const iv = blob.subarray(0, 12);
    const tag = blob.subarray(12, 28);
    const cifrado = blob.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', chaveAes, iv);
    decipher.setAuthTag(tag);
    const texto = Buffer.concat([decipher.update(cifrado), decipher.final()]).toString('utf8');
    return JSON.parse(texto) as T;
  } catch {
    return null;
  }
}

// ── Revogação ───────────────────────────────────────────────────────────────
//
// Tokens cifrados são auto-contidos; revogar é lembrar o jti até ele vencer.
// Em memória: some num restart (um access vive no máximo 1h; o refresh de
// verdade é revogado no backend, que é quem guarda estado).

const jtisRevogados = new Map<string, number>(); // jti -> exp (epoch s)

export function revogarJti(jti: string, exp: number): void {
  jtisRevogados.set(jti, exp);
}

export function jtiRevogado(jti: string): boolean {
  return jtisRevogados.has(jti);
}

export function limparRevogados(): void {
  const agora = Math.floor(Date.now() / 1000);
  for (const [jti, exp] of jtisRevogados) if (exp <= agora) jtisRevogados.delete(jti);
}

// ── Access token do MCP (at2_) ──────────────────────────────────────────────
//
// O que o cliente OAuth (Claude, ChatGPT, Manus) recebe e guarda. Antes era o
// JWT cru da API Agrega: valia 7 dias, servia direto em a API e
// não dava para revogar — e a spec MCP proíbe repassar token que não foi
// emitido para o MCP. O at2_ só funciona aqui (aud), vive pouco e leva o JWT
// cifrado por dentro; quem valida é este servidor, sem ir à API.

export interface DadosAccess {
  /** JWT do usuário no Agrega — usado só do lado de cá, nunca sai. */
  t: string;
  client_id: string;
  /** Resource para o qual foi emitido (RFC 8707). */
  aud: string;
  iat: number;
  exp: number;
  jti: string;
}

const PREFIXO_ACCESS = 'at2_';

/** Validade do access token (s). Curta: a renovação é por refresh, sem usuário. */
export const ACCESS_TOKEN_TTL_S = Math.max(300, parseInt(process.env.MCP_ACCESS_TOKEN_TTL || '3600', 10) || 3600);

export function emitirAccessToken(
  jwtDoUsuario: string,
  clientId: string,
  aud: string,
): { token: string; expires_in: number } {
  const agora = Math.floor(Date.now() / 1000);
  // Nunca vive mais que o JWT que carrega.
  const restanteJwt = segundosAteExpirar(jwtDoUsuario) ?? ACCESS_TOKEN_TTL_S;
  const expires_in = Math.max(1, Math.min(ACCESS_TOKEN_TTL_S, restanteJwt));
  const dados: DadosAccess = {
    t: jwtDoUsuario,
    client_id: clientId,
    aud,
    iat: agora,
    exp: agora + expires_in,
    jti: crypto.randomUUID(),
  };
  return { token: cifrar(dados, PREFIXO_ACCESS), expires_in };
}

/** null se não for um at2_ deste servidor, estiver vencido ou revogado. */
export function lerAccessToken(token: unknown): DadosAccess | null {
  const dados = decifrar<DadosAccess>(token, PREFIXO_ACCESS);
  if (!dados || typeof dados.exp !== 'number' || typeof dados.t !== 'string') return null;
  if (dados.exp <= Math.floor(Date.now() / 1000)) return null;
  if (jtiRevogado(dados.jti)) return null;
  return dados;
}

/** `sub` do JWT do Agrega (identidade do usuário), sem validar assinatura. */
export function subDoJwt(jwt: string): string | null {
  const partes = jwt.split('.');
  if (partes.length < 2) return null;
  try {
    const payload = JSON.parse(Buffer.from(partes[1], 'base64url').toString('utf8'));
    return typeof payload?.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

// ── Refresh token (rt2_) ─────────────────────────────────────────────────────

export interface DadosRefresh {
  /** JWT do usuário no Agrega — vai dentro do próximo access token. */
  t: string;
  /**
   * Refresh token do BACKEND (rotativo, hash no banco): é ele que permite
   * renovar o JWT sem envolver o usuário e que dá a rotação de verdade — o
   * backend invalida o anterior a cada uso.
   */
  brt?: string;
  client_id: string;
  iat: number;
  /** Validade absoluta (epoch s). Ausente só em rt2_ emitidos antes disto. */
  exp?: number;
  jti: string;
}

const PREFIXO_REFRESH = 'rt2_';

/** 30 dias, igual ao TTL do refresh do backend. */
export const REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60;

export function emitirRefreshToken(
  jwtDoUsuario: string,
  clientId: string,
  backendRefreshToken?: string,
): string {
  const agora = Math.floor(Date.now() / 1000);
  const dados: DadosRefresh = {
    t: jwtDoUsuario,
    ...(backendRefreshToken && { brt: backendRefreshToken }),
    client_id: clientId,
    iat: agora,
    exp: agora + REFRESH_TOKEN_TTL_S,
    jti: crypto.randomUUID(),
  };
  return cifrar(dados, PREFIXO_REFRESH);
}

/**
 * null se não for rt2_ deste servidor ou estiver vencido (30d). Revogado
 * também dá null, salvo `ignorarRevogacao` — o token endpoint precisa ler um
 * rt2_ já consumido para responder o replay idempotente de 60s.
 */
export function lerRefreshToken(refreshToken: unknown, opts?: { ignorarRevogacao?: boolean }): DadosRefresh | null {
  const dados = decifrar<DadosRefresh>(refreshToken, PREFIXO_REFRESH);
  if (!dados || typeof dados.t !== 'string' || typeof dados.iat !== 'number') return null;
  const exp = dados.exp ?? dados.iat + REFRESH_TOKEN_TTL_S;
  if (exp <= Math.floor(Date.now() / 1000)) return null;
  if (!opts?.ignorarRevogacao && dados.jti && jtiRevogado(dados.jti)) return null;
  return { ...dados, exp };
}
