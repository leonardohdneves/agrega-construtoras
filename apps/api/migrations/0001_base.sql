-- Etapa 0 · Base do sistema: empresas, usuários, anexos e auditoria.

CREATE TYPE perfil AS ENUM ('admin_sistema', 'dono', 'gestor', 'motorista');
CREATE TYPE regime_tributario AS ENUM ('simples', 'presumido', 'real');

CREATE TABLE empresas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  razao_social      text NOT NULL,
  nome_fantasia     text,
  cnpj              char(14) NOT NULL UNIQUE,
  regime_tributario regime_tributario NOT NULL DEFAULT 'simples',
  aliquotas_dre     jsonb NOT NULL DEFAULT '{}'::jsonb,
  telefone          text,
  email             text,
  cidade            text,
  uf                char(2),
  plano             text NOT NULL DEFAULT 'piloto',
  ativo             boolean NOT NULL DEFAULT true,
  criado_em         timestamptz NOT NULL DEFAULT now(),
  atualizado_em     timestamptz NOT NULL DEFAULT now(),
  excluido_em       timestamptz
);

CREATE TABLE usuarios (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid REFERENCES empresas(id),
  nome              text NOT NULL,
  email             text NOT NULL,
  senha_hash        text NOT NULL,
  perfil            perfil NOT NULL,
  telefone_whatsapp text,
  motorista_id      uuid,
  ativo             boolean NOT NULL DEFAULT true,
  ultimo_acesso     timestamptz,
  criado_em         timestamptz NOT NULL DEFAULT now(),
  atualizado_em     timestamptz NOT NULL DEFAULT now(),
  excluido_em       timestamptz,
  CONSTRAINT usuarios_empresa_perfil CHECK ((perfil = 'admin_sistema') = (empresa_id IS NULL))
);
CREATE UNIQUE INDEX usuarios_email_unico ON usuarios (lower(email)) WHERE excluido_em IS NULL;
CREATE INDEX usuarios_empresa ON usuarios (empresa_id);

CREATE TABLE anexos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresas(id),
  entidade       text NOT NULL,
  entidade_id    uuid NOT NULL,
  arquivo_url    text NOT NULL,
  nome_arquivo   text,
  tipo           text,
  tamanho        integer,
  enviado_por_id uuid REFERENCES usuarios(id),
  criado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX anexos_entidade ON anexos (empresa_id, entidade, entidade_id);

CREATE TABLE auditoria (
  id          bigserial PRIMARY KEY,
  empresa_id  uuid REFERENCES empresas(id),
  usuario_id  uuid REFERENCES usuarios(id),
  acao        text NOT NULL,
  entidade    text NOT NULL,
  entidade_id text NOT NULL,
  antes       jsonb,
  depois      jsonb,
  data_hora   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auditoria_empresa_data ON auditoria (empresa_id, data_hora DESC);
