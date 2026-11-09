import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Banco, Cliente } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { esquemaAlterarUsuario, esquemaNovoUsuario } from '../esquemas.ts';
import { usuarioPublico } from '../formatos.ts';
import { ErroHttp, naoEncontrado, semPermissao } from '../lib/erros.ts';
import { MODULOS_PADRAO } from '../lib/modulos.ts';
import { limitesVigentes, SQL_EM_TESTE } from '../lib/teste.ts';
import { PERFIS_EMPRESA, podeGerenciarPerfil } from '../lib/perfis.ts';
import { gerarHashSenha } from '../lib/senha.ts';
import type { Perfil } from '../lib/token.ts';
import { empresaDo, exigir } from '../sessao.ts';

/** Só administradores (o dono sempre é) cadastram usuários e definem os acessos. */
function exigirAdministrador(req: FastifyRequest) {
  if (!req.usuario?.administrador) throw new ErroHttp(403, 'Só administradores cadastram usuários e definem os acessos.');
}

/** Lista igual ao padrão do perfil vira null (segue o padrão se o padrão mudar). */
/** Módulos do contrato da empresa (undefined = sem empresa, todos valem). */
async function modulosDaEmpresa(banco: Banco, empresaId: string): Promise<string[] | undefined> {
  return (await banco.query('SELECT modulos_contratados FROM empresas WHERE id = $1', [empresaId])).rows[0]?.modulos_contratados;
}

/** Confere o limite de usuários ativos do contrato antes de ativar mais um. */
async function limiteUsuarios(c: Cliente, empresaId: string) {
  const e = (await c.query(`SELECT limite_usuarios, ${SQL_EM_TESTE} AS em_teste FROM empresas WHERE id = $1 FOR UPDATE`, [empresaId])).rows[0];
  const lim = limitesVigentes({ limite_obras: null, limite_usuarios: e?.limite_usuarios ?? null, em_teste: !!e?.em_teste });
  if (!lim.usuarios) return;
  const n = (await c.query('SELECT count(*)::int AS n FROM usuarios WHERE empresa_id = $1 AND ativo AND excluido_em IS NULL', [empresaId])).rows[0].n;
  if (n >= lim.usuarios) throw new ErroHttp(403, lim.emTeste ? `Durante o período de teste, a construtora pode ter até ${lim.usuarios} usuários ativos. Para mais pessoas, contrate um plano.` : `Seu contrato permite até ${lim.usuarios} usuários ativos. Desative um usuário ou amplie o contrato.`);
}

/** Durante o período de teste, cada perfil tem no máximo um usuário ativo (ignorarId: o próprio usuário, na troca de perfil). */
async function perfilLivreNoTeste(c: Cliente, empresaId: string, perfil: Perfil, ignorarId?: string) {
  const e = (await c.query(`SELECT ${SQL_EM_TESTE} AS em_teste FROM empresas WHERE id = $1`, [empresaId])).rows[0];
  if (!e?.em_teste) return;
  const ocupado = (
    await c.query(
      `SELECT nome FROM usuarios WHERE empresa_id = $1 AND perfil = $2 AND ativo AND excluido_em IS NULL AND ($3::uuid IS NULL OR id <> $3::uuid) LIMIT 1`,
      [empresaId, perfil, ignorarId ?? null],
    )
  ).rows[0];
  if (ocupado) throw new ErroHttp(403, `Durante o período de teste, cada perfil tem um único usuário ativo. O perfil ${perfil} já é usado por ${ocupado.nome}.`);
}

function normalizarModulos(perfil: Perfil, modulos: string[] | null | undefined) {
  if (modulos === undefined) return undefined;
  if (modulos === null || perfil === 'dono') return null;
  const padrao = [...MODULOS_PADRAO[perfil]].sort().join(',');
  const lista = [...new Set(modulos)].sort();
  return lista.join(',') === padrao ? null : lista;
}

export function rotasUsuarios(banco: Banco) {
  return async function (app: FastifyInstance) {
    app.get('/', { preHandler: exigir(banco, ...PERFIS_EMPRESA) }, async (req) => {
      if (!req.usuario!.administrador && !['dono', 'gestor'].includes(req.usuario!.perfil)) throw semPermissao();
      const r = await banco.query(
        `SELECT * FROM usuarios WHERE empresa_id = $1 AND excluido_em IS NULL
          ORDER BY ativo DESC, array_position(ARRAY['dono','gestor','orcamentista','engenheiro_obra','comprador','financeiro','administrativo','vendedor','almoxarife','operador_usina','laboratorista','motorista']::perfil[], perfil), nome`,
        [empresaDo(req)],
      );
      const contratados = (await banco.query('SELECT modulos_contratados FROM empresas WHERE id = $1', [empresaDo(req)])).rows[0]?.modulos_contratados;
      return { usuarios: r.rows.map((u) => usuarioPublico(u, contratados)), padrao: MODULOS_PADRAO };
    });

    app.post('/', { preHandler: exigir(banco, ...PERFIS_EMPRESA) }, async (req, reply) => {
      exigirAdministrador(req);
      const d = esquemaNovoUsuario.parse(req.body);
      if (!podeGerenciarPerfil(req.usuario!.perfil, d.perfil)) throw semPermissao();
      const empresaId = empresaDo(req);
      const hash = await gerarHashSenha(d.senha);
      const novo = await emTransacao(banco, async (c) => {
        await limiteUsuarios(c, empresaId);
        await perfilLivreNoTeste(c, empresaId, d.perfil);
        const u = (
          await c.query(
            `INSERT INTO usuarios (empresa_id, nome, email, senha_hash, perfil, telefone_whatsapp, administrador, modulos, senha_provisoria)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true) RETURNING *`,
            [empresaId, d.nome, d.email, hash, d.perfil, d.telefoneWhatsapp, d.perfil === 'dono' || d.administrador, normalizarModulos(d.perfil, d.modulos) ?? null],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'usuarios', entidadeId: u.id, depois: u });
        return u;
      });
      reply.code(201);
      return { usuario: usuarioPublico(novo, await modulosDaEmpresa(banco, empresaId)) };
    });

    app.patch<{ Params: { id: string } }>('/:id', { preHandler: exigir(banco, ...PERFIS_EMPRESA) }, async (req) => {
      exigirAdministrador(req);
      const d = esquemaAlterarUsuario.parse(req.body);
      const empresaId = empresaDo(req);
      const eu = req.usuario!;
      const atualizado = await emTransacao(banco, async (c) => {
        const antes = (
          await c.query('SELECT * FROM usuarios WHERE id = $1 AND empresa_id = $2 AND excluido_em IS NULL FOR UPDATE', [req.params.id, empresaId])
        ).rows[0];
        if (!antes) throw naoEncontrado('Usuário');
        if (d.ativo === true && !antes.ativo) {
          await limiteUsuarios(c, empresaId);
          await perfilLivreNoTeste(c, empresaId, d.perfil ?? antes.perfil, antes.id);
        }
        if (antes.ativo && d.perfil && d.perfil !== antes.perfil) await perfilLivreNoTeste(c, empresaId, d.perfil, antes.id);
        if (!podeGerenciarPerfil(eu.perfil, antes.perfil)) throw semPermissao();
        if (d.perfil && !podeGerenciarPerfil(eu.perfil, d.perfil)) throw semPermissao();
        if (antes.id === eu.id && ((d.perfil && d.perfil !== antes.perfil) || d.ativo === false || d.administrador === false || d.modulos !== undefined)) {
          throw new ErroHttp(400, 'Você não pode mudar o próprio perfil, acesso ou módulos.');
        }
        const deixaDeSerDono = antes.perfil === 'dono' && ((d.perfil && d.perfil !== 'dono') || d.ativo === false);
        if (deixaDeSerDono) {
          const donos = await c.query(
            `SELECT count(*)::int AS n FROM usuarios WHERE empresa_id = $1 AND perfil = 'dono' AND ativo AND excluido_em IS NULL`,
            [empresaId],
          );
          if (donos.rows[0].n <= 1) throw new ErroHttp(400, 'A empresa precisa ter pelo menos um dono ativo.');
        }
        const perfilFinal: Perfil = d.perfil ?? antes.perfil;
        // Mudou o perfil sem mandar módulos: volta para o padrão do novo perfil.
        const modulos = d.modulos !== undefined ? normalizarModulos(perfilFinal, d.modulos) : d.perfil && d.perfil !== antes.perfil ? null : undefined;
        const administrador = perfilFinal === 'dono' ? true : d.administrador;
        const hash = d.senha ? await gerarHashSenha(d.senha) : null;
        const depois = (
          await c.query(
            `UPDATE usuarios SET
               nome = COALESCE($3, nome),
               perfil = COALESCE($4::perfil, perfil),
               ativo = COALESCE($5, ativo),
               telefone_whatsapp = CASE WHEN $6::boolean THEN $7 ELSE telefone_whatsapp END,
               senha_hash = COALESCE($8, senha_hash),
               senha_provisoria = CASE WHEN $12::boolean THEN true ELSE senha_provisoria END,
               administrador = COALESCE($9, administrador),
               modulos = CASE WHEN $10::boolean THEN $11::text[] ELSE modulos END,
               atualizado_em = now()
             WHERE id = $1 AND empresa_id = $2 RETURNING *`,
            [antes.id, empresaId, d.nome ?? null, d.perfil ?? null, d.ativo ?? null, 'telefoneWhatsapp' in (req.body as object), d.telefoneWhatsapp ?? null, hash,
              administrador ?? null, modulos !== undefined, modulos ?? null, !!hash && antes.id !== eu.id],
          )
        ).rows[0];
        await auditar(c, { empresaId, usuarioId: eu.id, acao: 'alterar', entidade: 'usuarios', entidadeId: antes.id, antes, depois });
        return depois;
      });
      return { usuario: usuarioPublico(atualizado, await modulosDaEmpresa(banco, empresaId)) };
    });
  };
}
