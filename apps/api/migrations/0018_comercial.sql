-- Módulo Comercial: vendas lançadas pelo vendedor, aprovadas pelo dono ou gestor, que viram programação de entregas na Produção.
-- Gerencial: regras de produção (R$/m³ por faixa) do operador de usina, do gestor de pátio e do vendedor.

CREATE TABLE vendas (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id             uuid NOT NULL REFERENCES empresas(id),
  numero                 integer NOT NULL,
  vendedor_id            uuid NOT NULL REFERENCES usuarios(id),
  cliente_id             uuid NOT NULL REFERENCES clientes(id),
  obra                   text,
  endereco               text,
  contato                text,
  traco_id               uuid NOT NULL REFERENCES tracos(id),
  volume_m3              numeric(8,2) NOT NULL CHECK (volume_m3 > 0 AND volume_m3 <= 5000),
  data_entrega           date NOT NULL,
  hora_entrega           time,
  bombeamento            boolean NOT NULL DEFAULT false,
  preco_m3_centavos      bigint NOT NULL CHECK (preco_m3_centavos >= 0),
  taxa_bomba_centavos    bigint CHECK (taxa_bomba_centavos IS NULL OR taxa_bomba_centavos >= 0),
  condicao_pagamento     text,
  observacoes            text,
  status                 text NOT NULL DEFAULT 'rascunho',
  motivo                 text,
  enviado_aprovacao_em   timestamptz,
  aprovado_por_id        uuid REFERENCES usuarios(id),
  aprovado_em            timestamptz,
  encerrada_em           timestamptz,
  encerrada_por_id       uuid REFERENCES usuarios(id),
  criado_por_id          uuid REFERENCES usuarios(id),
  criado_em              timestamptz NOT NULL DEFAULT now(),
  atualizado_em          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vendas_status CHECK (status IN ('rascunho', 'aguardando_aprovacao', 'aprovada', 'reprovada', 'concluida', 'cancelada')),
  UNIQUE (empresa_id, numero)
);
CREATE INDEX vendas_empresa_entrega ON vendas (empresa_id, data_entrega);
CREATE INDEX vendas_vendedor ON vendas (vendedor_id);

-- Cada carga pode atender uma venda da programação.
ALTER TABLE cargas ADD COLUMN venda_id uuid REFERENCES vendas(id);
CREATE INDEX cargas_venda ON cargas (venda_id);

-- Faixas em m³ no mês: [{ "ate": 1000, "valorM3": 200 }, { "ate": null, "valorM3": 150 }] (valor em centavos).
-- progressiva: cada faixa paga o seu valor só no volume dentro dela; faixa: todo o volume paga o valor da faixa atingida.
CREATE TABLE regras_producao (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresas(id),
  funcao         text NOT NULL,
  base           text NOT NULL DEFAULT 'usina',
  modo           text NOT NULL DEFAULT 'progressiva',
  faixas         jsonb NOT NULL,
  vigencia       date NOT NULL,
  criado_por_id  uuid REFERENCES usuarios(id),
  criado_em      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT regras_producao_funcao CHECK (funcao IN ('operador_usina', 'gestor_patio', 'vendedor')),
  CONSTRAINT regras_producao_base CHECK (base IN ('usina', 'vendas')),
  CONSTRAINT regras_producao_modo CHECK (modo IN ('progressiva', 'faixa')),
  UNIQUE (empresa_id, funcao, vigencia)
);
