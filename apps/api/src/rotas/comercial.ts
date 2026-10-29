// Módulo Comercial: o vendedor lança as vendas; o dono ou o gestor aprova; aprovada, a venda entra na programação da Produção.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Banco, Cliente } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { cnpjValido } from '../lib/cnpj.ts';
import { cpfValido, hojeBrasil } from '../lib/frota.ts';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';
import { empresaDo, exigir } from '../sessao.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const reais = (c: unknown) => (c === null || c === undefined ? null : Math.round(Number(c)) / 100);
const cent = (r: number) => Math.round(r * 100);
const r2 = (n: number) => Math.round(n * 100) / 100;
const texto = (max = 200) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const decimal = (msg: string) =>
  z.union([z.number(), z.string()]).transform((v, ctx) => {
    const n = typeof v === 'number' ? v : Number(String(v).replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: 'custom', message: msg });
      return z.NEVER;
    }
    return n;
  });

export const FORMAS = ['pix', 'boleto', 'transferencia', 'cartao', 'dinheiro', 'cheque', 'debito_automatico', 'permuta'] as const;
export const TIPOS_ADICIONAL = ['feriado', 'hora_excedente', 'equipamento_parado', 'volume_minimo', 'outro'] as const;
const NOMES_FORMA: Record<string, string> = { pix: 'PIX', boleto: 'boleto', transferencia: 'transferência', cartao: 'cartão', dinheiro: 'dinheiro', cheque: 'cheque', debito_automatico: 'débito automático', permuta: 'permuta' };

/** "28 dias no boleto", "30/60 dias no boleto", "À vista no PIX". */
export function textoCondicao(forma: string | null, prazos: number[] | null): string | null {
  if (!prazos?.length) return null;
  const f = forma ? ` no ${NOMES_FORMA[forma] ?? forma}` : '';
  if (prazos.length === 1 && prazos[0] === 0) return `À vista${f}`;
  return `${prazos.join('/')} dias${f}`;
}

/** Divide o valor nas parcelas (a diferença de centavos vai na primeira) e calcula os vencimentos a partir da data base. */
export function parcelasDaVenda(totalCentavos: number, prazos: number[], base: string, somar: (d: string, n: number) => string) {
  const n = prazos.length;
  const cada = Math.floor(totalCentavos / n);
  return prazos.map((dias, i) => ({ vencimento: somar(base, dias), valor: i === 0 ? totalCentavos - cada * (n - 1) : cada }));
}

export const STATUS_VENDA = ['rascunho', 'aguardando_aprovacao', 'aprovada', 'reprovada', 'concluida', 'cancelada'] as const;

const esquemaVenda = z.object({
  vendedorId: z.union([z.string().uuid(), z.literal(''), z.null()]).optional().transform((v) => v || null),
  clienteId: z.string({ required_error: 'Escolha o cliente.' }).uuid('Escolha o cliente.'),
  obra: texto(200),
  endereco: texto(300),
  contato: texto(200),
  tracoId: z.string({ required_error: 'Escolha o traço.' }).uuid('Escolha o traço.'),
  volume: decimal('Volume inválido.').refine((n) => n > 0 && n <= 5000, 'Informe o volume vendido em m³.'),
  dataEntrega: z.string({ required_error: 'Informe a data da entrega.' }).regex(DATA, 'Informe a data da entrega.'),
  horaEntrega: z.union([z.string().regex(/^\d{2}:\d{2}$/, 'Hora inválida.'), z.literal(''), z.null()]).optional().transform((v) => v || null),
  bombeamento: z.boolean().optional().default(false),
  precoM3: decimal('Preço inválido.').refine((n) => n >= 0, 'Preço inválido.'),
  taxaBomba: z.union([decimal('Taxa de bombeamento inválida.'), z.null()]).optional().transform((v) => (v === undefined ? null : v)),
  condicaoPagamento: texto(200),
  formaPagamento: z.enum(FORMAS).optional().nullable().or(z.literal('').transform(() => null)),
  prazosDias: z.array(z.number().int().min(0, 'Prazo inválido.').max(365, 'Prazo de até 365 dias.')).max(12, 'Até 12 parcelas.').optional().nullable(),
  observacoes: texto(1000),
  enviar: z.boolean().optional().default(false),
});

const esquemaClienteRapido = z.object({
  razaoSocial: z.string({ required_error: 'Informe o nome do cliente.' }).trim().min(2, 'Informe o nome do cliente.').max(200),
  cnpjCpf: z.union([z.string(), z.null()]).optional().transform((v) => (v ?? '').replace(/\D/g, '') || null),
  telefone: texto(40),
  cidade: texto(120),
  uf: z.string().trim().toUpperCase().length(2, 'UF com 2 letras.').optional().nullable().or(z.literal('').transform(() => null)),
});

/** Dono e gestor veem e aprovam todas as vendas; os demais, só as próprias. */
const gestaoComercial = (req: FastifyRequest) => req.usuario!.perfil === 'dono' || req.usuario!.perfil === 'gestor';

const SELECT_VENDA = `
  SELECT v.*, coalesce(cl.nome_fantasia, cl.razao_social) AS cliente_nome, cl.telefone AS cliente_telefone, t.codigo AS traco_codigo, t.descricao AS traco_descricao,
         uv.nome AS vendedor_nome, ua.nome AS aprovado_por, uc.nome AS criado_por,
         coalesce((SELECT sum(c.volume_m3) FROM cargas c WHERE c.venda_id = v.id AND c.status = 'produzida'), 0) AS entregue_m3,
         coalesce((SELECT sum(c.devolvido_m3) FROM cargas c WHERE c.venda_id = v.id AND c.status = 'produzida'), 0) AS devolvido_m3,
         (SELECT count(*) FROM cargas c WHERE c.venda_id = v.id AND c.status = 'produzida') AS cargas,
         EXISTS (SELECT 1 FROM cargas c WHERE c.venda_id = v.id AND c.status = 'produzida' AND c.carga_final) AS tem_carga_final
    FROM vendas v JOIN clientes cl ON cl.id = v.cliente_id JOIN tracos t ON t.id = v.traco_id
    JOIN usuarios uv ON uv.id = v.vendedor_id LEFT JOIN usuarios ua ON ua.id = v.aprovado_por_id LEFT JOIN usuarios uc ON uc.id = v.criado_por_id`;

export function vendaPublica(r: Record<string, any>) {
  const volume = Number(r.volume_m3);
  const entregue = Number(r.entregue_m3 ?? 0);
  const preco = Number(r.preco_m3_centavos);
  const taxa = r.taxa_bomba_centavos === null ? 0 : Number(r.taxa_bomba_centavos);
  return {
    id: r.id as string,
    numero: r.numero as number,
    vendedorId: r.vendedor_id as string,
    vendedorNome: r.vendedor_nome as string,
    clienteId: r.cliente_id as string,
    clienteNome: r.cliente_nome as string,
    clienteTelefone: (r.cliente_telefone ?? null) as string | null,
    obra: r.obra as string | null,
    endereco: r.endereco as string | null,
    contato: r.contato as string | null,
    tracoId: r.traco_id as string,
    tracoCodigo: r.traco_codigo as string,
    tracoDescricao: (r.traco_descricao ?? null) as string | null,
    volume,
    dataEntrega: r.data_entrega instanceof Date ? r.data_entrega.toISOString().slice(0, 10) : String(r.data_entrega).slice(0, 10),
    horaEntrega: r.hora_entrega ? String(r.hora_entrega).slice(0, 5) : null,
    bombeamento: !!r.bombeamento,
    precoM3: reais(preco)!,
    taxaBomba: reais(r.taxa_bomba_centavos),
    valorTotal: reais(Math.round(volume * preco) + taxa)!,
    condicaoPagamento: (r.condicao_pagamento ?? textoCondicao(r.forma_pagamento, r.prazos_dias)) as string | null,
    formaPagamento: (r.forma_pagamento ?? null) as string | null,
    prazosDias: (r.prazos_dias ?? null) as number[] | null,
    entregaFinalizadaEm: r.entrega_finalizada_em ?? null,
    lancamentoId: (r.lancamento_id ?? null) as string | null,
    cargaFinal: !!r.tem_carga_final,
    observacoes: r.observacoes as string | null,
    status: r.status as (typeof STATUS_VENDA)[number],
    motivo: r.motivo as string | null,
    enviadoEm: r.enviado_aprovacao_em,
    aprovadoPor: (r.aprovado_por ?? null) as string | null,
    aprovadoEm: r.aprovado_em,
    criadoPor: (r.criado_por ?? null) as string | null,
    criadoEm: r.criado_em,
    entregue: r2(entregue),
    devolvido: r2(Number(r.devolvido_m3 ?? 0)),
    saldo: r2(Math.max(volume - entregue, 0)),
    cargas: Number(r.cargas ?? 0),
  };
}

export async function carregarVenda(c: Cliente, empresaId: string, id: string) {
  if (!UUID.test(id)) throw naoEncontrado('Venda');
  const r = (await c.query(`${SELECT_VENDA} WHERE v.id = $1 AND v.empresa_id = $2`, [id, empresaId])).rows[0];
  if (!r) throw naoEncontrado('Venda');
  return r;
}

/** Aprovada e toda entregue → concluída; carga cancelada que deixa saldo → volta a aprovada. */
export async function atualizarSituacaoVenda(c: Cliente, vendaId: string | null | undefined): Promise<void> {
  if (!vendaId) return;
  // Concluída quando as cargas somam o volume vendido ou quando o operador marca a carga final.
  await c.query(
    `UPDATE vendas v SET status = x.novo, atualizado_em = now()
       FROM (SELECT CASE WHEN coalesce(sum(volume_m3), 0) >= (SELECT volume_m3 FROM vendas WHERE id = $1) OR bool_or(carga_final) THEN 'concluida' ELSE 'aprovada' END AS novo
               FROM cargas WHERE venda_id = $1 AND status = 'produzida') x
      WHERE v.id = $1 AND v.status IN ('aprovada', 'concluida') AND v.encerrada_em IS NULL AND v.entrega_finalizada_em IS NULL AND v.status <> x.novo`,
    [vendaId],
  );
}

function periodo(q: Record<string, string | undefined>) {
  const hoje = hojeBrasil();
  const de = q.de && DATA.test(q.de) ? q.de : `${hoje.slice(0, 7)}-01`;
  const [a, m] = hoje.split('-').map(Number);
  const fimMes = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  const ate = q.ate && DATA.test(q.ate) ? q.ate : fimMes;
  if (ate < de) throw new ErroHttp(400, 'A data final é antes da inicial.');
  return { de, ate };
}

export function rotasComercial(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.addHook('preHandler', exigir(banco, 'dono', 'gestor', 'vendedor'));

    async function validar(c: Cliente, empresaId: string, req: FastifyRequest, d: z.infer<typeof esquemaVenda>) {
      if (d.enviar && !d.prazosDias?.length) throw new ErroHttp(400, 'Informe a condição de pagamento (prazos em dias) antes de enviar.');
      if (!(await c.query('SELECT 1 FROM clientes WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL', [d.clienteId, empresaId])).rowCount) {
        throw new ErroHttp(400, 'Cliente não encontrado.');
      }
      if (!(await c.query('SELECT 1 FROM tracos WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL', [d.tracoId, empresaId])).rowCount) {
        throw new ErroHttp(400, 'Traço não encontrado.');
      }
      // Vendedor: quem lança. Dono e gestor podem lançar em nome de um vendedor.
      let vendedorId = req.usuario!.id;
      if (d.vendedorId && d.vendedorId !== vendedorId) {
        if (!gestaoComercial(req)) throw new ErroHttp(403, 'Você só lança vendas em seu nome.');
        const v = (await c.query('SELECT 1 FROM usuarios WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL', [d.vendedorId, empresaId])).rowCount;
        if (!v) throw new ErroHttp(400, 'Vendedor não encontrado.');
        vendedorId = d.vendedorId;
      }
      return vendedorId;
    }

    async function vendaDoUsuario(c: Cliente, req: FastifyRequest, id: string) {
      const r = await carregarVenda(c, empresaDo(req), id);
      if (!gestaoComercial(req) && r.vendedor_id !== req.usuario!.id && r.criado_por_id !== req.usuario!.id) throw naoEncontrado('Venda');
      return r;
    }

    app.get('/opcoes', async (req) => {
      const empresaId = empresaDo(req);
      const [clientes, tracos, vendedores] = await Promise.all([
        banco.query('SELECT id, coalesce(nome_fantasia, razao_social) AS nome, cidade FROM clientes WHERE empresa_id = $1 AND excluido_em IS NULL AND ativo ORDER BY 2', [empresaId]),
        banco.query('SELECT id, codigo, descricao, fck, slump FROM tracos WHERE empresa_id = $1 AND excluido_em IS NULL AND ativo ORDER BY fck NULLS LAST, codigo', [empresaId]),
        banco.query(
          `SELECT id, nome, perfil FROM usuarios WHERE empresa_id = $1 AND excluido_em IS NULL AND ativo AND (perfil = 'vendedor' OR id = $2) ORDER BY nome`,
          [empresaId, req.usuario!.id],
        ),
      ]);
      // Preço de referência: o último preço de cada traço nas vendas aprovadas.
      const precos = await banco.query(
        `SELECT DISTINCT ON (traco_id) traco_id, preco_m3_centavos FROM vendas WHERE empresa_id = $1 AND status IN ('aprovada', 'concluida')
          ORDER BY traco_id, aprovado_em DESC NULLS LAST`,
        [empresaId],
      );
      return {
        clientes: clientes.rows,
        tracos: tracos.rows.map((t) => ({ id: t.id, codigo: t.codigo, descricao: t.descricao, fck: t.fck, slump: t.slump })),
        vendedores: gestaoComercial(req) ? vendedores.rows.map((v) => ({ id: v.id, nome: v.nome })) : [],
        ultimoPreco: Object.fromEntries(precos.rows.map((p) => [p.traco_id, reais(p.preco_m3_centavos)])),
        gestao: gestaoComercial(req),
      };
    });

    app.post('/clientes', async (req, reply) => {
      const d = esquemaClienteRapido.parse(req.body);
      if (d.cnpjCpf && !(d.cnpjCpf.length === 14 ? cnpjValido(d.cnpjCpf) : d.cnpjCpf.length === 11 ? cpfValido(d.cnpjCpf) : false)) {
        throw new ErroHttp(400, 'CPF ou CNPJ inválido.');
      }
      const empresaId = empresaDo(req);
      try {
        const n = await emTransacao(banco, async (c) => {
          const novo = (
            await c.query(
              `INSERT INTO clientes (empresa_id, tipo_pessoa, cnpj_cpf, razao_social, telefone, cidade, uf) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, razao_social, cidade`,
              [empresaId, d.cnpjCpf?.length === 11 ? 'PF' : 'PJ', d.cnpjCpf, d.razaoSocial, d.telefone, d.cidade, d.uf ?? null],
            )
          ).rows[0];
          await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'clientes', entidadeId: novo.id, depois: { ...d, origem: 'comercial' } });
          return novo;
        });
        reply.code(201);
        return { cliente: { id: n.id, nome: n.razao_social, cidade: n.cidade } };
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new ErroHttp(409, 'Já existe um cliente com este CPF ou CNPJ.');
        throw e;
      }
    });

    app.get<{ Querystring: Record<string, string | undefined> }>('/vendas', async (req) => {
      const empresaId = empresaDo(req);
      const q = req.query;
      const p: unknown[] = [empresaId];
      const f: string[] = [];
      if (!gestaoComercial(req)) {
        p.push(req.usuario!.id);
        f.push(`(v.vendedor_id = $${p.length} OR v.criado_por_id = $${p.length})`);
      } else if (q.vendedorId && UUID.test(q.vendedorId)) {
        p.push(q.vendedorId);
        f.push(`v.vendedor_id = $${p.length}`);
      }
      if (q.status && (STATUS_VENDA as readonly string[]).includes(q.status)) {
        p.push(q.status);
        f.push(`v.status = $${p.length}`);
      }
      if (q.de && DATA.test(q.de)) {
        p.push(q.de);
        f.push(`v.data_entrega >= $${p.length}`);
      }
      if (q.ate && DATA.test(q.ate)) {
        p.push(q.ate);
        f.push(`v.data_entrega <= $${p.length}`);
      }
      const r = await banco.query(`${SELECT_VENDA} WHERE v.empresa_id = $1 ${f.map((x) => `AND ${x}`).join(' ')} ORDER BY v.data_entrega DESC, v.numero DESC LIMIT 500`, p);
      return { vendas: r.rows.map(vendaPublica) };
    });

    app.get<{ Params: { id: string } }>('/vendas/:id', async (req) => {
      const r = await vendaDoUsuario(banco, req, req.params.id);
      const cargas = await banco.query(
        `SELECT c.id, c.numero, c.data_hora, c.volume_m3, c.devolvido_m3, c.status, c.carga_final, c.descarga_em, c.slump_entrega_cm, b.codigo AS betoneira, m.nome AS motorista
           FROM cargas c JOIN veiculos b ON b.id = c.betoneira_id LEFT JOIN motoristas m ON m.id = c.motorista_id
          WHERE c.venda_id = $1 ORDER BY c.data_hora`,
        [r.id],
      );
      const u = req.usuario!;
      const dono = r.vendedor_id === u.id || r.criado_por_id === u.id;
      const adicionais = (
        await banco.query(`SELECT a.*, u.nome AS criado_por FROM vendas_adicionais a LEFT JOIN usuarios u ON u.id = a.criado_por_id WHERE a.venda_id = $1 ORDER BY a.criado_em`, [r.id])
      ).rows.map((a) => ({ id: a.id, tipo: a.tipo, descricao: a.descricao, valor: reais(a.valor_centavos)!, criadoPor: a.criado_por }));
      const fat = await calcularFaturamento(banco, r);
      const lanc = r.lancamento_id
        ? (await banco.query(`SELECT p.numero, p.vencimento, p.valor_centavos, p.status FROM parcelas p WHERE p.lancamento_id = $1 ORDER BY p.numero`, [r.lancamento_id])).rows.map((p) => ({
            numero: p.numero, vencimento: p.vencimento, valor: reais(p.valor_centavos)!, status: p.status,
          }))
        : [];
      return {
        venda: vendaPublica(r),
        cargas: cargas.rows.map((c) => ({
          id: c.id, numero: c.numero, dataHora: c.data_hora, volume: Number(c.volume_m3), devolvido: Number(c.devolvido_m3), status: c.status, betoneira: c.betoneira, motorista: c.motorista,
          cargaFinal: !!c.carga_final, descargaEm: c.descarga_em, slumpEntrega: c.slump_entrega_cm === null ? null : Number(c.slump_entrega_cm),
        })),
        adicionais,
        faturamento: { ...fat, parcelas: lanc },
        pode: {
          finalizar: !r.lancamento_id && !r.entrega_finalizada_em && r.status === 'concluida' && (dono || gestaoComercial(req)),
          editar: ['rascunho', 'reprovada'].includes(r.status) && (dono || gestaoComercial(req)),
          enviar: ['rascunho', 'reprovada'].includes(r.status) && (dono || gestaoComercial(req)),
          aprovar: r.status === 'aguardando_aprovacao' && gestaoComercial(req),
          cancelar: ['rascunho', 'aguardando_aprovacao', 'reprovada'].includes(r.status) ? dono || gestaoComercial(req) : r.status === 'aprovada' && gestaoComercial(req),
        },
      };
    });

    app.post('/vendas', async (req, reply) => {
      const d = esquemaVenda.parse(req.body);
      const empresaId = empresaDo(req);
      const id = await emTransacao(banco, async (c) => {
        const vendedorId = await validar(c, empresaId, req, d);
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`vendas:${empresaId}`]);
        const numero = Number((await c.query('SELECT coalesce(max(numero), 0) + 1 AS n FROM vendas WHERE empresa_id = $1', [empresaId])).rows[0].n);
        const x = (
          await c.query(
            `INSERT INTO vendas (empresa_id, numero, vendedor_id, cliente_id, obra, endereco, contato, traco_id, volume_m3, data_entrega, hora_entrega, bombeamento,
                                 preco_m3_centavos, taxa_bomba_centavos, condicao_pagamento, observacoes, status, enviado_aprovacao_em, criado_por_id, forma_pagamento, prazos_dias)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id`,
            [empresaId, numero, vendedorId, d.clienteId, d.obra, d.endereco, d.contato, d.tracoId, d.volume, d.dataEntrega, d.horaEntrega, d.bombeamento,
              cent(d.precoM3), d.bombeamento && d.taxaBomba !== null ? cent(d.taxaBomba) : null, textoCondicao(d.formaPagamento ?? null, d.prazosDias ?? null) ?? d.condicaoPagamento, d.observacoes,
              d.enviar ? 'aguardando_aprovacao' : 'rascunho', d.enviar ? new Date().toISOString() : null, req.usuario!.id, d.formaPagamento ?? null, d.prazosDias?.length ? d.prazosDias : null],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'vendas', entidadeId: x.id, depois: { ...d, numero } });
        return x.id as string;
      });
      reply.code(201);
      return { venda: vendaPublica(await carregarVenda(banco, empresaId, id)) };
    });

    app.put<{ Params: { id: string } }>('/vendas/:id', async (req) => {
      const d = esquemaVenda.parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const antes = await vendaDoUsuario(c, req, req.params.id);
        if (!['rascunho', 'reprovada'].includes(antes.status)) throw new ErroHttp(409, 'Só dá para alterar a venda em rascunho ou reprovada.');
        const vendedorId = await validar(c, empresaId, req, { ...d, vendedorId: d.vendedorId ?? antes.vendedor_id });
        await c.query(
          `UPDATE vendas SET vendedor_id = $3, cliente_id = $4, obra = $5, endereco = $6, contato = $7, traco_id = $8, volume_m3 = $9, data_entrega = $10, hora_entrega = $11,
                  bombeamento = $12, preco_m3_centavos = $13, taxa_bomba_centavos = $14, condicao_pagamento = $15, observacoes = $16,
                  status = $17, enviado_aprovacao_em = $18, forma_pagamento = $19, prazos_dias = $20, motivo = CASE WHEN $17 = 'aguardando_aprovacao' THEN NULL ELSE motivo END, atualizado_em = now()
            WHERE id = $1 AND empresa_id = $2`,
          [antes.id, empresaId, vendedorId, d.clienteId, d.obra, d.endereco, d.contato, d.tracoId, d.volume, d.dataEntrega, d.horaEntrega, d.bombeamento,
            cent(d.precoM3), d.bombeamento && d.taxaBomba !== null ? cent(d.taxaBomba) : null, textoCondicao(d.formaPagamento ?? null, d.prazosDias ?? null) ?? d.condicaoPagamento, d.observacoes,
            d.enviar ? 'aguardando_aprovacao' : antes.status, d.enviar ? new Date().toISOString() : antes.enviado_aprovacao_em, d.formaPagamento ?? null, d.prazosDias?.length ? d.prazosDias : null],
        );
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'vendas', entidadeId: antes.id, antes: vendaPublica(antes), depois: d });
      });
      return { venda: vendaPublica(await carregarVenda(banco, empresaId, req.params.id)) };
    });

    app.post<{ Params: { id: string } }>('/vendas/:id/enviar', async (req) => {
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const v = await vendaDoUsuario(c, req, req.params.id);
        if (!['rascunho', 'reprovada'].includes(v.status)) throw new ErroHttp(409, 'Esta venda já foi enviada.');
        await c.query(`UPDATE vendas SET status = 'aguardando_aprovacao', enviado_aprovacao_em = now(), motivo = NULL, atualizado_em = now() WHERE id = $1`, [v.id]);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'enviar', entidade: 'vendas', entidadeId: v.id });
      });
      return { venda: vendaPublica(await carregarVenda(banco, empresaId, req.params.id)) };
    });

    app.post<{ Params: { id: string } }>('/vendas/:id/aprovar', async (req) => {
      if (!gestaoComercial(req)) throw new ErroHttp(403, 'Só o dono ou o gestor aprova vendas.');
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const v = await carregarVenda(c, empresaId, req.params.id);
        if (v.status !== 'aguardando_aprovacao') throw new ErroHttp(409, 'Esta venda não está aguardando aprovação.');
        await c.query(`UPDATE vendas SET status = 'aprovada', aprovado_por_id = $2, aprovado_em = now(), motivo = NULL, atualizado_em = now() WHERE id = $1`, [v.id, req.usuario!.id]);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'aprovar', entidade: 'vendas', entidadeId: v.id });
      });
      return { venda: vendaPublica(await carregarVenda(banco, empresaId, req.params.id)) };
    });

    app.post<{ Params: { id: string } }>('/vendas/:id/reprovar', async (req) => {
      if (!gestaoComercial(req)) throw new ErroHttp(403, 'Só o dono ou o gestor reprova vendas.');
      const { motivo } = z.object({ motivo: z.string({ required_error: 'Informe o motivo.' }).trim().min(3, 'Informe o motivo.').max(500) }).parse(req.body ?? {});
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const v = await carregarVenda(c, empresaId, req.params.id);
        if (v.status !== 'aguardando_aprovacao') throw new ErroHttp(409, 'Esta venda não está aguardando aprovação.');
        await c.query(`UPDATE vendas SET status = 'reprovada', motivo = $2, atualizado_em = now() WHERE id = $1`, [v.id, motivo]);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'reprovar', entidade: 'vendas', entidadeId: v.id, depois: { motivo } });
      });
      return { venda: vendaPublica(await carregarVenda(banco, empresaId, req.params.id)) };
    });

    app.post<{ Params: { id: string } }>('/vendas/:id/cancelar', async (req) => {
      const { motivo } = z.object({ motivo: z.string({ required_error: 'Informe o motivo.' }).trim().min(3, 'Informe o motivo do cancelamento.').max(500) }).parse(req.body ?? {});
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const v = await vendaDoUsuario(c, req, req.params.id);
        if (['cancelada', 'concluida'].includes(v.status)) throw new ErroHttp(409, 'Esta venda já foi encerrada.');
        if (v.status === 'aprovada' && !gestaoComercial(req)) throw new ErroHttp(403, 'Venda aprovada só o dono ou o gestor cancela.');
        await c.query(`UPDATE vendas SET status = 'cancelada', motivo = $2, atualizado_em = now() WHERE id = $1`, [v.id, motivo]);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'cancelar', entidade: 'vendas', entidadeId: v.id, depois: { motivo } });
      });
      return { venda: vendaPublica(await carregarVenda(banco, empresaId, req.params.id)) };
    });

    /**
     * Entrega finalizada pelo vendedor (depois da carga final do operador): o valor entregue, a taxa da bomba e os adicionais
     * contratuais viram receita em Contas a receber, nas parcelas da condição de pagamento.
     */
    app.post<{ Params: { id: string } }>('/vendas/:id/finalizar-entrega', async (req) => {
      const d = z
        .object({
          adicionais: z
            .array(
              z.object({
                tipo: z.enum(TIPOS_ADICIONAL).optional().default('outro'),
                descricao: z.string({ required_error: 'Descreva o adicional.' }).trim().min(2, 'Descreva o adicional.').max(200),
                valor: decimal('Valor do adicional inválido.').refine((n) => n > 0, 'O valor do adicional precisa ser maior que zero.'),
              }),
            )
            .max(20)
            .optional()
            .default([]),
          formaPagamento: z.enum(FORMAS).optional().nullable(),
          prazosDias: z.array(z.number().int().min(0).max(365)).max(12).optional().nullable(),
          observacao: texto(300),
        })
        .parse(req.body ?? {});
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const v = await vendaDoUsuario(c, req, req.params.id);
        await c.query('SELECT 1 FROM vendas WHERE id = $1 FOR UPDATE', [v.id]);
        if (v.lancamento_id || v.entrega_finalizada_em) throw new ErroHttp(409, 'A entrega desta venda já foi finalizada.');
        if (v.status !== 'concluida') throw new ErroHttp(409, 'O operador ainda não marcou a carga final desta venda (ou as cargas não somam o volume vendido).');
        const prazos = d.prazosDias?.length ? d.prazosDias : (v.prazos_dias as number[] | null);
        const forma = d.formaPagamento ?? v.forma_pagamento ?? null;
        if (!prazos?.length) throw new ErroHttp(400, 'Informe a condição de pagamento (prazos em dias).');
        for (const a of d.adicionais) {
          await c.query('INSERT INTO vendas_adicionais (empresa_id, venda_id, tipo, descricao, valor_centavos, criado_por_id) VALUES ($1,$2,$3,$4,$5,$6)', [
            empresaId, v.id, a.tipo, a.descricao, cent(a.valor), req.usuario!.id,
          ]);
        }
        const f = await calcularFaturamento(c, v);
        const total = cent(f.total);
        if (total <= 0) throw new ErroHttp(400, 'Não há valor a faturar: nenhuma carga entregue nesta venda.');
        const contas = Object.fromEntries((await c.query(`SELECT codigo, id FROM plano_contas WHERE empresa_id = $1 AND codigo IN ('1.1', '1.2', '1.3', '1')`, [empresaId])).rows.map((x) => [x.codigo, x.id]));
        const centros = Object.fromEntries((await c.query(`SELECT nome, id FROM centros_custo WHERE empresa_id = $1`, [empresaId])).rows.map((x) => [x.nome, x.id]));
        const conta = (cod: string) => contas[cod] ?? contas['1.1'] ?? contas['1'];
        if (!conta('1.1')) throw new ErroHttp(400, 'Cadastre o plano de contas (Financeiro › Plano de contas › Completar com o plano padrão) antes de faturar.');
        const base = f.ultimaEntrega ?? hojeBrasil();
        const cliente = v.cliente_nome as string;
        const l = (
          await c.query(
            `INSERT INTO lancamentos (empresa_id, tipo, competencia, descricao, documento, valor_total_centavos, cliente_id, origem, observacoes, criado_por_id)
             VALUES ($1,'receita',$2,$3,$4,$5,$6,'comercial',$7,$8) RETURNING id`,
            [empresaId, base, `${cliente} · venda nº ${String(v.numero).padStart(4, '0')}${v.obra ? ` · ${v.obra}` : ''}`.slice(0, 300), `Venda ${String(v.numero).padStart(4, '0')}`, total, v.cliente_id,
              [`Gerado ao finalizar a entrega da venda nº ${v.numero} (Comercial): ${f.m3Liquido.toLocaleString('pt-BR')} m³ entregues.`, d.observacao].filter(Boolean).join(' '), req.usuario!.id],
          )
        ).rows[0];
        const aprop = async (cod: string, centro: string, descricao: string, valor: number) => {
          if (valor > 0) await c.query('INSERT INTO apropriacoes (empresa_id, lancamento_id, plano_conta_id, centro_custo_id, descricao, valor_centavos) VALUES ($1,$2,$3,$4,$5,$6)', [empresaId, l.id, conta(cod), centros[centro] ?? null, descricao, valor]);
        };
        await aprop('1.1', 'Usina', `${f.m3Liquido.toLocaleString('pt-BR')} m³ de ${v.traco_codigo} × ${(Number(v.preco_m3_centavos) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, cent(f.concreto));
        await aprop('1.2', 'Bombas', 'Taxa de bombeamento', cent(f.bomba));
        for (const a of f.adicionais) await aprop('1.3', 'Usina', a.descricao, cent(a.valor));
        const { somarDias } = await import('../lib/financeiro.ts');
        for (const [i, p] of parcelasDaVenda(total, prazos, base, somarDias).entries()) {
          await c.query('INSERT INTO parcelas (empresa_id, lancamento_id, numero, vencimento, valor_centavos, forma_pagamento) VALUES ($1,$2,$3,$4,$5,$6)', [empresaId, l.id, i + 1, p.vencimento, p.valor, forma]);
        }
        await c.query(
          `UPDATE vendas SET lancamento_id = $2, entrega_finalizada_em = now(), entrega_finalizada_por_id = $3, forma_pagamento = $4, prazos_dias = $5, atualizado_em = now() WHERE id = $1`,
          [v.id, l.id, req.usuario!.id, forma, prazos],
        );
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'finalizar_entrega', entidade: 'vendas', entidadeId: v.id, depois: { lancamento: l.id, total: f.total, adicionais: d.adicionais } });
      });
      return { venda: vendaPublica(await carregarVenda(banco, empresaId, req.params.id)) };
    });

    // Vendas por vendedor e por cliente (pela data de entrega). Vendido = aprovadas e concluídas; entregue = cargas da venda.
    app.get<{ Querystring: Record<string, string | undefined> }>('/relatorios', async (req) => {
      const empresaId = empresaDo(req);
      const { de, ate } = periodo(req.query);
      const p: unknown[] = [empresaId, de, ate];
      let f = '';
      if (!gestaoComercial(req)) {
        p.push(req.usuario!.id);
        f = `AND v.vendedor_id = $${p.length}`;
      }
      const r = await banco.query(`${SELECT_VENDA} WHERE v.empresa_id = $1 AND v.data_entrega BETWEEN $2 AND $3 ${f} ORDER BY v.data_entrega`, p);
      const vendas = r.rows.map(vendaPublica);
      type Linha = { id: string; nome: string; vendas: number; m3: number; valor: number; entregue: number; pendentes: number; reprovadas: number };
      const agrupar = (chave: (v: (typeof vendas)[number]) => [string, string]) => {
        const m = new Map<string, Linha>();
        for (const v of vendas) {
          const [id, nome] = chave(v);
          const x = m.get(id) ?? { id, nome, vendas: 0, m3: 0, valor: 0, entregue: 0, pendentes: 0, reprovadas: 0 };
          if (v.status === 'aprovada' || v.status === 'concluida') {
            x.vendas++;
            x.m3 = r2(x.m3 + v.volume);
            x.valor = r2(x.valor + v.valorTotal);
            x.entregue = r2(x.entregue + v.entregue);
          } else if (v.status === 'aguardando_aprovacao') x.pendentes++;
          else if (v.status === 'reprovada') x.reprovadas++;
          m.set(id, x);
        }
        return [...m.values()].sort((a, b) => b.valor - a.valor || a.nome.localeCompare(b.nome, 'pt-BR'));
      };
      const porVendedor = agrupar((v) => [v.vendedorId, v.vendedorNome]);
      const porCliente = agrupar((v) => [v.clienteId, v.clienteNome]);
      const total = porVendedor.reduce(
        (s, x) => ({ vendas: s.vendas + x.vendas, m3: r2(s.m3 + x.m3), valor: r2(s.valor + x.valor), entregue: r2(s.entregue + x.entregue), pendentes: s.pendentes + x.pendentes }),
        { vendas: 0, m3: 0, valor: 0, entregue: 0, pendentes: 0 },
      );
      return { de, ate, total, precoMedio: total.m3 ? r2(total.valor / total.m3) : null, porVendedor, porCliente };
    });
  };
}

/** O que a venda fatura: m³ entregues (cargas menos devolvido) × preço, taxa da bomba e adicionais contratuais. */
export async function calcularFaturamento(c: Cliente, v: Record<string, any>) {
  const x = (
    await c.query(
      `SELECT coalesce(sum(volume_m3 - devolvido_m3), 0) AS liquido, coalesce(sum(volume_m3), 0) AS carregado, coalesce(sum(devolvido_m3), 0) AS devolvido,
              max((data_hora AT TIME ZONE 'America/Sao_Paulo')::date) AS ultima
         FROM cargas WHERE venda_id = $1 AND status = 'produzida'`,
      [v.id],
    )
  ).rows[0];
  const adicionais = (await c.query('SELECT tipo, descricao, valor_centavos FROM vendas_adicionais WHERE venda_id = $1 ORDER BY criado_em', [v.id])).rows.map((a) => ({
    tipo: a.tipo as string, descricao: a.descricao as string, valor: Number(a.valor_centavos) / 100,
  }));
  const liquido = Number(x.liquido);
  const concreto = Math.round(liquido * Number(v.preco_m3_centavos)) / 100;
  const bomba = v.bombeamento && v.taxa_bomba_centavos ? Number(v.taxa_bomba_centavos) / 100 : 0;
  const somaAd = adicionais.reduce((s, a) => s + a.valor, 0);
  return {
    m3Carregado: r2(Number(x.carregado)),
    m3Devolvido: r2(Number(x.devolvido)),
    m3Liquido: r2(liquido),
    concreto: r2(concreto),
    bomba: r2(bomba),
    adicionais,
    total: r2(concreto + bomba + somaAd),
    ultimaEntrega: x.ultima ? String(x.ultima).slice(0, 10) : null,
  };
}
