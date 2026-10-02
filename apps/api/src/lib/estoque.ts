// Estoque de insumos: entradas pelas notas de compra, consumo teórico das cargas e acerto por inventário.
import type { Cliente } from '../db.ts';
import { normalizar } from './sugestoes.ts';

/** Saldo de cada insumo ao fim do dia `ate` (entradas e acertos menos o consumo das cargas). */
export const SQL_SALDOS = `
  SELECT i.id AS insumo_id,
         coalesce((SELECT sum(m.quantidade) FROM estoque_movimentos m WHERE m.insumo_id = i.id AND m.data <= $2::date), 0)
       - coalesce((SELECT sum(cc.quantidade) FROM cargas_consumo cc JOIN cargas c ON c.id = cc.carga_id
                    WHERE cc.insumo_id = i.id AND c.status = 'produzida'
                      AND (c.data_hora AT TIME ZONE 'America/Sao_Paulo')::date <= $2::date), 0) AS saldo
    FROM insumos i WHERE i.empresa_id = $1 AND i.excluido_em IS NULL`;

export async function saldosEm(c: Cliente, empresaId: string, ate: string): Promise<Map<string, number>> {
  const r = await c.query(SQL_SALDOS, [empresaId, ate]);
  return new Map(r.rows.map((x) => [x.insumo_id as string, Number(x.saldo)]));
}

/** Grava (ou refaz) o consumo teórico de uma carga pelo traço e o custo atual de cada insumo. */
export async function gravarConsumoCarga(c: Cliente, cargaId: string): Promise<void> {
  await c.query('DELETE FROM cargas_consumo WHERE carga_id = $1', [cargaId]);
  await c.query(
    `INSERT INTO cargas_consumo (empresa_id, carga_id, insumo_id, quantidade, custo_unitario_centavos)
     SELECT c.empresa_id, c.id, ti.insumo_id, round(ti.quantidade * c.volume_m3, 3), i.custo_unitario_centavos
       FROM cargas c JOIN tracos_itens ti ON ti.traco_id = c.traco_id JOIN insumos i ON i.id = ti.insumo_id
      WHERE c.id = $1 AND c.status = 'produzida'`,
    [cargaId],
  );
}

/**
 * Custo do insumo pelas notas: média ponderada das entradas dos 90 dias até a última entrada.
 * Sem entradas, o custo digitado no cadastro continua valendo.
 */
export async function atualizarCustos(c: Cliente, insumoIds: string[]): Promise<void> {
  for (const id of new Set(insumoIds)) {
    const r = (
      await c.query(
        `WITH u AS (SELECT max(data) AS d FROM estoque_movimentos WHERE insumo_id = $1 AND tipo = 'entrada' AND custo_unitario_centavos IS NOT NULL)
         SELECT sum(m.quantidade * m.custo_unitario_centavos) / nullif(sum(m.quantidade), 0) AS custo
           FROM estoque_movimentos m, u
          WHERE m.insumo_id = $1 AND m.tipo = 'entrada' AND m.custo_unitario_centavos IS NOT NULL AND m.quantidade > 0 AND m.data > u.d - 90`,
        [id],
      )
    ).rows[0];
    if (r?.custo === null || r?.custo === undefined) {
      await c.query(`UPDATE insumos SET custo_origem = CASE WHEN custo_origem = 'notas' THEN 'cadastro' ELSE custo_origem END WHERE id = $1`, [id]);
      continue;
    }
    await c.query(`UPDATE insumos SET custo_unitario_centavos = round($2::numeric, 4), custo_origem = 'notas', custo_atualizado_em = now(), atualizado_em = now() WHERE id = $1`, [
      id,
      r.custo,
    ]);
  }
}

/** Ao confirmar a nota: cada item ligado a um insumo vira entrada no estoque, e o sistema aprende a ligação. */
export async function registrarEntradasNota(c: Cliente, empresaId: string, notaId: string, usuarioId: string | null): Promise<number> {
  const n = (await c.query('SELECT data_emissao, fornecedor_id, numero FROM notas_fiscais WHERE id = $1', [notaId])).rows[0];
  const itens = (
    await c.query(
      `SELECT i.* FROM notas_itens i JOIN insumos s ON s.id = i.insumo_id
        WHERE i.nota_id = $1 AND i.insumo_id IS NOT NULL AND i.fator_estoque > 0 AND i.quantidade > 0 AND s.controla_estoque`,
      [notaId],
    )
  ).rows;
  for (const i of itens) {
    const qtd = Number(i.quantidade) * Number(i.fator_estoque);
    await c.query(
      `INSERT INTO estoque_movimentos (empresa_id, insumo_id, data, tipo, quantidade, custo_unitario_centavos, nota_item_id, observacao, criado_por_id)
       VALUES ($1,$2,$3,'entrada',$4,$5,$6,$7,$8)`,
      [empresaId, i.insumo_id, n.data_emissao, Math.round(qtd * 1000) / 1000, Number(i.valor_custo_centavos) / qtd, i.id, `NF ${n.numero ?? 's/n'}`, usuarioId],
    );
    const texto = normalizar(i.descricao).slice(0, 80);
    if (texto) {
      await c.query(
        `INSERT INTO insumos_produtos (empresa_id, fornecedor_id, texto, insumo_id, fator) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (empresa_id, coalesce(fornecedor_id, '00000000-0000-0000-0000-000000000000'::uuid), texto)
         DO UPDATE SET insumo_id = excluded.insumo_id, fator = excluded.fator, vezes = insumos_produtos.vezes + 1, atualizado_em = now()`,
        [empresaId, n.fornecedor_id, texto, i.insumo_id, i.fator_estoque],
      );
    }
  }
  await atualizarCustos(c, itens.map((i) => i.insumo_id));
  return itens.length;
}

/** Ao reabrir ou cancelar a nota: tira as entradas dela do estoque. */
export async function removerEntradasNota(c: Cliente, notaId: string): Promise<void> {
  const r = await c.query(
    'DELETE FROM estoque_movimentos WHERE nota_item_id IN (SELECT id FROM notas_itens WHERE nota_id = $1) RETURNING insumo_id',
    [notaId],
  );
  await atualizarCustos(c, r.rows.map((x) => x.insumo_id));
}

/** Sugestão de insumo para um item de nota: o que já foi ligado antes para este fornecedor e produto. */
export async function sugerirInsumo(c: Cliente, empresaId: string, fornecedorId: string | null, descricao: string, unidade: string | null) {
  const texto = normalizar(descricao).slice(0, 80);
  if (!texto) return null;
  const r = (
    await c.query(
      `SELECT p.insumo_id, p.fator FROM insumos_produtos p JOIN insumos i ON i.id = p.insumo_id
        WHERE p.empresa_id = $1 AND p.texto = $2 AND i.ativo AND i.excluido_em IS NULL
        ORDER BY (p.fornecedor_id IS NOT DISTINCT FROM $3::uuid) DESC, p.vezes DESC LIMIT 1`,
      [empresaId, texto, fornecedorId],
    )
  ).rows[0];
  if (r) return { insumoId: r.insumo_id as string, fator: Number(r.fator) };
  void unidade;
  return null;
}

/** Fator sugerido entre a unidade da nota e a do insumo (ex.: T → kg = 1000). */
export function fatorPadrao(unidadeNota: string | null, unidadeInsumo: string): number | null {
  const u = (unidadeNota ?? '').trim().toUpperCase();
  if (unidadeInsumo === 'kg') {
    if (['T', 'TON', 'TN', 'TONELADA'].includes(u)) return 1000;
    if (['KG', 'KGS', 'QUILO'].includes(u)) return 1;
    if (['SC', 'SACO'].includes(u)) return 50;
  }
  if (unidadeInsumo === 't' && ['KG', 'KGS'].includes(u)) return 0.001;
  if (unidadeInsumo === 't' && ['T', 'TON', 'TN'].includes(u)) return 1;
  if (unidadeInsumo === 'L' && ['L', 'LT', 'LTS', 'LITRO'].includes(u)) return 1;
  if (unidadeInsumo === 'm3' && ['M3', 'M³'].includes(u)) return 1;
  if (unidadeInsumo === 'un' && ['UN', 'UND', 'PC'].includes(u)) return 1;
  return null;
}
