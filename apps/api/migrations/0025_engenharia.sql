-- Engenharia (Fase 1): tabelas de referência (SINAPI e próprio), obras com centro de custo e nível de apropriação,
-- itens copiados para cada obra (editáveis só na obra), EAP por níveis e orçamento.

-- Tabelas de referência: a tabela SINAPI é imutável depois de importada; a própria pode ser editada.
CREATE TABLE ref_tabelas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresas(id),
  fonte           text NOT NULL CHECK (fonte IN ('sinapi', 'proprio')),
  nome            text NOT NULL,
  uf              char(2),
  mes_referencia  char(7) CHECK (mes_referencia IS NULL OR mes_referencia ~ '^\d{4}-\d{2}$'),
  desonerado      boolean NOT NULL DEFAULT false,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ref_tabelas_empresa ON ref_tabelas (empresa_id);

CREATE TABLE ref_itens (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tabela_id        uuid NOT NULL REFERENCES ref_tabelas(id) ON DELETE CASCADE,
  tipo             text NOT NULL CHECK (tipo IN ('insumo', 'composicao')),
  codigo           text NOT NULL,
  descricao        text NOT NULL,
  unidade          text NOT NULL,
  grupo            text,
  preco_centavos   bigint CHECK (preco_centavos IS NULL OR preco_centavos >= 0),
  UNIQUE (tabela_id, tipo, codigo)
);

CREATE TABLE ref_composicao_insumos (
  composicao_id uuid NOT NULL REFERENCES ref_itens(id) ON DELETE CASCADE,
  insumo_id     uuid NOT NULL REFERENCES ref_itens(id) ON DELETE CASCADE,
  coeficiente   numeric(16,6) NOT NULL CHECK (coeficiente >= 0),
  PRIMARY KEY (composicao_id, insumo_id)
);

-- Obra e o centro de custo que ela cria; o nível de apropriação diz em que nível o orçamento é lançado.
CREATE TABLE obras (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES empresas(id),
  codigo              text NOT NULL,
  nome                text NOT NULL,
  endereco            text,
  cidade              text,
  uf                  char(2),
  responsavel         text,
  status              text NOT NULL DEFAULT 'planejamento' CHECK (status IN ('planejamento', 'em_andamento', 'suspensa', 'concluida')),
  data_inicio         date,
  data_previsao       date,
  nivel_apropriacao   text NOT NULL DEFAULT 'etapa' CHECK (nivel_apropriacao IN ('obra', 'etapa', 'subetapa', 'tarefa')),
  bdi_percentual      numeric(6,2) NOT NULL DEFAULT 0 CHECK (bdi_percentual >= 0 AND bdi_percentual < 100),
  bdi_modo            text NOT NULL DEFAULT 'informado' CHECK (bdi_modo IN ('calculado', 'informado')),
  bdi_parametros      jsonb,
  centro_custo_id     uuid NOT NULL REFERENCES centros_custo(id),
  ativo               boolean NOT NULL DEFAULT true,
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, codigo)
);

-- Itens copiados da tabela de referência para a obra. origem_* guarda de onde vieram; preco_referencia é o original.
CREATE TABLE obra_itens (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id                 uuid NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  tipo                    text NOT NULL CHECK (tipo IN ('insumo', 'composicao')),
  codigo                  text NOT NULL,
  descricao               text NOT NULL,
  unidade                 text NOT NULL,
  grupo                   text,
  preco_centavos          bigint CHECK (preco_centavos IS NULL OR preco_centavos >= 0),
  origem_tabela_id        uuid REFERENCES ref_tabelas(id) ON DELETE SET NULL,
  origem_fonte            text,
  origem_versao           text,
  preco_referencia_centavos bigint,
  editado                 boolean NOT NULL DEFAULT false,
  criado_em               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (obra_id, tipo, codigo)
);

CREATE TABLE obra_composicao_insumos (
  composicao_id uuid NOT NULL REFERENCES obra_itens(id) ON DELETE CASCADE,
  insumo_id     uuid NOT NULL REFERENCES obra_itens(id) ON DELETE CASCADE,
  coeficiente   numeric(16,6) NOT NULL CHECK (coeficiente >= 0),
  PRIMARY KEY (composicao_id, insumo_id)
);

-- EAP: etapa > subetapa > tarefa, limitada ao nível de apropriação da obra.
CREATE TABLE eap_nos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id     uuid NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  pai_id      uuid REFERENCES eap_nos(id) ON DELETE CASCADE,
  nivel       text NOT NULL CHECK (nivel IN ('etapa', 'subetapa', 'tarefa')),
  codigo      text NOT NULL,
  descricao   text NOT NULL,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (obra_id, codigo)
);

-- Orçamento: cada linha é um item da obra, quantificado num nó da EAP (ou no nível obra, sem nó).
CREATE TABLE orcamento_itens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id      uuid NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  eap_no_id    uuid REFERENCES eap_nos(id) ON DELETE CASCADE,
  obra_item_id uuid NOT NULL REFERENCES obra_itens(id) ON DELETE RESTRICT,
  quantidade   numeric(16,4) NOT NULL CHECK (quantidade > 0),
  ordem        integer NOT NULL DEFAULT 0,
  criado_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orcamento_itens_obra ON orcamento_itens (obra_id);
