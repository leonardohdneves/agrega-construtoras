# Spec · Correção das pendências do Agrega

Base: `docs/pendencias.md` (37 itens), que entrou na `main` com o [PR #1](https://github.com/leonardohdneves/agrega-construtoras/pull/1). Análise refeita em 18/11/2026 sobre o commit `877caed`. A versão antiga do relatório (`E:\TRABALHO\AGREGA CONSTRUTORA\Pendências Agrega.md`, 26 itens) ficou para trás.

**Fora do escopo (documentação):** P24, P25, P26 e P36. As divergências da P15 e da P32 entram, mesmo sendo sintomas da P25.

**Entram a mais**, vindas da revisão do PR #1:
- **P38:** a troca de código e a renovação do OAuth não autenticam o servidor MCP.
- **P39:** o reuso de um token de renovação já trocado não derruba a cadeia.

**Situação do PR #1:**
- Foi mesclado e publicado em produção às 15:00 de hoje. A migração `0090` já foi aplicada.
- A API já aceita `Authorization: Bearer` e as rotas `/api/auth/oauth-*` já estão no ar.
- O login por OAuth está desligado na prática, porque `MCP_CALLBACK_URLS` está vazio em produção.
- O servidor MCP não foi publicado.

## 1. Resultado da análise

| Id | Situação | O que a análise mostrou |
| --- | --- | --- |
| P01 | Confirmada (leitura) | `clientes` não tem `endereco` nem `atuacao`. O PATCH usa `COLUNAS`, que inclui as duas. |
| P02 | Confirmada (leitura) | `POST/PATCH /api/frota/motoristas` → módulo `frota`, que ninguém recebe. Afeta até o dono. |
| P03 | Confirmada (leitura) | O PUT de permutas grava `obraId` e `fornecedorId` sem checar a empresa. O POST checa. |
| P04 | **Confirmada (reproduzida)** | `GET /api/%66in/lancamentos` cai em `/api/fin/lancamentos` com `req.url` cru, e o módulo sai `null`. As rotas do Financeiro aceitam `dono, gestor`, então **o gestor entra no Financeiro**. As de usuários aceitam todos os perfis da empresa, então **qualquer perfil passa pela guarda de módulo**. Vale também para o token Bearer do PR #1. Não testado contra a produção, porque o proxy do Railway pode normalizar a URL. |
| P05 | **Metade feita** | O PR #1 versionou o `package-lock.json`. O `railway.json` ainda roda `npm install`. |
| P06 | **Metade feita** | O PR #1 criou o script `typecheck` na API. O build não chama o typecheck nem os testes. O `tsc` segue com erros nos dois apps (ver §6). Entre eles, dois bugs reais: `suprimentos.ts:1853` (`insumoId`) e `Fornecedores.tsx:35` (`endereco`). |
| P07 | Confirmada | Nenhum teste de rota com `inject`. O PR #1 deixou o `criarApp` pronto para isso. |
| P08 a P14 | Confirmadas | Do jeito descrito no relatório (conferidas uma a uma). |
| P15 | Confirmada por amostra | `.max(8)` com 9 módulos; `insumoId`. |
| P16 a P23 | Confirmadas | Do jeito descrito no relatório. |
| P27 | Confirmada (log de produção) | "Falha ao montar a Construtora Modelo do curso: column "empresa_id" does not exist" a cada subida. A causa está no relatório: seis tabelas sem `empresa_id` em `limparEmpresa` e depois `financeiro_pct`. Com `SEED_DEMO=true`, a API nem sobe em banco novo. |
| P28 | Aceita (leitura do relatório) | Centavos no acompanhamento, reais no resto da API. |
| P29 | **Confirmada (leitura), impacto maior. Regra definida (D10)** | `acessoPermitido` libera qualquer GET da Engenharia para o mestre de obra **antes** de olhar os perfis da rota. O hook do RDO (`rdo.ts:96`) só confere a obra do **engenheiro**. Resultado: **o mestre de obra lê os RDOs de todas as obras da empresa**. |
| P30 | A confirmar | Solicitação de material em obra no nível "obra". Reproduzir no Sprint 2. |
| P31 a P34 | Aceitas (leitura do relatório) | PUTs que zeram o omitido, campos aceitos e ignorados, filtros inconsistentes, outros. |
| P35 | Aceita (vista em execução pelo autor do PR) | Empresa nova sem plano de contas. |
| P37 | Aceita | MCP não publicado, catálogo de 171 KB, ferramentas não exercitadas, lacunas. |
| **P38** | **Nova** | `/api/auth/oauth-exchange` e `/oauth-refresh` não exigem nada além do código ou do token de renovação. Não há segredo compartilhado entre o MCP e a API, e o código não fica preso ao `redirect_uri`. Quem obtiver um código (60 s) ou um token de renovação (30 dias) troca direto na API e ganha um token de sessão de 12 h. |
| **P39** | **Nova** | Em `oauth-mcp.ts`, reusar um token de renovação já trocado devolve 401, mas não revoga os descendentes. O padrão de rotação recomenda derrubar a cadeia inteira, porque o reuso indica vazamento. A troca de senha também não derruba os tokens de sessão já emitidos. Isso piora a P20, agora que esses tokens ficam guardados num servidor de terceiros. |

## 2. Princípios

1. **Teste antes da correção.** Cada item de quebra ou segurança ganha um teste de rota que falha antes e passa depois.
2. **Um commit por pendência**, com o id no título (`P03: …`), numa branch por sprint. Ela entra na `main` só ao fim do sprint, por PR revisado. A `main` publica em produção. O PR #1, com 50 mil linhas, foi mesclado 4 minutos depois de aberto e sem revisão.
3. **Rota mudou, roda `npm run docs`.** O `test/openapi.test.ts` do PR #1 falha se a documentação gerada ficar desatualizada.
4. A partir do Sprint 0, **nada sobe com `tsc` ou teste quebrado**.

## 3. Decisões (todas aprovadas em 18/11/2026)

| # | Decisão | Decidido |
| --- | --- | --- |
| D1 | Cliente tem endereço? (P01) | Sim: migração com `endereco` em `clientes`. |
| D2 | Quem liga a nota ao pedido? (P11) | O Financeiro, só nesse fluxo. |
| D3 | Fator de unidade em nota confirmada (P10) | Só nota em rascunho. A confirmada fica bloqueada, com aviso. |
| D4 | Banco para os testes de rota (P07) | Postgres local via Docker, mais um Postgres de teste no Railway. |
| D5 | Onde roda a checagem (P06) | No `buildCommand` do Railway: o deploy falha se `npm run check` falhar. |
| D6 | Redefinir o admin pelo ambiente (P21) | Só com `ADMIN_REDEFINIR=1`. |
| D7 | PUT parcial ou completo (P31) | PUT exige tudo, PATCH é parcial. As rotas que hoje parecem parciais passam a recusar o que faltar. |
| D8 | Dinheiro na API (P28) | Sempre em reais. Os campos em centavos ficam só onde o nome termina em `Centavos`. |
| D9 | Publicar o MCP (P37) | Só depois de P20, P38 e P39. |
| **D10** | **Acesso do mestre de obra (P29)** | **Decidido em 18/11/2026:** o mestre de obra só tem acesso às obras atribuídas a ele, e só dono ou gestor atribuem obras. |

## 4. Sprints

### Sprint 0 · Rede de segurança (3 a 4 dias)

| Id | Entrega | Critério de aceite |
| --- | --- | --- |
| — | `npm run docs` e commit: a documentação gerada ficou para trás no merge do PR #1 (ver §6). | `npm test -w apps/api` sem a falha de `openapi`. |
| P05 | `npm ci --include=dev` no `railway.json` (o lockfile já está versionado). | O log do build mostra `npm ci`. |
| P06 | `npm run check` na raiz: typecheck da API, do front e do MCP, mais os testes. Corrigir os erros de `tsc`, começando pelos dois bugs reais. Chamar `check` no `buildCommand`. | `npm run check` limpo. Um erro de tipo proposital numa branch faz o build falhar. |
| P07 (base) | Helper de teste com `criarApp`, banco com migrações, duas empresas e um usuário de cada perfil. `zip-xlsx` pula sem `unzip` ou `python3`. | `npm test` com `TEST_DATABASE_URL` roda os testes de rota. Sem a variável, pula. |

Risco: algum erro de tipo pode esconder bug. Correção que muda comportamento vira item próprio.

### Sprint 1 · Segurança e quebras em uso (5 dias)

| Id | Entrega | Critério de aceite (teste de rota) |
| --- | --- | --- |
| P04 | A guarda decide pelo padrão registrado (`req.routeOptions.url`), no módulo e na trava de senha provisória. | Gestor: `GET /api/%66in/lancamentos` → 403. Mesma matriz para `%75suarios`, com cookie e com Bearer. |
| P29 | Regra D10, nas duas metades. **(a) Leitura:** um predicado só (`ehRestritoAObras`) em toda rota com obra no caminho, ou seja, engenharia, RDO, visitas e canteiro. As listas de obras e as rotas sem obra no caminho filtram por `obra_responsaveis`. Mestre sem obra atribuída vê lista vazia. **(b) Atribuição:** o campo `responsaveis` do POST e do PUT de `/api/eng/obras` só é aceito de dono ou gestor. Hoje o orçamentista, que tem a Engenharia completa, também grava. Para os outros perfis, a rota recusa com 403 se o campo vier. A tela esconde a escolha de responsáveis para quem não pode. | Mestre atribuído só à obra A: `GET /api/eng/obras/{B}/rdos`, `/canteiro`, `/planejamento` e `/eap` → 404, e `GET /api/eng/obras` lista só A. Orçamentista enviando `responsaveis` → 403. Gestor atribui o mestre à obra B e o acesso aparece na hora. |
| P03 | Repetir no PUT as checagens do POST. Helper `conferirReferencias` aplicado nos PUT/PATCH que recebem ids. | Empresa A com obra da B → 400. Lista dos PUT/PATCH auditados no PR. |
| P01 | Separar as colunas de cliente e de fornecedor. Migração `endereco` em `clientes` (D1). | PATCH de cliente → 200. Endereço volta ao reabrir. |
| P02 | Colaboradores em `/api/adm/colaboradores`. | Dono e gestor cadastram, editam e desativam. |
| P16 | `22P02` → 404 no handler global. | `GET /api/fin/lancamentos/abc` → 404. |
| P07 (matrizes) | Matriz perfil × módulo e matriz entre empresas, com P01 a P04 e P29 como regressão. | As matrizes rodam no `check`. |

Deploy ao fim do sprint, com P04 e P29 primeiro.

### Sprint 2 · Quebras de carga e contrato front × back (5 dias)

| Id | Entrega | Critério de aceite |
| --- | --- | --- |
| P27 | `limparEmpresa` apaga as seis tabelas pelo pai. `popularConstrutora` atualizado para o esquema atual. Teste das duas cargas em banco vazio. | O deploy loga "Obra modelo da Construtora Modelo criada" e a empresa do curso abre com obras. |
| P35 | Plano de contas padrão criado junto com a empresa. | Empresa nova lança uma despesa sem passar pela tela do plano. |
| P30 | Reproduzir. Se confirmar, aceitar `eap_no_id` nulo no nível "obra". | Solicitação de material abre em obra no nível "obra". |
| P08, P09, P12, P13 | Correções pontuais descritas no relatório. | Critérios do relatório. |
| P10 | Escrita do fator em `/api/sup` (D3). Linha bloqueada para nota confirmada. | Gestor salva o fator em rascunho. A confirmada aparece bloqueada. |
| P11 | Fluxo nota × pedido para o Financeiro (D2). Parar de engolir o erro em `Nota.tsx:469`. | O Financeiro liga uma nota a um pedido. |
| P14 | O front usa o `padrao` de `GET /api/usuarios`. | Gestor com Incorporação marcada. Salvar sem mexer não tira módulo. |
| P28 | Reais em toda resposta (D8). Ajustar telas e ferramentas do MCP. | O total da curva S bate com o orçamento sem BDI. |
| P15 | As dez divergências. O legado sai junto com a P22. | Teste ou conferência descrita no PR. |

### Sprint 3 · Robustez da API (5 dias)

| Id | Entrega | Critério de aceite |
| --- | --- | --- |
| P31 | Convenção D7 aplicada a RDO, pedido, visita e lançamento. No pedido, trocar o fornecedor de pedido vindo de cotação passa a ser checado. | PUT do RDO só com `{ data, observacoes }` → 400, sem apagar as listas. |
| P32 | Tirar do esquema o que não é gravado, ou gravar. No código do item de tabela própria, a rota respeita o código informado. | Insumo "I-001" criado e usado numa composição. |
| P17 + P33 | Helper `lerQuery` com zod e 400 `{ erro, campos }`. `ate` sempre inclusivo. Baixa na criação igual em lançamento e nota. Mensagem da baixa coerente. Aplicar primeiro em Financeiro, Suprimentos e Engenharia. | `?de=ontem` → 400. Mesmo período dá o mesmo resultado em lançamentos e extrato. |
| P18 | `limite` e `cursor` com `temMais` nas listas maiores. Aviso de truncamento nas demais. | Com mais registros que o limite, aparece a próxima página ou um aviso. |
| P19 | `rateLimit` por usuário nas rotas de IA e upload. | Repetição → 429 em português. |
| P34 | Os nove comportamentos: medição física sem sobrescrever em silêncio, BDI único nos relatórios, contadores do item, `.catch(0)` do RDO, PATCH da parcela, `tipo` da solicitação de serviço, contrato manual com obra, `contaId` das linhas de extrato. O item de visitas já sai na P29. | Cada um com teste ou conferência descrita no PR. |

### Sprint 4 · Sessão, OAuth, legado e endurecimento (5 dias)

| Id | Entrega | Critério de aceite |
| --- | --- | --- |
| P20 | Renovação deslizante do cookie. `sessao_versao` conferida em `exigir`. Trocar a senha derruba cookie, Bearer e conexões. | Token antigo → 401 depois da troca de senha. |
| P38 | Segredo compartilhado (`MCP_API_SECRET`) exigido em `oauth-exchange` e `oauth-refresh`, comparado em tempo constante. O código fica preso ao `redirect_uri` usado no login. | Troca sem o segredo → 401. Código emitido para outro `redirect_uri` → 400. |
| P39 | Reuso de um token de renovação revogado derruba a cadeia (família de tokens) e registra na auditoria. | Reusar um token antigo invalida também o atual. |
| P21 | `garantirAdmin` só cria. Redefinir com `ADMIN_REDEFINIR=1` (D6). | Senha trocada pela tela sobrevive a um reinício. |
| P22 | Desligar as rotas legadas, mantendo as consultas usadas, e remover as páginas. | `GET /api/prod/inventarios` → 404. |
| P23 | Helmet e CSP, checagem de `Origin` nas escritas (o Bearer fica isento), máscara dos tokens no log, `trustProxy` fixo, checksum das migrações, versão do `package.json`, 422 → 400. | Cabeçalhos presentes. POST com `Origin` estranho e sem Bearer → 403. Log sem tokens. |

### Sprint 5 · Servidor MCP (3 a 5 dias, opcional)

| Id | Entrega | Critério de aceite |
| --- | --- | --- |
| P37 | Simplificar as ferramentas que contornavam P09, P28, P31 e P32. Fechar as lacunas do catálogo: plano padrão, reprovar, encerrar pedido, versão do orçamento, entrada em estoque. Corrigir as descrições. Grupos de exposição para reduzir os 171 KB. Exercitar as ferramentas não testadas. Publicar o serviço no Railway com `MCP_CALLBACK_URLS` (D9). | Conector adicionado no Claude lista as ferramentas, lê e escreve numa empresa de teste. Troca de senha derruba a conexão. |

## 5. Ordem e dependências

- O **Sprint 0 vem antes de tudo**.
- **P04 e P29 abrem o Sprint 1.** São as de maior impacto: dados que um perfil não deveria ver.
- **P22 depende da P02.**
- **P28, P31 e P32 mudam respostas** que o MCP já consome. Ajustar as ferramentas no mesmo commit.
- **Publicar o MCP (P37) depende de P20, P38 e P39.**

Total estimado: **5 a 6 semanas**, em 6 sprints, sendo o último opcional. Cada sprint termina com PR revisado, deploy e conferência em produção.

## 6. Linha de base (commit `877caed`)

Rodada local, no Windows, com `npm ci`:

| Verificação | Resultado |
| --- | --- |
| `tsc` API | 51 erros |
| `tsc` front | 9 erros |
| `tsc` MCP | 0 erros |
| `npm test -w apps/api` | 277 testes: 260 passam, 15 pulam (sem banco), **2 falham** |
| `npm test -w apps/mcp` | 8 de 8 |

As duas falhas da API:
- `xlsx: abre no leitor de planilhas…`: é do ambiente, porque falta Python no Windows. Resolve no Sprint 0.
- **`documentação da API: docs/openapi.json está em dia com o código`**: a `main` está vermelha. A branch do PR #1 saiu de antes da rota `DELETE /api/eng/obras/{id}/canteiro/boletins/{bId}` (deploy de 13:52). No merge, a rota entrou e a documentação gerada não foi refeita. Correção: `npm run docs` e commit. É o primeiro item do Sprint 0, senão a P06 trava o deploy logo de saída.
