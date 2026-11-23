-- OS das frentes do canteiro: equipe, quantidade (com a unidade do serviço) e prazo.
ALTER TABLE canteiro_os ADD COLUMN equipe text NOT NULL DEFAULT '';
ALTER TABLE canteiro_os ADD COLUMN quantidade numeric(16, 4) CHECK (quantidade IS NULL OR quantidade > 0);
ALTER TABLE canteiro_os ADD COLUMN unidade text NOT NULL DEFAULT '';
ALTER TABLE canteiro_os ADD COLUMN prazo date;
