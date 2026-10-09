-- Chave de acesso da NFS-e do padrão nacional tem 50 dígitos (a da NF-e tem 44).
ALTER TABLE notas_fiscais DROP CONSTRAINT notas_chave;
ALTER TABLE notas_fiscais ADD CONSTRAINT notas_chave CHECK (chave_acesso IS NULL OR chave_acesso ~ '^([0-9]{44}|[0-9]{50})$');
