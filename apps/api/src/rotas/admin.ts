// Área do administrador do sistema (você): cadastro das construtoras clientes.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import type { Banco } from '../db.ts';
import { emTransacao } from '../db.ts';
import { auditar } from '../auditoria.ts';
import { esquemaContrato, esquemaNovaEmpresa } from '../esquemas.ts';
import { empresaPublica } from '../formatos.ts';
import { contratoComBase } from '../lib/modulos.ts';
import { PACOTES } from '../lib/pacotes.ts';
import { ErroHttp, naoEncontrado } from '../lib/erros.ts';
import { gerarHashSenha } from '../lib/senha.ts';
import { aplicarCondicoes, CONDICOES_PADRAO, indicacaoContrato, lerCondicoes, preencherProposta } from '../lib/proposta-interessado.ts';
import { preencherApresentacao } from '../lib/apresentacao-teste.ts';
import { exigir } from '../sessao.ts';
import { limitesVigentes, SQL_EM_TESTE } from '../lib/teste.ts';
import { criarAceite } from '../lib/aceite.ts';

export function rotasAdmin(banco: Banco) {
  return async function (app: FastifyInstance) {
    // Material publicitário: só o administrador do sistema lê estes modelos (os arquivos ficam fora da área pública).
    const PASTA_MATERIAL = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'material');
    const MATERIAIS: Record<string, string> = {
      'proposta-comercial.html': 'text/html; charset=utf-8',
      'banner-piloto.html': 'text/html; charset=utf-8',
      'banner-saiba-mais.html': 'text/html; charset=utf-8',
      'material-detalhado.html': 'text/html; charset=utf-8',
      'banner-curso-orcamento.html': 'text/html; charset=utf-8',
      'banner-curso-whatsapp.html': 'text/html; charset=utf-8',
      'qr-banner-piloto.svg': 'image/svg+xml; charset=utf-8',
      'qr-banner-saiba-mais.svg': 'image/svg+xml; charset=utf-8',
      'qr-curso-orcamento.svg': 'image/svg+xml; charset=utf-8',
    };
    app.get<{ Params: { arquivo: string } }>('/material/:arquivo', { preHandler: exigir(banco, 'admin_sistema') }, async (req, reply) => {
      const tipo = MATERIAIS[req.params.arquivo];
      if (!tipo) throw naoEncontrado('Material');
      const bruto = await readFile(path.join(PASTA_MATERIAL, req.params.arquivo));
      // O modelo de proposta leva marcadores de condição: sem parâmetros, sai com os valores padrão.
      const conteudo = req.params.arquivo === 'proposta-comercial.html' ? Buffer.from(aplicarCondicoes(bruto.toString('utf8'))) : bruto;
      return reply
        .header('Content-Type', tipo)
        .header('Cache-Control', 'private, no-store')
        .header('X-Robots-Tag', 'noindex')
        .send(conteudo);
    });

    // Avisos não lidos para o administrador do sistema (ex.: empresa acima do limite de empreendimentos).
    app.get('/avisos', { preHandler: exigir(banco, 'admin_sistema') }, async () => {
      const r = await banco.query(
        `SELECT a.id, a.tipo, a.quantidade, a.mensagem, a.criado_em, e.razao_social
           FROM avisos_sistema a JOIN empresas e ON e.id = a.empresa_id
          WHERE a.lido_em IS NULL AND e.excluido_em IS NULL ORDER BY a.criado_em DESC`,
      );
      return { avisos: r.rows.map((a) => ({ id: a.id, tipo: a.tipo, quantidade: a.quantidade, mensagem: a.mensagem, criadoEm: a.criado_em, empresa: a.razao_social })) };
    });

    app.post<{ Params: { id: string } }>('/avisos/:id/lido', { preHandler: exigir(banco, 'admin_sistema') }, async (req) => {
      const r = await banco.query(`UPDATE avisos_sistema SET lido_em = coalesce(lido_em, now()) WHERE id = $1 RETURNING id`, [req.params.id]);
      if (!r.rows[0]) throw naoEncontrado('Aviso');
      return { ok: true };
    });

    app.get('/empresas', { preHandler: exigir(banco, 'admin_sistema') }, async () => {
      const r = await banco.query(
        `SELECT e.*, (SELECT count(*)::int FROM usuarios u WHERE u.empresa_id = e.id AND u.excluido_em IS NULL) AS total_usuarios
           FROM empresas e WHERE e.excluido_em IS NULL ORDER BY e.razao_social`,
      );
      return { empresas: r.rows.map((e) => ({ ...empresaPublica(e), totalUsuarios: e.total_usuarios })) };
    });

    // Apresentação para o período de testes, endereçada à construtora cadastrada (dono como responsável).
    app.get<{ Params: { id: string } }>('/empresas/:id/apresentacao', { preHandler: exigir(banco, 'admin_sistema') }, async (req, reply) => {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) throw naoEncontrado('Empresa');
      const e = (await banco.query('SELECT razao_social, nome_fantasia FROM empresas WHERE id = $1 AND excluido_em IS NULL', [req.params.id])).rows[0];
      if (!e) throw naoEncontrado('Empresa');
      const dono = (await banco.query(`SELECT nome FROM usuarios WHERE empresa_id = $1 AND perfil = 'dono' AND ativo AND excluido_em IS NULL ORDER BY criado_em LIMIT 1`, [req.params.id])).rows[0];
      const modelo = await readFile(path.join(PASTA_MATERIAL, 'apresentacao-teste.html'), 'utf8');
      const html = preencherApresentacao(modelo, { cliente: e.nome_fantasia || e.razao_social, responsavel: dono?.nome ?? null, cadastrado: true }, new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }), `${req.protocol}://${req.headers.host}`);
      return reply.header('Content-Type', 'text/html; charset=utf-8').header('Cache-Control', 'private, no-store').header('X-Robots-Tag', 'noindex').send(html);
    });

    // Acompanhamento das construtoras contratadas: usuários ativos e perfis em uso, obras ativas e período de teste.
    app.get('/acompanhamento', { preHandler: exigir(banco, 'admin_sistema') }, async () => {
      const r = await banco.query(
        `SELECT e.id, e.razao_social, e.nome_fantasia, e.contrato_pacote, e.limite_obras, e.limite_usuarios,
                to_char(e.teste_inicio, 'YYYY-MM-DD') AS teste_inicio_txt, to_char(e.teste_fim, 'YYYY-MM-DD') AS teste_fim_txt,
                ${SQL_EM_TESTE} AS em_teste,
                (e.teste_fim - (now() AT TIME ZONE 'America/Sao_Paulo')::date) AS dias_restantes,
                (SELECT count(*)::int FROM usuarios u WHERE u.empresa_id = e.id AND u.ativo AND u.excluido_em IS NULL) AS usuarios_ativos,
                (SELECT coalesce(array_agg(DISTINCT u.perfil::text ORDER BY u.perfil::text), '{}') FROM usuarios u WHERE u.empresa_id = e.id AND u.ativo AND u.excluido_em IS NULL) AS perfis_ativos,
                (SELECT count(*)::int FROM obras o WHERE o.empresa_id = e.id AND o.status <> 'concluida') AS obras_ativas
           FROM empresas e
          WHERE e.excluido_em IS NULL
          ORDER BY e.razao_social`,
      );
      const hoje = (await banco.query(`SELECT to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS hoje`)).rows[0].hoje;
      return {
        hoje,
        empresas: r.rows.map((e) => {
          const lim = limitesVigentes({ limite_obras: e.limite_obras ?? null, limite_usuarios: e.limite_usuarios ?? null, em_teste: !!e.em_teste });
          const situacao = e.em_teste
            ? 'em_teste'
            : e.teste_fim_txt
              ? e.teste_fim_txt < hoje ? 'teste_encerrado' : 'teste_agendado'
              : 'sem_teste';
          return {
            id: e.id,
            razaoSocial: e.razao_social,
            nomeFantasia: e.nome_fantasia ?? null,
            pacote: e.contrato_pacote,
            usuariosAtivos: e.usuarios_ativos,
            limiteUsuarios: lim.usuarios,
            perfisAtivos: e.perfis_ativos as string[],
            obrasAtivas: e.obras_ativas,
            limiteObras: lim.obras,
            situacaoTeste: situacao,
            testeInicio: e.teste_inicio_txt ?? null,
            testeFim: e.teste_fim_txt ?? null,
            diasRestantes: e.em_teste ? Number(e.dias_restantes) : null,
          };
        }),
      };
    });

    // Link de aceite do período de testes para uma construtora cadastrada. Quem aceita pelo link inicia o teste dela.
    app.post<{ Params: { id: string } }>('/empresas/:id/aceite', { preHandler: exigir(banco, 'admin_sistema') }, async (req, reply) => {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) throw naoEncontrado('Empresa');
      const e = (await banco.query('SELECT razao_social, nome_fantasia FROM empresas WHERE id = $1 AND excluido_em IS NULL', [req.params.id])).rows[0];
      if (!e) throw naoEncontrado('Empresa');
      const codigo = await criarAceite(banco, {
        empresaId: req.params.id,
        interessadoId: null,
        nomeCliente: e.nome_fantasia || e.razao_social,
        condicoes: CONDICOES_PADRAO,
        criadoPor: req.usuario!.id,
      });
      reply.code(201);
      return { url: `${req.protocol}://${req.headers.host}/aceite/${codigo}`, validadeDias: CONDICOES_PADRAO.validade, diasTeste: CONDICOES_PADRAO.diasTeste };
    });

    // Condições padrão da proposta: o painel usa para preencher o formulário de condições.
    app.get('/proposta/condicoes', { preHandler: exigir(banco, 'admin_sistema') }, async () => ({ padrao: CONDICOES_PADRAO }));

    // Proposta comercial de uma construtora já cadastrada: pacote e limites do contrato, dono como responsável.
    app.get<{ Params: { id: string } }>('/empresas/:id/proposta', { preHandler: exigir(banco, 'admin_sistema') }, async (req, reply) => {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) throw naoEncontrado('Empresa');
      let condicoes;
      try {
        condicoes = lerCondicoes(req.query as Record<string, unknown>);
      } catch (err) {
        throw new ErroHttp(400, (err as Error).message);
      }
      const e = (
        await banco.query(
          `SELECT razao_social, nome_fantasia, cnpj, contrato_pacote, limite_obras, limite_usuarios FROM empresas WHERE id = $1 AND excluido_em IS NULL`,
          [req.params.id],
        )
      ).rows[0];
      if (!e) throw naoEncontrado('Empresa');
      const dono = (
        await banco.query(
          `SELECT nome FROM usuarios WHERE empresa_id = $1 AND perfil = 'dono' AND ativo AND excluido_em IS NULL ORDER BY criado_em LIMIT 1`,
          [req.params.id],
        )
      ).rows[0];
      const quem = await banco.query('SELECT telefone_whatsapp FROM usuarios WHERE id = $1', [req.usuario!.id]);
      const modelo = await readFile(path.join(PASTA_MATERIAL, 'proposta-comercial.html'), 'utf8');
      const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      const html = preencherProposta(
        modelo,
        {
          empresa: e.nome_fantasia || e.razao_social,
          responsavel: dono?.nome ?? null,
          cnpj: e.cnpj ? String(e.cnpj).trim() : null,
          pacote: e.contrato_pacote,
          indicacao: indicacaoContrato(e.contrato_pacote, e.limite_obras ?? null, e.limite_usuarios ?? null),
        },
        { nome: req.usuario!.nome, email: req.usuario!.email ?? null, telefone: quem.rows[0]?.telefone_whatsapp ?? null, cnpj: null },
        hoje,
        condicoes,
      );
      return reply.header('Content-Type', 'text/html; charset=utf-8').header('Cache-Control', 'private, no-store').header('X-Robots-Tag', 'noindex').send(html);
    });

    // Contrato da construtora: pacote vendido, módulos liberados e limites de obras e usuários.
    app.put<{ Params: { id: string } }>('/empresas/:id/contrato', { preHandler: exigir(banco, 'admin_sistema') }, async (req) => {
      const d = esquemaContrato.parse(req.body);
      const modulos: string[] = d.pacote === 'personalizado' ? (d.modulos ?? []) : PACOTES[d.pacote].modulos;
      const empresa = await emTransacao(banco, async (c) => {
        const antes = (await c.query(`SELECT *, to_char(teste_inicio, 'YYYY-MM-DD') AS teste_inicio_txt, to_char(teste_fim, 'YYYY-MM-DD') AS teste_fim_txt, to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date, 'YYYY-MM-DD') AS hoje FROM empresas WHERE id = $1 AND excluido_em IS NULL FOR UPDATE`, [req.params.id])).rows[0];
        if (!antes) throw naoEncontrado('Empresa');
        // Período de teste: sem informar a data, o teste não muda. Ao mudar a data final, o teste começa hoje (horário de Brasília).
        let testeInicio: string | null = antes.teste_inicio_txt ?? null;
        let testeFim: string | null = antes.teste_fim_txt ?? null;
        if (d.testeFim !== undefined && d.testeFim !== testeFim) {
          if (d.testeFim === null) {
            testeInicio = null;
            testeFim = null;
          } else {
            if (d.testeFim < antes.hoje) throw new ErroHttp(400, 'A data final do teste precisa ser hoje ou depois.');
            testeInicio = antes.hoje;
            testeFim = d.testeFim;
          }
        }
        const depois = (
          await c.query(
            `UPDATE empresas SET contrato_pacote = $2, modulos_contratados = $3, limite_obras = $4, limite_usuarios = $5,
                    teste_inicio = $6, teste_fim = $7, atualizado_em = now()
              WHERE id = $1 RETURNING *, ${SQL_EM_TESTE} AS em_teste`,
            [antes.id, d.pacote, contratoComBase(modulos), d.limiteObras, d.limiteUsuarios, testeInicio, testeFim],
          )
        ).rows[0];
        await auditar(c, { empresaId: antes.id, usuarioId: req.usuario!.id, acao: 'alterar', entidade: 'empresas', entidadeId: antes.id, antes: { contrato: antes.modulos_contratados, limites: [antes.limite_obras, antes.limite_usuarios], teste: [antes.teste_inicio_txt ?? null, antes.teste_fim_txt ?? null] }, depois: { pacote: d.pacote, modulos: contratoComBase(modulos), limiteObras: d.limiteObras, limiteUsuarios: d.limiteUsuarios, teste: [testeInicio, testeFim] } });
        return depois;
      });
      return { empresa: empresaPublica(empresa) };
    });

    app.post('/empresas', { preHandler: exigir(banco, 'admin_sistema') }, async (req, reply) => {
      const d = esquemaNovaEmpresa.parse(req.body);
      const hash = await gerarHashSenha(d.dono.senha);
      const empresa = await emTransacao(banco, async (c) => {
        const e = (
          await c.query(
            `INSERT INTO empresas (razao_social, nome_fantasia, cnpj, regime_tributario, aliquotas_dre, telefone, email, cidade, uf,
                                   contrato_pacote, modulos_contratados, limite_obras, limite_usuarios)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'obra', $10, $11, $12) RETURNING *`,
            [d.razaoSocial, d.nomeFantasia, d.cnpj, d.regimeTributario, JSON.stringify(d.aliquotasDre), d.telefone, d.email ?? null, d.cidade, d.uf ?? null,
              contratoComBase(PACOTES.obra.modulos), PACOTES.obra.limiteObras, PACOTES.obra.limiteUsuarios],
          )
        ).rows[0];
        const dono = (
          await c.query(
            `INSERT INTO usuarios (empresa_id, nome, email, senha_hash, perfil) VALUES ($1, $2, $3, $4, 'dono') RETURNING id`,
            [e.id, d.dono.nome, d.dono.email, hash],
          )
        ).rows[0];
        await auditar(c, { empresaId: e.id, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'empresas', entidadeId: e.id, depois: e });
        await auditar(c, { empresaId: e.id, usuarioId: req.usuario!.id, acao: 'criar', entidade: 'usuarios', entidadeId: dono.id, depois: { nome: d.dono.nome, email: d.dono.email, perfil: 'dono' } });
        return e;
      });
      reply.code(201);
      return { empresa: empresaPublica(empresa) };
    });
  };
}
