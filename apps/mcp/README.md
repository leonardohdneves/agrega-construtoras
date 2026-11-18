# Servidor MCP do Agrega

Conecta assistentes de IA (Claude, ChatGPT) ao Agrega. O assistente chama ferramentas (`listar_obras`, `criar_lancamento`…) e cada ferramenta chama a API em nome do usuário que autorizou a conexão, com as permissões do perfil dele.

É um serviço à parte, no mesmo desenho do servidor MCP do AIRO: o fluxo OAuth e o endpoint `/mcp` foram portados de lá.

```
src/servidor.ts          HTTP: OAuth 2.1 (metadados, registro de clientes, authorize, callback, token, revogação) e /mcp
src/nucleo.ts            cria o servidor MCP: lista as ferramentas e despacha as chamadas
src/lib/oauth-tokens.ts  client_id assinado e tokens cifrados (sobrevivem a deploy)
src/lib/cliente-api.ts   cliente HTTP da API do Agrega (Authorization: Bearer)
src/ferramentas/         o catálogo, um arquivo por área
```

## Como a autenticação funciona

1. O assistente chama `/mcp` sem token e recebe 401 com o endereço dos metadados OAuth.
2. Ele se registra sozinho (`/oauth/register`) e manda o usuário para `/oauth/authorize`.
3. O servidor MCP redireciona para a tela do Agrega (`/oauth/authorize` em `apps/web`), que mostra quem está pedindo acesso e pede e-mail e senha.
4. A API confere o login e devolve um **código de uso único de 60 segundos**; a tela volta para o `/oauth/callback` do MCP com esse código.
5. O MCP troca o código na API, de servidor para servidor (`POST /api/auth/oauth-exchange`), e recebe o token de sessão e um token de renovação. Nessa chamada ele se identifica com um segredo compartilhado (`MCP_API_SECRET`, cabeçalho `X-MCP-Secret`), e o código só vale para o mesmo `/oauth/callback` usado no login.
6. O assistente recebe um token **próprio do MCP** (`at2_…`, 1 hora), que só vale aqui e leva o token de sessão cifrado por dentro. Quando vence, a renovação é automática (`rt2_…` → `POST /api/auth/oauth-refresh`, rotativo, 30 dias sem uso).

O token da API nunca passa pela URL nem chega ao assistente. Trocar a senha no Agrega encerra todas as conexões do usuário.

## Rodar no computador

```bash
cp apps/mcp/.env.example apps/mcp/.env
npm run dev:api     # API em http://localhost:3000
npm run dev:web     # telas em http://localhost:5173 (a tela de autorização fica aqui)
npm run dev:mcp     # MCP em http://localhost:3001
```

Na API, `MCP_CALLBACK_URLS` já aceita `http://localhost:3001/oauth/callback` fora de produção.

Para conferir o fluxo inteiro (registro, login, token, chamada de ferramenta, renovação e revogação):

```bash
# com "localhost" em ALLOWED_REDIRECT_DOMAINS no .env do MCP
EMAIL=dono@empresa.com SENHA=... npm run teste:oauth -w apps/mcp
```

## Publicar (Railway)

Um segundo serviço no mesmo projeto, apontando para este repositório, com o arquivo de configuração `apps/mcp/railway.json`.

Variáveis do serviço do MCP:

| Variável | Valor |
|---|---|
| `API_BASE_URL` | Endereço do serviço da API |
| `AGREGA_AUTHORIZE_URL` | `https://SEU-DOMINIO/oauth/authorize` |
| `PUBLIC_BASE_URL` | Endereço público do MCP, ex.: `https://mcp.SEU-DOMINIO` |
| `OAUTH_SIGNING_SECRET` | `openssl rand -hex 32`. Tem que ser o mesmo entre deploys |
| `MCP_API_SECRET` | `openssl rand -hex 32`. O mesmo valor nos dois serviços |
| `TRUST_PROXY` | `true` |
| `NODE_ENV` | `production` |

Variáveis no serviço da API:

| Variável | Valor |
|---|---|
| `MCP_CALLBACK_URLS` | `https://mcp.SEU-DOMINIO/oauth/callback` |
| `MCP_API_SECRET` | O mesmo valor do serviço do MCP |

No Claude: Configurações → Conectores → Adicionar conector personalizado → `https://mcp.SEU-DOMINIO/mcp`.

## Incluir uma ferramenta

1. Abra (ou crie) o arquivo da área em `src/ferramentas/`.
2. Declare com `ferramenta({ name, description, inputSchema, handler })` e inclua na `colecao(...)` do arquivo. Arquivo novo entra em `src/ferramentas/index.ts`.
3. O nome define o tipo: `listar_`, `buscar_`, `obter_`, `relatorio_`… são leitura; `cancelar_`, `remover_`, `estornar_`… são destrutivas (`src/lib/anotacoes.ts`).
4. A descrição é para o modelo decidir quando usar: o que faz, o que devolve, de onde vêm os ids e o que causa erro. Todo campo da entrada leva `.describe()`.
5. `npm test -w apps/mcp` confere o catálogo.

As rotas da API e os campos de cada uma estão em [`apps/api/docs/API.md`](../api/docs/API.md) e `apps/api/docs/openapi.json`. O MCP não expõe exclusão de registros.
