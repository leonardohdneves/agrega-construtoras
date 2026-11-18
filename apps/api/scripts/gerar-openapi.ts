// Gera a documentação da API a partir do próprio código: docs/openapi.json e docs/API.md.
//   npm run docs -w apps/api
// De onde vem cada informação:
//   - rotas e parâmetros de caminho: do Fastify (todas as rotas registradas em app.ts);
//   - corpo: do esquema zod ligado à rota em `schema.body`;
//   - resumo e parâmetros de consulta: do código-fonte da rota (comentário acima dela e uso de `req.query`);
//   - acesso por perfil: de requisições simuladas com cada perfil, passando pelos guardas reais.
// Não precisa de banco de dados.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { criarApp } from '../src/app.ts';
import { config } from '../src/config.ts';
import type { Banco } from '../src/db.ts';
import { MODULOS_RETIRADOS, NOMES_MODULO, moduloDaRota, type Modulo } from '../src/lib/modulos.ts';
import { NOMES_PERFIL, PERFIS_EMPRESA } from '../src/lib/perfis.ts';
import { criarToken, type Perfil } from '../src/lib/token.ts';
import { COOKIE_SESSAO } from '../src/sessao.ts';

const RAIZ = path.resolve(import.meta.dirname, '..');
const PASTA_ROTAS = path.join(RAIZ, 'src', 'rotas');
const PASTA_DOCS = path.join(RAIZ, 'docs');
const METODOS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const PERFIS_DOCUMENTADOS: Perfil[] = ['admin_sistema', ...PERFIS_EMPRESA];
const ID_EXEMPLO = '00000000-0000-4000-8000-000000000000';

type Operacao = {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  deprecated?: boolean;
  security?: unknown[];
  parameters?: { name: string; in: string; required?: boolean; schema?: unknown; description?: string }[];
  requestBody?: { content?: Record<string, { schema?: Record<string, unknown> }> };
  responses?: Record<string, unknown>;
  [extra: `x-${string}`]: unknown;
};
type Especificacao = { info: { version: string; description?: string }; tags?: { name: string; description?: string }[]; paths: Record<string, Record<string, Operacao>>; components: Record<string, Record<string, unknown>> };

// ---------- 1. O que o código-fonte diz de cada rota (resumo e parâmetros de consulta) ----------

type DoFonte = { resumo: string | null; consulta: { nome: string; obrigatorio: boolean }[]; arquivo: string; linha: number };

function prefixosDoApp(): Map<string, string[]> {
  const texto = readFileSync(path.join(RAIZ, 'src', 'app.ts'), 'utf8');
  const mapa = new Map<string, string[]>();
  for (const m of texto.matchAll(/app\.register\((rotas\w+)\(banco\),\s*\{\s*prefix:\s*'([^']+)'/g)) mapa.set(m[1], [...(mapa.get(m[1]) ?? []), m[2]]);
  return mapa;
}

function lerFontes(): Map<string, DoFonte> {
  const prefixos = prefixosDoApp();
  const saida = new Map<string, DoFonte>();
  for (const arquivo of readdirSync(PASTA_ROTAS).filter((f) => f.endsWith('.ts')).sort()) {
    const texto = readFileSync(path.join(PASTA_ROTAS, arquivo), 'utf8');
    const fonte = ts.createSourceFile(arquivo, texto, ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS);

    const visitar = (no: ts.Node, funcao: string | null) => {
      if (ts.isFunctionDeclaration(no) && no.name && /^rotas[A-Z]/.test(no.name.text)) funcao = no.name.text;
      if (
        funcao && ts.isCallExpression(no) && ts.isPropertyAccessExpression(no.expression) && ts.isIdentifier(no.expression.expression) &&
        no.expression.expression.text === 'app' && (METODOS as readonly string[]).includes(no.expression.name.text)
      ) {
        const [caminho] = no.arguments;
        const manipulador = no.arguments[no.arguments.length - 1];
        if (caminho && ts.isStringLiteralLike(caminho) && manipulador) {
          const consulta = new Map<string, boolean>();
          // a) tipo declarado: app.get<{ Querystring: { de?: string } }>(...)
          const generico = no.typeArguments?.[0];
          const membrosDe = (tipo: ts.TypeNode | undefined) => {
            if (!tipo || !ts.isTypeLiteralNode(tipo)) return;
            for (const m of tipo.members) if (ts.isPropertySignature(m) && m.name) consulta.set(m.name.getText().replace(/['"]/g, ''), !m.questionToken);
          };
          if (generico && ts.isTypeLiteralNode(generico)) {
            for (const m of generico.members) if (ts.isPropertySignature(m) && m.name.getText() === 'Querystring') membrosDe(m.type);
          }
          // b) uso no manipulador: `req.query as { ... }`, `req.query.nome`, `const q = req.query` + `q.nome` e `const { nome } = req.query`
          const apelidos = new Set<string>();
          const ehConsulta = (e: ts.Expression): boolean => (ts.isAsExpression(e) || ts.isParenthesizedExpression(e) ? ehConsulta(e.expression) : e.getText() === 'req.query');
          const buscar = (n: ts.Node) => {
            if (ts.isAsExpression(n) && n.expression.getText() === 'req.query') membrosDe(n.type);
            if (ts.isVariableDeclaration(n) && n.initializer && ehConsulta(n.initializer)) {
              if (ts.isIdentifier(n.name)) apelidos.add(n.name.text);
              else if (ts.isObjectBindingPattern(n.name)) for (const el of n.name.elements) { const nome = (el.propertyName ?? el.name).getText(); if (!consulta.has(nome)) consulta.set(nome, false); }
            }
            if (ts.isPropertyAccessExpression(n) && (n.expression.getText() === 'req.query' || (ts.isIdentifier(n.expression) && apelidos.has(n.expression.text))) && !consulta.has(n.name.text)) consulta.set(n.name.text, false);
            ts.forEachChild(n, buscar);
          };
          buscar(manipulador);
          // c) comentário logo acima da rota (faixas de seção `// ----- X -----` não contam)
          const instrucao = ts.isExpressionStatement(no.parent) ? no.parent : no;
          const linhasComentario = (ts.getLeadingCommentRanges(texto, instrucao.getFullStart()) ?? [])
            .map((c) => texto.slice(c.pos, c.end))
            .filter((c) => c.startsWith('//'))
            .map((c) => c.replace(/^\/\/\s?/, '').trim())
            .filter((c) => c && !/^[-=─]{3,}/.test(c));
          // só vale o bloco colado na rota: uma linha em branco antes dela separa o comentário
          const colado = /\n[ \t]*\/\/[^\n]*\r?\n[ \t]*$/.test(texto.slice(0, instrucao.getStart()));
          const resumo = colado && linhasComentario.length ? linhasComentario.join(' ') : null;
          const dados: DoFonte = {
            resumo,
            consulta: [...consulta].map(([nome, obrigatorio]) => ({ nome, obrigatorio })),
            arquivo: `src/rotas/${arquivo}`,
            linha: fonte.getLineAndCharacterOfPosition(no.getStart()).line + 1,
          };
          for (const prefixo of prefixos.get(funcao) ?? []) {
            const url = (prefixo + (caminho.text === '/' ? '' : caminho.text)).replace(/:(\w+)/g, '{$1}');
            saida.set(`${no.expression.name.text} ${url}`, dados);
          }
        }
      }
      ts.forEachChild(no, (filho) => visitar(filho, funcao));
    };
    visitar(fonte, null);
  }
  return saida;
}

// ---------- 2. Quem acessa cada rota: requisições simuladas com cada perfil ----------

/** Banco de mentira: responde só à consulta do guarda (`exigir`) e falha em qualquer outra, para o manipulador parar ali. */
function bancoDaSonda(): Banco {
  return {
    query: async (sql: string, valores?: unknown[]) => {
      if (!/FROM usuarios u LEFT JOIN empresas e/.test(String(sql))) throw new Error('sonda: a rota passou do guarda');
      const perfil = String(valores?.[0]) as Perfil;
      const semEmpresa = perfil === 'admin_sistema';
      return { rowCount: 1, rows: [{ id: perfil, nome: perfil, email: `${perfil}@sonda`, perfil, empresa_id: semEmpresa ? null : 'empresa', ativo: true, administrador: false, modulos: null, senha_provisoria: false, sessao_versao: 0, empresa_ativa: true, modulos_contratados: null }] };
    },
  } as unknown as Banco;
}

// ---------- 3. Montagem ----------

const ROTULO_FORA_DE_MODULO: [RegExp, string][] = [
  [/^\/api\/auth/, 'Autenticação'],
  [/^\/api\/empresa/, 'Empresa'],
  [/^\/api\/admin/, 'Administração do sistema'],
  [/^\/api\/mural/, 'Mural de avisos'],
  [/^\/api\/(interesse|aceite|assinatura)/, 'Links públicos'],
  [/^\/api\/saude/, 'Sistema'],
];
const LEGADO = 'Legado da concreteira';

function grupoDe(url: string): { grupo: string; modulo: string | null; legado: boolean } {
  const modulo = moduloDaRota(url);
  if (modulo && (MODULOS_RETIRADOS as readonly string[]).includes(modulo)) return { grupo: LEGADO, modulo, legado: true };
  if (modulo) return { grupo: NOMES_MODULO[modulo as Modulo], modulo, legado: false };
  return { grupo: ROTULO_FORA_DE_MODULO.find(([rx]) => rx.test(url))?.[1] ?? 'Outros', modulo: null, legado: false };
}

export async function montarDocumentacao(): Promise<{ especificacao: Especificacao; markdown: string; cobertura: Record<string, number>; semCorpo: string[] }> {
  const app = await criarApp(bancoDaSonda(), { log: false, documentar: true });
  await app.ready();
  const bruto = (app as unknown as { swagger: () => Especificacao }).swagger();
  const fontes = lerFontes();
  const versao = (JSON.parse(readFileSync(path.join(RAIZ, 'package.json'), 'utf8')) as { version: string }).version;

  const especificacao: Especificacao = { ...bruto, info: { ...bruto.info, version: versao }, paths: {} };
  especificacao.info.description = [
    'API do Agrega Construtoras. Documento gerado do código por `npm run docs -w apps/api`; não edite à mão.',
    '',
    '**Autenticação.** `POST /api/auth/entrar` com e-mail e senha devolve o cookie `agrega_sessao` (12 horas). Todas as rotas exigem esse cookie, menos as marcadas como públicas.',
    '',
    '**Acesso.** Cada rota traz em `x-acesso` os perfis que passam pelo guarda no padrão de cada perfil (sem módulos personalizados e com todos os módulos contratados). A rota ainda pode restringir por registro: engenheiro e mestre de obra só veem as obras atribuídas a eles.',
    '',
    '**Respostas.** Sucesso devolve JSON em envelope nomeado (`{ obras: [...] }`, `{ obra: {...} }`); os formatos de resposta ainda não estão descritos aqui. Erro devolve sempre `{ erro: string }`; erro de validação (400) traz também `campos: [{ campo, mensagem }]`.',
    '',
    '**Valores.** Dinheiro trafega em reais (número). Datas são texto `AAAA-MM-DD`. Identificadores são UUID.',
  ].join('\n');
  especificacao.components = {
    ...bruto.components,
    schemas: {
      ...(bruto.components?.schemas ?? {}),
      Erro: {
        type: 'object',
        required: ['erro'],
        properties: {
          erro: { type: 'string', description: 'Mensagem para o usuário, em português.' },
          campos: { type: 'array', description: 'Só em erro de validação (400).', items: { type: 'object', properties: { campo: { type: 'string' }, mensagem: { type: 'string' } } } },
        },
      },
    },
  };

  const cobertura = { rotas: 0, comResumo: 0, comCorpo: 0, comConsulta: 0, publicas: 0, legado: 0 };
  const semCorpo: string[] = [];
  let ip = 0;
  const pedir = async (metodo: string, url: string, perfil: Perfil | null, comoServidorMcp = false) => {
    const resposta = await app.inject({
      method: metodo.toUpperCase() as 'GET',
      url: url.replace(/\{\w+\}/g, ID_EXEMPLO),
      remoteAddress: `10.${(ip >> 16) & 255}.${(ip >> 8) & 255}.${ip++ & 255}`, // um endereço por pedido: o limite de tentativas não interfere
      headers: { ...(metodo === 'get' || metodo === 'delete' ? {} : { 'content-type': 'application/json' }), ...(comoServidorMcp ? { 'x-mcp-secret': config.mcpApiSecret } : {}) },
      payload: metodo === 'get' || metodo === 'delete' ? undefined : '{}',
      cookies: perfil ? { [COOKIE_SESSAO]: criarToken({ sub: perfil, emp: perfil === 'admin_sistema' ? null : 'empresa', per: perfil }, config.jwtSecret, 600) } : {},
    });
    return resposta.statusCode;
  };

  for (const [caminhoBruto, operacoes] of Object.entries(bruto.paths)) {
    // '/api/usuarios/' e '/api/usuarios' são a mesma rota: fica a forma sem a barra final
    const caminho = caminhoBruto.length > 1 && caminhoBruto.endsWith('/') ? caminhoBruto.slice(0, -1) : caminhoBruto;
    for (const metodo of METODOS) {
      const op = operacoes[metodo];
      if (!op) continue;
      const fonte = fontes.get(`${metodo} ${caminho}`);
      const { grupo, modulo, legado } = grupoDe(caminho);
      cobertura.rotas++;

      const publica = (await pedir(metodo, caminho, null)) !== 401;
      // Sem sessão responde 401, mas com o segredo do servidor MCP passa: é rota de servidor para servidor (OAuth).
      const servidorMcp = !publica && (await pedir(metodo, caminho, null, true)) !== 401;
      const perfis: Perfil[] = [];
      if (!publica && !servidorMcp) for (const perfil of PERFIS_DOCUMENTADOS) if (![401, 403].includes(await pedir(metodo, caminho, perfil))) perfis.push(perfil);

      op.tags = [grupo];
      op.operationId = `${metodo}_${caminho.replace(/^\/api\//, '').replace(/[{}]/g, '').replace(/[^A-Za-z0-9]+/g, '_')}`;
      if (fonte?.resumo) { op.summary = fonte.resumo.length > 120 ? `${fonte.resumo.slice(0, 117)}...` : fonte.resumo; if (fonte.resumo.length > 120) op.description = fonte.resumo; cobertura.comResumo++; }
      if (legado) { op.deprecated = true; cobertura.legado++; }
      if (publica) { op.security = []; cobertura.publicas++; } else op.security = servidorMcp ? [{ servidorMcp: [] }] : [{ sessao: [] }];
      op['x-acesso'] = { publica, modulo, perfis, ...(servidorMcp ? { servidorMcp: true } : {}) };
      if (fonte) op['x-fonte'] = `${fonte.arquivo}:${fonte.linha}`;
      if (fonte?.consulta.length) {
        op.parameters = [...(op.parameters ?? []), ...fonte.consulta.map((c) => ({ name: c.nome, in: 'query', required: c.obrigatorio, schema: { type: 'string' } }))];
        cobertura.comConsulta++;
      }
      if (op.requestBody) cobertura.comCorpo++;
      else if (metodo === 'post' || metodo === 'put' || metodo === 'patch') semCorpo.push(`${metodo.toUpperCase()} ${caminho}`);
      op.responses = {
        '200': { description: 'Sucesso. Formato ainda não descrito.' },
        default: { description: 'Erro.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Erro' } } } },
      };
      (especificacao.paths[caminho] ??= {})[metodo] = op;
    }
  }
  await app.close();

  const grupos = [...new Set(Object.values(especificacao.paths).flatMap((ops) => Object.values(ops).flatMap((o) => o.tags ?? [])))];
  const ordem = [...Object.values(NOMES_MODULO), ...ROTULO_FORA_DE_MODULO.map(([, r]) => r), 'Outros', LEGADO];
  grupos.sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b));
  especificacao.tags = grupos.map((g) => ({ name: g, ...(g === LEGADO ? { description: 'Rotas herdadas (frota, produção, qualidade). Ninguém recebe esses módulos; só as consultas de cadastro respondem.' } : {}) }));

  return { especificacao, markdown: paraMarkdown(especificacao, grupos, cobertura), cobertura, semCorpo };
}

// ---------- 4. Versão para leitura (Markdown) ----------

function camposDoCorpo(op: Operacao): string {
  const esquema = op.requestBody?.content?.['application/json']?.schema;
  if (!esquema) return '';
  const variantes = (esquema.anyOf ?? esquema.oneOf) as Record<string, unknown>[] | undefined;
  const descrever = (e: Record<string, unknown>) => {
    const obrigatorios = new Set((e.required as string[] | undefined) ?? []);
    return Object.keys((e.properties as Record<string, unknown> | undefined) ?? {}).map((c) => `\`${c}\`${obrigatorios.has(c) ? '*' : ''}`).join(', ');
  };
  return variantes ? variantes.map(descrever).join(' **ou** ') : descrever(esquema);
}

function paraMarkdown(e: Especificacao, grupos: string[], cobertura: Record<string, number>): string {
  const celula = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const linhas: string[] = [
    '# API do Agrega Construtoras',
    '',
    '> Gerado do código por `npm run docs -w apps/api`. Não edite à mão: mude a rota e gere de novo.',
    '> A versão completa, com tipos e limites de cada campo, está em [`openapi.json`](./openapi.json).',
    '',
    '## Como usar',
    '',
    '- **Autenticação:** `POST /api/auth/entrar` com `{ email, senha }` devolve o cookie `agrega_sessao`, válido por 12 horas. Envie o cookie em todas as chamadas.',
    '- **Erros:** sempre `{ "erro": "mensagem" }`. Validação (400) traz também `campos: [{ campo, mensagem }]`. Sem login: 401. Sem permissão: 403. Conflito de estado: 409.',
    '- **Respostas:** JSON em envelope nomeado (`{ obras: [...] }`). Os formatos de resposta ainda não estão descritos neste documento.',
    '- **Valores:** dinheiro em reais (número), datas `AAAA-MM-DD`, identificadores UUID.',
    '- **Servidor MCP:** rotas que só o servidor MCP chama, identificando-se com o segredo compartilhado no cabeçalho `X-MCP-Secret` (`MCP_API_SECRET`).',
    '- **Acesso:** a coluna mostra os perfis que passam pelo guarda no padrão de cada perfil. Engenheiro e mestre de obra só alcançam as obras atribuídas a eles.',
    '- **O que faz:** vem do comentário acima da rota no código. Rota sem comentário fica em branco.',
    '- **Corpo e consulta:** campos de primeiro nível; `*` marca os obrigatórios. Os parâmetros de consulta são lidos do código e saem todos como texto.',
    '',
    `Total: ${cobertura.rotas} rotas, ${cobertura.publicas} públicas, ${cobertura.legado} do legado da concreteira.`,
    '',
  ];
  const todos = PERFIS_DOCUMENTADOS.filter((p) => p !== 'admin_sistema');
  const acesso = (op: Operacao) => {
    const a = op['x-acesso'] as { publica: boolean; perfis: Perfil[]; servidorMcp?: boolean };
    if (a.publica) return 'Pública';
    if (a.servidorMcp) return 'Servidor MCP';
    if (!a.perfis.length) return 'Ninguém';
    if (todos.every((p) => a.perfis.includes(p))) return a.perfis.includes('admin_sistema') ? 'Todos' : 'Todos da empresa';
    return a.perfis.map((p) => NOMES_PERFIL[p]).join(', ');
  };
  for (const grupo of grupos) {
    const itens = Object.entries(e.paths).flatMap(([caminho, ops]) => METODOS.filter((m) => ops[m]?.tags?.includes(grupo)).map((m) => ({ caminho, metodo: m, op: ops[m] })));
    linhas.push(`## ${grupo}`, '', `${itens.length} rotas.`, '', '| Rota | O que faz | Acesso | Consulta | Corpo |', '|---|---|---|---|---|');
    for (const { caminho, metodo, op } of itens) {
      const consulta = (op.parameters ?? []).filter((p) => p.in === 'query').map((p) => `\`${p.name}\`${p.required ? '*' : ''}`).join(', ');
      linhas.push(`| \`${metodo.toUpperCase()} ${caminho}\` | ${celula(op.description ?? op.summary ?? '')} | ${acesso(op)} | ${consulta} | ${celula(camposDoCorpo(op))} |`);
    }
    linhas.push('');
  }
  return linhas.join('\n');
}

// ---------- Execução direta ----------

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { especificacao, markdown, cobertura, semCorpo } = await montarDocumentacao();
  mkdirSync(PASTA_DOCS, { recursive: true });
  writeFileSync(path.join(PASTA_DOCS, 'openapi.json'), `${JSON.stringify(especificacao, null, 2)}\n`);
  writeFileSync(path.join(PASTA_DOCS, 'API.md'), `${markdown}\n`);
  console.log(`docs/openapi.json e docs/API.md gerados: ${JSON.stringify(cobertura)}`);
  if (process.argv.includes('--lacunas')) console.log(`Rotas de escrita sem corpo descrito (${semCorpo.length}):\n${semCorpo.join('\n')}`);
  process.exit(0);
}
