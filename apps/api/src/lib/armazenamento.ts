// Cliente mínimo do armazenamento S3 (bucket do Railway), com assinatura AWS SigV4 feita com o próprio Node.
import { createHash, createHmac } from 'node:crypto';

export type ConfigBucket = { endpoint: string; bucket: string; region: string; accessKey: string; secretKey: string };

/** Lê a configuração das variáveis do serviço. Sem elas, o armazenamento fica desligado. */
export function configBucket(env: NodeJS.ProcessEnv = process.env): ConfigBucket | null {
  const endpoint = env.BACKUP_BUCKET_ENDPOINT?.trim();
  const bucket = env.BACKUP_BUCKET_NAME?.trim();
  const accessKey = env.BACKUP_BUCKET_ACCESS_KEY?.trim();
  const secretKey = env.BACKUP_BUCKET_SECRET_KEY?.trim();
  if (!endpoint || !bucket || !accessKey || !secretKey) return null;
  return { endpoint, bucket, region: env.BACKUP_BUCKET_REGION?.trim() || 'auto', accessKey, secretKey };
}

const sha256 = (d: Buffer | string) => createHash('sha256').update(d).digest('hex');
const hmac = (k: Buffer | string, d: string) => createHmac('sha256', k).update(d, 'utf8').digest();
const codificar = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

async function requisicao(cfg: ConfigBucket, metodo: 'GET' | 'PUT' | 'DELETE', chave: string, corpo?: Buffer, tipo?: string): Promise<Buffer> {
  const url = new URL(cfg.endpoint);
  const caminho = `/${codificar(cfg.bucket)}/${chave.split('/').map(codificar).join('/')}`;
  const agora = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''); // AAAAMMDDTHHMMSSZ
  const data = agora.slice(0, 8);
  const hashCorpo = sha256(corpo ?? '');
  const cabecalhos: Record<string, string> = { host: url.host, 'x-amz-content-sha256': hashCorpo, 'x-amz-date': agora };
  if (corpo && tipo) cabecalhos['content-type'] = tipo;
  const nomes = Object.keys(cabecalhos).sort();
  const assinados = nomes.join(';');
  const canonico = [metodo, caminho, '', nomes.map((n) => `${n}:${cabecalhos[n]!.trim()}\n`).join(''), assinados, hashCorpo].join('\n');
  const escopo = `${data}/${cfg.region}/s3/aws4_request`;
  const aAssinar = ['AWS4-HMAC-SHA256', agora, escopo, sha256(canonico)].join('\n');
  const chaveAssinatura = hmac(hmac(hmac(hmac(`AWS4${cfg.secretKey}`, data), cfg.region), 's3'), 'aws4_request');
  const assinatura = createHmac('sha256', chaveAssinatura).update(aAssinar, 'utf8').digest('hex');

  const enviados: Record<string, string> = { ...cabecalhos };
  delete enviados.host; // o fetch envia o Host sozinho, com o mesmo valor assinado
  enviados.authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${escopo}, SignedHeaders=${assinados}, Signature=${assinatura}`;
  const resp = await fetch(`${url.origin}${caminho}`, { method: metodo, headers: enviados, body: corpo ? new Uint8Array(corpo) : undefined });
  if (!resp.ok) {
    const texto = (await resp.text().catch(() => '')).slice(0, 300);
    throw new Error(`Armazenamento respondeu ${resp.status} em ${metodo}: ${texto}`);
  }
  return Buffer.from(await resp.arrayBuffer());
}

export const enviarObjeto = (cfg: ConfigBucket, chave: string, dados: Buffer, tipo = 'application/zip') => requisicao(cfg, 'PUT', chave, dados, tipo).then(() => undefined);
export const lerObjeto = (cfg: ConfigBucket, chave: string) => requisicao(cfg, 'GET', chave);
export const apagarObjeto = (cfg: ConfigBucket, chave: string) => requisicao(cfg, 'DELETE', chave).then(() => undefined);
