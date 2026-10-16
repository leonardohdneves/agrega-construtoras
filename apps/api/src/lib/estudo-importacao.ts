// Incorporação · importação do estudo aprovado do Viabiliza. O Viabiliza é a fonte de estrutura, nomes e valores;
// o Agrega guarda o estado de venda (disponível, reservada, vendida). Só estudos aprovados são exportados.
import { z } from 'zod';
import { ErroHttp } from './erros.ts';

export const esquemaEstudo = z.object({
  schemaVersion: z.literal(1),
  empreendimento: z.object({
    id: z.string().min(1),
    nome: z.string().min(1).max(200),
    cidade: z.string().max(120).nullable(),
    uf: z.string().length(2).nullable(),
  }),
  versaoEstudo: z.string().min(1).max(80),
  aprovadoEm: z.string().min(4),
  unidades: z
    .array(
      z.object({
        codigoExterno: z.string().min(1).max(120),
        nome: z.string().min(1).max(120),
        numero: z.number().int().nullable(),
        andar: z.number().int().nullable(),
        tipologia: z.string().max(120),
        areaPrivativa: z.number().nonnegative(),
        preco: z.number().nonnegative(),
        permuta: z.boolean(),
      }),
    )
    .max(5000),
});
export type EstudoExportado = z.infer<typeof esquemaEstudo>;
export type UnidadeExportada = EstudoExportado['unidades'][number];

export type SituacaoUnidade = 'disponivel' | 'reservada' | 'vendida' | 'permuta' | 'removida_do_estudo';
export interface UnidadeExistente {
  codigoExterno: string;
  nome: string;
  preco: number;
  situacao: SituacaoUnidade;
}

export interface PlanoImportacao {
  criar: UnidadeExportada[];
  atualizar: { codigoExterno: string; nome: string; preco: number; situacao: SituacaoUnidade }[];
  /** Unidades com venda cujo preço no estudo mudou: o preço do contrato é mantido e a diferença é mostrada. */
  divergencias: { codigoExterno: string; motivo: 'preco' | 'removida' | 'permuta'; precoContrato: number | null; precoEstudo: number | null }[];
  /** Unidades disponíveis que saíram do estudo: ficam marcadas, sem apagar histórico. */
  removidas: string[];
  totais: { recebidas: number; criar: number; atualizar: number; divergencias: number; removidas: number };
}

const vendida = (s: SituacaoUnidade) => s === 'reservada' || s === 'vendida';

/** Compara o estudo recebido com as unidades já importadas e diz o que mudar. Não grava nada. */
export function planejarImportacao(existentes: UnidadeExistente[], recebidas: UnidadeExportada[]): PlanoImportacao {
  const vistos = new Set<string>();
  for (const u of recebidas) {
    if (vistos.has(u.codigoExterno)) throw new ErroHttp(422, `Unidade repetida no estudo: ${u.codigoExterno}.`);
    vistos.add(u.codigoExterno);
  }
  const porCodigo = new Map(existentes.map((u) => [u.codigoExterno, u]));
  const plano: PlanoImportacao = { criar: [], atualizar: [], divergencias: [], removidas: [], totais: { recebidas: recebidas.length, criar: 0, atualizar: 0, divergencias: 0, removidas: 0 } };

  for (const r of recebidas) {
    const atual = porCodigo.get(r.codigoExterno);
    const situacaoEstudo: SituacaoUnidade = r.permuta ? 'permuta' : 'disponivel';
    if (!atual) {
      plano.criar.push(r);
      continue;
    }
    if (vendida(atual.situacao)) {
      // Venda em andamento: o preço e a permuta ficam travados. Só o nome pode acompanhar o estudo.
      if (Math.abs(atual.preco - r.preco) > 0.005) plano.divergencias.push({ codigoExterno: r.codigoExterno, motivo: 'preco', precoContrato: atual.preco, precoEstudo: r.preco });
      if (situacaoEstudo === 'permuta' && atual.situacao !== 'permuta') plano.divergencias.push({ codigoExterno: r.codigoExterno, motivo: 'permuta', precoContrato: atual.preco, precoEstudo: r.preco });
      if (atual.nome !== r.nome) plano.atualizar.push({ codigoExterno: r.codigoExterno, nome: r.nome, preco: atual.preco, situacao: atual.situacao });
      continue;
    }
    if (atual.situacao === 'removida_do_estudo') {
      // Voltou ao estudo: reativa como disponível (ou permuta) com os dados novos.
      plano.atualizar.push({ codigoExterno: r.codigoExterno, nome: r.nome, preco: r.preco, situacao: situacaoEstudo });
      continue;
    }
    const mudou = atual.nome !== r.nome || Math.abs(atual.preco - r.preco) > 0.005 || atual.situacao !== situacaoEstudo;
    if (mudou) plano.atualizar.push({ codigoExterno: r.codigoExterno, nome: r.nome, preco: r.preco, situacao: situacaoEstudo });
  }

  for (const u of existentes) {
    if (vistos.has(u.codigoExterno) || u.situacao === 'removida_do_estudo') continue;
    if (vendida(u.situacao)) plano.divergencias.push({ codigoExterno: u.codigoExterno, motivo: 'removida', precoContrato: u.preco, precoEstudo: null });
    else plano.removidas.push(u.codigoExterno);
  }

  plano.totais = { recebidas: recebidas.length, criar: plano.criar.length, atualizar: plano.atualizar.length, divergencias: plano.divergencias.length, removidas: plano.removidas.length };
  return plano;
}

/** Cliente do Viabiliza: entra com o mesmo e-mail e senha e lê só estudos aprovados. A senha não é guardada. */
export async function entrarViabiliza(base: string, email: string, senha: string, buscar: typeof fetch = fetch): Promise<string> {
  const r = await buscar(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, senha }),
  });
  if (r.status === 401) throw new ErroHttp(401, 'E-mail ou senha do Viabiliza incorretos.');
  if (!r.ok) throw new ErroHttp(502, 'Não foi possível entrar no Viabiliza agora.');
  const dados = (await r.json()) as { token?: unknown };
  if (typeof dados.token !== 'string') throw new ErroHttp(502, 'Resposta inesperada do Viabiliza.');
  return dados.token;
}

export async function buscarEstudoAprovado(base: string, token: string, id: string, buscar: typeof fetch = fetch): Promise<EstudoExportado> {
  const r = await buscar(`${base}/api/exportacao/empreendimentos/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${token}` } });
  if (r.status === 401 || r.status === 403) throw new ErroHttp(403, 'Este usuário do Viabiliza não pode exportar estudos (perfil incorporador).');
  if (r.status === 409) throw new ErroHttp(409, 'Só é possível importar estudos com status aprovado.');
  if (r.status === 404) throw new ErroHttp(404, 'Estudo não encontrado no Viabiliza.');
  if (!r.ok) throw new ErroHttp(502, 'Não foi possível ler o estudo no Viabiliza.');
  const parsed = esquemaEstudo.safeParse(await r.json());
  if (!parsed.success) throw new ErroHttp(502, 'O estudo recebido veio em formato que o Agrega não reconhece.', { erros: parsed.error.issues.map((i) => i.message) });
  return parsed.data;
}
