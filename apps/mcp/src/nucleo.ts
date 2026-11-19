// Núcleo do servidor MCP: cria o `Server`, lista as ferramentas e despacha as chamadas.
// Portado de server-core.ts do servidor MCP do AIRO, sem os perfis de exposição e os recursos (o catálogo aqui é pequeno).
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { anotacoesDaFerramenta } from './lib/anotacoes.ts';
import { ClienteApi } from './lib/cliente-api.ts';
import { AREAS, areaDaFerramenta, ferramentas, type Area } from './ferramentas/index.ts';

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

/** Lê `?grupos=engenharia,financeiro` (ou `todas`). Vazio ou inválido: todas as áreas, como antes. */
export function areasDoParametro(valor: unknown): Set<Area> {
  const pedidas = String(valor ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const validas = pedidas.filter((x): x is Area => (AREAS as readonly string[]).includes(x));
  if (!validas.length || pedidas.includes('todas')) return new Set(AREAS);
  return new Set<Area>(['conta', ...validas]);
}

/** Ferramenta fixa: liga uma área do catálogo nesta conexão (o cliente recebe o aviso de lista alterada). */
const HABILITAR_AREA = {
  name: 'habilitar_area',
  description: `Liga mais uma área de ferramentas nesta conexão, quando ela foi aberta com só algumas (endereço com ?grupos=). Áreas: ${AREAS.join(', ')}. Depois de ligar, as ferramentas da área aparecem na lista.`,
  inputSchema: { type: 'object', properties: { area: { type: 'string', enum: [...AREAS], description: 'Área a ligar.' } }, required: ['area'] },
};

/** Cria um servidor MCP ligado ao cliente da API da sessão (o transporte troca o token dele quando o OAuth renova). */
export function createMcpServer(api: ClienteApi, areas: Set<Area> = new Set(AREAS)): Server {
  const server = new Server(
    { name: 'mcp-agrega', version: '0.1.0' },
    {
      capabilities: { tools: { listChanged: true } },
      instructions:
        'Agrega é um ERP para construtoras. As ferramentas agem em nome do usuário que autorizou a conexão, dentro da construtora dele e com as permissões do perfil dele. Dinheiro vai em reais (número), datas em AAAA-MM-DD e identificadores são UUID. Antes de criar ou alterar algo, confirme os dados com o usuário.',
    },
  );

  // Catálogo da conexão: as áreas pedidas, mais habilitar_area quando nem todas estão ligadas (P37: o catálogo
  // inteiro pesa uns 170 KB, enviados a cada conexão).
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const lista = (listaDeFerramentas() as { name: string }[]).filter((t) => areas.has(areaDaFerramenta[t.name]));
    return { tools: (areas.size < AREAS.length ? [HABILITAR_AREA, ...lista] : lista) as never };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === 'habilitar_area') {
      const area = String((request.params.arguments as { area?: unknown } | undefined)?.area ?? '') as Area;
      if (!(AREAS as readonly string[]).includes(area)) return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Área desconhecida. Use: ${AREAS.join(', ')}.` }) }], isError: true };
      areas.add(area);
      await server.sendToolListChanged().catch(() => {});
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, data: { area, areasLigadas: [...areas] } }) }] };
    }
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
