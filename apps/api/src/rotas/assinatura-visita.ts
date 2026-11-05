// Assinatura da visita pelo dono da obra, pelo link gerado pela construtora. Não exige login: o token do link
// é o que identifica a visita. O link expira em 30 dias e mostra só os dados da visita.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Banco, Cliente } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { codigoDaVisita, validarImagemAssinatura } from '../lib/assinatura.ts';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';

const TOKEN = /^[A-Za-z0-9_-]{20,80}$/;
const esquemaDono = z.object({
  nome: z.string({ required_error: 'Informe seu nome.' }).trim().min(3, 'Informe seu nome completo.').max(120),
  imagem: z.string({ required_error: 'Assine na tela.' }).min(10, 'Assine na tela.'),
});

/** Visita pelo token, só se o link não expirou. */
async function visitaDoLink(c: Cliente | Banco, token: string, travar = false) {
  if (!TOKEN.test(token)) throw naoEncontrado('Visita');
  const r = await c.query(
    `SELECT v.id, v.empresa_id, v.numero, v.data::text AS data, v.responsavel, v.observacoes, v.assinatura_token_expira,
            o.codigo AS obra_codigo, o.nome AS obra_nome, o.endereco, o.cidade, o.uf,
            e.razao_social, e.nome_fantasia, e.cnpj
       FROM obra_visitas v
       JOIN obras o ON o.id = v.obra_id
       JOIN empresas e ON e.id = v.empresa_id
      WHERE v.assinatura_token = $1 ${travar ? 'FOR UPDATE OF v' : ''}`,
    [token],
  );
  if (!r.rowCount) throw naoEncontrado('Visita');
  const v = r.rows[0];
  if (new Date(v.assinatura_token_expira) < new Date()) throw new ErroHttp(410, 'Este link de assinatura expirou. Peça um novo link à construtora.');
  return v;
}

export function rotasAssinaturaVisita(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.get<{ Params: { token: string } }>('/:token', { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (req) => {
      const v = await visitaDoLink(banco, req.params.token);
      const assinaturas = await banco.query('SELECT papel, nome, assinado_em FROM visita_assinaturas WHERE visita_id = $1', [v.id]);
      const responsavel = assinaturas.rows.find((a) => a.papel === 'responsavel');
      const dono = assinaturas.rows.find((a) => a.papel === 'dono_obra');
      return {
        empresa: v.nome_fantasia || v.razao_social,
        obra: { codigo: v.obra_codigo, nome: v.obra_nome, local: [v.endereco, [v.cidade, v.uf].filter(Boolean).join('/')].filter(Boolean).join(' · ') },
        visita: { numero: v.numero, data: v.data, responsavel: v.responsavel, observacoes: v.observacoes },
        responsavelAssinou: responsavel ? { nome: responsavel.nome, assinadoEm: responsavel.assinado_em } : null,
        donoAssinou: dono ? { nome: dono.nome, assinadoEm: dono.assinado_em } : null,
      };
    });

    app.post<{ Params: { token: string } }>('/:token', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
      const d = esquemaDono.parse(req.body ?? {});
      const imagem = validarImagemAssinatura(d.imagem);
      await emTransacao(banco, async (c) => {
        const v = await visitaDoLink(c, req.params.token, true);
        const ja = await c.query(`SELECT 1 FROM visita_assinaturas WHERE visita_id = $1 AND papel = 'dono_obra'`, [v.id]);
        if (ja.rowCount) throw new ErroHttp(409, 'Esta visita já foi assinada pelo dono da obra.');
        const fotos = (await c.query('SELECT id::text AS id FROM obra_visita_fotos WHERE visita_id = $1', [v.id])).rows.map((f) => f.id as string);
        const codigo = codigoDaVisita(v, fotos);
        await c.query(
          `INSERT INTO visita_assinaturas (empresa_id, visita_id, papel, nome, imagem, codigo, ip)
           VALUES ($1, $2, 'dono_obra', $3, $4, $5, $6)`,
          [v.empresa_id, v.id, d.nome, imagem, codigo, req.ip],
        );
        await auditar(c, { empresaId: v.empresa_id, usuarioId: null, acao: 'confirmar', entidade: 'obra_visitas', entidadeId: v.id, depois: { papel: 'dono_obra', nome: d.nome, codigo } });
      });
      reply.code(201);
      return { ok: true };
    });
  };
}
