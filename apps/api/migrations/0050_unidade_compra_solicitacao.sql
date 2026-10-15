-- Unidade de compra do insumo da obra: copiada do cadastro na importação, usada na necessidade e na solicitação.

-- Unidades de compra do insumo da obra (fator: unidades do orçamento que cabem em 1 unidade de compra).
CREATE TABLE obra_insumo_unidades (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_item_id uuid NOT NULL REFERENCES obra_itens(id) ON DELETE CASCADE,
  unidade      text NOT NULL CHECK (length(btrim(unidade)) BETWEEN 1 AND 20),
  fator        numeric(14,6) NOT NULL CHECK (fator > 0),
  UNIQUE (obra_item_id, unidade)
);

-- Necessidade pedida em unidade de compra: a quantidade (em unidade do orçamento) continua em quantidade.
ALTER TABLE obra_necessidades ADD COLUMN unidade_compra text;
ALTER TABLE obra_necessidades ADD COLUMN quantidade_compra numeric(14,4);
ALTER TABLE obra_necessidades ADD CONSTRAINT obra_necessidades_compra_par
  CHECK ((unidade_compra IS NULL AND quantidade_compra IS NULL) OR (unidade_compra IS NOT NULL AND quantidade_compra > 0));

-- Origem do preço do cadastro: também "última compra".
ALTER TABLE ref_itens DROP CONSTRAINT IF EXISTS ref_itens_preco_origem_check;
ALTER TABLE ref_itens ADD CONSTRAINT ref_itens_preco_origem_check
  CHECK (preco_origem IS NULL OR preco_origem IN ('nao_informado', 'informado', 'ultima_compra'));
