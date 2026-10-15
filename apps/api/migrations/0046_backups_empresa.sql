-- Backups por empresa (feitos pelo dono). Sem empresa_id = backup completo do sistema (área do administrador).
ALTER TABLE backups ADD COLUMN empresa_id uuid REFERENCES empresas(id);
CREATE INDEX backups_empresa ON backups (empresa_id, criado_em DESC) WHERE empresa_id IS NOT NULL;
