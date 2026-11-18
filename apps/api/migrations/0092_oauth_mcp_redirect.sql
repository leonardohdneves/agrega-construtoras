-- P38: o código de login do OAuth fica preso ao endereço de retorno (o /oauth/callback do servidor MCP) usado no login.
-- Códigos vivem 60 segundos: os que existirem sem o endereço deixam de valer.
ALTER TABLE oauth_codigos ADD COLUMN IF NOT EXISTS redirect_uri text;
