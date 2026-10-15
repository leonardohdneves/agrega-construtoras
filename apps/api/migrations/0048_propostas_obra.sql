-- Propostas de execução de obras (substituem a proposta de concreto no Comercial da construtora).
-- Aceita pelo cliente, a proposta gera o contrato com o cliente e os lançamentos a receber.

CREATE TABLE propostas_obra (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL REFERENCES empresas(id),
  numero             integer NOT NULL,
  tipo               text NOT NULL CHECK (tipo IN ('acompanhamento', 'administracao', 'preco_global', 'preco_unitario', 'laudo')),
  cliente_id         uuid NOT NULL REFERENCES clientes(id),
  obra_id            uuid REFERENCES obras(id),
  titulo             text NOT NULL,
  objeto             text,
  endereco           text,
  prazo_dias         integer CHECK (prazo_dias IS NULL OR prazo_dias BETWEEN 1 AND 3650),
  validade_dias      integer NOT NULL DEFAULT 30 CHECK (validade_dias BETWEEN 1 AND 365),
  origem_preco       text NOT NULL DEFAULT 'informado' CHECK (origem_preco IN ('orcamento', 'informado')),
  parametros         jsonb NOT NULL DEFAULT '{}'::jsonb,
  valor_total_centavos bigint NOT NULL DEFAULT 0 CHECK (valor_total_centavos >= 0),
  condicoes          text,
  status             text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'enviada', 'aceita', 'recusada', 'cancelada')),
  enviada_em         timestamptz,
  decidida_em        timestamptz,
  criado_por_id      uuid REFERENCES usuarios(id),
  criado_em          timestamptz NOT NULL DEFAULT now(),
  atualizado_em      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, numero),
  CONSTRAINT propostas_obra_origem CHECK (origem_preco = 'informado' OR obra_id IS NOT NULL)
);
CREATE INDEX propostas_obra_empresa_status ON propostas_obra (empresa_id, status);

-- Itens da proposta (preço unitário e laudos): quantidade estimada × preço unitário.
CREATE TABLE propostas_obra_itens (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id               uuid NOT NULL REFERENCES empresas(id),
  proposta_id              uuid NOT NULL REFERENCES propostas_obra(id) ON DELETE CASCADE,
  ordem                    integer NOT NULL,
  obra_item_id             uuid REFERENCES obra_itens(id),
  descricao                text NOT NULL,
  unidade                  text NOT NULL,
  quantidade               numeric(14,3) NOT NULL CHECK (quantidade > 0),
  preco_unitario_centavos  bigint NOT NULL CHECK (preco_unitario_centavos >= 0)
);
CREATE INDEX propostas_obra_itens_proposta ON propostas_obra_itens (proposta_id, ordem);

-- Cronograma de recebimento: cada parcela vira uma parcela do lançamento a receber.
CREATE TABLE propostas_obra_parcelas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL REFERENCES empresas(id),
  proposta_id      uuid NOT NULL REFERENCES propostas_obra(id) ON DELETE CASCADE,
  numero           integer NOT NULL,
  descricao        text NOT NULL,
  vencimento       date NOT NULL,
  valor_centavos   bigint NOT NULL CHECK (valor_centavos >= 0),
  UNIQUE (proposta_id, numero)
);

-- Contrato com o cliente, gerado na aceitação da proposta.
CREATE TABLE contratos_cliente (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           uuid NOT NULL REFERENCES empresas(id),
  numero               integer NOT NULL,
  proposta_id          uuid NOT NULL UNIQUE REFERENCES propostas_obra(id),
  cliente_id           uuid NOT NULL REFERENCES clientes(id),
  obra_id              uuid REFERENCES obras(id),
  tipo                 text NOT NULL,
  titulo               text NOT NULL,
  valor_total_centavos bigint NOT NULL CHECK (valor_total_centavos >= 0),
  status               text NOT NULL DEFAULT 'vigente' CHECK (status IN ('vigente', 'encerrado', 'cancelado')),
  lancamento_id        uuid REFERENCES lancamentos(id),
  criado_em            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, numero)
);

-- Lançamentos gerados pela aceitação de proposta de obra.
ALTER TABLE lancamentos DROP CONSTRAINT lancamentos_origem;
ALTER TABLE lancamentos ADD CONSTRAINT lancamentos_origem CHECK (origem IN ('manual', 'xml', 'ia_whatsapp', 'frota', 'extrato', 'suprimentos', 'comercial', 'propostas_obra'));
