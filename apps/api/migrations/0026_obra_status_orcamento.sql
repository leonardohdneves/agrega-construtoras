-- Engenharia: obra pode estar "em orçamento" antes do planejamento.
ALTER TABLE obras DROP CONSTRAINT IF EXISTS obras_status_check;
ALTER TABLE obras ADD CONSTRAINT obras_status_check CHECK (status IN ('orcamento', 'planejamento', 'em_andamento', 'suspensa', 'concluida'));
