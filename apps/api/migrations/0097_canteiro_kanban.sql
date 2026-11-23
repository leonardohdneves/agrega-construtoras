-- Kanban das centrais do canteiro: cada serviço de uma central vira uma frente (o card), com prioridade e ordem.
-- Quando a frente é liberada, gera uma OS (ordem de serviço); o status da OS define a coluna do card.
CREATE TABLE canteiro_frentes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id     uuid NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  central     text NOT NULL CHECK (central IN ('argamassa', 'carpintaria', 'armacao', 'almoxarifado')),
  eap_no_id   uuid NOT NULL UNIQUE REFERENCES eap_nos(id) ON DELETE CASCADE,
  prioridade  text NOT NULL DEFAULT 'media' CHECK (prioridade IN ('alta', 'media', 'baixa')),
  ordem       integer NOT NULL DEFAULT 0,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX canteiro_frentes_central ON canteiro_frentes (obra_id, central, ordem);

CREATE TABLE canteiro_os (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id       uuid NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  frente_id     uuid NOT NULL REFERENCES canteiro_frentes(id) ON DELETE CASCADE,
  numero        integer NOT NULL,
  status        text NOT NULL DEFAULT 'liberada' CHECK (status IN ('liberada', 'em_execucao', 'concluida', 'cancelada')),
  criado_por    uuid REFERENCES usuarios(id),
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (obra_id, numero)
);
CREATE INDEX canteiro_os_frente ON canteiro_os (frente_id, criado_em);
