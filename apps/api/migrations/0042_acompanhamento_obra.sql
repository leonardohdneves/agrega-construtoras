-- Acompanhamento de obra: medições físicas. Cada medição é uma data; em cada data, o % acumulado de cada linha (folha) da EAP.
-- O último % informado de uma linha vale até a próxima medição dela.
CREATE TABLE obra_medicoes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id       uuid NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  data          date NOT NULL,
  descricao     text,
  criado_por    uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (obra_id, data)
);

CREATE TABLE obra_medicao_itens (
  medicao_id    uuid NOT NULL REFERENCES obra_medicoes(id) ON DELETE CASCADE,
  eap_no_id     uuid NOT NULL REFERENCES eap_nos(id) ON DELETE CASCADE,
  percentual    numeric(7,4) NOT NULL CHECK (percentual >= 0 AND percentual <= 100),
  quantidade    numeric(16,4) CHECK (quantidade IS NULL OR quantidade >= 0),
  PRIMARY KEY (medicao_id, eap_no_id)
);
CREATE INDEX obra_medicao_itens_no ON obra_medicao_itens (eap_no_id);
