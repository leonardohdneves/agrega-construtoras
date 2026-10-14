-- Registro dos backups automáticos e manuais do sistema. Os arquivos ficam no bucket de armazenamento.
CREATE TABLE backups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  criado_em       timestamptz NOT NULL DEFAULT now(),
  tipo            text NOT NULL CHECK (tipo IN ('automatico', 'manual')),
  status          text NOT NULL CHECK (status IN ('ok', 'erro')),
  tamanho_bytes   bigint,
  registros       integer,
  tabelas         integer,
  chave           text,
  sha256          text,
  erro            text,
  criado_por      text
);
CREATE INDEX backups_criado_em ON backups (criado_em DESC);
