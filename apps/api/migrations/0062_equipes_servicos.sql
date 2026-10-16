-- Produção da equipe na construtora: cada serviço (folha da EAP) tem uma equipe responsável e um preço por unidade.
-- Um serviço tem uma só equipe, para que a produção não seja paga duas vezes.
CREATE TABLE equipes_servicos (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id               uuid NOT NULL REFERENCES empresas(id),
  obra_id                  uuid NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  eap_no_id                uuid NOT NULL REFERENCES eap_nos(id) ON DELETE CASCADE,
  colaborador_id           uuid NOT NULL REFERENCES motoristas(id),
  preco_unitario_centavos  bigint NOT NULL CHECK (preco_unitario_centavos >= 0),
  criado_em                timestamptz NOT NULL DEFAULT now(),
  atualizado_em            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (obra_id, eap_no_id)
);
CREATE INDEX equipes_servicos_colaborador ON equipes_servicos (colaborador_id);
