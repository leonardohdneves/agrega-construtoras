-- CPs moldados na obra pelo motorista: os CPs nascem com a carga (etiquetas impressas com o romaneio),
-- o motorista informa a moldagem no app e o laboratório confirma o recebimento.
ALTER TABLE amostras DROP CONSTRAINT amostras_status;
ALTER TABLE amostras ADD CONSTRAINT amostras_status CHECK (status IN ('pendente', 'moldada', 'ativa', 'nao_amostrada', 'cancelada'));
ALTER TABLE amostras
  ADD COLUMN cps_moldados       integer CHECK (cps_moldados IS NULL OR cps_moldados >= 0),
  ADD COLUMN moldada_em         timestamptz,
  ADD COLUMN moldada_por_id     uuid REFERENCES motoristas(id),
  ADD COLUMN recebida_em        timestamptz,
  ADD COLUMN recebida_por_id    uuid REFERENCES usuarios(id);

ALTER TABLE cargas
  ADD COLUMN romaneio_impresso_em   timestamptz,
  ADD COLUMN etiquetas_impressas_em timestamptz;
