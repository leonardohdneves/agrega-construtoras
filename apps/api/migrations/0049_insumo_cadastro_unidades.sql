-- Cadastro de insumo: código automático por tabela própria, preço opcional e unidades de compra com fator.

-- Prefixo e sequência do código de insumo, por tabela (ex.: INS-0001).
ALTER TABLE ref_tabelas ADD COLUMN prefixo_insumo text NOT NULL DEFAULT 'INS'
  CHECK (prefixo_insumo ~ '^[A-Z]{1,6}$');
ALTER TABLE ref_tabelas ADD COLUMN proximo_insumo integer NOT NULL DEFAULT 1
  CHECK (proximo_insumo >= 1);

-- Origem do preço do insumo: não registrado ou informado. ("última compra" entra depois.)
ALTER TABLE ref_itens ADD COLUMN preco_origem text
  CHECK (preco_origem IS NULL OR preco_origem IN ('nao_informado', 'informado'));
UPDATE ref_itens SET preco_origem = CASE WHEN preco_centavos IS NULL THEN 'nao_informado' ELSE 'informado' END
  WHERE tipo = 'insumo';

-- Unidades de compra do insumo. fator = quantas unidades do item (unidade base) cabem em 1 desta unidade.
-- Ex.: CA-60 5,0 mm, base kg: 1 barra = 46,2 kg, fator 46,2.
CREATE TABLE ref_insumo_unidades (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id  uuid NOT NULL REFERENCES ref_itens(id) ON DELETE CASCADE,
  unidade  text NOT NULL CHECK (length(btrim(unidade)) BETWEEN 1 AND 20),
  fator    numeric(14,6) NOT NULL CHECK (fator > 0),
  UNIQUE (item_id, unidade)
);
CREATE INDEX ref_insumo_unidades_item ON ref_insumo_unidades (item_id);
