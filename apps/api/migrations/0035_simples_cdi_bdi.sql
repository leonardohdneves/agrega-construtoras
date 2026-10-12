-- Empresa: anexo e faixa do Simples Nacional (usados nos impostos da nota da obra).
ALTER TABLE empresas ADD COLUMN simples_anexo text CHECK (simples_anexo IN ('I', 'II', 'III', 'IV', 'V'));
ALTER TABLE empresas ADD COLUMN simples_faixa smallint CHECK (simples_faixa BETWEEN 1 AND 6);

-- Custo financeiro passa a ser a alíquota do CDI informada pelo usuário.
ALTER TABLE obra_composicao_preco RENAME COLUMN financeiro_pct TO cdi_pct;
