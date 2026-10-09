// Ligação dos itens de nota com os cadastros da empresa: insumos da usina (estoque) e
// catálogo de materiais e serviços. Sugere pelo que já foi ligado antes (aprendizado) e pela IA,
// e, ao confirmar a nota, cadastra no catálogo os itens marcados e aprende as ligações.
import type { Cliente } from '../db.ts';
import { fatorPadrao, sugerirInsumo } from './estoque.ts';
import { normalizar } from './sugestoes.ts';
import type { CadastrosIa } from './ia-nota.ts';

export type Vinculo = { insumoId: string | null; fator: number | null; catalogoId: string | null; origem: 'aprendido' | 'ia' | null };

type Mapa = { insumos: Map<string, { id: string; unidade: string }>; catalogo: Map<string, { id: string }> };

/** Listas enviadas à IA para ela indicar o cadastro de cada item (refs curtos). */
export async function cadastrosParaIa(c: Cliente, empresaId: string, entrada: boolean): Promise<{ ia: CadastrosIa; mapa: Mapa }> {
  const ins = entrada
    ? (await c.query("SELECT id, nome, unidade FROM insumos WHERE empresa_id = $1 AND ativo AND excluido_em IS NULL ORDER BY nome LIMIT 150", [empresaId])).rows
    : [];
  const cat = (
    await c.query('SELECT id, codigo, descricao, unidade, tipo FROM catalogo_itens WHERE empresa_id = $1 AND ativo ORDER BY descricao LIMIT 400', [empresaId])
  ).rows;
  const mapa: Mapa = { insumos: new Map(), catalogo: new Map() };
  const ia: CadastrosIa = { insumos: [], catalogo: [] };
  ins.forEach((x, k) => {
    const ref = `INS-${k + 1}`;
    mapa.insumos.set(ref, { id: x.id, unidade: x.unidade });
    ia.insumos.push({ ref, nome: x.nome, unidade: x.unidade });
  });
  for (const x of cat) {
    mapa.catalogo.set(String(x.codigo).toUpperCase(), { id: x.id });
    ia.catalogo.push({ ref: x.codigo, descricao: x.descricao, unidade: x.unidade, tipo: x.tipo });
  }
  return { ia, mapa };
}

async function catalogoAprendido(c: Cliente, empresaId: string, fornecedorId: string | null, descricao: string): Promise<string | null> {
  const texto = normalizar(descricao).slice(0, 80);
  if (!texto) return null;
  const r = (
    await c.query(
      `SELECT p.catalogo_id FROM catalogo_produtos p JOIN catalogo_itens ct ON ct.id = p.catalogo_id
        WHERE p.empresa_id = $1 AND p.texto = $2 AND ct.ativo
        ORDER BY (p.fornecedor_id IS NOT DISTINCT FROM $3::uuid) DESC, p.vezes DESC LIMIT 1`,
      [empresaId, texto, fornecedorId],
    )
  ).rows[0];
  return r ? (r.catalogo_id as string) : null;
}

/** Vínculo sugerido para um item: primeiro o aprendido, depois o indicado pela IA. */
export async function vinculoDoItem(
  c: Cliente,
  empresaId: string,
  entrada: boolean,
  fornecedorId: string | null,
  item: { descricao: string; unidade: string | null; ref?: string | null },
  mapa: Mapa | null,
): Promise<Vinculo> {
  if (entrada) {
    const ins = await sugerirInsumo(c, empresaId, fornecedorId, item.descricao, item.unidade);
    if (ins) return { insumoId: ins.insumoId, fator: ins.fator, catalogoId: null, origem: 'aprendido' };
  }
  const cat = await catalogoAprendido(c, empresaId, fornecedorId, item.descricao);
  if (cat) return { insumoId: null, fator: null, catalogoId: cat, origem: 'aprendido' };
  const ref = item.ref?.trim().toUpperCase();
  if (ref && mapa) {
    const i = mapa.insumos.get(ref);
    if (i && entrada) return { insumoId: i.id, fator: fatorPadrao(item.unidade, i.unidade), catalogoId: null, origem: 'ia' };
    const k = mapa.catalogo.get(ref);
    if (k) return { insumoId: null, fator: null, catalogoId: k.id, origem: 'ia' };
  }
  return { insumoId: null, fator: null, catalogoId: null, origem: null };
}

async function proximoCodigo(c: Cliente, empresaId: string, tipo: 'material' | 'servico') {
  const prefixo = tipo === 'material' ? 'M' : 'S';
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`catalogo:${empresaId}`]);
  const r = await c.query(`SELECT coalesce(max(substring(codigo FROM '^${prefixo}-(\\d+)$')::int), 0) + 1 AS n FROM catalogo_itens WHERE empresa_id = $1`, [empresaId]);
  return `${prefixo}-${String(r.rows[0].n).padStart(4, '0')}`;
}

/**
 * Ao confirmar a nota de compra: cadastra no catálogo os itens marcados, atualiza o último preço
 * dos itens ligados ao catálogo e aprende a ligação (fornecedor + texto do produto).
 */
export async function aplicarCatalogoNaConfirmacao(c: Cliente, empresaId: string, notaId: string): Promise<number> {
  const n = (await c.query('SELECT modelo, data_emissao, fornecedor_id, direcao FROM notas_fiscais WHERE id = $1', [notaId])).rows[0];
  if (!n || n.direcao !== 'entrada') return 0;
  const tipo: 'material' | 'servico' = n.modelo === 'nfse' ? 'servico' : 'material';
  const itens = (await c.query('SELECT * FROM notas_itens WHERE nota_id = $1 AND insumo_id IS NULL AND (catalogo_id IS NOT NULL OR cadastrar_catalogo)', [notaId])).rows;
  let novos = 0;
  for (const i of itens) {
    let catalogoId = i.catalogo_id as string | null;
    if (!catalogoId) {
      const descricao = String(i.descricao).replace(/\s+/g, ' ').trim().slice(0, 200);
      const ja = (await c.query('SELECT id FROM catalogo_itens WHERE empresa_id = $1 AND tipo = $2 AND lower(descricao) = lower($3)', [empresaId, tipo, descricao])).rows[0];
      if (ja) catalogoId = ja.id;
      else {
        const codigo = await proximoCodigo(c, empresaId, tipo);
        const unidade = String(i.unidade ?? '').trim().slice(0, 10) || (tipo === 'servico' ? 'sv' : 'un');
        catalogoId = (
          await c.query(
            'INSERT INTO catalogo_itens (empresa_id, tipo, codigo, descricao, unidade, plano_conta_id, observacao) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
            [empresaId, tipo, codigo, descricao, unidade, i.plano_conta_id, 'Cadastrado a partir de nota fiscal'],
          )
        ).rows[0].id;
        novos++;
      }
      await c.query('UPDATE notas_itens SET catalogo_id = $2, cadastrar_catalogo = false WHERE id = $1', [i.id, catalogoId]);
    }
    const qtd = Number(i.quantidade) || 1;
    await c.query(
      `UPDATE catalogo_itens SET ultimo_preco_centavos = round($2::numeric, 4), ultimo_preco_em = $3, ultimo_fornecedor_id = $4, atualizado_em = now()
        WHERE id = $1 AND (ultimo_preco_em IS NULL OR ultimo_preco_em <= $3)`,
      [catalogoId, Number(i.valor_produto_centavos) / qtd, n.data_emissao, n.fornecedor_id],
    );
    const texto = normalizar(i.descricao).slice(0, 80);
    if (texto)
      await c.query(
        `INSERT INTO catalogo_produtos (empresa_id, fornecedor_id, texto, catalogo_id) VALUES ($1,$2,$3,$4)
         ON CONFLICT (empresa_id, coalesce(fornecedor_id, '00000000-0000-0000-0000-000000000000'::uuid), texto)
         DO UPDATE SET catalogo_id = excluded.catalogo_id, vezes = catalogo_produtos.vezes + 1, atualizado_em = now()`,
        [empresaId, n.fornecedor_id, texto, catalogoId],
      );
  }
  return novos;
}
