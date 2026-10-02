// Etapa 6 · Conciliação bancária: importação do extrato OFX e conferência de cada linha
// com as parcelas pagas/recebidas, as transferências ou um lançamento novo (tarifas, rendimentos…).
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import type { Banco, Cliente } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';
import { categoriaDoExtrato, ErroOfx, lerOfx } from '../lib/ofx.ts';
import { empresaDo, exigir } from '../sessao.ts';
import { baixarParcela } from './financeiro.ts';

const UUID = /^[0-9a-f-]{36}$/i;
const reais = (c: unknown) => (c === null || c === undefined ? null : Number(c) / 100);
const uuidOpc = z.union([z.string().uuid(), z.literal(''), z.null()]).optional().transform((v) => v || null);
const soDigitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '').replace(/^0+/, '');

async function conta(c: Cliente, empresaId: string, id: string | null | undefined) {
  if (!id || !UUID.test(id)) throw new ErroHttp(400, 'Escolha a conta do extrato.');
  const r = (await c.query('SELECT * FROM contas_financeiras WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL', [id, empresaId])).rows[0];
  if (!r) throw new ErroHttp(400, 'Conta não encontrada.');
  return r;
}

/** Saldo da conta no fim do dia informado, pelo que está registrado no Agrega. */
async function saldoEm(c: Cliente, contaId: string, data: string): Promise<number | null> {
  const r = (
    await c.query(
      `SELECT c.data_saldo_inicial, c.saldo_inicial_centavos
              + coalesce((SELECT sum(CASE WHEN l.tipo = 'receita' THEN p.valor_pago_centavos ELSE -p.valor_pago_centavos END)
                            FROM parcelas p JOIN lancamentos l ON l.id = p.lancamento_id
                           WHERE p.conta_financeira_id = c.id AND p.status = 'paga' AND l.status = 'confirmado' AND l.excluido_em IS NULL
                             AND p.data_pagamento >= c.data_saldo_inicial AND p.data_pagamento <= $2), 0)
              + coalesce((SELECT sum(CASE WHEN t.conta_destino_id = c.id THEN t.valor_centavos ELSE -t.valor_centavos END)
                            FROM transferencias t
                           WHERE (t.conta_origem_id = c.id OR t.conta_destino_id = c.id) AND t.excluido_em IS NULL
                             AND t.data >= c.data_saldo_inicial AND t.data <= $2), 0) AS saldo
         FROM contas_financeiras c WHERE c.id = $1`,
      [contaId, data],
    )
  ).rows[0];
  if (!r || String(r.data_saldo_inicial) > data) return null;
  return Number(r.saldo);
}

/** Procura, para cada linha pendente sem sugestão, a parcela ou transferência que bate com ela. */
async function sugerir(c: Cliente, empresaId: string, contaId: string) {
  const linhas = (
    await c.query(
      `SELECT * FROM extrato_linhas WHERE conta_financeira_id = $1 AND status = 'pendente' AND sugestao_parcela_id IS NULL AND sugestao_transferencia_id IS NULL ORDER BY data`,
      [contaId],
    )
  ).rows;
  const usadas = new Set<string>();
  let n = 0;
  for (const l of linhas) {
    const tipo = Number(l.valor_centavos) > 0 ? 'receita' : 'despesa';
    const v = Math.abs(Number(l.valor_centavos));
    const livre = `NOT EXISTS (SELECT 1 FROM extrato_linhas x WHERE x.parcela_id = p.id OR (x.sugestao_parcela_id = p.id AND x.status = 'pendente'))`;
    // 1) Já baixada nesta conta, com o mesmo valor, perto da data.
    let cand = (
      await c.query(
        `SELECT p.id FROM parcelas p JOIN lancamentos l ON l.id = p.lancamento_id
          WHERE p.empresa_id = $1 AND l.tipo = $2 AND l.status = 'confirmado' AND l.excluido_em IS NULL AND p.status = 'paga'
            AND p.conta_financeira_id = $3 AND p.valor_pago_centavos = $4 AND p.data_pagamento BETWEEN $5::date - 5 AND $5::date + 5 AND ${livre}
          ORDER BY abs(p.data_pagamento - $5::date), p.data_pagamento LIMIT 5`,
        [empresaId, tipo, contaId, v, l.data],
      )
    ).rows.filter((x) => !usadas.has(x.id));
    // 2) Em aberto, com o mesmo valor, vencendo perto da data.
    if (!cand.length)
      cand = (
        await c.query(
          `SELECT p.id FROM parcelas p JOIN lancamentos l ON l.id = p.lancamento_id
            WHERE p.empresa_id = $1 AND l.tipo = $2 AND l.status = 'confirmado' AND l.excluido_em IS NULL AND p.status = 'aberta'
              AND p.valor_centavos = $3 AND p.vencimento BETWEEN $4::date - 15 AND $4::date + 15 AND ${livre}
            ORDER BY abs(p.vencimento - $4::date), p.vencimento LIMIT 5`,
          [empresaId, tipo, v, l.data],
        )
      ).rows.filter((x) => !usadas.has(x.id));
    if (cand.length) {
      usadas.add(cand[0].id);
      await c.query('UPDATE extrato_linhas SET sugestao_parcela_id = $2 WHERE id = $1', [l.id, cand[0].id]);
      n++;
      continue;
    }
    // 3) Transferência entre contas já registrada.
    const t = (
      await c.query(
        `SELECT t.id FROM transferencias t
          WHERE t.empresa_id = $1 AND t.excluido_em IS NULL AND t.valor_centavos = $2 AND t.data BETWEEN $3::date - 5 AND $3::date + 5
            AND (CASE WHEN $4 THEN t.conta_destino_id ELSE t.conta_origem_id END) = $5
            AND NOT EXISTS (SELECT 1 FROM extrato_linhas x WHERE x.conta_financeira_id = $5 AND (x.transferencia_id = t.id OR (x.sugestao_transferencia_id = t.id AND x.status = 'pendente')))
          ORDER BY abs(t.data - $3::date) LIMIT 1`,
        [empresaId, v, l.data, tipo === 'receita', contaId],
      )
    ).rows[0];
    if (t) {
      await c.query('UPDATE extrato_linhas SET sugestao_transferencia_id = $2 WHERE id = $1', [l.id, t.id]);
      n++;
    }
  }
  return n;
}

async function carregarLinha(c: pg.PoolClient, empresaId: string, id: string) {
  if (!UUID.test(id)) throw naoEncontrado('Linha do extrato');
  const l = (await c.query('SELECT * FROM extrato_linhas WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [id, empresaId])).rows[0];
  if (!l) throw naoEncontrado('Linha do extrato');
  return l;
}

async function marcar(c: pg.PoolClient, linhaId: string, usuarioId: string, d: { acao: string; parcelaId?: string | null; transferenciaId?: string | null }) {
  await c.query(
    `UPDATE extrato_linhas SET status = 'conciliado', acao = $2, parcela_id = $3, transferencia_id = $4, conciliado_por_id = $5, conciliado_em = now(),
            sugestao_parcela_id = NULL, sugestao_transferencia_id = NULL
      WHERE id = $1`,
    [linhaId, d.acao, d.parcelaId ?? null, d.transferenciaId ?? null, usuarioId],
  );
  // Quem sugeria o mesmo registro para outra linha perde a sugestão.
  if (d.parcelaId) await c.query("UPDATE extrato_linhas SET sugestao_parcela_id = NULL WHERE sugestao_parcela_id = $1 AND status = 'pendente'", [d.parcelaId]);
}

/** Concilia a linha com uma parcela: dá baixa se estiver em aberto, ou só liga se já estiver baixada nesta conta. */
async function conciliarParcela(c: pg.PoolClient, empresaId: string, usuarioId: string, l: Record<string, any>, parcelaId: string) {
  const p = (
    await c.query(
      `SELECT p.*, l.tipo FROM parcelas p JOIN lancamentos l ON l.id = p.lancamento_id
        WHERE p.id = $1 AND p.empresa_id = $2 AND l.status = 'confirmado' AND l.excluido_em IS NULL FOR UPDATE OF p`,
      [parcelaId, empresaId],
    )
  ).rows[0];
  if (!p) throw new ErroHttp(400, 'Parcela não encontrada.');
  const v = Math.abs(Number(l.valor_centavos));
  const tipo = Number(l.valor_centavos) > 0 ? 'receita' : 'despesa';
  if (p.tipo !== tipo) throw new ErroHttp(400, tipo === 'receita' ? 'Esta linha é uma entrada; escolha uma conta a receber.' : 'Esta linha é uma saída; escolha uma conta a pagar.');
  if ((await c.query('SELECT 1 FROM extrato_linhas WHERE parcela_id = $1 AND id <> $2', [p.id, l.id])).rowCount) throw new ErroHttp(409, 'Esta parcela já está conciliada com outra linha do extrato.');
  if (p.status === 'cancelada') throw new ErroHttp(400, 'Esta parcela foi cancelada.');
  if (p.status === 'paga') {
    if (p.conta_financeira_id !== l.conta_financeira_id) throw new ErroHttp(409, 'Esta parcela foi baixada em outra conta. Estorne a baixa e concilie de novo.');
    if (Number(p.valor_pago_centavos) !== v) throw new ErroHttp(409, `A baixa foi de ${(Number(p.valor_pago_centavos) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} e a linha do extrato é de ${(v / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}. Estorne e concilie de novo para acertar juros ou desconto.`);
    await marcar(c, l.id, usuarioId, { acao: 'vinculo', parcelaId: p.id });
    return;
  }
  const dif = v - Number(p.valor_centavos);
  await baixarParcela(c, empresaId, usuarioId, p.id, {
    data: String(l.data),
    contaId: l.conta_financeira_id,
    forma: null,
    juros: dif > 0 ? dif : 0,
    desconto: dif < 0 ? -dif : 0,
    observacoes: 'Baixa pela conciliação do extrato',
  });
  await marcar(c, l.id, usuarioId, { acao: 'baixa', parcelaId: p.id });
}

async function conciliarTransferencia(c: pg.PoolClient, empresaId: string, usuarioId: string, l: Record<string, any>, transferenciaId: string) {
  const t = (await c.query('SELECT * FROM transferencias WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL', [transferenciaId, empresaId])).rows[0];
  if (!t) throw new ErroHttp(400, 'Transferência não encontrada.');
  const entrada = Number(l.valor_centavos) > 0;
  if ((entrada ? t.conta_destino_id : t.conta_origem_id) !== l.conta_financeira_id)
    throw new ErroHttp(400, entrada ? 'Esta transferência não entrou nesta conta.' : 'Esta transferência não saiu desta conta.');
  if (Number(t.valor_centavos) !== Math.abs(Number(l.valor_centavos))) throw new ErroHttp(400, 'O valor da transferência é diferente do valor da linha.');
  if ((await c.query('SELECT 1 FROM extrato_linhas WHERE transferencia_id = $1 AND conta_financeira_id = $2 AND id <> $3', [t.id, l.conta_financeira_id, l.id])).rowCount)
    throw new ErroHttp(409, 'Esta transferência já está conciliada com outra linha desta conta.');
  await marcar(c, l.id, usuarioId, { acao: 'transferencia', transferenciaId: t.id });
}

function linhaPublica(r: Record<string, any>) {
  return {
    id: r.id,
    extratoId: r.extrato_id,
    contaId: r.conta_financeira_id,
    data: r.data,
    valor: reais(r.valor_centavos),
    tipo: r.tipo,
    descricao: r.descricao,
    documento: r.documento,
    status: r.status,
    acao: r.acao,
    parcela: r.p_id
      ? {
          id: r.p_id,
          lancamentoId: r.p_lancamento_id,
          descricao: r.p_descricao,
          pessoa: r.p_pessoa,
          numero: r.p_numero,
          total: r.p_total,
          vencimento: r.p_vencimento,
          valor: reais(r.p_valor),
          status: r.p_status,
          dataPagamento: r.p_data_pagamento,
          valorPago: reais(r.p_valor_pago),
          sugestao: !r.parcela_id,
        }
      : null,
    transferencia: r.t_id
      ? { id: r.t_id, data: r.t_data, valor: reais(r.t_valor), origem: r.t_origem, destino: r.t_destino, descricao: r.t_descricao, sugestao: !r.transferencia_id }
      : null,
    categoriaSugerida: r.status === 'pendente' && !r.p_id && !r.t_id ? categoriaDoExtrato(r.descricao, Number(r.valor_centavos)) : null,
  };
}

const SELECT_LINHA = `
  SELECT el.*,
         p.id AS p_id, p.lancamento_id AS p_lancamento_id, l.descricao AS p_descricao, p.numero AS p_numero,
         (SELECT count(*)::int FROM parcelas x WHERE x.lancamento_id = p.lancamento_id) AS p_total,
         coalesce(f.nome_fantasia, f.razao_social, cl.nome_fantasia, cl.razao_social) AS p_pessoa,
         p.vencimento AS p_vencimento, p.valor_centavos AS p_valor, p.status AS p_status, p.data_pagamento AS p_data_pagamento, p.valor_pago_centavos AS p_valor_pago,
         t.id AS t_id, t.data AS t_data, t.valor_centavos AS t_valor, t.descricao AS t_descricao, co.nome AS t_origem, cd.nome AS t_destino
    FROM extrato_linhas el
    LEFT JOIN parcelas p ON p.id = coalesce(el.parcela_id, el.sugestao_parcela_id)
    LEFT JOIN lancamentos l ON l.id = p.lancamento_id
    LEFT JOIN fornecedores f ON f.id = l.fornecedor_id LEFT JOIN clientes cl ON cl.id = l.cliente_id
    LEFT JOIN transferencias t ON t.id = coalesce(el.transferencia_id, el.sugestao_transferencia_id) AND t.excluido_em IS NULL
    LEFT JOIN contas_financeiras co ON co.id = t.conta_origem_id LEFT JOIN contas_financeiras cd ON cd.id = t.conta_destino_id`;

export function rotasConciliacao(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.addHook('preHandler', exigir(banco, 'dono', 'gestor'));

    // Situação de cada conta: linhas pendentes e comparação do saldo do banco com o do Agrega.
    app.get('/conciliacao/resumo', async (req) => {
      const empresaId = empresaDo(req);
      const contas = (
        await banco.query(
          `SELECT c.id, c.nome, c.tipo, c.banco, c.agencia, c.conta, c.ativo,
                  (SELECT count(*)::int FROM extrato_linhas l WHERE l.conta_financeira_id = c.id AND l.status = 'pendente') AS pendentes,
                  (SELECT count(*)::int FROM extrato_linhas l WHERE l.conta_financeira_id = c.id AND l.status = 'pendente' AND (l.sugestao_parcela_id IS NOT NULL OR l.sugestao_transferencia_id IS NOT NULL)) AS sugestoes,
                  (SELECT json_build_object('id', e.id, 'fim', e.periodo_fim, 'saldo', e.saldo_centavos, 'dataSaldo', e.data_saldo, 'importadoEm', e.importado_em)
                     FROM extratos_ofx e WHERE e.conta_financeira_id = c.id AND e.excluido_em IS NULL AND e.saldo_centavos IS NOT NULL
                    ORDER BY coalesce(e.data_saldo, e.periodo_fim) DESC, e.importado_em DESC LIMIT 1) AS ultimo
             FROM contas_financeiras c WHERE c.empresa_id = $1 AND c.excluido_em IS NULL ORDER BY c.ativo DESC, c.tipo, c.nome`,
          [empresaId],
        )
      ).rows;
      const r = [];
      for (const x of contas) {
        let comparacao = null;
        const u = x.ultimo;
        if (u && (u.dataSaldo || u.fim)) {
          const data = String(u.dataSaldo ?? u.fim).slice(0, 10);
          const sistema = await saldoEm(banco, x.id, data);
          comparacao = { data, banco: Number(u.saldo) / 100, sistema: sistema === null ? null : sistema / 100, diferenca: sistema === null ? null : (Number(u.saldo) - sistema) / 100 };
        }
        r.push({ id: x.id, nome: x.nome, tipo: x.tipo, banco: x.banco, agencia: x.agencia, conta: x.conta, ativo: x.ativo, pendentes: x.pendentes, sugestoes: x.sugestoes, comparacao });
      }
      return { contas: r };
    });

    app.get<{ Querystring: { contaId?: string } }>('/conciliacao/extratos', async (req) => {
      const r = await banco.query(
        `SELECT e.*, u.nome AS usuario,
                (SELECT count(*)::int FROM extrato_linhas l WHERE l.extrato_id = e.id AND l.status = 'pendente') AS pendentes
           FROM extratos_ofx e LEFT JOIN usuarios u ON u.id = e.importado_por_id
          WHERE e.empresa_id = $1 AND e.excluido_em IS NULL AND ($2::uuid IS NULL OR e.conta_financeira_id = $2)
          ORDER BY e.importado_em DESC LIMIT 50`,
        [empresaDo(req), req.query.contaId && UUID.test(req.query.contaId) ? req.query.contaId : null],
      );
      return {
        extratos: r.rows.map((e) => ({
          id: e.id, contaId: e.conta_financeira_id, arquivo: e.arquivo_nome, inicio: e.periodo_inicio, fim: e.periodo_fim, saldo: reais(e.saldo_centavos),
          dataSaldo: e.data_saldo, novas: e.linhas_novas, repetidas: e.linhas_repetidas, pendentes: e.pendentes, usuario: e.usuario, importadoEm: e.importado_em,
        })),
      };
    });

    app.post('/conciliacao/ofx', { bodyLimit: 10 * 1024 * 1024 }, async (req, reply) => {
      const d = z
        .object({ contaId: z.string().uuid('Escolha a conta do extrato.'), conteudo: z.string().min(10).max(8_000_000, 'Arquivo grande demais.'), arquivo: z.string().max(200).optional().nullable() })
        .parse(req.body);
      const empresaId = empresaDo(req);
      let ofx;
      try {
        ofx = lerOfx(d.conteudo);
      } catch (e) {
        if (e instanceof ErroOfx) throw new ErroHttp(400, e.message);
        throw new ErroHttp(400, 'Não consegui ler este extrato. Confira se o arquivo é OFX.');
      }
      const resultado = await emTransacao(banco, async (c) => {
        const cf = await conta(c, empresaId, d.contaId);
        const avisos: string[] = [];
        if (ofx.conta && cf.conta && soDigitos(ofx.conta) && !soDigitos(ofx.conta).endsWith(soDigitos(cf.conta)) && !soDigitos(cf.conta).endsWith(soDigitos(ofx.conta)))
          avisos.push(`O extrato é da conta ${ofx.conta}${ofx.agencia ? `, agência ${ofx.agencia}` : ''}, e a conta escolhida no Agrega é ${cf.conta}. Confira se escolheu a conta certa.`);
        const ini = ofx.linhas[0].data;
        if (ini < String(cf.data_saldo_inicial))
          avisos.push(`O extrato começa antes da data do saldo inicial da conta (${String(cf.data_saldo_inicial).split('-').reverse().join('/')}). Linhas anteriores a essa data não mudam o saldo do Agrega.`);
        const e = (
          await c.query(
            `INSERT INTO extratos_ofx (empresa_id, conta_financeira_id, arquivo_nome, banco, agencia, conta, periodo_inicio, periodo_fim, saldo_centavos, data_saldo, importado_por_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
            [empresaId, cf.id, d.arquivo ?? null, ofx.banco, ofx.agencia, ofx.conta, ofx.inicio, ofx.fim, ofx.saldo, ofx.dataSaldo ?? ofx.fim, req.usuario!.id],
          )
        ).rows[0];
        let novas = 0;
        for (const l of ofx.linhas) {
          const r = await c.query(
            `INSERT INTO extrato_linhas (empresa_id, extrato_id, conta_financeira_id, fitid, data, valor_centavos, tipo, descricao, documento)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (conta_financeira_id, fitid) DO NOTHING`,
            [empresaId, e.id, cf.id, l.fitid, l.data, l.valor, l.tipo, l.descricao, l.documento],
          );
          novas += r.rowCount ?? 0;
        }
        const repetidas = ofx.linhas.length - novas;
        await c.query('UPDATE extratos_ofx SET linhas_novas = $2, linhas_repetidas = $3 WHERE id = $1', [e.id, novas, repetidas]);
        const sugestoes = await sugerir(c, empresaId, cf.id);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'extratos_ofx', entidadeId: e.id, depois: { arquivo: d.arquivo, novas, repetidas } });
        return { extratoId: e.id, contaId: cf.id, inicio: ofx.inicio, fim: ofx.fim, novas, repetidas, sugestoes, avisos, saldoBanco: reais(ofx.saldo) };
      });
      reply.code(201);
      return resultado;
    });

    app.get<{ Querystring: Record<string, string | undefined> }>('/conciliacao/linhas', async (req) => {
      const q = req.query;
      const empresaId = empresaDo(req);
      if (!q.contaId || !UUID.test(q.contaId)) throw new ErroHttp(400, 'Escolha a conta.');
      const status = ['pendente', 'conciliado', 'ignorado'].includes(q.status ?? '') ? q.status! : q.status === 'todas' ? null : 'pendente';
      const de = /^\d{4}-\d{2}-\d{2}$/.test(q.de ?? '') ? q.de : null;
      const ate = /^\d{4}-\d{2}-\d{2}$/.test(q.ate ?? '') ? q.ate : null;
      const r = await banco.query(
        `${SELECT_LINHA}
          WHERE el.empresa_id = $1 AND el.conta_financeira_id = $2 AND ($3::text IS NULL OR el.status = $3)
            AND ($4::date IS NULL OR el.data >= $4) AND ($5::date IS NULL OR el.data <= $5)
          ORDER BY el.data DESC, el.valor_centavos LIMIT 1000`,
        [empresaId, q.contaId, status, de, ate],
      );
      return { linhas: r.rows.map(linhaPublica) };
    });

    // Parcelas e transferências que podem corresponder à linha.
    app.get<{ Params: { id: string }; Querystring: { busca?: string } }>('/conciliacao/linhas/:id/candidatos', async (req) => {
      const empresaId = empresaDo(req);
      const l = (await banco.query('SELECT * FROM extrato_linhas WHERE id = $1 AND empresa_id = $2', [UUID.test(req.params.id) ? req.params.id : null, empresaId])).rows[0];
      if (!l) throw naoEncontrado('Linha do extrato');
      const tipo = Number(l.valor_centavos) > 0 ? 'receita' : 'despesa';
      const v = Math.abs(Number(l.valor_centavos));
      const busca = (req.query.busca ?? '').trim();
      const parcelas = (
        await banco.query(
          `SELECT p.*, l.descricao, l.documento, coalesce(f.nome_fantasia, f.razao_social, cl.nome_fantasia, cl.razao_social) AS pessoa, cf.nome AS conta_nome,
                  (SELECT count(*)::int FROM parcelas x WHERE x.lancamento_id = p.lancamento_id) AS total
             FROM parcelas p JOIN lancamentos l ON l.id = p.lancamento_id
             LEFT JOIN fornecedores f ON f.id = l.fornecedor_id LEFT JOIN clientes cl ON cl.id = l.cliente_id
             LEFT JOIN contas_financeiras cf ON cf.id = p.conta_financeira_id
            WHERE p.empresa_id = $1 AND l.tipo = $2 AND l.status = 'confirmado' AND l.excluido_em IS NULL
              AND (p.status = 'aberta' OR (p.status = 'paga' AND p.conta_financeira_id = $3))
              AND NOT EXISTS (SELECT 1 FROM extrato_linhas x WHERE x.parcela_id = p.id)
              AND (
                ($6 = '' AND coalesce(p.data_pagamento, p.vencimento) BETWEEN $4::date - 60 AND $4::date + 60)
                OR ($6 <> '' AND (l.descricao ILIKE '%' || $6 || '%' OR coalesce(f.nome_fantasia, f.razao_social, cl.nome_fantasia, cl.razao_social, '') ILIKE '%' || $6 || '%' OR l.documento ILIKE '%' || $6 || '%'))
              )
            ORDER BY abs(coalesce(p.valor_pago_centavos, p.valor_centavos) - $5), abs(coalesce(p.data_pagamento, p.vencimento) - $4::date)
            LIMIT 30`,
          [empresaId, tipo, l.conta_financeira_id, l.data, v, busca],
        )
      ).rows.map((p) => ({
        id: p.id, lancamentoId: p.lancamento_id, descricao: p.descricao, documento: p.documento, pessoa: p.pessoa, numero: p.numero, total: p.total,
        vencimento: p.vencimento, valor: reais(p.valor_centavos), status: p.status, dataPagamento: p.data_pagamento, valorPago: reais(p.valor_pago_centavos),
        exato: Number(p.status === 'paga' ? p.valor_pago_centavos : p.valor_centavos) === v,
      }));
      const transferencias = (
        await banco.query(
          `SELECT t.*, co.nome AS origem, cd.nome AS destino FROM transferencias t
             JOIN contas_financeiras co ON co.id = t.conta_origem_id JOIN contas_financeiras cd ON cd.id = t.conta_destino_id
            WHERE t.empresa_id = $1 AND t.excluido_em IS NULL AND (CASE WHEN $2 THEN t.conta_destino_id ELSE t.conta_origem_id END) = $3
              AND t.data BETWEEN $4::date - 15 AND $4::date + 15
              AND NOT EXISTS (SELECT 1 FROM extrato_linhas x WHERE x.transferencia_id = t.id AND x.conta_financeira_id = $3)
            ORDER BY abs(t.valor_centavos - $5), abs(t.data - $4::date) LIMIT 10`,
          [empresaId, tipo === 'receita', l.conta_financeira_id, l.data, v],
        )
      ).rows.map((t) => ({ id: t.id, data: t.data, valor: reais(t.valor_centavos), origem: t.origem, destino: t.destino, descricao: t.descricao, exato: Number(t.valor_centavos) === v }));
      return { parcelas, transferencias };
    });

    app.post<{ Params: { id: string } }>('/conciliacao/linhas/:id/conciliar', async (req) => {
      const d = z.object({ parcelaId: uuidOpc, transferenciaId: uuidOpc }).parse(req.body ?? {});
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const l = await carregarLinha(c, empresaId, req.params.id);
        if (l.status !== 'pendente') throw new ErroHttp(409, 'Esta linha já foi tratada. Desfaça antes de conciliar de novo.');
        const parcelaId = d.parcelaId ?? (d.transferenciaId ? null : l.sugestao_parcela_id);
        const transferenciaId = d.transferenciaId ?? (d.parcelaId ? null : l.sugestao_transferencia_id);
        if (parcelaId) await conciliarParcela(c, empresaId, req.usuario!.id, l, parcelaId);
        else if (transferenciaId) await conciliarTransferencia(c, empresaId, req.usuario!.id, l, transferenciaId);
        else throw new ErroHttp(400, 'Escolha a parcela ou a transferência.');
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'confirmar', entidade: 'extrato_linhas', entidadeId: l.id, depois: { parcelaId, transferenciaId } });
      });
      return { ok: true };
    });

    // Aceita de uma vez as sugestões da conta (ou só as linhas escolhidas).
    app.post('/conciliacao/aceitar-sugestoes', async (req) => {
      const d = z.object({ contaId: z.string().uuid(), ids: z.array(z.string().uuid()).max(1000).optional() }).parse(req.body);
      const empresaId = empresaDo(req);
      const linhas = (
        await banco.query(
          `SELECT id FROM extrato_linhas WHERE empresa_id = $1 AND conta_financeira_id = $2 AND status = 'pendente'
              AND (sugestao_parcela_id IS NOT NULL OR sugestao_transferencia_id IS NOT NULL) AND ($3::uuid[] IS NULL OR id = ANY($3::uuid[])) ORDER BY data`,
          [empresaId, d.contaId, d.ids ?? null],
        )
      ).rows;
      let ok = 0;
      const erros: string[] = [];
      for (const x of linhas) {
        try {
          await emTransacao(banco, async (c) => {
            const l = await carregarLinha(c, empresaId, x.id);
            if (l.sugestao_parcela_id) await conciliarParcela(c, empresaId, req.usuario!.id, l, l.sugestao_parcela_id);
            else await conciliarTransferencia(c, empresaId, req.usuario!.id, l, l.sugestao_transferencia_id);
            await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'confirmar', entidade: 'extrato_linhas', entidadeId: l.id, depois: { sugestao: true } });
          });
          ok++;
        } catch (e) {
          erros.push((e as Error).message);
        }
      }
      return { conciliadas: ok, erros };
    });

    // Lançamento novo a partir da linha (tarifa, rendimento, pagamento sem conta a pagar…), já baixado.
    app.post<{ Params: { id: string } }>('/conciliacao/linhas/:id/lancamento', async (req) => {
      const d = z
        .object({
          planoContaId: z.string({ required_error: 'Escolha a categoria.' }).uuid('Escolha a categoria.'),
          centroCustoId: uuidOpc,
          veiculoId: uuidOpc,
          fornecedorId: uuidOpc,
          clienteId: uuidOpc,
          descricao: z.string().trim().max(200).optional().nullable(),
        })
        .parse(req.body);
      const empresaId = empresaDo(req);
      const usuarioId = req.usuario!.id;
      const lancamentoId = await emTransacao(banco, async (c) => {
        const l = await carregarLinha(c, empresaId, req.params.id);
        if (l.status !== 'pendente') throw new ErroHttp(409, 'Esta linha já foi tratada.');
        const tipo = Number(l.valor_centavos) > 0 ? 'receita' : 'despesa';
        const v = Math.abs(Number(l.valor_centavos));
        const pc = (await c.query('SELECT tipo, aceita_lancamento, nome FROM plano_contas WHERE id = $1 AND empresa_id = $2', [d.planoContaId, empresaId])).rows[0];
        if (!pc) throw new ErroHttp(400, 'Categoria não encontrada.');
        if (!pc.aceita_lancamento) throw new ErroHttp(400, `"${pc.nome}" é um grupo. Escolha uma categoria dentro dele.`);
        if (pc.tipo !== tipo) throw new ErroHttp(400, `"${pc.nome}" é categoria de ${pc.tipo}; esta linha é ${tipo === 'receita' ? 'uma entrada' : 'uma saída'}.`);
        if (tipo === 'despesa' && d.clienteId) throw new ErroHttp(400, 'Saída é paga a fornecedor ou credor.');
        if (tipo === 'receita' && d.fornecedorId) throw new ErroHttp(400, 'Entrada é recebida de cliente.');
        const lanc = (
          await c.query(
            `INSERT INTO lancamentos (empresa_id, tipo, competencia, descricao, documento, valor_total_centavos, cliente_id, fornecedor_id, origem, status, criado_por_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'extrato','confirmado',$9) RETURNING *`,
            [empresaId, tipo, l.data, (d.descricao || l.descricao).slice(0, 200), l.documento, v, d.clienteId, d.fornecedorId, usuarioId],
          )
        ).rows[0];
        await c.query(
          `INSERT INTO apropriacoes (empresa_id, lancamento_id, plano_conta_id, centro_custo_id, veiculo_id, descricao, valor_centavos) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [empresaId, lanc.id, d.planoContaId, d.centroCustoId, d.veiculoId, null, v],
        );
        const p = (
          await c.query(`INSERT INTO parcelas (empresa_id, lancamento_id, numero, vencimento, valor_centavos) VALUES ($1,$2,1,$3,$4) RETURNING id`, [empresaId, lanc.id, l.data, v])
        ).rows[0];
        await baixarParcela(c, empresaId, usuarioId, p.id, { data: String(l.data), contaId: l.conta_financeira_id, forma: null, juros: 0, desconto: 0, observacoes: 'Lançado pela conciliação do extrato' });
        await marcar(c, l.id, usuarioId, { acao: 'lancamento', parcelaId: p.id });
        await auditar(c, { empresaId, usuarioId, acao: 'criar', entidade: 'lancamentos', entidadeId: lanc.id, depois: { ...lanc, origem: 'extrato', linha: l.id } });
        return lanc.id as string;
      });
      return { lancamentoId };
    });

    // A linha é uma transferência entre contas da empresa: registra a transferência.
    app.post<{ Params: { id: string } }>('/conciliacao/linhas/:id/transferencia', async (req) => {
      const d = z.object({ outraContaId: z.string({ required_error: 'Escolha a outra conta.' }).uuid('Escolha a outra conta.') }).parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const l = await carregarLinha(c, empresaId, req.params.id);
        if (l.status !== 'pendente') throw new ErroHttp(409, 'Esta linha já foi tratada.');
        const outra = await conta(c, empresaId, d.outraContaId);
        if (outra.id === l.conta_financeira_id) throw new ErroHttp(400, 'Escolha uma conta diferente da conta do extrato.');
        const entrada = Number(l.valor_centavos) > 0;
        const t = (
          await c.query(
            `INSERT INTO transferencias (empresa_id, conta_origem_id, conta_destino_id, data, valor_centavos, descricao, criado_por_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
            [empresaId, entrada ? outra.id : l.conta_financeira_id, entrada ? l.conta_financeira_id : outra.id, l.data, Math.abs(Number(l.valor_centavos)), l.descricao.slice(0, 200), req.usuario!.id],
          )
        ).rows[0];
        await marcar(c, l.id, req.usuario!.id, { acao: 'nova_transferencia', transferenciaId: t.id });
        // A outra conta também pode ter extrato importado: sugere a mesma transferência lá.
        await sugerir(c, empresaId, outra.id);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'transferencias', entidadeId: t.id, depois: { linha: l.id } });
      });
      return { ok: true };
    });

    app.post<{ Params: { id: string } }>('/conciliacao/linhas/:id/ignorar', async (req) => {
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const l = await carregarLinha(c, empresaId, req.params.id);
        if (l.status !== 'pendente') throw new ErroHttp(409, 'Esta linha já foi tratada.');
        await c.query(
          `UPDATE extrato_linhas SET status = 'ignorado', conciliado_por_id = $2, conciliado_em = now(), sugestao_parcela_id = NULL, sugestao_transferencia_id = NULL WHERE id = $1`,
          [l.id, req.usuario!.id],
        );
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'extrato_linhas', entidadeId: l.id, depois: { status: 'ignorado' } });
      });
      return { ok: true };
    });

    // Desfaz o que a conciliação fez: estorna a baixa, cancela o lançamento criado ou exclui a transferência criada.
    app.post<{ Params: { id: string } }>('/conciliacao/linhas/:id/desfazer', async (req) => {
      const empresaId = empresaDo(req);
      const usuarioId = req.usuario!.id;
      await emTransacao(banco, async (c) => {
        const l = await carregarLinha(c, empresaId, req.params.id);
        if (l.status === 'pendente') throw new ErroHttp(409, 'Esta linha ainda está pendente.');
        const estornar = async (parcelaId: string) =>
          c.query(
            `UPDATE parcelas SET status = 'aberta', data_pagamento = NULL, conta_financeira_id = NULL, forma_pagamento = NULL, juros_centavos = 0,
                    desconto_centavos = 0, valor_pago_centavos = NULL, baixado_por_id = NULL, atualizado_em = now() WHERE id = $1 AND status = 'paga'`,
            [parcelaId],
          );
        if (l.acao === 'baixa' && l.parcela_id) await estornar(l.parcela_id);
        if (l.acao === 'lancamento' && l.parcela_id) {
          await estornar(l.parcela_id);
          const lancId = (await c.query('SELECT lancamento_id FROM parcelas WHERE id = $1', [l.parcela_id])).rows[0]?.lancamento_id;
          if (lancId) {
            await c.query("UPDATE lancamentos SET status = 'cancelado', atualizado_em = now() WHERE id = $1", [lancId]);
            await c.query("UPDATE parcelas SET status = 'cancelada', atualizado_em = now() WHERE lancamento_id = $1", [lancId]);
          }
        }
        if (l.acao === 'nova_transferencia' && l.transferencia_id) {
          await c.query('UPDATE transferencias SET excluido_em = now() WHERE id = $1', [l.transferencia_id]);
          await c.query(
            `UPDATE extrato_linhas SET status = 'pendente', acao = NULL, transferencia_id = NULL, conciliado_por_id = NULL, conciliado_em = NULL
              WHERE transferencia_id = $1 AND id <> $2`,
            [l.transferencia_id, l.id],
          );
          await c.query('UPDATE extrato_linhas SET sugestao_transferencia_id = NULL WHERE sugestao_transferencia_id = $1', [l.transferencia_id]);
        }
        await c.query(
          `UPDATE extrato_linhas SET status = 'pendente', acao = NULL, parcela_id = NULL, transferencia_id = NULL, conciliado_por_id = NULL, conciliado_em = NULL WHERE id = $1`,
          [l.id],
        );
        await auditar(c, { empresaId, usuarioId, acao: 'alterar', entidade: 'extrato_linhas', entidadeId: l.id, antes: l, depois: { status: 'pendente', desfeito: l.acao ?? l.status } });
      });
      return { ok: true };
    });

    // Procura sugestões de novo (depois de lançar contas que faltavam, por exemplo).
    app.post('/conciliacao/sugerir', async (req) => {
      const d = z.object({ contaId: z.string().uuid() }).parse(req.body);
      const empresaId = empresaDo(req);
      const n = await emTransacao(banco, async (c) => {
        await conta(c, empresaId, d.contaId);
        return sugerir(c, empresaId, d.contaId);
      });
      return { sugestoes: n };
    });

    // Remove um extrato importado por engano (só se nenhuma linha dele estiver conciliada).
    app.delete<{ Params: { id: string } }>('/conciliacao/extratos/:id', async (req) => {
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const e = (await c.query('SELECT * FROM extratos_ofx WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL FOR UPDATE', [UUID.test(req.params.id) ? req.params.id : null, empresaId])).rows[0];
        if (!e) throw naoEncontrado('Extrato');
        if ((await c.query("SELECT 1 FROM extrato_linhas WHERE extrato_id = $1 AND status = 'conciliado' LIMIT 1", [e.id])).rowCount)
          throw new ErroHttp(409, 'Há linhas deste extrato já conciliadas. Desfaça as conciliações antes de excluir.');
        await c.query('DELETE FROM extrato_linhas WHERE extrato_id = $1', [e.id]);
        await c.query('UPDATE extratos_ofx SET excluido_em = now() WHERE id = $1', [e.id]);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'excluir', entidade: 'extratos_ofx', entidadeId: e.id, antes: e });
      });
      return { ok: true };
    });
  };
}
