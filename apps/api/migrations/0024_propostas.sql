-- Comercial · Propostas: orçamento enviado ao cliente antes da venda. Aceita, vira venda (rascunho) no Comercial.
-- O texto da proposta é redigido pela IA a partir dos dados, com o histórico de preço do cliente e do traço.

CREATE TABLE propostas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES empresas(id),
  numero              integer NOT NULL,
  vendedor_id         uuid NOT NULL REFERENCES usuarios(id),
  cliente_id          uuid NOT NULL REFERENCES clientes(id),
  traco_id            uuid NOT NULL REFERENCES tracos(id),
  obra                text,
  endereco            text,
  volume_m3           numeric(8,2) NOT NULL CHECK (volume_m3 > 0 AND volume_m3 <= 5000),
  preco_m3_centavos   bigint NOT NULL CHECK (preco_m3_centavos >= 0),
  condicoes           text,
  validade_dias       integer NOT NULL DEFAULT 7 CHECK (validade_dias BETWEEN 1 AND 365),
  texto               text,
  texto_ia            boolean NOT NULL DEFAULT false,
  status              text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'enviada', 'aceita', 'recusada')),
  venda_id            uuid REFERENCES vendas(id),
  criado_em           timestamptz NOT NULL DEFAULT now(),
  atualizado_em       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, numero)
);

CREATE INDEX propostas_empresa_status ON propostas (empresa_id, status);
