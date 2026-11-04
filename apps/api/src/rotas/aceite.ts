// Aceite público da proposta comercial: o cliente abre o link, confere as condições e aceita o período de testes.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Banco } from '../db.ts';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';
import { exigir } from '../sessao.ts';

const CODIGO = /^[A-Za-z0-9_-]{32,64}$/;
const esquemaAceite = z.object({
  nome: z.string({ required_error: 'Informe seu nome.' }).trim().min(3, 'Informe seu nome completo.').max(120),
  cargo: z.string({ required_error: 'Informe seu cargo.' }).trim().min(2, 'Informe seu cargo.').max(80),
  documento: z.string({ required_error: 'Informe o CPF ou CNPJ.' }),
  concordo: z.literal(true, { errorMap: () => ({ message: 'Confirme que leu as condições.' }) }),
});

const data = (d: Date | string | null) => (d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : null);

export function rotasAceite(banco: Banco) {
  return async function (app: FastifyInstance) {
    // Lista para o comercial: aceites e períodos de testes, mais recentes primeiro.
    app.get('/admin/aceites', { preHandler: exigir(banco, 'admin_sistema') }, async () => {
      const r = await banco.query(
        `SELECT nome_cliente, dias_teste, expira_em, criado_em, aceito_em, aceito_nome, aceito_cargo, aceito_documento, teste_inicio, teste_fim
           FROM propostas_aceite ORDER BY criado_em DESC LIMIT 200`,
      );
      return {
        aceites: r.rows.map((a) => ({
          cliente: a.nome_cliente,
          diasTeste: a.dias_teste,
          criadoEm: a.criado_em,
          expiraEm: a.expira_em,
          status: a.aceito_em ? 'aceito' : new Date(a.expira_em) < new Date() ? 'expirada' : 'pendente',
          aceitoEm: a.aceito_em,
          aceitoPor: a.aceito_nome ? `${a.aceito_nome} (${a.aceito_cargo})` : null,
          documento: a.aceito_documento,
          testeInicio: data(a.teste_inicio),
          testeFim: data(a.teste_fim),
        })),
      };
    });

    // Dados da proposta para a página de aceite (sem login).
    app.get<{ Params: { codigo: string } }>('/:codigo', { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (req) => {
      if (!CODIGO.test(req.params.codigo)) throw naoEncontrado('Proposta');
      const r = await banco.query(
        `SELECT nome_cliente, condicoes, dias_teste, expira_em, aceito_em, teste_inicio, teste_fim FROM propostas_aceite WHERE codigo = $1`,
        [req.params.codigo],
      );
      if (!r.rowCount) throw naoEncontrado('Proposta');
      const a = r.rows[0];
      const status = a.aceito_em ? 'aceita' : new Date(a.expira_em) < new Date() ? 'expirada' : 'pendente';
      return {
        status,
        cliente: a.nome_cliente,
        diasTeste: a.dias_teste,
        expiraEm: a.expira_em,
        aceitaEm: data(a.aceito_em),
        testeInicio: data(a.teste_inicio),
        testeFim: data(a.teste_fim),
      };
    });

    // Aceite: grava quem aceitou, quando e de qual IP, e abre o período de testes a partir de hoje.
    app.post<{ Params: { codigo: string } }>('/:codigo', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
      if (!CODIGO.test(req.params.codigo)) throw naoEncontrado('Proposta');
      const d = esquemaAceite.parse(req.body);
      const documento = d.documento.replace(/\D/g, '');
      if (documento.length !== 11 && documento.length !== 14) throw new ErroHttp(400, 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).');
      const r = await banco.query(
        `UPDATE propostas_aceite
            SET aceito_em = now(), aceito_nome = $2, aceito_cargo = $3, aceito_documento = $4, aceito_ip = $5,
                teste_inicio = (now() AT TIME ZONE 'America/Sao_Paulo')::date,
                teste_fim = (now() AT TIME ZONE 'America/Sao_Paulo')::date + dias_teste
          WHERE codigo = $1 AND aceito_em IS NULL AND expira_em > now()
          RETURNING teste_inicio, teste_fim`,
        [req.params.codigo, d.nome, d.cargo, documento, req.ip],
      );
      if (!r.rowCount) {
        const atual = (await banco.query('SELECT aceito_em, expira_em FROM propostas_aceite WHERE codigo = $1', [req.params.codigo])).rows[0];
        if (!atual) throw naoEncontrado('Proposta');
        if (atual.aceito_em) throw new ErroHttp(409, `Esta proposta já foi aceita em ${data(atual.aceito_em)}.`);
        throw new ErroHttp(410, 'Esta proposta expirou. Peça uma nova ao comercial.');
      }
      return reply.code(201).send({ ok: true, testeInicio: data(r.rows[0].teste_inicio), testeFim: data(r.rows[0].teste_fim) });
    });
  };
}
