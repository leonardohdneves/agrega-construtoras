// Engenheiro de obra: só enxerga as obras atribuídas a ele (obra_responsaveis) e os contratos e medições
// lançados no centro de custo dessas obras. Os demais perfis não têm essa restrição (retorno null = todas).
import type { Banco, Cliente } from '../db.ts';

type Quem = { id: string; perfil: string } | undefined;

export function ehEngenheiroDeObra(u: Quem): boolean {
  return u?.perfil === 'engenheiro_obra';
}

/** Perfis que só enxergam as obras atribuídas a eles pelo dono (obra_responsaveis): engenheiro de obra e almoxarife. */
export function ehRestritoAObras(u: Quem): boolean {
  return u?.perfil === 'engenheiro_obra' || u?.perfil === 'almoxarife';
}

/** Ids das obras atribuídas ao engenheiro de obra; null para quem vê todas. */
export async function obrasPermitidas(c: Cliente | Banco, empresaId: string, u: Quem): Promise<string[] | null> {
  if (!ehRestritoAObras(u)) return null;
  const r = await c.query(
    `SELECT r.obra_id FROM obra_responsaveis r JOIN obras o ON o.id = r.obra_id
      WHERE r.usuario_id = $1 AND o.empresa_id = $2 AND o.ativo`,
    [u!.id, empresaId],
  );
  return r.rows.map((x) => x.obra_id as string);
}

/** Centros de custo das obras do engenheiro de obra (contratos e medições); null para quem vê todos. */
export async function centrosPermitidos(c: Cliente | Banco, empresaId: string, u: Quem): Promise<string[] | null> {
  if (!ehRestritoAObras(u)) return null;
  const r = await c.query(
    `SELECT o.centro_custo_id FROM obra_responsaveis r JOIN obras o ON o.id = r.obra_id
      WHERE r.usuario_id = $1 AND o.empresa_id = $2 AND o.ativo`,
    [u!.id, empresaId],
  );
  return r.rows.map((x) => x.centro_custo_id as string);
}

export type RegraEngenharia = { tipo: 'lista' } | { tipo: 'consulta' } | { tipo: 'obra'; obraId: string } | { tipo: 'negado' };

/**
 * O que o engenheiro de obra pode fazer em cada endereço da Engenharia (caminho sem o prefixo /api/eng).
 * Lista de obras e panorama: filtrados na rota. Dentro de uma obra: tudo, se a obra for dele, menos alterar
 * o cadastro da obra (nome, BDI, responsáveis). Tabelas de referência: só consulta. Criar obra ou mexer nas
 * tabelas: não.
 */
export function regraEngenheiroEngenharia(metodo: string, caminho: string): RegraEngenharia {
  const get = metodo === 'GET';
  if (caminho === '/obras' || caminho === '/panorama') return get ? { tipo: 'lista' } : { tipo: 'negado' };
  const cadastro = /^\/obras\/([^/]+)\/?$/.exec(caminho);
  if (cadastro) return get ? { tipo: 'obra', obraId: cadastro[1] } : { tipo: 'negado' };
  const dentro = /^\/obras\/([^/]+)\/.+/.exec(caminho);
  if (dentro) return { tipo: 'obra', obraId: dentro[1] };
  if (caminho === '/tabelas' || caminho.startsWith('/tabelas/')) return get ? { tipo: 'consulta' } : { tipo: 'negado' };
  return { tipo: 'negado' };
}
