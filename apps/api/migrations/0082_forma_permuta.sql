-- Permuta como forma de pagamento: libera o valor 'permuta' nas colunas de forma de pagamento.
ALTER TABLE parcelas DROP CONSTRAINT parcelas_forma;
ALTER TABLE parcelas ADD CONSTRAINT parcelas_forma CHECK (forma_pagamento IS NULL OR forma_pagamento IN ('pix', 'boleto', 'transferencia', 'cartao', 'dinheiro', 'cheque', 'debito_automatico', 'permuta'));

ALTER TABLE vendas DROP CONSTRAINT vendas_forma;
ALTER TABLE vendas ADD CONSTRAINT vendas_forma CHECK (forma_pagamento IS NULL OR forma_pagamento IN ('pix', 'boleto', 'transferencia', 'cartao', 'dinheiro', 'cheque', 'debito_automatico', 'permuta'));

ALTER TABLE autorizacoes DROP CONSTRAINT autorizacoes_forma;
ALTER TABLE autorizacoes ADD CONSTRAINT autorizacoes_forma CHECK (forma_pagamento IS NULL OR forma_pagamento IN ('pix', 'boleto', 'transferencia', 'cartao', 'dinheiro', 'cheque', 'debito_automatico', 'permuta'));
