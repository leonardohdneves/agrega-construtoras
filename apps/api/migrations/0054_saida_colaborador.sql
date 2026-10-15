-- Saída de material passa a usar os colaboradores do cadastro do Administrativo (tabela motoristas).
-- Saídas já gravadas com funcionario_id continuam válidas; a tabela funcionarios (0053) fica sem uso até decisão expressa de remoção.
ALTER TABLE saidas_material ADD COLUMN colaborador_id uuid REFERENCES motoristas(id);
ALTER TABLE saidas_material ALTER COLUMN funcionario_id DROP NOT NULL;
ALTER TABLE saidas_material ADD CONSTRAINT saidas_material_quem_retirou CHECK (colaborador_id IS NOT NULL OR funcionario_id IS NOT NULL);
CREATE INDEX saidas_material_colaborador ON saidas_material (colaborador_id);
