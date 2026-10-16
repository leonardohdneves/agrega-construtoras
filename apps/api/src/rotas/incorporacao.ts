// Incorporação · estudos aprovados do Viabiliza importados para o Agrega. Só dono e gestor.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Banco } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';
import { empresaDo, exigir } from '../sessao.ts';
import { buscarEstudoAprovado, entrarViabiliza, listarEstudosAprovados, planejarImportacao, type UnidadeExistente } from '../lib/estudo-importacao.ts';
import { avisarLimiteEmpreendimentos } from '../lib/avisos.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const credenciais = z.object({
  email: z.string().trim().email('Informe o e-mail do Viabiliza.').max(200),
  senha: z.string().min(1, 'Informe a senha do Viabiliza.').max(200),
});
const esquemaImportar = credenciais.extend({ estudoId: z.string().trim().min(1).max(120) });
const cent = (r: number) => Math.round(r * 100);
const reais = (c: unknown) => Math.round(Number(c)) / 100;

/** Endereço do Viabiliza vem da configuração do servidor, nunca do usuário (evita chamadas a outros sites). */
function baseViabiliza(): string {
  const base = process.env.VIABILIZA_URL?.replace(/\/+$/, '');
  if (!base) throw new ErroHttp(503, 'A conexão com o Viabiliza ainda não está configurada neste servidor.');
  return base;
}

function lerCorpo<T extends z.ZodTypeAny>(esquema: T, corpo: unknown): z.infer<T> {
  const r = esquema.safeParse(corpo);
  if (!r.success) throw new ErroHttp(422, r.error.issues[0]?.message ?? 'Dados inválidos.');
  return r.data;
}

export function rotasIncorporacao(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.addHook('preHandler', exigir(banco, 'dono', 'gestor'));

    // Lista os estudos aprovados que o usuário do Viabiliza pode importar.
    app.post('/incorporacao/estudos-disponiveis', async (req) => {
      const corpo = lerCorpo(credenciais, req.body);
      const base = baseViabiliza();
      const token = await entrarViabiliza(base, corpo.email, corpo.senha);
      return { estudos: await listarEstudosAprovados(base, token) };
    });

    // Importa um estudo aprovado: cria ou atualiza o empreendimento e as unidades, e registra a importação.
    app.post('/incorporacao/importar', async (req) => {
      const empresaId = empresaDo(req);
      const usuarioId = req.usuario!.id;
      const corpo = lerCorpo(esquemaImportar, req.body);
      const base = baseViabiliza();
      const token = await entrarViabiliza(base, corpo.email, corpo.senha);
      const estudo = await buscarEstudoAprovado(base, token, corpo.estudoId);

      return emTransacao(banco, async (c) => {
        const atual = (
          await c.query(`SELECT id FROM incorporacao_empreendimentos WHERE empresa_id = $1 AND estudo_externo_id = $2`, [empresaId, estudo.empreendimento.id])
        ).rows[0];
        const existentes: UnidadeExistente[] = atual
          ? (await c.query(`SELECT codigo_externo, nome, preco_centavos, situacao FROM incorporacao_unidades WHERE empreendimento_id = $1`, [atual.id])).rows.map((u) => ({
              codigoExterno: u.codigo_externo,
              nome: u.nome,
              preco: reais(u.preco_centavos),
              situacao: u.situacao,
            }))
          : [];
        const plano = planejarImportacao(existentes, estudo.unidades);

        let empId: string;
        if (atual) {
          empId = atual.id;
          await c.query(
            `UPDATE incorporacao_empreendimentos SET nome = $2, cidade = $3, uf = $4, versao_estudo = $5, aprovado_em = $6, importado_em = now(), importado_por_id = $7 WHERE id = $1`,
            [empId, estudo.empreendimento.nome, estudo.empreendimento.cidade, estudo.empreendimento.uf, estudo.versaoEstudo, estudo.aprovadoEm, usuarioId],
          );
        } else {
          const criado = await c.query(
            `INSERT INTO incorporacao_empreendimentos (empresa_id, estudo_externo_id, nome, cidade, uf, versao_estudo, aprovado_em, importado_por_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [empresaId, estudo.empreendimento.id, estudo.empreendimento.nome, estudo.empreendimento.cidade, estudo.empreendimento.uf, estudo.versaoEstudo, estudo.aprovadoEm, usuarioId],
          );
          empId = criado.rows[0].id;
        }

        const porCodigo = new Map(estudo.unidades.map((u) => [u.codigoExterno, u]));
        for (const u of plano.criar) {
          await c.query(
            `INSERT INTO incorporacao_unidades (empresa_id, empreendimento_id, codigo_externo, nome, numero, andar, tipologia, area_privativa, preco_centavos, situacao)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [empresaId, empId, u.codigoExterno, u.nome, u.numero, u.andar, u.tipologia, u.areaPrivativa, cent(u.preco), u.permuta ? 'permuta' : 'disponivel'],
          );
        }
        for (const u of plano.atualizar) {
          const fonte = porCodigo.get(u.codigoExterno);
          await c.query(
            `UPDATE incorporacao_unidades SET nome = $3, preco_centavos = $4, situacao = $5, tipologia = coalesce($6, tipologia), area_privativa = coalesce($7, area_privativa)
              WHERE empreendimento_id = $1 AND codigo_externo = $2`,
            [empId, u.codigoExterno, u.nome, cent(u.preco), u.situacao, fonte?.tipologia ?? null, fonte?.areaPrivativa ?? null],
          );
        }
        for (const codigo of plano.removidas) {
          await c.query(`UPDATE incorporacao_unidades SET situacao = 'removida_do_estudo' WHERE empreendimento_id = $1 AND codigo_externo = $2`, [empId, codigo]);
        }

        const importacao = await c.query(
          `INSERT INTO incorporacao_importacoes (empresa_id, empreendimento_id, versao_estudo, usuario_id, totais, divergencias)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, importado_em`,
          [empresaId, empId, estudo.versaoEstudo, usuarioId, JSON.stringify(plano.totais), JSON.stringify(plano.divergencias)],
        );
        await auditar(c, { empresaId, usuarioId, acao: atual ? 'alterar' : 'criar', entidade: 'incorporacao_empreendimentos', entidadeId: empId, depois: { versaoEstudo: estudo.versaoEstudo, totais: plano.totais } });
        await avisarLimiteEmpreendimentos(c, empresaId);
        return { empreendimentoId: empId, importacao: { id: importacao.rows[0].id, importadoEm: importacao.rows[0].importado_em, totais: plano.totais, divergencias: plano.divergencias } };
      });
    });

    app.get('/incorporacao/empreendimentos', async (req) => {
      const empresaId = empresaDo(req);
      const r = await banco.query(
        `SELECT e.id, e.nome, e.cidade, e.uf, e.versao_estudo, e.aprovado_em, e.importado_em,
                count(u.id) FILTER (WHERE u.situacao <> 'removida_do_estudo') AS unidades,
                count(u.id) FILTER (WHERE u.situacao = 'disponivel') AS disponiveis,
                count(u.id) FILTER (WHERE u.situacao IN ('reservada', 'vendida')) AS vendidas_ou_reservadas
           FROM incorporacao_empreendimentos e LEFT JOIN incorporacao_unidades u ON u.empreendimento_id = e.id
          WHERE e.empresa_id = $1 GROUP BY e.id ORDER BY e.nome`,
        [empresaId],
      );
      return {
        empreendimentos: r.rows.map((e) => ({
          id: e.id,
          nome: e.nome,
          cidade: e.cidade,
          uf: e.uf,
          versaoEstudo: e.versao_estudo,
          aprovadoEm: e.aprovado_em,
          importadoEm: e.importado_em,
          unidades: Number(e.unidades),
          disponiveis: Number(e.disponiveis),
          vendidasOuReservadas: Number(e.vendidas_ou_reservadas),
        })),
      };
    });

    app.get<{ Params: { id: string } }>('/incorporacao/empreendimentos/:id', async (req) => {
      const empresaId = empresaDo(req);
      if (!UUID.test(req.params.id)) throw naoEncontrado('Empreendimento');
      const [emp] = (await banco.query(`SELECT * FROM incorporacao_empreendimentos WHERE id = $1 AND empresa_id = $2`, [req.params.id, empresaId])).rows;
      if (!emp) throw naoEncontrado('Empreendimento');
      const unidades = (
        await banco.query(
          `SELECT id, codigo_externo, nome, numero, andar, tipologia, area_privativa, preco_centavos, situacao
             FROM incorporacao_unidades WHERE empreendimento_id = $1 ORDER BY andar NULLS FIRST, numero NULLS FIRST, nome`,
          [emp.id],
        )
      ).rows;
      const ultima = (
        await banco.query(`SELECT id, versao_estudo, importado_em, totais, divergencias FROM incorporacao_importacoes WHERE empreendimento_id = $1 ORDER BY importado_em DESC LIMIT 1`, [emp.id])
      ).rows[0];
      return {
        empreendimento: { id: emp.id, nome: emp.nome, cidade: emp.cidade, uf: emp.uf, versaoEstudo: emp.versao_estudo, aprovadoEm: emp.aprovado_em },
        unidades: unidades.map((u) => ({
          id: u.id,
          codigoExterno: u.codigo_externo,
          nome: u.nome,
          numero: u.numero,
          andar: u.andar,
          tipologia: u.tipologia,
          areaPrivativa: Number(u.area_privativa),
          preco: reais(u.preco_centavos),
          situacao: u.situacao,
        })),
        ultimaImportacao: ultima ? { id: ultima.id, versaoEstudo: ultima.versao_estudo, importadoEm: ultima.importado_em, totais: ultima.totais, divergencias: ultima.divergencias } : null,
      };
    });
  };
}
