-- Transferência entre estoques da obra: a saída na origem e a entrada no destino compartilham a mesma referência.
ALTER TABLE estoque_movimentos ADD COLUMN transferencia_ref uuid;
CREATE INDEX estoque_movimentos_transferencia ON estoque_movimentos (transferencia_ref) WHERE transferencia_ref IS NOT NULL;
