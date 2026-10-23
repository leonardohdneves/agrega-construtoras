// Estoque de insumos: entradas pelas notas de compra, consumo teórico das cargas e acerto por inventário.
import type { Cliente } from '../db.ts';
import { normalizar } from './sugestoes.ts';
import { ErroHttp } from './erros.ts';
import { fatorEntrada } from './unidades-insumo.ts';

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
  await atualizarCustos(c, r.rows.filter((x) => x.insumo_id).map((x) => x.insumo_id));
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

/**
 * Confere a apropriação de um item da nota: o insumo da obra precisa ser da obra escolhida,
 * e a etapa precisa ser um nó da EAP dessa mesma obra.
 */
export async function validarApropriacaoObra(c: Cliente, empresaId: string, obraId: string | null, obraItemId: string | null, eapNoId: string | null): Promise<void> {
  if (obraId) {
    const o = (await c.query('SELECT 1 FROM obras WHERE id = $1 AND empresa_id = $2', [obraId, empresaId])).rows[0];
    if (!o) throw new ErroHttp(400, 'Obra não encontrada.');
  }
  if (obraItemId) {
    const oi = (await c.query(
      `SELECT oi.obra_id FROM obra_itens oi JOIN obras o ON o.id = oi.obra_id
        WHERE oi.id = $1 AND o.empresa_id = $2 AND oi.tipo = 'insumo'`,
      [obraItemId, empresaId],
    )).rows[0];
    if (!oi) throw new ErroHttp(400, 'Insumo da obra não encontrado.');
    if (obraId && oi.obra_id !== obraId) throw new ErroHttp(400, 'O insumo escolhido não é desta obra.');
  }
  if (eapNoId) {
    const e = (await c.query(
      `SELECT e.obra_id FROM eap_nos e JOIN obras o ON o.id = e.obra_id WHERE e.id = $1 AND o.empresa_id = $2`,
      [eapNoId, empresaId],
    )).rows[0];
    if (!e) throw new ErroHttp(400, 'Etapa da EAP não encontrada.');
    if (obraId && e.obra_id !== obraId) throw new ErroHttp(400, 'A etapa escolhida não é desta obra.');
  }
}

/** Próximo código de estoque da empresa (EST-0001, EST-0002…). */
export async function proximoCodigoEstoque(c: Cliente, empresaId: string): Promise<string> {
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`estoques:${empresaId}`]);
  const r = await c.query(`SELECT 'EST-' || lpad((coalesce(max(substring(codigo FROM '^EST-([0-9]+)$')::int), 0) + 1)::text, 4, '0') AS codigo FROM obra_estoques WHERE empresa_id = $1`, [empresaId]);
  return r.rows[0].codigo as string;
}

/** Estoque de recebimento da obra: toda obra tem um (criado se faltar). É o padrão de entrada das notas. */
export async function estoqueRecebimento(c: Cliente, empresaId: string, obraId: string): Promise<string> {
  const ex = (await c.query('SELECT id FROM obra_estoques WHERE obra_id = $1 AND recebimento', [obraId])).rows[0];
  if (ex) return ex.id as string;
  const codigo = await proximoCodigoEstoque(c, empresaId);
  const novo = (
    await c.query(`INSERT INTO obra_estoques (empresa_id, obra_id, nome, recebimento, codigo) VALUES ($1,$2,'Recebimento',true,$3) RETURNING id`, [empresaId, obraId, codigo])
  ).rows[0];
  return novo.id as string;
}

/**
 * Entradas da construtora: cada item da nota com obra, insumo da obra e etapa vira entrada na apropriação.
 * Quando a nota veio de um pedido, a apropriação é a do item do pedido (que veio da solicitação).
 * Item sem apropriação completa fica fora do estoque (não é erro para o lançamento).
 */
export async function registrarEntradasObra(c: Cliente, empresaId: string, notaId: string, usuarioId: string | null): Promise<number> {
  const n = (await c.query('SELECT data_emissao, numero FROM notas_fiscais WHERE id = $1', [notaId])).rows[0];
  const itens = (
    await c.query(
      `SELECT i.id, i.obra_estoque_id, i.quantidade, i.valor_custo_centavos, i.unidade,
              coalesce(i.obra_id, o.obra_id) AS obra_id,
              coalesce(i.obra_item_id, pi.obra_item_id) AS obra_item_id,
              coalesce(i.eap_no_id, pi.eap_no_id) AS eap_no_id,
              ob.unidade AS unidade_base,
              (SELECT u.fator FROM obra_insumo_unidades u
                 WHERE u.obra_item_id = coalesce(i.obra_item_id, pi.obra_item_id) AND lower(u.unidade) = lower(i.unidade)) AS fator_compra
         FROM notas_itens i
         LEFT JOIN pedidos_itens pi ON pi.id = i.pedido_item_id
         LEFT JOIN obra_itens o ON o.id = pi.obra_item_id
         LEFT JOIN obra_itens ob ON ob.id = coalesce(i.obra_item_id, pi.obra_item_id)
        WHERE i.nota_id = $1`,
      [notaId],
    )
  ).rows;
  let feitas = 0;
  const recebimentos = new Map<string, string>();
  for (const i of itens) {
    const qtd = Number(i.quantidade);
    if (!i.obra_item_id || !i.eap_no_id || !i.obra_id || !(qtd > 0)) continue;
    // Destino: o estoque escolhido no item; sem escolha, o recebimento da obra.
    let destino: string = i.obra_estoque_id ?? '';
    if (!destino) {
      if (!recebimentos.has(i.obra_id)) recebimentos.set(i.obra_id, await estoqueRecebimento(c, empresaId, i.obra_id));
      destino = recebimentos.get(i.obra_id)!;
    }
    // A nota vem na unidade de compra; o estoque é mantido na unidade base do orçamento (ex.: kg).
    const fator = fatorEntrada(i.unidade, i.unidade_base ?? '', i.fator_compra === null ? null : Number(i.fator_compra));
    const qtdBase = qtd * fator;
    await c.query(
      `INSERT INTO estoque_movimentos (empresa_id, obra_id, obra_estoque_id, obra_item_id, eap_no_id, data, tipo, quantidade, custo_unitario_centavos, nota_item_id, observacao, criado_por_id)
       VALUES ($1,$2,$3,$4,$5,$6,'entrada',$7,$8,$9,$10,$11)`,
      [empresaId, i.obra_id, destino, i.obra_item_id, i.eap_no_id, n.data_emissao, Math.round(qtdBase * 1000) / 1000, Number(i.valor_custo_centavos) / qtdBase, i.id, `NF ${n.numero ?? 's/n'}`, usuarioId],
    );
    feitas++;
  }
  return feitas;
}

/**
 * Entradas de um lançamento de despesa: cada item de estoque vira entrada na apropriação (obra, insumo da obra, etapa, estoque).
 * A quantidade é informada na unidade do item; o estoque fica na unidade base do insumo da obra, como nas notas.
 */
export async function registrarEntradasLancamento(c: Cliente, empresaId: string, lancamentoId: string, data: string, usuarioId: string | null): Promise<number> {
  const itens = (
    await c.query(
      `SELECT li.*, ob.unidade AS unidade_base,
              (SELECT u.fator FROM obra_insumo_unidades u WHERE u.obra_item_id = li.obra_item_id AND lower(u.unidade) = lower(li.unidade)) AS fator_compra
         FROM lancamento_itens_estoque li JOIN obra_itens ob ON ob.id = li.obra_item_id
        WHERE li.lancamento_id = $1 AND li.empresa_id = $2`,
      [lancamentoId, empresaId],
    )
  ).rows;
  const recebimentos = new Map<string, string>();
  for (const i of itens) {
    const qtd = Number(i.quantidade);
    let destino: string = i.obra_estoque_id ?? '';
    if (!destino) {
      if (!recebimentos.has(i.obra_id)) recebimentos.set(i.obra_id, await estoqueRecebimento(c, empresaId, i.obra_id));
      destino = recebimentos.get(i.obra_id)!;
    }
    const fator = fatorEntrada(i.unidade ?? '', i.unidade_base ?? '', i.fator_compra === null ? null : Number(i.fator_compra));
    const qtdBase = qtd * fator;
    await c.query(
      `INSERT INTO estoque_movimentos (empresa_id, obra_id, obra_estoque_id, obra_item_id, eap_no_id, data, tipo, quantidade, custo_unitario_centavos, lancamento_item_id, observacao, criado_por_id)
       VALUES ($1,$2,$3,$4,$5,$6,'entrada',$7,$8,$9,$10,$11)`,
      [empresaId, i.obra_id, destino, i.obra_item_id, i.eap_no_id, data, Math.round(qtdBase * 1000) / 1000, Number(i.valor_centavos) / qtdBase, i.id, 'Lançamento financeiro', usuarioId],
    );
  }
  return itens.length;
}

/** Ao cancelar o lançamento: tira as entradas dele do estoque. */
export async function removerEntradasLancamento(c: Cliente, lancamentoId: string): Promise<void> {
  await c.query('DELETE FROM estoque_movimentos WHERE lancamento_item_id IN (SELECT id FROM lancamento_itens_estoque WHERE lancamento_id = $1)', [lancamentoId]);
}

/** Saldo de uma apropriação (insumo da obra + etapa) = entradas e ajustes menos saídas. */
export async function saldoApropriacao(c: Cliente, empresaId: string, obraId: string, obraItemId: string, eapNoId: string, estoqueId: string): Promise<number> {
  const r = await c.query(
    `SELECT coalesce(sum(CASE WHEN tipo = 'saida' THEN -quantidade ELSE quantidade END), 0) AS saldo
       FROM estoque_movimentos WHERE empresa_id = $1 AND obra_id = $2 AND obra_item_id = $3 AND eap_no_id = $4 AND obra_estoque_id = $5`,
    [empresaId, obraId, obraItemId, eapNoId, estoqueId],
  );
  return Number(r.rows[0].saldo);
}

/** Estoque de uma movimentação da obra: o escolhido (ativo nesta obra) ou o de recebimento quando não há escolha. */
export async function estoqueDaMovimentacao(c: Cliente, empresaId: string, obraId: string, estoqueId: string | null): Promise<string> {
  if (!estoqueId) return estoqueRecebimento(c, empresaId, obraId);
  const ok = (await c.query('SELECT 1 FROM obra_estoques WHERE id = $1 AND obra_id = $2 AND ativo', [estoqueId, obraId])).rowCount;
  if (!ok) throw new ErroHttp(400, 'Estoque não encontrado nesta obra ou inativo.');
  return estoqueId;
}
