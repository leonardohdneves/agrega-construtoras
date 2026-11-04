-- Obra de acompanhamento por visitas: o engenheiro visita a obra, registra fotos e anotações e emite um
-- relatório da visita (PDF) com a identidade da empresa. Obras de acompanhamento não usam EAP, orçamento,
-- planejamento nem estoque.
ALTER TABLE obras ADD COLUMN tipo text NOT NULL DEFAULT 'execucao' CHECK (tipo IN ('execucao', 'acompanhamento'));

-- Identidade visual da empresa para os relatórios (a logo já existe em empresas.logo).
ALTER TABLE empresas ADD COLUMN cor_primaria text CHECK (cor_primaria IS NULL OR cor_primaria ~ '^#[0-9a-fA-F]{6}$');
ALTER TABLE empresas ADD COLUMN cor_secundaria text CHECK (cor_secundaria IS NULL OR cor_secundaria ~ '^#[0-9a-fA-F]{6}$');

CREATE TABLE obra_visitas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresas(id),
  obra_id         uuid NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  numero          integer NOT NULL CHECK (numero > 0),
  data            date NOT NULL DEFAULT current_date,
  responsavel     text,
  observacoes     text,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (obra_id, numero)
);
CREATE INDEX obra_visitas_empresa ON obra_visitas (empresa_id);

CREATE TABLE obra_visita_fotos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visita_id   uuid NOT NULL REFERENCES obra_visitas(id) ON DELETE CASCADE,
  ordem       integer NOT NULL DEFAULT 0,
  legenda     text,
  tipo        text NOT NULL CHECK (tipo IN ('image/jpeg', 'image/png')),
  conteudo    bytea NOT NULL,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX obra_visita_fotos_visita ON obra_visita_fotos (visita_id, ordem);
