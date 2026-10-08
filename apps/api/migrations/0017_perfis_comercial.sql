-- Novos perfis (Financeiro, Administrativo, Vendedor) e a função "gestor de pátio" nos colaboradores.
-- Os novos valores do enum só são usados em transações seguintes.
ALTER TYPE perfil ADD VALUE IF NOT EXISTS 'financeiro';
ALTER TYPE perfil ADD VALUE IF NOT EXISTS 'administrativo';
ALTER TYPE perfil ADD VALUE IF NOT EXISTS 'vendedor';

ALTER TABLE motoristas DROP CONSTRAINT motoristas_funcao;
ALTER TABLE motoristas ADD CONSTRAINT motoristas_funcao CHECK (funcao IN (
  'motorista', 'operador_bomba', 'motorista_operador', 'operador_usina', 'mecanico', 'laboratorista', 'administrativo', 'vendedor', 'gestor_patio', 'outro'
));
