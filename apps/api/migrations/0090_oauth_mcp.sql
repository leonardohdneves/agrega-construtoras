-- Conexão de assistentes de IA (Claude, ChatGPT) pelo servidor MCP, com OAuth no mesmo desenho do AIRO.
-- O usuário entra na tela /oauth/authorize; a API devolve um código de uso único (60 s), que o servidor MCP
-- troca, de servidor para servidor, pelo token de sessão e por um token de renovação rotativo (30 dias).
-- De nenhum dos dois fica o valor no banco: só o hash.

CREATE TABLE oauth_codigos (
  codigo_hash text PRIMARY KEY,
  usuario_id  uuid NOT NULL REFERENCES usuarios(id),
  expira_em   timestamptz NOT NULL,
  usado_em    timestamptz,
  criado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE oauth_refresh (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  text NOT NULL UNIQUE,
  usuario_id  uuid NOT NULL REFERENCES usuarios(id),
  expira_em   timestamptz NOT NULL,
  revogado_em timestamptz,
  ip          text,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth_refresh_usuario ON oauth_refresh (usuario_id) WHERE revogado_em IS NULL;
