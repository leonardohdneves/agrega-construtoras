// Hash de senha com scrypt (biblioteca padrão do Node). Formato salvo:
// scrypt$N$r$p$salt(base64)$hash(base64)
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const TAMANHO = 64;

function derivar(senha: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(senha, salt, TAMANHO, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (erro, chave) => {
      if (erro) reject(erro);
      else resolve(chave);
    });
  });
}

export async function gerarHashSenha(senha: string): Promise<string> {
  const salt = randomBytes(16);
  const chave = await derivar(senha, salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64'), chave.toString('base64')].join('$');
}

export async function conferirSenha(senha: string, salvo: string): Promise<boolean> {
  const partes = (salvo ?? '').split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = partes;
  const esperado = Buffer.from(hashB64, 'base64');
  const chave = await derivar(senha, Buffer.from(saltB64, 'base64'), Number(n), Number(r), Number(p));
  return chave.length === esperado.length && timingSafeEqual(chave, esperado);
}

export const SENHA_MINIMA = 8;
