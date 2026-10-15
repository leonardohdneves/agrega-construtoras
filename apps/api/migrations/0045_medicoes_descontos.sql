-- Contratos · Medições: medição por percentual do quantitativo contratado e descontos a deduzir do pagamento
-- ao terceiro (adiantamentos, alimentação, EPI etc.). Tudo aditivo: medições antigas ficam sem base e sem descontos.
ALTER TABLE medicoes ADD COLUMN base text;
ALTER TABLE medicoes ADD CONSTRAINT medicoes_base CHECK (base IN ('quantidades', 'percentual', 'valor'));
ALTER TABLE medicoes ADD COLUMN percentual numeric(9,4);

CREATE TABLE medicoes_descontos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid NOT NULL REFERENCES empresas(id),
  medicao_id        uuid NOT NULL REFERENCES medicoes(id) ON DELETE CASCADE,
  ordem             integer NOT NULL DEFAULT 1,
  descricao         text NOT NULL,
  valor_centavos    bigint NOT NULL CHECK (valor_centavos > 0)
);
CREATE INDEX medicoes_descontos_medicao ON medicoes_descontos (medicao_id);

-- O desconto sai do líquido da autorização (e, por consequência, das contas a pagar).
ALTER TABLE autorizacoes_pagamento ADD COLUMN descontos_centavos bigint NOT NULL DEFAULT 0 CHECK (descontos_centavos >= 0);
