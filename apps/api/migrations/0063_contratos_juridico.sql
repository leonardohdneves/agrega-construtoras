-- Contrato de prestação de serviços: endereços das partes e prazos do termo jurídico (usados na minuta impressa).
ALTER TABLE contratos
  ADD COLUMN endereco_contratante text,
  ADD COLUMN endereco_contratada  text,
  ADD COLUMN prazo_correcao_dias  integer CHECK (prazo_correcao_dias IS NULL OR prazo_correcao_dias BETWEEN 1 AND 365),
  ADD COLUMN garantia_meses       integer CHECK (garantia_meses IS NULL OR garantia_meses BETWEEN 1 AND 120);
