-- Patrimônio da construtora: ferramentas e equipamentos próprios, com retirada e devolução por obra e depreciação linear.
CREATE TABLE patrimonio (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id                uuid NOT NULL REFERENCES empresas(id),
  codigo                    text NOT NULL,
  nome                      text NOT NULL,
  marca                     text,
  serie                     text,
  data_aquisicao            date NOT NULL,
  valor_aquisicao_centavos  bigint NOT NULL CHECK (valor_aquisicao_centavos > 0),
  valor_residual_centavos   bigint NOT NULL DEFAULT 0 CHECK (valor_residual_centavos >= 0),
  vida_util_meses           integer NOT NULL CHECK (vida_util_meses > 0),
  status                    text NOT NULL DEFAULT 'disponivel' CHECK (status IN ('disponivel', 'em_uso', 'manutencao', 'baixado')),
  obra_id                   uuid REFERENCES obras(id),
  responsavel_nome          text,
  criado_em                 timestamptz NOT NULL DEFAULT now(),
  atualizado_em             timestamptz NOT NULL DEFAULT now(),
  excluido_em               timestamptz,
  CONSTRAINT patrimonio_residual CHECK (valor_residual_centavos < valor_aquisicao_centavos),
  CONSTRAINT patrimonio_em_uso CHECK ((status = 'em_uso') = (obra_id IS NOT NULL))
);
CREATE UNIQUE INDEX patrimonio_codigo ON patrimonio (empresa_id, codigo) WHERE excluido_em IS NULL;

CREATE TABLE patrimonio_movimentos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresas(id),
  patrimonio_id   uuid NOT NULL REFERENCES patrimonio(id) ON DELETE CASCADE,
  tipo            text NOT NULL CHECK (tipo IN ('retirada', 'devolucao')),
  obra_id         uuid NOT NULL REFERENCES obras(id),
  responsavel     text,
  estado          text CHECK (estado IN ('disponivel', 'manutencao')),
  observacao      text,
  data            date NOT NULL,
  registrado_por_id uuid REFERENCES usuarios(id),
  criado_em       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patrimonio_movimentos_bem ON patrimonio_movimentos (patrimonio_id, criado_em);
