-- Grupos de insumos (cadastro da empresa): família de insumos usada para organizar os insumos da obra.
CREATE TABLE insumo_grupos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES empresas(id),
  nome        text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 80),
  ordem       integer NOT NULL DEFAULT 0,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX insumo_grupos_nome ON insumo_grupos (empresa_id, lower(btrim(nome)));

ALTER TABLE obra_itens ADD COLUMN grupo_insumo_id uuid REFERENCES insumo_grupos(id) ON DELETE SET NULL;
CREATE INDEX obra_itens_grupo_insumo ON obra_itens (grupo_insumo_id) WHERE grupo_insumo_id IS NOT NULL;
