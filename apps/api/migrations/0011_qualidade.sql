-- Módulo Qualidade: slump e corpos de prova por carga, resultados, equipamentos e ensaios de insumos.
ALTER TYPE perfil ADD VALUE IF NOT EXISTS 'laboratorista';

CREATE TABLE qualidade_config (
  empresa_id            uuid PRIMARY KEY REFERENCES empresas(id),
  idades                integer[] NOT NULL DEFAULT '{7,28}',
  cps_por_idade         integer NOT NULL DEFAULT 2 CHECK (cps_por_idade BETWEEN 1 AND 4),
  idade_controle        integer NOT NULL DEFAULT 28 CHECK (idade_controle BETWEEN 1 AND 120),
  diametro_mm           integer NOT NULL DEFAULT 100 CHECK (diametro_mm BETWEEN 50 AND 200),
  responsavel_nome      text,
  responsavel_registro  text,
  atualizado_em         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE amostras (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresas(id),
  carga_id       uuid NOT NULL UNIQUE REFERENCES cargas(id) ON DELETE CASCADE,
  data_moldagem  timestamptz NOT NULL,
  slump_cm       numeric(4,1) CHECK (slump_cm IS NULL OR slump_cm BETWEEN 0 AND 30),
  temperatura_c  numeric(4,1),
  moldado_por    text,
  observacao     text,
  status         text NOT NULL DEFAULT 'ativa',
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amostras_status CHECK (status IN ('ativa', 'cancelada'))
);
CREATE INDEX amostras_empresa_data ON amostras (empresa_id, data_moldagem);

CREATE TABLE corpos_prova (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL REFERENCES empresas(id),
  amostra_id       uuid NOT NULL REFERENCES amostras(id) ON DELETE CASCADE,
  idade_dias       integer NOT NULL,
  numero           integer NOT NULL,
  data_prevista    date NOT NULL,
  data_ruptura     date,
  resistencia_mpa  numeric(5,2) CHECK (resistencia_mpa IS NULL OR (resistencia_mpa > 0 AND resistencia_mpa < 200)),
  carga_kn         numeric(7,2),
  tipo_ruptura     text,
  situacao         text NOT NULL DEFAULT 'aguardando',
  observacao       text,
  rompido_por_id   uuid REFERENCES usuarios(id),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT corpos_prova_situacao CHECK (situacao IN ('aguardando', 'rompido', 'descartado')),
  UNIQUE (amostra_id, idade_dias, numero)
);
CREATE INDEX corpos_prova_prevista ON corpos_prova (empresa_id, situacao, data_prevista);

CREATE TABLE equipamentos (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES empresas(id),
  nome               text NOT NULL,
  tipo               text NOT NULL DEFAULT 'outro',
  identificacao      text,
  ultima_calibracao  date,
  validade_dias      integer CHECK (validade_dias IS NULL OR validade_dias > 0),
  certificado        text,
  laboratorio        text,
  observacoes        text,
  ativo              boolean NOT NULL DEFAULT true,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  atualizado_em      timestamptz NOT NULL DEFAULT now(),
  excluido_em        timestamptz,
  CONSTRAINT equipamentos_tipo CHECK (tipo IN ('balanca', 'prensa', 'cone_slump', 'termometro', 'molde', 'outro'))
);

CREATE TABLE ensaios_insumos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES empresas(id),
  insumo_id           uuid NOT NULL REFERENCES insumos(id),
  data                date NOT NULL,
  tipo                text NOT NULL,
  umidade_pct         numeric(5,2) CHECK (umidade_pct IS NULL OR umidade_pct BETWEEN 0 AND 40),
  modulo_finura       numeric(4,2),
  dimensao_maxima_mm  numeric(5,1),
  pulverulento_pct    numeric(5,2),
  observacao          text,
  registrado_por_id   uuid REFERENCES usuarios(id),
  criado_em           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ensaios_tipo CHECK (tipo IN ('umidade', 'granulometria'))
);
CREATE INDEX ensaios_insumos_data ON ensaios_insumos (empresa_id, insumo_id, tipo, data);
