// Cadastro público de interessados no programa piloto (página /interesse e QR code).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Banco } from '../db.ts';
import { ErroHttp } from '../lib/erros.ts';
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
  // Campo escondido do formulário: quem preenche é robô.
  site: z.string().optional(),
});

export function rotasInteresse(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.post('/', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
      const d = esquemaInteresse.parse(req.body);
      const uf = d.uf ? d.uf.toUpperCase() : null;
      if (uf && !/^[A-Z]{2}$/.test(uf)) throw new ErroHttp(400, 'Use a sigla do estado com 2 letras.');
      // Robô preencheu o campo escondido: responde como sucesso e não guarda nada.
      if (d.site) return reply.code(201).send({ ok: true });
      await banco.query(
        `INSERT INTO interessados (empresa, responsavel, email, telefone, cidade, uf, obras_ativas, usuarios, pacote, mensagem)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [d.empresa, d.responsavel, d.email, d.telefone, d.cidade || null, uf, d.obrasAtivas ?? null, d.usuarios ?? null, d.pacote, d.mensagem || null],
      );
      return reply.code(201).send({ ok: true });
    });

    app.get('/', { preHandler: exigir(banco, 'admin_sistema') }, async () => {
      const r = await banco.query(
        `SELECT id, empresa, responsavel, email, telefone, cidade, uf, obras_ativas, usuarios, pacote, mensagem, criado_em
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
          criadoEm: i.criado_em,
        })),
      };
    });
  };
}
