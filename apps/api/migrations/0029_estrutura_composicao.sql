-- Estrutura original de cada composição de referência, para conferência: os itens diretos (insumos ou
-- composições auxiliares) com o multiplicador. O preço continua vindo de ref_composicao_insumos, onde as
-- auxiliares já estão desdobradas em insumos.
CREATE TABLE ref_composicao_estrutura (
  composicao_id uuid NOT NULL REFERENCES ref_itens(id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES ref_itens(id) ON DELETE CASCADE,
  coeficiente   numeric(18,7) NOT NULL CHECK (coeficiente >= 0),
  PRIMARY KEY (composicao_id, item_id),
  CHECK (composicao_id <> item_id)
);
CREATE INDEX ref_composicao_estrutura_item ON ref_composicao_estrutura (item_id);
