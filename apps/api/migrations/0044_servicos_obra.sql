-- Suprimentos · Solicitações de serviço (serviços cadastrados na obra). Cada cotação concluída gera um contrato
-- por fornecedor vencedor; contratos seguem para medições, autorizações de pagamento e contas a pagar.
ALTER TABLE solicitacoes_compra ADD COLUMN tipo text NOT NULL DEFAULT 'insumo';
ALTER TABLE solicitacoes_compra ADD CONSTRAINT solicitacoes_tipo CHECK (tipo IN ('insumo', 'servico'));
ALTER TABLE solicitacoes_compra ADD COLUMN plano_conta_id uuid REFERENCES plano_contas(id);

ALTER TABLE contratos ADD COLUMN obra_id uuid REFERENCES obras(id);
ALTER TABLE contratos ADD COLUMN solicitacao_id uuid REFERENCES solicitacoes_compra(id);
ALTER TABLE contratos ADD COLUMN cotacao_id uuid REFERENCES cotacoes(id);
CREATE INDEX contratos_cotacao ON contratos (cotacao_id) WHERE cotacao_id IS NOT NULL;

ALTER TABLE contratos_itens ADD COLUMN obra_item_id uuid REFERENCES obra_itens(id);
ALTER TABLE contratos_itens ADD COLUMN eap_no_id uuid REFERENCES eap_nos(id);
