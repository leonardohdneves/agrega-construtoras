// Assinatura desenhada na tela (PNG em data URL) e código de verificação da visita.
import { createHash } from 'node:crypto';
import { ErroHttp } from './erros.ts';

export const PREFIXO_PNG = 'data:image/png;base64,';
// Uma assinatura de tela fica em uns poucos KB; o limite evita guardar algo que não seja assinatura.
const LIMITE_IMAGEM = 250_000;

/** Confere que a assinatura é um PNG em base64 e não está grande demais. Devolve a própria imagem. */
export function validarImagemAssinatura(imagem: string): string {
  if (!imagem.startsWith(PREFIXO_PNG)) throw new ErroHttp(400, 'A assinatura precisa ser uma imagem PNG.');
  if (imagem.length > LIMITE_IMAGEM) throw new ErroHttp(400, 'A assinatura ficou grande demais. Assine de novo.');
  const base64 = imagem.slice(PREFIXO_PNG.length);
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new ErroHttp(400, 'Assinatura inválida. Assine de novo.');
  return imagem;
}

/** Código de verificação: resumo do conteúdo da visita (número, data, responsável, anotações e fotos). */
export function codigoDaVisita(
  v: { numero: number; data: string; responsavel: string | null; observacoes: string | null },
  fotos: string[],
): string {
  const conteudo = JSON.stringify({ n: v.numero, d: v.data, r: v.responsavel, o: v.observacoes, f: [...fotos].sort() });
  return createHash('sha256').update(conteudo).digest('hex').slice(0, 16).toUpperCase();
}
