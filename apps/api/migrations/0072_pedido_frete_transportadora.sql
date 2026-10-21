-- Frete do pedido: por fornecedor de transporte (transportadora cadastrada) ou por transporte próprio (só valor digitado).
ALTER TABLE pedidos_compra ADD COLUMN frete_tipo text;
ALTER TABLE pedidos_compra ADD CONSTRAINT pedidos_compra_frete_tipo CHECK (frete_tipo IN ('transportadora', 'proprio'));
ALTER TABLE pedidos_compra ADD COLUMN transportadora_id uuid REFERENCES fornecedores(id);
