-- Incorporação: estudos aprovados importados do Viabiliza (estrutura, nomes e valores vêm de lá).
-- O estado de venda (disponível, reservada, vendida) é do Agrega e não volta para o Viabiliza.

CREATE TABLE incorporacao_empreendimentos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES empresas(id),
  estudo_externo_id   text NOT NULL,
  nome                text NOT NULL,
  cidade              text,
  uf                  char(2),
  versao_estudo       text NOT NULL,
  aprovado_em         text NOT NULL,
  importado_em        timestamptz NOT NULL DEFAULT now(),
  importado_por_id    uuid REFERENCES usuarios(id),
  UNIQUE (empresa_id, estudo_externo_id)
);

CREATE TABLE incorporacao_unidades (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES empresas(id),
  empreendimento_id   uuid NOT NULL REFERENCES incorporacao_empreendimentos(id) ON DELETE CASCADE,
  codigo_externo      text NOT NULL,
  nome                text NOT NULL,
  numero              integer,
  andar               integer,
  tipologia           text,
  area_privativa      numeric(12,2) NOT NULL CHECK (area_privativa >= 0),
  preco_centavos      bigint NOT NULL CHECK (preco_centavos >= 0),
  situacao            text NOT NULL DEFAULT 'disponivel'
                      CHECK (situacao IN ('disponivel', 'reservada', 'vendida', 'permuta', 'removida_do_estudo')),
  UNIQUE (empreendimento_id, codigo_externo)
);
CREATE INDEX incorporacao_unidades_empreendimento ON incorporacao_unidades (empreendimento_id, situacao);

-- Registro de cada importação: versão do estudo, totais e divergências encontradas.
CREATE TABLE incorporacao_importacoes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES empresas(id),
  empreendimento_id   uuid NOT NULL REFERENCES incorporacao_empreendimentos(id) ON DELETE CASCADE,
  versao_estudo       text NOT NULL,
  importado_em        timestamptz NOT NULL DEFAULT now(),
  usuario_id          uuid REFERENCES usuarios(id),
  totais              jsonb NOT NULL,
  divergencias        jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE INDEX incorporacao_importacoes_emp ON incorporacao_importacoes (empreendimento_id, importado_em DESC);
