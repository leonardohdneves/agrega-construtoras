-- Suprimentos · Permuta por material. O fornecedor entrega material e a construtora entrega serviços prestados
-- a ele; a compensação fecha as duas partes pelo preço acordado, sem movimento de caixa. Diferença = torna.
-- A emissão da nota fiscal não é feita no sistema: fica registrada como pendência (não bloqueia a compensação).
CREATE TABLE permutas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresas(id),
  numero          integer NOT NULL,
  obra_id         uuid NOT NULL REFERENCES obras(id),
  fornecedor_id   uuid NOT NULL REFERENCES fornecedores(id),
  data            date NOT NULL,
  observacao      text,
  status          text NOT NULL DEFAULT 'aberta',
  nf_emitida      boolean NOT NULL DEFAULT false,
  compensada_em   date,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT permutas_status CHECK (status IN ('aberta', 'compensada', 'cancelada')),
  CONSTRAINT permutas_numero UNIQUE (empresa_id, numero)
);
CREATE INDEX permutas_fornecedor ON permutas (empresa_id, fornecedor_id);

CREATE TABLE permuta_itens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  permuta_id      uuid NOT NULL REFERENCES permutas(id) ON DELETE CASCADE,
  lado            text NOT NULL,
  descricao       text NOT NULL,
  unidade         text,
  quantidade      numeric(16,4) NOT NULL,
  preco_centavos  bigint NOT NULL,
  ordem           integer NOT NULL DEFAULT 0,
  CONSTRAINT permuta_itens_lado CHECK (lado IN ('material', 'servico')),
  CONSTRAINT permuta_itens_quantidade CHECK (quantidade > 0),
  CONSTRAINT permuta_itens_preco CHECK (preco_centavos >= 0)
);
CREATE INDEX permuta_itens_permuta ON permuta_itens (permuta_id);
