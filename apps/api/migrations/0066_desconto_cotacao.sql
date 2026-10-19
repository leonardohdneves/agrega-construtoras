-- Desconto dado pelo fornecedor sobre o total dos itens cotados (R$, em centavos).
ALTER TABLE cotacoes_fornecedores
  ADD COLUMN desconto_centavos bigint NOT NULL DEFAULT 0 CHECK (desconto_centavos >= 0);
