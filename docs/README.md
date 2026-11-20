# Documentação do Agrega

| Documento | O que é |
|---|---|
| [pendencias.md](./pendencias.md) | Lista de correções levantada na revisão do repositório: o que está quebrado, onde, como corrigir e como conferir |
| [../apps/api/docs/API.md](../apps/api/docs/API.md) | Todas as rotas da API por módulo, com acesso, parâmetros e campos. Gerado do código por `npm run docs` |
| `../apps/api/docs/openapi.json` | A mesma coisa em OpenAPI 3, com tipos e limites de cada campo |
| [publicar-mcp.md](./publicar-mcp.md) | Passo a passo para colocar o servidor MCP no ar no Railway, com as variáveis dos dois serviços e o que conferir |
| [../apps/mcp/README.md](../apps/mcp/README.md) | Servidor MCP (assistentes de IA): como a autenticação funciona, como rodar, publicar e incluir ferramentas |

`API.md` e `openapi.json` não são editados à mão: mude a rota e rode `npm run docs`. O teste `apps/api/test/openapi.test.ts` falha se ficarem desatualizados.
