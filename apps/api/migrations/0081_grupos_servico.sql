-- Grupos de serviços (cadastro da empresa): família de serviços usada para organizar os serviços da obra.
CREATE TABLE servico_grupos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES empresas(id),
  nome        text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 80),
  ordem       integer NOT NULL DEFAULT 0,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX servico_grupos_nome ON servico_grupos (empresa_id, lower(btrim(nome)));

ALTER TABLE obra_itens ADD COLUMN grupo_servico_id uuid REFERENCES servico_grupos(id) ON DELETE SET NULL;
CREATE INDEX obra_itens_grupo_servico ON obra_itens (grupo_servico_id) WHERE grupo_servico_id IS NOT NULL;
