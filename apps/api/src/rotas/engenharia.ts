// Engenharia (Fase 1): tabelas de referência (SINAPI e próprio), obras com centro de custo e nível de apropriação,
// itens copiados para cada obra (editáveis só na obra), EAP por níveis e orçamento.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Banco, Cliente } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';
import { ErroIa, iaDisponivel } from '../lib/ia-nota.ts';
import { aplicarMapa, esquemaValoresTipo, linhasUteis, mapaRecortado, mapearColunasIa, type Externos } from '../lib/ia-sinapi.ts';
import { empresaDo, exigir } from '../sessao.ts';
import {
  abcInsumos,
  abcServicos,
  compararCodigo,
  curvaAbc,
  LIMITES_ABC,
  moverLinha,
  renumerar,
  erroMudarNivel,
  erroPaiPlanilha,
  erroServicoNaLinha,
  montarRelatorioOrcamento,
  NIVEIS_PLANILHA,
  paiAutomatico,
  totaisPlanilha,
  type InsumoComposicaoRel,
  type NivelPlanilha,
} from '../lib/engenharia.ts';
import { bdiCalculado, calcularDatas, codigoDoNo, erroItemOrcamento, folhasDaEap, lerCsvReferencia, NIVEIS_OBRA, numeroBr, temCiclo, type ParametrosBdi } from '../lib/engenharia.ts';

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
const LIMITE_ARQUIVO = 60_000_000;
const LIMITE_CORPO = 64 * 1024 * 1024;

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

    /**
     * Grava itens de referência em lote (unnest, de 500 em 500).
     * idsExistentes: itens que já estão na tabela (importação para tabela existente), chave "tipo:codigo".
     */
    async function gravarItensRef(
      c: Cliente,
      tabelaId: string,
      leitura: ReturnType<typeof lerCsvReferencia>,
      idsExistentes = new Map<string, string>(),
      composicoesVazias = new Set<string>(),
      composicoesSemEstrutura = new Set<string>(),
    ) {
      const ids = new Map(idsExistentes);
      const insumos = leitura.insumos.filter((x) => !ids.has(`insumo:${x.codigo}`));
      const composicoes = leitura.composicoes.filter((x) => !ids.has(`composicao:${x.codigo}`));
      // Recebem itens: as composições novas e as que já existiam sem nenhum insumo (importação anterior incompleta).
      const novasComposicoes = new Set([...composicoes.map((x) => x.codigo), ...leitura.composicoes.filter((x) => composicoesVazias.has(x.codigo)).map((x) => x.codigo)]);
      for (let i = 0; i < insumos.length; i += 500) {
        const lote = insumos.slice(i, i + 500);
        const r = await c.query(
          `INSERT INTO ref_itens (tabela_id, tipo, codigo, descricao, unidade, grupo, preco_centavos)
           SELECT $1, 'insumo', * FROM unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::bigint[]) RETURNING id, codigo`,
          [tabelaId, lote.map((x) => x.codigo), lote.map((x) => x.descricao), lote.map((x) => x.unidade), lote.map((x) => x.grupo), lote.map((x) => x.precoCentavos)],
        );
        for (const x of r.rows) ids.set(`insumo:${x.codigo}`, x.id);
      }
      for (let i = 0; i < composicoes.length; i += 500) {
        const lote = composicoes.slice(i, i + 500);
        const r = await c.query(
          `INSERT INTO ref_itens (tabela_id, tipo, codigo, descricao, unidade, grupo)
           SELECT $1, 'composicao', * FROM unnest($2::text[], $3::text[], $4::text[], $5::text[]) RETURNING id, codigo`,
          [tabelaId, lote.map((x) => x.codigo), lote.map((x) => x.descricao), lote.map((x) => x.unidade), lote.map((x) => x.grupo)],
        );
        for (const x of r.rows) ids.set(`composicao:${x.codigo}`, x.id);
      }
      // Só compõe as composições novas; o mesmo insumo repetido numa composição soma os coeficientes.
      const somados = new Map<string, { composicaoId: string; insumoId: string; coeficiente: number }>();
      for (const k of leitura.componentes) {
        const composicaoId = ids.get(`composicao:${k.composicao}`);
        const insumoId = ids.get(`insumo:${k.insumo}`);
        if (!composicaoId || !insumoId || !novasComposicoes.has(k.composicao)) continue;
        const chave = `${composicaoId}:${insumoId}`;
        const atual = somados.get(chave);
        if (atual) atual.coeficiente += k.coeficiente;
        else somados.set(chave, { composicaoId, insumoId, coeficiente: k.coeficiente });
      }
      const comp = [...somados.values()];
      for (let i = 0; i < comp.length; i += 1000) {
        const lote = comp.slice(i, i + 1000);
        await c.query(
          `INSERT INTO ref_composicao_insumos (composicao_id, insumo_id, coeficiente)
           SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::numeric[]) ON CONFLICT (composicao_id, insumo_id) DO UPDATE SET coeficiente = excluded.coeficiente`,
          [lote.map((k) => k.composicaoId), lote.map((k) => k.insumoId), lote.map((k) => Math.round(k.coeficiente * 1e6) / 1e6)],
        );
      }
      // Estrutura para conferência: itens diretos (insumos e serviços auxiliares) das composições compostas agora.
      const estrutura = new Map<string, { composicaoId: string; itemId: string; coeficiente: number }>();
      for (const k of leitura.estrutura) {
        if (!novasComposicoes.has(k.composicao) && !composicoesSemEstrutura.has(k.composicao)) continue;
        const composicaoId = ids.get(`composicao:${k.composicao}`);
        const itemId = ids.get(`${k.tipoItem}:${k.item}`);
        if (!composicaoId || !itemId || composicaoId === itemId) continue;
        const chave = `${composicaoId}:${itemId}`;
        const atual = estrutura.get(chave);
        if (atual) atual.coeficiente += k.coeficiente;
        else estrutura.set(chave, { composicaoId, itemId, coeficiente: k.coeficiente });
      }
      const est = [...estrutura.values()];
      for (let i = 0; i < est.length; i += 1000) {
        const lote = est.slice(i, i + 1000);
        await c.query(
          `INSERT INTO ref_composicao_estrutura (composicao_id, item_id, coeficiente)
           SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::numeric[]) ON CONFLICT (composicao_id, item_id) DO UPDATE SET coeficiente = excluded.coeficiente`,
          [lote.map((k) => k.composicaoId), lote.map((k) => k.itemId), lote.map((k) => Math.round(k.coeficiente * 1e7) / 1e7)],
        );
      }
      return {
        insumos: insumos.length,
        composicoes: composicoes.length,
        componentes: comp.length,
        jaExistiam: leitura.insumos.length - insumos.length + leitura.composicoes.length - composicoes.length,
        completadas: [...novasComposicoes].filter((k) => composicoesVazias.has(k)).length,
      };
    }

    /** Códigos e ids dos itens de uma tabela, e as composições com seus insumos (para importar mais itens nela). */
    async function itensDaTabela(c: Cliente, tabelaId: string) {
      const itens = (await c.query('SELECT id, tipo, codigo FROM ref_itens WHERE tabela_id = $1', [tabelaId])).rows as { id: string; tipo: string; codigo: string }[];
      const ids = new Map(itens.map((i) => [`${i.tipo}:${i.codigo}`, i.id]));
      const comps = (
        await c.query(
          `SELECT ci.codigo AS composicao, ii.codigo AS insumo, rc.coeficiente::float8 AS coeficiente
             FROM ref_composicao_insumos rc JOIN ref_itens ci ON ci.id = rc.composicao_id JOIN ref_itens ii ON ii.id = rc.insumo_id
            WHERE ci.tabela_id = $1`,
          [tabelaId],
        )
      ).rows as { composicao: string; insumo: string; coeficiente: number }[];
      const externos: Externos = { insumos: new Set(itens.filter((i) => i.tipo === 'insumo').map((i) => i.codigo)), composicoes: new Map() };
      for (const i of itens) if (i.tipo === 'composicao') externos.composicoes.set(i.codigo, []);
      for (const k of comps) externos.composicoes.get(k.composicao)?.push({ insumo: k.insumo, coeficiente: k.coeficiente });
      return { ids, externos };
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

    // Leitura com IA, em dois passos e sem gravar nada:
    // 1) mapear-ia: a IA vê só as primeiras linhas e diz em que coluna está cada campo;
    // 2) converter: o navegador manda as colunas úteis da planilha inteira e o servidor gera o CSV padrão.
    app.post('/tabelas/mapear-ia', async (req) => {
      const d = z.object({ amostra: z.string().min(1).max(200_000), uf, desonerado: z.boolean().default(false) }).parse(req.body);
      recusarBinario(d.amostra);
      if (!iaDisponivel()) throw new ErroHttp(503, 'A IA não está configurada. Use o formato padrão do arquivo.');
      try {
        const mapa = await mapearColunasIa(d.amostra, { uf: d.uf ?? null, desonerado: d.desonerado });
        req.log.info({ mapa, inicio: linhasUteis(d.amostra).slice(0, 6) }, '[ia-sinapi] mapa');
        return { mapa };
      } catch (e) {
        if (e instanceof ErroIa) throw new ErroHttp(502, e.message);
        throw e;
      }
    });

    app.post('/tabelas/converter', { bodyLimit: LIMITE_CORPO }, async (req) => {
      const d = z
        .object({
          texto: z.string().min(1).max(LIMITE_ARQUIVO),
          tipoUnico: z.enum(['insumo', 'composicao']).nullable(),
          valoresTipo: esquemaValoresTipo.nullable(),
          tabelaId: z.string().uuid().optional().nullable(),
        })
        .parse(req.body);
      recusarBinario(d.texto);
      let externos: Externos | undefined;
      if (d.tabelaId) {
        await tabelaDaEmpresa(banco, empresaDo(req), d.tabelaId);
        externos = (await itensDaTabela(banco, d.tabelaId)).externos;
      }
      const r = aplicarMapa(d.texto, mapaRecortado(d.tipoUnico, d.valoresTipo), externos);
      const leitura = lerCsvReferencia(r.csv, externos?.insumos);
      if (leitura.erros.length) throw new ErroHttp(422, 'O arquivo foi lido, mas há linhas com erro.', { erros: leitura.erros.slice(0, 50) });
      if (!leitura.insumos.length && !leitura.composicoes.length) {
        // Mostra o que foi lido nas primeiras linhas, para entender o que a IA indicou.
        const exemplo = linhasUteis(d.texto)
          .slice(0, 3)
          .map((l) => {
            const c = l.split(';');
            return `tipo "${c[0] ?? ''}", código "${c[1] ?? ''}", descrição "${(c[2] ?? '').slice(0, 40)}", unidade "${c[3] ?? ''}", item "${c[6] ?? ''}", coeficiente "${c[7] ?? ''}"`;
          });
        req.log.warn({ tipoUnico: d.tipoUnico, valoresTipo: d.valoresTipo, exemplo }, '[ia-sinapi] conversão vazia');
        throw new ErroHttp(422, 'Nenhuma linha virou insumo ou composição. Confira a aba.', {
          erros: [`Tipos esperados pela IA: ${JSON.stringify(d.valoresTipo ?? d.tipoUnico)}`, ...exemplo.map((e, i) => `Linha ${i + 1} lida: ${e}`)],
        });
      }
      return {
        csv: r.csv,
        ignoradas: r.ignoradas,
        semPreco: r.semPreco,
        componentesDescartados: r.componentesDescartados,
        auxiliaresAchatadas: r.auxiliaresAchatadas,
        composicoesSemInsumos: r.composicoesSemInsumos,
        contagem: { insumos: leitura.insumos.length, composicoes: leitura.composicoes.length, componentes: leitura.componentes.length },
      };
    });

    // Importa mais itens numa tabela existente (por exemplo, as composições da SINAPI na tabela dos insumos do mesmo mês).
    // Itens com código já existente ficam como estão; as composições podem usar os insumos que já estão na tabela.
    app.post<{ Params: { id: string } }>('/tabelas/:id/importar', { bodyLimit: LIMITE_CORPO }, async (req) => {
      const d = z.object({ csv: z.string().min(1).max(LIMITE_ARQUIVO) }).parse(req.body);
      recusarBinario(d.csv);
      const empresaId = empresaDo(req);
      const contagem = await emTransacao(banco, async (c) => {
        await tabelaDaEmpresa(c, empresaId, req.params.id);
        const { ids, externos } = await itensDaTabela(c, req.params.id);
        const leitura = lerCsvReferencia(d.csv, externos.insumos);
        if (leitura.erros.length) throw new ErroHttp(400, 'O arquivo tem erros. Corrija e envie de novo.', { erros: leitura.erros.slice(0, 50) });
        const vazias = new Set([...externos.composicoes].filter(([, l]) => l.length === 0).map(([k]) => k));
        const semEstrutura = new Set<string>(
          (
            await c.query(
              `SELECT i.codigo FROM ref_itens i WHERE i.tabela_id = $1 AND i.tipo = 'composicao'
                  AND NOT EXISTS (SELECT 1 FROM ref_composicao_estrutura e WHERE e.composicao_id = i.id)`,
              [req.params.id],
            )
          ).rows.map((x: { codigo: string }) => x.codigo),
        );
        const r = await gravarItensRef(c, req.params.id, leitura, ids, vazias, semEstrutura);
        await c.query('UPDATE ref_tabelas SET atualizado_em = now() WHERE id = $1', [req.params.id]);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'ref_tabelas', entidadeId: req.params.id, depois: { importacao: r } });
        return r;
      });
      return { contagem, tabela: tabelaPublica(await tabelaDetalhe(banco, empresaId, req.params.id)) };
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
      // Estrutura original (insumos e serviços auxiliares diretos). Sem ela (tabela antiga ou própria), os próprios insumos.
      const est = (
        await banco.query(
          `SELECT ri.id, ri.tipo, ri.codigo, ri.descricao, ri.unidade, e.coeficiente, ${precoRef('ri')} AS preco
             FROM ref_composicao_estrutura e JOIN ref_itens ri ON ri.id = e.item_id
            WHERE e.composicao_id = $1 ORDER BY ri.tipo DESC, ri.codigo`,
          [i.id],
        )
      ).rows;
      return {
        item: { id: i.id, tipo: i.tipo, codigo: i.codigo, descricao: i.descricao, unidade: i.unidade, grupo: i.grupo, preco: reais(i.preco) },
        componentes: comp.map((k) => ({ codigo: k.codigo, descricao: k.descricao, unidade: k.unidade, coeficiente: Number(k.coeficiente), precoUnitario: reais(k.preco_centavos) })),
        estrutura: est.map((k) => ({ id: k.id, tipo: k.tipo, codigo: k.codigo, descricao: k.descricao, unidade: k.unidade, coeficiente: Number(k.coeficiente), precoUnitario: k.preco === null ? null : Number(k.preco) / 100 })),
      };
    });

    // Itens de tabela própria são editáveis; SINAPI é imutável (nova versão = nova importação).
    app.post<{ Params: { id: string } }>('/tabelas/:id/itens', async (req, reply) => {
      const d = esquemaItemRef.parse(req.body);
      const empresaId = empresaDo(req);
      const id = await emTransacao(banco, async (c) => {
        const t = await tabelaDaEmpresa(c, empresaId, req.params.id);
        if (t.fonte !== 'proprio') throw new ErroHttp(409, 'A tabela SINAPI é imutável. Para outra versão, importe uma nova tabela.');
        const preco = d.tipo === 'insumo' ? precoCentavos(d.preco) : null;
        if (d.tipo === 'insumo' && preco === null) throw new ErroHttp(400, 'Informe um preço válido para o insumo.');
        const x = (
          await c.query(`INSERT INTO ref_itens (tabela_id, tipo, codigo, descricao, unidade, grupo, preco_centavos) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [t.id, d.tipo, d.codigo, d.descricao, d.unidade, d.grupo, preco])
        ).rows[0];
        if (d.tipo === 'composicao') await gravarComponentes(c, t.id, x.id, d.componentes ?? []);
        return x.id as string;
      }).catch((e: Error & { code?: string }) => {
        if (e.code === '23505') throw new ErroHttp(409, 'Já existe um item com esse código nesta tabela.');
        throw e;
      });
      reply.code(201);
      return { ok: true, id };
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

    /** Panorama da construtora: indicadores de todas as obras ativas (orçado, prazo, atividades, necessidades pendentes). */
    app.get('/panorama', async (req) => {
      const empresaId = empresaDo(req);
      const dIso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
      const hoje = new Date().toISOString().slice(0, 10);
      const obras = await banco.query(
        `SELECT o.id, o.codigo, o.nome, o.status, o.data_inicio, o.data_previsao, o.bdi_percentual,
                (SELECT count(*)::int FROM orcamento_itens oq WHERE oq.obra_id = o.id) AS linhas_orcamento,
                (SELECT coalesce(sum(oq.quantidade * ${precoObra('oi')}), 0) FROM orcamento_itens oq JOIN obra_itens oi ON oi.id = oq.obra_item_id WHERE oq.obra_id = o.id) AS subtotal,
                (SELECT count(*)::int FROM obra_necessidades nec WHERE nec.obra_id = o.id AND nec.status = 'pendente') AS necessidades_pendentes,
                (SELECT coalesce(sum(nec.quantidade * ${precoObra('oi')}), 0) FROM obra_necessidades nec JOIN obra_itens oi ON oi.id = nec.obra_item_id WHERE nec.obra_id = o.id AND nec.status = 'pendente') AS necessidades_valor
           FROM obras o WHERE o.empresa_id = $1 AND o.ativo ORDER BY o.codigo`,
        [empresaId],
      );
      const atividades = await banco.query(
        `SELECT a.id, a.obra_id, a.inicio, a.duracao_dias, a.predecessora_id
           FROM obra_atividades a JOIN obras o ON o.id = a.obra_id WHERE o.empresa_id = $1 AND o.ativo`,
        [empresaId],
      );
      const porObra = new Map<string, Record<string, any>[]>();
      for (const a of atividades.rows) porObra.set(a.obra_id, [...(porObra.get(a.obra_id) ?? []), a]);

      const lista = obras.rows.map((o) => {
        const ats = porObra.get(o.id) ?? [];
        const datas = calcularDatas(ats.map((a) => ({ id: a.id, inicio: dIso(a.inicio)!, duracaoDias: Number(a.duracao_dias), predecessoraId: a.predecessora_id ?? null })));
        const fimPlanejado = ats.length ? [...datas.values()].map((d) => d.fim).sort().at(-1)! : null;
        const previsao = dIso(o.data_previsao);
        const concluida = o.status === 'concluida';
        return {
          id: o.id as string,
          codigo: o.codigo as string,
          nome: o.nome as string,
          status: o.status as string,
          dataInicio: dIso(o.data_inicio),
          dataPrevisao: previsao,
          orcado: r2(reais(o.subtotal)! * (1 + Number(o.bdi_percentual) / 100)),
          linhasOrcamento: o.linhas_orcamento as number,
          atividades: ats.length,
          fimPlanejado,
          atrasada: !concluida && !!previsao && previsao < hoje,
          estourandoPrazo: !!previsao && !!fimPlanejado && fimPlanejado > previsao,
          necessidadesPendentes: o.necessidades_pendentes as number,
          necessidadesValor: r2(reais(o.necessidades_valor)!),
        };
      });
      const ativas = lista.filter((o) => o.status !== 'concluida');
      return {
        hoje,
        resumo: {
          obras: lista.length,
          emAndamento: lista.filter((o) => o.status === 'em_andamento').length,
          orcadoTotal: r2(lista.reduce((s, o) => s + o.orcado, 0)),
          atrasadas: lista.filter((o) => o.atrasada).length,
          necessidadesPendentes: lista.reduce((s, o) => s + o.necessidadesPendentes, 0),
          ativas: ativas.length,
        },
        obras: lista,
      };
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
          // A planilha (EAP e orçamento) vale para qualquer nível; o nível de apropriação só guia a apropriação de insumos e o planejamento.
          const usados = (
            await c.query(
              `SELECT (SELECT count(*) FROM obra_necessidades WHERE obra_id = $1)::int + (SELECT count(*) FROM obra_atividades WHERE obra_id = $1)::int AS n`,
              [atual.id],
            )
          ).rows[0].n;
          if (usados) throw new ErroHttp(409, 'Esta obra já tem insumos apropriados ou atividades no planejamento. Retire-os antes de mudar o nível de apropriação.');
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

    // ---------------------------------------------------------------- orçamento

    // ---------------------------------------------------------------- planejamento (fase 2)

    /** Atividade do planejamento: sempre ligada a uma linha da EAP (planilha) desta obra, de qualquer nível. */
    async function validarLinhaPlanejamento(c: Cliente, obra: Record<string, any>, eapNoId: string | null | undefined) {
      if (!eapNoId) throw new ErroHttp(400, 'Escolha a linha da EAP da atividade.');
      if (!(await c.query('SELECT 1 FROM eap_nos WHERE id = $1 AND obra_id = $2', [eapNoId, obra.id])).rowCount) throw naoEncontrado('Linha da EAP');
    }

    /** Atividade no nível de apropriação (usada pelas necessidades de insumo). */
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
      // Na ordem da EAP (planilha): a estrutura do planejamento é a da planilha.
      const porEap = [...r.rows].sort((x, y) => {
        if (!x.eap_codigo || !y.eap_codigo) return x.eap_codigo ? -1 : y.eap_codigo ? 1 : 0;
        return compararCodigo(x.eap_codigo, y.eap_codigo);
      });
      return {
        atividades: porEap.map((a) => {
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
        await validarLinhaPlanejamento(c, obra, d.eapNoId);
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
        await validarLinhaPlanejamento(c, obra, campos.eapNoId);
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

    /** Cria uma atividade por folha da EAP que ainda não tem atividade. Início: data de início da obra (ou hoje); duração 1 dia. */
    app.post<{ Params: { id: string } }>('/obras/:id/planejamento/gerar-da-eap', async (req) => {
      const empresaId = empresaDo(req);
      return emTransacao(banco, async (c) => {
        const obra = await obraDaEmpresa(c, empresaId, req.params.id);
        const linhas = (await c.query('SELECT id, pai_id, codigo, descricao FROM eap_nos WHERE obra_id = $1', [obra.id])).rows;
        const comAtividade = new Set((await c.query('SELECT eap_no_id FROM obra_atividades WHERE obra_id = $1 AND eap_no_id IS NOT NULL', [obra.id])).rows.map((r) => r.eap_no_id as string));
        const folhas = folhasDaEap(linhas.map((l) => ({ id: l.id as string, paiId: (l.pai_id ?? null) as string | null, codigo: l.codigo as string, descricao: l.descricao as string })))
          .filter((l) => !comAtividade.has(l.id));
        if (!folhas.length) return { criadas: 0 };
        const inicio = obra.data_inicio ? dataIso(obra.data_inicio) : new Date().toISOString().slice(0, 10);
        let ordem = (await c.query('SELECT coalesce(max(ordem), 0) AS n FROM obra_atividades WHERE obra_id = $1', [obra.id])).rows[0].n as number;
        for (const folha of folhas) {
          ordem += 1;
          await c.query(
            `INSERT INTO obra_atividades (obra_id, eap_no_id, descricao, inicio, duracao_dias, predecessora_id, ordem)
             VALUES ($1,$2,$3,$4,1,NULL,$5)`,
            [obra.id, folha.id, folha.descricao.slice(0, 200), inicio, ordem],
          );
        }
        return { criadas: folhas.length };
      });
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

    // ---------------------------------------------------------------- planilha orçamentária (EAP e orçamento juntos)
    // Cada linha é um nó da EAP (Obra, Etapa, Sub Etapa ou Tarefa); a Tarefa pode ter um serviço da obra com quantidade.

    /** Linhas da planilha com o serviço de cada Tarefa e o custo (sem BDI). */
    async function linhasPlanilha(c: Cliente, obraId: string) {
      const r = await c.query(
        `SELECT n.id, n.pai_id, n.nivel, n.codigo, n.descricao,
                oq.id AS linha_id, oq.quantidade, oi.id AS item_id, oi.codigo AS item_codigo, oi.descricao AS item_descricao,
                oi.unidade, ${precoObra('oi')} AS custo
           FROM eap_nos n
           LEFT JOIN orcamento_itens oq ON oq.eap_no_id = n.id
           LEFT JOIN obra_itens oi ON oi.id = oq.obra_item_id
          WHERE n.obra_id = $1`,
        [obraId],
      );
      return r.rows
        .map((x) => ({
          id: x.id as string,
          paiId: (x.pai_id as string | null) ?? null,
          nivel: x.nivel as NivelPlanilha,
          codigo: x.codigo as string,
          descricao: x.descricao as string,
          servico: x.linha_id
            ? {
                linhaId: x.linha_id as string,
                itemId: x.item_id as string,
                codigo: x.item_codigo as string,
                descricaoServico: x.item_descricao as string,
                unidade: x.unidade as string,
                quantidade: Number(x.quantidade),
                custoUnitario: reais(x.custo) ?? 0,
              }
            : null,
        }))
        .sort((a, b) => compararCodigo(a.codigo, b.codigo));
    }

    app.get<{ Params: { id: string } }>('/obras/:id/planilha', async (req) => {
      const obra = await obraDaEmpresa(banco, empresaDo(req), req.params.id);
      const linhas = await linhasPlanilha(banco, obra.id);
      const bdi = Number(obra.bdi_percentual);
      const rel = montarRelatorioOrcamento(linhas.map((l) => ({ ...l, servico: l.servico && { ...l.servico } })), bdi, false);
      const totais = totaisPlanilha(linhas.map((l) => ({ id: l.id, paiId: l.paiId, valor: l.servico ? r2(l.servico.quantidade * l.servico.custoUnitario) : 0 })));
      return {
        bdiPercentual: bdi,
        custoTotal: rel.custoTotal,
        bdiValor: rel.bdiValor,
        precoTotal: rel.precoTotal,
        linhas: linhas.map((l) => ({ ...l, custoTotal: totais.get(l.id) ?? 0 })),
      };
    });

    const esquemaLinhaPlanilha = z.object({
      nivel: z.enum(NIVEIS_PLANILHA),
      // null: raiz; ausente: automático (última linha acima de nível mais alto).
      paiId: z.string().regex(UUID).nullable().optional(),
      descricao: z.string().trim().max(200).optional().default(''),
      itemId: z.string().regex(UUID).nullable().optional(),
      quantidade: z.number().positive('A quantidade precisa ser maior que zero.').nullable().optional(),
    });

    /** Confere o serviço (da obra, composição) e devolve a descrição dele. */
    async function servicoDaObra(c: Cliente, obraId: string, itemId: string) {
      const item = (await c.query('SELECT id, tipo, obra_id, descricao FROM obra_itens WHERE id = $1', [itemId])).rows[0];
      const erro = erroItemOrcamento(item ? { tipo: item.tipo, obraId: item.obra_id } : null, obraId);
      if (erro) throw new ErroHttp(400, erro);
      return item.descricao as string;
    }

    app.post<{ Params: { id: string } }>('/obras/:id/planilha', async (req, reply) => {
      const d = esquemaLinhaPlanilha.parse(req.body);
      const empresaId = empresaDo(req);
      const id = await emTransacao(banco, async (c) => {
        const obra = await obraDaEmpresa(c, empresaId, req.params.id);
        const erroServ = erroServicoNaLinha(d.nivel, !!d.itemId);
        if (erroServ) throw new ErroHttp(400, erroServ);
        if (d.itemId && !d.quantidade) throw new ErroHttp(400, 'Informe a quantidade do serviço.');
        const existentes = (await c.query('SELECT id, nivel, codigo FROM eap_nos WHERE obra_id = $1', [obra.id])).rows as { id: string; nivel: NivelPlanilha; codigo: string }[];
        const paiId = d.paiId === undefined ? paiAutomatico(existentes, d.nivel) : d.paiId;
        const pai = paiId ? existentes.find((n) => n.id === paiId) : null;
        if (paiId && !pai) throw naoEncontrado('Linha de cima');
        const erroPai = erroPaiPlanilha(pai?.nivel ?? null, d.nivel);
        if (erroPai) throw new ErroHttp(400, erroPai);
        let descricao = d.descricao;
        if (d.itemId) {
          const descServico = await servicoDaObra(c, obra.id, d.itemId);
          if (!descricao) descricao = descServico;
        }
        if (descricao.length < 2) throw new ErroHttp(400, 'Descreva a linha.');
        const irmaos = (await c.query('SELECT codigo FROM eap_nos WHERE obra_id = $1 AND pai_id IS NOT DISTINCT FROM $2', [obra.id, pai?.id ?? null])).rows as { codigo: string }[];
        const maior = irmaos.reduce((m, x) => Math.max(m, Number(x.codigo.split('.').pop())), 0);
        const no = (
          await c.query('INSERT INTO eap_nos (obra_id, pai_id, nivel, codigo, descricao) VALUES ($1,$2,$3,$4,$5) RETURNING id', [obra.id, pai?.id ?? null, d.nivel, codigoDoNo(pai?.codigo ?? null, maior), descricao])
        ).rows[0];
        if (d.itemId && d.quantidade) {
          const ordem = (await c.query('SELECT coalesce(max(ordem), 0) + 1 AS n FROM orcamento_itens WHERE obra_id = $1', [obra.id])).rows[0].n;
          await c.query('INSERT INTO orcamento_itens (obra_id, eap_no_id, obra_item_id, quantidade, ordem) VALUES ($1,$2,$3,$4,$5)', [obra.id, no.id, d.itemId, d.quantidade, ordem]);
        }
        return no.id as string;
      });
      reply.code(201);
      return { id };
    });

    app.put<{ Params: { id: string; noId: string } }>('/obras/:id/planilha/:noId', async (req) => {
      const d = z
        .object({
          descricao: z.string().trim().min(2, 'Descreva a linha.').max(200).optional(),
          nivel: z.enum(NIVEIS_PLANILHA).optional(),
          // null retira o serviço da Tarefa.
          itemId: z.string().regex(UUID).nullable().optional(),
          quantidade: z.number().positive('A quantidade precisa ser maior que zero.').optional(),
        })
        .parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const obra = await obraDaEmpresa(c, empresaId, req.params.id);
        const no = (await c.query('SELECT id, nivel, pai_id FROM eap_nos WHERE id = $1 AND obra_id = $2', [req.params.noId, obra.id])).rows[0];
        if (!no) throw naoEncontrado('Linha da planilha');
        if (d.descricao !== undefined) await c.query('UPDATE eap_nos SET descricao = $2 WHERE id = $1', [no.id, d.descricao]);
        let linha = (await c.query('SELECT id, quantidade FROM orcamento_itens WHERE eap_no_id = $1', [no.id])).rows[0];
        if (d.itemId === null && linha) {
          await c.query('DELETE FROM orcamento_itens WHERE id = $1', [linha.id]);
          linha = undefined;
        }
        if (d.nivel && d.nivel !== no.nivel) {
          const pai = no.pai_id ? (await c.query('SELECT nivel FROM eap_nos WHERE id = $1', [no.pai_id])).rows[0] : null;
          const filhos = (await c.query('SELECT DISTINCT nivel FROM eap_nos WHERE pai_id = $1', [no.id])).rows.map((x) => x.nivel as NivelPlanilha);
          const erroNivel = erroMudarNivel(pai?.nivel ?? null, d.nivel, filhos, !!linha && !d.itemId);
          if (erroNivel) throw new ErroHttp(400, erroNivel);
          await c.query('UPDATE eap_nos SET nivel = $2 WHERE id = $1', [no.id, d.nivel]);
          no.nivel = d.nivel;
        }
        if (d.itemId === null) {
          // serviço já retirado acima
        } else if (d.itemId) {
          const erroServ = erroServicoNaLinha(no.nivel, true);
          if (erroServ) throw new ErroHttp(400, erroServ);
          await servicoDaObra(c, obra.id, d.itemId);
          const quantidade = d.quantidade ?? (linha ? Number(linha.quantidade) : null);
          if (!quantidade) throw new ErroHttp(400, 'Informe a quantidade do serviço.');
          if (linha) await c.query('UPDATE orcamento_itens SET obra_item_id = $2, quantidade = $3 WHERE id = $1', [linha.id, d.itemId, quantidade]);
          else {
            const ordem = (await c.query('SELECT coalesce(max(ordem), 0) + 1 AS n FROM orcamento_itens WHERE obra_id = $1', [obra.id])).rows[0].n;
            await c.query('INSERT INTO orcamento_itens (obra_id, eap_no_id, obra_item_id, quantidade, ordem) VALUES ($1,$2,$3,$4,$5)', [obra.id, no.id, d.itemId, quantidade, ordem]);
          }
        } else if (d.quantidade !== undefined) {
          if (!linha) throw new ErroHttp(400, 'Esta linha não tem serviço.');
          await c.query('UPDATE orcamento_itens SET quantidade = $2 WHERE id = $1', [linha.id, d.quantidade]);
        }
      });
      return { ok: true };
    });

    /** Grava a nova numeração (em dois passos, por causa do código único por obra). */
    async function gravarCodigos(c: Cliente, obraId: string, codigos: Map<string, string>) {
      const atuais = (await c.query('SELECT id, codigo FROM eap_nos WHERE obra_id = $1', [obraId])).rows as { id: string; codigo: string }[];
      const mudam = atuais.filter((n) => codigos.has(n.id) && codigos.get(n.id) !== n.codigo);
      if (!mudam.length) return;
      const ids = mudam.map((n) => n.id);
      await c.query(`UPDATE eap_nos SET codigo = 'tmp-' || id::text WHERE id = ANY($1::uuid[])`, [ids]);
      await c.query('UPDATE eap_nos n SET codigo = x.codigo FROM unnest($1::uuid[], $2::text[]) AS x(id, codigo) WHERE n.id = x.id', [ids, mudam.map((n) => codigos.get(n.id)!)]);
    }

    // Setas da planilha: a linha troca de lugar com a irmã de cima ou de baixo, levando junto as linhas de baixo dela.
    app.post<{ Params: { id: string; noId: string } }>('/obras/:id/planilha/:noId/mover', async (req) => {
      const d = z.object({ direcao: z.enum(['cima', 'baixo']) }).parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const obra = await obraDaEmpresa(c, empresaId, req.params.id);
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`planilha:${obra.id}`]);
        const nos = (await c.query('SELECT id, pai_id, codigo FROM eap_nos WHERE obra_id = $1', [obra.id])).rows.map((n) => ({ id: n.id as string, paiId: (n.pai_id as string | null) ?? null, codigo: n.codigo as string }));
        if (!nos.some((n) => n.id === req.params.noId)) throw naoEncontrado('Linha da planilha');
        const codigos = moverLinha(nos, req.params.noId, d.direcao);
        if (!codigos) throw new ErroHttp(400, d.direcao === 'cima' ? 'Esta linha já é a primeira do seu grupo.' : 'Esta linha já é a última do seu grupo.');
        await gravarCodigos(c, obra.id, codigos);
      });
      return { ok: true };
    });

    app.delete<{ Params: { id: string; noId: string } }>('/obras/:id/planilha/:noId', async (req) => {
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const obra = await obraDaEmpresa(c, empresaId, req.params.id);
        const no = (await c.query('SELECT id FROM eap_nos WHERE id = $1 AND obra_id = $2', [req.params.noId, obra.id])).rows[0];
        if (!no) throw naoEncontrado('Linha da planilha');
        if ((await c.query('SELECT 1 FROM eap_nos WHERE pai_id = $1 LIMIT 1', [no.id])).rowCount) throw new ErroHttp(409, 'Esta linha tem linhas abaixo dela. Exclua-as antes.');
        if ((await c.query('SELECT 1 FROM obra_necessidades WHERE eap_no_id = $1 LIMIT 1', [no.id])).rowCount) throw new ErroHttp(409, 'Esta linha tem insumos apropriados. Retire-os antes.');
        if ((await c.query('SELECT 1 FROM obra_atividades WHERE eap_no_id = $1 LIMIT 1', [no.id])).rowCount) throw new ErroHttp(409, 'Esta linha tem atividades no planejamento. Retire-as antes.');
        // O serviço da Tarefa sai junto (orcamento_itens apaga em cascata com o nó). Depois, a numeração fecha o buraco.
        await c.query('DELETE FROM eap_nos WHERE id = $1', [no.id]);
        const nos = (await c.query('SELECT id, pai_id, codigo FROM eap_nos WHERE obra_id = $1', [obra.id])).rows.map((n) => ({ id: n.id as string, paiId: (n.pai_id as string | null) ?? null, codigo: n.codigo as string }));
        await gravarCodigos(c, obra.id, renumerar(nos));
      });
      return { ok: true };
    });

    // ---------------------------------------------------------------- relatório de orçamento

    /** Insumos (já desdobrados) de cada serviço lançado na planilha, com o preço da obra. */
    async function composicoesDaPlanilha(linhas: { servico: { itemId: string } | null }[]) {
      const composicoes = new Map<string, InsumoComposicaoRel[]>();
      const ids = [...new Set(linhas.flatMap((l) => (l.servico ? [l.servico.itemId] : [])))];
      if (!ids.length) return composicoes;
      const r = await banco.query(
        `SELECT ci.composicao_id, ii.codigo, ii.descricao, ii.unidade, ci.coeficiente, ii.preco_centavos
           FROM obra_composicao_insumos ci JOIN obra_itens ii ON ii.id = ci.insumo_id
          WHERE ci.composicao_id = ANY($1::uuid[]) ORDER BY ii.descricao`,
        [ids],
      );
      for (const k of r.rows) {
        const l = composicoes.get(k.composicao_id) ?? [];
        l.push({ codigo: k.codigo, descricao: k.descricao, unidade: k.unidade, coeficiente: Number(k.coeficiente), precoUnitario: reais(k.preco_centavos) ?? 0 });
        composicoes.set(k.composicao_id, l);
      }
      return composicoes;
    }

    // Curva ABC: serviços (preço com BDI) ou insumos (custo direto), do maior para o menor valor, com classes A, B e C.
    app.get<{ Params: { id: string }; Querystring: { tipo?: string } }>('/obras/:id/relatorio-abc', async (req) => {
      const obra = await obraDaEmpresa(banco, empresaDo(req), req.params.id);
      const insumos = req.query.tipo === 'insumos';
      const linhas = await linhasPlanilha(banco, obra.id);
      const itens = insumos ? abcInsumos(linhas, await composicoesDaPlanilha(linhas)) : abcServicos(linhas, Number(obra.bdi_percentual));
      return {
        tipo: insumos ? 'insumos' : 'servicos',
        obra: { id: obra.id, codigo: obra.codigo, nome: obra.nome, endereco: obra.endereco, cidade: obra.cidade, uf: obra.uf, responsavel: obra.responsavel, bdiPercentual: Number(obra.bdi_percentual) },
        limites: LIMITES_ABC,
        ...curvaAbc(itens),
      };
    });

    app.get<{ Params: { id: string }; Querystring: { tipo?: string } }>('/obras/:id/relatorio-orcamento', async (req) => {
      const obra = await obraDaEmpresa(banco, empresaDo(req), req.params.id);
      const analitico = req.query.tipo === 'analitico';
      const linhas = await linhasPlanilha(banco, obra.id);
      const composicoes = analitico ? await composicoesDaPlanilha(linhas) : new Map<string, InsumoComposicaoRel[]>();
      const rel = montarRelatorioOrcamento(linhas, Number(obra.bdi_percentual), analitico, composicoes);
      return {
        tipo: analitico ? 'analitico' : 'sintetico',
        obra: { id: obra.id, codigo: obra.codigo, nome: obra.nome, endereco: obra.endereco, cidade: obra.cidade, uf: obra.uf, responsavel: obra.responsavel, bdiPercentual: Number(obra.bdi_percentual) },
        ...rel,
      };
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
