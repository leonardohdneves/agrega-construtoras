-- Suprimentos · Escopo do serviço (define a minuta do contrato): mão de obra (mo), equipamento (eq),
-- material (mat) e combinações. Obrigatório nas solicitações de serviço novas (validado na API);
-- solicitações antigas ficam sem escopo.
ALTER TABLE solicitacoes_compra ADD COLUMN escopo_servico text;
ALTER TABLE solicitacoes_compra ADD CONSTRAINT solicitacoes_escopo_servico
  CHECK (escopo_servico IN ('mo', 'eq', 'mat_mo', 'mat_mo_eq', 'mo_eq', 'mat_eq'));
