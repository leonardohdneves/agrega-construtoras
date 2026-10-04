-- Contratos também passam pela aprovação (padrão: o dono aprova) antes de ficarem vigentes.
ALTER TABLE contratos DROP CONSTRAINT contratos_status;
ALTER TABLE contratos ADD CONSTRAINT contratos_status CHECK (status IN ('rascunho', 'aguardando_aprovacao', 'reprovado', 'vigente', 'encerrado', 'cancelado'));
ALTER TABLE contratos
  ADD COLUMN enviado_aprovacao_em timestamptz,
  ADD COLUMN aprovado_por_id uuid REFERENCES usuarios(id),
  ADD COLUMN aprovado_em timestamptz,
  ADD COLUMN aprovacao_automatica boolean NOT NULL DEFAULT false,
  ADD COLUMN motivo_reprovacao text;
