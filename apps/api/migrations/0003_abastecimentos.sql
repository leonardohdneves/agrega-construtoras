-- Etapa 2 · Abastecimentos: registro operacional (litros, km, horímetro, valor).
-- A despesa financeira do diesel nasce da nota do posto (Etapa 5), que será ligada a estes registros.

CREATE TYPE origem_abastecimento AS ENUM ('posto', 'tanque_proprio');

CREATE TABLE abastecimentos (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           uuid NOT NULL REFERENCES empresas(id),
  veiculo_id           uuid NOT NULL REFERENCES veiculos(id),
  motorista_id         uuid REFERENCES motoristas(id),
  registrado_por_id    uuid REFERENCES usuarios(id),
  data_hora            timestamptz NOT NULL,
  litros               numeric(9,2) NOT NULL CHECK (litros > 0),
  valor_total_centavos bigint CHECK (valor_total_centavos >= 0),
  km                   numeric(12,1),
  horimetro            numeric(12,1),
  origem               origem_abastecimento NOT NULL DEFAULT 'posto',
  posto                text,
  tanque_cheio         boolean NOT NULL DEFAULT true,
  observacoes          text,
  fornecedor_id        uuid,
  nota_item_id         uuid,
  criado_em            timestamptz NOT NULL DEFAULT now(),
  atualizado_em        timestamptz NOT NULL DEFAULT now(),
  excluido_em          timestamptz,
  CONSTRAINT abastecimentos_km_ou_horimetro CHECK (km IS NOT NULL OR horimetro IS NOT NULL)
);
CREATE INDEX abastecimentos_veiculo_data ON abastecimentos (empresa_id, veiculo_id, data_hora) WHERE excluido_em IS NULL;
CREATE INDEX abastecimentos_empresa_data ON abastecimentos (empresa_id, data_hora DESC) WHERE excluido_em IS NULL;
