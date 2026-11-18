-- P20: versão da sessão do usuário. Todo token de sessão leva a versão em que foi emitido; trocar a senha soma um,
-- e os tokens emitidos antes (cookie do navegador e Bearer do servidor MCP) deixam de valer na requisição seguinte.
-- Tokens emitidos antes desta migração não levam versão e valem como versão 0.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS sessao_versao integer NOT NULL DEFAULT 0;
-- O token de renovação do OAuth guarda a versão em que nasceu: se a senha mudou depois, ele não renova,
-- mesmo que tenha sido criado por uma renovação que corria junto com a troca de senha.
ALTER TABLE oauth_refresh ADD COLUMN IF NOT EXISTS sessao_versao integer NOT NULL DEFAULT 0;
