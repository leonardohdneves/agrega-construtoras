-- Composição do preço da obra: custos indiretos, custos acessórios (percentuais), impostos da nota e lucratividade.
CREATE TABLE obra_composicao_preco (
  obra_id          uuid PRIMARY KEY REFERENCES obras(id) ON DELETE CASCADE,
  administracao_pct numeric(6,2) NOT NULL DEFAULT 0 CHECK (administracao_pct >= 0 AND administracao_pct < 100),
  imprevistos_pct   numeric(6,2) NOT NULL DEFAULT 0 CHECK (imprevistos_pct >= 0 AND imprevistos_pct < 100),
  financeiro_pct    numeric(6,2) NOT NULL DEFAULT 0 CHECK (financeiro_pct >= 0 AND financeiro_pct < 100),
  lucro_pct         numeric(6,2) NOT NULL DEFAULT 0 CHECK (lucro_pct >= 0 AND lucro_pct < 100),
  atualizado_em     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE obra_custos_indiretos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id         uuid NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  descricao       text NOT NULL,
  valor_centavos  bigint NOT NULL DEFAULT 0 CHECK (valor_centavos >= 0),
  ordem           integer NOT NULL DEFAULT 0,
  criado_em       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX obra_custos_indiretos_obra ON obra_custos_indiretos (obra_id);

CREATE TABLE obra_impostos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id     uuid NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  descricao   text NOT NULL,
  percentual  numeric(6,2) NOT NULL DEFAULT 0 CHECK (percentual >= 0 AND percentual < 100),
  ordem       integer NOT NULL DEFAULT 0,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX obra_impostos_obra ON obra_impostos (obra_id);
