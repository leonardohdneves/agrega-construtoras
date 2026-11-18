-- Perfil Mestre de obra: vê só as obras atribuídas a ele (obra_responsaveis) e a Engenharia dessas obras, em modo de consulta.
ALTER TYPE perfil ADD VALUE IF NOT EXISTS 'mestre_obra';

-- Canteiro de obra: quatro centrais por obra (argamassa, carpintaria, armação e almoxarifado).
-- A engenharia associa os serviços (folhas da EAP) a cada central, define a periodicidade e gera os boletins de produção.
CREATE TABLE canteiro_centrais (
  obra_id             uuid NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  tipo                text NOT NULL CHECK (tipo IN ('argamassa', 'carpintaria', 'armacao', 'almoxarifado')),
  periodicidade_dias  integer NOT NULL DEFAULT 7 CHECK (periodicidade_dias BETWEEN 1 AND 90),
  atualizado_em       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (obra_id, tipo)
);

-- Cada serviço (EAP) pertence a no máximo uma central da obra.
CREATE TABLE canteiro_servicos (
  eap_no_id  uuid PRIMARY KEY REFERENCES eap_nos(id) ON DELETE CASCADE,
  obra_id    uuid NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  tipo       text NOT NULL,
  FOREIGN KEY (obra_id, tipo) REFERENCES canteiro_centrais(obra_id, tipo) ON DELETE CASCADE
);
CREATE INDEX canteiro_servicos_central ON canteiro_servicos (obra_id, tipo);

-- Boletim: produção planejada pela engenharia para um período. Os % são gravados no momento da geração.
CREATE TABLE canteiro_boletins (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id     uuid NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  tipo        text NOT NULL,
  numero      integer NOT NULL,
  inicio      date NOT NULL,
  fim         date NOT NULL CHECK (fim >= inicio),
  criado_por  uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (obra_id, tipo, numero),
  FOREIGN KEY (obra_id, tipo) REFERENCES canteiro_centrais(obra_id, tipo) ON DELETE CASCADE
);

CREATE TABLE canteiro_boletim_itens (
  boletim_id     uuid NOT NULL REFERENCES canteiro_boletins(id) ON DELETE CASCADE,
  eap_no_id      uuid NOT NULL REFERENCES eap_nos(id) ON DELETE CASCADE,
  previsto_pct   numeric(7,4) NOT NULL,
  realizado_pct  numeric(7,4) NOT NULL,
  PRIMARY KEY (boletim_id, eap_no_id)
);
