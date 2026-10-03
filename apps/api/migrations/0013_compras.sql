-- Suprimentos · Compras: solicitação, cotação (mapa), pedido de compra com aprovação e recebimento pela nota fiscal.

-- Regras de aprovação. Padrão: o dono aprova tudo.
--   adminAte: administradores aprovam até este valor (centavos); acima, só o dono. null = só o dono.
--   dispensaAte: até este valor o pedido é aprovado ao enviar, sem passar por ninguém. null = sempre passa.
ALTER TABLE empresas ADD COLUMN aprovacao jsonb NOT NULL DEFAULT '{"adminAte": null, "dispensaAte": null}';

CREATE TABLE solicitacoes_compra (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL REFERENCES empresas(id),
  numero           integer NOT NULL,
  data             date NOT NULL,
  necessidade      date,
  origem           text NOT NULL DEFAULT 'manual',
  centro_custo_id  uuid REFERENCES centros_custo(id),
  observacao       text,
  status           text NOT NULL DEFAULT 'aberta',
  solicitante_id   uuid REFERENCES usuarios(id),
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT solicitacoes_origem CHECK (origem IN ('manual', 'estoque_minimo')),
  CONSTRAINT solicitacoes_status CHECK (status IN ('aberta', 'em_cotacao', 'atendida', 'cancelada')),
  UNIQUE (empresa_id, numero)
);

CREATE TABLE solicitacoes_itens (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL REFERENCES empresas(id),
  solicitacao_id   uuid NOT NULL REFERENCES solicitacoes_compra(id) ON DELETE CASCADE,
  insumo_id        uuid REFERENCES insumos(id),
  descricao        text NOT NULL,
  unidade          text NOT NULL,
  quantidade       numeric(14,3) NOT NULL CHECK (quantidade > 0),
  observacao       text
);
CREATE INDEX solicitacoes_itens_sol ON solicitacoes_itens (solicitacao_id);

CREATE TABLE cotacoes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL REFERENCES empresas(id),
  numero           integer NOT NULL,
  data             date NOT NULL,
  prazo_resposta   date,
  solicitacao_id   uuid REFERENCES solicitacoes_compra(id),
  observacao       text,
  justificativa    text,
  status           text NOT NULL DEFAULT 'aberta',
  criado_por_id    uuid REFERENCES usuarios(id),
  concluida_em     timestamptz,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cotacoes_status CHECK (status IN ('aberta', 'concluida', 'cancelada')),
  UNIQUE (empresa_id, numero)
);

CREATE TABLE cotacoes_fornecedores (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES empresas(id),
  cotacao_id          uuid NOT NULL REFERENCES cotacoes(id) ON DELETE CASCADE,
  fornecedor_id       uuid NOT NULL REFERENCES fornecedores(id),
  prazo_entrega_dias  integer CHECK (prazo_entrega_dias IS NULL OR prazo_entrega_dias >= 0),
  condicao_pagamento  text,
  frete_centavos      bigint NOT NULL DEFAULT 0 CHECK (frete_centavos >= 0),
  validade            date,
  observacao          text,
  UNIQUE (cotacao_id, fornecedor_id)
);

CREATE TABLE cotacoes_itens (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id             uuid NOT NULL REFERENCES empresas(id),
  cotacao_id             uuid NOT NULL REFERENCES cotacoes(id) ON DELETE CASCADE,
  solicitacao_item_id    uuid REFERENCES solicitacoes_itens(id) ON DELETE SET NULL,
  insumo_id              uuid REFERENCES insumos(id),
  descricao              text NOT NULL,
  unidade                text NOT NULL,
  quantidade             numeric(14,3) NOT NULL CHECK (quantidade > 0),
  vencedor_id            uuid REFERENCES cotacoes_fornecedores(id) ON DELETE SET NULL,
  justificativa          text
);
CREATE INDEX cotacoes_itens_cot ON cotacoes_itens (cotacao_id);

-- Preço unitário de cada fornecedor para cada item (sem linha = não cotou).
CREATE TABLE cotacoes_precos (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id               uuid NOT NULL REFERENCES empresas(id),
  cotacao_fornecedor_id    uuid NOT NULL REFERENCES cotacoes_fornecedores(id) ON DELETE CASCADE,
  cotacao_item_id          uuid NOT NULL REFERENCES cotacoes_itens(id) ON DELETE CASCADE,
  preco_unitario_centavos  numeric(14,4) NOT NULL CHECK (preco_unitario_centavos >= 0),
  UNIQUE (cotacao_fornecedor_id, cotacao_item_id)
);

CREATE TABLE pedidos_compra (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES empresas(id),
  numero              integer NOT NULL,
  data                date NOT NULL,
  fornecedor_id       uuid NOT NULL REFERENCES fornecedores(id),
  cotacao_id          uuid REFERENCES cotacoes(id),
  solicitacao_id      uuid REFERENCES solicitacoes_compra(id),
  previsao_entrega    date,
  condicao_pagamento  text,
  local_entrega       text,
  frete_centavos      bigint NOT NULL DEFAULT 0 CHECK (frete_centavos >= 0),
  total_centavos      bigint NOT NULL DEFAULT 0,
  centro_custo_id     uuid REFERENCES centros_custo(id),
  observacao          text,
  status              text NOT NULL DEFAULT 'rascunho',
  enviado_aprovacao_em timestamptz,
  aprovado_por_id     uuid REFERENCES usuarios(id),
  aprovado_em         timestamptz,
  aprovacao_automatica boolean NOT NULL DEFAULT false,
  motivo_reprovacao   text,
  enviado_fornecedor_em timestamptz,
  encerrado_motivo    text,
  criado_por_id       uuid REFERENCES usuarios(id),
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pedidos_status CHECK (status IN ('rascunho', 'aguardando_aprovacao', 'aprovado', 'reprovado', 'enviado', 'parcial', 'recebido', 'encerrado', 'cancelado')),
  UNIQUE (empresa_id, numero)
);
CREATE INDEX pedidos_compra_empresa ON pedidos_compra (empresa_id, status, data);

CREATE TABLE pedidos_itens (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id               uuid NOT NULL REFERENCES empresas(id),
  pedido_id                uuid NOT NULL REFERENCES pedidos_compra(id) ON DELETE CASCADE,
  cotacao_item_id          uuid REFERENCES cotacoes_itens(id) ON DELETE SET NULL,
  insumo_id                uuid REFERENCES insumos(id),
  descricao                text NOT NULL,
  unidade                  text NOT NULL,
  quantidade               numeric(14,3) NOT NULL CHECK (quantidade > 0),
  preco_unitario_centavos  numeric(14,4) NOT NULL CHECK (preco_unitario_centavos >= 0)
);
CREATE INDEX pedidos_itens_pedido ON pedidos_itens (pedido_id);

-- Recebimento: a nota de compra (que gera a conta a pagar) fica ligada ao pedido, item a item.
ALTER TABLE notas_fiscais ADD COLUMN pedido_id uuid REFERENCES pedidos_compra(id);
ALTER TABLE notas_itens
  ADD COLUMN pedido_item_id     uuid REFERENCES pedidos_itens(id) ON DELETE SET NULL,
  ADD COLUMN quantidade_pedido  numeric(14,3);
CREATE INDEX notas_pedido ON notas_fiscais (pedido_id) WHERE pedido_id IS NOT NULL;
CREATE INDEX notas_itens_pedido_item ON notas_itens (pedido_item_id) WHERE pedido_item_id IS NOT NULL;
