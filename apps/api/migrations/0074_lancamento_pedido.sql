-- Despesa lançada a partir de um pedido de compra aprovado: o pedido fica ligado ao lançamento
-- (não aparece de novo para lançar) até o lançamento ser cancelado.
ALTER TABLE lancamentos ADD COLUMN pedido_id uuid REFERENCES pedidos_compra(id);
CREATE INDEX lancamentos_pedido ON lancamentos (pedido_id) WHERE pedido_id IS NOT NULL;
