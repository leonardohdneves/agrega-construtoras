-- Operação de campo: carga no app do motorista (etapas, slump na obra, devolvido), carga final da venda,
-- demanda da qualidade confirmada pelo laboratório, venda → contas a receber, mural de avisos.

-- ----- cargas: etapas do motorista e carga final
ALTER TABLE cargas
  ADD COLUMN saida_em          timestamptz,
  ADD COLUMN chegada_em        timestamptz,
  ADD COLUMN descarga_em       timestamptz,
  ADD COLUMN slump_entrega_cm  numeric(4,1) CHECK (slump_entrega_cm IS NULL OR slump_entrega_cm BETWEEN 0 AND 30),
  ADD COLUMN obs_motorista     text,
  ADD COLUMN carga_final       boolean NOT NULL DEFAULT false;
-- Cargas antigas já foram entregues.
UPDATE cargas SET descarga_em = data_hora + interval '90 minutes' WHERE status = 'produzida';

-- ----- qualidade: a amostra nasce pendente e o laboratório confirma a moldagem (ou marca "não amostrada")
ALTER TABLE amostras DROP CONSTRAINT amostras_status;
ALTER TABLE amostras ADD CONSTRAINT amostras_status CHECK (status IN ('pendente', 'ativa', 'nao_amostrada', 'cancelada'));
ALTER TABLE amostras
  ADD COLUMN confirmada_em      timestamptz,
  ADD COLUMN confirmada_por_id  uuid REFERENCES usuarios(id);
UPDATE amostras SET confirmada_em = data_moldagem WHERE status = 'ativa';

-- ----- vendas: condição de pagamento estruturada, adicionais contratuais e conta a receber
ALTER TABLE vendas
  ADD COLUMN forma_pagamento           text,
  ADD COLUMN prazos_dias               integer[],
  ADD COLUMN entrega_finalizada_em     timestamptz,
  ADD COLUMN entrega_finalizada_por_id uuid REFERENCES usuarios(id),
  ADD COLUMN lancamento_id             uuid REFERENCES lancamentos(id),
  ADD CONSTRAINT vendas_forma CHECK (forma_pagamento IS NULL OR forma_pagamento IN ('pix', 'boleto', 'transferencia', 'cartao', 'dinheiro', 'cheque', 'debito_automatico'));

CREATE TABLE vendas_adicionais (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresas(id),
  venda_id        uuid NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
  tipo            text NOT NULL DEFAULT 'outro',
  descricao       text NOT NULL,
  valor_centavos  bigint NOT NULL CHECK (valor_centavos > 0),
  criado_por_id   uuid REFERENCES usuarios(id),
  criado_em       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendas_adicionais_tipo CHECK (tipo IN ('feriado', 'hora_excedente', 'equipamento_parado', 'volume_minimo', 'outro'))
);
CREATE INDEX vendas_adicionais_venda ON vendas_adicionais (venda_id);

-- Origem dos lançamentos: 'extrato' tinha ficado de fora na 0014 (conciliação) e entra 'comercial'.
ALTER TABLE lancamentos DROP CONSTRAINT lancamentos_origem;
ALTER TABLE lancamentos ADD CONSTRAINT lancamentos_origem CHECK (origem IN ('manual', 'xml', 'ia_whatsapp', 'frota', 'extrato', 'suprimentos', 'comercial'));

-- ----- mural de avisos
CREATE TABLE avisos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresas(id),
  titulo         text NOT NULL,
  texto          text NOT NULL,
  perfis         text[],             -- null = todos
  fixado         boolean NOT NULL DEFAULT false,
  ate            date,               -- sai do mural depois desta data (continua no relatório)
  criado_por_id  uuid REFERENCES usuarios(id),
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  excluido_em    timestamptz,
  excluido_por_id uuid REFERENCES usuarios(id)
);
CREATE INDEX avisos_empresa ON avisos (empresa_id, criado_em DESC);

-- Blocos do mural configurados pelo dono.
ALTER TABLE empresas ADD COLUMN mural jsonb;

-- Aniversariantes do mês.
ALTER TABLE motoristas ADD COLUMN data_nascimento date;
