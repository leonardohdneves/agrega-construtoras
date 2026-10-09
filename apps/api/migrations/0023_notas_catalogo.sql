-- Itens de nota ligados ao catálogo de materiais e serviços (ou cadastrados nele ao confirmar a nota),
-- com o aprendizado da ligação por fornecedor e texto do produto.
ALTER TABLE notas_itens
  ADD COLUMN catalogo_id        uuid REFERENCES catalogo_itens(id),
  ADD COLUMN cadastrar_catalogo boolean NOT NULL DEFAULT false,
  ADD COLUMN vinculo_sugestao   text;

CREATE TABLE catalogo_produtos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresas(id),
  fornecedor_id  uuid REFERENCES fornecedores(id),
  texto          text NOT NULL,
  catalogo_id    uuid NOT NULL REFERENCES catalogo_itens(id),
  vezes          integer NOT NULL DEFAULT 1,
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX catalogo_produtos_unico ON catalogo_produtos (empresa_id, coalesce(fornecedor_id, '00000000-0000-0000-0000-000000000000'::uuid), texto);
