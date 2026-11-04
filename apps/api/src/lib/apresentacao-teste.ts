// Apresentação para captação no período de testes, personalizada para o cliente (interessado ou construtora cadastrada).
// Sem preços: a proposta com valores fica para depois do teste.
// Interessado: o botão leva ao cadastro público. Construtora já cadastrada: leva ao login do app.
import { esc } from './proposta-interessado.ts';

export function preencherApresentacao(
  modelo: string,
  d: { cliente: string; responsavel: string | null; cadastrado?: boolean },
  data: string,
): string {
  const cta = d.cadastrado
    ? { link: '/entrar', rotulo: 'Entrar no Agrega', texto: 'é só entrar com o seu usuário e senha.' }
    : { link: '/interesse', rotulo: 'Quero o período de testes', texto: 'o período de testes começa com uma conversa de diagnóstico.' };
  return modelo
    .replaceAll('{{cliente}}', esc(d.cliente))
    .replaceAll('{{responsavel}}', esc(d.responsavel ?? 'a informar'))
    .replaceAll('{{data}}', esc(data))
    .replaceAll('{{texto_cta}}', esc(cta.texto))
    .replaceAll('{{link_cta}}', cta.link)
    .replaceAll('{{rotulo_cta}}', esc(cta.rotulo));
}
