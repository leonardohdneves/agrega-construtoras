-- Senha inicial (dono de construtora nova, usuário criado ou senha redefinida pelo administrador):
-- o usuário só usa o sistema depois de trocar a senha. Usuários que já existiam não são afetados.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS senha_provisoria boolean NOT NULL DEFAULT false;
