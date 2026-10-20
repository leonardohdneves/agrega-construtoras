-- Fotos do RDO: a imagem já vem reduzida do navegador (JPEG ou PNG, até ~2 MB), guardada no próprio banco.
CREATE TABLE rdo_fotos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rdo_id      uuid NOT NULL REFERENCES rdos(id) ON DELETE CASCADE,
  ordem       integer NOT NULL DEFAULT 0,
  legenda     text,
  tipo        text NOT NULL CHECK (tipo IN ('image/jpeg', 'image/png')),
  conteudo    bytea NOT NULL,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rdo_fotos_rdo ON rdo_fotos (rdo_id);
