-- Etapa 1 · Cadastros da frota: veículos, motoristas e documentos dos veículos.

CREATE TYPE tipo_veiculo AS ENUM ('betoneira', 'bomba_lanca', 'bomba_estacionaria', 'apoio', 'pa_carregadeira');
CREATE TYPE status_veiculo AS ENUM ('disponivel', 'manutencao', 'parado', 'inativo');
CREATE TYPE tipo_documento AS ENUM ('crlv', 'licenciamento', 'seguro', 'ipva', 'tacografo', 'outro');

CREATE TABLE veiculos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL REFERENCES empresas(id),
  codigo           text NOT NULL,
  tipo             tipo_veiculo NOT NULL,
  placa            text,
  marca_modelo     text,
  ano              smallint,
  capacidade_m3    numeric(5,1),
  alcance_lanca_m  numeric(5,1),
  km_atual         numeric(12,1) NOT NULL DEFAULT 0,
  horimetro_atual  numeric(12,1) NOT NULL DEFAULT 0,
  status           status_veiculo NOT NULL DEFAULT 'disponivel',
  observacoes      text,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  excluido_em      timestamptz
);
CREATE UNIQUE INDEX veiculos_codigo_unico ON veiculos (empresa_id, upper(codigo)) WHERE excluido_em IS NULL;
CREATE UNIQUE INDEX veiculos_placa_unica ON veiculos (empresa_id, placa) WHERE excluido_em IS NULL AND placa IS NOT NULL;

CREATE TABLE motoristas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresas(id),
  nome            text NOT NULL,
  telefone        text,
  cpf             char(11),
  funcao          text NOT NULL DEFAULT 'motorista',
  cnh_numero      text,
  cnh_categoria   text,
  cnh_vencimento  date,
  cursos          jsonb NOT NULL DEFAULT '[]'::jsonb,
  ativo           boolean NOT NULL DEFAULT true,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  excluido_em     timestamptz,
  CONSTRAINT motoristas_funcao CHECK (funcao IN ('motorista', 'operador_bomba', 'motorista_operador'))
);
CREATE INDEX motoristas_empresa ON motoristas (empresa_id);

ALTER TABLE usuarios
  ADD CONSTRAINT usuarios_motorista_fk FOREIGN KEY (motorista_id) REFERENCES motoristas(id);
CREATE UNIQUE INDEX usuarios_motorista_unico ON usuarios (motorista_id) WHERE motorista_id IS NOT NULL AND excluido_em IS NULL;

CREATE TABLE documentos_veiculo (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresas(id),
  veiculo_id     uuid NOT NULL REFERENCES veiculos(id),
  tipo           tipo_documento NOT NULL,
  descricao      text,
  numero         text,
  vencimento     date,
  valor_centavos bigint,
  lancamento_id  uuid,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  excluido_em    timestamptz
);
CREATE INDEX documentos_veiculo_veiculo ON documentos_veiculo (empresa_id, veiculo_id);
CREATE INDEX documentos_veiculo_vencimento ON documentos_veiculo (empresa_id, vencimento) WHERE excluido_em IS NULL;
