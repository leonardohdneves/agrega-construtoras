-- Módulo Produção (Etapa 8A): insumos, traços, cargas produzidas, valores de produção dos motoristas e escala.
-- O novo perfil é usado só em transações seguintes (Postgres não permite usar o valor na mesma transação).
ALTER TYPE perfil ADD VALUE IF NOT EXISTS 'operador_usina';

CREATE TABLE insumos (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id               uuid NOT NULL REFERENCES empresas(id),
  nome                     text NOT NULL,
  tipo                     text NOT NULL DEFAULT 'outro',
  unidade                  text NOT NULL DEFAULT 'kg',
  custo_unitario_centavos  numeric(14,4),
  estoque_minimo           numeric(14,3),
  ativo                    boolean NOT NULL DEFAULT true,
  criado_em                timestamptz NOT NULL DEFAULT now(),
  atualizado_em            timestamptz NOT NULL DEFAULT now(),
  excluido_em              timestamptz,
  CONSTRAINT insumos_tipo CHECK (tipo IN ('cimento', 'areia', 'brita', 'aditivo', 'agua', 'fibra', 'outro')),
  CONSTRAINT insumos_unidade CHECK (unidade IN ('kg', 'L', 'm3', 't', 'un')),
  CONSTRAINT insumos_custo CHECK (custo_unitario_centavos IS NULL OR custo_unitario_centavos >= 0)
);
CREATE UNIQUE INDEX insumos_nome_unico ON insumos (empresa_id, lower(nome)) WHERE excluido_em IS NULL;

CREATE TABLE tracos (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id               uuid NOT NULL REFERENCES empresas(id),
  codigo                   text NOT NULL,
  descricao                text,
  fck                      integer CHECK (fck IS NULL OR fck BETWEEN 5 AND 100),
  slump                    text,
  brita                    text,
  observacoes              text,
  ativo                    boolean NOT NULL DEFAULT true,
  criado_em                timestamptz NOT NULL DEFAULT now(),
  atualizado_em            timestamptz NOT NULL DEFAULT now(),
  excluido_em              timestamptz
);
CREATE UNIQUE INDEX tracos_codigo_unico ON tracos (empresa_id, upper(codigo)) WHERE excluido_em IS NULL;

CREATE TABLE tracos_itens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES empresas(id),
  traco_id    uuid NOT NULL REFERENCES tracos(id) ON DELETE CASCADE,
  insumo_id   uuid NOT NULL REFERENCES insumos(id),
  quantidade  numeric(12,3) NOT NULL CHECK (quantidade > 0),
  UNIQUE (traco_id, insumo_id)
);

CREATE TABLE cargas (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           uuid NOT NULL REFERENCES empresas(id),
  numero               integer NOT NULL,
  data_hora            timestamptz NOT NULL,
  traco_id             uuid NOT NULL REFERENCES tracos(id),
  volume_m3            numeric(6,2) NOT NULL CHECK (volume_m3 > 0 AND volume_m3 <= 20),
  cliente_id           uuid REFERENCES clientes(id),
  obra                 text,
  betoneira_id         uuid NOT NULL REFERENCES veiculos(id),
  motorista_id         uuid REFERENCES motoristas(id),
  bomba_id             uuid REFERENCES veiculos(id),
  operador_bomba_id    uuid REFERENCES motoristas(id),
  volume_bombeado_m3   numeric(6,2) CHECK (volume_bombeado_m3 IS NULL OR volume_bombeado_m3 >= 0),
  devolvido_m3         numeric(6,2) NOT NULL DEFAULT 0 CHECK (devolvido_m3 >= 0),
  documento            text,
  observacoes          text,
  status               text NOT NULL DEFAULT 'produzida',
  motivo_cancelamento  text,
  registrado_por_id    uuid REFERENCES usuarios(id),
  criado_em            timestamptz NOT NULL DEFAULT now(),
  atualizado_em        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cargas_status CHECK (status IN ('produzida', 'cancelada')),
  CONSTRAINT cargas_devolvido CHECK (devolvido_m3 <= volume_m3),
  UNIQUE (empresa_id, numero)
);
CREATE INDEX cargas_empresa_data ON cargas (empresa_id, data_hora);
CREATE INDEX cargas_motorista ON cargas (motorista_id);
CREATE INDEX cargas_operador ON cargas (operador_bomba_id);

-- R$ por m³ pago como produção; vale a partir da data de vigência (reajustes não mudam períodos anteriores).
CREATE TABLE valores_producao (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES empresas(id),
  funcao              text NOT NULL,
  valor_m3_centavos   bigint NOT NULL CHECK (valor_m3_centavos >= 0),
  vigencia            date NOT NULL,
  criado_por_id       uuid REFERENCES usuarios(id),
  criado_em           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valores_producao_funcao CHECK (funcao IN ('motorista', 'operador_bomba')),
  UNIQUE (empresa_id, funcao, vigencia)
);

-- Escala do dia: horário de entrada ou folga de cada motorista e operador de bomba.
CREATE TABLE escalas (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES empresas(id),
  data               date NOT NULL,
  motorista_id       uuid NOT NULL REFERENCES motoristas(id),
  entrada            time,
  folga              boolean NOT NULL DEFAULT false,
  observacao         text,
  atualizado_por_id  uuid REFERENCES usuarios(id),
  atualizado_em      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT escalas_entrada_ou_folga CHECK (folga OR entrada IS NOT NULL),
  UNIQUE (empresa_id, data, motorista_id)
);
