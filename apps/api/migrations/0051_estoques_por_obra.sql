-- Estoques por obra. Cada obra tem sempre um estoque de recebimento (ativo), onde entram as notas de compra.
-- Os movimentos de obra ganham o estoque onde estão; o existente vai para o recebimento da obra.

CREATE TABLE obra_estoques (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES empresas(id),
  obra_id     uuid NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  nome        text NOT NULL CHECK (char_length(nome) BETWEEN 2 AND 60),
  recebimento boolean NOT NULL DEFAULT false,
  ativo       boolean NOT NULL DEFAULT true,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (obra_id, nome),
  CONSTRAINT obra_estoques_recebimento_ativo CHECK (NOT recebimento OR ativo)
);
CREATE INDEX obra_estoques_empresa ON obra_estoques (empresa_id);
CREATE UNIQUE INDEX obra_estoques_um_recebimento ON obra_estoques (obra_id) WHERE recebimento;

INSERT INTO obra_estoques (empresa_id, obra_id, nome, recebimento)
SELECT o.empresa_id, o.id, 'Recebimento', true FROM obras o
 WHERE NOT EXISTS (SELECT 1 FROM obra_estoques e WHERE e.obra_id = o.id AND e.recebimento);

ALTER TABLE estoque_movimentos ADD COLUMN obra_estoque_id uuid REFERENCES obra_estoques(id);
UPDATE estoque_movimentos m SET obra_estoque_id = e.id
  FROM obra_estoques e
 WHERE e.obra_id = m.obra_id AND e.recebimento AND m.obra_id IS NOT NULL AND m.obra_estoque_id IS NULL;
CREATE INDEX estoque_movimentos_obra_estoque ON estoque_movimentos (obra_estoque_id) WHERE obra_estoque_id IS NOT NULL;
