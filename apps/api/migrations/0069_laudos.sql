-- Módulo Laudos: laudos técnicos por tipo (GLP, avaliações, patologias). Os dados do laudo ficam em jsonb,
-- porque cada tipo de laudo tem campos próprios e o modelo de cada um pode mudar sem nova migração.
CREATE TABLE laudos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresas(id),
  tipo          text NOT NULL CHECK (tipo IN ('glp', 'avaliacao', 'patologia')),
  numero        integer NOT NULL,
  titulo        text NOT NULL DEFAULT '',
  dados         jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_por    uuid REFERENCES usuarios(id),
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, tipo, numero)
);
CREATE INDEX laudos_empresa_tipo ON laudos (empresa_id, tipo);
