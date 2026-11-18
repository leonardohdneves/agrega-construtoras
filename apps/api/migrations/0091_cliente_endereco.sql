-- Endereço do cliente (P01, decisão D1). A tela já mandava o campo, mas a tabela não tinha a coluna e o PATCH quebrava.
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS endereco text;
