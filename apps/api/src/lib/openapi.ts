// Documentação da API: registra o @fastify/swagger e converte os esquemas zod das rotas em JSON Schema.
// Só é carregado por scripts/gerar-openapi.ts (criarApp com `documentar: true`); a API em produção não o usa.
import type { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import type { ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/** Esquema zod do corpo → JSON Schema do que o cliente ENVIA (antes das transformações do zod). */
export function corpoParaJsonSchema(esquema: ZodTypeAny): Record<string, unknown> {
  const { $schema: _ignorado, ...resto } = zodToJsonSchema(esquema, { target: 'openApi3', $refStrategy: 'none', effectStrategy: 'input', pipeStrategy: 'input' }) as Record<string, unknown>;
  return resto;
}

const ehZod = (v: unknown): v is ZodTypeAny => !!v && typeof (v as { safeParse?: unknown }).safeParse === 'function';

export async function instalarDocumentacao(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: { title: 'Agrega Construtoras — API', version: '0' },
      components: {
        securitySchemes: {
          servidorMcp: { type: 'apiKey', in: 'header', name: 'X-MCP-Secret', description: 'Segredo compartilhado entre o servidor MCP e a API (MCP_API_SECRET). Só para as rotas de troca e renovação do OAuth.' },
          sessao: { type: 'apiKey', in: 'cookie', name: 'agrega_sessao', description: 'Cookie de sessão devolvido por POST /api/auth/entrar (validade de 12 horas).' },
        },
      },
    },
    transform: ({ schema, url }) => {
      const s: Record<string, unknown> = { ...(schema ?? {}) };
      // Só a API é documentada: as telas (arquivos estáticos) ficam de fora.
      if (!url.startsWith('/api/')) s.hide = true;
      if (ehZod(s.body)) s.body = corpoParaJsonSchema(s.body);
      return { schema: s, url };
    },
  });
}
