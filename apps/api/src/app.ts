import { existsSync } from 'node:fs';
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
import { rotasEmpresa } from './rotas/empresa.ts';
import { rotasUsuarios } from './rotas/usuarios.ts';
import { rotasAdmin } from './rotas/admin.ts';
import { rotasFrota } from './rotas/frota.ts';

const VERSAO = '0.2.0';
const PASTA_WEB = path.resolve(import.meta.dirname, '..', '..', 'web', 'dist');

export async function criarApp(banco: Banco, opcoes: { log?: boolean } = {}) {
  const app = Fastify({ logger: opcoes.log ?? true, trustProxy: true, bodyLimit: 2 * 1024 * 1024 });

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  instalarSessao(app);

  app.setErrorHandler((erro: FastifyError | Error, req, reply) => {
    if (erro instanceof ZodError) {
      const primeiro = erro.issues[0];
      return reply.code(400).send({ erro: primeiro?.message ?? 'Dados inválidos.', campos: erro.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message })) });
    }
    if (erro instanceof ErroHttp) return reply.code(erro.status).send({ erro: erro.message });
    const e = erro as FastifyError & { code?: string };
    if (e.code === '23505') return reply.code(409).send({ erro: 'Já existe um cadastro com esses dados (e-mail ou CNPJ).' });
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
  await app.register(rotasFrota(banco), { prefix: '/api/frota' });

  // Telas (app React já compilado). Qualquer rota que não seja /api cai no index.html.
  const temWeb = existsSync(path.join(PASTA_WEB, 'index.html'));
  if (temWeb) {
    await app.register(fastifyStatic, { root: PASTA_WEB, prefix: '/', wildcard: false });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || !temWeb || req.method !== 'GET') {
      return reply.code(404).send({ erro: 'Endereço não encontrado.' });
    }
    return reply.sendFile('index.html');
  });

  return app;
}
