-- Coeficiente das composições com mais casas decimais. Com 6 casas, equipamentos caros (caçamba, caminhão, pá
-- carregadeira, de dezenas ou centenas de milhares de reais) com coeficiente da ordem de 1e-7 viravam zero e o custo
-- da composição ficava abaixo do SINAPI (cerca de 30% das composições, em até 58%).
ALTER TABLE ref_composicao_insumos ALTER COLUMN coeficiente TYPE numeric(24,12);
ALTER TABLE obra_composicao_insumos ALTER COLUMN coeficiente TYPE numeric(24,12);
ALTER TABLE ref_composicao_estrutura ALTER COLUMN coeficiente TYPE numeric(24,12);
