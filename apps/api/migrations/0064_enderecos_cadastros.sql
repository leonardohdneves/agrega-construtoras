-- Endereço completo nos cadastros: fornecedor (prestador) e empresa do grupo (quem executa a obra).
-- Os contratos usam esses endereços para a minuta; o endereço do contrato fica só como reserva.
ALTER TABLE fornecedores ADD COLUMN endereco text;
ALTER TABLE empresas_grupo ADD COLUMN endereco text;
