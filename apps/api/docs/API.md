# API do Agrega Construtoras

> Gerado do código por `npm run docs -w apps/api`. Não edite à mão: mude a rota e gere de novo.
> A versão completa, com tipos e limites de cada campo, está em [`openapi.json`](./openapi.json).

## Como usar

- **Autenticação:** `POST /api/auth/entrar` com `{ email, senha }` devolve o cookie `agrega_sessao`, válido por 12 horas. Envie o cookie em todas as chamadas.
- **Erros:** sempre `{ "erro": "mensagem" }`. Validação (400) traz também `campos: [{ campo, mensagem }]`. Sem login: 401. Sem permissão: 403. Conflito de estado: 409.
- **Respostas:** JSON em envelope nomeado (`{ obras: [...] }`). Os formatos de resposta ainda não estão descritos neste documento.
- **Valores:** dinheiro em reais (número), datas `AAAA-MM-DD`, identificadores UUID.
- **Servidor MCP:** rotas que só o servidor MCP chama, identificando-se com o segredo compartilhado no cabeçalho `X-MCP-Secret` (`MCP_API_SECRET`).
- **Acesso:** a coluna mostra os perfis que passam pelo guarda no padrão de cada perfil. Engenheiro e mestre de obra só alcançam as obras atribuídas a eles.
- **O que faz:** vem do comentário acima da rota no código. Rota sem comentário fica em branco.
- **Corpo e consulta:** campos de primeiro nível; `*` marca os obrigatórios. Os parâmetros de consulta são lidos do código e saem todos como texto.

Total: 417 rotas, 10 públicas, 4 do legado da concreteira.

## Engenharia

122 rotas.

| Rota | O que faz | Acesso | Consulta | Corpo |
|---|---|---|---|---|
| `GET /api/eng/engenheiros` |  | Dono, Gestor, Orçamentista |  |  |
| `GET /api/eng/tabelas` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra |  |  |
| `POST /api/eng/tabelas` |  | Dono, Gestor, Orçamentista |  | `fonte`*, `nome`*, `uf`, `mesReferencia`, `desonerado`, `csv` |
| `POST /api/eng/tabelas/mapear-ia` |  | Dono, Gestor, Orçamentista |  | `amostra`*, `uf`, `desonerado` |
| `POST /api/eng/tabelas/converter` |  | Dono, Gestor, Orçamentista |  | `texto`*, `tipoUnico`*, `valoresTipo`*, `tabelaId` |
| `POST /api/eng/tabelas/{id}/importar` |  | Dono, Gestor, Orçamentista |  | `csv`* |
| `GET /api/eng/tabelas/{id}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra |  |  |
| `PUT /api/eng/tabelas/{id}` |  | Dono, Gestor, Orçamentista |  | `nome`* |
| `GET /api/eng/tabelas/{id}/itens` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra | `tipo`, `busca` |  |
| `POST /api/eng/tabelas/{id}/itens` | Itens de tabela própria são editáveis; SINAPI é imutável (nova versão = nova importação). | Dono, Gestor, Orçamentista |  | `tipo`*, `codigo`, `descricao`*, `unidade`*, `grupo`, `preco`, `precoOrigem`, `unidadesCompra`, `componentes` |
| `GET /api/eng/tabelas/{id}/itens/{itemId}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra |  |  |
| `PUT /api/eng/tabelas/{id}/itens/{itemId}` |  | Dono, Gestor, Orçamentista |  | `descricao`, `unidade`, `grupo`, `preco`, `precoOrigem`, `unidadesCompra`, `componentes` |
| `DELETE /api/eng/tabelas/{id}/itens/{itemId}` |  | Dono, Gestor, Orçamentista |  |  |
| `POST /api/eng/tabelas/{id}/itens/{itemId}/preco-ultima-compra` |  | Dono, Gestor, Orçamentista |  |  |
| `GET /api/eng/obras` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra, Financeiro, Almoxarife |  |  |
| `POST /api/eng/obras` |  | Dono, Gestor, Orçamentista |  | `codigo`, `nome`, `endereco`, `cidade`, `uf`, `responsavel`, `contatoObraNome`, `contatoObraTelefone`, `referenciaEntrega`, `status`, `tipo`, `tipoCanteiro`, `eapPadrao`, `dataInicio`, `dataPrevisao`, `nivelApropriacao`, `bdiModo`, `bdiPercentual`, `horasDia`, `empresaGrupoId`, `responsaveis`, `bdiParametros` |
| `GET /api/eng/panorama` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra |  |  |
| `GET /api/eng/insumo-grupos` |  | Dono, Gestor, Orçamentista |  |  |
| `POST /api/eng/insumo-grupos` |  | Dono, Gestor, Orçamentista |  | `nome`*, `ordem` |
| `POST /api/eng/insumo-grupos/sugeridos` |  | Dono, Gestor, Orçamentista |  |  |
| `PUT /api/eng/insumo-grupos/{id}` |  | Dono, Gestor, Orçamentista |  | `nome`, `ordem` |
| `DELETE /api/eng/insumo-grupos/{id}` | Excluir o grupo não apaga insumos: eles ficam sem grupo ("Sem grupo"). | Dono, Gestor, Orçamentista |  |  |
| `PUT /api/eng/obras/{id}/insumos/grupo` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `itemIds`*, `grupoId`* |
| `GET /api/eng/servico-grupos` |  | Dono, Gestor, Orçamentista |  |  |
| `POST /api/eng/servico-grupos` |  | Dono, Gestor, Orçamentista |  | `nome`*, `ordem` |
| `POST /api/eng/servico-grupos/sugeridos` |  | Dono, Gestor, Orçamentista |  |  |
| `PUT /api/eng/servico-grupos/{id}` |  | Dono, Gestor, Orçamentista |  | `nome`, `ordem` |
| `DELETE /api/eng/servico-grupos/{id}` | Excluir o grupo não apaga serviços: eles ficam sem grupo ("Sem grupo"). | Dono, Gestor, Orçamentista |  |  |
| `PUT /api/eng/obras/{id}/servicos/grupo` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `itemIds`*, `grupoId`* |
| `POST /api/eng/obras/{id}/adotar-datas-planejamento` | Adota as datas do planejamento: início = primeira atividade; previsão = fim da última atividade. | Dono, Gestor, Orçamentista, Engenheiro de obra |  |  |
| `GET /api/eng/obras/{id}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra |  |  |
| `PUT /api/eng/obras/{id}` |  | Dono, Gestor, Orçamentista |  | `nome`, `endereco`, `cidade`, `uf`, `responsavel`, `contatoObraNome`, `contatoObraTelefone`, `referenciaEntrega`, `status`, `tipoCanteiro`, `dataInicio`, `dataPrevisao`, `nivelApropriacao`, `bdiModo`, `bdiPercentual`, `horasDia`, `empresaGrupoId`, `responsaveis`, `bdiParametros` |
| `GET /api/eng/obras/{id}/itens` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra, Financeiro, Almoxarife | `tipo`, `busca` |  |
| `GET /api/eng/obras/{id}/itens/{itemId}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra |  |  |
| `PATCH /api/eng/obras/{id}/itens/{itemId}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `descricao`, `unidade`, `preco`, `unidadesCompra` |
| `DELETE /api/eng/obras/{id}/itens/{itemId}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  |  |
| `POST /api/eng/obras/{id}/orcamento-importacao/previa` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `tabelaId`*, `linhas`* |
| `POST /api/eng/obras/{id}/importar` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `tabelaId`*, `composicaoIds`, `insumoIds` |
| `PUT /api/eng/obras/{id}/itens/{itemId}/composicao` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `componentes`* |
| `POST /api/eng/obras/{id}/servicos/salvar` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `modo`*, `itemId`*, `tabelaId`*, `codigo`, `descricao`*, `unidade`*, `componentes`* |
| `GET /api/eng/obras/{id}/eap` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra, Financeiro, Almoxarife |  |  |
| `GET /api/eng/obras/{id}/canteiro/vertical/pavimentos` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra |  |  |
| `POST /api/eng/obras/{id}/canteiro/vertical/pavimentos` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `nome`*, `ordem` |
| `DELETE /api/eng/obras/{id}/canteiro/vertical/pavimentos/{pid}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  |  |
| `PUT /api/eng/obras/{id}/canteiro/vertical/pavimentos/{pid}/ciclo` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `etapas`* |
| `GET /api/eng/obras/{id}/canteiro/vertical/agenda` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra | `inicio`, `fim` |  |
| `POST /api/eng/obras/{id}/canteiro/vertical/agenda` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `pavimentoId`*, `equipamento`*, `data`*, `inicio`*, `fim`*, `descricao` |
| `DELETE /api/eng/obras/{id}/canteiro/vertical/agenda/{aid}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  |  |
| `GET /api/eng/obras/{id}/canteiro/vertical/concretagens` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra | `pavimentoId` |  |
| `POST /api/eng/obras/{id}/canteiro/vertical/concretagens` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `pavimentoId`*, `data`*, `volumeM3`*, `fck`, `nota` |
| `DELETE /api/eng/obras/{id}/canteiro/vertical/concretagens/{cid}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  |  |
| `GET /api/eng/obras/{id}/canteiro/centrais/{tipo}/kanban` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra |  |  |
| `PATCH /api/eng/obras/{id}/canteiro/centrais/{tipo}/frentes/{fid}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `prioridade`, `ordem` |
| `PUT /api/eng/obras/{id}/canteiro/centrais/{tipo}/kanban/ordem` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `frentes`* |
| `POST /api/eng/obras/{id}/canteiro/centrais/{tipo}/frentes/{fid}/os` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  |  |
| `PATCH /api/eng/obras/{id}/canteiro/centrais/{tipo}/os/{oid}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `status`* |
| `GET /api/eng/obras/{id}/canteiro` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra |  |  |
| `GET /api/eng/obras/{id}/canteiro/centrais/{tipo}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra |  |  |
| `PUT /api/eng/obras/{id}/canteiro/centrais/{tipo}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `periodicidadeDias`, `servicos` |
| `POST /api/eng/obras/{id}/canteiro/centrais/{tipo}/boletins` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `inicio`, `fim` |
| `GET /api/eng/obras/{id}/canteiro/boletins/{bId}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra |  |  |
| `DELETE /api/eng/obras/{id}/canteiro/boletins/{bId}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  |  |
| `GET /api/eng/obras/{id}/planejamento` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra |  |  |
| `POST /api/eng/obras/{id}/planejamento` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `descricao`*, `eapNoId`, `inicio`*, `duracaoDias`*, `predecessoraId` |
| `PUT /api/eng/obras/{id}/planejamento/{atId}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `descricao`, `eapNoId`, `inicio`, `duracaoDias`, `predecessoraId` |
| `DELETE /api/eng/obras/{id}/planejamento/{atId}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  |  |
| `POST /api/eng/obras/{id}/planejamento/gerar-da-eap` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  |  |
| `GET /api/eng/obras/{id}/relatorios-planejamento/gantt` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra | `granularidade` |  |
| `GET /api/eng/obras/{id}/relatorios-planejamento/equipes` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra | `granularidade` |  |
| `GET /api/eng/obras/{id}/relatorios-planejamento/calendario` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra | `granularidade` |  |
| `GET /api/eng/obras/{id}/relatorios-planejamento/compras` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra | `classe` |  |
| `GET /api/eng/obras/{id}/acompanhamento/planilha` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra |  |  |
| `POST /api/eng/obras/{id}/acompanhamento/medicoes` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `data`*, `descricao`, `itens`*, `substituir` |
| `GET /api/eng/obras/{id}/acompanhamento/medicoes/{medId}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra |  |  |
| `DELETE /api/eng/obras/{id}/acompanhamento/medicoes/{medId}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  |  |
| `GET /api/eng/obras/{id}/relatorios-gerenciais/curva-s` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra |  |  |
| `GET /api/eng/obras/{id}/relatorios-gerenciais/previsto-realizado` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra | `data` |  |
| `GET /api/eng/obras/{id}/producao-equipe` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra | `mes` |  |
| `GET /api/eng/obras/{id}/equipes-servicos` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra |  |  |
| `PUT /api/eng/obras/{id}/equipes-servicos` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `eapNoId`*, `colaboradorId`*, `precoUnitario`* |
| `DELETE /api/eng/obras/{id}/equipes-servicos/{noId}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  |  |
| `GET /api/eng/obras/{id}/necessidades` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra |  |  |
| `POST /api/eng/obras/{id}/necessidades` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `itemId`*, `eapNoId`, `quantidade`*, `dataNecessaria`, `observacao` |
| `PUT /api/eng/obras/{id}/necessidades/{necId}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `eapNoId`, `quantidade`, `dataNecessaria`, `observacao`, `status` |
| `DELETE /api/eng/obras/{id}/necessidades/{necId}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  |  |
| `GET /api/eng/obras/{id}/relatorio-custos` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra |  |  |
| `GET /api/eng/obras/{id}/orcamento` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra |  |  |
| `GET /api/eng/obras/{id}/planilha` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra |  |  |
| `POST /api/eng/obras/{id}/planilha` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `nivel`*, `paiId`, `descricao`, `itemId`, `quantidade` |
| `POST /api/eng/obras/{id}/leitura-projeto` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `arquivo`*, `nome` |
| `PUT /api/eng/obras/{id}/planilha/{noId}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `descricao`, `nivel`, `itemId`, `quantidade` |
| `DELETE /api/eng/obras/{id}/planilha/{noId}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  |  |
| `POST /api/eng/obras/{id}/planilha/{noId}/mover` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `direcao`* |
| `GET /api/eng/obras/{id}/composicao` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra |  |  |
| `PUT /api/eng/obras/{id}/composicao` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `administracao`*, `imprevistos`*, `cdi`*, `lucro`*, `indiretos`*, `impostos`* |
| `GET /api/eng/obras/{id}/relatorio-abc` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra | `tipo` |  |
| `GET /api/eng/obras/{id}/relatorio-orcamento` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra | `tipo` |  |
| `GET /api/eng/obras/{id}/versoes` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra |  |  |
| `POST /api/eng/obras/{id}/versoes` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `nome`*, `observacao` |
| `DELETE /api/eng/obras/{id}/versoes/{versaoId}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  |  |
| `GET /api/eng/obras/{id}/comparacao` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra | `a`, `b` |  |
| `GET /api/eng/obras/{obraId}/rdos` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra |  |  |
| `POST /api/eng/obras/{obraId}/rdos` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `data`* |
| `GET /api/eng/obras/{obraId}/rdos/{id}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra |  |  |
| `PUT /api/eng/obras/{obraId}/rdos/{id}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `data`*, `climaManha`*, `climaTarde`*, `climaNoite`*, `responsavel`*, `observacoes`*, `maoDeObra`*, `equipamentos`*, `atividades`*, `ocorrencias`* |
| `DELETE /api/eng/obras/{obraId}/rdos/{id}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  |  |
| `POST /api/eng/obras/{obraId}/rdos/{id}/fotos` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `imagem`*, `tipo`*, `legenda` |
| `GET /api/eng/obras/{obraId}/rdos/{id}/fotos/{fotoId}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra |  |  |
| `PUT /api/eng/obras/{obraId}/rdos/{id}/fotos/{fotoId}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `legenda` |
| `DELETE /api/eng/obras/{obraId}/rdos/{id}/fotos/{fotoId}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  |  |
| `GET /api/eng/acompanhamento/obras` | Obras de acompanhamento que o usuário enxerga (engenheiro de obra: só as atribuídas a ele). | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra |  |  |
| `GET /api/eng/obras/{obraId}/visitas` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra |  |  |
| `POST /api/eng/obras/{obraId}/visitas` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `data`, `responsavel`, `observacoes` |
| `GET /api/eng/obras/{obraId}/visitas/{id}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra |  |  |
| `PUT /api/eng/obras/{obraId}/visitas/{id}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `data`*, `responsavel`*, `observacoes`* |
| `DELETE /api/eng/obras/{obraId}/visitas/{id}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  |  |
| `POST /api/eng/obras/{obraId}/visitas/{id}/assinaturas` | Assinatura do responsável pela visita, desenhada na tela do celular (quem está logado). | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `nome`*, `imagem`* |
| `POST /api/eng/obras/{obraId}/visitas/{id}/link-assinatura` | Gera o link para o dono da obra assinar a visita, sem login. Vale 30 dias; um link novo substitui o anterior. | Dono, Gestor, Orçamentista, Engenheiro de obra |  |  |
| `POST /api/eng/obras/{obraId}/visitas/{id}/fotos` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `imagem`*, `tipo`*, `legenda` |
| `GET /api/eng/obras/{obraId}/visitas/{id}/fotos/{fotoId}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Mestre de obra |  |  |
| `PUT /api/eng/obras/{obraId}/visitas/{id}/fotos/{fotoId}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  | `legenda` |
| `DELETE /api/eng/obras/{obraId}/visitas/{id}/fotos/{fotoId}` |  | Dono, Gestor, Orçamentista, Engenheiro de obra |  |  |

## Comercial

35 rotas.

| Rota | O que faz | Acesso | Consulta | Corpo |
|---|---|---|---|---|
| `GET /api/com/opcoes` |  | Dono, Gestor, Orçamentista, Comercial |  |  |
| `POST /api/com/clientes` |  | Dono, Gestor, Orçamentista, Comercial |  | `razaoSocial`*, `cnpjCpf`, `telefone`, `cidade`, `uf` |
| `GET /api/com/vendas` |  | Dono, Gestor, Orçamentista, Comercial | `vendedorId`, `status`, `de`, `ate` |  |
| `POST /api/com/vendas` |  | Dono, Gestor, Orçamentista, Comercial |  | `vendedorId`, `clienteId`*, `obra`, `endereco`, `contato`, `tracoId`*, `volume`*, `dataEntrega`*, `horaEntrega`, `bombeamento`, `precoM3`*, `taxaBomba`, `condicaoPagamento`, `formaPagamento`, `prazosDias`, `observacoes`, `enviar` |
| `GET /api/com/vendas/{id}` |  | Dono, Gestor, Orçamentista, Comercial |  |  |
| `PUT /api/com/vendas/{id}` |  | Dono, Gestor, Orçamentista, Comercial |  | `vendedorId`, `clienteId`*, `obra`, `endereco`, `contato`, `tracoId`*, `volume`*, `dataEntrega`*, `horaEntrega`, `bombeamento`, `precoM3`*, `taxaBomba`, `condicaoPagamento`, `formaPagamento`, `prazosDias`, `observacoes`, `enviar` |
| `POST /api/com/vendas/{id}/enviar` |  | Dono, Gestor, Orçamentista, Comercial |  |  |
| `POST /api/com/vendas/{id}/aprovar` |  | Dono, Gestor |  |  |
| `POST /api/com/vendas/{id}/reprovar` |  | Dono, Gestor |  | `motivo`* |
| `POST /api/com/vendas/{id}/cancelar` |  | Dono, Gestor, Orçamentista, Comercial |  | `motivo`* |
| `POST /api/com/vendas/{id}/finalizar-entrega` |  | Dono, Gestor, Orçamentista, Comercial |  | `adicionais`, `formaPagamento`, `prazosDias`, `observacao` |
| `GET /api/com/relatorios` | Vendas por vendedor e por cliente (pela data de entrega). Vendido = aprovadas e concluídas; entregue = cargas da venda. | Dono, Gestor, Orçamentista, Comercial |  |  |
| `GET /api/com/propostas` |  | Dono, Gestor, Orçamentista, Comercial |  |  |
| `POST /api/com/propostas` |  | Dono, Gestor, Orçamentista, Comercial |  | `clienteId`*, `tracoId`*, `obra`, `endereco`, `volume`*, `precoM3`*, `condicoes`, `validadeDias`, `texto` |
| `GET /api/com/propostas/referencia` | Preço de referência para o formulário: o último preço do cliente neste traço. | Dono, Gestor, Orçamentista, Comercial | `clienteId`, `tracoId` |  |
| `GET /api/com/propostas/{id}` |  | Dono, Gestor, Orçamentista, Comercial |  |  |
| `PUT /api/com/propostas/{id}` |  | Dono, Gestor, Orçamentista, Comercial |  | `clienteId`*, `tracoId`*, `obra`, `endereco`, `volume`*, `precoM3`*, `condicoes`, `validadeDias`, `texto` |
| `POST /api/com/propostas/{id}/redigir` | A IA redige o texto com os dados da proposta e o histórico de preço do cliente. Sem IA, usa o texto-modelo. | Dono, Gestor, Orçamentista, Comercial |  |  |
| `POST /api/com/propostas/{id}/status` |  | Dono, Gestor, Orçamentista, Comercial |  | `status`* |
| `POST /api/com/propostas/{id}/vincular` |  | Dono, Gestor, Orçamentista, Comercial |  | `vendaId`* |
| `GET /api/com/obra-propostas/opcoes` |  | Dono, Gestor, Orçamentista, Comercial |  |  |
| `GET /api/com/obra-propostas/servicos` |  | Dono, Gestor, Orçamentista, Comercial | `obraId` |  |
| `GET /api/com/obra-propostas` |  | Dono, Gestor, Orçamentista, Comercial |  |  |
| `POST /api/com/obra-propostas` |  | Dono, Gestor, Orçamentista, Comercial |  | `tipo`*, `clienteId`*, `obraId`, `titulo`*, `objeto`, `endereco`, `prazoDias`, `validadeDias`, `origemPreco`*, `parametros`*, `itens`, `condicoes` |
| `GET /api/com/contratos-cliente/relatorio` | Relatório de contratos com clientes no período (data de criação do contrato). | Dono, Gestor, Orçamentista, Comercial | `de`, `ate` |  |
| `GET /api/com/contratos-cliente/{id}` | Contratos com clientes, gerados pela aceitação de propostas de obra. | Dono, Gestor, Orçamentista, Comercial |  |  |
| `GET /api/com/contratos-cliente` |  | Dono, Gestor, Orçamentista, Comercial |  |  |
| `POST /api/com/obra-propostas/calcular` |  | Dono, Gestor, Orçamentista, Comercial |  | `tipo`*, `obraId`, `origemPreco`*, `parametros`*, `itens` |
| `GET /api/com/obra-propostas/{id}` |  | Dono, Gestor, Orçamentista, Comercial |  |  |
| `PUT /api/com/obra-propostas/{id}` |  | Dono, Gestor, Orçamentista, Comercial |  | `tipo`*, `clienteId`*, `obraId`, `titulo`*, `objeto`, `endereco`, `prazoDias`, `validadeDias`, `origemPreco`*, `parametros`*, `itens`, `condicoes` |
| `POST /api/com/obra-propostas/{id}/revisar-ia` |  | Dono, Gestor, Orçamentista, Comercial |  |  |
| `POST /api/com/obra-propostas/{id}/enviar` |  | Dono, Gestor, Orçamentista, Comercial |  |  |
| `POST /api/com/obra-propostas/{id}/recusar` |  | Dono, Gestor |  |  |
| `POST /api/com/obra-propostas/{id}/cancelar` |  | Dono, Gestor, Orçamentista, Comercial |  |  |
| `POST /api/com/obra-propostas/{id}/aceitar` |  | Dono, Gestor |  |  |

## Incorporação

4 rotas.

| Rota | O que faz | Acesso | Consulta | Corpo |
|---|---|---|---|---|
| `POST /api/com/incorporacao/estudos-disponiveis` | Lista os estudos aprovados que o usuário do Viabiliza pode importar. | Dono, Gestor |  | `email`*, `senha`* |
| `POST /api/com/incorporacao/importar` | Importa um estudo aprovado: cria ou atualiza o empreendimento e as unidades, e registra a importação. | Dono, Gestor |  | `email`*, `senha`*, `estudoId`* |
| `GET /api/com/incorporacao/empreendimentos` |  | Dono, Gestor |  |  |
| `GET /api/com/incorporacao/empreendimentos/{id}` |  | Dono, Gestor |  |  |

## Laudos

11 rotas.

| Rota | O que faz | Acesso | Consulta | Corpo |
|---|---|---|---|---|
| `GET /api/laudos` |  | Dono, Gestor | `tipo` |  |
| `POST /api/laudos` |  | Dono, Gestor |  | `tipo`* |
| `GET /api/laudos/{id}` |  | Dono, Gestor |  |  |
| `PUT /api/laudos/{id}` |  | Dono, Gestor |  | `titulo`, `dados` |
| `DELETE /api/laudos/{id}` |  | Dono, Gestor |  |  |
| `GET /api/laudos/{id}/anexos` |  | Dono, Gestor |  |  |
| `POST /api/laudos/{id}/anexos` |  | Dono, Gestor |  | `nome`*, `tipo`*, `categoria`, `legenda`, `arquivo`* |
| `GET /api/laudos/{id}/anexos/{anexoId}` |  | Dono, Gestor |  |  |
| `DELETE /api/laudos/{id}/anexos/{anexoId}` |  | Dono, Gestor |  |  |
| `POST /api/laudos/ler-identificacao` |  | Dono, Gestor |  | `arquivo`*, `nome` |
| `POST /api/laudos/ler-glp` |  | Dono, Gestor |  | `arquivo`*, `nome` |

## Suprimentos

87 rotas.

| Rota | O que faz | Acesso | Consulta | Corpo |
|---|---|---|---|---|
| `GET /api/sup/estoque` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo, Almoxarife |  |  |
| `POST /api/sup/estoque/transferencias` |  | Dono, Gestor, Comprador, Administrativo, Almoxarife |  | `obraId`*, `obraItemId`*, `eapNoId`*, `origemId`*, `destinoId`*, `data`*, `quantidade`*, `observacao` |
| `GET /api/sup/obras/{obraId}/estoques` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo, Almoxarife |  |  |
| `POST /api/sup/obras/{obraId}/estoques` |  | Dono, Gestor, Comprador, Administrativo, Almoxarife |  | `nome`* |
| `PUT /api/sup/estoques/{id}` |  | Dono, Gestor, Comprador, Administrativo, Almoxarife |  | `nome`, `ativo` |
| `GET /api/sup/estoques` |  | Dono, Gestor, Engenheiro de obra, Comprador, Financeiro, Administrativo, Almoxarife |  |  |
| `POST /api/sup/estoques` |  | Dono, Gestor, Comprador, Administrativo, Almoxarife |  | `nome`*, `obraId` |
| `GET /api/sup/etiquetas` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo, Almoxarife |  |  |
| `GET /api/sup/etiquetas/{id}` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo, Almoxarife |  |  |
| `GET /api/sup/colaboradores` | Colaboradores: o mesmo cadastro do Administrativo (motoristas), só os ativos. Quem pega material na saída. | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo, Almoxarife |  |  |
| `GET /api/sup/saidas-material` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo, Almoxarife |  |  |
| `POST /api/sup/saidas-material` |  | Dono, Gestor, Comprador, Administrativo, Almoxarife |  | `obraId`*, `eapNoId`*, `colaboradorId`*, `data`*, `observacao`, `itens`* |
| `GET /api/sup/solicitacoes` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo |  |  |
| `POST /api/sup/solicitacoes` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo |  | `obraId`*, `data`, `necessidade`, `observacao`, `itens`* **ou** `tipo`, `obraId`*, `data`, `necessidade`, `observacao`, `planoContaId`*, `escopo`*, `itens`* |
| `GET /api/sup/solicitacoes/{id}` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo |  |  |
| `PUT /api/sup/solicitacoes/{id}` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo |  | `obraId`*, `data`, `necessidade`, `observacao`, `itens`* **ou** `tipo`, `obraId`*, `data`, `necessidade`, `observacao`, `planoContaId`*, `escopo`*, `itens`* |
| `POST /api/sup/solicitacoes/{id}/finalizar` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo |  |  |
| `POST /api/sup/solicitacoes/{id}/reabrir` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo |  |  |
| `POST /api/sup/solicitacoes/{id}/cancelar` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo |  |  |
| `GET /api/sup/conferencia-unidades` | Linhas de nota ligadas a um item de pedido cuja unidade do insumo é diferente da unidade do pedido. | Dono, Gestor, Comprador, Administrativo |  |  |
| `PATCH /api/sup/conferencia-unidades/{id}` |  | Dono, Gestor, Comprador, Administrativo |  | `fatorEstoque`* |
| `GET /api/sup/cotacoes` |  | Dono, Gestor, Comprador, Administrativo |  |  |
| `POST /api/sup/cotacoes` |  | Dono, Gestor, Comprador, Administrativo |  | `solicitacaoId`*, `data`, `prazoResposta`, `observacao`, `fornecedorIds` |
| `GET /api/sup/cotacoes/{id}` |  | Dono, Gestor, Comprador, Administrativo |  |  |
| `PUT /api/sup/cotacoes/{id}/fornecedores` |  | Dono, Gestor, Comprador, Administrativo |  | `fornecedorIds`* |
| `PUT /api/sup/cotacoes/{id}/respostas/{cf}` |  | Dono, Gestor, Comprador, Administrativo |  | `prazoEntregaDias`, `condicaoPagamento`, `frete`, `desconto`, `validade`, `observacao`, `precos`* |
| `GET /api/sup/servicos/{obraItemId}/saldo` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo | `obraId` |  |
| `GET /api/sup/cotacoes/leitura-ia` | Só sugere preços e condições: nada é gravado aqui. O usuário confere na tela e salva pela resposta do fornecedor. | Dono, Gestor, Comprador, Administrativo |  |  |
| `POST /api/sup/cotacoes/{id}/leitura-ia` |  | Dono, Gestor, Comprador, Administrativo |  | `arquivo`*, `tipo`* |
| `PUT /api/sup/cotacoes/{id}/vencedores` |  | Dono, Gestor, Comprador, Administrativo |  | `menorPreco`, `itens`, `justificativa` |
| `POST /api/sup/cotacoes/{id}/concluir` | Conclui o mapa: um pedido (rascunho) para cada fornecedor vencedor. | Dono, Gestor, Comprador, Administrativo |  |  |
| `POST /api/sup/cotacoes/{id}/cancelar` |  | Dono, Gestor, Comprador, Administrativo |  |  |
| `GET /api/sup/pedidos` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo, Almoxarife |  |  |
| `GET /api/sup/pedidos/{id}` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo, Almoxarife |  |  |
| `PUT /api/sup/pedidos/{id}` | Pedidos nascem da cotação concluída (um por fornecedor vencedor). Aqui só o cabeçalho é editado; os itens são os da cotação. | Dono, Gestor, Comprador, Administrativo |  | `fornecedorId`*, `data`*, `previsaoEntrega`*, `condicaoPagamento`*, `localEntrega`*, `frete`*, `freteTipo`*, `transportadoraId`*, `centroCustoId`*, `observacao`* |
| `POST /api/sup/pedidos/{id}/enviar-aprovacao` |  | Dono, Gestor, Comprador, Administrativo |  |  |
| `POST /api/sup/pedidos/{id}/aprovar` |  | Dono, Gestor, Comprador, Administrativo |  |  |
| `POST /api/sup/pedidos/{id}/reprovar` |  | Dono, Gestor, Comprador, Administrativo |  | `motivo`* |
| `POST /api/sup/pedidos/{id}/enviado` |  | Dono, Gestor, Comprador, Administrativo |  |  |
| `POST /api/sup/pedidos/{id}/cancelar` |  | Dono, Gestor, Comprador, Administrativo |  | `motivo` |
| `POST /api/sup/pedidos/{id}/reabrir` | Reabre um pedido cancelado: volta para rascunho. Só vale se nenhuma nota estiver ligada a ele e se a compra não tiver sido refeita em outra cotação. | Dono, Gestor, Comprador, Administrativo |  |  |
| `POST /api/sup/pedidos/{id}/encerrar` |  | Dono, Gestor, Comprador, Administrativo |  | `motivo`* |
| `GET /api/sup/pedidos/{id}/notas-candidatas` |  | Dono, Gestor, Comprador, Administrativo |  |  |
| `PUT /api/sup/pedidos/{id}/recebimento` |  | Dono, Gestor, Comprador, Administrativo |  | `notaId`*, `itens`* |
| `DELETE /api/sup/pedidos/{id}/recebimento/{nota}` |  | Dono, Gestor, Comprador, Administrativo |  |  |
| `GET /api/sup/relatorios` |  | Dono, Gestor, Comprador, Administrativo |  |  |
| `GET /api/sup/contratos` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo |  |  |
| `POST /api/sup/contratos` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo |  | `obraId`, `fornecedorId`*, `objeto`*, `tipo`*, `dataAssinatura`, `inicio`*, `fim`, `valorGlobal`, `planoContaId`*, `centroCustoId`, `prazoPagamentoDias`, `formaPagamento`, `enderecoContratante`, `enderecoContratada`, `prazoCorrecaoDias`, `garantiaMeses`, `retencoes`, `observacao`, `itens` |
| `GET /api/sup/contratos/{id}` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo |  |  |
| `PUT /api/sup/contratos/{id}` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo |  | `obraId`, `fornecedorId`*, `objeto`*, `tipo`*, `dataAssinatura`, `inicio`*, `fim`, `valorGlobal`, `planoContaId`*, `centroCustoId`, `prazoPagamentoDias`, `formaPagamento`, `enderecoContratante`, `enderecoContratada`, `prazoCorrecaoDias`, `garantiaMeses`, `retencoes`, `observacao`, `itens` |
| `PATCH /api/sup/contratos/{id}/prazos` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo |  | `prazoCorrecaoDias`*, `garantiaMeses`* |
| `POST /api/sup/contratos/{id}/enviar-aprovacao` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo |  |  |
| `POST /api/sup/contratos/{id}/aprovar` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo |  |  |
| `POST /api/sup/contratos/{id}/reprovar` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo |  | `motivo`* |
| `POST /api/sup/contratos/{id}/encerrar` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo |  |  |
| `POST /api/sup/contratos/{id}/reabrir` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo |  |  |
| `POST /api/sup/contratos/{id}/restaurar` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo |  |  |
| `POST /api/sup/contratos/{id}/cancelar` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo |  |  |
| `GET /api/sup/medicoes` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo |  |  |
| `POST /api/sup/medicoes` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo |  | `contratoId`*, `periodoInicio`*, `periodoFim`*, `data`, `observacao`, `itens`, `valor`, `percentual`, `descontos` |
| `GET /api/sup/medicoes/{id}` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo |  |  |
| `PUT /api/sup/medicoes/{id}` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo |  | `contratoId`*, `periodoInicio`*, `periodoFim`*, `data`, `observacao`, `itens`, `valor`, `percentual`, `descontos` |
| `POST /api/sup/medicoes/{id}/enviar-aprovacao` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo |  |  |
| `POST /api/sup/medicoes/{id}/aprovar` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo |  |  |
| `POST /api/sup/medicoes/{id}/reprovar` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo |  | `motivo`* |
| `POST /api/sup/medicoes/{id}/cancelar` |  | Dono, Gestor, Engenheiro de obra, Comprador, Administrativo |  |  |
| `GET /api/sup/autorizacoes` |  | Dono, Gestor, Comprador, Administrativo |  |  |
| `POST /api/sup/autorizacoes` |  | Dono, Gestor, Comprador, Administrativo |  | `medicaoId`, `contratoId`, `tipo`, `vencimento`, `documento`, `formaPagamento`, `observacao`, `retencoes` |
| `GET /api/sup/autorizacoes/{id}` |  | Dono, Gestor, Comprador, Administrativo |  |  |
| `POST /api/sup/autorizacoes/{id}/aprovar` |  | Dono, Gestor, Comprador, Administrativo |  |  |
| `POST /api/sup/autorizacoes/{id}/reprovar` |  | Dono, Gestor, Comprador, Administrativo |  | `motivo`* |
| `POST /api/sup/autorizacoes/{id}/cancelar` |  | Dono, Gestor, Comprador, Administrativo |  |  |
| `GET /api/sup/relatorios/contratos` |  | Dono, Gestor, Comprador, Administrativo | `de`, `ate` |  |
| `GET /api/sup/patrimonio` |  | Administrador do sistema, Dono, Gestor, Engenheiro de obra, Comprador, Administrativo, Almoxarife |  |  |
| `POST /api/sup/patrimonio` |  | Dono, Gestor |  | `nome`*, `marca`, `serie`, `dataAquisicao`*, `valorAquisicao`*, `valorResidual`, `vidaUtilMeses`* |
| `GET /api/sup/patrimonio/{id}` |  | Administrador do sistema, Dono, Gestor, Engenheiro de obra, Comprador, Administrativo, Almoxarife |  |  |
| `PUT /api/sup/patrimonio/{id}` |  | Dono, Gestor |  | `nome`*, `marca`, `serie`, `dataAquisicao`*, `valorAquisicao`*, `valorResidual`, `vidaUtilMeses`* |
| `POST /api/sup/patrimonio/{id}/situacao` |  | Dono, Gestor |  | `status`* |
| `POST /api/sup/patrimonio/{id}/retirar` |  | Administrador do sistema, Dono, Gestor, Engenheiro de obra, Comprador, Administrativo, Almoxarife |  | `obraId`*, `responsavel`*, `observacao` |
| `POST /api/sup/patrimonio/{id}/devolver` |  | Administrador do sistema, Dono, Gestor, Engenheiro de obra, Comprador, Administrativo, Almoxarife |  | `estado`, `observacao` |
| `GET /api/sup/permutas` |  | Dono, Gestor, Comprador, Administrativo | `obraId` |  |
| `POST /api/sup/permutas` |  | Dono, Gestor, Comprador, Administrativo |  | `obraId`*, `fornecedorId`*, `data`*, `observacao`, `materiais`*, `servicos`* |
| `GET /api/sup/permutas/{id}` |  | Dono, Gestor, Comprador, Administrativo |  |  |
| `PUT /api/sup/permutas/{id}` |  | Dono, Gestor, Comprador, Administrativo |  | `obraId`*, `fornecedorId`*, `data`*, `observacao`, `materiais`*, `servicos`* |
| `POST /api/sup/permutas/{id}/compensar` |  | Dono, Gestor, Comprador, Administrativo |  |  |
| `POST /api/sup/permutas/{id}/cancelar` |  | Dono, Gestor, Comprador, Administrativo |  |  |
| `POST /api/sup/permutas/{id}/nota-emitida` |  | Dono, Gestor, Comprador, Administrativo |  | `emitida`* |

## Financeiro

71 rotas.

| Rota | O que faz | Acesso | Consulta | Corpo |
|---|---|---|---|---|
| `GET /api/fin/contas` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Comprador, Financeiro, Administrativo, Comercial |  |  |
| `POST /api/fin/contas` |  | Dono, Gestor, Financeiro |  | `nome`*, `tipo`, `banco`, `agencia`, `conta`, `saldoInicial`, `dataSaldoInicial`, `ativo` |
| `PATCH /api/fin/contas/{id}` |  | Dono, Gestor, Financeiro |  | `nome`, `tipo`, `banco`, `agencia`, `conta`, `saldoInicial`, `dataSaldoInicial`, `ativo` |
| `GET /api/fin/contas/{id}/extrato` | Extrato de uma conta: pagamentos, recebimentos e transferências com saldo acumulado. | Dono, Gestor, Financeiro | `de`, `ate` |  |
| `GET /api/fin/transferencias` |  | Dono, Gestor, Financeiro | `de`, `ate` |  |
| `POST /api/fin/transferencias` |  | Dono, Gestor, Financeiro |  | `origemId`*, `destinoId`*, `data`*, `valor`*, `descricao` |
| `DELETE /api/fin/transferencias/{id}` |  | Dono, Gestor, Financeiro |  |  |
| `GET /api/fin/plano-contas` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Comprador, Financeiro, Administrativo, Comercial |  |  |
| `POST /api/fin/plano-contas` |  | Dono, Gestor, Financeiro |  | `codigo`*, `nome`*, `tipo`*, `linhaDre`*, `aceitaLancamento` |
| `PATCH /api/fin/plano-contas/{id}` |  | Dono, Gestor, Financeiro |  | `nome`, `linhaDre`, `tipo`, `ativo` |
| `POST /api/fin/plano-contas/padrao` | Aplica o plano padrão de construtora e os centros de custo padrão (só cria o que falta). | Dono, Gestor, Financeiro |  |  |
| `GET /api/fin/centros-custo` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Comprador, Financeiro, Administrativo, Comercial |  |  |
| `POST /api/fin/centros-custo` |  | Dono, Gestor, Financeiro |  | `nome`*, `ativo` |
| `PATCH /api/fin/centros-custo/{id}` |  | Dono, Gestor, Financeiro |  | `nome`, `ativo` |
| `GET /api/fin/lancamentos` |  | Dono, Gestor, Financeiro |  |  |
| `POST /api/fin/lancamentos` |  | Dono, Gestor, Financeiro |  | `tipo`*, `competencia`*, `descricao`*, `documento`, `clienteId`, `fornecedorId`, `observacoes`, `valorTotal`*, `apropriacoes`*, `parcelas`*, `baixa`, `recorrencia`, `repeticoes`, `estoque`, `pedidoId` |
| `GET /api/fin/lancamentos/leitura` | Pedidos de compra aprovados (ou já em andamento) que ainda não viraram despesa: para preencher o lançamento. A IA só sugere os campos; o lançamento só é salvo depois de conferido no formulário. | Dono, Gestor, Financeiro |  |  |
| `POST /api/fin/lancamentos/leitura` |  | Dono, Gestor, Financeiro |  | `arquivo`*, `tipo`*, `tipoLancamento`* |
| `GET /api/fin/lancamentos/pedidos-disponiveis` |  | Dono, Gestor, Financeiro |  |  |
| `GET /api/fin/lancamentos/pedidos-disponiveis/{id}/estoque` | Itens de estoque sugeridos pelo pedido: obra, insumo da obra e etapa vêm da solicitação de compra que originou o pedido; quantidade, unidade e valor são os comprados (do pedido). | Dono, Gestor, Financeiro |  |  |
| `GET /api/fin/lancamentos/{id}` |  | Dono, Gestor, Financeiro |  |  |
| `PUT /api/fin/lancamentos/{id}` | Edição: as parcelas pagas ficam como estão; "parcelas" traz só as parcelas em aberto (substituídas). | Dono, Gestor, Financeiro |  | `tipo`*, `competencia`*, `descricao`*, `documento`*, `clienteId`*, `fornecedorId`*, `observacoes`*, `valorTotal`*, `apropriacoes`*, `parcelas`* |
| `POST /api/fin/lancamentos/{id}/cancelar` |  | Dono, Gestor, Financeiro |  | `seguintes` |
| `GET /api/fin/parcelas` |  | Dono, Gestor, Financeiro |  |  |
| `POST /api/fin/parcelas/{id}/baixar` |  | Dono, Gestor, Financeiro |  | `data`*, `contaId`*, `forma`, `juros`, `desconto`, `observacoes` |
| `GET /api/fin/parcelas/{id}/recibo` |  | Dono, Gestor, Financeiro |  |  |
| `POST /api/fin/parcelas/baixar-lote` |  | Dono, Gestor, Financeiro |  | `data`*, `contaId`*, `forma`, `observacoes`, `ids`* |
| `POST /api/fin/parcelas/{id}/estornar` |  | Dono, Gestor, Financeiro |  |  |
| `PATCH /api/fin/parcelas/{id}` |  | Dono, Gestor, Financeiro |  | `vencimento`, `observacoes` |
| `GET /api/fin/resumo` |  | Dono, Gestor, Orçamentista, Comprador, Financeiro, Administrativo, Comercial |  |  |
| `GET /api/fin/notas` |  | Dono, Gestor, Financeiro |  |  |
| `POST /api/fin/notas` |  | Dono, Gestor, Financeiro |  | `direcao`, `modelo`, `numero`, `serie`, `chaveAcesso`, `dataEmissao`*, `competencia`, `fornecedorId`, `clienteId`, `frete`, `desconto`, `outras`, `formaPagamento`, `observacoes`, `itens`*, `duplicatas` |
| `GET /api/fin/notas/{id}` |  | Dono, Gestor, Financeiro |  |  |
| `PATCH /api/fin/notas/{id}` |  | Dono, Gestor, Financeiro |  | `competencia`, `observacoes`, `fornecedorId`, `clienteId`, `formaPagamento`, `duplicatas`, `modelo`, `numero`, `serie`, `dataEmissao`, `frete`, `desconto`, `outras` |
| `DELETE /api/fin/notas/{id}` | Exclusão do rascunho (importou errado): libera a chave para importar de novo. | Dono, Gestor, Financeiro |  |  |
| `PUT /api/fin/notas/{id}/pedido` |  | Dono, Gestor, Financeiro |  | `itens`*, `pedidoId`* |
| `GET /api/fin/notas/{id}/pedidos-candidatos` | Pedidos de compra do mesmo fornecedor que podem receber esta nota, com o cruzamento sugerido dos itens. | Dono, Gestor, Financeiro |  |  |
| `GET /api/fin/notas/{id}/xml` |  | Dono, Gestor, Financeiro |  |  |
| `POST /api/fin/notas/xml` |  | Dono, Gestor, Financeiro |  | `xml`* |
| `GET /api/fin/notas/{id}/arquivo` |  | Dono, Gestor, Financeiro |  |  |
| `GET /api/fin/notas/leitura` |  | Dono, Gestor, Financeiro |  |  |
| `POST /api/fin/notas/pdf` |  | Dono, Gestor, Financeiro |  | `arquivo`*, `nome`, `tipo`, `chave`, `usarIa` |
| `POST /api/fin/notas/{id}/reler` |  | Dono, Gestor, Financeiro |  |  |
| `POST /api/fin/notas/chave` |  | Dono, Gestor, Financeiro |  | `chave`* |
| `POST /api/fin/notas/{id}/itens` |  | Dono, Gestor, Financeiro |  | `descricao`*, `unidade`, `quantidade`, `valor`*, `planoContaId`, `centroCustoId`, `veiculoId` |
| `POST /api/fin/notas/itens/{id}/dividir` |  | Dono, Gestor, Financeiro |  | `quantidade`* |
| `PATCH /api/fin/notas/itens/{id}` |  | Dono, Gestor, Financeiro |  | `planoContaId`, `centroCustoId`, `veiculoId`, `obraId`, `obraItemId`, `eapNoId`, `obraEstoqueId`, `insumoId`, `fatorEstoque`, `descricao`, `unidade`, `quantidade`, `valor`, `pedidoItemId`, `quantidadePedido` |
| `DELETE /api/fin/notas/itens/{id}` |  | Dono, Gestor, Financeiro |  |  |
| `POST /api/fin/notas/{id}/apropriar` |  | Dono, Gestor, Financeiro |  | `planoContaId`*, `centroCustoId`, `veiculoId`, `somenteSemCategoria` |
| `GET /api/fin/notas/itens/{id}/candidatos` |  | Dono, Gestor, Financeiro |  |  |
| `PUT /api/fin/notas/itens/{id}/vinculos` |  | Dono, Gestor, Financeiro |  | `abastecimentoIds`, `osItemIds` |
| `POST /api/fin/notas/{id}/confirmar` |  | Dono, Gestor, Financeiro |  | `vencimento`, `baixa`, `aprender` |
| `POST /api/fin/notas/{id}/reabrir` |  | Dono, Gestor, Financeiro |  |  |
| `POST /api/fin/notas/{id}/cancelar` | Cancelamento: a nota foi cancelada pelo emitente. Fica no histórico, sem valor. | Dono, Gestor, Financeiro |  |  |
| `GET /api/fin/regras-apropriacao` |  | Dono, Gestor, Financeiro |  |  |
| `POST /api/fin/regras-apropriacao` |  | Dono, Gestor, Financeiro |  | `fornecedorId`, `textoContem`, `ncm`, `planoContaId`*, `centroCustoId`, `veiculoId` |
| `PATCH /api/fin/regras-apropriacao/{id}` |  | Dono, Gestor, Financeiro |  | `ativo`* |
| `GET /api/fin/conciliacao/resumo` | Situação de cada conta: linhas pendentes e comparação do saldo do banco com o do Agrega. | Dono, Gestor, Financeiro |  |  |
| `GET /api/fin/conciliacao/extratos` |  | Dono, Gestor, Financeiro | `contaId` |  |
| `POST /api/fin/conciliacao/ofx` |  | Dono, Gestor, Financeiro |  | `contaId`*, `conteudo`*, `arquivo` |
| `GET /api/fin/conciliacao/linhas` |  | Dono, Gestor, Financeiro |  |  |
| `GET /api/fin/conciliacao/linhas/{id}/candidatos` | Parcelas e transferências que podem corresponder à linha. | Dono, Gestor, Financeiro | `busca` |  |
| `POST /api/fin/conciliacao/linhas/{id}/conciliar` |  | Dono, Gestor, Financeiro |  | `parcelaId`, `transferenciaId` |
| `POST /api/fin/conciliacao/aceitar-sugestoes` |  | Dono, Gestor, Financeiro |  | `contaId`*, `ids` |
| `POST /api/fin/conciliacao/linhas/{id}/lancamento` |  | Dono, Gestor, Financeiro |  | `planoContaId`*, `centroCustoId`, `veiculoId`, `fornecedorId`, `clienteId`, `descricao` |
| `POST /api/fin/conciliacao/linhas/{id}/transferencia` |  | Dono, Gestor, Financeiro |  | `outraContaId`* |
| `POST /api/fin/conciliacao/linhas/{id}/ignorar` |  | Dono, Gestor, Financeiro |  |  |
| `POST /api/fin/conciliacao/linhas/{id}/desfazer` | Desfaz o que a conciliação fez: estorna a baixa, cancela o lançamento criado ou exclui a transferência criada. | Dono, Gestor, Financeiro |  |  |
| `POST /api/fin/conciliacao/sugerir` |  | Dono, Gestor, Financeiro |  | `contaId`* |
| `DELETE /api/fin/conciliacao/extratos/{id}` | Remove um extrato importado por engano (só se nenhuma linha dele estiver conciliada). | Dono, Gestor, Financeiro |  |  |
| `GET /api/rel/financeiro` |  | Dono, Gestor, Financeiro |  |  |

## Gerencial

12 rotas.

| Rota | O que faz | Acesso | Consulta | Corpo |
|---|---|---|---|---|
| `GET /api/ger/dre` |  | Dono, Gestor, Financeiro | `visao`, `impostos` |  |
| `GET /api/ger/fluxo` |  | Dono, Gestor, Financeiro | `semanas` |  |
| `GET /api/rel/gerencial` |  | Dono, Gestor, Financeiro |  |  |
| `GET /api/rel/comercial` | Comercial mês a mês: vendas aprovadas (pela data de entrega) e propostas emitidas × fechadas (pela data de criação). | Dono, Gestor, Financeiro |  |  |
| `GET /api/rel/indicadores` |  | Dono, Gestor, Financeiro |  |  |
| `GET /api/ger/aprovacoes` |  | Dono, Gestor, Financeiro |  |  |
| `GET /api/ger/config` |  | Dono, Gestor, Financeiro |  |  |
| `PUT /api/ger/config` |  | Dono |  | `adminAte`*, `dispensaAte`* |
| `GET /api/ger/regras-producao` |  | Dono, Gestor, Financeiro |  |  |
| `POST /api/ger/regras-producao` |  | Dono, Gestor, Financeiro |  | `funcao`*, `base`, `modo`, `vigencia`*, `faixas`* |
| `DELETE /api/ger/regras-producao/{id}` |  | Dono, Gestor, Financeiro |  |  |
| `GET /api/ger/producao-equipe` |  | Dono, Gestor, Financeiro | `mes` |  |

## Administrativo

29 rotas.

| Rota | O que faz | Acesso | Consulta | Corpo |
|---|---|---|---|---|
| `GET /api/admin/material/{arquivo}` |  | Administrador do sistema, Administrativo |  |  |
| `GET /api/admin/avisos` | Avisos não lidos para o administrador do sistema (ex.: empresa acima do limite de empreendimentos). | Administrador do sistema, Administrativo |  |  |
| `POST /api/admin/avisos/{id}/lido` |  | Administrador do sistema, Administrativo |  |  |
| `GET /api/admin/empresas` |  | Administrador do sistema, Administrativo |  |  |
| `POST /api/admin/empresas` |  | Administrador do sistema, Administrativo |  | `razaoSocial`*, `nomeFantasia`, `cnpj`*, `regimeTributario`*, `aliquotasDre`, `simplesAnexo`, `simplesFaixa`, `telefone`, `email`, `cidade`, `uf`, `dono`* |
| `GET /api/admin/empresas/{id}/dados` | Ficha da construtora cadastrada: dados da empresa, dono e usuários (sem senhas). | Administrador do sistema, Administrativo |  |  |
| `GET /api/admin/empresas/{id}/apresentacao` | Apresentação para o período de testes, endereçada à construtora cadastrada (dono como responsável). | Administrador do sistema, Administrativo |  |  |
| `GET /api/admin/acompanhamento` | Acompanhamento das construtoras contratadas: usuários ativos e perfis em uso, obras ativas e período de teste. | Administrador do sistema, Administrativo |  |  |
| `POST /api/admin/empresas/{id}/aceite` | Link de aceite do período de testes para uma construtora cadastrada. Quem aceita pelo link inicia o teste dela. | Administrador do sistema, Administrativo |  |  |
| `GET /api/admin/proposta/condicoes` | Condições padrão da proposta: o painel usa para preencher o formulário de condições. | Administrador do sistema, Administrativo |  |  |
| `GET /api/admin/empresas/{id}/proposta` | Proposta comercial de uma construtora já cadastrada: pacote e limites do contrato, dono como responsável. | Administrador do sistema, Administrativo |  |  |
| `PUT /api/admin/empresas/{id}/contrato` | Contrato da construtora: pacote vendido, módulos liberados e limites de obras e usuários. | Administrador do sistema, Administrativo |  | `pacote`*, `modulos`, `recursos`, `limiteObras`*, `limiteUsuarios`*, `testeFim` |
| `GET /api/admin/empresas/{id}/contrato/historico` |  | Administrador do sistema, Administrativo |  |  |
| `GET /api/admin/backups` |  | Administrador do sistema, Administrativo |  |  |
| `POST /api/admin/backups` |  | Administrador do sistema, Administrativo |  |  |
| `GET /api/admin/backups/{id}/download` |  | Administrador do sistema, Administrativo |  |  |
| `DELETE /api/admin/backups/{id}` |  | Administrador do sistema, Administrativo |  |  |
| `GET /api/adm/colaboradores` |  | Dono, Gestor, Administrativo |  |  |
| `POST /api/adm/colaboradores` |  | Dono, Gestor, Administrativo |  | `nome`*, `telefone`, `cpf`, `funcao`, `cnhNumero`, `cnhCategoria`, `cnhVencimento`, `cursos`, `ativo`, `cargo`, `email`, `dataAdmissao`, `dataNascimento`, `observacoes` |
| `PATCH /api/adm/colaboradores/{id}` |  | Dono, Gestor, Administrativo |  | `nome`, `telefone`, `cpf`, `funcao`, `cnhNumero`, `cnhCategoria`, `cnhVencimento`, `cursos`, `ativo`, `cargo`, `email`, `dataAdmissao`, `dataNascimento`, `observacoes`, `usuarioId` |
| `GET /api/adm/cadastros/leitura` | A IA só sugere os campos; quem salva é o formulário, depois de conferido pelo usuário. | Dono, Gestor, Administrativo |  |  |
| `POST /api/adm/cadastros/leitura` |  | Dono, Gestor, Administrativo |  | `arquivo`*, `tipo`*, `entidade`* |
| `GET /api/adm/clientes` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Comprador, Financeiro, Administrativo, Comercial |  |  |
| `POST /api/adm/clientes` |  | Dono, Gestor, Administrativo |  | `categoria`, `tipoPessoa`, `cnpjCpf`, `razaoSocial`*, `nomeFantasia`, `ramo`, `atuacao`, `telefone`, `email`, `endereco`, `cidade`, `uf`, `chavePix`, `observacoes`, `ativo` |
| `PATCH /api/adm/clientes/{id}` |  | Dono, Gestor, Administrativo |  | `categoria`, `tipoPessoa`, `cnpjCpf`, `razaoSocial`, `nomeFantasia`, `ramo`, `atuacao`, `telefone`, `email`, `endereco`, `cidade`, `uf`, `chavePix`, `observacoes`, `ativo` |
| `GET /api/adm/fornecedores` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Comprador, Financeiro, Administrativo, Comercial | `categoria` |  |
| `POST /api/adm/fornecedores` |  | Dono, Gestor, Administrativo |  | `categoria`, `tipoPessoa`, `cnpjCpf`, `razaoSocial`*, `nomeFantasia`, `ramo`, `atuacao`, `telefone`, `email`, `endereco`, `cidade`, `uf`, `chavePix`, `observacoes`, `ativo` |
| `PATCH /api/adm/fornecedores/{id}` |  | Dono, Gestor, Administrativo |  | `categoria`, `tipoPessoa`, `cnpjCpf`, `razaoSocial`, `nomeFantasia`, `ramo`, `atuacao`, `telefone`, `email`, `endereco`, `cidade`, `uf`, `chavePix`, `observacoes`, `ativo` |
| `GET /api/rel/administrativo` |  | Dono, Gestor, Administrativo |  |  |

## Configurações

4 rotas.

| Rota | O que faz | Acesso | Consulta | Corpo |
|---|---|---|---|---|
| `GET /api/usuarios` |  | Dono, Gestor |  |  |
| `POST /api/usuarios` |  | Dono, Gestor |  | `nome`*, `email`*, `perfil`*, `senha`*, `telefoneWhatsapp`, `administrador`, `modulos` |
| `PATCH /api/usuarios/{id}` |  | Dono, Gestor |  | `nome`, `perfil`, `ativo`, `telefoneWhatsapp`, `senha`, `administrador`, `modulos` |
| `GET /api/rel/configuracoes` |  | Dono, Gestor |  |  |

## Autenticação

8 rotas.

| Rota | O que faz | Acesso | Consulta | Corpo |
|---|---|---|---|---|
| `POST /api/auth/entrar` |  | Pública |  | `email`*, `senha`* |
| `POST /api/auth/sair` |  | Pública |  |  |
| `GET /api/auth/eu` |  | Todos |  |  |
| `PUT /api/auth/senha` |  | Todos |  | `senhaAtual`*, `novaSenha`* |
| `GET /api/auth/oauth-destino` | Os nomes dos campos (code, token, refreshToken) seguem o contrato do AIRO, que o servidor MCP espera. A tela /oauth/authorize confere o endereço de retorno antes de mostrar o login e antes de voltar com "cancelado". | Pública | `redirect_uri` |  |
| `POST /api/auth/oauth-login` |  | Pública |  | `email`*, `senha`*, `redirectUri`* |
| `POST /api/auth/oauth-exchange` |  | Servidor MCP |  | `code`*, `redirectUri`* |
| `POST /api/auth/oauth-refresh` |  | Servidor MCP |  | `refreshToken`* |

## Empresa

14 rotas.

| Rota | O que faz | Acesso | Consulta | Corpo |
|---|---|---|---|---|
| `GET /api/empresa` |  | Todos da empresa |  |  |
| `PUT /api/empresa` |  | Dono |  | `razaoSocial`*, `nomeFantasia`, `cnpj`*, `regimeTributario`*, `aliquotasDre`, `simplesAnexo`, `simplesFaixa`, `telefone`, `email`, `cidade`, `uf` |
| `GET /api/empresa/grupo` |  | Todos da empresa |  |  |
| `POST /api/empresa/grupo` |  | Dono |  | `razaoSocial`*, `nomeFantasia`, `cnpj`*, `regimeTributario`*, `simplesAnexo`, `simplesFaixa`, `endereco`, `cidade`, `uf`, `ativo` |
| `PUT /api/empresa/grupo/{id}` |  | Dono |  | `razaoSocial`*, `nomeFantasia`, `cnpj`*, `regimeTributario`*, `simplesAnexo`, `simplesFaixa`, `endereco`, `cidade`, `uf`, `ativo` |
| `GET /api/empresa/logo` |  | Todos da empresa |  |  |
| `PUT /api/empresa/logo` |  | Dono, Gestor |  | `imagem`* |
| `DELETE /api/empresa/logo` |  | Dono, Gestor |  |  |
| `PUT /api/empresa/identidade` |  | Dono, Gestor |  | `corPrimaria`*, `corSecundaria`* |
| `PUT /api/empresa/impressao` |  | Dono, Gestor |  | `orientacao`*, `papel`* |
| `GET /api/empresa/exportacao` |  | Dono, Gestor |  |  |
| `GET /api/empresa/backups` |  | Dono |  |  |
| `POST /api/empresa/backups` |  | Dono |  |  |
| `GET /api/empresa/backups/{id}/download` |  | Dono |  |  |

## Mural de avisos

6 rotas.

| Rota | O que faz | Acesso | Consulta | Corpo |
|---|---|---|---|---|
| `GET /api/mural/painel` |  | Todos |  |  |
| `POST /api/mural/avisos` |  | Dono, Gestor |  | `titulo`*, `texto`*, `perfis`, `fixado`, `ate` |
| `PUT /api/mural/avisos/{id}` |  | Dono, Gestor |  | `titulo`*, `texto`*, `perfis`, `fixado`, `ate` |
| `DELETE /api/mural/avisos/{id}` |  | Dono, Gestor |  |  |
| `PUT /api/mural/config` |  | Dono |  | `aniversariantes`*, `ranking`*, `rankings`*, `posicoes`* |
| `GET /api/mural/relatorio` |  | Todos | `de`, `ate` |  |

## Links públicos

9 rotas.

| Rota | O que faz | Acesso | Consulta | Corpo |
|---|---|---|---|---|
| `GET /api/interesse` |  | Administrador do sistema |  |  |
| `POST /api/interesse` |  | Pública |  | `empresa`*, `responsavel`*, `email`*, `telefone`*, `cidade`, `uf`, `obrasAtivas`, `usuarios`, `pacote`*, `mensagem`, `origem`, `site` |
| `GET /api/interesse/{id}/apresentacao` | Apresentação para o período de testes, endereçada ao interessado (só o administrador do sistema). | Administrador do sistema |  |  |
| `GET /api/interesse/{id}/proposta` | Proposta comercial preenchida com o cadastro do interessado (só o administrador do sistema). | Administrador do sistema |  |  |
| `GET /api/aceite/admin/aceites` | Lista para o comercial: aceites e períodos de testes, mais recentes primeiro. | Administrador do sistema |  |  |
| `GET /api/aceite/{codigo}` | Dados da proposta para a página de aceite (sem login). | Pública |  |  |
| `POST /api/aceite/{codigo}` | Aceite: grava quem aceitou, quando e de qual IP, e abre o período de testes a partir de hoje. | Pública |  | `nome`*, `cargo`*, `documento`*, `concordo`* |
| `GET /api/assinatura/{token}` |  | Pública |  |  |
| `POST /api/assinatura/{token}` |  | Pública |  | `nome`*, `imagem`* |

## Sistema

1 rotas.

| Rota | O que faz | Acesso | Consulta | Corpo |
|---|---|---|---|---|
| `GET /api/saude` |  | Pública |  |  |

## Legado da concreteira

4 rotas.

| Rota | O que faz | Acesso | Consulta | Corpo |
|---|---|---|---|---|
| `GET /api/frota/veiculos` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Comprador, Financeiro, Administrativo, Comercial |  |  |
| `GET /api/frota/motoristas` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Comprador, Financeiro, Administrativo, Comercial |  |  |
| `GET /api/prod/insumos` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Comprador, Financeiro, Administrativo, Comercial |  |  |
| `GET /api/prod/tracos` |  | Dono, Gestor, Orçamentista, Engenheiro de obra, Comprador, Financeiro, Administrativo, Comercial | `todos` |  |

