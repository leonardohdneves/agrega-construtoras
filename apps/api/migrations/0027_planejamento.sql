-- Engenharia (fase 2): planejamento da obra. Atividades ligadas a um nó da EAP no nível do orçamento.
CREATE TABLE obra_atividades (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id         uuid NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  eap_no_id       uuid REFERENCES eap_nos(id),
  descricao       text NOT NULL,
  inicio          date NOT NULL,
  duracao_dias    integer NOT NULL CHECK (duracao_dias >= 1),
  predecessora_id uuid REFERENCES obra_atividades(id) ON DELETE SET NULL,
  ordem           integer NOT NULL DEFAULT 0,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX obra_atividades_obra ON obra_atividades (obra_id);
