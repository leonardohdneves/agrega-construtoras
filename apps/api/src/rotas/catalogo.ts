// Suprimentos · Catálogo de materiais e serviços (o que não é insumo da usina), com último preço e histórico.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Banco, Cliente } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';
import { empresaDo, exigir } from '../sessao.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const preco = (c: unknown) => (c === null || c === undefined ? null : Math.round(Number(c) * 100) / 10000);
const texto = (max = 200) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);

const esquema = z.object({
  tipo: z.enum(['material', 'servico']),
  codigo: z.string().trim().max(30).optional().nullable().transform((v) => v || null),
  descricao: z.string().trim().min(2, 'Descreva o item.').max(200),
  unidade: z.string().trim().min(1, 'Informe a unidade.').max(10),
  planoContaId: z.string().regex(UUID).optional().nullable().transform((v) => v || null),
  observacao: texto(500),
  ativo: z.boolean().optional().default(true),
});

function publico(r: Record<string, any>) {
  return {
    id: r.id as string,
    tipo: r.tipo as 'material' | 'servico',
    codigo: r.codigo as string,
    descricao: r.descricao as string,
    unidade: r.unidade as string,
    planoContaId: r.plano_conta_id as string | null,
    planoConta: r.plano_codigo ? `${r.plano_codigo} ${r.plano_nome}` : null,
    observacao: r.observacao as string | null,
    ativo: r.ativo as boolean,
    ultimoPreco: preco(r.ultimo_preco_centavos),
    ultimoPrecoEm: r.ultimo_preco_em as string | null,
    ultimoFornecedor: (r.ultimo_fornecedor as string | null) ?? null,
    usos: Number(r.usos ?? 0),
  };
}

const SELECT = `
  SELECT ct.*, pc.codigo AS plano_codigo, pc.nome AS plano_nome, coalesce(f.nome_fantasia, f.razao_social) AS ultimo_fornecedor,
         (SELECT count(*) FROM pedidos_itens pi WHERE pi.catalogo_id = ct.id) + (SELECT count(*) FROM contratos_itens ci WHERE ci.catalogo_id = ct.id)
       + (SELECT count(*) FROM solicitacoes_itens si WHERE si.catalogo_id = ct.id) AS usos
    FROM catalogo_itens ct LEFT JOIN plano_contas pc ON pc.id = ct.plano_conta_id LEFT JOIN fornecedores f ON f.id = ct.ultimo_fornecedor_id`;

async function validarPlano(c: Cliente, empresaId: string, id: string | null) {
  if (!id) return;
  const pc = (await c.query('SELECT tipo, aceita_lancamento, nome FROM plano_contas WHERE id = $1 AND empresa_id = $2', [id, empresaId])).rows[0];
  if (!pc) throw new ErroHttp(400, 'Categoria não encontrada no plano de contas.');
  if (pc.tipo !== 'despesa') throw new ErroHttp(400, `"${pc.nome}" é categoria de receita.`);
  if (!pc.aceita_lancamento) throw new ErroHttp(400, `"${pc.nome}" é um grupo. Escolha uma categoria dentro dele.`);
}

async function proximoCodigo(c: Cliente, empresaId: string, tipo: 'material' | 'servico') {
  const prefixo = tipo === 'material' ? 'M' : 'S';
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`catalogo:${empresaId}`]);
  const r = await c.query(`SELECT coalesce(max(substring(codigo FROM '^${prefixo}-(\\d+)$')::int), 0) + 1 AS n FROM catalogo_itens WHERE empresa_id = $1`, [empresaId]);
  return `${prefixo}-${String(r.rows[0].n).padStart(4, '0')}`;
}

export function rotasCatalogo(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.addHook('preHandler', exigir(banco, 'dono', 'gestor'));

    app.get<{ Querystring: Record<string, string | undefined> }>('/catalogo', async (req) => {
      const tipo = ['material', 'servico'].includes(req.query.tipo ?? '') ? req.query.tipo! : null;
      const r = await banco.query(
        `${SELECT} WHERE ct.empresa_id = $1 AND ($2::text IS NULL OR ct.tipo = $2) AND ($3::boolean OR ct.ativo) ORDER BY ct.tipo, ct.descricao`,
        [empresaDo(req), tipo, req.query.inativos === '1'],
      );
      return { itens: r.rows.map(publico) };
    });

    app.get<{ Params: { id: string } }>('/catalogo/:id', async (req) => {
      const empresaId = empresaDo(req);
      if (!UUID.test(req.params.id)) throw naoEncontrado('Item');
      const it = (await banco.query(`${SELECT} WHERE ct.id = $1 AND ct.empresa_id = $2`, [req.params.id, empresaId])).rows[0];
      if (!it) throw naoEncontrado('Item');
      const pedidos = (
        await banco.query(
          `SELECT p.id, p.numero, p.data, p.status, coalesce(f.nome_fantasia, f.razao_social) AS fornecedor, pi.quantidade, pi.preco_unitario_centavos
             FROM pedidos_itens pi JOIN pedidos_compra p ON p.id = pi.pedido_id JOIN fornecedores f ON f.id = p.fornecedor_id
            WHERE pi.catalogo_id = $1 AND p.status NOT IN ('cancelado', 'reprovado') ORDER BY p.data DESC, p.numero DESC LIMIT 50`,
          [it.id],
        )
      ).rows;
      const contratos = (
        await banco.query(
          `SELECT k.id, k.numero, coalesce(k.data_assinatura, k.inicio) AS data, k.status, coalesce(f.nome_fantasia, f.razao_social) AS fornecedor, ci.quantidade, ci.preco_unitario_centavos
             FROM contratos_itens ci JOIN contratos k ON k.id = ci.contrato_id JOIN fornecedores f ON f.id = k.fornecedor_id
            WHERE ci.catalogo_id = $1 AND k.status <> 'cancelado' ORDER BY 3 DESC LIMIT 50`,
          [it.id],
        )
      ).rows;
      const historico = [
        ...pedidos.map((x) => ({ origem: 'pedido' as const, id: x.id, numero: x.numero, data: x.data, status: x.status, fornecedor: x.fornecedor, quantidade: Number(x.quantidade), precoUnitario: preco(x.preco_unitario_centavos)! })),
        ...contratos.map((x) => ({ origem: 'contrato' as const, id: x.id, numero: x.numero, data: x.data, status: x.status, fornecedor: x.fornecedor, quantidade: Number(x.quantidade), precoUnitario: preco(x.preco_unitario_centavos)! })),
      ].sort((a, b) => String(b.data).localeCompare(String(a.data)));
      return { item: { ...publico(it), historico } };
    });

    app.post('/catalogo', async (req, reply) => {
      const d = esquema.parse(req.body);
      const empresaId = empresaDo(req);
      const id = await emTransacao(banco, async (c) => {
        await validarPlano(c, empresaId, d.planoContaId);
        const codigo = d.codigo ?? (await proximoCodigo(c, empresaId, d.tipo));
        const r = (
          await c.query(
            'INSERT INTO catalogo_itens (empresa_id, tipo, codigo, descricao, unidade, plano_conta_id, observacao, ativo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
            [empresaId, d.tipo, codigo, d.descricao, d.unidade, d.planoContaId, d.observacao, d.ativo],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'catalogo_itens', entidadeId: r.id, depois: { codigo, descricao: d.descricao } });
        return r.id as string;
      });
      reply.code(201);
      return { item: publico((await banco.query(`${SELECT} WHERE ct.id = $1`, [id])).rows[0]) };
    });

    app.put<{ Params: { id: string } }>('/catalogo/:id', async (req) => {
      const d = esquema.parse(req.body);
      const empresaId = empresaDo(req);
      if (!UUID.test(req.params.id)) throw naoEncontrado('Item');
      await emTransacao(banco, async (c) => {
        const atual = (await c.query('SELECT * FROM catalogo_itens WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [req.params.id, empresaId])).rows[0];
        if (!atual) throw naoEncontrado('Item');
        await validarPlano(c, empresaId, d.planoContaId);
        await c.query(
          'UPDATE catalogo_itens SET tipo = $2, codigo = $3, descricao = $4, unidade = $5, plano_conta_id = $6, observacao = $7, ativo = $8, atualizado_em = now() WHERE id = $1',
          [atual.id, d.tipo, d.codigo ?? atual.codigo, d.descricao, d.unidade, d.planoContaId, d.observacao, d.ativo],
        );
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'catalogo_itens', entidadeId: atual.id, antes: { descricao: atual.descricao, ativo: atual.ativo }, depois: { descricao: d.descricao, ativo: d.ativo } });
      });
      return { item: publico((await banco.query(`${SELECT} WHERE ct.id = $1`, [req.params.id])).rows[0]) };
    });
  };
}
