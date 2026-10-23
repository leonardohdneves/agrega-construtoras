// Patrimônio da construtora: ferramentas e equipamentos próprios. Cadastro (dono e gestor), retirada e devolução
// por obra (almoxarife, engenheiro de obra e dono; quem não é dono só mexe nas obras atribuídas a ele) e depreciação linear.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Banco, Cliente } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { ErroHttp, naoEncontrado, semPermissao } from '../lib/erros.ts';
import { hojeBrasil } from '../lib/frota.ts';
import { obrasPermitidas } from '../lib/obras-acesso.ts';
import { empresaDo, exigir } from '../sessao.ts';
import { dinheiro } from './financeiro.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dataObrig = (msg: string) => z.string({ required_error: msg }).regex(/^\d{4}-\d{2}-\d{2}$/, msg);
const textoOpc = (max = 200) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);

const esquemaBem = z.object({
  nome: z.string({ required_error: 'Informe o nome.' }).trim().min(2, 'Informe o nome.').max(200),
  marca: textoOpc(100),
  serie: textoOpc(100),
  dataAquisicao: dataObrig('Informe a data de aquisição.'),
  valorAquisicao: dinheiro('o valor de aquisição'),
  valorResidual: dinheiro('o valor residual', { positivo: false }),
  vidaUtilMeses: z.coerce.number({ invalid_type_error: 'Informe a vida útil em meses.' }).int().min(1, 'Informe a vida útil em meses.').max(600),
});
const esquemaRetirada = z.object({
  obraId: z.string({ required_error: 'Escolha a obra.' }).regex(UUID, 'Escolha a obra.'),
  responsavel: z.string({ required_error: 'Informe quem está retirando.' }).trim().min(2, 'Informe quem está retirando.').max(120),
  observacao: textoOpc(300),
});
const esquemaDevolucao = z.object({
  estado: z.enum(['disponivel', 'manutencao']).default('disponivel'),
  observacao: textoOpc(300),
});

/** Depreciação linear por mês: (aquisição − residual) ÷ vida útil. Conta meses cheios pela diferença de mês do calendário. */
export function depreciacao(b: { valor: number; residual: number; vidaMeses: number; aquisicao: string }, hoje: string) {
  const base = Math.max(0, b.valor - b.residual);
  const [ay, am] = b.aquisicao.slice(0, 7).split('-').map(Number);
  const [hy, hm] = hoje.slice(0, 7).split('-').map(Number);
  const meses = Math.min(Math.max((hy - ay) * 12 + (hm - am), 0), b.vidaMeses);
  const acumulada = meses >= b.vidaMeses ? base : Math.round((base * meses) / b.vidaMeses);
  return {
    mensal: Math.round(base / b.vidaMeses),
    acumulada,
    contabil: b.valor - acumulada,
    mesesUsados: meses,
  };
}

const reais = (c: unknown) => Number(c) / 100;

function bemPublico(r: Record<string, any>, hoje: string) {
  const dep = depreciacao(
    { valor: Number(r.valor_aquisicao_centavos), residual: Number(r.valor_residual_centavos), vidaMeses: Number(r.vida_util_meses), aquisicao: String(r.data_aquisicao).slice(0, 10) },
    hoje,
  );
  return {
    id: r.id as string,
    codigo: r.codigo as string,
    nome: r.nome as string,
    marca: (r.marca ?? null) as string | null,
    serie: (r.serie ?? null) as string | null,
    dataAquisicao: String(r.data_aquisicao).slice(0, 10),
    valorAquisicao: reais(r.valor_aquisicao_centavos),
    valorResidual: reais(r.valor_residual_centavos),
    vidaUtilMeses: Number(r.vida_util_meses),
    status: r.status as string,
    obraId: (r.obra_id ?? null) as string | null,
    obraCodigo: (r.obra_codigo ?? null) as string | null,
    obraNome: (r.obra_nome ?? null) as string | null,
    responsavel: (r.responsavel_nome ?? null) as string | null,
    depreciacao: {
      mensal: dep.mensal / 100,
      acumulada: dep.acumulada / 100,
      contabil: dep.contabil / 100,
      mesesUsados: dep.mesesUsados,
    },
  };
}

export function rotasPatrimonio(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.addHook('preHandler', exigir(banco));

    /** Cadastro (criar e editar): dono e gestor. */
    const exigirCadastro = (req: FastifyRequest) => {
      const u = req.usuario!;
      if (!(u.administrador || u.perfil === 'dono' || u.perfil === 'gestor')) throw semPermissao();
    };

    /** Obra onde o usuário pode retirar e devolver: dono e gestor, todas; os demais, só as atribuídas a eles. */
    const conferirObra = async (req: FastifyRequest, c: Cliente | Banco, empresaId: string, obraId: string) => {
      const obras = await obrasPermitidas(c, empresaId, req.usuario);
      if (obras && !obras.includes(obraId)) throw semPermissao();
      const o = (await c.query('SELECT id FROM obras WHERE id = $1 AND empresa_id = $2 AND ativo', [obraId, empresaId])).rows[0];
      if (!o) throw naoEncontrado('Obra');
    };

    app.get('/patrimonio', async (req) => {
      const empresaId = empresaDo(req);
      const hoje = hojeBrasil();
      const r = await banco.query(
        `SELECT p.*, o.codigo AS obra_codigo, o.nome AS obra_nome FROM patrimonio p LEFT JOIN obras o ON o.id = p.obra_id
          WHERE p.empresa_id = $1 AND p.excluido_em IS NULL ORDER BY p.status = 'baixado', p.codigo`,
        [empresaId],
      );
      return { bens: r.rows.map((x) => bemPublico(x, hoje)) };
    });

    app.get<{ Params: { id: string } }>('/patrimonio/:id', async (req) => {
      const empresaId = empresaDo(req);
      if (!UUID.test(req.params.id)) throw naoEncontrado('Bem');
      const r = await banco.query(
        `SELECT p.*, o.codigo AS obra_codigo, o.nome AS obra_nome FROM patrimonio p LEFT JOIN obras o ON o.id = p.obra_id
          WHERE p.id = $1 AND p.empresa_id = $2 AND p.excluido_em IS NULL`,
        [req.params.id, empresaId],
      );
      if (!r.rows[0]) throw naoEncontrado('Bem');
      const mov = await banco.query(
        `SELECT m.tipo, m.data, m.responsavel, m.estado, m.observacao, o.codigo AS obra_codigo, o.nome AS obra_nome, u.nome AS registrado_por
           FROM patrimonio_movimentos m JOIN obras o ON o.id = m.obra_id LEFT JOIN usuarios u ON u.id = m.registrado_por_id
          WHERE m.patrimonio_id = $1 ORDER BY m.criado_em DESC LIMIT 100`,
        [req.params.id],
      );
      return {
        bem: bemPublico(r.rows[0], hojeBrasil()),
        movimentos: mov.rows.map((m) => ({
          tipo: m.tipo as string,
          data: String(m.data).slice(0, 10),
          responsavel: (m.responsavel ?? null) as string | null,
          estado: (m.estado ?? null) as string | null,
          observacao: (m.observacao ?? null) as string | null,
          obra: `${m.obra_codigo} · ${m.obra_nome}`,
          registradoPor: (m.registrado_por ?? null) as string | null,
        })),
      };
    });

    app.post('/patrimonio', async (req, reply) => {
      exigirCadastro(req);
      const d = esquemaBem.parse(req.body);
      if (d.valorResidual >= d.valorAquisicao) throw new ErroHttp(400, 'O valor residual precisa ser menor que o valor de aquisição.');
      const empresaId = empresaDo(req);
      const usuarioId = req.usuario!.id;
      const id = await emTransacao(banco, async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`patrimonio:${empresaId}`]);
        const cod = (await c.query(`SELECT 'PAT-' || lpad((coalesce(max(substring(codigo FROM '^PAT-([0-9]+)$')::int), 0) + 1)::text, 4, '0') AS codigo FROM patrimonio WHERE empresa_id = $1`, [empresaId])).rows[0].codigo as string;
        const b = (
          await c.query(
            `INSERT INTO patrimonio (empresa_id, codigo, nome, marca, serie, data_aquisicao, valor_aquisicao_centavos, valor_residual_centavos, vida_util_meses)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, codigo`,
            [empresaId, cod, d.nome, d.marca, d.serie, d.dataAquisicao, d.valorAquisicao, d.valorResidual, d.vidaUtilMeses],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId, acao: 'criar', entidade: 'patrimonio', entidadeId: b.id, depois: { codigo: b.codigo, nome: d.nome } });
        return b.id as string;
      });
      reply.code(201);
      const r = await banco.query('SELECT p.*, NULL AS obra_codigo, NULL AS obra_nome FROM patrimonio p WHERE p.id = $1', [id]);
      return { bem: bemPublico(r.rows[0], hojeBrasil()) };
    });

    app.put<{ Params: { id: string } }>('/patrimonio/:id', async (req) => {
      exigirCadastro(req);
      const d = esquemaBem.parse(req.body);
      if (d.valorResidual >= d.valorAquisicao) throw new ErroHttp(400, 'O valor residual precisa ser menor que o valor de aquisição.');
      const empresaId = empresaDo(req);
      if (!UUID.test(req.params.id)) throw naoEncontrado('Bem');
      await emTransacao(banco, async (c) => {
        const atual = (await c.query('SELECT id FROM patrimonio WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL FOR UPDATE', [req.params.id, empresaId])).rows[0];
        if (!atual) throw naoEncontrado('Bem');
        await c.query(
          `UPDATE patrimonio SET nome = $2, marca = $3, serie = $4, data_aquisicao = $5, valor_aquisicao_centavos = $6,
                  valor_residual_centavos = $7, vida_util_meses = $8, atualizado_em = now()
            WHERE id = $1`,
          [req.params.id, d.nome, d.marca, d.serie, d.dataAquisicao, d.valorAquisicao, d.valorResidual, d.vidaUtilMeses],
        );
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'patrimonio', entidadeId: req.params.id, depois: { nome: d.nome } });
      });
      const r = await banco.query(
        `SELECT p.*, o.codigo AS obra_codigo, o.nome AS obra_nome FROM patrimonio p LEFT JOIN obras o ON o.id = p.obra_id WHERE p.id = $1`,
        [req.params.id],
      );
      return { bem: bemPublico(r.rows[0], hojeBrasil()) };
    });

    /** Situação do bem fora de uso (disponível, em manutenção ou baixado). Quem está com o bem numa obra precisa devolvê-lo antes. */
    app.post<{ Params: { id: string } }>('/patrimonio/:id/situacao', async (req) => {
      exigirCadastro(req);
      const d = z.object({ status: z.enum(['disponivel', 'manutencao', 'baixado']) }).parse(req.body);
      const empresaId = empresaDo(req);
      if (!UUID.test(req.params.id)) throw naoEncontrado('Bem');
      await emTransacao(banco, async (c) => {
        const b = (await c.query('SELECT id, status FROM patrimonio WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL FOR UPDATE', [req.params.id, empresaId])).rows[0];
        if (!b) throw naoEncontrado('Bem');
        if (b.status === 'em_uso') throw new ErroHttp(409, 'Este bem está em uso numa obra. Devolva antes de mudar a situação.');
        await c.query('UPDATE patrimonio SET status = $2, atualizado_em = now() WHERE id = $1', [b.id, d.status]);
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'patrimonio', entidadeId: b.id, depois: { situacao: d.status } });
      });
      return { ok: true };
    });

    app.post<{ Params: { id: string } }>('/patrimonio/:id/retirar', async (req) => {
      const d = esquemaRetirada.parse(req.body);
      const empresaId = empresaDo(req);
      if (!UUID.test(req.params.id)) throw naoEncontrado('Bem');
      const hoje = hojeBrasil();
      await emTransacao(banco, async (c) => {
        const b = (await c.query("SELECT id, status FROM patrimonio WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL FOR UPDATE", [req.params.id, empresaId])).rows[0];
        if (!b) throw naoEncontrado('Bem');
        if (b.status !== 'disponivel') throw new ErroHttp(409, b.status === 'em_uso' ? 'Este bem já está em uso numa obra. Devolva antes de retirar de novo.' : 'Este bem não está disponível para retirada.');
        await conferirObra(req, c, empresaId, d.obraId);
        await c.query("UPDATE patrimonio SET status = 'em_uso', obra_id = $2, responsavel_nome = $3, atualizado_em = now() WHERE id = $1", [b.id, d.obraId, d.responsavel]);
        await c.query(
          `INSERT INTO patrimonio_movimentos (empresa_id, patrimonio_id, tipo, obra_id, responsavel, observacao, data, registrado_por_id)
           VALUES ($1,$2,'retirada',$3,$4,$5,$6,$7)`,
          [empresaId, b.id, d.obraId, d.responsavel, d.observacao, hoje, req.usuario!.id],
        );
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'patrimonio', entidadeId: b.id, depois: { retirada: d.obraId, responsavel: d.responsavel } });
      });
      return { ok: true };
    });

    app.post<{ Params: { id: string } }>('/patrimonio/:id/devolver', async (req) => {
      const d = esquemaDevolucao.parse(req.body ?? {});
      const empresaId = empresaDo(req);
      if (!UUID.test(req.params.id)) throw naoEncontrado('Bem');
      const hoje = hojeBrasil();
      await emTransacao(banco, async (c) => {
        const b = (await c.query("SELECT id, status, obra_id, responsavel_nome FROM patrimonio WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL FOR UPDATE", [req.params.id, empresaId])).rows[0];
        if (!b) throw naoEncontrado('Bem');
        if (b.status !== 'em_uso') throw new ErroHttp(409, 'Este bem não está em uso numa obra.');
        await conferirObra(req, c, empresaId, b.obra_id);
        await c.query("UPDATE patrimonio SET status = $2, obra_id = NULL, responsavel_nome = NULL, atualizado_em = now() WHERE id = $1", [b.id, d.estado]);
        await c.query(
          `INSERT INTO patrimonio_movimentos (empresa_id, patrimonio_id, tipo, obra_id, responsavel, estado, observacao, data, registrado_por_id)
           VALUES ($1,$2,'devolucao',$3,$4,$5,$6,$7,$8)`,
          [empresaId, b.id, b.obra_id, b.responsavel_nome, d.estado, d.observacao, hoje, req.usuario!.id],
        );
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'patrimonio', entidadeId: b.id, depois: { devolucao: d.estado } });
      });
      return { ok: true };
    });
  };
}
