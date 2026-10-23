-- Lançamento de despesa com entrada no estoque da construtora (mesma apropriação de um item de nota).
CREATE TABLE lancamento_itens_estoque (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id       uuid NOT NULL REFERENCES empresas(id),
  lancamento_id    uuid NOT NULL REFERENCES lancamentos(id) ON DELETE CASCADE,
  descricao        text NOT NULL,
  quantidade       numeric(14,3) NOT NULL CHECK (quantidade > 0),
  unidade          text,
  valor_centavos   bigint NOT NULL CHECK (valor_centavos >= 0),
  obra_id          uuid NOT NULL REFERENCES obras(id),
  obra_item_id     uuid NOT NULL REFERENCES obra_itens(id),
  eap_no_id        uuid NOT NULL REFERENCES eap_nos(id),
  obra_estoque_id  uuid REFERENCES obra_estoques(id),
  criado_em        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lancamento_itens_estoque_lancamento ON lancamento_itens_estoque (lancamento_id);

ALTER TABLE estoque_movimentos ADD COLUMN lancamento_item_id uuid REFERENCES lancamento_itens_estoque(id) ON DELETE CASCADE;
CREATE INDEX estoque_movimentos_lancamento_item ON estoque_movimentos (lancamento_item_id) WHERE lancamento_item_id IS NOT NULL;
