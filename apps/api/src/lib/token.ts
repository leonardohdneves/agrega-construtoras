// Token de sessão no formato JWT (HS256), assinado com a biblioteca padrão do Node.
import { createHmac, timingSafeEqual } from 'node:crypto';

export type Perfil =
  | 'admin_sistema'
  | 'dono'
  | 'gestor'
  | 'orcamentista'
  | 'engenheiro_obra'
  | 'comprador'
  | 'administrativo'
  | 'vendedor'
  | 'financeiro'
  // Perfis da concreteira, mantidos só por compatibilidade com o código herdado.
  | 'motorista'
  | 'operador_usina'
  | 'laboratorista';

export type DadosSessao = {
  sub: string; // id do usuário
  emp: string | null; // id da empresa (nulo para o administrador do sistema)
  per: Perfil;
  iat: number;
  exp: number;
};

function b64url(entrada: Buffer | string): string {
  return Buffer.from(entrada).toString('base64url');
}

function assinar(conteudo: string, segredo: string): string {
  return createHmac('sha256', segredo).update(conteudo).digest('base64url');
}

export function criarToken(
  dados: Omit<DadosSessao, 'iat' | 'exp'>,
  segredo: string,
  validadeSegundos = 60 * 60 * 12,
  agora = Math.floor(Date.now() / 1000),
): string {
  const cabecalho = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const corpo = b64url(JSON.stringify({ ...dados, iat: agora, exp: agora + validadeSegundos }));
  return `${cabecalho}.${corpo}.${assinar(`${cabecalho}.${corpo}`, segredo)}`;
}

export function lerToken(token: string | undefined, segredo: string, agora = Math.floor(Date.now() / 1000)): DadosSessao | null {
  if (!token) return null;
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  const [cabecalho, corpo, assinatura] = partes;
  const esperada = Buffer.from(assinar(`${cabecalho}.${corpo}`, segredo));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null;
  try {
    const h = JSON.parse(Buffer.from(cabecalho, 'base64url').toString('utf8'));
    if (h.alg !== 'HS256') return null;
    const dados = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8')) as DadosSessao;
    if (typeof dados.exp !== 'number' || dados.exp <= agora) return null;
    if (typeof dados.sub !== 'string' || typeof dados.per !== 'string') return null;
    return dados;
  } catch {
    return null;
  }
}
