// Módulo Laudos: laudos técnicos (GLP, avaliações, patologias). Os dados do proprietário e do endereço da obra
// podem ser lidos do PDF de um laudo anterior pela IA; o engenheiro confere antes de salvar.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { emTransacao, type Banco, type Cliente } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';
import { ErroIa, iaDisponivel } from '../lib/ia-nota.ts';
import { blocoDocumento, chamarIaComFerramenta } from '../lib/ia-documento.ts';
import { empresaDo, exigir } from '../sessao.ts';
import { LIMITE_IA } from '../lib/limites.ts';

const TIPOS = ['glp', 'avaliacao', 'patologia'] as const;
type Tipo = (typeof TIPOS)[number];
const ROTULO_TIPO: Record<Tipo, string> = { glp: 'Laudo de GLP', avaliacao: 'Laudo de avaliação', patologia: 'Laudo de patologia' };

/** Anexos do laudo: ART (PDF ou foto), fotos da obra e outros documentos. Ficam no banco, como os anexos das notas. */
const CATEGORIAS_ANEXO = ['art', 'foto', 'outro'] as const;
const TIPOS_ANEXO = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_ANEXO = 10 * 1024 * 1024;
const LIMITE_ANEXOS_LAUDO = 40;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Confere que o conteúdo é mesmo do tipo declarado (PDF ou imagem) antes de guardar e servir o arquivo. */
function conteudoDoTipo(bytes: Buffer, tipo: string): boolean {
  if (tipo === 'application/pdf') return bytes.subarray(0, 5).toString('latin1') === '%PDF-';
  if (tipo === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (tipo === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (tipo === 'image/webp') return bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP';
  return false;
}

/** Confere que o laudo existe e pertence à empresa. Id fora do formato de UUID também é "não encontrado". */
async function laudoDaEmpresa(c: Cliente, empresaId: string, laudoId: string): Promise<void> {
  if (!UUID.test(laudoId)) throw naoEncontrado('Laudo');
  const r = await c.query('SELECT 1 FROM laudos WHERE id = $1 AND empresa_id = $2', [laudoId, empresaId]);
  if (!r.rowCount) throw naoEncontrado('Laudo');
}

/** Campos do laudo de GLP (rede e central de gás), extraídos do modelo Neves Engenharia (Pex e galvanizado). */
const esquemaDadosGlp = z.object({
  proprietarioNome: z.string().trim().max(200).default(''),
  proprietarioDocumento: z.string().trim().max(30).default(''),
  enderecoObra: z.string().trim().max(300).default(''),
  cep: z.string().trim().max(12).default(''),
  cidade: z.string().trim().max(120).default(''),
  uf: z.string().trim().max(2).default(''),
  instalacao: z.enum(['pex', 'galvanizado']).default('pex'),
  projetoAprovadoCbm: z.boolean().default(true),
  tubulacaoEnvelopada: z.boolean().default(false),
  locaisAplicacao: z.string().trim().max(300).default('Rede primária e secundária'),
  bitola: z.string().trim().max(120).default(''),
  pressaoEnsaioPsi: z.number().min(0).max(1000).default(110),
  tempoEnsaioHoras: z.number().min(0).max(240).default(3),
  tempoNormativoHoras: z.number().min(0).max(240).default(2),
  pressaoTrabalhoKgf: z.number().min(0).max(100).default(0.5),
  manometroKgf: z.number().min(0).max(1000).default(20),
  centralGlp: z.string().trim().max(300).default(''),
  pontosConsumo: z.number().int().min(0).max(100000).default(0),
  art: z.string().trim().max(60).default(''),
  dataLaudo: z.string().trim().max(10).default(''),
  responsavelNome: z.string().trim().max(200).default(''),
  responsavelRegistro: z.string().trim().max(120).default(''),
  notasGerais: z.string().trim().max(8000).default(''),
  especificacoes: z.string().trim().max(8000).default(''),
  conclusao: z.string().trim().max(4000).default(''),
  notaPontos: z.string().trim().max(300).default(''),
  observacoes: z.string().trim().max(4000).default(''),
});
type DadosGlp = z.infer<typeof esquemaDadosGlp>;

/** Campos do laudo de patologia (vistoria técnica), a partir do modelo do Condomínio Saint George. */
const esquemaDadosPatologia = z.object({
  proprietarioNome: z.string().trim().max(200).default(''),
  proprietarioDocumento: z.string().trim().max(30).default(''),
  localObra: z.string().trim().max(200).default(''),
  endereco: z.string().trim().max(300).default(''),
  cep: z.string().trim().max(12).default(''),
  cidade: z.string().trim().max(120).default(''),
  uf: z.string().trim().max(2).default(''),
  dataVistoria: z.string().trim().max(10).default(''),
  problemaTexto: z.string().trim().max(8000).default(''),
  objetoTexto: z.string().trim().max(8000).default(''),
  vistoriaTexto: z.string().trim().max(8000).default(''),
  hipoteseTexto: z.string().trim().max(8000).default(''),
  consideracoesTexto: z.string().trim().max(12000).default(''),
  conclusaoTexto: z.string().trim().max(8000).default(''),
  acompanhamentoData: z.string().trim().max(10).default(''),
  acompanhamentoTexto: z.string().trim().max(8000).default(''),
  art: z.string().trim().max(60).default(''),
  dataLaudo: z.string().trim().max(10).default(''),
  responsavelNome: z.string().trim().max(200).default(''),
  responsavelRegistro: z.string().trim().max(120).default(''),
  observacoes: z.string().trim().max(4000).default(''),
});

/** Campos do laudo de avaliação (relatório técnico de avaliação), a partir do modelo da chácara em São Sebastião/DF. */
const esquemaDadosAvaliacao = z.object({
  solicitante: z.string().trim().max(200).default(''),
  endereco: z.string().trim().max(300).default(''),
  matricula: z.string().trim().max(200).default(''),
  tipoImovel: z.string().trim().max(120).default(''),
  descricaoImovel: z.string().trim().max(300).default(''),
  areaTerreno: z.string().trim().max(120).default(''),
  areaConstruida: z.string().trim().max(120).default(''),
  estadoConservacao: z.string().trim().max(60).default(''),
  idadeAparente: z.string().trim().max(60).default(''),
  zoneamento: z.string().trim().max(200).default(''),
  valorMercado: z.number().min(0).max(1e13).default(0),
  valorMercadoExtenso: z.string().trim().max(400).default(''),
  dataBase: z.string().trim().max(10).default(''),
  resumoTexto: z.string().trim().max(12000).default(''),
  art: z.string().trim().max(60).default(''),
  dataLaudo: z.string().trim().max(10).default(''),
  responsavelNome: z.string().trim().max(200).default(''),
  responsavelRegistro: z.string().trim().max(120).default(''),
  observacoes: z.string().trim().max(4000).default(''),
});

const ESQUEMA_POR_TIPO = { glp: esquemaDadosGlp, patologia: esquemaDadosPatologia, avaliacao: esquemaDadosAvaliacao } as const;

const esquemaSalvar = z.object({
  titulo: z.string().trim().max(200).default(''),
  dados: z.record(z.string(), z.unknown()).default({}),
});

/** Valores padrão do laudo de GLP (texto e normas do modelo). */
const dadosGlpPadrao = (): DadosGlp => esquemaDadosGlp.parse({});

/** Lê, pela IA, os dados de identificação e os valores de ensaio de um laudo de GLP enviado em PDF. */
const FERRAMENTA_LEITURA = {
  name: 'registrar_laudo',
  description: 'Registra os dados de identificação e os valores do laudo técnico de GLP lido. Use null para o que não estiver no documento.',
  input_schema: {
    type: 'object',
    properties: {
      proprietario_nome: { type: ['string', 'null'], description: 'Nome do proprietário (ex.: razão social em "Proprietário:").' },
      proprietario_documento: { type: ['string', 'null'], description: 'CNPJ ou CPF do proprietário, como impresso.' },
      endereco_obra: { type: ['string', 'null'], description: 'Endereço da obra, como impresso em "Endereço:".' },
      cep: { type: ['string', 'null'] },
      cidade: { type: ['string', 'null'] },
      uf: { type: ['string', 'null'], description: 'Sigla da UF, 2 letras.' },
      instalacao: { type: ['string', 'null'], enum: ['pex', 'galvanizado', null], description: 'Material da tubulação da rede.' },
      locais_aplicacao: { type: ['string', 'null'] },
      bitola: { type: ['string', 'null'], description: 'Bitola(s) utilizada(s), como impressa.' },
      pressao_ensaio_psi: { type: ['number', 'null'] },
      tempo_ensaio_horas: { type: ['number', 'null'] },
      tempo_normativo_horas: { type: ['number', 'null'] },
      pressao_trabalho_kgf: { type: ['number', 'null'] },
      manometro_kgf: { type: ['number', 'null'] },
      central_glp: { type: ['string', 'null'], description: 'Descrição da central de GLP, como impressa.' },
      pontos_consumo: { type: ['integer', 'null'] },
      art: { type: ['string', 'null'], description: 'Número da ART vinculada.' },
      data_laudo: { type: ['string', 'null'], description: 'AAAA-MM-DD' },
      responsavel_nome: { type: ['string', 'null'] },
      responsavel_registro: { type: ['string', 'null'], description: 'Registro no conselho (CREA/CAU), como impresso.' },
    },
    required: [],
  },
};

const numeroOu = (v: unknown, padrao: number) => (typeof v === 'number' && Number.isFinite(v) ? v : padrao);
const textoOu = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function mapaLeitura(r: Record<string, unknown>): Partial<DadosGlp> {
  const base = dadosGlpPadrao();
  const instalacao = r.instalacao === 'galvanizado' || r.instalacao === 'pex' ? r.instalacao : base.instalacao;
  return {
    proprietarioNome: textoOu(r.proprietario_nome),
    proprietarioDocumento: textoOu(r.proprietario_documento),
    enderecoObra: textoOu(r.endereco_obra),
    cep: textoOu(r.cep),
    cidade: textoOu(r.cidade),
    uf: textoOu(r.uf).toUpperCase().slice(0, 2),
    instalacao,
    locaisAplicacao: textoOu(r.locais_aplicacao) || base.locaisAplicacao,
    bitola: textoOu(r.bitola),
    pressaoEnsaioPsi: numeroOu(r.pressao_ensaio_psi, base.pressaoEnsaioPsi),
    tempoEnsaioHoras: numeroOu(r.tempo_ensaio_horas, base.tempoEnsaioHoras),
    tempoNormativoHoras: numeroOu(r.tempo_normativo_horas, base.tempoNormativoHoras),
    pressaoTrabalhoKgf: numeroOu(r.pressao_trabalho_kgf, base.pressaoTrabalhoKgf),
    manometroKgf: numeroOu(r.manometro_kgf, base.manometroKgf),
    centralGlp: textoOu(r.central_glp),
    pontosConsumo: Math.round(numeroOu(r.pontos_consumo, 0)),
    art: textoOu(r.art),
    dataLaudo: /^\d{4}-\d{2}-\d{2}$/.test(textoOu(r.data_laudo)) ? textoOu(r.data_laudo) : '',
    responsavelNome: textoOu(r.responsavel_nome),
    responsavelRegistro: textoOu(r.responsavel_registro),
  };
}

const FERRAMENTA_IDENTIFICACAO = {
  name: 'registrar_identificacao',
  description: 'Registra os dados de identificação do laudo técnico lido (proprietário ou solicitante, endereço da obra ou do imóvel). Use null para o que não estiver no documento.',
  input_schema: {
    type: 'object',
    properties: {
      proprietario_nome: { type: ['string', 'null'], description: 'Proprietário, contratante ou solicitante, como impresso.' },
      proprietario_documento: { type: ['string', 'null'], description: 'CPF ou CNPJ, como impresso.' },
      local_obra: { type: ['string', 'null'], description: 'Nome do condomínio ou da obra, em "LOCAL/OBRA" ou similar.' },
      endereco: { type: ['string', 'null'] },
      cep: { type: ['string', 'null'] },
      cidade: { type: ['string', 'null'] },
      uf: { type: ['string', 'null'], description: 'Sigla da UF, 2 letras.' },
      matricula: { type: ['string', 'null'], description: 'Matrícula do imóvel e cartório, como impressos.' },
      zoneamento: { type: ['string', 'null'] },
      area_terreno: { type: ['string', 'null'] },
      area_construida: { type: ['string', 'null'] },
      data: { type: ['string', 'null'], description: 'Data do laudo ou da vistoria, AAAA-MM-DD.' },
      responsavel_nome: { type: ['string', 'null'] },
      responsavel_registro: { type: ['string', 'null'] },
      art: { type: ['string', 'null'] },
    },
    required: [],
  },
};

export function rotasLaudos(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.addHook('preHandler', exigir(banco, 'dono', 'gestor'));

    app.get<{ Querystring: { tipo?: string } }>('/laudos', async (req) => {
      const empresaId = empresaDo(req);
      const tipo = TIPOS.find((t) => t === req.query.tipo);
      const r = await banco.query(
        `SELECT id, tipo, numero, titulo, dados, atualizado_em FROM laudos
          WHERE empresa_id = $1 AND ($2::text IS NULL OR tipo = $2) ORDER BY atualizado_em DESC`,
        [empresaId, tipo ?? null],
      );
      return r.rows.map((x) => ({
        id: x.id,
        tipo: x.tipo,
        numero: x.numero,
        titulo: x.titulo,
        atualizadoEm: x.atualizado_em,
        proprietario: (x.dados as Record<string, unknown>)?.proprietarioNome ?? '',
      }));
    });

    const corpoPostLaudos = z.object({ tipo: z.enum(TIPOS) });
    app.post('/laudos', { schema: { body: corpoPostLaudos } }, async (req, reply) => {
      const empresaId = empresaDo(req);
      const { tipo } = corpoPostLaudos.parse(req.body);
      const dados = ESQUEMA_POR_TIPO[tipo].parse({});
      const id = await banco.query(
        `INSERT INTO laudos (empresa_id, tipo, numero, titulo, dados, criado_por)
         VALUES ($1, $2, (SELECT coalesce(max(numero), 0) + 1 FROM laudos WHERE empresa_id = $1 AND tipo = $2), '', $3, $4)
         RETURNING id, numero`,
        [empresaId, tipo, JSON.stringify(dados), req.usuario!.id],
      );
      await auditar(banco, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'laudos', entidadeId: id.rows[0].id, depois: { tipo } });
      reply.code(201);
      return { id: id.rows[0].id, numero: id.rows[0].numero };
    });

    app.get<{ Params: { id: string } }>('/laudos/:id', async (req) => {
      const r = await banco.query('SELECT * FROM laudos WHERE id = $1 AND empresa_id = $2', [req.params.id, empresaDo(req)]);
      if (!r.rowCount) throw naoEncontrado('Laudo');
      const x = r.rows[0];
      return { id: x.id, tipo: x.tipo, numero: x.numero, titulo: x.titulo, dados: x.dados, atualizadoEm: x.atualizado_em };
    });

    app.put<{ Params: { id: string } }>('/laudos/:id', { schema: { body: esquemaSalvar } }, async (req) => {
      const empresaId = empresaDo(req);
      const { titulo, dados } = esquemaSalvar.parse(req.body);
      const atual = await banco.query('SELECT tipo FROM laudos WHERE id = $1 AND empresa_id = $2', [req.params.id, empresaId]);
      if (!atual.rowCount) throw naoEncontrado('Laudo');
      const tipo = atual.rows[0].tipo as Tipo;
      // Cada tipo passa pelo seu esquema: campos ausentes ganham o padrão do modelo.
      const limpos = ESQUEMA_POR_TIPO[tipo].parse(dados) as Record<string, unknown>;
      await banco.query(
        `UPDATE laudos SET titulo = $1, dados = $2, atualizado_em = now() WHERE id = $3 AND empresa_id = $4`,
        [titulo || String(limpos.proprietarioNome ?? limpos.solicitante ?? ''), JSON.stringify(limpos), req.params.id, empresaId],
      );
      return { ok: true };
    });

    app.delete<{ Params: { id: string } }>('/laudos/:id', async (req) => {
      const empresaId = empresaDo(req);
      const r = await banco.query('DELETE FROM laudos WHERE id = $1 AND empresa_id = $2 RETURNING id, tipo, numero', [req.params.id, empresaId]);
      if (!r.rowCount) throw naoEncontrado('Laudo');
      await auditar(banco, { empresaId, usuarioId: req.usuario!.id, acao: 'excluir', entidade: 'laudos', entidadeId: req.params.id, antes: { tipo: r.rows[0].tipo, numero: r.rows[0].numero } });
      return { ok: true };
    });

    // ----- Anexos do laudo (ART em PDF ou foto, fotos da obra, outros documentos) -----
    const corpoPostLaudosAnexos = z.object({
      nome: z.string().trim().min(1, 'Informe o nome do arquivo.').max(200),
      tipo: z.enum(TIPOS_ANEXO, { errorMap: () => ({ message: 'Envie um PDF ou uma foto (JPG, PNG ou WEBP).' }) }),
      categoria: z.enum(CATEGORIAS_ANEXO).default('outro'),
      legenda: z.string().trim().max(200).default(''),
      arquivo: z.string().min(1, 'Envie o arquivo.'),
    });
    app.post<{ Params: { id: string } }>('/laudos/:id/anexos', { bodyLimit: 16 * 1024 * 1024, schema: { body: corpoPostLaudosAnexos } }, async (req, reply) => {
      const empresaId = empresaDo(req);
      const d = corpoPostLaudosAnexos.parse(req.body);
      if (d.categoria === 'foto' && d.tipo === 'application/pdf') throw new ErroHttp(400, 'Fotos precisam ser imagens (JPG, PNG ou WEBP).');
      const bytes = Buffer.from(d.arquivo, 'base64');
      if (!bytes.length) throw new ErroHttp(400, 'Arquivo vazio.');
      if (bytes.length > MAX_ANEXO) throw new ErroHttp(400, 'Arquivo grande demais (máximo 10 MB).');
      if (!conteudoDoTipo(bytes, d.tipo)) throw new ErroHttp(400, 'O arquivo não é do tipo escolhido. Envie um PDF ou uma foto (JPG, PNG ou WEBP).');
      const id = await emTransacao(banco, async (c) => {
        await laudoDaEmpresa(c, empresaId, req.params.id);
        const total = await c.query('SELECT count(*)::int AS n FROM laudos_anexos WHERE laudo_id = $1', [req.params.id]);
        if (Number(total.rows[0].n) >= LIMITE_ANEXOS_LAUDO) throw new ErroHttp(409, `Limite de ${LIMITE_ANEXOS_LAUDO} anexos por laudo.`);
        const nova = await c.query(
          `INSERT INTO laudos_anexos (empresa_id, laudo_id, nome, tipo, categoria, legenda, tamanho, conteudo, criado_por_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [empresaId, req.params.id, d.nome, d.tipo, d.categoria, d.legenda, bytes.length, bytes, req.usuario!.id],
        );
        await auditar(c, {
          empresaId,
          usuarioId: req.usuario!.id,
          acao: 'criar',
          entidade: 'laudos_anexos',
          entidadeId: nova.rows[0].id,
          depois: { laudo: req.params.id, nome: d.nome, categoria: d.categoria },
        });
        return nova.rows[0].id as string;
      });
      reply.code(201);
      return { id };
    });

    app.get<{ Params: { id: string } }>('/laudos/:id/anexos', async (req) => {
      const empresaId = empresaDo(req);
      await laudoDaEmpresa(banco, empresaId, req.params.id);
      const r = await banco.query(
        'SELECT id, nome, tipo, categoria, legenda, tamanho, criado_em FROM laudos_anexos WHERE laudo_id = $1 AND empresa_id = $2 ORDER BY criado_em, id',
        [req.params.id, empresaId],
      );
      return {
        anexos: r.rows.map((a) => ({
          id: a.id,
          nome: a.nome,
          tipo: a.tipo,
          categoria: a.categoria,
          legenda: a.legenda,
          tamanho: a.tamanho,
          criadoEm: a.criado_em,
        })),
      };
    });

    app.get<{ Params: { id: string; anexoId: string } }>('/laudos/:id/anexos/:anexoId', async (req, reply) => {
      const empresaId = empresaDo(req);
      await laudoDaEmpresa(banco, empresaId, req.params.id);
      if (!UUID.test(req.params.anexoId)) throw naoEncontrado('Anexo');
      const a = (
        await banco.query('SELECT nome, tipo, conteudo FROM laudos_anexos WHERE id = $1 AND laudo_id = $2 AND empresa_id = $3', [
          req.params.anexoId,
          req.params.id,
          empresaId,
        ])
      ).rows[0];
      if (!a) throw naoEncontrado('Anexo');
      reply.header('Content-Type', a.tipo);
      reply.header('Content-Disposition', `inline; filename="${String(a.nome).replace(/[^\w.\- ]/g, '_')}"`);
      reply.header('Cache-Control', 'private, max-age=300');
      reply.header('X-Content-Type-Options', 'nosniff');
      return reply.send(a.conteudo);
    });

    app.delete<{ Params: { id: string; anexoId: string } }>('/laudos/:id/anexos/:anexoId', async (req) => {
      const empresaId = empresaDo(req);
      if (!UUID.test(req.params.anexoId)) throw naoEncontrado('Anexo');
      await emTransacao(banco, async (c) => {
        await laudoDaEmpresa(c, empresaId, req.params.id);
        const r = await c.query('DELETE FROM laudos_anexos WHERE id = $1 AND laudo_id = $2 AND empresa_id = $3 RETURNING nome, categoria', [
          req.params.anexoId,
          req.params.id,
          empresaId,
        ]);
        if (!r.rowCount) throw naoEncontrado('Anexo');
        await auditar(c, {
          empresaId,
          usuarioId: req.usuario!.id,
          acao: 'excluir',
          entidade: 'laudos_anexos',
          entidadeId: req.params.anexoId,
          antes: { laudo: req.params.id, nome: r.rows[0].nome, categoria: r.rows[0].categoria },
        });
      });
      return { ok: true };
    });

    /** Lê um PDF (laudo de patologia ou avaliação) pela IA e devolve a identificação para conferência. Não grava nada. */
    const corpoPostLaudosLerIdentificacao = z.object({ arquivo: z.string().min(1), nome: z.string().max(200).optional() });
    app.post('/laudos/ler-identificacao', { config: LIMITE_IA, bodyLimit: 16 * 1024 * 1024, schema: { body: corpoPostLaudosLerIdentificacao } }, async (req) => {
      const { arquivo, nome } = corpoPostLaudosLerIdentificacao.parse(req.body);
      if (!iaDisponivel()) throw new ErroHttp(503, 'A leitura por IA não está configurada. Preencha os dados manualmente.');
      const bytes = Buffer.from(arquivo, 'base64');
      if (bytes.length > 12 * 1024 * 1024) throw new ErroHttp(400, 'Arquivo grande demais (máximo 12 MB).');
      try {
        const r = await chamarIaComFerramenta({
          bloco: blocoDocumento(bytes, 'application/pdf'),
          instrucao:
            `Este é um laudo técnico de engenharia${nome ? ` (arquivo ${nome})` : ''}. Leia-o e registre a identificação chamando a ferramenta registrar_identificacao. ` +
            'Copie os dados exatamente como estão impressos, sem inventar. Se um campo não existir no documento, use null. ' +
            'Ignore a ART além do número, e considere como proprietário também o contratante ou o solicitante.',
          ferramenta: FERRAMENTA_IDENTIFICACAO,
          maxTokens: 1500,
        });
        const t = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
        return {
          identificacao: {
            proprietarioNome: t(r.proprietario_nome),
            proprietarioDocumento: t(r.proprietario_documento),
            localObra: t(r.local_obra),
            endereco: t(r.endereco),
            cep: t(r.cep),
            cidade: t(r.cidade),
            uf: t(r.uf).toUpperCase().slice(0, 2),
            matricula: t(r.matricula),
            zoneamento: t(r.zoneamento),
            areaTerreno: t(r.area_terreno),
            areaConstruida: t(r.area_construida),
            data: /^\d{4}-\d{2}-\d{2}$/.test(t(r.data)) ? t(r.data) : '',
            responsavelNome: t(r.responsavel_nome),
            responsavelRegistro: t(r.responsavel_registro),
            art: t(r.art),
          },
        };
      } catch (e) {
        if (e instanceof ErroIa) throw new ErroHttp(502, e.message);
        throw e;
      }
    });

    /** Lê um PDF de laudo de GLP pela IA e devolve os campos para conferência (não grava nada). */
    const corpoPostLaudosLerGlp = z.object({ arquivo: z.string().min(1), nome: z.string().max(200).optional() });
    app.post('/laudos/ler-glp', { config: LIMITE_IA, bodyLimit: 16 * 1024 * 1024, schema: { body: corpoPostLaudosLerGlp } }, async (req) => {
      const { arquivo, nome } = corpoPostLaudosLerGlp.parse(req.body);
      if (!iaDisponivel()) throw new ErroHttp(503, 'A leitura por IA não está configurada. Preencha os dados manualmente.');
      const bytes = Buffer.from(arquivo, 'base64');
      if (bytes.length > 12 * 1024 * 1024) throw new ErroHttp(400, 'Arquivo grande demais (máximo 12 MB).');
      try {
        const r = await chamarIaComFerramenta({
          bloco: blocoDocumento(bytes, 'application/pdf'),
          instrucao:
            `Este é um laudo técnico de rede e central de GLP${nome ? ` (arquivo ${nome})` : ''}. Leia-o e registre os dados chamando a ferramenta registrar_laudo. ` +
            'Copie os números e textos exatamente como estão impressos, sem inventar. Se um campo não existir no documento, use null. ' +
            'Em "instalacao", use "pex" se a tubulação for PEX e "galvanizado" se for aço galvanizado.',
          ferramenta: FERRAMENTA_LEITURA,
          maxTokens: 2000,
        });
        return { dados: mapaLeitura(r) };
      } catch (e) {
        if (e instanceof ErroIa) throw new ErroHttp(502, e.message);
        throw e;
      }
    });
  };
}

export { ROTULO_TIPO, TIPOS };
