-- Remove a tabela funcionarios (0053): a saída passa a usar só os colaboradores (0054).
-- Antes, o nome de quem retirou cada saída já gravada é copiado para a própria saída, para o histórico não se perder.
ALTER TABLE saidas_material ADD COLUMN funcionario_nome text;
UPDATE saidas_material s SET funcionario_nome = f.nome FROM funcionarios f WHERE f.id = s.funcionario_id;
ALTER TABLE saidas_material DROP CONSTRAINT IF EXISTS saidas_material_quem_retirou;
ALTER TABLE saidas_material DROP COLUMN funcionario_id;
ALTER TABLE saidas_material ADD CONSTRAINT saidas_material_quem_retirou CHECK (colaborador_id IS NOT NULL OR funcionario_nome IS NOT NULL);
DROP TABLE funcionarios;
