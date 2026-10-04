-- Suprimentos · Catálogo de materiais e serviços (o que não é insumo da usina), com último preço pago.

CREATE TABLE catalogo_itens (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id             uuid NOT NULL REFERENCES empresas(id),
  tipo                   text NOT NULL,
  codigo                 text NOT NULL,
  descricao              text NOT NULL,
  unidade                text NOT NULL,
  plano_conta_id         uuid REFERENCES plano_contas(id),
  observacao             text,
  ativo                  boolean NOT NULL DEFAULT true,
  ultimo_preco_centavos  numeric(14,4),
  ultimo_preco_em        date,
  ultimo_fornecedor_id   uuid REFERENCES fornecedores(id),
  criado_em              timestamptz NOT NULL DEFAULT now(),
  atualizado_em          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT catalogo_tipo CHECK (tipo IN ('material', 'servico'))
);
CREATE UNIQUE INDEX catalogo_codigo_unico ON catalogo_itens (empresa_id, lower(codigo));
CREATE UNIQUE INDEX catalogo_descricao_unica ON catalogo_itens (empresa_id, tipo, lower(descricao));

ALTER TABLE solicitacoes_itens ADD COLUMN catalogo_id uuid REFERENCES catalogo_itens(id);
ALTER TABLE cotacoes_itens ADD COLUMN catalogo_id uuid REFERENCES catalogo_itens(id);
ALTER TABLE pedidos_itens ADD COLUMN catalogo_id uuid REFERENCES catalogo_itens(id);
ALTER TABLE contratos_itens ADD COLUMN catalogo_id uuid REFERENCES catalogo_itens(id);
CREATE INDEX pedidos_itens_catalogo ON pedidos_itens (catalogo_id) WHERE catalogo_id IS NOT NULL;
CREATE INDEX contratos_itens_catalogo ON contratos_itens (catalogo_id) WHERE catalogo_id IS NOT NULL;
