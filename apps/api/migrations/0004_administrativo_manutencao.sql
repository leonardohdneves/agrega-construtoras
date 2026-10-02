-- Etapa 3 · Módulo Administrativo (fornecedores, credores, colaboradores) e manutenção da frota.

-- ---------- Administrativo ----------
CREATE TABLE fornecedores (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id             uuid NOT NULL REFERENCES empresas(id),
  categoria              text NOT NULL DEFAULT 'fornecedor',
  tipo_pessoa            char(2) NOT NULL DEFAULT 'PJ',
  cnpj_cpf               text,
  razao_social           text NOT NULL,
  nome_fantasia          text,
  ramo                   text,
  telefone               text,
  email                  text,
  cidade                 text,
  uf                     char(2),
  chave_pix              text,
  observacoes            text,
  categoria_padrao_id    uuid,
  criado_automaticamente boolean NOT NULL DEFAULT false,
  ativo                  boolean NOT NULL DEFAULT true,
  criado_em              timestamptz NOT NULL DEFAULT now(),
  atualizado_em          timestamptz NOT NULL DEFAULT now(),
  excluido_em            timestamptz,
  CONSTRAINT fornecedores_categoria CHECK (categoria IN ('fornecedor', 'credor')),
  CONSTRAINT fornecedores_tipo_pessoa CHECK (tipo_pessoa IN ('PJ', 'PF'))
);
CREATE UNIQUE INDEX fornecedores_documento_unico ON fornecedores (empresa_id, cnpj_cpf) WHERE excluido_em IS NULL AND cnpj_cpf IS NOT NULL;
CREATE INDEX fornecedores_empresa ON fornecedores (empresa_id, categoria);

ALTER TABLE abastecimentos ADD CONSTRAINT abastecimentos_fornecedor_fk FOREIGN KEY (fornecedor_id) REFERENCES fornecedores(id);

-- Colaboradores: a tabela de motoristas passa a guardar todos os colaboradores, com a função de cada um.
ALTER TABLE motoristas DROP CONSTRAINT motoristas_funcao;
ALTER TABLE motoristas ADD CONSTRAINT motoristas_funcao CHECK (funcao IN (
  'motorista', 'operador_bomba', 'motorista_operador', 'operador_usina', 'mecanico', 'laboratorista', 'administrativo', 'vendedor', 'outro'
));
ALTER TABLE motoristas
  ADD COLUMN cargo text,
  ADD COLUMN email text,
  ADD COLUMN data_admissao date,
  ADD COLUMN observacoes text;

-- ---------- Manutenção ----------
CREATE TABLE planos_manutencao (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresas(id),
  tipo_veiculo    tipo_veiculo,
  item            text NOT NULL,
  intervalo_km    integer CHECK (intervalo_km > 0),
  intervalo_horas integer CHECK (intervalo_horas > 0),
  intervalo_dias  integer CHECK (intervalo_dias > 0),
  ativo           boolean NOT NULL DEFAULT true,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT planos_intervalo CHECK (intervalo_km IS NOT NULL OR intervalo_horas IS NOT NULL OR intervalo_dias IS NOT NULL)
);
CREATE INDEX planos_manutencao_empresa ON planos_manutencao (empresa_id);

CREATE TABLE revisoes_veiculo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES empresas(id),
  veiculo_id    uuid NOT NULL REFERENCES veiculos(id),
  plano_id      uuid NOT NULL REFERENCES planos_manutencao(id),
  ultima_km     numeric(12,1),
  ultima_horas  numeric(12,1),
  ultima_data   date,
  os_id         uuid,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (veiculo_id, plano_id)
);

CREATE TYPE status_os AS ENUM ('aberta', 'em_andamento', 'concluida', 'cancelada');

CREATE TABLE ordens_servico (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresas(id),
  numero         integer NOT NULL,
  veiculo_id     uuid NOT NULL REFERENCES veiculos(id),
  tipo           text NOT NULL,
  descricao      text NOT NULL,
  abertura       date NOT NULL,
  conclusao      date,
  km             numeric(12,1),
  horimetro      numeric(12,1),
  oficina        text NOT NULL DEFAULT 'externa',
  fornecedor_id  uuid REFERENCES fornecedores(id),
  status         status_os NOT NULL DEFAULT 'aberta',
  status_veiculo_anterior status_veiculo,
  observacoes    text,
  aberta_por_id  uuid REFERENCES usuarios(id),
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT os_tipo CHECK (tipo IN ('preventiva', 'corretiva')),
  CONSTRAINT os_oficina CHECK (oficina IN ('interna', 'externa')),
  UNIQUE (empresa_id, numero)
);
CREATE INDEX ordens_servico_veiculo ON ordens_servico (empresa_id, veiculo_id, abertura DESC);

ALTER TABLE revisoes_veiculo ADD CONSTRAINT revisoes_os_fk FOREIGN KEY (os_id) REFERENCES ordens_servico(id);

CREATE TABLE os_itens (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id              uuid NOT NULL REFERENCES empresas(id),
  os_id                   uuid NOT NULL REFERENCES ordens_servico(id),
  tipo                    text NOT NULL,
  descricao               text NOT NULL,
  quantidade              numeric(10,3) NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  valor_unitario_centavos bigint NOT NULL DEFAULT 0 CHECK (valor_unitario_centavos >= 0),
  plano_id                uuid REFERENCES planos_manutencao(id),
  nota_item_id            uuid,
  criado_em               timestamptz NOT NULL DEFAULT now(),
  excluido_em             timestamptz,
  CONSTRAINT os_itens_tipo CHECK (tipo IN ('peca', 'mao_de_obra', 'servico'))
);
CREATE INDEX os_itens_os ON os_itens (os_id) WHERE excluido_em IS NULL;
