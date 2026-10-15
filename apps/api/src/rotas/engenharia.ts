// Engenharia (Fase 1): tabelas de referência (SINAPI e próprio), obras com centro de custo e nível de apropriação,
// itens copiados para cada obra (editáveis só na obra), EAP por níveis e orçamento.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Banco, Cliente } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { ErroHttp, naoEncontrado, semPermissao } from '../lib/erros.ts';
import { ehEngenheiroDeObra, regraEngenheiroEngenharia } from '../lib/obras-acesso.ts';
import { ErroIa, iaDisponivel } from '../lib/ia-nota.ts';
import { aplicarMapa, esquemaValoresTipo, linhasUteis, mapaRecortado, mapearColunasIa, type Externos } from '../lib/ia-sinapi.ts';
import { empresaDo, exigir } from '../sessao.ts';
import { compararVersoes, criarSnapshot, relatorioDaVersao, type SnapshotVersao } from '../lib/versoes.ts';
import { GRANULARIDADES, montarCompras, montarEquipes, montarGantt, type Granularidade } from '../lib/planejamento-relatorios.ts';
import { curvaS, percentualDeQuantidade, previstoXExecutado, valorExecutadoEm, type Medicao, type AtividadePlan, type NoEap } from '../lib/acompanhamento.ts';
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
import { escolherUltimaCompra, unidadesValidas } from '../lib/unidades-insumo.ts';
import { bdiCalculado, calcularDatas, codigoDoNo, datasComResumos, erroItemOrcamento, aliquotaSimples, formacaoPreco, resumosDaEap, lerCsvReferencia, NIVEIS_OBRA, numeroBr, temCiclo, type ParametrosBdi } from '../lib/engenharia.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
/** Classe de um componente da composição: serviço (composição), equipamento (grupo de equipamentos) ou insumo. */
const classeComponente = (tipo: string, grupo: string | null | undefined) => (tipo === 'composicao' ? 'servico' : /EQUIPAMENT/i.test(grupo ?? '') ? 'equipamento' : 'insumo');
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
const precoObra = (a: string) => `custo_obra_item(${a}.id)`;
/** Mesmo cálculo para os itens da tabela de referência. */
const precoRef = (a: string) => `custo_ref_item(${a}.id)`;

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

/** Próximo código de serviço numa tabela própria. A sequência só anda para frente: apagar não libera número. */
async function proximoCodigoServico(c: Cliente, tabelaId: string, obraId?: string): Promise<string> {
  for (;;) {
    const n = (await c.query('UPDATE ref_tabelas SET proximo_codigo = proximo_codigo + 1 WHERE id = $1 RETURNING proximo_codigo - 1 AS n', [tabelaId])).rows[0].n as number;
    const codigo = String(n);
    if ((await c.query(`SELECT 1 FROM ref_itens WHERE tabela_id = $1 AND tipo = 'composicao' AND codigo = $2`, [tabelaId, codigo])).rowCount) continue;
    if (obraId && (await c.query(`SELECT 1 FROM obra_itens WHERE obra_id = $1 AND tipo = 'composicao' AND codigo = $2`, [obraId, codigo])).rowCount) continue;
    return codigo;
  }
}

/** Código do próximo insumo da tabela própria: prefixo da tabela + sequência (ex.: INS-0001). Pula códigos já usados. */
async function proximoCodigoInsumo(c: Cliente, tabelaId: string): Promise<string> {
  for (;;) {
    const r = (await c.query('UPDATE ref_tabelas SET proximo_insumo = proximo_insumo + 1 WHERE id = $1 RETURNING prefixo_insumo, proximo_insumo - 1 AS n', [tabelaId])).rows[0];
    const codigo = `${r.prefixo_insumo}-${String(r.n).padStart(4, '0')}`;
    if ((await c.query(`SELECT 1 FROM ref_itens WHERE tabela_id = $1 AND tipo = 'insumo' AND codigo = $2`, [tabelaId, codigo])).rowCount) continue;
    return codigo;
  }
}

const esquemaUnidadeCompra = z.object({ unidade: z.string().trim().min(1, 'Informe a unidade de compra.').max(20), fator: z.union([z.number(), z.string()]) });

const esquemaItemRef = z.object({
  tipo: z.enum(['insumo', 'composicao']),
  codigo: z.string().trim().max(40).optional().default(''),
  descricao: z.string().trim().min(2, 'Descreva o item.').max(300),
  unidade: z.string().trim().min(1, 'Informe a unidade.').max(20),
  grupo: texto(80),
  preco: z.union([z.number(), z.string()]).optional().nullable(),
  precoOrigem: z.enum(['nao_informado', 'informado']).optional(),
  unidadesCompra: z.array(esquemaUnidadeCompra).max(10).optional(),
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
  // Jornada de trabalho da obra (horas por dia), usada para dimensionar as equipes do planejamento.
  horasDia: z.number().min(1).max(24).optional(),
  // Empresa do grupo que executa a obra (define o regime de impostos). Nulo: a própria empresa logada.
  empresaGrupoId: z.string().uuid('Escolha uma empresa válida.').nullable().optional(),
  // Engenheiros de obra responsáveis: só eles (além de dono, gestor e orçamentista) enxergam a obra.
  responsaveis: z.array(z.string().uuid('Escolha um engenheiro válido.')).max(30).optional(),
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
    // Engenheiro de obra: só as obras atribuídas a ele; tabelas de referência só para consulta.
    app.addHook('preHandler', async (req) => {
      if (!ehEngenheiroDeObra(req.usuario)) return;
      const regra = regraEngenheiroEngenharia(req.method, req.url.split('?')[0].replace(/^\/api\/eng/, ''));
      if (regra.tipo === 'negado') throw semPermissao();
      if (regra.tipo === 'obra') {
        const ok = await banco.query(
          `SELECT 1 FROM obra_responsaveis r JOIN obras o ON o.id = r.obra_id
            WHERE r.usuario_id = $1 AND o.empresa_id = $2 AND r.obra_id::text = $3`,
          [req.usuario!.id, empresaDo(req), regra.obraId],
        );
        if (!ok.rowCount) throw naoEncontrado('Obra');
      }
    });

    /** Engenheiro de obra logado: limita listas às obras atribuídas a ele. Outros perfis: null (todas). */
    const engenheiroDe = (req: { usuario?: { id: string; perfil: string } }) => (ehEngenheiroDeObra(req.usuario) ? req.usuario!.id : null);

    /** Grava os engenheiros responsáveis pela obra (substitui a lista). Só usuários engenheiros de obra desta empresa. */
    async function gravarResponsaveis(c: Cliente, empresaId: string, obraId: string, ids: string[]) {
      const unicos = [...new Set(ids)];
      if (unicos.length) {
        const ok = await c.query(
          `SELECT count(*)::int AS n FROM usuarios WHERE id = ANY($1::uuid[]) AND empresa_id = $2 AND perfil = 'engenheiro_obra' AND excluido_em IS NULL`,
          [unicos, empresaId],
        );
        if (Number(ok.rows[0].n) !== unicos.length) throw new ErroHttp(400, 'Escolha só usuários com o perfil Engenheiro de obra desta empresa.');
      }
      await c.query('DELETE FROM obra_responsaveis WHERE obra_id = $1', [obraId]);
      for (const u of unicos) await c.query('INSERT INTO obra_responsaveis (obra_id, usuario_id) VALUES ($1, $2)', [obraId, u]);
    }

    /** Engenheiros de obra da empresa, para atribuir às obras. */
    app.get('/engenheiros', async (req) => {
      const r = await banco.query(
        `SELECT id, nome, email, ativo FROM usuarios WHERE empresa_id = $1 AND perfil = 'engenheiro_obra' AND excluido_em IS NULL ORDER BY ativo DESC, nome`,
        [empresaDo(req)],
      );
      return { engenheiros: r.rows.map((u) => ({ id: u.id as string, nome: u.nome as string, email: u.email as string, ativo: !!u.ativo })) };
    });

    async function tabelaDaEmpresa(c: Cliente, empresaId: string, id: string) {
      const t = (await c.query('SELECT * FROM ref_tabelas WHERE id = $1 AND empresa_id = $2', [id, empresaId])).rows[0];
      if (!t) throw naoEncontrado('Tabela de referência');
      return t;
    }
    /** Empresa do grupo escolhida para a obra: tem de ser desta empresa. Nulo: usa a empresa logada. */
    async function grupoDaEmpresa(c: Cliente, empresaId: string, id: string | null | undefined): Promise<string | null> {
      if (!id) return null;
      if (!(await c.query('SELECT 1 FROM empresas_grupo WHERE id = $1 AND empresa_id = $2 AND ativo', [id, empresaId])).rowCount)
        throw new ErroHttp(400, 'Escolha uma empresa do grupo cadastrada e ativa.');
      return id;
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
      const unidades = (await banco.query('SELECT unidade, fator FROM ref_insumo_unidades WHERE item_id = $1 ORDER BY unidade', [i.id])).rows;
      return {
        item: {
          id: i.id, tipo: i.tipo, codigo: i.codigo, descricao: i.descricao, unidade: i.unidade, grupo: i.grupo, preco: reais(i.preco),
          precoOrigem: i.preco_origem ?? null,
          unidadesCompra: unidades.map((u) => ({ unidade: u.unidade as string, fator: Number(u.fator) })),
        },
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
        let preco: number | null = null;
        let origem: string | null = null;
        if (d.tipo === 'insumo') {
          // Preço é opcional no cadastro: ou fica para depois ("não informado") ou é informado agora.
          const quer = d.precoOrigem ?? (d.preco !== undefined && d.preco !== null && d.preco !== '' ? 'informado' : 'nao_informado');
          if (quer === 'informado') {
            preco = precoCentavos(d.preco);
            if (preco === null) throw new ErroHttp(400, 'Informe um preço válido ou deixe o preço para depois.');
            origem = 'informado';
          } else origem = 'nao_informado';
        }
        const unidades = d.tipo === 'insumo' ? unidadesValidas(d.unidadesCompra ?? [], d.unidade) : [];
        // Insumo e serviço novos recebem o próximo código da sequência da tabela.
        const codigo = d.tipo === 'composicao' ? await proximoCodigoServico(c, t.id) : await proximoCodigoInsumo(c, t.id);
        const x = (
          await c.query(
            'INSERT INTO ref_itens (tabela_id, tipo, codigo, descricao, unidade, grupo, preco_centavos, preco_origem) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, codigo',
            [t.id, d.tipo, codigo, d.descricao, d.unidade, d.grupo, preco, origem],
          )
        ).rows[0];
        for (const u of unidades) await c.query('INSERT INTO ref_insumo_unidades (item_id, unidade, fator) VALUES ($1,$2,$3)', [x.id, u.unidade, u.fator]);
        if (d.tipo === 'composicao') await gravarComponentes(c, t.id, x.id, d.componentes ?? []);
        return { id: x.id as string, codigo: x.codigo as string };
      }).catch((e: Error & { code?: string }) => {
        if (e.code === '23505') throw new ErroHttp(409, 'Já existe um item com esse código nesta tabela.');
        throw e;
      });
      reply.code(201);
      return { ok: true, id: id.id, codigo: id.codigo };
    });

    app.put<{ Params: { id: string; itemId: string } }>('/tabelas/:id/itens/:itemId', async (req) => {
      const d = z
        .object({
          descricao: z.string().trim().min(2).max(300).optional(),
          unidade: z.string().trim().min(1).max(20).optional(),
          grupo: texto(80),
          preco: z.union([z.number(), z.string()]).optional().nullable(),
          precoOrigem: z.enum(['nao_informado', 'informado']).optional(),
          unidadesCompra: z.array(esquemaUnidadeCompra).max(10).optional(),
          componentes: z.array(z.object({ insumoCodigo: z.string().trim().min(1), coeficiente: z.number().min(0) })).optional(),
        })
        .parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const t = await tabelaDaEmpresa(c, empresaId, req.params.id);
        if (t.fonte !== 'proprio') throw new ErroHttp(409, 'A tabela SINAPI é imutável.');
        const item = (await c.query('SELECT * FROM ref_itens WHERE id = $1 AND tabela_id = $2', [req.params.itemId, t.id])).rows[0];
        if (!item) throw naoEncontrado('Item');
        let preco: number | null = item.preco_centavos;
        let origem: string | null = item.preco_origem;
        if (item.tipo === 'insumo') {
          if (d.precoOrigem === 'nao_informado') {
            preco = null;
            origem = 'nao_informado';
          } else if (d.preco !== undefined && d.preco !== null && d.preco !== '') {
            const p = precoCentavos(d.preco);
            if (p === null) throw new ErroHttp(400, 'Informe um preço válido.');
            preco = p;
            origem = 'informado';
          }
        }
        const unidadeBase = d.unidade ?? item.unidade;
        await c.query('UPDATE ref_itens SET descricao = $2, unidade = $3, grupo = $4, preco_centavos = $5, preco_origem = $6 WHERE id = $1', [item.id, d.descricao ?? item.descricao, unidadeBase, d.grupo ?? item.grupo, preco, origem]);
        if (item.tipo === 'insumo' && d.unidadesCompra !== undefined) {
          await c.query('DELETE FROM ref_insumo_unidades WHERE item_id = $1', [item.id]);
          for (const u of unidadesValidas(d.unidadesCompra, unidadeBase)) await c.query('INSERT INTO ref_insumo_unidades (item_id, unidade, fator) VALUES ($1,$2,$3)', [item.id, u.unidade, u.fator]);
        }
        if (item.tipo === 'composicao' && d.componentes !== undefined) {
          await c.query('DELETE FROM ref_composicao_insumos WHERE composicao_id = $1', [item.id]);
          await gravarComponentes(c, t.id, item.id, d.componentes);
        }
      });
      return { ok: true };
    });

    /** Preço do insumo do cadastro pela última compra confirmada das obras que usam esse insumo (na unidade base). */
    app.post<{ Params: { id: string; itemId: string } }>('/tabelas/:id/itens/:itemId/preco-ultima-compra', async (req) => {
      const empresaId = empresaDo(req);
      return emTransacao(banco, async (c) => {
        const t = await tabelaDaEmpresa(c, empresaId, req.params.id);
        if (t.fonte !== 'proprio') throw new ErroHttp(409, 'A tabela SINAPI é imutável.');
        const item = (await c.query("SELECT * FROM ref_itens WHERE id = $1 AND tabela_id = $2 AND tipo = 'insumo'", [req.params.itemId, t.id])).rows[0];
        if (!item) throw naoEncontrado('Insumo');
        const linhas = (
          await c.query(
            `SELECT ni.valor_custo_centavos, ni.quantidade, ni.unidade, n.data_emissao,
                    (SELECT u.fator FROM obra_insumo_unidades u WHERE u.obra_item_id = ob.id AND lower(u.unidade) = lower(ni.unidade)) AS fator_mapeado
               FROM notas_itens ni
               JOIN notas_fiscais n ON n.id = ni.nota_id
               JOIN obra_itens ob ON ob.id = coalesce(ni.obra_item_id, (SELECT pi.obra_item_id FROM pedidos_itens pi WHERE pi.id = ni.pedido_item_id))
              WHERE ob.origem_tabela_id = $1 AND ob.codigo = $2 AND ob.tipo = 'insumo'
                AND n.empresa_id = $3 AND n.excluido_em IS NULL AND n.status <> 'cancelada'
              ORDER BY n.data_emissao DESC, ni.id DESC`,
            [t.id, item.codigo, empresaId],
          )
        ).rows;
        const compra = escolherUltimaCompra(
          linhas.map((l) => ({
            valorCentavos: Number(l.valor_custo_centavos),
            quantidade: Number(l.quantidade),
            unidade: (l.unidade as string | null) ?? null,
            data: String(l.data_emissao).slice(0, 10),
            fatorMapeado: l.fator_mapeado === null || l.fator_mapeado === undefined ? null : Number(l.fator_mapeado),
          })),
          item.unidade as string,
        );
        if (!compra) throw new ErroHttp(409, 'Ainda não há compra confirmada deste insumo que possa ser convertida para a unidade do cadastro.');
        await c.query("UPDATE ref_itens SET preco_centavos = $2, preco_origem = 'ultima_compra' WHERE id = $1", [item.id, compra.precoBaseCentavos]);
        return { ok: true, preco: reais(compra.precoBaseCentavos), data: compra.data };
      });
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
          WHERE o.empresa_id = $1 AND o.ativo
            AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM obra_responsaveis r WHERE r.obra_id = o.id AND r.usuario_id = $2))
          ORDER BY o.codigo`,
        [empresaId, engenheiroDe(req)],
      );
      const obras = await Promise.all(
        r.rows.map(async (o) => ({ ...obraPublica(o), itens: o.itens, linhasOrcamento: o.linhas_orcamento, total: r2(reais(o.subtotal)! * (1 + (await bdiDaObra(banco, o)) / 100)) })),
      );
      return { obras };
    });

    /** Panorama da construtora: indicadores de todas as obras ativas (orçado, prazo, atividades, necessidades pendentes). */
    app.get('/panorama', async (req) => {
      const empresaId = empresaDo(req);
      const dIso = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);
      const hoje = new Date().toISOString().slice(0, 10);
      const obras = await banco.query(
        `SELECT o.id, o.codigo, o.nome, o.status, o.data_inicio, o.data_previsao, o.bdi_percentual, o.empresa_grupo_id, o.empresa_id,
                (SELECT count(*)::int FROM orcamento_itens oq WHERE oq.obra_id = o.id) AS linhas_orcamento,
                (SELECT coalesce(sum(oq.quantidade * ${precoObra('oi')}), 0) FROM orcamento_itens oq JOIN obra_itens oi ON oi.id = oq.obra_item_id WHERE oq.obra_id = o.id) AS subtotal,
                (SELECT count(*)::int FROM obra_necessidades nec WHERE nec.obra_id = o.id AND nec.status = 'pendente') AS necessidades_pendentes,
                (SELECT coalesce(sum(nec.quantidade * ${precoObra('oi')}), 0) FROM obra_necessidades nec JOIN obra_itens oi ON oi.id = nec.obra_item_id WHERE nec.obra_id = o.id AND nec.status = 'pendente') AS necessidades_valor
           FROM obras o WHERE o.empresa_id = $1 AND o.ativo
            AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM obra_responsaveis r WHERE r.obra_id = o.id AND r.usuario_id = $2))
          ORDER BY o.codigo`,
        [empresaId, engenheiroDe(req)],
      );
      const atividades = await banco.query(
        `SELECT a.id, a.obra_id, a.inicio, a.duracao_dias, a.predecessora_id
           FROM obra_atividades a JOIN obras o ON o.id = a.obra_id WHERE o.empresa_id = $1 AND o.ativo`,
        [empresaId],
      );
      const porObra = new Map<string, Record<string, any>[]>();
      for (const a of atividades.rows) porObra.set(a.obra_id, [...(porObra.get(a.obra_id) ?? []), a]);

      const lista = await Promise.all(obras.rows.map(async (o) => {
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
          orcado: r2(reais(o.subtotal)! * (1 + (await bdiDaObra(banco, o)) / 100)),
          linhasOrcamento: o.linhas_orcamento as number,
          atividades: ats.length,
          fimPlanejado,
          atrasada: !concluida && !!previsao && previsao < hoje,
          estourandoPrazo: !!previsao && !!fimPlanejado && fimPlanejado > previsao,
          necessidadesPendentes: o.necessidades_pendentes as number,
          necessidadesValor: r2(reais(o.necessidades_valor)!),
        };
      }));
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
        const grupoId = await grupoDaEmpresa(c, empresaId, d.empresaGrupoId);
        const o = (
          await c.query(
            `INSERT INTO obras (empresa_id, codigo, nome, endereco, cidade, uf, responsavel, status, data_inicio, data_previsao, nivel_apropriacao, bdi_percentual, bdi_modo, bdi_parametros, centro_custo_id, empresa_grupo_id, horas_dia)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17) RETURNING id`,
            [empresaId, codigo, d.nome, d.endereco, d.cidade, d.uf, d.responsavel, d.status, d.dataInicio, d.dataPrevisao, d.nivelApropriacao, d.bdiPercentual, d.bdiModo, JSON.stringify(d.bdiParametros), centro.id, grupoId, d.horasDia ?? 8],
          )
        ).rows[0];
        if (d.responsaveis?.length) await gravarResponsaveis(c, empresaId, o.id, d.responsaveis);
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
          grupoId: d.empresaGrupoId !== undefined ? await grupoDaEmpresa(c, empresaId, d.empresaGrupoId) : (atual.empresa_grupo_id ?? null),
          horasDia: d.horasDia !== undefined ? d.horasDia : Number(atual.horas_dia ?? 8),
        };
        await c.query(
          `UPDATE obras SET nome = $3, endereco = $4, cidade = $5, uf = $6, responsavel = $7, status = $8, data_inicio = $9, data_previsao = $10,
                  nivel_apropriacao = $11, bdi_percentual = $12, bdi_modo = $13, bdi_parametros = $14::jsonb, empresa_grupo_id = $15, horas_dia = $16, atualizado_em = now()
            WHERE id = $1 AND empresa_id = $2`,
          [atual.id, empresaId, campos.nome, campos.endereco, campos.cidade, campos.uf, campos.responsavel, campos.status, campos.dataInicio, campos.dataPrevisao, campos.nivel, campos.bdi.percentual, campos.bdi.modo, JSON.stringify(campos.bdi.parametros), campos.grupoId, campos.horasDia],
        );
        await c.query('UPDATE centros_custo SET nome = $2 WHERE id = $1', [atual.centro_custo_id, `Obra ${atual.codigo} - ${nome}`.slice(0, 120)]);
        if (d.responsaveis !== undefined) await gravarResponsaveis(c, empresaId, atual.id, d.responsaveis);
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
                (SELECT count(*)::int FROM orcamento_itens oq WHERE oq.obra_item_id = oi.id) AS no_orcamento,
                (SELECT coalesce(json_agg(json_build_object('unidade', u.unidade, 'fator', u.fator) ORDER BY u.unidade), '[]'::json) FROM obra_insumo_unidades u WHERE u.obra_item_id = oi.id) AS unidades_compra
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
          `SELECT ii.id, ii.tipo, ii.codigo, ii.descricao, ii.unidade, ii.grupo, ii.origem_tabela_id, ci.coeficiente, ${precoObra('ii')} AS custo
             FROM obra_composicao_insumos ci JOIN obra_itens ii ON ii.id = ci.insumo_id WHERE ci.composicao_id = $1 ORDER BY ii.tipo, ii.codigo`,
          [i.id],
        )
      ).rows;
      return {
        item: itemObraPublico(i),
        componentes: comp.map((k) => ({ id: k.id, tipo: k.tipo as string, classe: classeComponente(k.tipo, k.grupo), codigo: k.codigo, descricao: k.descricao, unidade: k.unidade, coeficiente: Number(k.coeficiente), precoUnitario: reais(k.custo), origemTabelaId: (k.origem_tabela_id as string | null) ?? null })),
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

        // A composição SINAPI não traz a classe do insumo (mão de obra, material, equipamento): ela está na tabela de insumos da mesma referência.
        const classeInsumo = new Map<string, string>();
        if (tabela.fonte === 'sinapi') {
          const classes = await c.query(
            `SELECT r.codigo, r.grupo FROM ref_itens r JOIN ref_tabelas t ON t.id = r.tabela_id
              WHERE t.empresa_id = $1 AND t.fonte = 'sinapi' AND t.id <> $2 AND t.uf IS NOT DISTINCT FROM $3
                AND t.mes_referencia IS NOT DISTINCT FROM $4 AND t.desonerado = $5 AND r.tipo = 'insumo' AND coalesce(r.grupo, '') <> ''`,
            [tabela.empresa_id, tabela.id, tabela.uf, tabela.mes_referencia, tabela.desonerado],
          );
          for (const k of classes.rows) classeInsumo.set(k.codigo as string, k.grupo as string);
        }

        const copia = async (linhas: Record<string, any>[], tipo: 'insumo' | 'composicao') => {
          let novos = 0;
          for (const x of linhas) {
            const grupo = (x.grupo || (tipo === 'insumo' ? classeInsumo.get(x.codigo) : null)) ?? null;
            const r = await c.query(
              `INSERT INTO obra_itens (obra_id, tipo, codigo, descricao, unidade, grupo, preco_centavos, origem_tabela_id, origem_fonte, origem_versao, preco_referencia_centavos)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (obra_id, tipo, codigo) DO NOTHING RETURNING id`,
              [obra.id, tipo, x.codigo, x.descricao, x.unidade, grupo, tipo === 'insumo' ? x.preco_centavos : null, tabela.id, tabela.fonte, versao, tipo === 'insumo' ? x.preco_centavos : null],
            );
            novos += r.rowCount ?? 0;
            if (tipo === 'insumo' && r.rowCount) await c.query('INSERT INTO obra_insumo_unidades (obra_item_id, unidade, fator) SELECT $1, unidade, fator FROM ref_insumo_unidades WHERE item_id = $2', [r.rows[0].id, x.id]);
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

    /**
     * Cria uma cópia editável de um serviço da obra ("copia") ou edita o próprio serviço ("edicao").
     * A composição é gravada na tabela própria escolhida pelo operador; tabelas SINAPI nunca são alteradas.
     * Preço informado para um insumo vale para a obra e para a tabela própria.
     */
    app.post<{ Params: { id: string } }>('/obras/:id/servicos/salvar', async (req) => {
      const d = z
        .object({
          modo: z.enum(['copia', 'edicao']),
          itemId: z.string().regex(UUID),
          tabelaId: z.string().regex(UUID, 'Escolha a tabela própria onde o serviço será salvo.'),
          codigo: z.string().trim().max(40).optional().default(''),
          descricao: z.string().trim().min(2, 'Dê um nome ao serviço.').max(300),
          unidade: z.string().trim().min(1, 'Informe a unidade.').max(20),
          componentes: z
            .array(z.object({ insumoId: z.string().regex(UUID), coeficiente: z.number().positive('O coeficiente precisa ser maior que zero.'), precoUnitario: z.union([z.number(), z.string()]).nullable().optional() }))
            .min(1, 'O serviço precisa de pelo menos um insumo.'),
        })
        .parse(req.body);
      const empresaId = empresaDo(req);
      const id = await emTransacao(banco, async (c) => {
        const obra = await obraDaEmpresa(c, empresaId, req.params.id);
        const tabela = await tabelaDaEmpresa(c, empresaId, d.tabelaId);
        if (tabela.fonte !== 'proprio') throw new ErroHttp(409, 'Copie ou edite serviços só numa tabela própria. As tabelas SINAPI não são alteradas.');
        const origem = (await c.query(`SELECT * FROM obra_itens WHERE id = $1 AND obra_id = $2 AND tipo = 'composicao'`, [d.itemId, obra.id])).rows[0];
        if (!origem) throw naoEncontrado('Serviço');

        // Serviço que entra na tabela própria recebe o próximo código dela, exceto quando já é um serviço dessa tabela.
        const jaNaTabela = origem.origem_tabela_id === tabela.id;
        const codigo = d.modo === 'edicao' && jaNaTabela ? (origem.codigo as string) : await proximoCodigoServico(c, tabela.id, obra.id);

        const ids = d.componentes.map((k) => k.insumoId);
        if (new Set(ids).size !== ids.length) throw new ErroHttp(400, 'Um insumo aparece mais de uma vez no serviço.');
        // Componentes: insumos da obra e serviços (composições) já salvos nesta mesma tabela própria.
        const itens = (await c.query(`SELECT * FROM obra_itens WHERE obra_id = $1 AND id = ANY($2::uuid[])`, [obra.id, ids])).rows;
        if (itens.length !== ids.length) throw new ErroHttp(400, 'Algum insumo ou serviço não está nesta obra.');
        for (const x of itens) {
          if (x.tipo !== 'composicao') continue;
          if (d.modo === 'edicao' && x.id === origem.id) throw new ErroHttp(400, 'Um serviço não pode entrar na própria composição.');
          if (x.origem_tabela_id !== tabela.id) throw new ErroHttp(400, `Salve o serviço ${x.codigo} ${x.descricao} nesta tabela própria antes de incluí-lo em outro serviço.`);
          // Ciclo: o serviço incluído não pode, direta ou indiretamente, usar o serviço que está sendo editado.
          if (d.modo === 'edicao' && (await c.query(
            `WITH RECURSIVE arvore AS (
               SELECT insumo_id FROM obra_composicao_insumos WHERE composicao_id = $1
               UNION SELECT ci.insumo_id FROM obra_composicao_insumos ci JOIN arvore a ON ci.composicao_id = a.insumo_id)
             SELECT 1 FROM arvore WHERE insumo_id = $2 LIMIT 1`, [x.id, origem.id])).rowCount)
            throw new ErroHttp(400, `O serviço ${x.codigo} já usa este serviço. Isso criaria um ciclo na composição.`);
        }
        const insumos = itens.filter((x) => x.tipo === 'insumo');
        const porId = new Map(itens.map((x) => [x.id as string, x]));

        // Preço novo de insumo: atualiza o insumo da obra; o mesmo preço vai para a tabela própria.
        const precoFinal = new Map<string, number | null>();
        for (const k of d.componentes) {
          const ins = porId.get(k.insumoId)!;
          if (ins.tipo !== 'insumo') { precoFinal.set(ins.id, null); continue; }
          const novo = k.precoUnitario === undefined || k.precoUnitario === null ? null : precoCentavos(k.precoUnitario);
          if (k.precoUnitario !== undefined && k.precoUnitario !== null && novo === null) throw new ErroHttp(400, `Preço inválido para ${ins.descricao}.`);
          if (novo !== null && novo !== Number(ins.preco_centavos)) {
            await c.query('UPDATE obra_itens SET preco_centavos = $2, editado = true WHERE id = $1', [ins.id, novo]);
            precoFinal.set(ins.id, novo);
          } else {
            precoFinal.set(ins.id, ins.preco_centavos === null ? null : Number(ins.preco_centavos));
          }
        }

        // Serviço na obra.
        let obraItemId: string;
        if (d.modo === 'copia') {
          const r = await c.query(
            `INSERT INTO obra_itens (obra_id, tipo, codigo, descricao, unidade, grupo, preco_centavos, origem_tabela_id, origem_fonte, origem_versao, editado)
             VALUES ($1,'composicao',$2,$3,$4,$5,NULL,$6,'proprio','Própria',true) RETURNING id`,
            [obra.id, codigo, d.descricao, d.unidade, origem.grupo ?? null, tabela.id],
          );
          obraItemId = r.rows[0].id as string;
        } else {
          await c.query(
            `UPDATE obra_itens SET codigo = $5, descricao = $2, unidade = $3, origem_tabela_id = $4, origem_fonte = 'proprio', origem_versao = 'Própria', editado = true WHERE id = $1`,
            [origem.id, d.descricao, d.unidade, tabela.id, codigo],
          );
          obraItemId = origem.id as string;
        }
        await c.query('DELETE FROM obra_composicao_insumos WHERE composicao_id = $1', [obraItemId]);
        for (const k of d.componentes) {
          await c.query('INSERT INTO obra_composicao_insumos (composicao_id, insumo_id, coeficiente) VALUES ($1,$2,$3)', [obraItemId, k.insumoId, k.coeficiente]);
        }

        // Gravação na tabela própria: o serviço e os insumos usados nele, com o preço da obra.
        const comp = (
          await c.query(
            `INSERT INTO ref_itens (tabela_id, tipo, codigo, descricao, unidade, grupo) VALUES ($1,'composicao',$2,$3,$4,$5)
             ON CONFLICT (tabela_id, tipo, codigo) DO UPDATE SET descricao = EXCLUDED.descricao, unidade = EXCLUDED.unidade
             RETURNING id`,
            [tabela.id, codigo, d.descricao, d.unidade, origem.grupo ?? null],
          )
        ).rows[0].id as string;
        const idRef = new Map<string, string>();
        for (const sv of itens.filter((x) => x.tipo === 'composicao')) {
          // O serviço incluído já está nesta tabela própria, com o mesmo código.
          const r = await c.query(`SELECT id FROM ref_itens WHERE tabela_id = $1 AND tipo = 'composicao' AND codigo = $2`, [tabela.id, sv.codigo]);
          if (!r.rowCount) throw new ErroHttp(400, `Salve o serviço ${sv.codigo} nesta tabela própria antes de incluí-lo em outro serviço.`);
          idRef.set(sv.id as string, r.rows[0].id as string);
        }
        for (const ins of insumos) {
          const r = await c.query(
            `INSERT INTO ref_itens (tabela_id, tipo, codigo, descricao, unidade, grupo, preco_centavos) VALUES ($1,'insumo',$2,$3,$4,$5,$6)
             ON CONFLICT (tabela_id, tipo, codigo) DO UPDATE SET descricao = EXCLUDED.descricao, unidade = EXCLUDED.unidade, preco_centavos = EXCLUDED.preco_centavos
             RETURNING id`,
            [tabela.id, ins.codigo, ins.descricao, ins.unidade, ins.grupo ?? null, precoFinal.get(ins.id) ?? null],
          );
          idRef.set(ins.id as string, r.rows[0].id as string);
        }
        await c.query('DELETE FROM ref_composicao_insumos WHERE composicao_id = $1', [comp]);
        for (const k of d.componentes) {
          await c.query('INSERT INTO ref_composicao_insumos (composicao_id, insumo_id, coeficiente) VALUES ($1,$2,$3)', [comp, idRef.get(k.insumoId), k.coeficiente]);
        }

        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: d.modo === 'copia' ? 'criar' : 'alterar', entidade: 'obra_itens', entidadeId: obraItemId, depois: { tabela: tabela.nome, codigo, descricao: d.descricao, insumos: d.componentes.length } });
        return { id: obraItemId, codigo };
      });
      return id;
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
      const nosObra = (await banco.query('SELECT id, pai_id FROM eap_nos WHERE obra_id = $1', [req.params.id])).rows.map((n) => ({ id: n.id as string, paiId: (n.pai_id ?? null) as string | null }));
      const datas = datasComResumos(
        calcularDatas(r.rows.map((a) => ({ id: a.id, inicio: dataIso(a.inicio), duracaoDias: Number(a.duracao_dias), predecessoraId: a.predecessora_id ?? null }))),
        r.rows.map((a) => ({ id: a.id as string, eapNoId: (a.eap_no_id ?? null) as string | null })),
        nosObra,
      );
      const resumos = resumosDaEap(nosObra);
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
            resumo: !!a.eap_no_id && resumos.has(a.eap_no_id),
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
        const linhas = (await c.query('SELECT id, pai_id, codigo, descricao FROM eap_nos WHERE obra_id = $1 ORDER BY string_to_array(codigo, \'.\')::int[]', [obra.id])).rows;
        const comAtividade = new Set((await c.query('SELECT eap_no_id FROM obra_atividades WHERE obra_id = $1 AND eap_no_id IS NOT NULL', [obra.id])).rows.map((r) => r.eap_no_id as string));
        // Todas as linhas da EAP (etapas, subetapas e tarefas). Etapas e subetapas viram resumo: as datas vêm das atividades abaixo.
        const folhas = linhas.filter((l) => !comAtividade.has(l.id as string)).map((l) => ({ id: l.id as string, descricao: l.descricao as string }));
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

    // ---------------------------------------------------------------- relatórios do planejamento (Gantt, equipes, compras)

    /** Atividades com as datas calculadas e os insumos do orçamento de cada linha da EAP (quantidade = orçamento × coeficiente). */
    async function atividadesComRecursos(c: Cliente, obraId: string) {
      const linhas = (await c.query(
        `SELECT a.id, a.descricao, a.inicio, a.duracao_dias, a.predecessora_id, a.eap_no_id, n.codigo AS eap_codigo
           FROM obra_atividades a LEFT JOIN eap_nos n ON n.id = a.eap_no_id
          WHERE a.obra_id = $1 ORDER BY a.ordem, a.criado_em`,
        [obraId],
      )).rows;
      const nosObra = (await c.query('SELECT id, pai_id FROM eap_nos WHERE obra_id = $1', [obraId])).rows.map((n) => ({ id: n.id as string, paiId: (n.pai_id ?? null) as string | null }));
      const datas = datasComResumos(
        calcularDatas(linhas.map((a) => ({ id: a.id as string, inicio: dataIso(a.inicio), duracaoDias: Number(a.duracao_dias), predecessoraId: (a.predecessora_id ?? null) as string | null }))),
        linhas.map((a) => ({ id: a.id as string, eapNoId: (a.eap_no_id ?? null) as string | null })),
        nosObra,
      );
      const insumos = (await c.query(
        `SELECT a.id AS atividade_id, i.codigo, i.descricao, i.unidade, i.grupo, sum(oq.quantidade * ci.coeficiente)::float AS quantidade
           FROM obra_atividades a
           JOIN orcamento_itens oq ON oq.eap_no_id = a.eap_no_id AND oq.obra_id = a.obra_id
           JOIN obra_composicao_insumos ci ON ci.composicao_id = oq.obra_item_id
           JOIN obra_itens i ON i.id = ci.insumo_id
          WHERE a.obra_id = $1 AND a.eap_no_id IS NOT NULL
          GROUP BY a.id, i.codigo, i.descricao, i.unidade, i.grupo`,
        [obraId],
      )).rows;
      const porAtividade = new Map<string, { codigo: string; descricao: string; unidade: string; grupo: string | null; quantidade: number }[]>();
      for (const i of insumos) {
        const lista = porAtividade.get(i.atividade_id as string) ?? [];
        lista.push({ codigo: i.codigo as string, descricao: i.descricao as string, unidade: i.unidade as string, grupo: (i.grupo ?? null) as string | null, quantidade: Number(i.quantidade) });
        porAtividade.set(i.atividade_id as string, lista);
      }
      return linhas.map((a) => {
        const d = datas.get(a.id as string)!;
        return {
          id: a.id as string,
          descricao: a.descricao as string,
          eapCodigo: (a.eap_codigo ?? null) as string | null,
          inicio: d.inicio,
          fim: d.fim,
          duracaoDias: Number(a.duracao_dias),
          predecessoraId: (a.predecessora_id ?? null) as string | null,
          insumos: porAtividade.get(a.id as string) ?? [],
        };
      });
    }

    const granularidadeDe = (v: string | undefined): Granularidade => ((GRANULARIDADES as string[]).includes(v ?? '') ? (v as Granularidade) : 'semana');

    app.get<{ Params: { id: string }; Querystring: { granularidade?: string } }>('/obras/:id/relatorios-planejamento/gantt', async (req) => {
      const empresaId = empresaDo(req);
      await obraDaEmpresa(banco, empresaId, req.params.id);
      const atividades = await atividadesComRecursos(banco, req.params.id);
      const g = montarGantt(
        atividades.map((a) => ({ id: a.id, descricao: a.descricao, eapCodigo: a.eapCodigo, inicio: a.inicio, fim: a.fim, duracaoDias: a.duracaoDias, predecessoraId: a.predecessoraId })),
        granularidadeDe(req.query.granularidade),
      );
      return { granularidade: granularidadeDe(req.query.granularidade), ...g, atividadesSemEap: atividades.filter((a) => !a.eapCodigo).length };
    });

    app.get<{ Params: { id: string }; Querystring: { granularidade?: string } }>('/obras/:id/relatorios-planejamento/equipes', async (req) => {
      const empresaId = empresaDo(req);
      const obra = await obraDaEmpresa(banco, empresaId, req.params.id);
      const horasDia = Number(obra.horas_dia ?? 8);
      const atividades = await atividadesComRecursos(banco, req.params.id);
      // Mão de obra horista (unidade h) entra no cálculo. Mensalista (unidade mês) não tem hora: fica de fora e é listada.
      const mensalistas = new Map<string, string>();
      const equipes = montarEquipes(
        atividades.map((a) => ({
          id: a.id,
          descricao: a.descricao,
          inicio: a.inicio,
          duracaoDias: a.duracaoDias,
          recursos: a.insumos
            .filter((i) => i.grupo === 'Mao_obra' && (i.unidade === 'h' || i.unidade === 'H'))
            .map((i) => ({ codigo: i.codigo, descricao: i.descricao, horas: i.quantidade })),
        })),
        horasDia,
        granularidadeDe(req.query.granularidade),
      );
      for (const a of atividades) for (const i of a.insumos) if (i.grupo === 'Mao_obra' && !/^h$/i.test(i.unidade)) mensalistas.set(i.codigo, i.descricao);
      return {
        granularidade: granularidadeDe(req.query.granularidade),
        horasDia,
        ...equipes,
        mensalistasNaoCalculados: [...mensalistas.values()],
        atividadesSemOrcamento: atividades.filter((a) => a.insumos.length === 0).length,
      };
    });

    app.get<{ Params: { id: string } }>('/obras/:id/relatorios-planejamento/compras', async (req) => {
      const empresaId = empresaDo(req);
      await obraDaEmpresa(banco, empresaId, req.params.id);
      const atividades = await atividadesComRecursos(banco, req.params.id);
      const itens = montarCompras(atividades.map((a) => ({ id: a.id, descricao: a.descricao, inicio: a.inicio, insumos: a.insumos })));
      return {
        // Cada item tem a data da primeira atividade que o usa (primeira): a entrega deve chegar até essa data.
        itens,
        // Insumos sem classe (não encontrados na tabela de insumos) entram na lista de compras; conferir antes de comprar.
        semClasse: itens.filter((i) => !i.grupo).length,
        atividadesSemOrcamento: atividades.filter((a) => a.insumos.length === 0).length,
      };
    });

    // ---------------------------------------------------------------- acompanhamento de obra (medições físicas e relatórios)

    /** Dados que os relatórios e a planilha usam: EAP, custo direto das folhas, planejamento, medições e despesas da obra. */
    async function dadosDoAcompanhamento(c: Cliente, obra: Record<string, any>) {
      const nos = (await c.query('SELECT id, pai_id, codigo, nivel, descricao FROM eap_nos WHERE obra_id = $1', [obra.id])).rows;
      const linhasOrc = (await c.query(
        `SELECT oq.eap_no_id, count(*)::int AS linhas, max(oi.unidade) AS unidade, sum(oq.quantidade)::float AS quantidade,
                sum(oq.quantidade * custo_obra_item(oq.obra_item_id))::float AS custo
           FROM orcamento_itens oq JOIN obra_itens oi ON oi.id = oq.obra_item_id
          WHERE oq.obra_id = $1 AND oq.eap_no_id IS NOT NULL GROUP BY oq.eap_no_id`,
        [obra.id],
      )).rows;
      const custos = new Map<string, number>();
      const orcado = new Map<string, { unidade: string | null; quantidade: number | null }>();
      for (const l of linhasOrc) {
        custos.set(l.eap_no_id as string, Number(l.custo));
        orcado.set(l.eap_no_id as string, Number(l.linhas) === 1 ? { unidade: l.unidade as string, quantidade: Number(l.quantidade) } : { unidade: null, quantidade: null });
      }
      const atividades = (await c.query('SELECT id, predecessora_id, eap_no_id, inicio, duracao_dias FROM obra_atividades WHERE obra_id = $1', [obra.id])).rows;
      const datas = datasComResumos(
        calcularDatas(atividades.map((a) => ({ id: a.id as string, inicio: dataIso(a.inicio), duracaoDias: Number(a.duracao_dias), predecessoraId: (a.predecessora_id ?? null) as string | null }))),
        atividades.map((a) => ({ id: a.id as string, eapNoId: (a.eap_no_id ?? null) as string | null })),
        nos.map((n) => ({ id: n.id as string, paiId: (n.pai_id ?? null) as string | null })),
      );
      const porNo = new Map<string, number>();
      for (const a of atividades) if (a.eap_no_id) porNo.set(a.eap_no_id as string, (porNo.get(a.eap_no_id as string) ?? 0) + 1);
      const planejado: AtividadePlan[] = atividades.filter((a) => a.eap_no_id).map((a) => {
        const d = datas.get(a.id as string)!;
        const no = a.eap_no_id as string;
        return { eapNoId: no, inicio: d.inicio, fim: d.fim, custo: (custos.get(no) ?? 0) / (porNo.get(no) ?? 1) };
      });
      const medicoes: Medicao[] = [];
      const itens = (await c.query(
        `SELECT m.id, m.data, i.eap_no_id, i.percentual::float AS percentual
           FROM obra_medicoes m JOIN obra_medicao_itens i ON i.medicao_id = m.id WHERE m.obra_id = $1`,
        [obra.id],
      )).rows;
      const mapaMedicoes = new Map<string, Medicao>();
      for (const i of itens) {
        const data = dataIso(i.data);
        const m = mapaMedicoes.get(i.id as string) ?? { data, itens: new Map<string, number>() };
        m.itens.set(i.eap_no_id as string, Number(i.percentual));
        mapaMedicoes.set(i.id as string, m);
      }
      medicoes.push(...mapaMedicoes.values());
      // Despesas confirmadas apropriadas ao centro de custo da obra, pela competência.
      const despesas = (await c.query(
        `SELECT l.competencia AS data, sum(a.valor_centavos)::float AS valor
           FROM apropriacoes a JOIN lancamentos l ON l.id = a.lancamento_id
          WHERE a.centro_custo_id = $1 AND l.status = 'confirmado' AND l.empresa_id = $2
          GROUP BY l.competencia ORDER BY l.competencia`,
        [obra.centro_custo_id, obra.empresa_id],
      )).rows.map((d) => ({ data: dataIso(d.data), valor: Number(d.valor) }));
      const nosEap: NoEap[] = nos.map((n) => ({ id: n.id as string, paiId: (n.pai_id ?? null) as string | null, codigo: n.codigo as string, nivel: n.nivel as string, descricao: n.descricao as string }));
      const custoTotal = [...custos.values()].reduce((s, v) => s + v, 0);
      return { nos, nosEap, custos, orcado, planejado, medicoes, despesas, custoTotal };
    }

    const hojeIso = () => new Date().toISOString().slice(0, 10);

    app.get<{ Params: { id: string } }>('/obras/:id/acompanhamento/planilha', async (req) => {
      const empresaId = empresaDo(req);
      const obra = await obraDaEmpresa(banco, empresaId, req.params.id);
      const d = await dadosDoAcompanhamento(banco, obra);
      const hoje = hojeIso();
      // % atual de cada nó: folhas pelo último valor informado; nós acima pela média ponderada pelo custo (relatorio de previsto x executado).
      const porNo = new Map(previstoXExecutado({ nos: d.nosEap, custos: d.custos, medicoes: d.medicoes, atividades: [], dataRef: hoje }).map((l) => [l.id, l]));
      const medicoes = (await banco.query(
        `SELECT m.id, m.data, m.descricao, count(i.eap_no_id)::int AS linhas
           FROM obra_medicoes m LEFT JOIN obra_medicao_itens i ON i.medicao_id = m.id
          WHERE m.obra_id = $1 GROUP BY m.id ORDER BY m.data`,
        [obra.id],
      )).rows;
      const linhas = d.nosEap
        .map((n) => {
          const folha = !d.nosEap.some((x) => x.paiId === n.id);
          const orc = d.orcado.get(n.id);
          const r = porNo.get(n.id);
          return {
            id: n.id, paiId: n.paiId, nivel: n.nivel, codigo: n.codigo, descricao: n.descricao, folha,
            unidade: orc?.unidade ?? null,
            quantidadeOrcada: orc?.quantidade ?? null,
            custoDireto: r ? r.custoPrevisto : 0,
            percentualAtual: r && r.custoPrevisto > 0 ? Math.round(r.percentualExecutado * 100) / 100 : null,
          };
        })
        .sort((a, b) => compararCodigo(a.codigo, b.codigo));
      return {
        hoje,
        ultimaData: medicoes.length ? dataIso(medicoes[medicoes.length - 1].data) : null,
        linhas,
        medicoes: medicoes.map((m) => ({ id: m.id, data: dataIso(m.data), descricao: m.descricao, linhas: m.linhas })),
      };
    });

    const esquemaMedicao = z.object({
      data: z.string().regex(DATA, 'Informe a data da medição.'),
      descricao: texto(200),
      itens: z.array(z.object({
        eapNoId: z.string().uuid(),
        percentual: z.number().min(0).max(100).optional().nullable(),
        quantidade: z.number().min(0).optional().nullable(),
      })).min(1, 'Preencha ao menos uma linha.'),
    });

    app.post<{ Params: { id: string } }>('/obras/:id/acompanhamento/medicoes', async (req, reply) => {
      const d = esquemaMedicao.parse(req.body);
      const empresaId = empresaDo(req);
      const id = await emTransacao(banco, async (c) => {
        const obra = await obraDaEmpresa(c, empresaId, req.params.id);
        const dados = await dadosDoAcompanhamento(c, obra);
        const linhas: { eapNoId: string; percentual: number; quantidade: number | null }[] = [];
        for (const it of d.itens) {
          if (!dados.nosEap.some((n) => n.id === it.eapNoId) || dados.nosEap.some((n) => n.paiId === it.eapNoId)) throw new ErroHttp(400, 'Escolha uma linha da EAP que não seja agrupadora (etapa ou subetapa com filhos).');
          const orc = dados.orcado.get(it.eapNoId);
          if (it.quantidade !== undefined && it.quantidade !== null) {
            if (!orc?.unidade || !orc.quantidade) throw new ErroHttp(400, 'Esta linha tem mais de um serviço ou nenhum: informe o percentual.');
            linhas.push({ eapNoId: it.eapNoId, percentual: percentualDeQuantidade(it.quantidade, orc.quantidade), quantidade: it.quantidade });
          } else if (it.percentual !== undefined && it.percentual !== null) {
            linhas.push({ eapNoId: it.eapNoId, percentual: it.percentual, quantidade: null });
          }
        }
        if (!linhas.length) throw new ErroHttp(400, 'Preencha o percentual ou a quantidade de ao menos uma linha.');
        // Uma medição por data: regravar a mesma data substitui a anterior.
        await c.query('DELETE FROM obra_medicoes WHERE obra_id = $1 AND data = $2', [obra.id, d.data]);
        const m = (await c.query(
          'INSERT INTO obra_medicoes (obra_id, data, descricao, criado_por) VALUES ($1,$2,$3,$4) RETURNING id',
          [obra.id, d.data, d.descricao ?? null, req.usuario!.id],
        )).rows[0];
        for (const l of linhas) {
          await c.query('INSERT INTO obra_medicao_itens (medicao_id, eap_no_id, percentual, quantidade) VALUES ($1,$2,$3,$4)', [m.id, l.eapNoId, l.percentual, l.quantidade]);
        }
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'obra_medicoes', entidadeId: m.id, depois: { data: d.data, linhas: linhas.length } });
        return m.id as string;
      });
      reply.code(201);
      return { id };
    });

    app.get<{ Params: { id: string; medId: string } }>('/obras/:id/acompanhamento/medicoes/:medId', async (req) => {
      const empresaId = empresaDo(req);
      await obraDaEmpresa(banco, empresaId, req.params.id);
      const m = (await banco.query('SELECT id, data, descricao FROM obra_medicoes WHERE id = $1 AND obra_id = $2', [req.params.medId, req.params.id])).rows[0];
      if (!m) throw naoEncontrado('Medição');
      const itens = (await banco.query('SELECT eap_no_id, percentual::float AS percentual, quantidade::float AS quantidade FROM obra_medicao_itens WHERE medicao_id = $1', [m.id])).rows;
      return { id: m.id, data: dataIso(m.data), descricao: m.descricao, itens: itens.map((i) => ({ eapNoId: i.eap_no_id, percentual: Number(i.percentual), quantidade: i.quantidade === null ? null : Number(i.quantidade) })) };
    });

    app.delete<{ Params: { id: string; medId: string } }>('/obras/:id/acompanhamento/medicoes/:medId', async (req) => {
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const obra = await obraDaEmpresa(c, empresaId, req.params.id);
        const n = (await c.query('DELETE FROM obra_medicoes WHERE id = $1 AND obra_id = $2', [req.params.medId, obra.id])).rowCount;
        if (!n) throw naoEncontrado('Medição');
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'excluir', entidade: 'obra_medicoes', entidadeId: req.params.medId, depois: null });
      });
      return { ok: true };
    });

    app.get<{ Params: { id: string } }>('/obras/:id/relatorios-gerenciais/curva-s', async (req) => {
      const empresaId = empresaDo(req);
      const obra = await obraDaEmpresa(banco, empresaId, req.params.id);
      const d = await dadosDoAcompanhamento(banco, obra);
      const hoje = hojeIso();
      if (!d.planejado.length) return { pontos: [], hoje, custoTotal: Math.round(d.custoTotal), vazio: 'Monte o planejamento (atividades ligadas à EAP) para ver a Curva S.' };
      const de = d.planejado.reduce((m, a) => (a.inicio < m ? a.inicio : m), d.planejado[0].inicio).slice(0, 8) + '01';
      const ate = d.planejado.reduce((m, a) => (a.fim > m ? a.fim : m), d.planejado[0].fim);
      const pontos = curvaS({ custos: d.custos, medicoes: d.medicoes, atividades: d.planejado, despesas: d.despesas, de, ate, hoje });
      const ultima = d.medicoes.reduce((m, x) => (x.data > m ? x.data : m), '');
      const executadoAtual = ultima ? valorExecutadoEm(d.custos, d.medicoes, ultima) : 0;
      const realizadoAtual = d.despesas.filter((x) => x.data <= (ultima || hoje)).reduce((s, x) => s + x.valor, 0);
      const previstoAtual = pontos.filter((p) => p.data <= (ultima || hoje)).slice(-1)[0]?.previsto ?? 0;
      return {
        pontos, hoje, custoTotal: Math.round(d.custoTotal), dataUltimaMedicao: ultima || null,
        indices: {
          cpi: realizadoAtual > 0 ? executadoAtual / realizadoAtual : null,
          spi: previstoAtual > 0 ? executadoAtual / previstoAtual : null,
        },
      };
    });

    app.get<{ Params: { id: string }; Querystring: { data?: string } }>('/obras/:id/relatorios-gerenciais/previsto-realizado', async (req) => {
      const empresaId = empresaDo(req);
      const obra = await obraDaEmpresa(banco, empresaId, req.params.id);
      const d = await dadosDoAcompanhamento(banco, obra);
      const hoje = hojeIso();
      const ultima = d.medicoes.reduce((m, x) => (x.data > m ? x.data : m), '');
      const dataRef = req.query.data && DATA.test(req.query.data) ? req.query.data : (ultima || hoje);
      const linhas = previstoXExecutado({ nos: d.nosEap, custos: d.custos, medicoes: d.medicoes, atividades: d.planejado, dataRef });
      const realizado = d.despesas.filter((x) => x.data <= dataRef).reduce((s, x) => s + x.valor, 0);
      const totalPrevisto = linhas.filter((l) => l.nivel === 'etapa').reduce((s, l) => s + l.custoPrevisto, 0) || Math.round(d.custoTotal);
      const totalExecutado = linhas.filter((l) => l.nivel === 'etapa').reduce((s, l) => s + l.executado, 0);
      const totalPrevistoAte = linhas.filter((l) => l.nivel === 'etapa').reduce((s, l) => s + l.previstoAte, 0);
      return {
        dataRef,
        linhas: linhas.sort((a, b) => compararCodigo(a.codigo, b.codigo)),
        totais: {
          custoPrevisto: totalPrevisto,
          previstoAte: totalPrevistoAte,
          executado: totalExecutado,
          realizado: Math.round(realizado),
          saldo: totalPrevisto - totalExecutado,
          cpi: realizado > 0 ? totalExecutado / realizado : null,
          spi: totalPrevistoAte > 0 ? totalExecutado / totalPrevistoAte : null,
        },
        observacao: 'O realizado é o total das despesas confirmadas apropriadas ao centro de custo da obra. Os lançamentos não são apropriados por etapa, então o realizado aparece só no total.',
      };
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
            // Unidade e quantidade de compra (quando o pedido foi feito em outra unidade); o preço segue a base do orçamento.
            unidadeCompra: x.unidade_compra ?? null, quantidadeCompra: x.quantidade_compra === null || x.quantidade_compra === undefined ? null : Number(x.quantidade_compra),
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
        if (['solicitada', 'comprada'].includes(atual.status)) throw new ErroHttp(409, 'Esta necessidade já está em solicitação de compra ou comprada. Para alterá-la, cancele a solicitação antes.');
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
        const atual = (await c.query('SELECT status FROM obra_necessidades WHERE id = $1 AND obra_id = $2', [req.params.necId, obra.id])).rows[0];
        if (atual && ['solicitada', 'comprada'].includes(atual.status)) throw new ErroHttp(409, 'Esta necessidade já está em solicitação de compra ou comprada. Não dá para excluí-la.');
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
      const bdiPct = await bdiDaObra(banco, obra);
      const bdi = r2((subtotal * bdiPct) / 100);
      return { nivelApropriacao: obra.nivel_apropriacao, bdiPercentual: bdiPct, subtotal, bdi, total: r2(subtotal + bdi), linhas };
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
      const bdi = await bdiDaObra(banco, obra);
      const fator = 1 + bdi / 100;
      // O BDI fica embutido no preço unitário de cada serviço e nos totais: a planilha mostra só o preço de venda.
      const precoUnit = (l: (typeof linhas)[number]) => (l.servico ? r2(l.servico.custoUnitario * fator) : 0);
      const rel = montarRelatorioOrcamento(linhas.map((l) => ({ ...l, servico: l.servico && { ...l.servico } })), bdi, false);
      const totais = totaisPlanilha(linhas.map((l) => ({ id: l.id, paiId: l.paiId, valor: l.servico ? r2(l.servico.quantidade * precoUnit(l)) : 0 })));
      return {
        precoTotal: rel.precoTotal,
        linhas: linhas.map((l) => ({
          ...l,
          servico: l.servico && { ...l.servico, precoUnitario: precoUnit(l) },
          precoTotal: totais.get(l.id) ?? 0,
        })),
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
    // ---------------------------------------------------------------- composição do preço (indiretos, acessórios, impostos, lucratividade)

    const pctCampo = z.number().min(0, 'O percentual não pode ser negativo.').max(99.99, 'Percentual alto demais.');
    const esquemaComposicao = z.object({
      administracao: pctCampo,
      imprevistos: pctCampo,
      cdi: pctCampo,
      lucro: pctCampo,
      indiretos: z.array(z.object({ descricao: z.string().trim().min(2, 'Descreva o custo indireto.').max(200), valor: z.number().min(0, 'O valor não pode ser negativo.') })),
      // Só os impostos digitados; o DAS é calculado pelo enquadramento da empresa.
      impostos: z.array(z.object({ descricao: z.string().trim().min(2, 'Descreva o imposto.').max(200), percentual: pctCampo })),
    });

    /**
     * Formação do preço da obra. Impostos: DAS pela faixa do Simples cadastrada na empresa + impostos digitados.
     * Custo financeiro = alíquota do CDI informada. BDI = preço de venda / custo direto - 1.
     */
    async function lerComposicao(c: Cliente, obra: Record<string, any>) {
      const linhas = await linhasPlanilha(c, obra.id);
      const direto = montarRelatorioOrcamento(linhas.map((l) => ({ ...l, servico: l.servico && { ...l.servico } })), 0, false).custoTotal;
      const p = (await c.query('SELECT * FROM obra_composicao_preco WHERE obra_id = $1', [obra.id])).rows[0];
      // Impostos pela empresa escolhida para a obra (grupo); sem escolha, pela empresa logada.
      const emp = obra.empresa_grupo_id
        ? (await c.query('SELECT regime_tributario, simples_anexo, simples_faixa FROM empresas_grupo WHERE id = $1', [obra.empresa_grupo_id])).rows[0]
        : (await c.query('SELECT regime_tributario, simples_anexo, simples_faixa FROM empresas WHERE id = $1', [obra.empresa_id])).rows[0];
      const simples = !emp || emp.regime_tributario === 'simples';
      const ind = (await c.query('SELECT id, descricao, valor_centavos FROM obra_custos_indiretos WHERE obra_id = $1 ORDER BY ordem, criado_em', [obra.id])).rows;
      const imp = (await c.query('SELECT id, descricao, percentual FROM obra_impostos WHERE obra_id = $1 ORDER BY ordem, criado_em', [obra.id])).rows;
      const percentuais = {
        administracao: Number(p?.administracao_pct ?? 0),
        imprevistos: Number(p?.imprevistos_pct ?? 0),
        cdi: Number(p?.cdi_pct ?? 0),
        lucro: Number(p?.lucro_pct ?? 0),
      };
      const aliquota = aliquotaSimples(emp?.simples_anexo, emp?.simples_faixa === null || emp?.simples_faixa === undefined ? null : Number(emp.simples_faixa));
      const das = {
        descricao: aliquota === null ? 'Simples Nacional (DAS): enquadre a empresa no cadastro' : `Simples Nacional (DAS), anexo ${emp.simples_anexo}, faixa ${emp.simples_faixa}`,
        percentual: aliquota ?? 0,
        automatico: true,
      };
      const digitados = (imp.length ? imp : [{ descricao: 'ISS (quando devido na nota)', percentual: 0 }]).map((x) => ({ descricao: x.descricao as string, percentual: Number(x.percentual), automatico: false }));
      // Fora do Simples não há DAS automático: valem só os impostos digitados.
      const impostos = simples ? [das, ...digitados] : digitados;
      const indiretos = ind.map((x) => ({ descricao: x.descricao as string, valor: reais(x.valor_centavos)! }));
      const formacao = formacaoPreco(direto, indiretos.reduce((s, x) => s + x.valor, 0), { administracao: percentuais.administracao, imprevistos: percentuais.imprevistos, financeiro: percentuais.cdi, lucro: percentuais.lucro }, impostos.map((x) => x.percentual));
      return { direto: r2(direto), percentuais, indiretos, impostos, formacao };
    }

    /** BDI que vale para a obra: o da composição quando ela existe; senão, o cadastrado. */
    async function bdiDaObra(c: Cliente, obra: Record<string, any>): Promise<number> {
      if (!(await c.query('SELECT 1 FROM obra_composicao_preco WHERE obra_id = $1', [obra.id])).rowCount) return Number(obra.bdi_percentual);
      return (await lerComposicao(c, obra)).formacao.bdi;
    }

    app.get<{ Params: { id: string } }>('/obras/:id/composicao', async (req) => {
      const obra = await obraDaEmpresa(banco, empresaDo(req), req.params.id);
      return lerComposicao(banco, obra);
    });

    /** Substitui a composição da obra e guarda o BDI resultante no cadastro. */
    app.put<{ Params: { id: string } }>('/obras/:id/composicao', async (req) => {
      const d = esquemaComposicao.parse(req.body);
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const obra = await obraDaEmpresa(c, empresaId, req.params.id);
        await c.query(
          `INSERT INTO obra_composicao_preco (obra_id, administracao_pct, imprevistos_pct, cdi_pct, lucro_pct) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (obra_id) DO UPDATE SET administracao_pct = EXCLUDED.administracao_pct, imprevistos_pct = EXCLUDED.imprevistos_pct,
             cdi_pct = EXCLUDED.cdi_pct, lucro_pct = EXCLUDED.lucro_pct, atualizado_em = now()`,
          [obra.id, d.administracao, d.imprevistos, d.cdi, d.lucro],
        );
        await c.query('DELETE FROM obra_custos_indiretos WHERE obra_id = $1', [obra.id]);
        for (const [n, x] of d.indiretos.entries()) {
          await c.query('INSERT INTO obra_custos_indiretos (obra_id, descricao, valor_centavos, ordem) VALUES ($1,$2,$3,$4)', [obra.id, x.descricao, cent(x.valor), n]);
        }
        await c.query('DELETE FROM obra_impostos WHERE obra_id = $1', [obra.id]);
        for (const [n, x] of d.impostos.entries()) {
          await c.query('INSERT INTO obra_impostos (obra_id, descricao, percentual, ordem) VALUES ($1,$2,$3,$4)', [obra.id, x.descricao, x.percentual, n]);
        }
        const atual = await lerComposicao(c, obra);
        await c.query('UPDATE obras SET bdi_percentual = $2 WHERE id = $1', [obra.id, atual.formacao.bdi]);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'obras', entidadeId: obra.id, depois: { composicaoPreco: true, bdi: atual.formacao.bdi } });
      });
      const obra = await obraDaEmpresa(banco, empresaId, req.params.id);
      return lerComposicao(banco, obra);
    });

    app.get<{ Params: { id: string }; Querystring: { tipo?: string } }>('/obras/:id/relatorio-abc', async (req) => {
      const obra = await obraDaEmpresa(banco, empresaDo(req), req.params.id);
      const insumos = req.query.tipo === 'insumos';
      const linhas = await linhasPlanilha(banco, obra.id);
      const bdiPct = await bdiDaObra(banco, obra);
      const itens = insumos ? abcInsumos(linhas, await composicoesDaPlanilha(linhas)) : abcServicos(linhas, bdiPct);
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
      const bdiPct = await bdiDaObra(banco, obra);
      const rel = montarRelatorioOrcamento(linhas, bdiPct, analitico, composicoes);
      return {
        tipo: analitico ? 'analitico' : 'sintetico',
        obra: { id: obra.id, codigo: obra.codigo, nome: obra.nome, endereco: obra.endereco, cidade: obra.cidade, uf: obra.uf, responsavel: obra.responsavel, bdiPercentual: Number(obra.bdi_percentual) },
        ...rel,
      };
    });

    // ---------------------------------------------------------------- versões do orçamento
    /** Retrato atual da obra: planilha, serviços e insumos com os preços de agora, e o BDI. */
    async function retratoDaObra(c: Cliente, obra: Record<string, any>) {
      const linhas = await linhasPlanilha(c, obra.id);
      const ids = [...new Set(linhas.flatMap((l) => (l.servico ? [l.servico.itemId] : [])))];
      const composicoes = new Map<string, InsumoComposicaoRel[]>();
      if (ids.length) {
        const r = await c.query(
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
      }
      const bdi = await bdiDaObra(c, obra);
      return criarSnapshot(
        { codigo: obra.codigo, nome: obra.nome, endereco: obra.endereco, cidade: obra.cidade, uf: obra.uf, responsavel: obra.responsavel },
        bdi,
        linhas,
        composicoes,
      );
    }

    /** Snapshot de uma versão salva ("atual" = orçamento de agora, sem salvar). */
    async function snapshotDeReferencia(c: Cliente, obra: Record<string, any>, ref: string): Promise<{ snap: SnapshotVersao; rotulo: string }> {
      if (ref === 'atual') return { snap: await retratoDaObra(c, obra), rotulo: 'Orçamento atual' };
      if (!UUID.test(ref)) throw new ErroHttp(400, 'Versão inválida.');
      const v = (await c.query('SELECT numero, nome, snapshot FROM orcamento_versoes WHERE id = $1 AND obra_id = $2', [ref, obra.id])).rows[0];
      if (!v) throw naoEncontrado('Versão');
      return { snap: v.snapshot as SnapshotVersao, rotulo: `V${v.numero} · ${v.nome}` };
    }

    app.get<{ Params: { id: string } }>('/obras/:id/versoes', async (req) => {
      const obra = await obraDaEmpresa(banco, empresaDo(req), req.params.id);
      const r = await banco.query(
        'SELECT id, numero, nome, observacao, criado_por_nome, criado_em, snapshot FROM orcamento_versoes WHERE obra_id = $1 ORDER BY numero DESC',
        [obra.id],
      );
      return {
        versoes: r.rows.map((v) => {
          const rel = relatorioDaVersao(v.snapshot as SnapshotVersao);
          return { id: v.id, numero: v.numero, nome: v.nome, observacao: v.observacao, criadoPor: v.criado_por_nome, criadoEm: v.criado_em, precoTotal: rel.precoTotal, bdiPercentual: Number((v.snapshot as SnapshotVersao).bdiPercentual) };
        }),
      };
    });

    const esquemaVersao = z.object({
      nome: z.string().trim().min(2, 'Dê um nome à versão.').max(120, 'Nome longo demais.'),
      observacao: z.string().trim().max(500, 'Observação longa demais.').optional().default(''),
    });

    app.post<{ Params: { id: string } }>('/obras/:id/versoes', async (req, reply) => {
      const d = esquemaVersao.parse(req.body);
      const empresaId = empresaDo(req);
      const usuario = req.usuario!;
      const salva = await emTransacao(banco, async (c) => {
        const obra = await obraDaEmpresa(c, empresaId, req.params.id);
        // Trava a obra para dois salvamentos simultâneos não pegarem o mesmo número.
        await c.query('SELECT id FROM obras WHERE id = $1 FOR UPDATE', [obra.id]);
        const snap = await retratoDaObra(c, obra);
        const numero = Number((await c.query('SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM orcamento_versoes WHERE obra_id = $1', [obra.id])).rows[0].n);
        const v = (
          await c.query(
            `INSERT INTO orcamento_versoes (obra_id, empresa_id, numero, nome, observacao, snapshot, criado_por_id, criado_por_nome)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, numero, nome, criado_em`,
            [obra.id, empresaId, numero, d.nome, d.observacao || null, JSON.stringify(snap), usuario.id, usuario.nome],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: usuario.id, acao: 'criar', entidade: 'orcamento_versoes', entidadeId: v.id, depois: { numero, nome: d.nome } });
        return { id: v.id, numero: v.numero, nome: v.nome, criadoEm: v.criado_em, precoTotal: relatorioDaVersao(snap).precoTotal };
      });
      reply.code(201);
      return { versao: salva };
    });

    app.delete<{ Params: { id: string; versaoId: string } }>('/obras/:id/versoes/:versaoId', async (req) => {
      const empresaId = empresaDo(req);
      await emTransacao(banco, async (c) => {
        const obra = await obraDaEmpresa(c, empresaId, req.params.id);
        const r = (await c.query('DELETE FROM orcamento_versoes WHERE id = $1 AND obra_id = $2 RETURNING id, numero, nome', [req.params.versaoId, obra.id])).rows[0];
        if (!r) throw naoEncontrado('Versão');
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'excluir', entidade: 'orcamento_versoes', entidadeId: r.id, antes: { numero: r.numero, nome: r.nome } });
      });
      return { ok: true };
    });

    app.get<{ Params: { id: string }; Querystring: { a?: string; b?: string } }>('/obras/:id/comparacao', async (req) => {
      const obra = await obraDaEmpresa(banco, empresaDo(req), req.params.id);
      const a = req.query.a ?? '';
      const b = req.query.b ?? '';
      if (!a || !b) throw new ErroHttp(400, 'Escolha as duas versões a comparar.');
      if (a === b) throw new ErroHttp(400, 'Escolha duas versões diferentes.');
      const [ra, rb] = await Promise.all([snapshotDeReferencia(banco, obra, a), snapshotDeReferencia(banco, obra, b)]);
      return { rotuloA: ra.rotulo, rotuloB: rb.rotulo, obra: { codigo: obra.codigo, nome: obra.nome }, ...compararVersoes(ra.snap, rb.snap) };
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
  const r = (
    await c.query(
      `SELECT o.*, cc.nome AS centro_nome, eg.razao_social AS empresa_grupo_nome,
              (SELECT coalesce(json_agg(json_build_object('id', u.id, 'nome', u.nome) ORDER BY u.nome), '[]'::json)
                 FROM obra_responsaveis r JOIN usuarios u ON u.id = r.usuario_id WHERE r.obra_id = o.id) AS responsaveis
         FROM obras o JOIN centros_custo cc ON cc.id = o.centro_custo_id LEFT JOIN empresas_grupo eg ON eg.id = o.empresa_grupo_id
        WHERE o.id = $1 AND o.empresa_id = $2`,
      [id, empresaId],
    )
  ).rows[0];
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
    empresaGrupoId: (o.empresa_grupo_id as string | null | undefined) ?? null,
    empresaGrupoNome: (o.empresa_grupo_nome as string | null | undefined) ?? null,
    bdiPercentual: Number(o.bdi_percentual),
    horasDia: Number(o.horas_dia ?? 8),
    bdiModo: (o.bdi_modo as 'calculado' | 'informado' | undefined) ?? 'informado',
    bdiParametros: (o.bdi_parametros as Partial<ParametrosBdi> | null) ?? null,
    centroCustoId: o.centro_custo_id as string,
    centroCustoNome: (o.centro_nome as string | null) ?? null,
    responsaveis: (o.responsaveis as { id: string; nome: string }[] | undefined) ?? [],
  };
}

function itemObraPublico(i: Record<string, any>) {
  return {
    id: i.id as string,
    tipo: i.tipo as 'insumo' | 'composicao',
    codigo: i.codigo as string,
    descricao: i.descricao as string,
    unidade: i.unidade as string,
    unidadesCompra: ((i.unidades_compra as { unidade: string; fator: number | string }[] | undefined) ?? []).map((u) => ({ unidade: u.unidade, fator: Number(u.fator) })),
    grupo: (i.grupo as string | null) ?? null,
    preco: reais(i.preco),
    precoReferencia: reais(i.preco_referencia_centavos),
    editado: !!i.editado,
    origem: i.origem_fonte ? `${i.origem_versao ?? i.origem_fonte}` : null,
    componentes: Number(i.componentes ?? 0),
    origemTabelaId: (i.origem_tabela_id as string | null) ?? null,
    noOrcamento: Number(i.no_orcamento ?? 0) > 0,
  };
}
