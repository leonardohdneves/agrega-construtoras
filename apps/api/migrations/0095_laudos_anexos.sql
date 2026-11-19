-- Anexos dos laudos: ART (PDF ou foto), fotos da obra e outros documentos. O arquivo fica no próprio banco
-- (bytea), como os anexos das notas e as fotos de visita, para não depender de um armazenamento à parte.
CREATE TABLE laudos_anexos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresas(id),
  laudo_id       uuid NOT NULL REFERENCES laudos(id) ON DELETE CASCADE,
  nome           text NOT NULL,
  tipo           text NOT NULL CHECK (tipo IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  categoria      text NOT NULL DEFAULT 'outro' CHECK (categoria IN ('art', 'foto', 'outro')),
  legenda        text NOT NULL DEFAULT '',
  tamanho        integer NOT NULL,
  conteudo       bytea NOT NULL,
  criado_por_id  uuid REFERENCES usuarios(id),
  criado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX laudos_anexos_laudo ON laudos_anexos (laudo_id, criado_em);
