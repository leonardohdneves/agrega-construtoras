-- Período de teste: enquanto estiver vigente, a construtora tem 1 obra e 3 usuários (ver lib/teste.ts).
-- Terminado o teste, valem de novo os limites do contrato.
ALTER TABLE empresas ADD COLUMN teste_inicio date;
ALTER TABLE empresas ADD COLUMN teste_fim date;
ALTER TABLE empresas ADD CONSTRAINT empresas_teste_datas CHECK (teste_fim IS NULL OR (teste_inicio IS NOT NULL AND teste_fim >= teste_inicio));
