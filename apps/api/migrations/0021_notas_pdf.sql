-- Notas lançadas a partir do PDF (leitor próprio ou IA) e pela chave lida no código de barras.
ALTER TABLE notas_fiscais DROP CONSTRAINT notas_origem;
ALTER TABLE notas_fiscais ADD CONSTRAINT notas_origem CHECK (origem IN ('manual', 'xml', 'ia_whatsapp', 'pdf', 'chave'));
-- Como a nota foi lida: { metodo: 'leitor'|'ia'|'codigo_barras', chaveVia, conferir: [...], totalLido }
ALTER TABLE notas_fiscais ADD COLUMN leitura jsonb;

CREATE TABLE notas_anexos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresas(id),
  nota_id        uuid NOT NULL REFERENCES notas_fiscais(id) ON DELETE CASCADE,
  nome           text NOT NULL,
  tipo           text NOT NULL,
  tamanho        integer NOT NULL,
  conteudo       bytea NOT NULL,
  criado_por_id  uuid REFERENCES usuarios(id),
  criado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notas_anexos_nota ON notas_anexos (nota_id);
