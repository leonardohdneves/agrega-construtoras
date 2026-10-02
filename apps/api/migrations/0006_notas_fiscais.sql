-- Etapa 5 · Nota fiscal: lançamento manual e importação do XML (NF-e/NFC-e),
-- itens com apropriação, duplicatas, regras de apropriação e vínculo com abastecimentos e OS.

CREATE TABLE notas_fiscais (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            uuid NOT NULL REFERENCES empresas(id),
  direcao               text NOT NULL DEFAULT 'entrada',
  modelo                text NOT NULL DEFAULT 'nfe',
  chave_acesso          text,
  numero                text,
  serie                 text,
  data_emissao          date NOT NULL,
  competencia           date NOT NULL,
  fornecedor_id         uuid REFERENCES fornecedores(id),
  cliente_id            uuid REFERENCES clientes(id),
  emitente_nome         text,
  emitente_documento    text,
  natureza_operacao     text,
  valor_produtos_centavos bigint NOT NULL DEFAULT 0,
  frete_centavos        bigint NOT NULL DEFAULT 0,
  seguro_centavos       bigint NOT NULL DEFAULT 0,
  desconto_centavos     bigint NOT NULL DEFAULT 0,
  outras_centavos       bigint NOT NULL DEFAULT 0,
  ipi_centavos          bigint NOT NULL DEFAULT 0,
  icms_st_centavos      bigint NOT NULL DEFAULT 0,
  total_centavos        bigint NOT NULL DEFAULT 0,
  forma_pagamento       text,
  informacoes           text,
  avisos                jsonb NOT NULL DEFAULT '[]'::jsonb,
  observacoes           text,
  xml                   text,
  origem                text NOT NULL DEFAULT 'manual',
  status                text NOT NULL DEFAULT 'rascunho',
  confianca_ia          numeric(4, 3),
  lancamento_id         uuid REFERENCES lancamentos(id),
  criado_por_id         uuid REFERENCES usuarios(id),
  conferido_por_id      uuid REFERENCES usuarios(id),
  conferido_em          timestamptz,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  atualizado_em         timestamptz NOT NULL DEFAULT now(),
  excluido_em           timestamptz,
  CONSTRAINT notas_direcao CHECK (direcao IN ('entrada', 'saida')),
  CONSTRAINT notas_modelo CHECK (modelo IN ('nfe', 'nfce', 'nfse', 'cte', 'cupom', 'recibo', 'outro')),
  CONSTRAINT notas_origem CHECK (origem IN ('manual', 'xml', 'ia_whatsapp')),
  CONSTRAINT notas_status CHECK (status IN ('rascunho', 'aguardando_conferencia', 'confirmada', 'cancelada')),
  CONSTRAINT notas_chave CHECK (chave_acesso IS NULL OR chave_acesso ~ '^[0-9]{44}$')
);
CREATE UNIQUE INDEX notas_chave_unica ON notas_fiscais (empresa_id, chave_acesso) WHERE chave_acesso IS NOT NULL AND excluido_em IS NULL;
CREATE INDEX notas_emissao ON notas_fiscais (empresa_id, data_emissao);

CREATE TABLE notas_itens (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id              uuid NOT NULL REFERENCES empresas(id),
  nota_id                 uuid NOT NULL REFERENCES notas_fiscais(id) ON DELETE CASCADE,
  numero_item             integer NOT NULL,
  codigo_produto          text,
  descricao               text NOT NULL,
  ncm                     text,
  cfop                    text,
  unidade                 text,
  quantidade              numeric(15, 4) NOT NULL DEFAULT 1,
  valor_produto_centavos  bigint NOT NULL DEFAULT 0,
  valor_custo_centavos    bigint NOT NULL DEFAULT 0,
  plano_conta_id          uuid REFERENCES plano_contas(id),
  centro_custo_id         uuid REFERENCES centros_custo(id),
  veiculo_id              uuid REFERENCES veiculos(id),
  regra_id                uuid,
  sugestao                text,
  criado_em               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notas_itens_valor CHECK (valor_custo_centavos >= 0)
);
CREATE INDEX notas_itens_nota ON notas_itens (nota_id, numero_item);

CREATE TABLE notas_duplicatas (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresas(id),
  nota_id        uuid NOT NULL REFERENCES notas_fiscais(id) ON DELETE CASCADE,
  numero         text,
  vencimento     date NOT NULL,
  valor_centavos bigint NOT NULL,
  CONSTRAINT notas_duplicatas_valor CHECK (valor_centavos > 0)
);
CREATE INDEX notas_duplicatas_nota ON notas_duplicatas (nota_id);

CREATE TABLE regras_apropriacao (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id      uuid NOT NULL REFERENCES empresas(id),
  fornecedor_id   uuid REFERENCES fornecedores(id),
  texto_contem    text,
  ncm             text,
  plano_conta_id  uuid NOT NULL REFERENCES plano_contas(id),
  centro_custo_id uuid REFERENCES centros_custo(id),
  veiculo_id      uuid REFERENCES veiculos(id),
  origem          text NOT NULL DEFAULT 'usuario',
  vezes_aplicada  integer NOT NULL DEFAULT 0,
  ativo           boolean NOT NULL DEFAULT true,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  atualizado_em   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regras_origem CHECK (origem IN ('usuario', 'aprendida', 'ia')),
  CONSTRAINT regras_criterio CHECK (fornecedor_id IS NOT NULL OR texto_contem IS NOT NULL OR ncm IS NOT NULL)
);
CREATE UNIQUE INDEX regras_unica ON regras_apropriacao (empresa_id, coalesce(fornecedor_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(texto_contem, ''), coalesce(ncm, ''));

ALTER TABLE notas_itens ADD CONSTRAINT notas_itens_regra_fk FOREIGN KEY (regra_id) REFERENCES regras_apropriacao(id) ON DELETE SET NULL;

-- Ligações que estavam preparadas desde as etapas anteriores.
ALTER TABLE lancamentos ADD CONSTRAINT lancamentos_nota_fk FOREIGN KEY (nota_id) REFERENCES notas_fiscais(id);
ALTER TABLE apropriacoes ADD CONSTRAINT apropriacoes_nota_item_fk FOREIGN KEY (nota_item_id) REFERENCES notas_itens(id) ON DELETE SET NULL;
ALTER TABLE abastecimentos ADD CONSTRAINT abastecimentos_nota_item_fk FOREIGN KEY (nota_item_id) REFERENCES notas_itens(id) ON DELETE SET NULL;
ALTER TABLE os_itens ADD CONSTRAINT os_itens_nota_item_fk FOREIGN KEY (nota_item_id) REFERENCES notas_itens(id) ON DELETE SET NULL;
CREATE INDEX abastecimentos_nota_item ON abastecimentos (nota_item_id) WHERE nota_item_id IS NOT NULL;
CREATE INDEX os_itens_nota_item ON os_itens (nota_item_id) WHERE nota_item_id IS NOT NULL;
