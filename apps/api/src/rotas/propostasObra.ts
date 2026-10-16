// Comercial · Propostas de execução de obras. Aceita pelo cliente, gera o contrato e os lançamentos a receber.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Banco, Cliente } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';
import { empresaDo, exigir } from '../sessao.ts';
import { calcularProposta, NOMES_TIPO, TIPOS_PROPOSTA, type ItemProposta, type Parametros, type TipoProposta } from '../lib/propostas-obra.ts';

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cent = (r: number) => Math.round(r * 100);
const reais = (c: unknown) => (c === null || c === undefined ? 0 : Math.round(Number(c)) / 100);
const uuidOpc = z.string().regex(UUID).optional().nullable().transform((v) => v || null);
const numOpc = z.number().finite().optional().nullable().transform((v) => v ?? undefined);

const esquemaItem = z.object({
  obraItemId: uuidOpc,
  descricao: z.string().trim().min(2, 'Descreva cada item.').max(300),
  unidade: z.string().trim().max(12).default('un'),
  quantidade: z.number({ invalid_type_error: 'Quantidade inválida.' }).positive('Quantidade inválida.').max(10_000_000),
  precoUnitario: z.number({ invalid_type_error: 'Preço inválido.' }).min(0, 'Preço inválido.').max(10_000_000),
});

const esquemaMarco = z.object({ descricao: z.string().trim().min(2, 'Descreva cada marco de pagamento.').max(120), percentual: z.number().gt(0, "Cada marco precisa de percentual maior que zero.").max(100), dias: z.number().int().min(0).max(3650) });

const esquemaProposta = z.object({
  tipo: z.enum(TIPOS_PROPOSTA),
  clienteId: z.string().regex(UUID, 'Escolha o cliente.'),
  obraId: uuidOpc,
  titulo: z.string().trim().min(3, 'Dê um título à proposta.').max(200),
  objeto: z.string().trim().max(4000).optional().nullable().transform((v) => v || null),
  endereco: z.string().trim().max(300).optional().nullable().transform((v) => v || null),
  prazoDias: z.number().int().min(1).max(3650).optional().nullable().transform((v) => v ?? null),
  validadeDias: z.number().int().min(1).max(365).default(30),
  origemPreco: z.enum(['orcamento', 'informado']),
  parametros: z.object({
    dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data de início.'),
    modo: z.enum(['valor_mensal', 'percentual_obra']).optional(),
    honorarioMensal: numOpc,
    percentualObra: numOpc,
    meses: numOpc,
    taxaPct: numOpc,
    baseAdm: z.enum(['custo_direto', 'valor_obra']).optional(),
    valorBaseInformado: numOpc,
    valorInformado: numOpc,
    marcos: z.array(esquemaMarco).max(30).optional(),
    numeroParcelas: numOpc,
    entradaPct: numOpc,
    prazoEntregaDias: numOpc,
  }),
  itens: z.array(esquemaItem).max(300).default([]),
  condicoes: z.string().trim().max(4000).optional().nullable().transform((v) => v || null),
});
type Entrada = z.infer<typeof esquemaProposta>;
/** Só o necessário para calcular: a prévia funciona com o cadastro ainda incompleto. */
const esquemaCalculo = esquemaProposta.pick({ tipo: true, obraId: true, origemPreco: true, parametros: true, itens: true });
type Calculo = z.infer<typeof esquemaCalculo>;

/** Preço de um serviço do orçamento da obra com o BDI da obra (o servidor calcula; o cliente não manda o preço). */
const SQL_SERVICOS = `
  SELECT oi.id, oi.codigo, oi.descricao, oi.unidade,
         round(custo_obra_item(oi.id) * (1 + o.bdi_percentual / 100), 2) AS preco
    FROM obra_itens oi JOIN obras o ON o.id = oi.obra_id
   WHERE oi.obra_id = $1 AND oi.tipo = 'composicao'
   ORDER BY oi.codigo`;

/** Valor da obra (venda) e custo direto, em reais, para as propostas que puxam o orçamento. */
async function contextoObra(c: Cliente, empresaId: string, obraId: string) {
  const r = (
    await c.query(
      `SELECT o.bdi_percentual,
              coalesce((SELECT sum(oq.quantidade * custo_obra_item(oq.obra_item_id)) FROM orcamento_itens oq WHERE oq.obra_id = o.id), 0) AS custo
         FROM obras o WHERE o.id = $1 AND o.empresa_id = $2`,
      [obraId, empresaId],
    )
  ).rows[0];
  if (!r) throw naoEncontrado('Obra');
  const custo = Number(r.custo);
  return { custoDireto: custo, valorObra: custo * (1 + Number(r.bdi_percentual) / 100) };
}

/** Itens com preço do orçamento: o preço unitário vem do servidor, não do cliente. */
async function itensComPreco(c: Cliente, empresaId: string, d: Calculo): Promise<ItemProposta[]> {
  const precos = new Map<string, number>();
  if (d.origemPreco === 'orcamento' && d.obraId) {
    for (const s of (await c.query(SQL_SERVICOS, [d.obraId])).rows) precos.set(s.id, Number(s.preco));
  }
  return d.itens.map((i) => {
    const preco = d.origemPreco === 'orcamento' && i.obraItemId ? precos.get(i.obraItemId) : undefined;
    if (d.origemPreco === 'orcamento' && i.obraItemId && preco === undefined) throw new ErroHttp(400, `"${i.descricao}" não é serviço desta obra.`);
    return { obraItemId: i.obraItemId, descricao: i.descricao, unidade: i.unidade, quantidade: i.quantidade, precoUnitario: preco ?? i.precoUnitario };
  });
}

/** Monta o cálculo completo da proposta (usado no cálculo prévio e na gravação). */
async function calcular(c: Cliente, empresaId: string, d: Calculo) {
  if (d.origemPreco === 'orcamento' && !d.obraId) throw new ErroHttp(400, 'Escolha a obra para puxar o preço do orçamento.');
  const ctx = d.obraId ? await contextoObra(c, empresaId, d.obraId) : null;
  const itens = await itensComPreco(c, empresaId, d);
  const p = d.parametros as Parametros;
  return calcularProposta(d.tipo as TipoProposta, d.origemPreco, p, itens, ctx);
}

const SQL_LISTA = `
  SELECT p.id, p.numero, p.tipo, p.titulo, p.status, p.valor_total_centavos, p.criado_em, p.origem_preco,
         coalesce(cl.nome_fantasia, cl.razao_social) AS cliente_nome, o.codigo AS obra_codigo, ct.numero AS contrato_numero
    FROM propostas_obra p
    JOIN clientes cl ON cl.id = p.cliente_id
    LEFT JOIN obras o ON o.id = p.obra_id
    LEFT JOIN contratos_cliente ct ON ct.proposta_id = p.id`;

function publica(r: Record<string, any>) {
  return {
    id: r.id,
    numero: r.numero,
    tipo: r.tipo,
    tipoNome: NOMES_TIPO[r.tipo as TipoProposta],
    titulo: r.titulo,
    status: r.status,
    valorTotal: reais(r.valor_total_centavos),
    origemPreco: r.origem_preco,
    clienteNome: r.cliente_nome ?? null,
    obraCodigo: r.obra_codigo ?? null,
    contratoNumero: r.contrato_numero ?? null,
    criadoEm: r.criado_em,
  };
}

export function rotasPropostasObra(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.addHook('preHandler', exigir(banco, 'dono', 'gestor', 'vendedor'));
    const gestao = (req: { usuario?: { perfil: string } }) => ['dono', 'gestor'].includes(req.usuario?.perfil ?? '');

    app.get('/obra-propostas/opcoes', async (req) => {
      const empresaId = empresaDo(req);
      const [clientes, obras] = await Promise.all([
        banco.query('SELECT id, coalesce(nome_fantasia, razao_social) AS nome, cnpj_cpf AS documento FROM clientes WHERE empresa_id = $1 AND excluido_em IS NULL AND ativo ORDER BY 2', [empresaId]),
        banco.query(
          `SELECT o.id, o.codigo, o.nome, o.bdi_percentual,
                  coalesce((SELECT sum(oq.quantidade * custo_obra_item(oq.obra_item_id)) FROM orcamento_itens oq WHERE oq.obra_id = o.id), 0) AS custo
             FROM obras o WHERE o.empresa_id = $1 AND o.ativo ORDER BY o.codigo`,
          [empresaId],
        ),
      ]);
      return {
        clientes: clientes.rows,
        obras: obras.rows.map((o) => ({
          id: o.id,
          codigo: o.codigo,
          nome: o.nome,
          bdi: Number(o.bdi_percentual),
          custoDireto: Math.round(Number(o.custo) * 100) / 100,
          valorObra: Math.round(Number(o.custo) * (1 + Number(o.bdi_percentual) / 100) * 100) / 100,
        })),
        tipos: TIPOS_PROPOSTA.map((t) => ({ id: t, nome: NOMES_TIPO[t] })),
      };
    });

    app.get<{ Querystring: { obraId?: string } }>('/obra-propostas/servicos', async (req) => {
      const empresaId = empresaDo(req);
      const obraId = req.query.obraId && UUID.test(req.query.obraId) ? req.query.obraId : null;
      if (!obraId) return { servicos: [] };
      await contextoObra(banco, empresaId, obraId);
      const r = await banco.query(SQL_SERVICOS, [obraId]);
      return { servicos: r.rows.map((s) => ({ id: s.id, codigo: s.codigo, descricao: s.descricao, unidade: s.unidade, preco: Number(s.preco) })) };
    });

    app.get('/obra-propostas', async (req) => {
      const empresaId = empresaDo(req);
      const r = await banco.query(`${SQL_LISTA} WHERE p.empresa_id = $1 ORDER BY p.numero DESC LIMIT 300`, [empresaId]);
      return { propostas: r.rows.map(publica) };
    });

    // Relatório de contratos com clientes no período (data de criação do contrato).
    app.get<{ Querystring: { de?: string; ate?: string } }>('/contratos-cliente/relatorio', async (req) => {
      const empresaId = empresaDo(req);
      const de = DATA.test(req.query.de ?? '') ? req.query.de! : '0001-01-01';
      const ate = DATA.test(req.query.ate ?? '') ? req.query.ate! : '9999-12-31';
      const r = await banco.query(
        `SELECT ct.tipo, ct.valor_total_centavos, ct.status, to_char(ct.criado_em::date, 'YYYY-MM-DD') AS dia,
                coalesce(cl.nome_fantasia, cl.razao_social) AS cliente_nome
           FROM contratos_cliente ct JOIN clientes cl ON cl.id = ct.cliente_id
          WHERE ct.empresa_id = $1 AND ct.criado_em::date BETWEEN $2::date AND $3::date`,
        [empresaId, de, ate],
      );
      type Linha = { nome: string; contratos: number; valor: number };
      const soma = (mapa: Map<string, Linha>, nome: string, valor: number) => {
        const l = mapa.get(nome) ?? { nome, contratos: 0, valor: 0 };
        l.contratos++;
        l.valor += valor;
        mapa.set(nome, l);
      };
      const porTipo = new Map<string, Linha>();
      const porCliente = new Map<string, Linha>();
      let total = 0;
      for (const c of r.rows) {
        const v = reais(c.valor_total_centavos);
        if (c.status === 'cancelado') continue;
        total += v;
        soma(porTipo, NOMES_TIPO[c.tipo as TipoProposta] ?? c.tipo, v);
        soma(porCliente, c.cliente_nome ?? 'Sem nome', v);
      }
      const ordena = (m: Map<string, Linha>) => [...m.values()].sort((a, b) => b.valor - a.valor);
      const ativos = r.rows.filter((c) => c.status !== 'cancelado').length;
      return { de, ate, total: { contratos: ativos, valor: total }, porTipo: ordena(porTipo), porCliente: ordena(porCliente) };
    });

    // Contratos com clientes, gerados pela aceitação de propostas de obra.
    app.get('/contratos-cliente', async (req) => {
      const empresaId = empresaDo(req);
      const r = await banco.query(
        `SELECT ct.id, ct.numero, ct.tipo, ct.titulo, ct.valor_total_centavos, ct.status, ct.criado_em,
                p.id AS proposta_id, p.numero AS proposta_numero, coalesce(cl.nome_fantasia, cl.razao_social) AS cliente_nome,
                o.codigo AS obra_codigo, ct.lancamento_id
           FROM contratos_cliente ct
           JOIN propostas_obra p ON p.id = ct.proposta_id
           JOIN clientes cl ON cl.id = ct.cliente_id
           LEFT JOIN obras o ON o.id = ct.obra_id
          WHERE ct.empresa_id = $1
          ORDER BY ct.numero DESC LIMIT 300`,
        [empresaId],
      );
      return {
        contratos: r.rows.map((c) => ({
          id: c.id,
          numero: c.numero,
          tipo: c.tipo,
          tipoNome: NOMES_TIPO[c.tipo as TipoProposta] ?? c.tipo,
          titulo: c.titulo,
          valorTotal: reais(c.valor_total_centavos),
          status: c.status,
          propostaId: c.proposta_id,
          propostaNumero: c.proposta_numero,
          clienteNome: c.cliente_nome ?? null,
          obraCodigo: c.obra_codigo ?? null,
          lancamentoId: c.lancamento_id ?? null,
          criadoEm: c.criado_em,
        })),
      };
    });

    app.post('/obra-propostas/calcular', async (req) => {
      const d = esquemaCalculo.parse(req.body);
      const empresaId = empresaDo(req);
      const res = await calcular(banco, empresaId, d);
      return { valorTotal: res.valorTotal, parcelas: res.parcelas, itens: res.itens.map((i) => ({ ...i })) };
    });

    app.get<{ Params: { id: string } }>('/obra-propostas/:id', async (req) => {
      const empresaId = empresaDo(req);
      if (!UUID.test(req.params.id)) throw naoEncontrado('Proposta');
      const p = (await banco.query(`${SQL_LISTA} WHERE p.id = $1 AND p.empresa_id = $2`, [req.params.id, empresaId])).rows[0];
      if (!p) throw naoEncontrado('Proposta');
      const [itens, parcelas, completa] = await Promise.all([
        banco.query('SELECT obra_item_id, descricao, unidade, quantidade, preco_unitario_centavos FROM propostas_obra_itens WHERE proposta_id = $1 ORDER BY ordem', [p.id]),
        banco.query('SELECT descricao, vencimento, valor_centavos FROM propostas_obra_parcelas WHERE proposta_id = $1 ORDER BY numero', [p.id]),
        banco.query('SELECT cliente_id, obra_id, objeto, endereco, prazo_dias, validade_dias, parametros, condicoes, enviada_em, decidida_em, criado_por_id FROM propostas_obra WHERE id = $1', [p.id]),
      ]);
      const extra = completa.rows[0];
      return {
        proposta: {
          ...publica(p),
          clienteId: extra.cliente_id,
          obraId: extra.obra_id,
          objeto: extra.objeto,
          endereco: extra.endereco,
          prazoDias: extra.prazo_dias,
          validadeDias: extra.validade_dias,
          parametros: extra.parametros,
          condicoes: extra.condicoes,
          enviadaEm: extra.enviada_em,
          decididaEm: extra.decidida_em,
          itens: itens.rows.map((i) => ({ obraItemId: i.obra_item_id, descricao: i.descricao, unidade: i.unidade, quantidade: Number(i.quantidade), precoUnitario: reais(i.preco_unitario_centavos) })),
          parcelas: parcelas.rows.map((x) => ({ descricao: x.descricao, vencimento: String(x.vencimento).slice(0, 10), valor: reais(x.valor_centavos) })),
        },
      };
    });

    /** Cria ou atualiza uma proposta em rascunho, gravando o cálculo do servidor. */
    async function gravar(req: { body: unknown; usuario?: { id: string } }, empresaId: string, id: string | null) {
      const d = esquemaProposta.parse(req.body);
      const res = await calcular(banco, empresaId, d);
      const usuarioId = req.usuario!.id;
      return emTransacao(banco, async (c) => {
        let propostaId = id;
        if (id) {
          const atual = (await c.query('SELECT status FROM propostas_obra WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [id, empresaId])).rows[0];
          if (!atual) throw naoEncontrado('Proposta');
          if (atual.status !== 'rascunho') throw new ErroHttp(409, 'Só é possível alterar uma proposta em rascunho.');
          await c.query(
            `UPDATE propostas_obra SET tipo=$2, cliente_id=$3, obra_id=$4, titulo=$5, objeto=$6, endereco=$7, prazo_dias=$8, validade_dias=$9,
                    origem_preco=$10, parametros=$11, valor_total_centavos=$12, condicoes=$13, atualizado_em=now()
              WHERE id=$1`,
            [id, d.tipo, d.clienteId, d.obraId, d.titulo, d.objeto, d.endereco, d.prazoDias, d.validadeDias, d.origemPreco, JSON.stringify(d.parametros), cent(res.valorTotal), d.condicoes],
          );
          await c.query('DELETE FROM propostas_obra_itens WHERE proposta_id = $1', [id]);
          await c.query('DELETE FROM propostas_obra_parcelas WHERE proposta_id = $1', [id]);
        } else {
          const numero = (await c.query('SELECT coalesce(max(numero), 0) + 1 AS n FROM propostas_obra WHERE empresa_id = $1', [empresaId])).rows[0].n;
          const nova = (
            await c.query(
              `INSERT INTO propostas_obra (empresa_id, numero, tipo, cliente_id, obra_id, titulo, objeto, endereco, prazo_dias, validade_dias, origem_preco, parametros, valor_total_centavos, condicoes, criado_por_id)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
              [empresaId, numero, d.tipo, d.clienteId, d.obraId, d.titulo, d.objeto, d.endereco, d.prazoDias, d.validadeDias, d.origemPreco, JSON.stringify(d.parametros), cent(res.valorTotal), d.condicoes, usuarioId],
            )
          ).rows[0];
          propostaId = nova.id;
        }
        for (const [i, it] of res.itens.entries()) {
          await c.query(
            `INSERT INTO propostas_obra_itens (empresa_id, proposta_id, ordem, obra_item_id, descricao, unidade, quantidade, preco_unitario_centavos)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [empresaId, propostaId, i + 1, it.obraItemId ?? null, it.descricao, it.unidade, it.quantidade, cent(it.precoUnitario)],
          );
        }
        for (const [i, p] of res.parcelas.entries()) {
          await c.query(
            'INSERT INTO propostas_obra_parcelas (empresa_id, proposta_id, numero, descricao, vencimento, valor_centavos) VALUES ($1,$2,$3,$4,$5,$6)',
            [empresaId, propostaId, i + 1, p.descricao, p.vencimento, cent(p.valor)],
          );
        }
        await auditar(c, { empresaId, usuarioId, acao: id ? 'alterar' : 'criar', entidade: 'propostas_obra', entidadeId: propostaId!, depois: { tipo: d.tipo, valorTotal: res.valorTotal } });
        return propostaId!;
      });
    }

    app.post('/obra-propostas', async (req, reply) => {
      const id = await gravar(req as never, empresaDo(req), null);
      reply.code(201);
      return { id };
    });

    app.put<{ Params: { id: string } }>('/obra-propostas/:id', async (req) => {
      if (!UUID.test(req.params.id)) throw naoEncontrado('Proposta');
      const id = await gravar(req as never, empresaDo(req), req.params.id);
      return { id };
    });

    /** Muda o status de uma proposta, com as regras de cada transição. */
    async function transicao(req: { params: { id: string }; usuario?: { id: string } } & object, empresaId: string, de: string[], para: string, acao: string) {
      if (!UUID.test(req.params.id)) throw naoEncontrado('Proposta');
      return emTransacao(banco, async (c) => {
        const p = (await c.query('SELECT status FROM propostas_obra WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [req.params.id, empresaId])).rows[0];
        if (!p) throw naoEncontrado('Proposta');
        if (!de.includes(p.status)) throw new ErroHttp(409, `Esta proposta está ${p.status === 'rascunho' ? 'em rascunho' : p.status}; não é possível ${acao}.`);
        await c.query(
          `UPDATE propostas_obra SET status = $2, enviada_em = CASE WHEN $2 = 'enviada' THEN now() ELSE enviada_em END,
                  decidida_em = CASE WHEN $2 IN ('recusada', 'cancelada') THEN now() ELSE decidida_em END, atualizado_em = now()
            WHERE id = $1`,
          [req.params.id, para],
        );
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'propostas_obra', entidadeId: req.params.id, depois: { status: para } });
      });
    }

    app.post<{ Params: { id: string } }>('/obra-propostas/:id/enviar', async (req) => {
      await transicao(req as never, empresaDo(req), ['rascunho'], 'enviada', 'enviar');
      return { ok: true };
    });

    app.post<{ Params: { id: string } }>('/obra-propostas/:id/recusar', async (req) => {
      if (!gestao(req as never)) throw new ErroHttp(403, 'Só o dono ou o gestor registra a recusa.');
      await transicao(req as never, empresaDo(req), ['enviada'], 'recusada', 'recusar');
      return { ok: true };
    });

    app.post<{ Params: { id: string } }>('/obra-propostas/:id/cancelar', async (req) => {
      await transicao(req as never, empresaDo(req), ['rascunho', 'enviada'], 'cancelada', 'cancelar');
      return { ok: true };
    });

    /**
     * Aceitação: gera o contrato com o cliente e o lançamento a receber (com apropriação e parcelas),
     * tudo na mesma transação. Só dono ou gestor aceita.
     */
    app.post<{ Params: { id: string } }>('/obra-propostas/:id/aceitar', async (req) => {
      if (!gestao(req as never)) throw new ErroHttp(403, 'Só o dono ou o gestor aceita a proposta.');
      if (!UUID.test(req.params.id)) throw naoEncontrado('Proposta');
      const empresaId = empresaDo(req);
      const usuarioId = req.usuario!.id;
      const contrato = await emTransacao(banco, async (c) => {
        const p = (await c.query(
          `SELECT p.*, coalesce(cl.nome_fantasia, cl.razao_social) AS cliente_nome, o.centro_custo_id AS obra_centro
             FROM propostas_obra p JOIN clientes cl ON cl.id = p.cliente_id LEFT JOIN obras o ON o.id = p.obra_id
            WHERE p.id = $1 AND p.empresa_id = $2 FOR UPDATE OF p`,
          [req.params.id, empresaId],
        )).rows[0];
        if (!p) throw naoEncontrado('Proposta');
        if (p.status !== 'enviada') throw new ErroHttp(409, `Só é possível aceitar proposta enviada (esta está ${p.status === 'rascunho' ? 'em rascunho' : p.status}).`);
        const parcelas = (await c.query('SELECT descricao, vencimento, valor_centavos FROM propostas_obra_parcelas WHERE proposta_id = $1 ORDER BY numero', [p.id])).rows;
        if (!parcelas.length) throw new ErroHttp(400, 'A proposta não tem cronograma de recebimento.');
        if (parcelas.some((x) => Number(x.valor_centavos) <= 0)) throw new ErroHttp(400, 'Há parcela com valor zero no cronograma; revise a proposta.');
        const plano = (await c.query(
          `SELECT id FROM plano_contas WHERE empresa_id = $1 AND tipo = 'receita' AND aceita_lancamento AND ativo ORDER BY codigo LIMIT 1`,
          [empresaId],
        )).rows[0];
        if (!plano) throw new ErroHttp(400, 'Cadastre o plano de contas (Financeiro › Plano de contas) antes de aceitar propostas.');
        const numeroLanc = `Proposta ${String(p.numero).padStart(4, '0')}`;
        const competencia = String(parcelas[0].vencimento).slice(0, 10);
        const lancamento = (await c.query(
          `INSERT INTO lancamentos (empresa_id, tipo, competencia, descricao, documento, valor_total_centavos, cliente_id, origem, observacoes, criado_por_id)
           VALUES ($1,'receita',$2,$3,$4,$5,$6,'propostas_obra',$7,$8) RETURNING id`,
          [empresaId, competencia, `${p.cliente_nome} · ${p.titulo}`.slice(0, 300), numeroLanc, p.valor_total_centavos, p.cliente_id,
            `Gerado pela aceitação da ${NOMES_TIPO[p.tipo as TipoProposta].toLowerCase()} nº ${p.numero}.`, usuarioId],
        )).rows[0];
        await c.query(
          'INSERT INTO apropriacoes (empresa_id, lancamento_id, plano_conta_id, centro_custo_id, descricao, valor_centavos) VALUES ($1,$2,$3,$4,$5,$6)',
          [empresaId, lancamento.id, plano.id, p.obra_centro ?? null, NOMES_TIPO[p.tipo as TipoProposta], p.valor_total_centavos],
        );
        for (const [i, par] of parcelas.entries()) {
          await c.query(
            'INSERT INTO parcelas (empresa_id, lancamento_id, numero, vencimento, valor_centavos, observacoes) VALUES ($1,$2,$3,$4,$5,$6)',
            [empresaId, lancamento.id, i + 1, par.vencimento, par.valor_centavos, par.descricao],
          );
        }
        const numero = (await c.query('SELECT coalesce(max(numero), 0) + 1 AS n FROM contratos_cliente WHERE empresa_id = $1', [empresaId])).rows[0].n;
        const ct = (await c.query(
          `INSERT INTO contratos_cliente (empresa_id, numero, proposta_id, cliente_id, obra_id, tipo, titulo, valor_total_centavos, lancamento_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, numero`,
          [empresaId, numero, p.id, p.cliente_id, p.obra_id, p.tipo, p.titulo, p.valor_total_centavos, lancamento.id],
        )).rows[0];
        await c.query(`UPDATE propostas_obra SET status = 'aceita', decidida_em = now(), atualizado_em = now() WHERE id = $1`, [p.id]);
        await auditar(c, { empresaId, usuarioId, acao: 'confirmar', entidade: 'propostas_obra', entidadeId: p.id, depois: { contrato: ct.numero, lancamento: lancamento.id } });
        return { id: ct.id, numero: ct.numero, lancamentoId: lancamento.id };
      });
      return { contrato };
    });
  };
}
