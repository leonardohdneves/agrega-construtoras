// Cadastro público de interessados no programa piloto (página /interesse e QR code).
import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Banco } from '../db.ts';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';
import { indicacaoInteressado, lerCondicoes, preencherProposta } from '../lib/proposta-interessado.ts';
import { esquemaEmail } from '../esquemas.ts';
import { exigir } from '../sessao.ts';

const texto = (rotulo: string, min: number, max: number) =>
  z.string({ required_error: `Preencha ${rotulo}.` }).trim().min(min, `Preencha ${rotulo}.`).max(max, `${rotulo[0].toUpperCase()}${rotulo.slice(1)} é longo demais.`);

const esquemaInteresse = z.object({
  empresa: texto('o nome da empresa', 2, 120),
  responsavel: texto('o nome do responsável', 2, 120),
  email: esquemaEmail,
  telefone: texto('um telefone ou WhatsApp', 8, 30),
  cidade: z.string().trim().max(80).optional().nullable(),
  uf: z.string().trim().max(2).optional().nullable(),
  obrasAtivas: z.number().int().min(0).max(500).optional().nullable(),
  usuarios: z.number().int().min(0).max(500).optional().nullable(),
  pacote: z.enum(['obra', 'obra_gestao', 'completo', 'ainda_nao_sei'], { message: 'Escolha um pacote de interesse.' }),
  mensagem: z.string().trim().max(1000).optional().nullable(),
  // De qual material veio o cadastro (parâmetro ?origem= do QR code). Só guarda o que for um código simples.
  origem: z.string().trim().max(60).optional().nullable(),
  // Campo escondido do formulário: quem preenche é robô.
  site: z.string().optional(),
});
const ORIGEM_VALIDA = /^[a-z0-9-]{1,60}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PASTA_MATERIAL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'material');

export function rotasInteresse(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.post('/', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
      const d = esquemaInteresse.parse(req.body);
      const uf = d.uf ? d.uf.toUpperCase() : null;
      if (uf && !/^[A-Z]{2}$/.test(uf)) throw new ErroHttp(400, 'Use a sigla do estado com 2 letras.');
      // Robô preencheu o campo escondido: responde como sucesso e não guarda nada.
      if (d.site) return reply.code(201).send({ ok: true });
      const origem = d.origem && ORIGEM_VALIDA.test(d.origem) ? d.origem : null;
      await banco.query(
        `INSERT INTO interessados (empresa, responsavel, email, telefone, cidade, uf, obras_ativas, usuarios, pacote, mensagem, origem)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [d.empresa, d.responsavel, d.email, d.telefone, d.cidade || null, uf, d.obrasAtivas ?? null, d.usuarios ?? null, d.pacote, d.mensagem || null, origem],
      );
      return reply.code(201).send({ ok: true });
    });

    app.get('/', { preHandler: exigir(banco, 'admin_sistema') }, async () => {
      const r = await banco.query(
        `SELECT id, empresa, responsavel, email, telefone, cidade, uf, obras_ativas, usuarios, pacote, mensagem, origem, criado_em
           FROM interessados ORDER BY criado_em DESC LIMIT 500`,
      );
      return {
        interessados: r.rows.map((i) => ({
          id: i.id,
          empresa: i.empresa,
          responsavel: i.responsavel,
          email: i.email,
          telefone: i.telefone,
          cidade: i.cidade ?? null,
          uf: i.uf ? String(i.uf).trim() : null,
          obrasAtivas: i.obras_ativas ?? null,
          usuarios: i.usuarios ?? null,
          pacote: i.pacote,
          mensagem: i.mensagem ?? null,
          origem: i.origem ?? null,
          criadoEm: i.criado_em,
        })),
      };
    });

    // Proposta comercial preenchida com o cadastro do interessado (só o administrador do sistema).
    app.get<{ Params: { id: string } }>('/:id/proposta', { preHandler: exigir(banco, 'admin_sistema') }, async (req, reply) => {
      if (!UUID.test(req.params.id)) throw naoEncontrado('Interessado');
      let condicoes;
      try {
        condicoes = lerCondicoes(req.query as Record<string, unknown>);
      } catch (err) {
        throw new ErroHttp(400, (err as Error).message);
      }
      const r = await banco.query(
        'SELECT empresa, responsavel, cidade, uf, obras_ativas, usuarios, pacote FROM interessados WHERE id = $1',
        [req.params.id],
      );
      if (!r.rowCount) throw naoEncontrado('Interessado');
      const i = r.rows[0];
      const quem = await banco.query('SELECT telefone_whatsapp FROM usuarios WHERE id = $1', [req.usuario!.id]);
      const modelo = await readFile(path.join(PASTA_MATERIAL, 'proposta-comercial.html'), 'utf8');
      const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      const html = preencherProposta(
        modelo,
        {
          empresa: i.empresa,
          responsavel: i.responsavel,
          cnpj: null,
          pacote: i.pacote,
          indicacao: indicacaoInteressado(i.pacote, i.obras_ativas ?? null, i.usuarios ?? null),
        },
        { nome: req.usuario!.nome, email: req.usuario!.email ?? null, telefone: quem.rows[0]?.telefone_whatsapp ?? null, cnpj: null },
        hoje,
        condicoes,
      );
      return reply.header('Content-Type', 'text/html; charset=utf-8').header('Cache-Control', 'private, no-store').header('X-Robots-Tag', 'noindex').send(html);
    });
  };
}
