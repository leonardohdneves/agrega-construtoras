-- Engenharia: insumos que a obra precisa, apropriados a um nó da EAP no nível de apropriação da obra.
-- Ainda não geram solicitação de compra no Suprimentos.
CREATE TABLE obra_necessidades (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id            uuid NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  obra_item_id       uuid NOT NULL REFERENCES obra_itens(id) ON DELETE RESTRICT,
  eap_no_id          uuid REFERENCES eap_nos(id),
  quantidade         numeric(14,4) NOT NULL CHECK (quantidade > 0),
  data_necessaria    date,
  observacao         text,
  status             text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'cancelada')),
  criado_em          timestamptz NOT NULL DEFAULT now(),
  atualizado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX obra_necessidades_obra ON obra_necessidades (obra_id);
