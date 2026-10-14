-- Versões do orçamento da obra. Cada versão guarda um retrato completo (EAP, planilha, serviços e insumos com os
-- preços do momento e o BDI). Assim, alterar o orçamento depois não muda a versão salva.
CREATE TABLE orcamento_versoes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id         uuid NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  empresa_id      uuid NOT NULL REFERENCES empresas(id),
  numero          integer NOT NULL CHECK (numero > 0),
  nome            text NOT NULL,
  observacao      text,
  snapshot        jsonb NOT NULL,
  criado_por_id   uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_por_nome text NOT NULL,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (obra_id, numero)
);
CREATE INDEX orcamento_versoes_obra ON orcamento_versoes (obra_id, numero);
