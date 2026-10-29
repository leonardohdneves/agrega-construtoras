-- Obra de proposta recusada ou cancelada fica arquivada (sai das listas, dados preservados).
ALTER TABLE obras DROP CONSTRAINT IF EXISTS obras_status_check;
ALTER TABLE obras ADD CONSTRAINT obras_status_check CHECK (status IN ('orcamento', 'planejamento', 'em_andamento', 'suspensa', 'concluida', 'arquivada'));
