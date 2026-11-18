# Publicar o servidor MCP no Railway

Passo a passo para colocar no ar o servidor MCP do Agrega (`apps/mcp`), que conecta assistentes de IA (Claude, ChatGPT) à API. O que ele é e como a autenticação funciona está em [`apps/mcp/README.md`](../apps/mcp/README.md).

São dois serviços no mesmo projeto do Railway: **criar o do MCP** e **acrescentar duas variáveis no da API**. Leva cerca de 15 minutos.

## Antes de começar

- As três condições da decisão D9 (`docs/spec-correcoes-pendencias.md`) estão na `main` e em produção desde 18/11/2026: P20, P38 e P39 (PRs #4 e #5).
- O login por OAuth está desligado em produção enquanto `MCP_CALLBACK_URLS` e `MCP_API_SECRET` não existirem no serviço da API. O passo 4 é o que liga.
- **O fluxo com o Claude de verdade nunca foi testado.** O que foi testado é o fluxo equivalente rodando localmente (API, MCP e Postgres reais, 26 verificações). O passo 6 é a primeira conferência em produção.

## 1. Criar o serviço do MCP

1. No projeto do Agrega no Railway: **+ New → GitHub Repo** e escolha este repositório (`agrega-construtoras`), branch `main`.
2. Renomeie o serviço para `agrega-mcp`.
3. Em **Settings**, no campo do arquivo de configuração (Config as Code), informe: `/apps/mcp/railway.json`
4. Deixe **Root Directory** vazio. O repositório usa workspaces do npm e é instalado a partir da raiz.

> **O item 3 não pode faltar.** Sem ele o Railway usa o `railway.json` da raiz e sobe uma segunda cópia da API em vez do MCP.

O arquivo `apps/mcp/railway.json` já define o build (`npm install`), o início (`npm run start:mcp`) e o healthcheck (`/health`). O serviço não usa banco de dados nem volume.

## 2. Dar um endereço público ao MCP

Em **Settings → Networking**, clique em **Generate Domain**, ou configure um domínio próprio (por exemplo `mcp.seudominio.com.br`).

Anote o endereço. Nos passos seguintes ele aparece como `ENDERECO-DO-MCP`.

## 3. Variáveis do serviço do MCP

| Variável | Valor | Observação |
|---|---|---|
| `API_BASE_URL` | `https://agrega-construtoras-app-production.up.railway.app` | Endereço da API, sem `/api` e sem barra no fim |
| `AGREGA_AUTHORIZE_URL` | `https://agrega-construtoras-app-production.up.railway.app/oauth/authorize` | Tela de login que o usuário vê |
| `PUBLIC_BASE_URL` | `https://ENDERECO-DO-MCP` | Sem barra no fim |
| `OAUTH_SIGNING_SECRET` | segredo aleatório de 64 caracteres | **Não pode mudar depois** |
| `MCP_API_SECRET` | outro segredo aleatório de 64 caracteres | O mesmo valor vai na API (passo 4) |
| `TRUST_PROXY` | `true` | |
| `NODE_ENV` | `production` | |

Para gerar cada segredo, rode duas vezes e use um resultado para cada variável:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Sobre os dois segredos:

- **`OAUTH_SIGNING_SECRET`** assina os cadastros dos clientes e cifra os tokens entregues aos assistentes. Se mudar, todo usuário que conectou um assistente precisa autorizar de novo.
- **`MCP_API_SECRET`** é como o MCP se identifica para a API ao trocar o código de login e ao renovar o token. Precisa ser idêntico nos dois serviços.

Variáveis opcionais, com padrão adequado: `ALLOWED_REDIRECT_DOMAINS` (padrão: domínios do Claude e do ChatGPT), `CORS_ALLOWED_ORIGINS`, `MCP_ACCESS_TOKEN_TTL` (padrão 3600). A lista completa, comentada, está em `apps/mcp/.env.example`.

Para o ChatGPT, que não faz registro automático de cliente, é preciso também `OAUTH_CLIENT_ID` e `OAUTH_CLIENT_SECRET`. Para o Claude não é necessário.

## 4. Variáveis no serviço da API

| Variável | Valor |
|---|---|
| `MCP_API_SECRET` | exatamente o mesmo valor colocado no MCP |
| `MCP_CALLBACK_URLS` | `https://ENDERECO-DO-MCP/oauth/callback` |

Salvar faz a API reiniciar. A partir daí o login por OAuth está ligado em produção.

Se `MCP_CALLBACK_URLS` for definido sem `MCP_API_SECRET`, a API registra no log de subida: "Conexão com assistentes desligada: defina MCP_API_SECRET".

## 5. Conferir os dois serviços

1. `https://ENDERECO-DO-MCP/health` responde `status: ok` e `toolsCount: 152`.
2. `https://ENDERECO-DO-MCP/.well-known/oauth-protected-resource/mcp` mostra o endereço do MCP em `resource` e em `authorization_servers`.
3. O log de início do MCP mostra "OAuth: client_id e refresh_token assinados com segredo estável" e a linha `URL publica` com o endereço certo.
4. Esta chamada devolve `{"permitido":true}`:

```bash
curl "https://agrega-construtoras-app-production.up.railway.app/api/auth/oauth-destino?redirect_uri=https://ENDERECO-DO-MCP/oauth/callback"
```

## 6. Conectar o Claude

1. No Claude: **Configurações → Conectores → Adicionar conector personalizado**.
2. URL: `https://ENDERECO-DO-MCP/mcp`
3. O Claude abre a tela "Autorizar acesso" do Agrega. Entre com um usuário **de construtora** que já tenha trocado a senha inicial (o administrador do sistema não conecta).
4. De volta ao Claude, peça: "use o Agrega e liste as obras".

O assistente age com as permissões do usuário que autorizou: vê e faz o que aquele perfil pode ver e fazer.

## Se algo der errado

| Sintoma | Causa provável |
|---|---|
| O serviço do MCP não sobe | `MCP_API_SECRET` ou `OAUTH_SIGNING_SECRET` faltando ou com menos de 32 caracteres. O log de início diz qual |
| O serviço sobe, mas é a API (migrações no log, `/api/saude` responde) | Faltou o caminho `/apps/mcp/railway.json` no passo 1 |
| Tela "Pedido de conexão inválido" | `MCP_CALLBACK_URLS` na API não bate com `PUBLIC_BASE_URL` do MCP + `/oauth/callback` (confira com o `curl` do passo 5) |
| Depois da senha, o Claude mostra erro `missing_token` | `MCP_API_SECRET` diferente nos dois serviços. O log do MCP mostra "A API recusou este servidor MCP" |
| O Claude conecta, mas toda ferramenta responde 403 | O usuário não tem o módulo. A ferramenta `usuario_atual` mostra os módulos liberados |
| Registro do cliente recusado (`invalid_redirect_uri`) | O domínio do assistente não está em `ALLOWED_REDIRECT_DOMAINS` |

Para repetir o teste do fluxo OAuth contra os serviços publicados existe `npm run teste:oauth -w apps/mcp` (ver `apps/mcp/README.md`). Ele exige `localhost` em `ALLOWED_REDIRECT_DOMAINS`; inclua só durante o teste e tire depois.

## Depois de publicar

- **Trocar a senha no Agrega encerra as conexões de assistentes** do usuário; ele autoriza de novo.
- **Reuso de um token de renovação** derruba a conexão e grava um registro na auditoria (`entidade = 'oauth_refresh'`, `acao = 'revogar'`). Vale olhar esses registros de vez em quando.
- **Cada deploy da `main` reconstrói também o serviço do MCP.** As conexões sobrevivem, desde que `OAUTH_SIGNING_SECRET` não mude.
- **O catálogo tem 152 ferramentas (171 KB).** Se pesar nas conversas, o próximo passo é portar os perfis de exposição do AIRO (P37 em `docs/pendencias.md`).
- **As descrições de algumas ferramentas estão defasadas** em relação às correções do Sprint 2 (cliente com endereço, filtro `finalizada`). O plano é alinhar tudo depois do Sprint 3.
