-- Estoque da construtora por insumo da obra e etapa da EAP.
-- A nota de compra aponta obra, insumo da obra e etapa de cada item; a entrada vai para essa apropriação.
-- A saída (requisição de material) também fica na apropriação de origem. O estoque da concreteira não muda.

ALTER TABLE notas_itens
  ADD COLUMN obra_id      uuid REFERENCES obras(id),
  ADD COLUMN obra_item_id uuid REFERENCES obra_itens(id),
  ADD COLUMN eap_no_id    uuid REFERENCES eap_nos(id);
CREATE INDEX notas_itens_obra_item ON notas_itens (obra_item_id) WHERE obra_item_id IS NOT NULL;

ALTER TABLE estoque_movimentos
  ADD COLUMN obra_id      uuid REFERENCES obras(id),
  ADD COLUMN obra_item_id uuid REFERENCES obra_itens(id),
  ADD COLUMN eap_no_id    uuid REFERENCES eap_nos(id);
ALTER TABLE estoque_movimentos ALTER COLUMN insumo_id DROP NOT NULL;
ALTER TABLE estoque_movimentos DROP CONSTRAINT IF EXISTS estoque_movimentos_tipo;
ALTER TABLE estoque_movimentos ADD CONSTRAINT estoque_movimentos_tipo CHECK (tipo IN ('entrada', 'ajuste', 'saida'));
CREATE INDEX estoque_movimentos_apropriacao ON estoque_movimentos (obra_id, obra_item_id, eap_no_id) WHERE obra_item_id IS NOT NULL;
