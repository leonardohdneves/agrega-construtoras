-- De qual material veio o cadastro (ex.: banner-piloto), pelo parâmetro ?origem= do QR code. Vazio: cadastro direto.
ALTER TABLE interessados ADD COLUMN origem text CHECK (origem IS NULL OR origem ~ '^[a-z0-9-]{1,60}$');
CREATE INDEX interessados_origem ON interessados (origem);
