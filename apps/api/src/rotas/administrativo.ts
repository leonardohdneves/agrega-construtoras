// Módulo Administrativo: fornecedores, credores e clientes.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Banco } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { cnpjValido } from '../lib/cnpj.ts';
import { cpfValido } from '../lib/frota.ts';
import { ATUACOES } from '../lib/atuacao.ts';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';
import { lerCadastroComIa, type EntidadeCadastro } from '../lib/ia-cadastro.ts';
import { ErroIa, iaDisponivel } from '../lib/ia-nota.ts';
import { empresaDo, exigir } from '../sessao.ts';

const texto = z.string().trim().max(200).optional().nullable().transform((v) => v || null);

const camposFornecedor = {
  categoria: z.enum(['fornecedor', 'credor']).optional().default('fornecedor'),
  tipoPessoa: z.enum(['PJ', 'PF']).optional().default('PJ'),
  cnpjCpf: z.union([z.string(), z.null()]).optional().transform((v) => (v ?? '').replace(/\D/g, '') || null),
  razaoSocial: z.string({ required_error: 'Informe o nome ou a razão social.' }).trim().min(2, 'Informe o nome ou a razão social.').max(200),
  nomeFantasia: texto,
  ramo: texto,
  atuacao: z.array(z.enum(ATUACOES)).max(3).optional().default([]).transform((v) => [...new Set(v)]),
  telefone: texto,
  email: z.string().trim().toLowerCase().email('E-mail inválido.').optional().nullable().or(z.literal('').transform(() => null)),
  endereco: texto,
  cidade: texto,
  uf: z.string().trim().toUpperCase().length(2, 'UF com 2 letras.').optional().nullable().or(z.literal('').transform(() => null)),
  chavePix: texto,
  observacoes: z.string().trim().max(1000).optional().nullable().transform((v) => v || null),
  ativo: z.boolean().optional().default(true),
};

function validarDocumento(d: { tipoPessoa?: 'PJ' | 'PF'; cnpjCpf?: string | null }, ctx: z.RefinementCtx) {
  if (!d.cnpjCpf) return;
  const pj = (d.tipoPessoa ?? 'PJ') === 'PJ';
  if (pj ? !cnpjValido(d.cnpjCpf) : !cpfValido(d.cnpjCpf)) {
    ctx.addIssue({ code: 'custom', path: ['cnpjCpf'], message: pj ? 'CNPJ inválido. Confira os números.' : 'CPF inválido. Confira os números.' });
  }
}

export const esquemaFornecedor = z.object(camposFornecedor).superRefine(validarDocumento);
export const esquemaAlterarFornecedor = z.object(camposFornecedor).partial().strict().superRefine(validarDocumento);

const COLUNAS: Record<string, string> = {
  categoria: 'categoria',
  tipoPessoa: 'tipo_pessoa',
  cnpjCpf: 'cnpj_cpf',
  razaoSocial: 'razao_social',
  nomeFantasia: 'nome_fantasia',
  ramo: 'ramo',
  atuacao: 'atuacao',
  telefone: 'telefone',
  email: 'email',
  endereco: 'endereco',
  cidade: 'cidade',
  uf: 'uf',
  chavePix: 'chave_pix',
  observacoes: 'observacoes',
  ativo: 'ativo',
};

export function fornecedorPublico(r: Record<string, any>) {
  return {
    id: r.id,
    categoria: r.categoria,
    tipoPessoa: String(r.tipo_pessoa).trim(),
    cnpjCpf: r.cnpj_cpf,
    razaoSocial: r.razao_social,
    nomeFantasia: r.nome_fantasia,
    ramo: r.ramo,
    atuacao: (r.atuacao ?? []) as string[],
    telefone: r.telefone,
    email: r.email,
    endereco: r.endereco,
    cidade: r.cidade,
    uf: r.uf ? String(r.uf).trim() : null,
    chavePix: r.chave_pix,
    observacoes: r.observacoes,
    ativo: r.ativo,
    criadoAutomaticamente: r.criado_automaticamente,
  };
}

export function clientePublico(r: Record<string, any>) {
  const { categoria: _c, criadoAutomaticamente: _a, ...resto } = fornecedorPublico(r);
  return resto;
}

export function rotasAdministrativo(banco: Banco) {
  return async function (app: FastifyInstance) {
    const gestao = exigir(banco, 'dono', 'gestor');

    // ----- Leitura de cadastros por IA (foto ou PDF do documento) -----
    // A IA só sugere os campos; quem salva é o formulário, depois de conferido pelo usuário.
    app.get('/cadastros/leitura', { preHandler: gestao }, async () => ({ ia: iaDisponivel() }));

    app.post('/cadastros/leitura', { preHandler: gestao, bodyLimit: 16 * 1024 * 1024 }, async (req) => {
      const d = z
        .object({
          arquivo: z.string({ required_error: 'Envie a foto ou o PDF.' }).min(20, 'Arquivo vazio.'),
          tipo: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], { errorMap: () => ({ message: 'Envie um PDF ou uma foto (JPG, PNG ou WEBP).' }) }),
          entidade: z.enum(['fornecedor', 'credor', 'cliente', 'colaborador']),
        })
        .parse(req.body);
      if (!iaDisponivel()) throw new ErroHttp(503, 'A leitura por IA não está configurada. Preencha os dados manualmente.');
      const bytes = Buffer.from(d.arquivo, 'base64');
      if (bytes.length > 10 * 1024 * 1024) throw new ErroHttp(400, 'Arquivo grande demais (máximo 10 MB).');
      try {
        return await lerCadastroComIa(bytes, d.tipo, d.entidade as EntidadeCadastro);
      } catch (e) {
        if (e instanceof ErroIa) throw new ErroHttp(502, e.message);
        throw e;
      }
    });

    // ----- Clientes (quem compra o concreto) -----
    app.get('/clientes', { preHandler: gestao }, async (req) => {
      const r = await banco.query(
        `SELECT * FROM clientes WHERE empresa_id = $1 AND excluido_em IS NULL ORDER BY ativo DESC, coalesce(nome_fantasia, razao_social)`,
        [empresaDo(req)],
      );
      return { clientes: r.rows.map(clientePublico) };
    });

    app.post('/clientes', { preHandler: gestao }, async (req, reply) => {
      const d = esquemaFornecedor.parse(req.body);
      const empresaId = empresaDo(req);
      const n = await emTransacao(banco, async (c) => {
        const novo = (
          await c.query(
            `INSERT INTO clientes (empresa_id, tipo_pessoa, cnpj_cpf, razao_social, nome_fantasia, ramo, telefone, email, cidade, uf, chave_pix, observacoes, ativo)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
            [empresaId, d.tipoPessoa, d.cnpjCpf, d.razaoSocial, d.nomeFantasia, d.ramo, d.telefone, d.email ?? null, d.cidade, d.uf ?? null, d.chavePix, d.observacoes, d.ativo],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'clientes', entidadeId: novo.id, depois: novo });
        return novo;
      });
      reply.code(201);
      return { cliente: clientePublico(n) };
    });

    app.patch<{ Params: { id: string } }>('/clientes/:id', { preHandler: gestao }, async (req) => {
      const d = esquemaAlterarFornecedor.parse(req.body) as Record<string, unknown>;
      delete d.categoria;
      const empresaId = empresaDo(req);
      const f = await emTransacao(banco, async (c) => {
        const antes = (await c.query('SELECT * FROM clientes WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL FOR UPDATE', [req.params.id, empresaId])).rows[0];
        if (!antes) throw naoEncontrado('Cliente');
        const partes: string[] = [];
        const valores: unknown[] = [];
        for (const [k, v] of Object.entries(d)) {
          if (!COLUNAS[k] || v === undefined) continue;
          valores.push(v);
          partes.push(`${COLUNAS[k]} = $${valores.length + 2}`);
        }
        if (!partes.length) return antes;
        const depois = (await c.query(`UPDATE clientes SET ${partes.join(', ')}, atualizado_em = now() WHERE id = $1 AND empresa_id = $2 RETURNING *`, [antes.id, empresaId, ...valores])).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'clientes', entidadeId: antes.id, antes, depois });
        return depois;
      });
      return { cliente: clientePublico(f) };
    });

    app.get<{ Querystring: { categoria?: string } }>('/fornecedores', { preHandler: gestao }, async (req) => {
      const categoria = req.query.categoria === 'credor' || req.query.categoria === 'fornecedor' ? req.query.categoria : null;
      const r = await banco.query(
        `SELECT * FROM fornecedores WHERE empresa_id = $1 AND excluido_em IS NULL AND ($2::text IS NULL OR categoria = $2)
          ORDER BY ativo DESC, coalesce(nome_fantasia, razao_social)`,
        [empresaDo(req), categoria],
      );
      return { fornecedores: r.rows.map(fornecedorPublico) };
    });

    app.post('/fornecedores', { preHandler: gestao }, async (req, reply) => {
      const d = esquemaFornecedor.parse(req.body);
      const empresaId = empresaDo(req);
      const f = await emTransacao(banco, async (c) => {
        const novo = (
          await c.query(
            `INSERT INTO fornecedores (empresa_id, categoria, tipo_pessoa, cnpj_cpf, razao_social, nome_fantasia, ramo, telefone, email, cidade, uf, chave_pix, observacoes, ativo, endereco, atuacao)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
            [empresaId, d.categoria, d.tipoPessoa, d.cnpjCpf, d.razaoSocial, d.nomeFantasia, d.ramo, d.telefone, d.email ?? null, d.cidade, d.uf ?? null, d.chavePix, d.observacoes, d.ativo, d.endereco, d.atuacao],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'fornecedores', entidadeId: novo.id, depois: novo });
        return novo;
      });
      reply.code(201);
      return { fornecedor: fornecedorPublico(f) };
    });

    app.patch<{ Params: { id: string } }>('/fornecedores/:id', { preHandler: gestao }, async (req) => {
      const d = esquemaAlterarFornecedor.parse(req.body) as Record<string, unknown>;
      const empresaId = empresaDo(req);
      const f = await emTransacao(banco, async (c) => {
        const antes = (await c.query('SELECT * FROM fornecedores WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL FOR UPDATE', [req.params.id, empresaId])).rows[0];
        if (!antes) throw naoEncontrado('Cadastro');
        const partes: string[] = [];
        const valores: unknown[] = [];
        for (const [k, v] of Object.entries(d)) {
          if (!COLUNAS[k] || v === undefined) continue;
          valores.push(v);
          partes.push(`${COLUNAS[k]} = $${valores.length + 2}`);
        }
        if (!partes.length) return antes;
        const depois = (await c.query(`UPDATE fornecedores SET ${partes.join(', ')}, atualizado_em = now() WHERE id = $1 AND empresa_id = $2 RETURNING *`, [antes.id, empresaId, ...valores])).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'fornecedores', entidadeId: antes.id, antes, depois });
        return depois;
      });
      return { fornecedor: fornecedorPublico(f) };
    });
  };
}
