-- Etapa 4 · Financeiro base: contas, plano de contas, centros de custo, clientes,
-- lançamentos (competência), apropriações, parcelas (caixa) e transferências.

CREATE TABLE contas_financeiras (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            uuid NOT NULL REFERENCES empresas(id),
  nome                  text NOT NULL,
  tipo                  text NOT NULL DEFAULT 'banco',
  banco                 text,
  agencia               text,
  conta                 text,
  saldo_inicial_centavos bigint NOT NULL DEFAULT 0,
  data_saldo_inicial    date NOT NULL DEFAULT current_date,
  ativo                 boolean NOT NULL DEFAULT true,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  atualizado_em         timestamptz NOT NULL DEFAULT now(),
  excluido_em           timestamptz,
  CONSTRAINT contas_financeiras_tipo CHECK (tipo IN ('banco', 'caixa', 'cartao', 'aplicacao'))
);
CREATE UNIQUE INDEX contas_financeiras_nome_unico ON contas_financeiras (empresa_id, lower(nome)) WHERE excluido_em IS NULL;

CREATE TABLE plano_contas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL REFERENCES empresas(id),
  codigo           text NOT NULL,
  nome             text NOT NULL,
  tipo             text NOT NULL,
  linha_dre        text NOT NULL,
  pai_id           uuid REFERENCES plano_contas(id),
  aceita_lancamento boolean NOT NULL DEFAULT true,
  ativo            boolean NOT NULL DEFAULT true,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plano_contas_tipo CHECK (tipo IN ('receita', 'despesa')),
  CONSTRAINT plano_contas_linha CHECK (linha_dre IN (
    'receita_bruta', 'deducoes', 'custo_producao', 'custo_frota', 'custo_pessoal',
    'despesas_pessoal', 'despesas_administrativas', 'despesas_comerciais',
    'receitas_financeiras', 'despesas_financeiras', 'outras_receitas', 'outras_despesas',
    'impostos_lucro', 'fora_dre'
  ))
);
CREATE UNIQUE INDEX plano_contas_codigo_unico ON plano_contas (empresa_id, codigo);

CREATE TABLE centros_custo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresas(id),
  nome          text NOT NULL,
  ativo         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX centros_custo_nome_unico ON centros_custo (empresa_id, lower(nome));

ALTER TABLE fornecedores ADD CONSTRAINT fornecedores_categoria_padrao_fk FOREIGN KEY (categoria_padrao_id) REFERENCES plano_contas(id);

CREATE TABLE clientes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresas(id),
  tipo_pessoa   char(2) NOT NULL DEFAULT 'PJ',
  cnpj_cpf      text,
  razao_social  text NOT NULL,
  nome_fantasia text,
  ramo          text,
  telefone      text,
  email         text,
  cidade        text,
  uf            char(2),
  chave_pix     text,
  observacoes   text,
  ativo         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  excluido_em   timestamptz,
  CONSTRAINT clientes_tipo_pessoa CHECK (tipo_pessoa IN ('PJ', 'PF'))
);
CREATE UNIQUE INDEX clientes_documento_unico ON clientes (empresa_id, cnpj_cpf) WHERE excluido_em IS NULL AND cnpj_cpf IS NOT NULL;

CREATE TABLE lancamentos (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           uuid NOT NULL REFERENCES empresas(id),
  tipo                 text NOT NULL,
  competencia          date NOT NULL,
  descricao            text NOT NULL,
  documento            text,
  valor_total_centavos bigint NOT NULL,
  cliente_id           uuid REFERENCES clientes(id),
  fornecedor_id        uuid REFERENCES fornecedores(id),
  nota_id              uuid,
  origem               text NOT NULL DEFAULT 'manual',
  status               text NOT NULL DEFAULT 'confirmado',
  recorrencia          text NOT NULL DEFAULT 'nenhuma',
  recorrencia_pai_id   uuid REFERENCES lancamentos(id),
  recorrencia_ordem    integer,
  observacoes          text,
  criado_por_id        uuid REFERENCES usuarios(id),
  criado_em            timestamptz NOT NULL DEFAULT now(),
  atualizado_em        timestamptz NOT NULL DEFAULT now(),
  excluido_em          timestamptz,
  CONSTRAINT lancamentos_tipo CHECK (tipo IN ('receita', 'despesa')),
  CONSTRAINT lancamentos_origem CHECK (origem IN ('manual', 'xml', 'ia_whatsapp', 'frota')),
  CONSTRAINT lancamentos_status CHECK (status IN ('rascunho', 'aguardando_conferencia', 'confirmado', 'cancelado')),
  CONSTRAINT lancamentos_recorrencia CHECK (recorrencia IN ('nenhuma', 'semanal', 'mensal', 'anual')),
  CONSTRAINT lancamentos_valor CHECK (valor_total_centavos > 0)
);
CREATE INDEX lancamentos_competencia ON lancamentos (empresa_id, competencia);

CREATE TABLE apropriacoes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresas(id),
  lancamento_id   uuid NOT NULL REFERENCES lancamentos(id),
  plano_conta_id  uuid NOT NULL REFERENCES plano_contas(id),
  centro_custo_id uuid REFERENCES centros_custo(id),
  veiculo_id      uuid REFERENCES veiculos(id),
  descricao       text,
  valor_centavos  bigint NOT NULL,
  nota_item_id    uuid,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT apropriacoes_valor CHECK (valor_centavos > 0)
);
CREATE INDEX apropriacoes_lancamento ON apropriacoes (lancamento_id);
CREATE INDEX apropriacoes_veiculo ON apropriacoes (empresa_id, veiculo_id) WHERE veiculo_id IS NOT NULL;

CREATE TABLE parcelas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES empresas(id),
  lancamento_id       uuid NOT NULL REFERENCES lancamentos(id),
  numero              integer NOT NULL,
  vencimento          date NOT NULL,
  valor_centavos      bigint NOT NULL,
  status              text NOT NULL DEFAULT 'aberta',
  data_pagamento      date,
  juros_centavos      bigint NOT NULL DEFAULT 0,
  desconto_centavos   bigint NOT NULL DEFAULT 0,
  valor_pago_centavos bigint,
  conta_financeira_id uuid REFERENCES contas_financeiras(id),
  forma_pagamento     text,
  observacoes         text,
  baixado_por_id      uuid REFERENCES usuarios(id),
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parcelas_status CHECK (status IN ('aberta', 'paga', 'cancelada')),
  CONSTRAINT parcelas_forma CHECK (forma_pagamento IS NULL OR forma_pagamento IN ('pix', 'boleto', 'transferencia', 'cartao', 'dinheiro', 'cheque', 'debito_automatico')),
  CONSTRAINT parcelas_valor CHECK (valor_centavos > 0),
  CONSTRAINT parcelas_paga CHECK (status <> 'paga' OR (data_pagamento IS NOT NULL AND conta_financeira_id IS NOT NULL AND valor_pago_centavos IS NOT NULL))
);
CREATE INDEX parcelas_vencimento ON parcelas (empresa_id, status, vencimento);
CREATE INDEX parcelas_pagamento ON parcelas (empresa_id, conta_financeira_id, data_pagamento) WHERE status = 'paga';
CREATE INDEX parcelas_lancamento ON parcelas (lancamento_id);

CREATE TABLE transferencias (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL REFERENCES empresas(id),
  conta_origem_id  uuid NOT NULL REFERENCES contas_financeiras(id),
  conta_destino_id uuid NOT NULL REFERENCES contas_financeiras(id),
  data             date NOT NULL,
  valor_centavos   bigint NOT NULL,
  descricao        text,
  criado_por_id    uuid REFERENCES usuarios(id),
  criado_em        timestamptz NOT NULL DEFAULT now(),
  excluido_em      timestamptz,
  CONSTRAINT transferencias_contas CHECK (conta_origem_id <> conta_destino_id),
  CONSTRAINT transferencias_valor CHECK (valor_centavos > 0)
);
CREATE INDEX transferencias_data ON transferencias (empresa_id, data);
