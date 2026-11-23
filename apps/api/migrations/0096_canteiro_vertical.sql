-- Canteiro: recursos vendidos à parte (canteiro horizontal, canteiro vertical e centrais de produção) e o tipo de
-- canteiro de cada obra. As empresas que já existem continuam com o canteiro e as centrais, como antes.
ALTER TABLE empresas ADD COLUMN recursos_contratados text[] NOT NULL DEFAULT '{}';
UPDATE empresas SET recursos_contratados = ARRAY['canteiro_horizontal', 'centrais'];

ALTER TABLE obras ADD COLUMN tipo_canteiro text NOT NULL DEFAULT 'horizontal' CHECK (tipo_canteiro IN ('horizontal', 'vertical'));

-- Pavimentos da obra vertical (torres, andares e lajes em ordem).
CREATE TABLE canteiro_pavimentos (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id    uuid NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  ordem      integer NOT NULL,
  nome       text NOT NULL,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (obra_id, nome)
);

-- Agenda de guincho ou grua por pavimento: um turno de uso do equipamento, com horário.
CREATE TABLE canteiro_agenda_vertical (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id       uuid NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  pavimento_id  uuid NOT NULL REFERENCES canteiro_pavimentos(id) ON DELETE CASCADE,
  equipamento   text NOT NULL CHECK (equipamento IN ('guincho', 'grua')),
  data          date NOT NULL,
  inicio        time NOT NULL,
  fim           time NOT NULL CHECK (fim > inicio),
  descricao     text NOT NULL DEFAULT '',
  criado_por    uuid REFERENCES usuarios(id),
  criado_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX canteiro_agenda_vertical_obra ON canteiro_agenda_vertical (obra_id, equipamento, data);

-- Etapas do ciclo de cada laje (formas, armação, concretagem, cura e desforma), com as datas reais ou previstas.
CREATE TABLE canteiro_ciclo_etapas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id       uuid NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  pavimento_id  uuid NOT NULL REFERENCES canteiro_pavimentos(id) ON DELETE CASCADE,
  etapa         text NOT NULL CHECK (etapa IN ('formas', 'armacao', 'concretagem', 'cura', 'desforma')),
  inicio        date NOT NULL,
  fim           date NOT NULL CHECK (fim >= inicio),
  UNIQUE (pavimento_id, etapa)
);

-- Concretagens por andar: volume lançado em cada data (consumo de concreto por andar).
CREATE TABLE canteiro_concretagens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id       uuid NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  pavimento_id  uuid NOT NULL REFERENCES canteiro_pavimentos(id) ON DELETE CASCADE,
  data          date NOT NULL,
  volume_m3     numeric(10, 2) NOT NULL CHECK (volume_m3 > 0),
  fck           text NOT NULL DEFAULT '',
  nota          text NOT NULL DEFAULT '',
  criado_por    uuid REFERENCES usuarios(id),
  criado_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX canteiro_concretagens_pavimento ON canteiro_concretagens (pavimento_id, data);
