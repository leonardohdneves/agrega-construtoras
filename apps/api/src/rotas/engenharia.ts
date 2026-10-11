// Engenharia (Fase 1): tabelas de referência (SINAPI e próprio), obras com centro de custo e nível de apropriação,
// itens copiados para cada obra (editáveis só na obra), EAP por níveis e orçamento.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Banco, Cliente } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';
import { ErroIa, iaDisponivel } from '../lib/ia-nota.ts';
import { converterTabelaComIa } from '../lib/ia-sinapi.ts';
import { empresaDo, exigir } from '../sessao.ts';
import { bdiCalculado, calcularDatas, codigoDoNo, lerCsvReferencia, nivelDoNovoNo, NIVEIS_OBRA, numeroBr, temCiclo, type NivelEap, type ParametrosBdi } from '../lib/engenharia.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const reais = (c: unknown) => (c === null || c === undefined ? null : Math.round(Number(c)) / 100);
const cent = (r: number) => Math.round(r * 100);
/** Preço digitado (número ou texto pt-BR/ponto) em centavos; null se inválido. */
const precoCentavos = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : numeroBr(String(v ?? ''));
  return n === null || !Number.isFinite(n) || n < 0 ? null : cent(n);
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const POSICAO: Record<NivelEap, number> = { etapa: 1, subetapa: 2, tarefa: 3 };
const texto = (max = 200) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const uf = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'UF inválida.').optional().nullable().transform((v) => v || null);
const esquemaAtividade = z.object({
  descricao: z.string().trim().min(2, 'Descreva a atividade.').max(200),
  eapNoId: z.string().regex(UUID).optional().nullable(),
  inicio: z.string().regex(DATA, 'Data de início inválida.'),
  duracaoDias: z.number().int('A duração é em dias inteiros.').min(1, 'Duração mínima de 1 dia.').max(3650),
  predecessoraId: z.string().regex(UUID).optional().nullable(),
});
const esquemaNecessidade = z.object({
  itemId: z.string().regex(UUID, 'Escolha o insumo.'),
  eapNoId: z.string().regex(UUID).optional().nullable(),
  quantidade: z.number().positive('A quantidade precisa ser maior que zero.'),
  dataNecessaria: z.string().regex(DATA, 'Data inválida.').optional().nullable(),
  observacao: z.string().trim().max(300).optional().nullable(),
});
const pct = z.number().min(0, 'Os percentuais do BDI não podem ser negativos.').max(99.99, 'Percentual do BDI fora da faixa.');
const mes = z.string().regex(/^\d{4}-\d{2}$/, 'Mês de referência no formato AAAA-MM.').optional().nullable().transform((v) => v || null);

/** Preço de um item da obra: insumo tem preço próprio; composição é a soma dos insumos × coeficiente. */
const precoObra = (a: string) =>
  `(CASE WHEN ${a}.tipo = 'insumo' THEN ${a}.preco_centavos::numeric ELSE coalesce((SELECT sum(ci.coeficiente * ii.preco_centavos) FROM obra_composicao_insumos ci JOIN obra_itens ii ON ii.id = ci.insumo_id WHERE ci.composicao_id = ${a}.id), 0) END)`;
/** Mesmo cálculo para os itens da tabela de referência. */
const precoRef = (a: string) =>
  `(CASE WHEN ${a}.tipo = 'insumo' THEN ${a}.preco_centavos::numeric ELSE coalesce((SELECT sum(rc.coeficiente * ri.preco_centavos) FROM ref_composicao_insumos rc JOIN ref_itens ri ON ri.id = rc.insumo_id WHERE rc.composicao_id = ${a}.id), 0) END)`;

// Tabelas SINAPI em texto passam de 2 MB (limite geral do servidor).
const LIMITE_ARQUIVO = 20_000_000;
const LIMITE_CORPO = 25 * 1024 * 1024;

/** Planilha Excel lida como texto (tela antiga, sem o leitor de .xlsx): o conteúdo começa com a assinatura do zip. */
function recusarBinario(texto: string) {
  if (texto.startsWith('PK\u0003\u0004') || texto.slice(0, 2000).includes('\uFFFD\uFFFD')) {
    throw new ErroHttp(400, 'O arquivo chegou como planilha Excel não convertida: esta tela está desatualizada. Recarregue a página (F5) e envie o arquivo de novo.');
  }
}

const esquemaTabela = z.object({
  fonte: z.enum(['sinapi', 'proprio']),
  nome: z.string().trim().min(2, 'Dê um nome à tabela.').max(120),
  uf,
  mesReferencia: mes,
  desonerado: z.boolean().optional().default(false),
  csv: z.string().max(LIMITE_ARQUIVO).optional().nullable(),
});

const esquemaItemRef = z.object({
  tipo: z.enum(['insumo', 'composicao']),
  codigo: z.string().trim().min(1, 'Informe o código.').max(40),
  descricao: z.string().trim().min(2, 'Descreva o item.').max(300),
  unidade: z.string().trim().min(1, 'Informe a unidade.').max(20),
  grupo: texto(80),
  preco: z.union([z.number(), z.string()]).optional().nullable(),
  componentes: z.array(z.object({ insumoCodigo: z.string().trim().min(1), coeficiente: z.number().min(0) })).optional(),
});

// Sem valores padrão aqui: no PUT, campo ausente significa "não mexer". Os padrões ficam no POST.
const esquemaObra = z.object({
  codigo: z.string().trim().max(20).optional().nullable().transform((v) => v || null),
  nome: z.string().trim().min(2, 'Dê um nome à obra.').max(160).optional(),
  endereco: texto(200),
  cidade: texto(80),
  uf,
  responsavel: texto(120),
  status: z.enum(['orcamento', 'planejamento', 'em_andamento', 'suspensa', 'concluida']).optional(),
  dataInicio: z.string().regex(DATA).optional().nullable().transform((v) => v || null),
  dataPrevisao: z.string().regex(DATA).optional().nullable().transform((v) => v || null),
  nivelApropriacao: z.enum(NIVEIS_OBRA).optional(),
  bdiModo: z.enum(['calculado', 'informado']).optional(),
  bdiPercentual: z.number().min(0).max(99.99).optional(),
  bdiParametros: z
    .object({ ac: pct, s: pct, r: pct, g: pct, df: pct, l: pct, i: pct })
    .partial()
    .optional()
    .nullable(),
});

/** Define o BDI da obra: calculado (pelos parâmetros, mesclados aos já salvos) ou informado (valor direto). */
function resolverBdi(d: { bdiModo?: 'calculado' | 'informado'; bdiPercentual?: number; bdiParametros?: Partial<ParametrosBdi> | null }, atual: Record<string, any> | null) {
  const modo = d.bdiModo ?? (atual?.bdi_modo as 'calculado' | 'informado' | undefined) ?? 'informado';
  const parametros = { ...((atual?.bdi_parametros as Partial<ParametrosBdi> | null) ?? {}), ...(d.bdiParametros ?? {}) } as Partial<ParametrosBdi>;
  if (modo === 'calculado') return { modo, parametros, percentual: bdiCalculado(parametros) };
  const percentual = d.bdiPercentual ?? (atual ? Number(atual.bdi_percentual) : 0);
  return { modo, parametros, percentual };
}

export function rotasEngenharia(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.addHook('preHandler', exigir(banco, 'dono', 'gestor'));

    async function tabelaDaEmpresa(c: Cliente, empresaId: string, id: string) {
      const t = (await c.query('SELECT * FROM ref_tabelas WHERE id = $1 AND empresa_id = $2', [id, empresaId])).rows[0];
      if (!t) throw naoEncontrado('Tabela de referência');
      return t;
    }
    async function obraDaEmpresa(c: Cliente, empresaId: string, id: string) {
      const o = (await c.query('SELECT o.*, cc.nome AS centro_nome FROM obras o JOIN centros_custo cc ON cc.id = o.centro_custo_id WHERE o.id = $1 AND o.empresa_id = $2', [id, empresaId])).rows[0];
      if (!o) throw naoEncontrado('Obra');
      return o;
    }

    /** Grava itens de referência em lote (unnest, de 500 em 500). */
    async function gravarItensRef(c: Cliente, tabelaId: string, leitura: ReturnType<typeof lerCsvReferencia>) {
      const ids = new Map<string, string>();
      for (let i = 0; i < leitura.insumos.length; i += 500) {
        const lote = leitura.insumos.slice(i, i + 500);
        const r = await c.query(
          `INSERT INTO ref_itens (tabela_id, tipo, codigo, descricao, unidade, grupo, preco_centavos)
           SELECT $1, 'insumo', * FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::bigint[]) RETURNING id, codigo`,
          [tabelaId, lote.map((x) => x.codigo), lote.map((x) => x.descricao), lote.map((x) => x.unidade), lote.map((x) => x.grupo), lote.map((x) => x.precoCentavos)],
        );
        for (const x of r.rows) ids.set(`insumo:${x.codigo}`, x.id);
      }
      for (let i = 0; i < leitura.composicoes.length; i += 500) {
        const lote = leitura.composicoes.slice(i, i + 500);
        const r = await c.query(
          `INSERT INTO ref_itens (tabela_id, tipo, codigo, descricao, unidade, grupo)
           SELECT $1, 'composicao', * FROM unnest($2::text[], $3::text[], $4::text[], $5::text[]) RETURNING id, codigo`,
          [tabelaId, lote.map((x) => x.codigo), lote.map((x) => x.descricao), lote.map((x) => x.unidade), lote.map((x) => x.grupo)],
        );
        for (const x of r.rows) ids.set(`composicao:${x.codigo}`, x.id);
      }
      const comp = leitura.componentes.filter((k) => ids.has(`composicao:${k.composicao}`) && ids.has(`insumo:${k.insumo}`));
      for (let i = 0; i < comp.length; i += 500) {
        const lote = comp.slice(i, i + 500);
        await c.query(
          `INSERT INTO ref_composicao_insumos (composicao_id, insumo_id, coeficiente)
           SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::numeric[]) ON CONFLICT (composicao_id, insumo_id) DO UPDATE SET coeficiente = excluded.coeficiente`,
          [lote.map((k) => ids.get(`composicao:${k.composicao}`)), lote.map((k) => ids.get(`insumo:${k.insumo}`)), lote.map((k) => k.coeficiente)],
        );
      }
      return { insumos: leitura.insumos.length, composicoes: leitura.composicoes.length, componentes: comp.length };
    }

    // ---------------------------------------------------------------- tabelas de referência

    app.get('/tabelas', async (req) => {
      const r = await banco.query(
        `SELECT t.*, (SELECT count(*) FROM ref_itens i WHERE i.tabela_id = t.id AND i.tipo = 'insumo')::int AS insumos,
                (SELECT count(*) FROM ref_itens i WHERE i.tabela_id = t.id AND i.tipo = 'composicao')::int AS composicoes
           FROM ref_tabelas t WHERE t.empresa_id = $1 ORDER BY t.fonte, t.uf NULLS LAST, t.mes_referencia DESC NULLS LAST, t.nome`,
        [empresaDo(req)],
      );
      return { tabelas: r.rows.map(tabelaPublica) };
    });

    app.post('/tabelas', { bodyLimit: LIMITE_CORPO }, async (req, reply) => {
      const d = esquemaTabela.parse(req.body);
      if (d.csv) recusarBinario(d.csv);
      const empresaId = empresaDo(req);
      const leitura = d.csv ? lerCsvReferencia(d.csv) : null;
      if (leitura && leitura.erros.length) throw new ErroHttp(400, 'O arquivo tem erros. Corrija e envie de novo.', { erros: leitura.erros.slice(0, 50) });
      const id = await emTransacao(banco, async (c) => {
        const t = (
          await c.query(
            `INSERT INTO ref_tabelas (empresa_id, fonte, nome, uf, mes_referencia, desonerado) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
            [empresaId, d.fonte, d.nome, d.uf, d.mesReferencia, d.desonerado],
          )
        ).rows[0];
        const contagem = leitura ? await gravarItensRef(c, t.id, leitura) : null;
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'ref_tabelas', entidadeId: t.id, depois: { fonte: d.fonte, nome: d.nome, contagem } });
        return t.id as string;
      });
      reply.code(201);
      return { tabela: tabelaPublica(await tabelaDetalhe(banco, empresaId, id)) };
    });

    // Lê um arquivo de composições fora do formato padrão com a IA e devolve o CSV padrão para revisão.
    // Não grava nada: a tabela só é criada no POST /tabelas, depois da conferência.
    app.post('/tabelas/converter-ia', { bodyLimit: LIMITE_CORPO }, async (req) => {
      const d = z.object({ texto: z.string().min(1).max(LIMITE_ARQUIVO), uf, desonerado: z.boolean().default(false) }).parse(req.body);
      recusarBinario(d.texto);
      if (!iaDisponivel()) throw new ErroHttp(503, 'A IA não está configurada. Use o formato padrão do arquivo.');
      try {
        const r = await converterTabelaComIa(d.texto, { uf: d.uf ?? null, desonerado: d.desonerado });
        if (r.leitura.erros.length) throw new ErroHttp(422, 'A IA leu o arquivo, mas há linhas com erro. Confira o formato ou corrija o arquivo.', { erros: r.leitura.erros.slice(0, 50) });
        if (!r.leitura.insumos.length && !r.leitura.composicoes.length) throw new ErroHttp(422, 'A IA leu a estrutura, mas nenhuma linha virou insumo ou composição. Confira a aba e a UF.');
        return { csv: r.csv, ignoradas: r.ignoradas, semPreco: r.semPreco, componentesDescartados: r.componentesDescartados, contagem: { insumos: r.leitura.insumos.length, composicoes: r.leitura.composicoes.length, componentes: r.leitura.componentes.length } };
      } catch (e) {
        if (e instanceof ErroIa) throw new ErroHttp(502, e.message);
        throw e;
      }
    });

    app.get<{ Params: { id: string } }>('/tabelas/:id', async (req) => {
      return { tabela: tabelaPublica(await tabelaDetalhe(banco, empresaDo(req), req.params.id)) };
    });

    app.put<{ Params: { id: string } }>('/tabelas/:id', async (req) => {
      const d = z.object({ nome: z.string().trim().min(2).max(120) }).parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        await tabelaDaEmpresa(c, empresaId, req.params.id);
        await c.query('UPDATE ref_tabelas SET nome = $3, atualizado_em = now() WHERE id = $1 AND empresa_id = $2', [req.params.id, empresaId, d.nome]);
      });
      return { tabela: tabelaPublica(await tabelaDetalhe(banco, empresaId, req.params.id)) };
    });

    app.get<{ Params: { id: string }; Querystring: Record<string, string | undefined> }>('/tabelas/:id/itens', async (req) => {
      const empresaId = empresaDo(req);
      await tabelaDaEmpresa(banco, empresaId, req.params.id);
      const { tipo, busca } = req.query;
      const termo = (busca ?? '').trim();
      const r = await banco.query(
        `SELECT i.id, i.tipo, i.codigo, i.descricao, i.unidade, i.grupo, ${precoRef('i')} AS preco,
                (SELECT count(*)::int FROM ref_composicao_insumos rc WHERE rc.composicao_id = i.id) AS componentes
           FROM ref_itens i
          WHERE i.tabela_id = $1 AND ($2::text IS NULL OR i.tipo = $2) AND ($3 = '' OR i.codigo ILIKE $3 || '%' OR i.descricao ILIKE '%' || $3 || '%')
          ORDER BY i.tipo, i.codigo LIMIT 500`,
        [req.params.id, tipo === 'insumo' || tipo === 'composicao' ? tipo : null, termo],
      );
      return { itens: r.rows.map((i) => ({ id: i.id, tipo: i.tipo, codigo: i.codigo, descricao: i.descricao, unidade: i.unidade, grupo: i.grupo, preco: reais(i.preco), componentes: i.componentes })) };
    });

    app.get<{ Params: { id: string; itemId: string } }>('/tabelas/:id/itens/:itemId', async (req) => {
      await tabelaDaEmpresa(banco, empresaDo(req), req.params.id);
      const i = (await banco.query(`SELECT i.*, ${precoRef('i')} AS preco FROM ref_itens i WHERE i.id = $1 AND i.tabela_id = $2`, [req.params.itemId, req.params.id])).rows[0];
      if (!i) throw naoEncontrado('Item');
      const comp = (
        await banco.query(
          `SELECT ri.codigo, ri.descricao, ri.unidade, rc.coeficiente, ri.preco_centavos FROM ref_composicao_insumos rc JOIN ref_itens ri ON ri.id = rc.insumo_id WHERE rc.composicao_id = $1 ORDER BY ri.codigo`,
          [i.id],
        )
      ).rows;
      return {
        item: { id: i.id, tipo: i.tipo, codigo: i.codigo, descricao: i.descricao, unidade: i.unidade, grupo: i.grupo, preco: reais(i.preco) },
        componentes: comp.map((k) => ({ codigo: k.codigo, descricao: k.descricao, unidade: k.unidade, coeficiente: Number(k.coeficiente), precoUnitario: reais(k.preco_centavos) })),
      };
    });

    // Itens de tabela própria são editáveis; SINAPI é imutável (nova versão = nova importação).
    app.post<{ Params: { id: string } }>('/tabelas/:id/itens', async (req, reply) => {
      const d = esquemaItemRef.parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const t = await tabelaDaEmpresa(c, empresaId, req.params.id);
        if (t.fonte !== 'proprio') throw new ErroHttp(409, 'A tabela SINAPI é imutável. Para outra versão, importe uma nova tabela.');
        const preco = d.tipo === 'insumo' ? precoCentavos(d.preco) : null;
        if (d.tipo === 'insumo' && preco === null) throw new ErroHttp(400, 'Informe um preço válido para o insumo.');
        const x = (
          await c.query(`INSERT INTO ref_itens (tabela_id, tipo, codigo, descricao, unidade, grupo, preco_centavos) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [t.id, d.tipo, d.codigo, d.descricao, d.unidade, d.grupo, preco])
        ).rows[0];
        if (d.tipo === 'composicao') await gravarComponentes(c, t.id, x.id, d.componentes ?? []);
      }).catch((e: Error & { code?: string }) => {
        if (e.code === '23505') throw new ErroHttp(409, 'Já existe um item com esse código nesta tabela.');
        throw e;
      });
      reply.code(201);
      return { ok: true };
    });

    app.put<{ Params: { id: string; itemId: string } }>('/tabelas/:id/itens/:itemId', async (req) => {
      const d = z
        .object({
          descricao: z.string().trim().min(2).max(300).optional(),
          unidade: z.string().trim().min(1).max(20).optional(),
          grupo: texto(80),
          preco: z.union([z.number(), z.string()]).optional().nullable(),
          componentes: z.array(z.object({ insumoCodigo: z.string().trim().min(1), coeficiente: z.number().min(0) })).optional(),
        })
        .parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const t = await tabelaDaEmpresa(c, empresaId, req.params.id);
        if (t.fonte !== 'proprio') throw new ErroHttp(409, 'A tabela SINAPI é imutável.');
        const item = (await c.query('SELECT * FROM ref_itens WHERE id = $1 AND tabela_id = $2', [req.params.itemId, t.id])).rows[0];
        if (!item) throw naoEncontrado('Item');
        const preco = item.tipo === 'insumo' && d.preco !== undefined && d.preco !== null ? precoCentavos(d.preco) : item.preco_centavos;
        if (item.tipo === 'insumo' && preco === null) throw new ErroHttp(400, 'Informe um preço válido para o insumo.');
        await c.query('UPDATE ref_itens SET descricao = $2, unidade = $3, grupo = $4, preco_centavos = $5 WHERE id = $1', [item.id, d.descricao ?? item.descricao, d.unidade ?? item.unidade, d.grupo ?? item.grupo, preco]);
        if (item.tipo === 'composicao' && d.componentes !== undefined) {
          await c.query('DELETE FROM ref_composicao_insumos WHERE composicao_id = $1', [item.id]);
          await gravarComponentes(c, t.id, item.id, d.componentes);
        }
      });
      return { ok: true };
    });

    app.delete<{ Params: { id: string; itemId: string } }>('/tabelas/:id/itens/:itemId', async (req) => {
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const t = await tabelaDaEmpresa(c, empresaId, req.params.id);
        if (t.fonte !== 'proprio') throw new ErroHttp(409, 'A tabela SINAPI é imutável.');
        const usado = (await c.query('SELECT 1 FROM ref_composicao_insumos WHERE insumo_id = $1 LIMIT 1', [req.params.itemId])).rowCount;
        if (usado) throw new ErroHttp(409, 'Este insumo faz parte de uma composição. Retire-o das composições antes de excluir.');
        await c.query('DELETE FROM ref_itens WHERE id = $1 AND tabela_id = $2', [req.params.itemId, t.id]);
      });
      return { ok: true };
    });

    /** Insere os componentes de uma composição da tabela (código do insumo na mesma tabela). */
    async function gravarComponentes(c: Cliente, tabelaId: string, composicaoId: string, componentes: { insumoCodigo: string; coeficiente: number }[]) {
      for (const k of componentes) {
        const ins = (await c.query(`SELECT id FROM ref_itens WHERE tabela_id = $1 AND tipo = 'insumo' AND codigo = $2`, [tabelaId, k.insumoCodigo])).rows[0];
        if (!ins) throw new ErroHttp(400, `Insumo ${k.insumoCodigo} não existe nesta tabela.`);
        await c.query(
          `INSERT INTO ref_composicao_insumos (composicao_id, insumo_id, coeficiente) VALUES ($1,$2,$3)
           ON CONFLICT (composicao_id, insumo_id) DO UPDATE SET coeficiente = excluded.coeficiente`,
          [composicaoId, ins.id, k.coeficiente],
        );
      }
    }

    // ---------------------------------------------------------------- obras

    app.get('/obras', async (req) => {
      const empresaId = empresaDo(req);
      const r = await banco.query(
        `SELECT o.*, cc.nome AS centro_nome,
                (SELECT count(*)::int FROM obra_itens oi WHERE oi.obra_id = o.id) AS itens,
                (SELECT count(*)::int FROM orcamento_itens oq WHERE oq.obra_id = o.id) AS linhas_orcamento,
                (SELECT coalesce(sum(oq.quantidade * ${precoObra('oi')}), 0) FROM orcamento_itens oq JOIN obra_itens oi ON oi.id = oq.obra_item_id WHERE oq.obra_id = o.id) AS subtotal
           FROM obras o JOIN centros_custo cc ON cc.id = o.centro_custo_id
          WHERE o.empresa_id = $1 AND o.ativo ORDER BY o.codigo`,
        [empresaId],
      );
      return { obras: r.rows.map((o) => ({ ...obraPublica(o), itens: o.itens, linhasOrcamento: o.linhas_orcamento, total: r2(reais(o.subtotal)! * (1 + Number(o.bdi_percentual) / 100)) })) };
    });

    app.post('/obras', async (req, reply) => {
      const d0 = esquemaObra.parse(req.body);
      if (!d0.nome) throw new ErroHttp(400, 'Dê um nome à obra.');
      const bdi = resolverBdi(d0, null);
      const d = {
        ...d0,
        nome: d0.nome,
        status: d0.status ?? 'planejamento',
        nivelApropriacao: d0.nivelApropriacao ?? 'etapa',
        bdiPercentual: bdi.percentual,
        bdiModo: bdi.modo,
        bdiParametros: bdi.parametros,
      };
      const empresaId = empresaDo(req);
      const id = await emTransacao(banco, async (c) => {
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`obras:${empresaId}`]);
        const codigo =
          d.codigo ??
          `OB-${String(Number((await c.query(`SELECT coalesce(max(substring(codigo FROM '^OB-(\\d+)$')::int), 0) + 1 AS n FROM obras WHERE empresa_id = $1`, [empresaId])).rows[0].n)).padStart(4, '0')}`;
        if ((await c.query('SELECT 1 FROM obras WHERE empresa_id = $1 AND codigo = $2', [empresaId, codigo])).rowCount)
          throw new ErroHttp(409, `Já existe uma obra com o código ${codigo}.`);
        const centro = (
          await c.query(`INSERT INTO centros_custo (empresa_id, nome) VALUES ($1, $2) RETURNING id`, [empresaId, `Obra ${codigo} - ${d.nome}`.slice(0, 120)])
        ).rows[0];
        const o = (
          await c.query(
            `INSERT INTO obras (empresa_id, codigo, nome, endereco, cidade, uf, responsavel, status, data_inicio, data_previsao, nivel_apropriacao, bdi_percentual, bdi_modo, bdi_parametros, centro_custo_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15) RETURNING id`,
            [empresaId, codigo, d.nome, d.endereco, d.cidade, d.uf, d.responsavel, d.status, d.dataInicio, d.dataPrevisao, d.nivelApropriacao, d.bdiPercentual, d.bdiModo, JSON.stringify(d.bdiParametros), centro.id],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'obras', entidadeId: o.id, depois: { ...d, codigo } });
        return o.id as string;
      });
      reply.code(201);
      return { obra: obraPublica(await obraDetalhe(banco, empresaId, id)) };
    });

    app.get<{ Params: { id: string } }>('/obras/:id', async (req) => {
      return { obra: obraPublica(await obraDetalhe(banco, empresaDo(req), req.params.id)) };
    });

    app.put<{ Params: { id: string } }>('/obras/:id', async (req) => {
      const d = esquemaObra.parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const atual = await obraDaEmpresa(c, empresaId, req.params.id);
        const novoNivel = d.nivelApropriacao ?? atual.nivel_apropriacao;
        if (novoNivel !== atual.nivel_apropriacao) {
          const orc = (await c.query('SELECT count(*)::int AS n FROM orcamento_itens WHERE obra_id = $1', [atual.id])).rows[0].n;
          if (orc) throw new ErroHttp(409, 'Esta obra já tem itens no orçamento. Remova-os antes de mudar o nível de apropriação.');
          const niveis = (await c.query('SELECT DISTINCT nivel FROM eap_nos WHERE obra_id = $1', [atual.id])).rows.map((x) => x.nivel as NivelEap);
          const sobra = niveis.some((n) => novoNivel === 'obra' || POSICAO[n] > POSICAO[novoNivel as NivelEap]);
          if (sobra) throw new ErroHttp(409, 'A EAP tem níveis acima do novo nível de apropriação. Exclua esses nós antes.');
        }
        // Campo ausente mantém o valor atual; campo vazio vira null.
        const nome = d.nome ?? atual.nome;
        const campos = {
          nome,
          endereco: d.endereco !== undefined ? d.endereco : atual.endereco,
          cidade: d.cidade !== undefined ? d.cidade : atual.cidade,
          uf: d.uf !== undefined ? d.uf : atual.uf,
          responsavel: d.responsavel !== undefined ? d.responsavel : atual.responsavel,
          status: d.status ?? atual.status,
          dataInicio: d.dataInicio !== undefined ? d.dataInicio : atual.data_inicio,
          dataPrevisao: d.dataPrevisao !== undefined ? d.dataPrevisao : atual.data_previsao,
          nivel: novoNivel,
          bdi: resolverBdi(d, atual),
        };
        await c.query(
          `UPDATE obras SET nome = $3, endereco = $4, cidade = $5, uf = $6, responsavel = $7, status = $8, data_inicio = $9, data_previsao = $10,
                  nivel_apropriacao = $11, bdi_percentual = $12, bdi_modo = $13, bdi_parametros = $14::jsonb, atualizado_em = now()
            WHERE id = $1 AND empresa_id = $2`,
          [atual.id, empresaId, campos.nome, campos.endereco, campos.cidade, campos.uf, campos.responsavel, campos.status, campos.dataInicio, campos.dataPrevisao, campos.nivel, campos.bdi.percentual, campos.bdi.modo, JSON.stringify(campos.bdi.parametros)],
        );
        await c.query('UPDATE centros_custo SET nome = $2 WHERE id = $1', [atual.centro_custo_id, `Obra ${atual.codigo} - ${nome}`.slice(0, 120)]);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'obras', entidadeId: atual.id, depois: d });
      });
      return { obra: obraPublica(await obraDetalhe(banco, empresaId, req.params.id)) };
    });

    // ---------------------------------------------------------------- insumos e serviços da obra

    app.get<{ Params: { id: string }; Querystring: Record<string, string | undefined> }>('/obras/:id/itens', async (req) => {
      const empresaId = empresaDo(req);
      await obraDaEmpresa(banco, empresaId, req.params.id);
      const { tipo, busca } = req.query;
      const termo = (busca ?? '').trim();
      const r = await banco.query(
        `SELECT oi.*, ${precoObra('oi')} AS preco,
                (SELECT count(*)::int FROM obra_composicao_insumos ci WHERE ci.composicao_id = oi.id) AS componentes,
                (SELECT count(*)::int FROM orcamento_itens oq WHERE oq.obra_item_id = oi.id) AS no_orcamento
           FROM obra_itens oi
          WHERE oi.obra_id = $1 AND ($2::text IS NULL OR oi.tipo = $2) AND ($3 = '' OR oi.codigo ILIKE $3 || '%' OR oi.descricao ILIKE '%' || $3 || '%')
          ORDER BY oi.tipo, oi.codigo LIMIT 1000`,
        [req.params.id, tipo === 'insumo' || tipo === 'composicao' ? tipo : null, termo],
      );
      return { itens: r.rows.map(itemObraPublico) };
    });

    app.get<{ Params: { id: string; itemId: string } }>('/obras/:id/itens/:itemId', async (req) => {
      await obraDaEmpresa(banco, empresaDo(req), req.params.id);
      const i = (await banco.query(`SELECT oi.*, ${precoObra('oi')} AS preco, 0 AS componentes, 0 AS no_orcamento FROM obra_itens oi WHERE oi.id = $1 AND oi.obra_id = $2`, [req.params.itemId, req.params.id])).rows[0];
      if (!i) throw naoEncontrado('Item');
      const comp = (
        await banco.query(
          `SELECT ii.id, ii.codigo, ii.descricao, ii.unidade, ci.coeficiente, ii.preco_centavos FROM obra_composicao_insumos ci JOIN obra_itens ii ON ii.id = ci.insumo_id WHERE ci.composicao_id = $1 ORDER BY ii.codigo`,
          [i.id],
        )
      ).rows;
      return {
        item: itemObraPublico(i),
        componentes: comp.map((k) => ({ id: k.id, codigo: k.codigo, descricao: k.descricao, unidade: k.unidade, coeficiente: Number(k.coeficiente), precoUnitario: reais(k.preco_centavos) })),
      };
    });

    /** Copia insumos e composições escolhidos da tabela para a obra. Quem já existe na obra é preservado. */
    app.post<{ Params: { id: string } }>('/obras/:id/importar', async (req) => {
      const d = z
        .object({ tabelaId: z.string().regex(UUID), composicaoIds: z.array(z.string().regex(UUID)).default([]), insumoIds: z.array(z.string().regex(UUID)).default([]) })
        .parse(req.body);
      const empresaId = empresaDo(req);
      return emTransacao(banco, async (c) => {
        const obra = await obraDaEmpresa(c, empresaId, req.params.id);
        const tabela = await tabelaDaEmpresa(c, empresaId, d.tabelaId);
        const versao = [tabela.fonte === 'sinapi' ? 'SINAPI' : 'Própria', tabela.mes_referencia, tabela.uf, tabela.fonte === 'sinapi' ? (tabela.desonerado ? 'desonerado' : 'não desonerado') : null].filter(Boolean).join(' ');
        const comps = d.composicaoIds.length
          ? (await c.query(`SELECT * FROM ref_itens WHERE tabela_id = $1 AND tipo = 'composicao' AND id = ANY($2::uuid[])`, [tabela.id, d.composicaoIds])).rows
          : [];
        const pares = comps.length
          ? (await c.query(`SELECT rc.composicao_id, rc.insumo_id, rc.coeficiente FROM ref_composicao_insumos rc WHERE rc.composicao_id = ANY($1::uuid[])`, [comps.map((x) => x.id)])).rows
          : [];
        const idsInsumo = [...new Set([...d.insumoIds, ...pares.map((p) => p.insumo_id)])];
        const insumos = idsInsumo.length ? (await c.query(`SELECT * FROM ref_itens WHERE tabela_id = $1 AND tipo = 'insumo' AND id = ANY($2::uuid[])`, [tabela.id, idsInsumo])).rows : [];

        const copia = async (linhas: Record<string, any>[], tipo: 'insumo' | 'composicao') => {
          let novos = 0;
          for (const x of linhas) {
            const r = await c.query(
              `INSERT INTO obra_itens (obra_id, tipo, codigo, descricao, unidade, grupo, preco_centavos, origem_tabela_id, origem_fonte, origem_versao, preco_referencia_centavos)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (obra_id, tipo, codigo) DO NOTHING RETURNING id`,
              [obra.id, tipo, x.codigo, x.descricao, x.unidade, x.grupo, tipo === 'insumo' ? x.preco_centavos : null, tabela.id, tabela.fonte, versao, tipo === 'insumo' ? x.preco_centavos : null],
            );
            novos += r.rowCount ?? 0;
            x.novo = (r.rowCount ?? 0) > 0;
          }
          return novos;
        };
        const novosInsumos = await copia(insumos, 'insumo');
        const novasComps = await copia(comps, 'composicao');
        // Liga cada composição nova aos seus insumos da obra.
        const mapa = new Map<string, string>();
        const existentes = (await c.query(`SELECT id, tipo, codigo FROM obra_itens WHERE obra_id = $1`, [obra.id])).rows;
        for (const e of existentes) mapa.set(`${e.tipo}:${e.codigo}`, e.id);
        const idDoRef = new Map<string, string>();
        for (const x of [...insumos, ...comps]) idDoRef.set(x.id, mapa.get(`${x.tipo}:${x.codigo}`)!);
        for (const comp of comps.filter((x) => x.novo)) {
          for (const p of pares.filter((q) => q.composicao_id === comp.id)) {
            const insumoObra = idDoRef.get(p.insumo_id);
            if (!insumoObra) continue;
            await c.query(
              `INSERT INTO obra_composicao_insumos (composicao_id, insumo_id, coeficiente) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
              [idDoRef.get(comp.id), insumoObra, p.coeficiente],
            );
          }
        }
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'importar', entidade: 'obras', entidadeId: obra.id, depois: { tabela: tabela.nome, insumos: novosInsumos, composicoes: novasComps } });
        return { importados: { insumos: novosInsumos, composicoes: novasComps }, jaExistiam: insumos.length + comps.length - novosInsumos - novasComps };
      });
    });

    /** Editar na obra não altera a tabela de referência. Guarda o preço original e marca o item como editado. */
    app.patch<{ Params: { id: string; itemId: string } }>('/obras/:id/itens/:itemId', async (req) => {
      const d = z.object({ descricao: z.string().trim().min(2).max(300).optional(), unidade: z.string().trim().min(1).max(20).optional(), preco: z.union([z.number(), z.string()]).optional() }).parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const obra = await obraDaEmpresa(c, empresaId, req.params.id);
        const i = (await c.query('SELECT * FROM obra_itens WHERE id = $1 AND obra_id = $2', [req.params.itemId, obra.id])).rows[0];
        if (!i) throw naoEncontrado('Item');
        const preco = d.preco !== undefined && i.tipo === 'insumo' ? precoCentavos(d.preco) : i.preco_centavos;
        if (i.tipo === 'insumo' && d.preco !== undefined && preco === null) throw new ErroHttp(400, 'Informe um preço válido para o insumo.');
        const precoMudou = i.tipo === 'insumo' && d.preco !== undefined && preco !== Number(i.preco_centavos);
        const mudou = (d.descricao !== undefined && d.descricao !== i.descricao) || (d.unidade !== undefined && d.unidade !== i.unidade) || precoMudou;
        if (!mudou) return;
        await c.query('UPDATE obra_itens SET descricao = $2, unidade = $3, preco_centavos = $4, editado = true WHERE id = $1', [i.id, d.descricao ?? i.descricao, d.unidade ?? i.unidade, preco]);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'obra_itens', entidadeId: i.id, depois: d });
      });
      return { ok: true };
    });

    /** Substitui os insumos e coeficientes de uma composição da obra. */
    app.put<{ Params: { id: string; itemId: string } }>('/obras/:id/itens/:itemId/composicao', async (req) => {
      const d = z.object({ componentes: z.array(z.object({ insumoId: z.string().regex(UUID), coeficiente: z.number().min(0) })) }).parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const obra = await obraDaEmpresa(c, empresaId, req.params.id);
        const i = (await c.query('SELECT * FROM obra_itens WHERE id = $1 AND obra_id = $2', [req.params.itemId, obra.id])).rows[0];
        if (!i || i.tipo !== 'composicao') throw naoEncontrado('Serviço');
        const insumos = d.componentes.length
          ? (await c.query(`SELECT id FROM obra_itens WHERE obra_id = $1 AND tipo = 'insumo' AND id = ANY($2::uuid[])`, [obra.id, d.componentes.map((k) => k.insumoId)])).rowCount
          : 0;
        if (insumos !== new Set(d.componentes.map((k) => k.insumoId)).size) throw new ErroHttp(400, 'Algum insumo não está nesta obra.');
        await c.query('DELETE FROM obra_composicao_insumos WHERE composicao_id = $1', [i.id]);
        for (const k of d.componentes) {
          await c.query(`INSERT INTO obra_composicao_insumos (composicao_id, insumo_id, coeficiente) VALUES ($1,$2,$3)`, [i.id, k.insumoId, k.coeficiente]);
        }
        await c.query('UPDATE obra_itens SET editado = true WHERE id = $1', [i.id]);
      });
      return { ok: true };
    });

    app.delete<{ Params: { id: string; itemId: string } }>('/obras/:id/itens/:itemId', async (req) => {
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const obra = await obraDaEmpresa(c, empresaId, req.params.id);
        if ((await c.query('SELECT 1 FROM orcamento_itens WHERE obra_item_id = $1 LIMIT 1', [req.params.itemId])).rowCount)
          throw new ErroHttp(409, 'Este item está no orçamento. Retire-o do orçamento antes.');
        if ((await c.query('SELECT 1 FROM obra_composicao_insumos WHERE insumo_id = $1 LIMIT 1', [req.params.itemId])).rowCount)
          throw new ErroHttp(409, 'Este insumo faz parte de um serviço da obra. Retire-o do serviço antes.');
        await c.query('DELETE FROM obra_itens WHERE id = $1 AND obra_id = $2', [req.params.itemId, obra.id]);
      });
      return { ok: true };
    });

    // ---------------------------------------------------------------- EAP

    app.get<{ Params: { id: string } }>('/obras/:id/eap', async (req) => {
      const empresaId = empresaDo(req);
      await obraDaEmpresa(banco, empresaId, req.params.id);
      const r = await banco.query(
        `SELECT n.*, (SELECT count(*)::int FROM orcamento_itens oq WHERE oq.eap_no_id = n.id) AS itens,
                (SELECT coalesce(sum(oq.quantidade * ${precoObra('oi')}), 0) FROM orcamento_itens oq JOIN obra_itens oi ON oi.id = oq.obra_item_id WHERE oq.eap_no_id = n.id) AS subtotal
           FROM eap_nos n WHERE n.obra_id = $1 ORDER BY string_to_array(n.codigo, '.')::int[]`,
        [req.params.id],
      );
      return { nos: r.rows.map((n) => ({ id: n.id, paiId: n.pai_id, nivel: n.nivel, codigo: n.codigo, descricao: n.descricao, itens: n.itens, subtotal: reais(n.subtotal) })) };
    });

    app.post<{ Params: { id: string } }>('/obras/:id/eap', async (req, reply) => {
      const d = z.object({ paiId: z.string().regex(UUID).optional().nullable(), descricao: z.string().trim().min(2, 'Descreva o nó.').max(200) }).parse(req.body);
      const empresaId = empresaDo(req);
      const id = await emTransacao(banco, async (c) => {
        const obra = await obraDaEmpresa(c, empresaId, req.params.id);
        let pai: { id: string; nivel: NivelEap; codigo: string } | null = null;
        if (d.paiId) {
          const p = (await c.query('SELECT id, nivel, codigo FROM eap_nos WHERE id = $1 AND obra_id = $2', [d.paiId, obra.id])).rows[0];
          if (!p) throw naoEncontrado('Nó pai');
          pai = { id: p.id, nivel: p.nivel, codigo: p.codigo };
        }
        const nivel = nivelDoNovoNo(obra.nivel_apropriacao, pai?.nivel ?? null);
        if (!nivel) throw new ErroHttp(400, obra.nivel_apropriacao === 'obra' ? 'Esta obra lança o orçamento no nível da obra, sem EAP.' : 'Este nível não está disponível: a EAP vai até o nível de apropriação da obra.');
        const irmaos = (await c.query('SELECT count(*)::int AS n FROM eap_nos WHERE obra_id = $1 AND pai_id IS NOT DISTINCT FROM $2', [obra.id, pai?.id ?? null])).rows[0].n;
        const x = (
          await c.query(`INSERT INTO eap_nos (obra_id, pai_id, nivel, codigo, descricao) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [obra.id, pai?.id ?? null, nivel, codigoDoNo(pai?.codigo ?? null, irmaos), d.descricao])
        ).rows[0];
        return x.id as string;
      });
      reply.code(201);
      return { id };
    });

    app.put<{ Params: { id: string; noId: string } }>('/obras/:id/eap/:noId', async (req) => {
      const d = z.object({ descricao: z.string().trim().min(2).max(200) }).parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const obra = await obraDaEmpresa(c, empresaId, req.params.id);
        const n = (await c.query('UPDATE eap_nos SET descricao = $3 WHERE id = $1 AND obra_id = $2 RETURNING id', [req.params.noId, obra.id, d.descricao])).rowCount;
        if (!n) throw naoEncontrado('Nó da EAP');
      });
      return { ok: true };
    });

    app.delete<{ Params: { id: string; noId: string } }>('/obras/:id/eap/:noId', async (req) => {
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const obra = await obraDaEmpresa(c, empresaId, req.params.id);
        if ((await c.query('SELECT 1 FROM eap_nos WHERE pai_id = $1 LIMIT 1', [req.params.noId])).rowCount)
          throw new ErroHttp(409, 'Este nó tem filhos. Exclua-os antes.');
        if ((await c.query('SELECT 1 FROM orcamento_itens WHERE eap_no_id = $1 LIMIT 1', [req.params.noId])).rowCount)
          throw new ErroHttp(409, 'Este nó tem itens no orçamento. Retire-os antes.');
        if ((await c.query('SELECT 1 FROM obra_necessidades WHERE eap_no_id = $1 LIMIT 1', [req.params.noId])).rowCount)
          throw new ErroHttp(409, 'Este nó tem insumos apropriados. Retire-os antes.');
        if ((await c.query('SELECT 1 FROM obra_atividades WHERE eap_no_id = $1 LIMIT 1', [req.params.noId])).rowCount)
          throw new ErroHttp(409, 'Este nó tem atividades no planejamento. Retire-as antes.');
        const n = (await c.query('DELETE FROM eap_nos WHERE id = $1 AND obra_id = $2', [req.params.noId, obra.id])).rowCount;
        if (!n) throw naoEncontrado('Nó da EAP');
      });
      return { ok: true };
    });

    // ---------------------------------------------------------------- orçamento

    // ---------------------------------------------------------------- planejamento (fase 2)

    /** Atividade no nível do orçamento: obra sem EAP, ou nó da EAP no nível de apropriação. */
    async function validarNoDaAtividade(c: Cliente, obra: Record<string, any>, eapNoId: string | null) {
      if (obra.nivel_apropriacao === 'obra') {
        if (eapNoId) throw new ErroHttp(400, 'Esta obra planeja no nível da obra, sem nó da EAP.');
        return;
      }
      if (!eapNoId) throw new ErroHttp(400, `Escolha o nó da EAP no nível ${obra.nivel_apropriacao}.`);
      const no = (await c.query('SELECT nivel FROM eap_nos WHERE id = $1 AND obra_id = $2', [eapNoId, obra.id])).rows[0];
      if (!no) throw naoEncontrado('Nó da EAP');
      if (no.nivel !== obra.nivel_apropriacao) throw new ErroHttp(400, `O planejamento usa o nível ${obra.nivel_apropriacao}; este nó é ${no.nivel}.`);
    }

    const dataIso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

    app.get<{ Params: { id: string } }>('/obras/:id/planejamento', async (req) => {
      const empresaId = empresaDo(req);
      await obraDaEmpresa(banco, empresaId, req.params.id);
      const r = await banco.query(
        `SELECT a.*, n.codigo AS eap_codigo, n.descricao AS eap_descricao
           FROM obra_atividades a LEFT JOIN eap_nos n ON n.id = a.eap_no_id
          WHERE a.obra_id = $1 ORDER BY a.ordem, a.criado_em`,
        [req.params.id],
      );
      const datas = calcularDatas(r.rows.map((a) => ({ id: a.id, inicio: dataIso(a.inicio), duracaoDias: Number(a.duracao_dias), predecessoraId: a.predecessora_id ?? null })));
      return {
        atividades: r.rows.map((a) => {
          const d = datas.get(a.id)!;
          return {
            id: a.id, ordem: a.ordem, descricao: a.descricao, eapNoId: a.eap_no_id ?? null, eapCodigo: a.eap_codigo ?? null, eapDescricao: a.eap_descricao ?? null,
            inicioInformado: dataIso(a.inicio), duracaoDias: Number(a.duracao_dias), predecessoraId: a.predecessora_id ?? null, inicio: d.inicio, fim: d.fim,
          };
        }),
      };
    });

    app.post<{ Params: { id: string } }>('/obras/:id/planejamento', async (req, reply) => {
      const d = esquemaAtividade.parse(req.body);
      const empresaId = empresaDo(req);
      const id = await emTransacao(banco, async (c) => {
        const obra = await obraDaEmpresa(c, empresaId, req.params.id);
        await validarNoDaAtividade(c, obra, d.eapNoId ?? null);
        if (d.predecessoraId && !(await c.query('SELECT 1 FROM obra_atividades WHERE id = $1 AND obra_id = $2', [d.predecessoraId, obra.id])).rowCount)
          throw naoEncontrado('Atividade predecessora');
        const ordem = (await c.query('SELECT coalesce(max(ordem), 0) + 1 AS n FROM obra_atividades WHERE obra_id = $1', [obra.id])).rows[0].n;
        const r = await c.query(
          `INSERT INTO obra_atividades (obra_id, eap_no_id, descricao, inicio, duracao_dias, predecessora_id, ordem)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [obra.id, d.eapNoId ?? null, d.descricao, d.inicio, d.duracaoDias, d.predecessoraId ?? null, ordem],
        );
        return r.rows[0].id as string;
      });
      reply.code(201);
      return { id };
    });

    app.put<{ Params: { id: string; atId: string } }>('/obras/:id/planejamento/:atId', async (req) => {
      const d = esquemaAtividade.partial().parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const obra = await obraDaEmpresa(c, empresaId, req.params.id);
        const atual = (await c.query('SELECT * FROM obra_atividades WHERE id = $1 AND obra_id = $2', [req.params.atId, obra.id])).rows[0];
        if (!atual) throw naoEncontrado('Atividade');
        const campos = {
          descricao: d.descricao ?? atual.descricao,
          eapNoId: d.eapNoId !== undefined ? d.eapNoId : atual.eap_no_id,
          inicio: d.inicio ?? dataIso(atual.inicio),
          duracaoDias: d.duracaoDias ?? Number(atual.duracao_dias),
          predecessoraId: d.predecessoraId !== undefined ? d.predecessoraId : atual.predecessora_id,
        };
        await validarNoDaAtividade(c, obra, campos.eapNoId ?? null);
        if (campos.predecessoraId) {
          if (!(await c.query('SELECT 1 FROM obra_atividades WHERE id = $1 AND obra_id = $2', [campos.predecessoraId, obra.id])).rowCount)
            throw naoEncontrado('Atividade predecessora');
          const todas = (await c.query('SELECT id, predecessora_id, inicio, duracao_dias FROM obra_atividades WHERE obra_id = $1', [obra.id])).rows;
          const mudadas = todas.map((x) => ({ id: x.id as string, inicio: dataIso(x.inicio), duracaoDias: Number(x.duracao_dias), predecessoraId: (x.id === atual.id ? campos.predecessoraId : x.predecessora_id) as string | null }));
          if (temCiclo(mudadas)) throw new ErroHttp(409, 'Essa predecessora cria um ciclo: a atividade depende dela mesma.');
        }
        await c.query(
          `UPDATE obra_atividades SET descricao = $3, eap_no_id = $4, inicio = $5, duracao_dias = $6, predecessora_id = $7, atualizado_em = now()
            WHERE id = $1 AND obra_id = $2`,
          [atual.id, obra.id, campos.descricao, campos.eapNoId ?? null, campos.inicio, campos.duracaoDias, campos.predecessoraId ?? null],
        );
      });
      return { ok: true };
    });

    app.delete<{ Params: { id: string; atId: string } }>('/obras/:id/planejamento/:atId', async (req) => {
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const obra = await obraDaEmpresa(c, empresaId, req.params.id);
        const n = (await c.query('DELETE FROM obra_atividades WHERE id = $1 AND obra_id = $2', [req.params.atId, obra.id])).rowCount;
        if (!n) throw naoEncontrado('Atividade');
      });
      return { ok: true };
    });

    // ---------------------------------------------------------------- apropriação de insumos (fase 2)

    app.get<{ Params: { id: string } }>('/obras/:id/necessidades', async (req) => {
      const empresaId = empresaDo(req);
      await obraDaEmpresa(banco, empresaId, req.params.id);
      const r = await banco.query(
        `SELECT nec.*, oi.codigo, oi.descricao, oi.unidade, ${precoObra('oi')} AS preco, n.codigo AS eap_codigo, n.descricao AS eap_descricao
           FROM obra_necessidades nec JOIN obra_itens oi ON oi.id = nec.obra_item_id LEFT JOIN eap_nos n ON n.id = nec.eap_no_id
          WHERE nec.obra_id = $1 ORDER BY nec.criado_em`,
        [req.params.id],
      );
      return {
        necessidades: r.rows.map((x) => {
          const preco = reais(x.preco)!;
          const q = Number(x.quantidade);
          return {
            id: x.id, itemId: x.obra_item_id, codigo: x.codigo, descricao: x.descricao, unidade: x.unidade,
            eapNoId: x.eap_no_id ?? null, eapCodigo: x.eap_codigo ?? null, eapDescricao: x.eap_descricao ?? null,
            quantidade: q, dataNecessaria: x.data_necessaria ? dataIso(x.data_necessaria) : null, observacao: x.observacao ?? null,
            status: x.status, precoUnitario: preco, total: r2(q * preco),
          };
        }),
      };
    });

    app.post<{ Params: { id: string } }>('/obras/:id/necessidades', async (req, reply) => {
      const d = esquemaNecessidade.parse(req.body);
      const empresaId = empresaDo(req);
      const id = await emTransacao(banco, async (c) => {
        const obra = await obraDaEmpresa(c, empresaId, req.params.id);
        if (!(await c.query(`SELECT 1 FROM obra_itens WHERE id = $1 AND obra_id = $2 AND tipo = 'insumo'`, [d.itemId, obra.id])).rowCount)
          throw new ErroHttp(400, 'Só insumos da obra podem ser solicitados.');
        await validarNoDaAtividade(c, obra, d.eapNoId ?? null);
        const r = await c.query(
          `INSERT INTO obra_necessidades (obra_id, obra_item_id, eap_no_id, quantidade, data_necessaria, observacao)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [obra.id, d.itemId, d.eapNoId ?? null, d.quantidade, d.dataNecessaria ?? null, d.observacao ?? null],
        );
        return r.rows[0].id as string;
      });
      reply.code(201);
      return { id };
    });

    app.put<{ Params: { id: string; necId: string } }>('/obras/:id/necessidades/:necId', async (req) => {
      const d = esquemaNecessidade.omit({ itemId: true }).extend({ status: z.enum(['pendente', 'cancelada']).optional() }).partial().parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const obra = await obraDaEmpresa(c, empresaId, req.params.id);
        const atual = (await c.query('SELECT * FROM obra_necessidades WHERE id = $1 AND obra_id = $2', [req.params.necId, obra.id])).rows[0];
        if (!atual) throw naoEncontrado('Necessidade');
        const campos = {
          eapNoId: d.eapNoId !== undefined ? d.eapNoId : atual.eap_no_id,
          quantidade: d.quantidade ?? Number(atual.quantidade),
          dataNecessaria: d.dataNecessaria !== undefined ? d.dataNecessaria : atual.data_necessaria ? dataIso(atual.data_necessaria) : null,
          observacao: d.observacao !== undefined ? d.observacao : atual.observacao,
          status: d.status ?? atual.status,
        };
        await validarNoDaAtividade(c, obra, campos.eapNoId ?? null);
        await c.query(
          `UPDATE obra_necessidades SET eap_no_id = $3, quantidade = $4, data_necessaria = $5, observacao = $6, status = $7, atualizado_em = now()
            WHERE id = $1 AND obra_id = $2`,
          [atual.id, obra.id, campos.eapNoId ?? null, campos.quantidade, campos.dataNecessaria, campos.observacao ?? null, campos.status],
        );
      });
      return { ok: true };
    });

    app.delete<{ Params: { id: string; necId: string } }>('/obras/:id/necessidades/:necId', async (req) => {
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const obra = await obraDaEmpresa(c, empresaId, req.params.id);
        const n = (await c.query('DELETE FROM obra_necessidades WHERE id = $1 AND obra_id = $2', [req.params.necId, obra.id])).rowCount;
        if (!n) throw naoEncontrado('Necessidade');
      });
      return { ok: true };
    });

    app.get<{ Params: { id: string } }>('/obras/:id/orcamento', async (req) => {
      const empresaId = empresaDo(req);
      const obra = await obraDaEmpresa(banco, empresaId, req.params.id);
      const r = await banco.query(
        `SELECT oq.id, oq.eap_no_id, oq.quantidade, oq.ordem, n.codigo AS eap_codigo, n.descricao AS eap_descricao, n.nivel AS eap_nivel,
                oi.id AS item_id, oi.tipo, oi.codigo, oi.descricao, oi.unidade, oi.editado, ${precoObra('oi')} AS preco
           FROM orcamento_itens oq JOIN obra_itens oi ON oi.id = oq.obra_item_id LEFT JOIN eap_nos n ON n.id = oq.eap_no_id
          WHERE oq.obra_id = $1 ORDER BY string_to_array(n.codigo, '.')::int[] NULLS FIRST, oq.ordem, oq.criado_em`,
        [req.params.id],
      );
      const linhas = r.rows.map((x) => {
        const precoUnit = reais(x.preco)!;
        return {
          id: x.id, eapNoId: x.eap_no_id, eapCodigo: x.eap_codigo, eapDescricao: x.eap_descricao, eapNivel: x.eap_nivel,
          itemId: x.item_id, tipo: x.tipo, codigo: x.codigo, descricao: x.descricao, unidade: x.unidade, editado: x.editado,
          quantidade: Number(x.quantidade), precoUnitario: precoUnit, total: r2(Number(x.quantidade) * precoUnit),
        };
      });
      const subtotal = r2(linhas.reduce((s, l) => s + l.total, 0));
      const bdi = r2((subtotal * Number(obra.bdi_percentual)) / 100);
      return { nivelApropriacao: obra.nivel_apropriacao, bdiPercentual: Number(obra.bdi_percentual), subtotal, bdi, total: r2(subtotal + bdi), linhas };
    });

    app.post<{ Params: { id: string } }>('/obras/:id/orcamento/itens', async (req, reply) => {
      const d = z.object({ eapNoId: z.string().regex(UUID).optional().nullable(), itemId: z.string().regex(UUID), quantidade: z.number().positive('A quantidade precisa ser maior que zero.') }).parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const obra = await obraDaEmpresa(c, empresaId, req.params.id);
        const item = (await c.query('SELECT id FROM obra_itens WHERE id = $1 AND obra_id = $2', [d.itemId, obra.id])).rows[0];
        if (!item) throw naoEncontrado('Item da obra');
        if (obra.nivel_apropriacao === 'obra') {
          if (d.eapNoId) throw new ErroHttp(400, 'Esta obra lança o orçamento no nível da obra, sem nó da EAP.');
        } else {
          if (!d.eapNoId) throw new ErroHttp(400, `Escolha o nó da EAP no nível ${obra.nivel_apropriacao}.`);
          const no = (await c.query('SELECT nivel FROM eap_nos WHERE id = $1 AND obra_id = $2', [d.eapNoId, obra.id])).rows[0];
          if (!no) throw naoEncontrado('Nó da EAP');
          if (no.nivel !== obra.nivel_apropriacao) throw new ErroHttp(400, `O orçamento é lançado no nível ${obra.nivel_apropriacao}; este nó é ${no.nivel}.`);
        }
        const ordem = (await c.query('SELECT coalesce(max(ordem), 0) + 1 AS n FROM orcamento_itens WHERE obra_id = $1', [obra.id])).rows[0].n;
        await c.query('INSERT INTO orcamento_itens (obra_id, eap_no_id, obra_item_id, quantidade, ordem) VALUES ($1,$2,$3,$4,$5)', [obra.id, d.eapNoId ?? null, d.itemId, d.quantidade, ordem]);
      });
      reply.code(201);
      return { ok: true };
    });

    app.patch<{ Params: { id: string; linhaId: string } }>('/obras/:id/orcamento/itens/:linhaId', async (req) => {
      const d = z.object({ quantidade: z.number().positive('A quantidade precisa ser maior que zero.') }).parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const obra = await obraDaEmpresa(c, empresaId, req.params.id);
        const n = (await c.query('UPDATE orcamento_itens SET quantidade = $3 WHERE id = $1 AND obra_id = $2', [req.params.linhaId, obra.id, d.quantidade])).rowCount;
        if (!n) throw naoEncontrado('Linha do orçamento');
      });
      return { ok: true };
    });

    app.delete<{ Params: { id: string; linhaId: string } }>('/obras/:id/orcamento/itens/:linhaId', async (req) => {
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const obra = await obraDaEmpresa(c, empresaId, req.params.id);
        const n = (await c.query('DELETE FROM orcamento_itens WHERE id = $1 AND obra_id = $2', [req.params.linhaId, obra.id])).rowCount;
        if (!n) throw naoEncontrado('Linha do orçamento');
      });
      return { ok: true };
    });
  };
}

async function tabelaDetalhe(c: Cliente | Banco, empresaId: string, id: string) {
  const r = (
    await c.query(
      `SELECT t.*, (SELECT count(*) FROM ref_itens i WHERE i.tabela_id = t.id AND i.tipo = 'insumo')::int AS insumos,
              (SELECT count(*) FROM ref_itens i WHERE i.tabela_id = t.id AND i.tipo = 'composicao')::int AS composicoes
         FROM ref_tabelas t WHERE t.id = $1 AND t.empresa_id = $2`,
      [id, empresaId],
    )
  ).rows[0];
  if (!r) throw naoEncontrado('Tabela de referência');
  return r;
}

async function obraDetalhe(c: Cliente | Banco, empresaId: string, id: string) {
  const r = (await c.query('SELECT o.*, cc.nome AS centro_nome FROM obras o JOIN centros_custo cc ON cc.id = o.centro_custo_id WHERE o.id = $1 AND o.empresa_id = $2', [id, empresaId])).rows[0];
  if (!r) throw naoEncontrado('Obra');
  return r;
}

function tabelaPublica(t: Record<string, any>) {
  return {
    id: t.id as string,
    fonte: t.fonte as 'sinapi' | 'proprio',
    nome: t.nome as string,
    uf: (t.uf as string | null) ?? null,
    mesReferencia: (t.mes_referencia as string | null) ?? null,
    desonerado: !!t.desonerado,
    insumos: Number(t.insumos ?? 0),
    composicoes: Number(t.composicoes ?? 0),
    editavel: t.fonte === 'proprio',
  };
}

function obraPublica(o: Record<string, any>) {
  return {
    id: o.id as string,
    codigo: o.codigo as string,
    nome: o.nome as string,
    endereco: (o.endereco as string | null) ?? null,
    cidade: (o.cidade as string | null) ?? null,
    uf: (o.uf as string | null) ?? null,
    responsavel: (o.responsavel as string | null) ?? null,
    status: o.status as string,
    dataInicio: (o.data_inicio as string | null) ?? null,
    dataPrevisao: (o.data_previsao as string | null) ?? null,
    nivelApropriacao: o.nivel_apropriacao as string,
    bdiPercentual: Number(o.bdi_percentual),
    bdiModo: (o.bdi_modo as 'calculado' | 'informado' | undefined) ?? 'informado',
    bdiParametros: (o.bdi_parametros as Partial<ParametrosBdi> | null) ?? null,
    centroCustoId: o.centro_custo_id as string,
    centroCustoNome: (o.centro_nome as string | null) ?? null,
  };
}

function itemObraPublico(i: Record<string, any>) {
  return {
    id: i.id as string,
    tipo: i.tipo as 'insumo' | 'composicao',
    codigo: i.codigo as string,
    descricao: i.descricao as string,
    unidade: i.unidade as string,
    grupo: (i.grupo as string | null) ?? null,
    preco: reais(i.preco),
    precoReferencia: reais(i.preco_referencia_centavos),
    editado: !!i.editado,
    origem: i.origem_fonte ? `${i.origem_versao ?? i.origem_fonte}` : null,
    componentes: Number(i.componentes ?? 0),
    noOrcamento: Number(i.no_orcamento ?? 0) > 0,
  };
}
