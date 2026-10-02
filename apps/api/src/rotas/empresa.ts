import type { FastifyInstance } from 'fastify';
import type { Banco } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { esquemaEmpresa } from '../esquemas.ts';
import { empresaPublica } from '../formatos.ts';
import { naoEncontrado } from '../lib/erros.ts';
import { empresaDo, exigir } from '../sessao.ts';

export function rotasEmpresa(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.get('/', { preHandler: exigir(banco, 'dono', 'gestor', 'motorista', 'operador_usina') }, async (req) => {
      const r = await banco.query('SELECT * FROM empresas WHERE id = $1', [empresaDo(req)]);
      if (!r.rows[0]) throw naoEncontrado('Empresa');
      return { empresa: empresaPublica(r.rows[0]) };
    });

    app.put('/', { preHandler: exigir(banco, 'dono') }, async (req) => {
      const d = esquemaEmpresa.parse(req.body);
      const id = empresaDo(req);
      const empresa = await emTransacao(banco, async (c) => {
        const antes = (await c.query('SELECT * FROM empresas WHERE id = $1 FOR UPDATE', [id])).rows[0];
        if (!antes) throw naoEncontrado('Empresa');
        const depois = (
          await c.query(
            `UPDATE empresas SET razao_social = $2, nome_fantasia = $3, cnpj = $4, regime_tributario = $5,
                    aliquotas_dre = $6, telefone = $7, email = $8, cidade = $9, uf = $10, atualizado_em = now()
              WHERE id = $1 RETURNING *`,
            [id, d.razaoSocial, d.nomeFantasia, d.cnpj, d.regimeTributario, JSON.stringify(d.aliquotasDre), d.telefone, d.email ?? null, d.cidade, d.uf ?? null],
          )
        ).rows[0];
        await auditar(c, { empresaId: id, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'empresas', entidadeId: id, antes, depois });
        return depois;
      });
      return { empresa: empresaPublica(empresa) };
    });
  };
}
