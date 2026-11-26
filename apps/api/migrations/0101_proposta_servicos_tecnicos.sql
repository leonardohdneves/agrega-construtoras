-- Propostas de obra: novo tipo 'servicos_tecnicos' (serviços técnicos com preço informado, entrada na aceitação e
-- saldo na entrega, como os laudos). O CHECK de tipo passa a aceitar o valor novo; os demais tipos não mudam.
ALTER TABLE propostas_obra DROP CONSTRAINT IF EXISTS propostas_obra_tipo_check;
ALTER TABLE propostas_obra ADD CONSTRAINT propostas_obra_tipo_check
  CHECK (tipo IN ('acompanhamento', 'administracao', 'preco_global', 'preco_unitario', 'laudo', 'servicos_tecnicos'));
