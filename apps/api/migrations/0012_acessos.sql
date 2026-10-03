-- Acesso por módulos, administradores, logo da empresa e preferências de impressão.
ALTER TABLE usuarios
  ADD COLUMN administrador boolean NOT NULL DEFAULT false,
  ADD COLUMN modulos text[];
UPDATE usuarios SET administrador = true WHERE perfil = 'dono';

ALTER TABLE empresas
  ADD COLUMN logo bytea,
  ADD COLUMN logo_tipo text,
  ADD COLUMN logo_atualizado_em timestamptz,
  ADD COLUMN impressao jsonb NOT NULL DEFAULT '{"orientacao": "paisagem", "papel": "A4"}';
