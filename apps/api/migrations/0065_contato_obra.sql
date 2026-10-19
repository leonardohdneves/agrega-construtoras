-- Contato na obra (nome e telefone), usado na impressão do pedido de compra como contato de entrega.
ALTER TABLE obras
  ADD COLUMN contato_obra_nome text,
  ADD COLUMN contato_obra_telefone text;
