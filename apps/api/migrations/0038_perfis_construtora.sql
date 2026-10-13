-- Perfis da construtora: orçamentista, engenheiro de obra e comprador.
-- O engenheiro de obra só enxerga as obras atribuídas a ele (obra_responsaveis).
ALTER TYPE perfil ADD VALUE IF NOT EXISTS 'orcamentista';
ALTER TYPE perfil ADD VALUE IF NOT EXISTS 'engenheiro_obra';
ALTER TYPE perfil ADD VALUE IF NOT EXISTS 'comprador';

CREATE TABLE obra_responsaveis (
  obra_id     uuid NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  usuario_id  uuid NOT NULL REFERENCES usuarios(id),
  criado_em   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (obra_id, usuario_id)
);
CREATE INDEX obra_responsaveis_usuario ON obra_responsaveis (usuario_id);
