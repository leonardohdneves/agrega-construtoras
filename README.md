# Agrega

ERP para concreteiras: frota (betoneiras e bombas) e financeiro, com DRE gerencial.

## Estrutura

```
apps/api   Servidor Node.js (TypeScript executado direto pelo Node 22), Fastify e PostgreSQL
apps/web   Telas em React (PWA instalável), compiladas pelo Vite e servidas pela API
```

A API serve as telas compiladas, então o sistema roda como **um único serviço** no Railway, ao lado do PostgreSQL.

## Rodar no computador

Requisitos: Node 22.18 ou superior e um PostgreSQL.

```bash
npm install
cp apps/api/.env.example apps/api/.env   # preencha DATABASE_URL
npm run dev:api                           # API em http://localhost:3000
npm run dev:web                           # telas em http://localhost:5173
npm test                                  # testes automáticos
```

As migrações do banco (`apps/api/migrations/*.sql`) são aplicadas automaticamente quando a API inicia.

## Variáveis do serviço (Railway)

| Variável | Para quê |
|---|---|
| `DATABASE_URL` | Conexão com o PostgreSQL (referência ao serviço Postgres) |
| `JWT_SECRET` | Segredo das sessões, com pelo menos 32 caracteres |
| `ADMIN_EMAIL`, `ADMIN_SENHA` | Cria o administrador do sistema no primeiro início, se ainda não existir |
| `SEED_DEMO`, `DEMO_SENHA` | Só no ambiente de teste: cria a Concreteira Exemplo |

## Ambiente de teste

Com `SEED_DEMO=true`, a API cria a **Concreteira Exemplo** com três usuários, todos com a senha definida em `DEMO_SENHA`:

- `dono@demo.agrega.test`
- `gestor@demo.agrega.test`
- `motorista@demo.agrega.test`

## Perfis

| Perfil | Acesso |
|---|---|
| Administrador do sistema | Cadastra as concreteiras clientes e seus donos |
| Dono | Tudo na sua empresa, inclusive dados fiscais e usuários |
| Gestor | Frota e financeiro; cadastra motoristas |
| Motorista | Lançamentos da frota pelo celular (abastecimento a partir da Etapa 2) |

## Etapas da versão 1

0. Base: login, perfis, empresa e usuários ✔
1. Cadastros da frota
2. Abastecimento
3. Manutenção
4. Financeiro base
5. Nota fiscal: lançamento manual e importação de XML
6. Conciliação bancária (OFX)
7. Relatórios e painel
