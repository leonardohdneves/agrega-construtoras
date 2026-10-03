-- Suprimentos · Contratos com prestadores, medições e autorizações de pagamento (geram as contas a pagar).

ALTER TABLE lancamentos DROP CONSTRAINT lancamentos_origem;
ALTER TABLE lancamentos ADD CONSTRAINT lancamentos_origem CHECK (origem IN ('manual', 'xml', 'ia_whatsapp', 'frota', 'suprimentos'));

CREATE TABLE contratos (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id             uuid NOT NULL REFERENCES empresas(id),
  numero                 integer NOT NULL,
  fornecedor_id          uuid NOT NULL REFERENCES fornecedores(id),
  objeto                 text NOT NULL,
  tipo                   text NOT NULL DEFAULT 'itens',
  data_assinatura        date,
  inicio                 date NOT NULL,
  fim                    date,
  valor_global_centavos  bigint,
  plano_conta_id         uuid NOT NULL REFERENCES plano_contas(id),
  centro_custo_id        uuid REFERENCES centros_custo(id),
  prazo_pagamento_dias   integer NOT NULL DEFAULT 15 CHECK (prazo_pagamento_dias BETWEEN 0 AND 180),
  forma_pagamento        text,
  -- Retenções opcionais, em % sobre o valor bruto de cada medição.
  caucao_pct             numeric(5,2) NOT NULL DEFAULT 0 CHECK (caucao_pct BETWEEN 0 AND 30),
  iss_pct                numeric(5,2) NOT NULL DEFAULT 0 CHECK (iss_pct BETWEEN 0 AND 10),
  inss_pct               numeric(5,2) NOT NULL DEFAULT 0 CHECK (inss_pct BETWEEN 0 AND 20),
  ir_pct                 numeric(5,2) NOT NULL DEFAULT 0 CHECK (ir_pct BETWEEN 0 AND 10),
  pcc_pct                numeric(5,2) NOT NULL DEFAULT 0 CHECK (pcc_pct BETWEEN 0 AND 10),
  observacao             text,
  status                 text NOT NULL DEFAULT 'rascunho',
  encerrado_em           date,
  criado_por_id          uuid REFERENCES usuarios(id),
  criado_em              timestamptz NOT NULL DEFAULT now(),
  atualizado_em          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contratos_tipo CHECK (tipo IN ('itens', 'global')),
  CONSTRAINT contratos_status CHECK (status IN ('rascunho', 'vigente', 'encerrado', 'cancelado')),
  CONSTRAINT contratos_global CHECK (tipo <> 'global' OR valor_global_centavos > 0),
  UNIQUE (empresa_id, numero)
);

CREATE TABLE contratos_itens (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id               uuid NOT NULL REFERENCES empresas(id),
  contrato_id              uuid NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
  ordem                    integer NOT NULL DEFAULT 1,
  descricao                text NOT NULL,
  unidade                  text NOT NULL,
  quantidade               numeric(14,3) NOT NULL CHECK (quantidade > 0),
  preco_unitario_centavos  numeric(14,4) NOT NULL CHECK (preco_unitario_centavos >= 0)
);
CREATE INDEX contratos_itens_contrato ON contratos_itens (contrato_id);

CREATE TABLE medicoes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            uuid NOT NULL REFERENCES empresas(id),
  numero                integer NOT NULL,
  contrato_id           uuid NOT NULL REFERENCES contratos(id),
  sequencia             integer NOT NULL,
  periodo_inicio        date NOT NULL,
  periodo_fim           date NOT NULL,
  data                  date NOT NULL,
  valor_centavos        bigint NOT NULL DEFAULT 0,
  observacao            text,
  status                text NOT NULL DEFAULT 'rascunho',
  enviado_aprovacao_em  timestamptz,
  aprovado_por_id       uuid REFERENCES usuarios(id),
  aprovado_em           timestamptz,
  aprovacao_automatica  boolean NOT NULL DEFAULT false,
  motivo_reprovacao     text,
  criado_por_id         uuid REFERENCES usuarios(id),
  criado_em             timestamptz NOT NULL DEFAULT now(),
  atualizado_em         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT medicoes_status CHECK (status IN ('rascunho', 'aguardando_aprovacao', 'aprovada', 'reprovada', 'cancelada')),
  CONSTRAINT medicoes_periodo CHECK (periodo_fim >= periodo_inicio),
  UNIQUE (empresa_id, numero)
);
CREATE INDEX medicoes_contrato ON medicoes (contrato_id, sequencia);

-- Contrato por itens: quantidade medida de cada item. Contrato global: uma linha sem item, com o valor.
CREATE TABLE medicoes_itens (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid NOT NULL REFERENCES empresas(id),
  medicao_id        uuid NOT NULL REFERENCES medicoes(id) ON DELETE CASCADE,
  contrato_item_id  uuid REFERENCES contratos_itens(id),
  quantidade        numeric(14,3) NOT NULL DEFAULT 0 CHECK (quantidade >= 0),
  valor_centavos    bigint NOT NULL DEFAULT 0 CHECK (valor_centavos >= 0)
);
CREATE INDEX medicoes_itens_medicao ON medicoes_itens (medicao_id);

CREATE TABLE autorizacoes_pagamento (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            uuid NOT NULL REFERENCES empresas(id),
  numero                integer NOT NULL,
  tipo                  text NOT NULL DEFAULT 'medicao',
  contrato_id           uuid NOT NULL REFERENCES contratos(id),
  medicao_id            uuid REFERENCES medicoes(id),
  data                  date NOT NULL,
  vencimento            date NOT NULL,
  bruto_centavos        bigint NOT NULL CHECK (bruto_centavos > 0),
  caucao_centavos       bigint NOT NULL DEFAULT 0 CHECK (caucao_centavos >= 0),
  iss_centavos          bigint NOT NULL DEFAULT 0 CHECK (iss_centavos >= 0),
  inss_centavos         bigint NOT NULL DEFAULT 0 CHECK (inss_centavos >= 0),
  ir_centavos           bigint NOT NULL DEFAULT 0 CHECK (ir_centavos >= 0),
  pcc_centavos          bigint NOT NULL DEFAULT 0 CHECK (pcc_centavos >= 0),
  liquido_centavos      bigint NOT NULL CHECK (liquido_centavos > 0),
  documento             text,
  forma_pagamento       text,
  observacao            text,
  status                text NOT NULL DEFAULT 'aguardando_aprovacao',
  enviado_aprovacao_em  timestamptz NOT NULL DEFAULT now(),
  aprovado_por_id       uuid REFERENCES usuarios(id),
  aprovado_em           timestamptz,
  aprovacao_automatica  boolean NOT NULL DEFAULT false,
  motivo_reprovacao     text,
  lancamento_id         uuid REFERENCES lancamentos(id),
  lancamento_impostos_id uuid REFERENCES lancamentos(id),
  criado_por_id         uuid REFERENCES usuarios(id),
  criado_em             timestamptz NOT NULL DEFAULT now(),
  atualizado_em         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT autorizacoes_tipo CHECK (tipo IN ('medicao', 'caucao')),
  CONSTRAINT autorizacoes_status CHECK (status IN ('aguardando_aprovacao', 'aprovada', 'reprovada', 'cancelada')),
  CONSTRAINT autorizacoes_forma CHECK (forma_pagamento IS NULL OR forma_pagamento IN ('pix', 'boleto', 'transferencia', 'cartao', 'dinheiro', 'cheque', 'debito_automatico')),
  CONSTRAINT autorizacoes_soma CHECK (liquido_centavos = bruto_centavos - caucao_centavos - iss_centavos - inss_centavos - ir_centavos - pcc_centavos),
  UNIQUE (empresa_id, numero)
);
CREATE INDEX autorizacoes_contrato ON autorizacoes_pagamento (contrato_id);
CREATE UNIQUE INDEX autorizacoes_medicao_unica ON autorizacoes_pagamento (medicao_id) WHERE medicao_id IS NOT NULL AND status IN ('aguardando_aprovacao', 'aprovada');
