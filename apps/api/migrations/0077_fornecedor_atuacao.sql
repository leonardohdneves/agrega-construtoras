-- Administrativo · Atuação do fornecedor (material, mão de obra, equipamento). Filtra quem aparece
-- na cotação de uma solicitação de serviço conforme o escopo do serviço.
ALTER TABLE fornecedores ADD COLUMN atuacao text[] NOT NULL DEFAULT '{}';
ALTER TABLE fornecedores ADD CONSTRAINT fornecedores_atuacao CHECK (atuacao <@ ARRAY['mat', 'mo', 'eq']::text[]);
