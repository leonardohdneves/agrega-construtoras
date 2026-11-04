// Apresentação para captação no período de testes, personalizada para o cliente (interessado ou construtora cadastrada).
// Sem preços: a proposta com valores fica para depois do teste.
import { esc } from './proposta-interessado.ts';

export function preencherApresentacao(modelo: string, d: { cliente: string; responsavel: string | null }, data: string): string {
  return modelo
    .replaceAll('{{cliente}}', esc(d.cliente))
    .replaceAll('{{responsavel}}', esc(d.responsavel ?? 'a informar'))
    .replaceAll('{{data}}', esc(data));
}
