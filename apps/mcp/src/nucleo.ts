// Núcleo do servidor MCP: cria o `Server`, lista as ferramentas e despacha as chamadas.
// Portado de server-core.ts do servidor MCP do AIRO, sem os perfis de exposição e os recursos (o catálogo aqui é pequeno).
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { anotacoesDaFerramenta } from './lib/anotacoes.ts';
import { ClienteApi } from './lib/cliente-api.ts';
import { ferramentas } from './ferramentas/index.ts';

export const API_BASE_URL = (process.env.API_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

export function createApiClient(token?: string): ClienteApi {
  return new ClienteApi(API_BASE_URL, token);
}

/**
 * Normaliza o JSON Schema gerado pelo zod-to-json-schema para o draft 2020-12 que a API do Claude exige:
 * `exclusiveMinimum/Maximum` booleanos viram numéricos, `nullable: true` vira `type: [..., "null"]`,
 * e saem `$schema` e `additionalProperties: false` (a validação estrita continua no zod, aqui no servidor).
 */
function sanitizeJsonSchema<T>(node: T): T {
  if (Array.isArray(node)) return node.map((item) => sanitizeJsonSchema(item)) as unknown as T;
  if (node === null || typeof node !== 'object') return node;

  const obj = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'exclusiveMinimum' && typeof value === 'boolean') {
      if (value === true && typeof obj.minimum === 'number') out.exclusiveMinimum = obj.minimum;
      else if (value === false && typeof obj.minimum === 'number') out.minimum = obj.minimum;
      continue;
    }
    if (key === 'exclusiveMaximum' && typeof value === 'boolean') {
      if (value === true && typeof obj.maximum === 'number') out.exclusiveMaximum = obj.maximum;
      else if (value === false && typeof obj.maximum === 'number') out.maximum = obj.maximum;
      continue;
    }
    if (key === 'minimum' && obj.exclusiveMinimum === true) continue;
    if (key === 'maximum' && obj.exclusiveMaximum === true) continue;
    if (key === 'nullable') {
      if (value === true) {
        const t = obj.type;
        if (typeof t === 'string') out.type = [t, 'null'];
        else if (Array.isArray(t) && !t.includes('null')) out.type = [...t, 'null'];
      }
      continue;
    }
    if (key === '$schema') continue;
    if (key === 'additionalProperties' && value === false) continue;
    out[key] = sanitizeJsonSchema(value);
  }
  return out as unknown as T;
}

// O catálogo é estático: os esquemas zod são convertidos uma vez.
let listaEmCache: unknown[] | null = null;

export function listaDeFerramentas(): unknown[] {
  listaEmCache ??= Object.values(ferramentas).map((f) => ({
    name: f.name,
    description: f.description,
    inputSchema: sanitizeJsonSchema(zodToJsonSchema(f.inputSchema, { target: 'jsonSchema7', $refStrategy: 'none' })) as Record<string, unknown>,
    annotations: anotacoesDaFerramenta(f.name),
  }));
  return listaEmCache;
}

/** Cria um servidor MCP ligado ao cliente da API da sessão (o transporte troca o token dele quando o OAuth renova). */
export function createMcpServer(api: ClienteApi): Server {
  const server = new Server(
    { name: 'mcp-agrega', version: '0.1.0' },
    {
      capabilities: { tools: {} },
      instructions:
        'Agrega é um ERP para construtoras. As ferramentas agem em nome do usuário que autorizou a conexão, dentro da construtora dele e com as permissões do perfil dele. Dinheiro vai em reais (número), datas em AAAA-MM-DD e identificadores são UUID. Antes de criar ou alterar algo, confirme os dados com o usuário.',
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listaDeFerramentas() as never }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const f = ferramentas[request.params.name];
    if (!f) throw new Error(`Ferramenta não encontrada: ${request.params.name}`);
    try {
      const args = f.inputSchema.parse(request.params.arguments ?? {});
      if (!api.isAuthenticated()) throw new Error('Autenticação necessária. Conecte de novo pelo OAuth.');
      const resultado = await f.handler(args, api);
      return { content: [{ type: 'text', text: JSON.stringify(resultado) }] };
    } catch (error: any) {
      // A mensagem da API já vem em português e diz o que fazer; o status separa regra de negócio (400/409) de permissão (403).
      const mensagem = error?.name === 'ZodError' ? `Argumentos inválidos: ${error.issues.map((i: { path: unknown[]; message: string }) => `${i.path.join('.') || '(raiz)'}: ${i.message}`).join('; ')}` : error?.message || 'Erro desconhecido';
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: error?.statusCode ? `[HTTP ${error.statusCode}] ${mensagem}` : mensagem,
              ...(error?.statusCode && { statusCode: error.statusCode }),
              ...(error?.campos && { campos: error.campos }),
            }),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

export function getServerInfo() {
  return { apiBaseUrl: API_BASE_URL, toolsCount: Object.keys(ferramentas).length };
}
