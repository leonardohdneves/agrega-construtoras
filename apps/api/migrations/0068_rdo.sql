-- Relatório Diário de Obra (RDO): um registro por obra e dia, com clima por período,
-- mão de obra, equipamentos, atividades executadas e ocorrências (modelo de referência: diário do Sienge).
CREATE TABLE rdos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresas(id),
  obra_id         uuid NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  numero          integer NOT NULL,
  data            date NOT NULL,
  clima_manha     text,
  clima_tarde     text,
  clima_noite     text,
  responsavel     text,
  observacoes     text,
  criado_por      uuid REFERENCES usuarios(id),
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (obra_id, data),
  UNIQUE (obra_id, numero)
);
CREATE INDEX rdos_empresa ON rdos (empresa_id);

CREATE TABLE rdo_mao_obra (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rdo_id      uuid NOT NULL REFERENCES rdos(id) ON DELETE CASCADE,
  ordem       integer NOT NULL DEFAULT 0,
  funcao      text NOT NULL,
  empresa     text,
  quantidade  integer NOT NULL DEFAULT 0,
  horas       numeric(6,2)
);
CREATE INDEX rdo_mao_obra_rdo ON rdo_mao_obra (rdo_id);

CREATE TABLE rdo_equipamentos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rdo_id      uuid NOT NULL REFERENCES rdos(id) ON DELETE CASCADE,
  ordem       integer NOT NULL DEFAULT 0,
  descricao   text NOT NULL,
  quantidade  integer NOT NULL DEFAULT 0,
  horas       numeric(6,2)
);
CREATE INDEX rdo_equipamentos_rdo ON rdo_equipamentos (rdo_id);

CREATE TABLE rdo_atividades (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rdo_id        uuid NOT NULL REFERENCES rdos(id) ON DELETE CASCADE,
  ordem         integer NOT NULL DEFAULT 0,
  local         text,
  descricao     text NOT NULL,
  equipe        text,
  percentual    numeric(6,2)
);
CREATE INDEX rdo_atividades_rdo ON rdo_atividades (rdo_id);

CREATE TABLE rdo_ocorrencias (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rdo_id      uuid NOT NULL REFERENCES rdos(id) ON DELETE CASCADE,
  ordem       integer NOT NULL DEFAULT 0,
  tipo        text NOT NULL,
  descricao   text
);
CREATE INDEX rdo_ocorrencias_rdo ON rdo_ocorrencias (rdo_id);
