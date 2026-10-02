// Produção: estoque de insumos, inventários e relatórios da produção.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Banco } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';
import { hojeBrasil } from '../lib/frota.ts';
import { somarDias } from '../lib/financeiro.ts';
import { saldosEm, SQL_SALDOS } from '../lib/estoque.ts';
import { empresaDo, exigir } from '../sessao.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const DIA = (col: string) => `(${col} AT TIME ZONE 'America/Sao_Paulo')::date`;
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** Quantidade do insumo em kg de cimento (para o indicador kg/m³). */
const KG = (unidade: string, q: number) => (unidade === 't' ? q * 1000 : q);

function periodoDias(q: Record<string, string | undefined>) {
  const hoje = hojeBrasil();
  const de = q.de && DATA.test(q.de) ? q.de : `${hoje.slice(0, 7)}-01`;
  const ate = q.ate && DATA.test(q.ate) ? q.ate : hoje;
  if (ate < de) throw new ErroHttp(400, 'A data final é antes da inicial.');
  if (Date.parse(ate) - Date.parse(de) > 400 * 86_400_000) throw new ErroHttp(400, 'Escolha um período de até 13 meses.');
  return { de, ate, hoje };
}

export function rotasEstoque(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.addHook('preHandler', exigir(banco, 'dono', 'gestor'));

    // ======================= Posição do estoque =======================
    app.get('/estoque', async (req) => {
      const empresaId = empresaDo(req);
      const hoje = hojeBrasil();
      const r = await banco.query(
        `WITH s AS (${SQL_SALDOS})
         SELECT i.*, s.saldo,
                coalesce((SELECT sum(cc.quantidade) FROM cargas_consumo cc JOIN cargas c ON c.id = cc.carga_id
                           WHERE cc.insumo_id = i.id AND c.status = 'produzida' AND ${DIA('c.data_hora')} > $2::date - 30 AND ${DIA('c.data_hora')} <= $2::date), 0) AS consumo30,
                (SELECT max(data) FROM estoque_movimentos m WHERE m.insumo_id = i.id AND m.tipo = 'entrada') AS ultima_entrada,
                (SELECT json_build_object('data', v.data, 'diferenca', ii.diferenca, 'consumo', ii.consumo_periodo)
                   FROM inventarios_itens ii JOIN inventarios v ON v.id = ii.inventario_id WHERE ii.insumo_id = i.id ORDER BY v.data DESC LIMIT 1) AS inventario
           FROM insumos i JOIN s ON s.insumo_id = i.id
          WHERE i.empresa_id = $1 AND i.excluido_em IS NULL AND i.ativo AND i.controla_estoque
          ORDER BY array_position(ARRAY['cimento','areia','brita','aditivo','fibra','outro','agua'], i.tipo), i.nome`,
        [empresaId, hoje],
      );
      const insumos = r.rows.map((x) => {
        const saldo = Number(x.saldo);
        const consumoDia = Number(x.consumo30) / 30;
        const minimo = n(x.estoque_minimo);
        const custo = x.custo_unitario_centavos === null ? null : Number(x.custo_unitario_centavos) / 100;
        const inv = x.inventario;
        return {
          id: x.id,
          nome: x.nome,
          tipo: x.tipo,
          unidade: x.unidade,
          saldo: r3(saldo),
          estoqueMinimo: minimo,
          consumoDia: r3(consumoDia),
          diasCobertura: consumoDia > 0 && saldo > 0 ? Math.floor(saldo / consumoDia) : null,
          situacao: saldo < 0 ? 'negativo' : minimo !== null && saldo < minimo ? 'abaixo' : 'ok',
          custoUnitario: custo === null ? null : Number(custo.toFixed(6)),
          custoOrigem: x.custo_origem,
          valor: custo === null ? null : r2(Math.max(saldo, 0) * custo),
          ultimaEntrada: x.ultima_entrada,
          ultimoInventario: inv ? { data: inv.data, diferenca: Number(inv.diferenca), perda: inv.consumo ? -Number(inv.diferenca) / Number(inv.consumo) : null } : null,
        };
      });
      return { hoje, insumos, valorTotal: r2(insumos.reduce((s, i) => s + (i.valor ?? 0), 0)) };
    });

    app.get<{ Params: { id: string }; Querystring: Record<string, string | undefined> }>('/estoque/:id/extrato', async (req) => {
      const empresaId = empresaDo(req);
      if (!UUID.test(req.params.id)) throw naoEncontrado('Insumo');
      const ins = (await banco.query('SELECT * FROM insumos WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL', [req.params.id, empresaId])).rows[0];
      if (!ins) throw naoEncontrado('Insumo');
      const { de, ate } = periodoDias(req.query);
      const inicial = (await saldosEm(banco, empresaId, somarDias(de, -1))).get(ins.id) ?? 0;
      const movs = (
        await banco.query(
          `SELECT m.data, m.tipo, m.quantidade, m.custo_unitario_centavos, m.observacao, nf.numero AS nota_numero, nf.id AS nota_id,
                  coalesce(f.nome_fantasia, f.razao_social) AS fornecedor
             FROM estoque_movimentos m LEFT JOIN notas_itens ni ON ni.id = m.nota_item_id LEFT JOIN notas_fiscais nf ON nf.id = ni.nota_id
             LEFT JOIN fornecedores f ON f.id = nf.fornecedor_id
            WHERE m.insumo_id = $1 AND m.data BETWEEN $2 AND $3
           UNION ALL
           SELECT ${DIA('c.data_hora')}, 'consumo', -sum(cc.quantidade), NULL, count(*)::text || ' cargas', NULL, NULL, NULL
             FROM cargas_consumo cc JOIN cargas c ON c.id = cc.carga_id
            WHERE cc.insumo_id = $1 AND c.status = 'produzida' AND ${DIA('c.data_hora')} BETWEEN $2 AND $3
            GROUP BY 1
            ORDER BY 1, 2 DESC`,
          [ins.id, de, ate],
        )
      ).rows;
      let saldo = inicial;
      const linhas = movs.map((m) => {
        saldo += Number(m.quantidade);
        return {
          data: m.data,
          tipo: m.tipo as 'entrada' | 'ajuste' | 'consumo',
          quantidade: r3(Number(m.quantidade)),
          custoUnitario: m.custo_unitario_centavos === null ? null : Number((Number(m.custo_unitario_centavos) / 100).toFixed(6)),
          descricao: m.tipo === 'entrada' ? `NF ${m.nota_numero ?? ''} · ${m.fornecedor ?? ''}`.trim() : m.tipo === 'ajuste' ? 'Acerto do inventário' : `Consumo de ${m.observacao}`,
          notaId: m.nota_id,
          saldo: r3(saldo),
        };
      });
      return { insumo: { id: ins.id, nome: ins.nome, unidade: ins.unidade }, de, ate, saldoInicial: r3(inicial), saldoFinal: r3(saldo), linhas };
    });

    // ======================= Inventários =======================
    app.get('/inventarios', async (req) => {
      const empresaId = empresaDo(req);
      const r = await banco.query(
        `SELECT v.*, u.nome AS criado_por,
                (SELECT json_agg(json_build_object('nome', i.nome, 'unidade', i.unidade, 'teorico', ii.saldo_teorico, 'contado', ii.contado, 'diferenca', ii.diferenca,
                                                   'consumo', ii.consumo_periodo, 'custo', ii.custo_unitario_centavos) ORDER BY i.tipo, i.nome)
                   FROM inventarios_itens ii JOIN insumos i ON i.id = ii.insumo_id WHERE ii.inventario_id = v.id) AS itens
           FROM inventarios v LEFT JOIN usuarios u ON u.id = v.criado_por_id
          WHERE v.empresa_id = $1 ORDER BY v.data DESC, v.criado_em DESC LIMIT 60`,
        [empresaId],
      );
      return {
        inventarios: r.rows.map((v, k) => {
          const itens = (v.itens ?? []).map((i: Record<string, any>) => ({
            nome: i.nome,
            unidade: i.unidade,
            teorico: Number(i.teorico),
            contado: Number(i.contado),
            diferenca: Number(i.diferenca),
            consumo: n(i.consumo),
            perda: i.consumo ? -Number(i.diferenca) / Number(i.consumo) : null,
            valor: i.custo === null ? null : r2((Number(i.diferenca) * Number(i.custo)) / 100),
          }));
          return {
            id: v.id,
            data: v.data,
            observacao: v.observacao,
            criadoPor: v.criado_por,
            ultimo: k === 0,
            itens,
            valorDiferenca: r2(itens.reduce((s: number, i: { valor: number | null }) => s + (i.valor ?? 0), 0)),
          };
        }),
      };
    });

    /** Insumos com o saldo teórico na data, para preencher a contagem. */
    app.get<{ Querystring: { data?: string } }>('/inventarios/previa', async (req) => {
      const empresaId = empresaDo(req);
      const data = req.query.data && DATA.test(req.query.data) ? req.query.data : hojeBrasil();
      const saldos = await saldosEm(banco, empresaId, data);
      const ultimo = (await banco.query('SELECT max(data) AS d FROM inventarios WHERE empresa_id = $1', [empresaId])).rows[0]?.d ?? null;
      const ins = (
        await banco.query(
          `SELECT id, nome, tipo, unidade FROM insumos WHERE empresa_id = $1 AND excluido_em IS NULL AND ativo AND controla_estoque
            ORDER BY array_position(ARRAY['cimento','areia','brita','aditivo','fibra','outro','agua'], tipo), nome`,
          [empresaId],
        )
      ).rows;
      return { data, ultimo, itens: ins.map((i) => ({ insumoId: i.id, nome: i.nome, tipo: i.tipo, unidade: i.unidade, teorico: r3(saldos.get(i.id) ?? 0) })) };
    });

    app.post('/inventarios', async (req, reply) => {
      const d = z
        .object({
          data: z.string().regex(DATA, 'Informe a data da contagem.'),
          observacao: z.string().trim().max(500).optional().nullable().transform((v) => v || null),
          itens: z
            .array(z.object({ insumoId: z.string().uuid(), contado: z.union([z.number(), z.string()]).transform((v) => Number(String(v).replace(/\./g, '').replace(',', '.'))) }))
            .min(1, 'Informe a contagem de pelo menos um insumo.')
            .max(100),
        })
        .parse(req.body);
      const empresaId = empresaDo(req);
      const hoje = hojeBrasil();
      if (d.data > hoje) throw new ErroHttp(400, 'A contagem não pode ter data futura.');
      if (d.itens.some((i) => !Number.isFinite(i.contado) || i.contado < 0)) throw new ErroHttp(400, 'Contagem inválida.');
      const id = await emTransacao(banco, async (c) => {
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`inventario:${empresaId}`]);
        const ultimo = (await c.query('SELECT max(data) AS d FROM inventarios WHERE empresa_id = $1', [empresaId])).rows[0]?.d ?? null;
        if (ultimo && d.data <= ultimo) throw new ErroHttp(409, `Já existe inventário em ${String(ultimo).split('-').reverse().join('/')}. A nova contagem precisa ser depois dele.`);
        const ids = d.itens.map((i) => i.insumoId);
        const ins = (await c.query('SELECT id, custo_unitario_centavos FROM insumos WHERE empresa_id = $1 AND id = ANY($2::uuid[]) AND excluido_em IS NULL', [empresaId, ids])).rows;
        if (ins.length !== new Set(ids).size) throw new ErroHttp(400, 'Insumo não encontrado.');
        const saldos = await saldosEm(c, empresaId, d.data);
        const v = (await c.query('INSERT INTO inventarios (empresa_id, data, observacao, criado_por_id) VALUES ($1,$2,$3,$4) RETURNING id', [empresaId, d.data, d.observacao, req.usuario!.id])).rows[0];
        for (const it of d.itens) {
          const teorico = r3(saldos.get(it.insumoId) ?? 0);
          const diferenca = r3(it.contado - teorico);
          const consumo = (
            await c.query(
              `SELECT coalesce(sum(cc.quantidade), 0) AS q FROM cargas_consumo cc JOIN cargas c ON c.id = cc.carga_id
                WHERE cc.insumo_id = $1 AND c.status = 'produzida' AND ${DIA('c.data_hora')} <= $2 AND ($3::date IS NULL OR ${DIA('c.data_hora')} > $3::date)`,
              [it.insumoId, d.data, ultimo],
            )
          ).rows[0].q;
          const custo = ins.find((x) => x.id === it.insumoId)?.custo_unitario_centavos ?? null;
          await c.query(
            `INSERT INTO inventarios_itens (empresa_id, inventario_id, insumo_id, saldo_teorico, contado, diferenca, consumo_periodo, custo_unitario_centavos)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [empresaId, v.id, it.insumoId, teorico, it.contado, diferenca, ultimo ? Number(consumo) : null, custo],
          );
          if (diferenca !== 0) {
            await c.query(
              `INSERT INTO estoque_movimentos (empresa_id, insumo_id, data, tipo, quantidade, custo_unitario_centavos, inventario_id, observacao, criado_por_id)
               VALUES ($1,$2,$3,'ajuste',$4,$5,$6,'Acerto do inventário',$7)`,
              [empresaId, it.insumoId, d.data, diferenca, custo, v.id, req.usuario!.id],
            );
          }
        }
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'inventarios', entidadeId: v.id, depois: d });
        return v.id as string;
      });
      return reply.code(201).send({ id });
    });

    app.delete<{ Params: { id: string } }>('/inventarios/:id', async (req) => {
      const empresaId = empresaDo(req);
      if (!UUID.test(req.params.id)) throw naoEncontrado('Inventário');
      await emTransacao(banco, async (c) => {
        const v = (await c.query('SELECT * FROM inventarios WHERE id = $1 AND empresa_id = $2', [req.params.id, empresaId])).rows[0];
        if (!v) throw naoEncontrado('Inventário');
        const depois = (await c.query('SELECT 1 FROM inventarios WHERE empresa_id = $1 AND data > $2', [empresaId, v.data])).rowCount;
        if (depois) throw new ErroHttp(409, 'Só o inventário mais recente pode ser excluído.');
        await c.query('DELETE FROM inventarios WHERE id = $1', [v.id]);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'excluir', entidade: 'inventarios', entidadeId: v.id, antes: v });
      });
      return { ok: true };
    });

    // ======================= Relatórios da produção =======================
    app.get<{ Querystring: Record<string, string | undefined> }>('/relatorios', async (req) => {
      const empresaId = empresaDo(req);
      const { de, ate } = periodoDias(req.query);
      const p = [empresaId, de, ate];
      const filtro = `c.empresa_id = $1 AND c.status = 'produzida' AND ${DIA('c.data_hora')} BETWEEN $2 AND $3`;
      // Custo de material teórico por carga (consumo × custo gravado na carga).
      const MAT = `(SELECT coalesce(sum(cc.quantidade * cc.custo_unitario_centavos), 0) FROM cargas_consumo cc WHERE cc.carga_id = c.id)`;
      const CIM = `(SELECT coalesce(sum(CASE WHEN i.unidade = 't' THEN cc.quantidade * 1000 ELSE cc.quantidade END), 0)
                      FROM cargas_consumo cc JOIN insumos i ON i.id = cc.insumo_id WHERE cc.carga_id = c.id AND i.tipo = 'cimento')`;
      const [dias, tracos, clientes, betoneiras, bombas, consumo, canceladas] = await Promise.all([
        banco.query(
          `SELECT ${DIA('c.data_hora')} AS dia, count(*)::int AS cargas, sum(c.volume_m3) AS m3, coalesce(sum(c.volume_bombeado_m3), 0) AS bombeado,
                  sum(c.devolvido_m3) AS devolvido, sum(${MAT}) AS material, sum(${CIM}) AS cimento, count(DISTINCT c.betoneira_id)::int AS betoneiras
             FROM cargas c WHERE ${filtro} GROUP BY 1 ORDER BY 1`,
          p,
        ),
        banco.query(
          `SELECT t.codigo, t.descricao, count(*)::int AS cargas, sum(c.volume_m3) AS m3, sum(${MAT}) AS material, sum(${CIM}) AS cimento
             FROM cargas c JOIN tracos t ON t.id = c.traco_id WHERE ${filtro} GROUP BY 1, 2 ORDER BY 4 DESC`,
          p,
        ),
        banco.query(
          `SELECT coalesce(cl.nome_fantasia, cl.razao_social, 'Sem cliente') AS cliente, count(*)::int AS cargas, sum(c.volume_m3) AS m3,
                  coalesce(sum(c.volume_bombeado_m3), 0) AS bombeado, sum(c.devolvido_m3) AS devolvido, count(DISTINCT c.obra)::int AS obras
             FROM cargas c LEFT JOIN clientes cl ON cl.id = c.cliente_id WHERE ${filtro} GROUP BY 1 ORDER BY 3 DESC`,
          p,
        ),
        banco.query(
          `SELECT v.codigo, count(*)::int AS viagens, sum(c.volume_m3) AS m3, sum(c.devolvido_m3) AS devolvido, count(DISTINCT ${DIA('c.data_hora')})::int AS dias,
                  count(DISTINCT c.motorista_id)::int AS motoristas
             FROM cargas c JOIN veiculos v ON v.id = c.betoneira_id WHERE ${filtro} GROUP BY 1 ORDER BY 1`,
          p,
        ),
        banco.query(
          `SELECT v.codigo, count(*)::int AS bombeamentos, sum(c.volume_bombeado_m3) AS m3, count(DISTINCT ${DIA('c.data_hora')})::int AS dias
             FROM cargas c JOIN veiculos v ON v.id = c.bomba_id WHERE ${filtro} AND coalesce(c.volume_bombeado_m3, 0) > 0 GROUP BY 1 ORDER BY 1`,
          p,
        ),
        banco.query(
          `SELECT i.id, i.nome, i.tipo, i.unidade,
                  coalesce((SELECT sum(cc.quantidade) FROM cargas_consumo cc JOIN cargas c ON c.id = cc.carga_id WHERE cc.insumo_id = i.id AND ${filtro}), 0) AS consumo,
                  coalesce((SELECT sum(cc.quantidade * cc.custo_unitario_centavos) FROM cargas_consumo cc JOIN cargas c ON c.id = cc.carga_id WHERE cc.insumo_id = i.id AND ${filtro}), 0) AS custo,
                  coalesce((SELECT sum(m.quantidade) FROM estoque_movimentos m WHERE m.insumo_id = i.id AND m.tipo = 'entrada' AND m.data BETWEEN $2 AND $3), 0) AS entradas,
                  coalesce((SELECT sum(m.quantidade * m.custo_unitario_centavos) FROM estoque_movimentos m WHERE m.insumo_id = i.id AND m.tipo = 'entrada' AND m.data BETWEEN $2 AND $3), 0) AS valor_entradas,
                  coalesce((SELECT sum(m.quantidade) FROM estoque_movimentos m WHERE m.insumo_id = i.id AND m.tipo = 'ajuste' AND m.data BETWEEN $2 AND $3), 0) AS ajustes
             FROM insumos i WHERE i.empresa_id = $1 AND i.excluido_em IS NULL
            ORDER BY array_position(ARRAY['cimento','areia','brita','agua','aditivo','fibra','outro'], i.tipo), i.nome`,
          p,
        ),
        banco.query(`SELECT count(*)::int AS n, coalesce(sum(volume_m3), 0) AS m3 FROM cargas c WHERE c.empresa_id = $1 AND c.status = 'cancelada' AND ${DIA('c.data_hora')} BETWEEN $2 AND $3`, p),
      ]);
      const m3 = dias.rows.reduce((s, x) => s + Number(x.m3), 0);
      const material = dias.rows.reduce((s, x) => s + Number(x.material), 0) / 100;
      const cimento = dias.rows.reduce((s, x) => s + Number(x.cimento), 0);
      const devolvido = dias.rows.reduce((s, x) => s + Number(x.devolvido), 0);
      const betoneiraDias = dias.rows.reduce((s, x) => s + Number(x.betoneiras), 0);
      return {
        de,
        ate,
        resumo: {
          cargas: dias.rows.reduce((s, x) => s + x.cargas, 0),
          m3: r2(m3),
          bombeado: r2(dias.rows.reduce((s, x) => s + Number(x.bombeado), 0)),
          devolvido: r2(devolvido),
          devolvidoPct: m3 ? devolvido / m3 : null,
          diasComCarga: dias.rows.length,
          m3PorDia: dias.rows.length ? r2(m3 / dias.rows.length) : null,
          m3PorBetoneiraDia: betoneiraDias ? r2(m3 / betoneiraDias) : null,
          materialTeorico: r2(material),
          materialPorM3: m3 ? r2(material / m3) : null,
          cimentoKgM3: m3 ? Math.round(cimento / m3) : null,
          canceladas: canceladas.rows[0].n,
          m3Cancelado: r2(Number(canceladas.rows[0].m3)),
        },
        porDia: dias.rows.map((x) => ({
          dia: x.dia, cargas: x.cargas, m3: r2(Number(x.m3)), bombeado: r2(Number(x.bombeado)), devolvido: r2(Number(x.devolvido)),
          betoneiras: x.betoneiras, material: r2(Number(x.material) / 100), materialPorM3: Number(x.m3) ? r2(Number(x.material) / 100 / Number(x.m3)) : null,
        })),
        porTraco: tracos.rows.map((x) => ({
          codigo: x.codigo, descricao: x.descricao, cargas: x.cargas, m3: r2(Number(x.m3)), material: r2(Number(x.material) / 100),
          materialPorM3: Number(x.m3) ? r2(Number(x.material) / 100 / Number(x.m3)) : null, cimentoKgM3: Number(x.m3) ? Math.round(Number(x.cimento) / Number(x.m3)) : null,
        })),
        porCliente: clientes.rows.map((x) => ({ cliente: x.cliente, obras: x.obras, cargas: x.cargas, m3: r2(Number(x.m3)), bombeado: r2(Number(x.bombeado)), devolvido: r2(Number(x.devolvido)) })),
        porBetoneira: betoneiras.rows.map((x) => ({
          codigo: x.codigo, viagens: x.viagens, m3: r2(Number(x.m3)), m3PorViagem: r2(Number(x.m3) / x.viagens), dias: x.dias, m3PorDia: r2(Number(x.m3) / x.dias),
          viagensPorDia: r2(x.viagens / x.dias), devolvido: r2(Number(x.devolvido)), motoristas: x.motoristas,
        })),
        porBomba: bombas.rows.map((x) => ({ codigo: x.codigo, bombeamentos: x.bombeamentos, m3: r2(Number(x.m3)), dias: x.dias, m3PorDia: r2(Number(x.m3) / x.dias) })),
        consumo: consumo.rows
          .filter((x) => Number(x.consumo) || Number(x.entradas) || Number(x.ajustes))
          .map((x) => ({
            nome: x.nome, tipo: x.tipo, unidade: x.unidade, consumo: r3(Number(x.consumo)), porM3: m3 ? r3(Number(x.consumo) / m3) : null,
            custo: r2(Number(x.custo) / 100), entradas: r3(Number(x.entradas)), valorEntradas: r2(Number(x.valor_entradas) / 100), ajustes: r3(Number(x.ajustes)),
            kg: x.tipo === 'cimento' ? KG(x.unidade, Number(x.consumo)) : null,
          })),
      };
    });
  };
}
