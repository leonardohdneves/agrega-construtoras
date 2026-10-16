import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { config } from './config.ts';
import type { Banco } from './db.ts';
import { ErroHttp } from './lib/erros.ts';
import { instalarSessao } from './sessao.ts';
import { rotasAuth } from './rotas/auth.ts';
import { rotasDemo } from './rotas/demo.ts';
import { rotasProducao } from './rotas/producao.ts';
import { rotasEstoque } from './rotas/estoque.ts';
import { rotasQualidade } from './rotas/qualidade.ts';
import { rotasAprovacoes, rotasSuprimentos } from './rotas/suprimentos.ts';
import { rotasContratos } from './rotas/contratos.ts';
import { rotasComercial } from './rotas/comercial.ts';
import { rotasPropostas } from './rotas/propostas.ts';
import { rotasPropostasObra } from './rotas/propostasObra.ts';
import { rotasIncorporacao } from './rotas/incorporacao.ts';
import { rotasEngenharia } from './rotas/engenharia.ts';
import { rotasMural } from './rotas/mural.ts';
import { rotasInteresse } from './rotas/interesse.ts';
import { rotasProducaoEquipe } from './rotas/producao-equipe.ts';
import { rotasFinanceiro } from './rotas/financeiro.ts';
import { rotasNotas } from './rotas/notas.ts';
import { rotasConciliacao } from './rotas/conciliacao.ts';
import { rotasGerencial } from './rotas/gerencial.ts';
import { rotasRelatorios } from './rotas/relatorios.ts';
import { rotasEmpresa } from './rotas/empresa.ts';
import { rotasUsuarios } from './rotas/usuarios.ts';
import { rotasAdmin } from './rotas/admin.ts';
import { rotasFrota } from './rotas/frota.ts';
import { rotasAbastecimento } from './rotas/abastecimentos.ts';
import { rotasManutencao } from './rotas/manutencao.ts';
import { rotasAdministrativo } from './rotas/administrativo.ts';
import { rotasBackups, rotasExportacao } from './rotas/backups.ts';

const VERSAO = '0.9.0';
const PASTA_WEB = path.resolve(import.meta.dirname, '..', '..', 'web', 'dist');

export async function criarApp(banco: Banco, opcoes: { log?: boolean } = {}) {
  const app = Fastify({ logger: opcoes.log ?? true, trustProxy: true, bodyLimit: 2 * 1024 * 1024 });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  instalarSessao(app);

  // Versão das telas: o nome do pacote JS do build, que muda a cada deploy. Vai em toda resposta da API
  // para a tela aberta perceber que ficou desatualizada e pedir para recarregar.
  const temWeb = existsSync(path.join(PASTA_WEB, 'index.html'));
  const versaoWeb = temWeb ? (readFileSync(path.join(PASTA_WEB, 'index.html'), 'utf8').match(/\/assets\/(index-[^"']+\.js)/)?.[1] ?? '') : '';
  if (versaoWeb) {
    app.addHook('onSend', async (req, reply, payload) => {
      if (req.url.startsWith('/api/')) reply.header('x-versao-web', versaoWeb);
      return payload;
    });
  }

  app.setErrorHandler((erro: FastifyError | Error, req, reply) => {
    if (erro instanceof ZodError) {
      const primeiro = erro.issues[0];
      return reply.code(400).send({ erro: primeiro?.message ?? 'Dados inválidos.', campos: erro.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message })) });
    }
    if (erro instanceof ErroHttp) return reply.code(erro.status).send({ ...erro.dados, erro: erro.message });
    const e = erro as FastifyError & { code?: string };
    if (e.code === '23505') {
      const restricao = String((e as { constraint?: string }).constraint ?? '');
      const MSG: Record<string, string> = {
        usuarios_email_unico: 'Já existe um usuário com este e-mail.',
        empresas_cnpj_key: 'Já existe uma empresa com este CNPJ.',
        veiculos_codigo_unico: 'Já existe um veículo com este código.',
        veiculos_placa_unica: 'Já existe um veículo com esta placa.',
        fornecedores_documento_unico: 'Já existe um cadastro com este CNPJ/CPF.',
        usuarios_motorista_unico: 'Este login já está ligado a outro motorista.',
        clientes_documento_unico: 'Já existe um cliente com este CNPJ/CPF.',
        contas_financeiras_nome_unico: 'Já existe uma conta com este nome.',
        plano_contas_codigo_unico: 'Já existe uma categoria com este código.',
        centros_custo_nome_unico: 'Já existe um centro de custo com este nome.',
        notas_chave_unica: 'Esta nota (mesma chave de acesso) já foi lançada.',
      };
      return reply.code(409).send({ erro: MSG[restricao] ?? 'Já existe um cadastro com esses dados.' });
    }
    // Regras garantidas por gatilho no banco (ex.: orçamento só com serviços da obra): a mensagem já é a do usuário.
    if (e.code === '23514' && /^orcamento_/.test(String((e as { constraint?: string }).constraint ?? ''))) return reply.code(400).send({ erro: e.message });
    if (e.statusCode === 429) return reply.code(429).send({ erro: 'Muitas tentativas. Aguarde um minuto e tente de novo.' });
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ erro: e.message });
    req.log.error(erro);
    return reply.code(500).send({ erro: 'Erro inesperado. Tente de novo; se continuar, avise o suporte.' });
  });

  app.get('/api/saude', async () => {
    await banco.query('SELECT 1');
    return { ok: true, versao: VERSAO, ambiente: config.ambiente };
  });

  await app.register(rotasAuth(banco), { prefix: '/api/auth' });
  await app.register(rotasEmpresa(banco), { prefix: '/api/empresa' });
  await app.register(rotasUsuarios(banco), { prefix: '/api/usuarios' });
  await app.register(rotasAdmin(banco), { prefix: '/api/admin' });
  await app.register(rotasBackups(banco), { prefix: '/api/admin' });
  await app.register(rotasExportacao(banco), { prefix: '/api/empresa' });
  await app.register(rotasFrota(banco), { prefix: '/api/frota' });
  await app.register(rotasAbastecimento(banco), { prefix: '/api/frota' });
  await app.register(rotasManutencao(banco), { prefix: '/api/frota' });
  await app.register(rotasAdministrativo(banco), { prefix: '/api/adm' });
  await app.register(rotasFinanceiro(banco), { prefix: '/api/fin' });
  await app.register(rotasNotas(banco), { prefix: '/api/fin' });
  await app.register(rotasConciliacao(banco), { prefix: '/api/fin' });
  await app.register(rotasGerencial(banco), { prefix: '/api/ger' });
  await app.register(rotasRelatorios(banco), { prefix: '/api/rel' });
  await app.register(rotasProducao(banco), { prefix: '/api/prod' });
  await app.register(rotasEstoque(banco), { prefix: '/api/prod' });
  await app.register(rotasQualidade(banco), { prefix: '/api/qual' });
  await app.register(rotasSuprimentos(banco), { prefix: '/api/sup' });
  await app.register(rotasContratos(banco), { prefix: '/api/sup' });
  await app.register(rotasAprovacoes(banco), { prefix: '/api/ger' });
  await app.register(rotasProducaoEquipe(banco), { prefix: '/api/ger' });
  await app.register(rotasComercial(banco), { prefix: '/api/com' });
  await app.register(rotasPropostas(banco), { prefix: '/api/com' });
  await app.register(rotasPropostasObra(banco), { prefix: '/api/com' });
  await app.register(rotasIncorporacao(banco), { prefix: '/api/com' });
  await app.register(rotasEngenharia(banco), { prefix: '/api/eng' });
  await app.register(rotasMural(banco), { prefix: '/api/mural' });
  await app.register(rotasInteresse(banco), { prefix: '/api/interesse' });
  if (config.seedDemo) await app.register(rotasDemo(banco), { prefix: '/api/demo' });

  // Telas (app React já compilado). Qualquer rota que não seja /api cai no index.html.
  if (temWeb) {
    // index.html sempre revalidado (aponta para o build atual); pacotes com hash no nome podem ficar em cache.
    await app.register(fastifyStatic, {
      root: PASTA_WEB,
      prefix: '/',
      wildcard: false,
      cacheControl: false,
      setHeaders: (res, caminho) => {
        res.setHeader('Cache-Control', caminho.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || !temWeb || req.method !== 'GET') {
      return reply.code(404).send({ erro: 'Endereço não encontrado.' });
    }
    return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
  });

  return app;
}
