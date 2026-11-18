# Pendências do Agrega

Lista de correções levantada na revisão do repositório em 18/11/2026 (stack, contrato entre front e back, documentação da API) e durante a construção do servidor MCP, na branch `documentacao-api`.

**Antes de corrigir, reproduza.** Quase tudo aqui veio de leitura de código. Os itens marcados *(visto em execução)* foram observados rodando a API contra um banco de teste. A P04 é hipótese e precisa de teste antes de qualquer correção.

Os caminhos são relativos a `apps/api/src` e `apps/web/src`, salvo indicação. Os números de linha são os da branch `documentacao-api`; em `main` podem estar algumas linhas acima.

## Resumo

| Id | Sev. | Pendência | Grupo | Situação |
|---|---|---|---|---|
| [P01](#p01) | Alta | Editar cliente devolve erro 500 | Quebra em uso | Aberta |
| [P02](#p02) | Alta | Tela Colaboradores não grava (403) | Quebra em uso | Aberta |
| [P03](#p03) | Média | Edição de permuta aceita obra e fornecedor de outra empresa | Segurança | Aberta |
| [P04](#p04) | Alta | Guarda de módulo decide pela URL crua (a confirmar) | Segurança | Aberta |
| [P05](#p05) | Alta | Sem `package-lock.json` versionado | Processo | Lockfile criado na branch; falta trocar o build |
| [P06](#p06) | Alta | Sem typecheck nem testes antes do deploy | Processo | Aberta (script `typecheck` criado na API) |
| [P07](#p07) | Alta | Nenhum teste de rota HTTP | Processo | Aberta |
| [P08](#p08) | Média | Filtro `status=finalizada` é ignorado nas solicitações | Contrato | Aberta |
| [P09](#p09) | Média | Quantidade com vírgula em saída e transferência de estoque | Contrato | Aberta |
| [P10](#p10) | Média | Conferência de unidades: salvar dá 403 ou 409 | Contrato | Aberta |
| [P11](#p11) | Média | Perfil Financeiro não liga nota ao pedido | Contrato | Aberta |
| [P12](#p12) | Média | Data da última visita nunca aparece | Contrato | Aberta |
| [P13](#p13) | Média | Período de teste do aceite sai um dia antes | Contrato | Aberta |
| [P14](#p14) | Média | Padrão de módulos duplicado no front tira Incorporação do gestor | Contrato | Aberta |
| [P15](#p15) | Baixa | Dez divergências menores de contrato | Contrato | Aberta |
| [P16](#p16) | Média | Id malformado no path vira erro 500 | API | Aberta |
| [P17](#p17) | Média | Query string validada à mão, com fallback silencioso | API | Aberta |
| [P18](#p18) | Média | Listas sem paginação, truncadas por `LIMIT` fixo | API | Aberta |
| [P19](#p19) | Média | Rotas de IA sem rate limit | API | Aberta |
| [P20](#p20) | Média | Sessão de 12 h sem renovação nem revogação | API | Aberta |
| [P21](#p21) | Média | `ADMIN_EMAIL` sobrescreve usuário existente a cada subida | API | Aberta |
| [P22](#p22) | Média | Rotas legadas da concreteira ainda registradas | API | Aberta |
| [P23](#p23) | Baixa | Endurecimento: cabeçalhos, CSRF, logs, proxy | API | Aberta |
| [P24](#p24) | Alta | Documentação da API inexistente | Documentação | Em parte resolvida |
| [P25](#p25) | Média | Contrato sem fonte única entre front e back | Documentação | Aberta |
| [P26](#p26) | Média | README e `.env.example` desatualizados | Documentação | Aberta |
| [P27](#p27) | Alta | Carga de demonstração e Construtora Modelo quebradas em banco novo | Quebra em uso | Aberta *(visto em execução)* |
| [P28](#p28) | Média | Acompanhamento da obra devolve centavos; o resto da API, reais | Contrato | Aberta |
| [P29](#p29) | Média | RDO não confere a obra atribuída para mestre de obra (a confirmar) | Segurança | Aberta |
| [P30](#p30) | Média | Solicitação de material parece impossível em obra apropriada no nível "obra" (a confirmar) | Contrato | Aberta |
| [P31](#p31) | Média | PUT que zera o que for omitido | API | Aberta |
| [P32](#p32) | Média | Campos aceitos pelo esquema e ignorados na gravação | API | Aberta *(um caso visto em execução)* |
| [P33](#p33) | Média | Filtros de período e de situação inconsistentes | API | Aberta |
| [P34](#p34) | Baixa | Outros comportamentos inesperados achados ao escrever as ferramentas | API | Aberta |
| [P35](#p35) | Média | Empresa nova não tem plano de contas | Quebra em uso | Aberta *(visto em execução)* |
| [P36](#p36) | Baixa | Lacunas da documentação gerada | Documentação | Aberta |
| [P37](#p37) | Média | Servidor MCP: o que falta | MCP | Aberta |

## O que já foi feito na branch `documentacao-api`

- **Documentação gerada do código**: `npm run docs` grava `apps/api/docs/API.md` e `apps/api/docs/openapi.json` (479 rotas, corpo de 193, acesso por perfil calculado pelos guardas reais). Ver P24.
- **`schema: { body }` nas rotas**: cada rota com corpo declara o esquema zod na definição. Em 86 rotas o esquema estava dentro do handler e foi movido para uma constante logo acima. A validação continua sendo o `.parse()` de sempre; o `schema` serve só à documentação (comentário em `app.ts`).
- **Servidor MCP** em `apps/mcp`, com OAuth no mesmo desenho do AIRO e 152 ferramentas. Ver `apps/mcp/README.md` e P37.
- **API**: aceita `Authorization: Bearer`; três rotas novas (`/api/auth/oauth-login`, `/oauth-exchange`, `/oauth-refresh`) e `/oauth-destino`; migração `0090_oauth_mcp.sql`.
- **Front**: tela `/oauth/authorize` (`paginas/OAuthAutorizar.tsx`).
- **`package-lock.json`** criado (o repositório não tinha).
- Typecheck e testes ficaram iguais a antes: 51 erros de `tsc` na API e 9 no front, que já existiam; 1 teste de XLSX que já falhava no Windows.

---

## Quebras em uso e segurança

Fazer primeiro. P01 e P02 afetam telas ativas hoje; P03 e P04 tocam o isolamento entre empresas e perfis.

<a id="p01"></a>
### P01 · Editar cliente devolve erro 500 · Alta

- **Onde:** `rotas/administrativo.ts:145-160` (PATCH), `:46-62` (COLUNAS), `:133-135` (INSERT); `paginas/Fornecedores.tsx:120-122`; `migrations/0005_financeiro.sql:56-75`
- **Problema:** o `PATCH /api/adm/clientes/:id` monta o UPDATE com toda chave de COLUNAS, que inclui `atuacao` e `endereco`. A tabela `clientes` não tem essas colunas (as migrações 0064 e 0077 alteraram só fornecedores). O formulário é compartilhado e envia os dois campos sempre. No POST o endereço é aceito com 201 e descartado. O PATCH também descarta `categoria` em silêncio (`:148`).
- **Correção:** decidir se cliente tem endereço. Se sim, migração adicionando `endereco` em `clientes` e inclusão no INSERT. Em qualquer caso, separar as colunas permitidas por tabela para `atuacao` nunca entrar no UPDATE de clientes.
- **Como conferir:** editar o nome de um cliente pela tela e salvar; cadastrar cliente com endereço e reabrir.

<a id="p02"></a>
### P02 · Tela Colaboradores não grava (403) · Alta

- **Onde:** `rotas/frota.ts:277` e `:295`; `lib/modulos.ts:8-12`, `:69`, `:141`; `paginas/Motoristas.tsx:109-113` e `:130`; `componentes/Layout.tsx:220`; `test/modulos.test.ts:47-48`
- **Problema:** a tela grava em `POST` e `PATCH /api/frota/motoristas`. O prefixo `/api/frota` pertence ao módulo retirado `frota`, que ninguém recebe, então toda escrita devolve 403 até para o dono. Só o GET passa, pela lista de consultas. A documentação gerada confirma: nenhuma rota de escrita de `/api/frota` tem perfil com acesso.
- **Correção:** mover as rotas de colaboradores para `/api/adm/colaboradores` (módulo administrativo) e apontar a tela para lá. Evitar abrir exceção por regex em `modulos.ts`.
- **Como conferir:** logado como dono, cadastrar, editar e desativar um colaborador.

<a id="p03"></a>
### P03 · Edição de permuta aceita obra e fornecedor de outra empresa · Média

- **Onde:** `rotas/permutas.ts:157` (PUT sem conferir), `:122-125` (POST confere), `:41-44` e `:69-70` (leitura junta sem filtro de empresa); `migrations/0078_permutas.sql:8-9`
- **Problema:** `PUT /api/sup/permutas/:id` grava `obraId` e `fornecedorId` do corpo sem validar `empresa_id`. A resposta devolve nome da obra e razão social e CNPJ do fornecedor de outra empresa. Exige conhecer o UUID alheio. Não há RLS nem FK composta que barre no banco.
- **Correção:** repetir no PUT as duas verificações do POST. Em seguida, auditar os demais PUT e PATCH que recebem ids no corpo e criar um helper único para validar referências. Estrutural: FK composta `(empresa_id, id)` ou RLS.
- **Como conferir:** com duas empresas de teste, editar uma permuta da empresa A enviando o id de uma obra da empresa B: deve devolver 400 ou 404.

<a id="p04"></a>
### P04 · Guarda de módulo decide pela URL crua (a confirmar) · Alta

- **Onde:** `sessao.ts` (dentro de `exigir`: trava de senha provisória e chamada a `acessoPermitido`); `lib/modulos.ts:63-83` (`moduloDaRota`), `:117`, `:136-141`
- **Problema:** o módulo exigido é deduzido por `startsWith` sobre `req.url`. O roteador do Fastify decodifica percent-encoding antes de casar a rota, mas `req.url` fica cru. Uma chamada como `/api/%66in/lancamentos` deve casar com `/api/fin/lancamentos` enquanto `moduloDaRota` devolve `null`, e aí vale só a lista de perfis da rota. Efeito esperado: gestor acessa o Financeiro, dono acessa módulo não contratado, e as rotas legadas (P22) ficam alcançáveis. **Não foi reproduzido.**
- **Correção:** primeiro, teste com `app.inject` usando caminho codificado. Se confirmar, decidir por `req.routeOptions.url` (padrão registrado, já com prefixo) ou declarar o módulo em `config` de cada plugin no registro em `app.ts`.
- **Como conferir:** logado como gestor, `GET /api/%66in/lancamentos` deve devolver 403, igual a `/api/fin/lancamentos`.
- **Agravante novo:** o servidor MCP chama a API com o token do usuário, então a mesma regra de módulo protege também o que o assistente alcança.

<a id="p27"></a>
### P27 · Carga de demonstração e Construtora Modelo quebradas em banco novo · Alta *(visto em execução)*

- **Onde:** `lib/demo-modelo.ts:172-185` (`limparEmpresa`); `lib/construtora-modelo.ts` (`popularConstrutora`); `sementes.ts:77-80`; `server.ts:14-16`
- **Problema:** são dois defeitos em sequência.
  1. `limparEmpresa` roda `DELETE FROM <tabela> WHERE empresa_id = $1` para uma lista fixa, e seis tabelas da lista não têm essa coluna: `orcamento_itens`, `eap_nos`, `obra_composicao_insumos`, `obra_itens`, `ref_composicao_insumos`, `ref_itens`. Estão na lista desde o commit `feb925c` (10/10). Com `SEED_DEMO=true` a API **não sobe** num banco novo (`column "empresa_id" does not exist`). Com `CURSO_SENHA`, a API sobe, registra "Falha ao montar a Construtora Modelo" e a empresa fica vazia.
  2. Passando desse ponto, a carga da Construtora Modelo falha em `column "financeiro_pct" of relation "obra_composicao_preco" does not exist`: o código de carga não acompanhou o esquema.
- **Efeito em produção:** só aparece quando a marca de versão da carga muda (`VERSAO_CONSTRUTORA`) ou em ambiente novo. Vale olhar os logs do serviço por "Falha ao montar".
- **Correção:** em `limparEmpresa`, apagar as seis tabelas pelo pai (`obra_id IN (SELECT id FROM obras WHERE empresa_id = $1)`; `tabela_id` para as `ref_*`; `composicao_id` para as de composição). Atualizar `popularConstrutora` para o esquema atual. Um teste que rode as duas cargas num banco vazio evita a regressão (junto com P07).
- **Como conferir:** subir a API num banco vazio com `SEED_DEMO=true` e com `CURSO_SENHA` definidos; as duas empresas devem aparecer com obras.

<a id="p29"></a>
### P29 · RDO não confere a obra atribuída para mestre de obra (a confirmar) · Média

- **Onde:** `rotas/rdo.ts:96` (usa `ehEngenheiroDeObra`); `rotas/engenharia.ts:204` (usa `ehRestritoAObras`)
- **Problema:** nas rotas de engenharia, quem é restrito a obras (engenheiro de obra e mestre de obra) passa por uma checagem de obra atribuída. Nas rotas de RDO a checagem usa outro predicado, que parece cobrir só o engenheiro. Um mestre de obra leria RDOs de obras que não são dele. Não foi verificado se `acessoPermitido` barra antes, nem executado.
- **Correção:** usar o mesmo predicado nos dois arquivos.
- **Como conferir:** com um mestre de obra atribuído só à obra A, `GET /api/eng/obras/{B}/rdos` deve devolver 404.

<a id="p35"></a>
### P35 · Empresa nova não tem plano de contas · Média *(visto em execução)*

- **Onde:** `rotas/financeiro.ts` (`POST /plano-contas/padrao`); `rotas/admin.ts` (criação de empresa)
- **Problema:** uma empresa recém-criada tem o plano de contas vazio. Lançamento e contrato exigem uma categoria que aceite lançamento, então nada financeiro funciona até alguém acionar "plano padrão" na tela. Criar categoria à mão exige criar antes cada grupo pai ("Crie antes o grupo 9.9.").
- **Correção:** criar o plano padrão junto com a empresa, ou deixar claro no primeiro acesso. No MCP, expor a criação do plano padrão (P37).
- **Como conferir:** criar uma empresa e lançar uma despesa sem passar pela tela do plano de contas.

---

## Processo de entrega

Baratas de fazer e impedem que erros como os desta lista voltem a subir.

<a id="p05"></a>
### P05 · Sem `package-lock.json` versionado · Alta

- **Onde:** `railway.json:5` (`npm install --include=dev --no-audit --no-fund`)
- **Problema:** cada deploy resolve de novo as faixas `^` de fastify, pg, zod, vite e demais. Uma versão publicada entre dois deploys entra em produção sem revisão e sem commit que explique.
- **Situação:** o `package-lock.json` foi criado nesta branch. Falta versioná-lo e trocar o build.
- **Correção:** versionar o lockfile; trocar o build do Railway para `npm ci --include=dev`.
- **Como conferir:** `git ls-files package-lock.json` lista o arquivo; o log do build mostra `npm ci`.

<a id="p06"></a>
### P06 · Sem typecheck nem testes antes do deploy · Alta

- **Onde:** `apps/web/package.json` (`build` só roda `vite build`); sem `.github/`, lint ou hooks
- **Problema:** a API roda por type stripping do Node, que não confere tipos, e o build do front também não. Hoje `tsc --noEmit` acusa **51 erros na API e 9 no front**. Dois exemplos:
  - `rotas/suprimentos.ts:1868` lê `i.insumoId`, campo que `detalharPedido` (`:551-569`) não devolve; o pareamento nota x pedido por insumo nunca casa e cai sempre na comparação por descrição.
  - `paginas/Fornecedores.tsx:35` lê `f.endereco`, ausente do tipo `Fornecedor`.
- **Situação:** `npm run typecheck -w apps/api` existe a partir desta branch. Nada o executa ainda.
- **Correção:** zerar os erros; um `npm run check` na raiz que roda typecheck dos três apps e os testes; chamar esse script no `buildCommand` do Railway ou em um workflow de CI.
- **Como conferir:** introduzir um erro de tipo proposital em uma branch e ver o deploy falhar.

<a id="p07"></a>
### P07 · Nenhum teste de rota HTTP · Alta

- **Onde:** `apps/api/test/*.test.ts`: fora o `openapi.test.ts`, nenhum usa `criarApp` ou `.inject`; só `obras-acesso.test.ts` e `orcamento-db.test.ts` usam banco, e pulam sem `TEST_DATABASE_URL`
- **Problema:** as cerca de 479 rotas, com SQL, regra e autorização no mesmo handler, não têm cobertura. Permissão por perfil e módulo e isolamento por empresa dependem de revisão manual. P01 a P04 e P27 teriam sido pegas por testes de rota.
- **Correção:** suíte com `criarApp(banco, { log: false })` e `app.inject`. Começar por duas matrizes: perfil x módulo, e acesso cruzado entre duas empresas. Incluir os casos de P01 a P04 como regressão. O `apps/mcp/scripts/teste-oauth.ts` mostra um fluxo completo contra API real e pode servir de modelo.
- **Como conferir:** `npm test` com `TEST_DATABASE_URL` definido roda os testes de rota sem pular.
- **Observação:** o teste `xlsx: abre no leitor de planilhas…` (`test/zip-xlsx.test.ts`) falha no Windows; não foi investigado.

---

## Divergências de contrato front x back

Nenhuma chamada do front aponta para rota ou método inexistente. O que existe são campos, tipos e permissões que os dois lados entendem de forma diferente.

<a id="p08"></a>
### P08 · Filtro `status=finalizada` é ignorado nas solicitações · Média

- **Onde:** `rotas/suprimentos.ts:43`, e no `GET /solicitacoes` (tratamento do `status`); `paginas/SupSolicitacoes.tsx:27` e `:53-55`; `paginas/SupCotacoes.tsx:101` e `:127-136`
- **Problema:** `STATUS_SOLICITACAO` não tem `finalizada`, embora o status exista. O valor vira `null` e o filtro some. O filtro "Finalizadas" mostra o mesmo que "Em andamento", e a tela Nova cotação lista solicitações não finalizadas, que terminam em 409 ao cotar.
- **Correção:** incluir `finalizada` na lista aceita pelo filtro.
- **Como conferir:** `GET /api/sup/solicitacoes?status=finalizada` devolve só finalizadas.
- **Caso parecido:** `rotas/contratos.ts:612`, o filtro `status` de contratos não aceita `aguardando_aprovacao` nem `reprovado` e cai na lista padrão.

<a id="p09"></a>
### P09 · Quantidade com vírgula em saída e transferência de estoque · Média

- **Onde:** `rotas/suprimentos.ts`, esquemas de `POST /estoque/transferencias` e `POST /saidas-material` (`z.coerce.number`); helper `decimal()` em `:31-39`; `paginas/SupEstoque.tsx:194`, `:215`, `:429`, `:498`
- **Problema:** o front envia a string digitada e o back faz `Number(texto)`. "2,5" devolve 400; "1.000" (mil) é gravado como 1. As outras telas usam o formato brasileiro.
- **Correção:** usar `decimal()` nos dois esquemas, ou converter com `lerNumero` no front antes de enviar. Preferir os dois.
- **Como conferir:** registrar saída de 2,5 e transferência de 1.000 e conferir o saldo.

<a id="p10"></a>
### P10 · Conferência de unidades: salvar dá 403 ou 409 · Média

- **Onde:** `paginas/SupConferenciaUnidades.tsx:44-58` e `:91-110`; `rotas/notas.ts` (`PATCH /notas/itens/:id` e `exigirRascunho`, `:470-475`); `rotas/suprimentos.ts` (`GET /conferencia-unidades`); `lib/modulos.ts:136-140`; `main.tsx`
- **Problema:** a tela é de Suprimentos, mas salva o fator por `PATCH /api/fin/notas/itens/:id`, rota do Financeiro: gestor e comprador recebem 403. Além disso, a listagem inclui notas confirmadas, e para elas o PATCH devolve 409 até para o dono. A tela não desabilita o campo nem avisa.
- **Correção:** criar a escrita do fator em `/api/sup`, com regra própria para nota confirmada, ou restringir a lista ao que pode ser editado. No front, usar `notaStatus` para desabilitar a linha.
- **Como conferir:** como gestor, salvar o fator de um item de nota em rascunho e de um de nota confirmada.

<a id="p11"></a>
### P11 · Perfil Financeiro não liga nota ao pedido · Média

- **Onde:** `paginas/Nota.tsx:469` e `:1443`; `paginas/Lancamento.tsx:118`; `rotas/suprimentos.ts` (`PUT /pedidos/:id/recebimento`); `lib/modulos.ts:41`, `:89-96`, `:141`
- **Problema:** na tela da nota, o perfil Financeiro vê os pedidos candidatos, mas `PUT /api/sup/pedidos/:id/recebimento` devolve 403. `GET /api/sup/estoques` também devolve 403 e o erro é engolido, deixando o seletor de estoque vazio.
- **Correção:** definir quem faz esse fluxo. Se for o Financeiro, expor as duas operações em `/api/fin` ou incluir a consulta de estoques nas CONSULTAS. Parar de engolir o erro em `Nota.tsx:469`.
- **Como conferir:** como usuário de perfil Financeiro, ligar uma nota a um pedido de compra.

<a id="p12"></a>
### P12 · Data da última visita nunca aparece · Média

- **Onde:** `rotas/acompanhamento.ts:81` e `:88`; `paginas/EngVisitas.tsx:11` e `:55`
- **Problema:** `GET /api/eng/acompanhamento/obras` devolve as linhas cruas com `ultima_visita`; o front lê `ultimaVisita`, sempre `undefined`.
- **Correção:** mapear a resposta para camelCase na rota, como nas demais.
- **Como conferir:** a lista de obras de acompanhamento mostra "última em dd/mm/aaaa".

<a id="p13"></a>
### P13 · Período de teste do aceite sai um dia antes · Média

- **Onde:** `rotas/aceite.ts:17`; `db.ts:4`; `migrations/0085_aceite_proposta.sql:20-21`; `paginas/Aceite.tsx:64` e `:88`; `componentes/AceitesProposta.tsx:62`
- **Problema:** `teste_inicio` e `teste_fim` são `date` e chegam como texto `AAAA-MM-DD`. `new Date(texto)` é meia-noite UTC, que formatada em São Paulo cai no dia anterior. Afeta o comprovante do cliente e a lista do comercial.
- **Correção:** formatar a data pelo texto (`AAAA-MM-DD` para `DD/MM/AAAA`), sem passar por `Date`.
- **Como conferir:** aceite com início em 10/12 mostra 10/12 nas três telas.

<a id="p14"></a>
### P14 · Padrão de módulos duplicado no front tira Incorporação do gestor · Média

- **Onde:** `lib/modulos.ts:30` e `:34`; `acesso.ts:6` e `:10` (web); `paginas/Usuarios.tsx:65`, `:103`, `:106`; `rotas/usuarios.ts:48-54`
- **Problema:** o front tem cópia manual dos padrões por perfil, já desatualizada: o gestor não tem `incorporacao` e o dono não tem `incorporacao` nem `laudos`. Ao desmarcar "usar o padrão" e salvar sem mexer, o gestor perde o módulo sem aviso.
- **Correção:** usar o `padrao` que `GET /api/usuarios` já devolve e remover a cópia de `acesso.ts`.
- **Como conferir:** abrir os acessos de um gestor: Incorporação aparece marcada.

<a id="p15"></a>
### P15 · Dez divergências menores de contrato · Baixa

- **Limite de módulos:** `esquemas.ts:94` e `:105` usam `.max(8)`, mas existem 9 módulos; perfil Financeiro com todos marcados recebe 400 em inglês.
- **Permutas:** `rotas/permutas.ts:19-20` sem `invalid_type_error`; quantidade ou preço vazio (`SupPermutas.tsx:161-162` envia `NaN`, que vira `null`) devolve "Expected number, received null".
- **Saldos nulos:** `GET /fin/contas` e `GET /fin/resumo` devolvem `null` para quem não é dono ou financeiro; `api.ts:469-471` e `Painel.tsx:47-48` tipam como número. `Painel.tsx:413-426` lê `fin.receber.realizadoMes` sem guarda e quebra para gestor que receba o módulo Financeiro.
- **Tipo Fornecedor:** `api.ts:355-371` não declara `endereco` nem `criadoAutomaticamente`, que `administrativo.ts:64-84` devolve.
- **Curva S vazia:** sem planejamento, a rota não devolve `indices` nem `dataUltimaMedicao`; `GerAcompanhamento.tsx:9` e `PainelObraBI.tsx:15-22` declaram como obrigatórios.
- **Relatórios de planejamento:** `lib/planejamento-relatorios.ts:68` e `:113` devolvem `inicio` e `fim` nulos; `EngRelatorios.tsx:42-43` e `:51-52` tipam como `string`.
- **Filtro morto:** `SupSolicitacoes.tsx:165` e `:591` filtram por `o.ativo`, campo que `GET /api/eng/obras` não devolve.
- **Inventário legado:** `rotas/estoque.ts:176` remove o ponto mesmo quando o valor chega como número (12.5 vira 125). Inalcançável hoje; corrigir ou remover junto com P22.
- **Qualidade legada:** `rotas/qualidade.ts:20-28` tem o mesmo tratamento de ponto para strings; também inalcançável.
- **Etiquetas:** `GET /sup/etiquetas` lista toda entrada de estoque, mas a saída de material só aceita entrada com `nota_item_id` (`rotas/suprimentos.ts`, `~:950` contra `~:1039`). Entrada vinda de despesa aparece na lista e responde "Etiqueta não encontrada" na saída.

<a id="p28"></a>
### P28 · Acompanhamento da obra devolve centavos; o resto da API, reais · Média

- **Onde:** `rotas/engenharia.ts:2098` (`custoDireto` da planilha de acompanhamento), `:2180-2189` (curva S), `:2204-2217` (previsto x realizado); origem em `lib/acompanhamento.ts:2`. Também `/ger/producao-equipe` devolve `totalCentavos`.
- **Problema:** a convenção da API é dinheiro em reais (número). Essas rotas devolvem centavos, a custo direto. Quem consome precisa saber de cor quais rotas são a exceção. As ferramentas do MCP avisam na descrição, mas o risco de um valor cem vezes maior continua para qualquer novo consumidor.
- **Correção:** converter para reais na saída dessas rotas e ajustar as telas que as consomem, ou padronizar o nome do campo com sufixo `Centavos` como em `producao-equipe`.
- **Como conferir:** o total da curva S bate com o total do relatório de orçamento da mesma obra, sem BDI.

<a id="p30"></a>
### P30 · Solicitação de material em obra apropriada no nível "obra" (a confirmar) · Média

- **Onde:** `rotas/suprimentos.ts:127-138` contra `:174`; também `~:1555` (concluir cotação)
- **Problema:** em obra com apropriação no nível "obra", o item novo é gravado com `eap_no_id` nulo e logo depois `resolverNecessidades` recusa por não estar apropriado à EAP. Por leitura, a solicitação de material falha sempre nessas obras. Não foi executado.
- **Correção:** aceitar `eap_no_id` nulo quando o nível de apropriação é "obra".
- **Como conferir:** criar obra com `nivelApropriacao: 'obra'` e abrir uma solicitação de material.

---

## Desenho da API

<a id="p16"></a>
### P16 · Id malformado no path vira erro 500 · Média

- **Onde:** `app.ts` (handler global não trata o código 22P02); `rotas/financeiro.ts` (rotas com `:id` e `carregarLancamento`); `rotas/admin.ts:61`, `:76`, `:205`; contraste em `rotas/mural.ts:152`
- **Problema:** parte das rotas confere o UUID com regex (redefinida em vários arquivos) e parte manda o parâmetro direto ao SQL. O Postgres recusa e o usuário vê "Erro inesperado", com log de erro 500.
- **Correção:** tratar 22P02 no handler global como 404 e centralizar a validação de `params` em um hook ou esquema único.
- **Como conferir:** `GET /api/fin/lancamentos/abc` devolve 404.

<a id="p17"></a>
### P17 · Query string validada à mão, com fallback silencioso · Média

- **Onde:** 111 usos de `req.query` nas rotas; exemplo no `GET /lancamentos` de `rotas/financeiro.ts`
- **Problema:** filtro inválido é ignorado: a rota devolve outro período ou a lista sem filtro, sem avisar. P08 é um caso disso.
- **Correção:** um esquema zod por query string, devolvendo 400 no formato `{ erro, campos }` já usado para o corpo.
- **Como conferir:** `GET /api/fin/lancamentos?de=ontem` devolve 400.

<a id="p18"></a>
### P18 · Listas sem paginação, truncadas por `LIMIT` fixo · Média

- **Onde:** `rotas/financeiro.ts` (2000 lançamentos), `rotas/interesse.ts:57` (500), `rotas/aceite.ts:25` (200); nenhum `OFFSET` ou cursor nas rotas
- **Problema:** os limites variam de 30 a 3000 e não são informados. Passando do limite, registros somem da tela sem indicação.
- **Correção:** convenção única de paginação (`limite` e `cursor`, ou `pagina`) com `temMais` no envelope. No mínimo, sinalizar o truncamento nas listas maiores.
- **Como conferir:** empresa de teste com mais registros que o limite mostra aviso ou segunda página.

<a id="p19"></a>
### P19 · Rotas de IA sem rate limit · Média

- **Onde:** `app.ts` (`rateLimit` com `global: false`); rotas de leitura por IA em `rotas/financeiro.ts`, `rotas/notas.ts`, `rotas/laudos.ts`, `rotas/engenharia.ts`, `rotas/suprimentos.ts`
- **Problema:** só login, rotas públicas e backups têm limite. Um usuário autenticado pode disparar leituras por IA de até 24 MB sem teto, com custo na API da Anthropic. Não foi encontrada cota por empresa.
- **Correção:** `config.rateLimit` nas rotas de IA e de upload, por usuário; avaliar cota mensal por empresa.
- **Como conferir:** chamadas repetidas a uma rota de IA devolvem 429 depois do limite.

<a id="p20"></a>
### P20 · Sessão de 12 h sem renovação nem revogação · Média

- **Onde:** `sessao.ts:10`; `rotas/auth.ts` (`/sair` e `/senha`)
- **Problema:** o token expira 12 h após o login mesmo com o usuário ativo. "Sair" só apaga o cookie e trocar a senha não derruba outras sessões de navegador, então um token copiado vale até expirar. Atenuante: `exigir` relê o usuário a cada requisição, e desativar corta o acesso na hora.
- **Situação:** as conexões de assistentes (MCP) já são encerradas na troca de senha. As sessões de navegador continuam como estavam.
- **Correção:** renovação deslizante do cookie e uma coluna `senha_alterada_em` (ou versão de sessão) comparada com o `iat` dentro de `exigir`.
- **Como conferir:** token antigo deixa de valer depois da troca de senha.

<a id="p21"></a>
### P21 · `ADMIN_EMAIL` sobrescreve usuário existente a cada subida · Média

- **Onde:** `sementes.ts:13-24`
- **Problema:** a cada início, o usuário com aquele e-mail tem senha, perfil e empresa redefinidos. A senha trocada pela tela volta à do ambiente no próximo deploy, e um usuário de empresa com o mesmo e-mail viraria administrador do sistema. O README diz que só cria se não existir.
- **Correção:** criar apenas quando não existir; redefinir só com uma variável explícita.
- **Como conferir:** trocar a senha do admin pela tela, reiniciar a API e entrar com a senha nova.

<a id="p22"></a>
### P22 · Rotas legadas da concreteira ainda registradas · Média

- **Onde:** `app.ts` (registro de frota, abastecimento, manutenção, produção, estoque, qualidade); `lib/modulos.ts:8-12`; páginas `Prod*`, `Qual*`, `Veiculos` no front
- **Problema:** 91 rotas seguem expostas, bloqueadas só pelo guarda de módulo, o mesmo da P04. Aumentam a superfície de ataque e o volume a manter e documentar. Na documentação gerada aparecem no grupo "Legado da concreteira".
- **Correção:** depois da P02, deixar de registrar o que não é usado, mantendo só as consultas de cadastro de `modulos.ts:89-96`. Remover as páginas e os imports correspondentes. `GET /rel/comercial` e `GET /ger/custo-veiculo` também são do legado.
- **Como conferir:** `GET /api/prod/inventarios` devolve 404.

<a id="p23"></a>
### P23 · Endurecimento: cabeçalhos, CSRF, logs, proxy · Baixa

- **Cabeçalhos:** sem helmet, CSP, HSTS, `X-Frame-Options` nem `nosniff` globais. Registrar `@fastify/helmet` com CSP compatível com o build.
- **CSRF:** a única defesa é `sameSite: 'lax'` (`sessao.ts`). Hook que rejeita métodos de escrita quando `Origin` não for o próprio host.
- **Logs:** a URL completa é registrada, incluindo os tokens de `/api/aceite/:codigo` e `/api/assinatura/:token`. Mascarar o último segmento no serializer.
- **Proxy:** `trustProxy: true` confia em toda a cadeia de `X-Forwarded-For`, usada no rate limit do login e gravada como prova do aceite. Confirmar o comportamento do Railway e fixar o número de saltos.
- **TLS do banco:** `db.ts:11` usa `rejectUnauthorized: false`. Aceitável em rede privada; rever se a URL pública for usada.
- **Migrações:** sem checksum nem rollback (`migrar.ts`); editar um arquivo já aplicado passa despercebido.
- **Backup:** montado inteiro em memória, incluindo colunas `bytea` de fotos e PDFs (`lib/backup-job.ts:24-26`). Acompanhar o crescimento.
- **Versão:** `app.ts` devolve `0.9.0` e os pacotes dizem `0.1.0`; `rotas/incorporacao.ts` devolve 422 onde o resto devolve 400.

<a id="p31"></a>
### P31 · PUT que zera o que for omitido · Média

Rotas de alteração que parecem parciais, mas gravam vazio ou nulo em todo campo que não vier. Quem envia só o que mudou perde dados sem erro.

- **RDO:** `rotas/rdo.ts:30-36`. `PUT /eng/obras/:obraId/rdos/:id` apaga mão de obra, equipamentos, atividades e ocorrências omitidos (`.default([])`) e zera clima, responsável e observações ausentes.
- **Pedido de compra:** `rotas/suprimentos.ts:1681-1701`. O PUT zera o que for omitido e deixa trocar o `fornecedorId` de um pedido que veio de cotação, sem conferir se ele participou.
- **Visita:** `rotas/acompanhamento.ts:144`. O PUT zera `responsavel` e `observacoes` omitidos, apesar de o esquema parecer parcial.
- **Lançamento:** o PUT exige o objeto inteiro e substitui todas as apropriações; omitir `veiculoId` numa apropriação existente apaga o vínculo.
- **Correção:** definir uma convenção (PUT substitui tudo e exige tudo; PATCH é parcial) e aplicar: ou o esquema exige os campos, ou a gravação preserva o que não veio.
- **Como conferir:** enviar ao PUT do RDO só `{ data, observacoes }` e reler: as listas devem continuar lá ou a rota deve recusar.

<a id="p32"></a>
### P32 · Campos aceitos pelo esquema e ignorados na gravação · Média

O esquema zod aceita, a rota responde sucesso e o valor não é gravado.

- **Item de tabela própria** *(visto em execução)*: `rotas/engenharia.ts:572`. `POST /eng/tabelas/:id/itens` aceita `codigo` e sempre gera outro pela sequência da tabela. Quem cria um insumo com código "I-001" e depois o usa numa composição recebe "Insumo I-001 não existe nesta tabela".
- **Obra:** `rotas/engenharia.ts:1126-1147`. `PUT /eng/obras/:id` ignora `codigo`, `tipo` e `eapPadrao`.
- **Pedido:** `rotas/suprimentos.ts:652` contra `:1697`. `PUT /sup/pedidos/:id` aceita `solicitacaoId` e ignora.
- **Conta financeira e centro de custo:** `rotas/financeiro.ts:447-449` e `:681`. Os POST aceitam `ativo` e o INSERT ignora.
- **Cliente:** `rotas/administrativo.ts:148`. O PATCH descarta `categoria`; o POST descarta `endereco` (P01).
- **Contrato:** `rotas/contratos.ts:230-231` e `:650` contra `:167-168`. `enderecoContratante` e `enderecoContratada` são gravados, mas o detalhe devolve os endereços do cadastro da obra e do fornecedor.
- **Correção:** tirar do esquema o que a rota não grava, ou gravar. Para o código do item, decidir: ou a rota respeita o código informado, ou o esquema deixa de aceitá-lo.

<a id="p33"></a>
### P33 · Filtros de período e de situação inconsistentes · Média

- **`ate` exclusivo ou inclusivo:** em `GET /fin/lancamentos` (`rotas/financeiro.ts:720`) e `GET /fin/notas` (`rotas/notas.ts:667`) o `ate` é exclusivo; em extrato, transferências, parcelas e linhas de extrato é inclusivo.
- **Parcelas:** `rotas/financeiro.ts:1005` e `:1007`. Com `situacao=semana` ou `vencidas`, a rota respeita `de` e sobrescreve `ate`.
- **Baixa:** `rotas/financeiro.ts:408`. Aceita data até amanhã, embora a mensagem diga "não pode ser futura". Pode ser folga intencional; se for, corrigir a mensagem.
- **Baixa na criação:** `rotas/financeiro.ts:917`. `POST /fin/lancamentos` com `baixa` baixa só a primeira parcela (e só da primeira ocorrência, com recorrência); `POST /fin/notas/:id/confirmar` com `baixa` baixa todas (`rotas/notas.ts:1474-1476`).
- **Formato do período:** os relatórios em `/rel` e `/ger` usam `de`/`ate` como `AAAA-MM`, com no máximo 24 meses (`rotas/gerencial.ts:15-25`); as listagens usam `AAAA-MM-DD`.
- **Correção:** escolher uma regra (sugestão: `ate` sempre inclusivo) e aplicar junto com a P17.

<a id="p34"></a>
### P34 · Outros comportamentos inesperados · Baixa

- **Medição física:** `rotas/engenharia.ts:2140`. `POST .../acompanhamento/medicoes` apaga a medição existente da mesma data sem aviso.
- **BDI nos relatórios:** `relatorio-abc` (`rotas/engenharia.ts:2821`) e `relatorio-orcamento` (`:2836`) devolvem o `bdiPercentual` do cadastro, mas calculam com `bdiDaObra()`, que usa a composição do preço; `relatorio-custos` (`:2442`) devolve o efetivo. Os dois valores podem divergir.
- **Item da obra:** `rotas/engenharia.ts:1219`. `GET /eng/obras/:id/itens/:itemId` devolve `componentes: 0` e `noOrcamento: false` sempre; a lista `componentes` da mesma resposta está correta.
- **Quantidades do RDO:** `rotas/rdo.ts:21` usa `.catch(0)`: valor inválido vira 0 em silêncio.
- **Parcela:** `rotas/financeiro.ts:1118` e `:1127`. O PATCH só altera `vencimento` e `observacoes`, e usa `coalesce`, então não dá para apagar a observação.
- **Solicitação de serviço:** `rotas/suprimentos.ts:248` e `:1124`. O POST escolhe o formato por `tipo === 'servico'` no corpo, campo que não está em `esquemaServico`. Sem ele, um corpo de serviço é lido como material e dá 400.
- **Contrato manual sem obra:** `rotas/contratos.ts:218-258`. Contrato criado à mão não tem `obraId`; só os gerados por cotação de serviço ficam ligados à obra.
- **Linhas de extrato:** `rotas/conciliacao.ts:319-320`. `GET /fin/conciliacao/linhas` exige `contaId` (400 sem ele) e aceita `status=todas`.
- **Visitas:** a documentação gerada lista Orçamentista e Mestre de obra com acesso às rotas de visita, porque passam pelo guarda de módulo; `rotas/acompanhamento.ts:16` e `:72` declaram só dono, gestor e engenheiro de obra. Conferir qual é a intenção.

---

## Documentação e contrato

<a id="p24"></a>
### P24 · Documentação da API · Alta · Em parte resolvida

- **Feito nesta branch:** `npm run docs` gera `apps/api/docs/API.md` e `apps/api/docs/openapi.json` a partir do código (`apps/api/scripts/gerar-openapi.ts`): todas as rotas por módulo, parâmetros de caminho, corpo das 193 rotas que têm esquema, parâmetros de consulta de 61 e os perfis com acesso a cada rota. O teste `test/openapi.test.ts` falha se a documentação ficar desatualizada ou se surgir rota sem login fora da lista conhecida.
- **Falta:**
  1. **Descrição das rotas.** Só 52 das 479 têm comentário acima da definição; é dele que sai a coluna "O que faz". Basta comentar a rota e gerar de novo.
  2. **Formato das respostas.** Não está descrito em lugar nenhum. É o trabalho pesado: esquemas de resposta partindo dos tipos de `apps/web/src/api.ts`, módulo a módulo (estimativa de 2 a 4 semanas).
  3. **Query strings em zod** (P17), para os parâmetros de consulta saírem com tipo.
  4. **Validação pelo próprio Fastify.** Hoje o `schema.body` é só documentação. Trocar o validador (`fastify-type-provider-zod`) e remover os `.parse()` dos handlers tornaria o esquema a única fonte. Atenção: a validação do Fastify roda antes do `preHandler`, então o guarda `exigir` teria de ir para `onRequest`, senão usuário sem login passa a receber 400 em vez de 401.
- **Como conferir:** `npm run docs` não altera nada num repositório em dia; `npm test -w apps/api` passa.

<a id="p25"></a>
### P25 · Contrato sem fonte única entre front e back · Média

- **Onde:** `api.ts:25` (`api<T = any>`), `api.ts:43-58` (Perfil duplicado de `lib/token.ts`), cerca de 57 tipos manuais em `api.ts`; `acesso.ts` (P14); `code128.ts` duplicado nos dois apps
- **Problema:** os tipos do front são cópias manuais e toda chamada sem genérico vira `any`. Mudar um lado e esquecer o outro não gera aviso; é a origem de P12, P14 e da maior parte de P15.
- **Correção:** pacote compartilhado no monorepo (por exemplo `packages/contrato`) com os esquemas zod de entrada e saída, importado pelos dois apps. Trocar o padrão de `api()` para `unknown`. Com a P06, uma mudança incompatível passa a barrar o deploy.
- **Como conferir:** renomear um campo no esquema faz o `tsc` do front falhar.

<a id="p26"></a>
### P26 · README e `.env.example` desatualizados · Média

- **Onde:** `README.md` (seções Ambiente de teste, Perfis, Etapas da versão 1); `apps/api/.env.example`; `config.ts`; `lib/ia-nota.ts`; `rotas/incorporacao.ts`; `lib/armazenamento.ts`
- **Problema:** o README descreve a concreteira (frota, motorista, etapas 0 a 7 com só a 0 concluída); o produto tem 14 perfis e 90 migrações. Faltam nas variáveis documentadas: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `VIABILIZA_URL`, `BACKUP_BUCKET_*`, `CURSO_SENHA` e `TEST_DATABASE_URL`. Sem as de bucket, o backup automático fica desligado com uma linha de log. O modelo padrão `claude-sonnet-5-5` está repetido em 4 arquivos.
- **Correção:** reescrever perfis, módulos e variáveis no README; completar o `.env.example`; ler todas as variáveis em `config.ts`.
- **Como conferir:** subir o projeto do zero seguindo só o README.

<a id="p36"></a>
### P36 · Lacunas da documentação gerada · Baixa

O gerador lê o que consegue do código; o que foge do padrão não aparece.

- **Parâmetros de consulta lidos por função auxiliar** não são detectados. Faltam, por exemplo, `de`/`ate` em `/rel/financeiro`, `/rel/gerencial`, `/rel/indicadores`, `/rel/administrativo`, `/ger/dre`, `/ger/fluxo` e `GET /sup/relatorios` (`rotas/gerencial.ts:15-25`, `rotas/suprimentos.ts:1965-1967`). Resolve com a P17.
- **Campo `tipo: 'servico'`** do `POST /sup/solicitacoes` não aparece, porque não está no esquema (P34).
- **Acesso por perfil** é o que passa pelo guarda com os módulos padrão do perfil. Restrições feitas dentro do handler (obra atribuída, saldos ocultos) não aparecem.
- **Duas rotas do legado** ficaram sem corpo descrito: `POST /prod/inventarios` e `POST /qual/amostras/:id/confirmar` (o esquema depende de variável do handler).

---

## Servidor MCP

<a id="p37"></a>
### P37 · Servidor MCP: o que falta · Média

O servidor está em `apps/mcp` e foi testado localmente contra banco, API e MCP reais: o fluxo OAuth passou em 26 verificações, 67 ferramentas de leitura responderam com dados reais e um cenário de 54 chamadas de escrita funcionou de ponta a ponta. Pendências:

- **Publicar:** segundo serviço no Railway com `apps/mcp/railway.json` e as variáveis de `apps/mcp/README.md`; `MCP_CALLBACK_URLS` no serviço da API.
- **Catálogo grande:** a lista das 152 ferramentas pesa 171 KB, enviada a cada conexão. O AIRO resolve com perfis de exposição (`?grupos=` e a ferramenta `habilitar_area`); não foi portado.
- **Ferramentas não exercitadas:** 14 de leitura (nota fiscal, medição de contrato, autorização de pagamento, patrimônio, permuta, visita, comparação de versões) e as de escrita fora do cenário (medições e autorizações de contrato, saída e transferência de estoque, notas fiscais, atualização de linha da planilha com serviço) só passaram por verificação de tipos.
- **Lacunas do catálogo:**
  - Plano de contas padrão (`POST /fin/plano-contas/padrao`), necessário em empresa nova (P35).
  - Reprovar pedido, contrato, medição e autorização (existe só o aprovar).
  - Encerrar pedido com saldo (`POST /sup/pedidos/:id/encerrar`): sem ela, um pedido recebido em parte não tem saída pelo MCP.
  - Criar versão do orçamento (`POST /eng/obras/:id/versoes`).
  - Entrada em estoque a partir de lançamento (campo `estoque` de `criar_lancamento`).
- **Descrições genéricas:** as ferramentas de Suprimentos citam "módulo Engenharia" e "módulo Financeiro" como origem de alguns ids (`necessidadeId`, `obraItemId`, `eapNoId`, `planoContaId`, `centroCustoId`). Trocar pelos nomes das ferramentas: `listar_necessidades_insumos`, `listar_itens_obra`, `listar_planilha_orcamentaria`, `listar_plano_contas`, `listar_centros_custo`.
- **Dependem de correção na API:** P28 (centavos), P31 (PUT que zera), P32 (campos ignorados) e P09 (quantidade) estão contornadas nas descrições e nos handlers das ferramentas; ao corrigir a API, simplificar as ferramentas.
