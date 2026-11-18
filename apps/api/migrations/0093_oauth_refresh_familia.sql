-- P39: cada conexão de assistente é uma família de tokens de renovação. A cada renovação o token novo herda a família
-- do anterior; se um token já trocado reaparecer, a família inteira é revogada (o reuso indica que alguém copiou o token).
-- Os tokens que já existem viram, cada um, o começo da própria família.
ALTER TABLE oauth_refresh ADD COLUMN IF NOT EXISTS familia_id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE INDEX IF NOT EXISTS oauth_refresh_familia ON oauth_refresh (familia_id) WHERE revogado_em IS NULL;
