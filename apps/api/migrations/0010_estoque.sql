-- Etapa 8B: estoque de insumos (entradas pelas notas, consumo pelas cargas, acerto por inventário).

ALTER TABLE insumos
  ADD COLUMN controla_estoque    boolean NOT NULL DEFAULT true,
  ADD COLUMN custo_origem        text,
  ADD COLUMN custo_atualizado_em timestamptz;
UPDATE insumos SET controla_estoque = false WHERE tipo = 'agua';

-- Item da nota de compra ligado ao insumo: quantidade da nota × fator = quantidade na unidade do insumo (ex.: t → kg = 1000).
ALTER TABLE notas_itens
  ADD COLUMN insumo_id     uuid REFERENCES insumos(id),
  ADD COLUMN fator_estoque numeric(14,6) CHECK (fator_estoque IS NULL OR fator_estoque > 0);

-- O que o sistema aprendeu: produto do fornecedor → insumo e fator.
CREATE TABLE insumos_produtos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresas(id),
  fornecedor_id  uuid REFERENCES fornecedores(id),
  texto          text NOT NULL,
  insumo_id      uuid NOT NULL REFERENCES insumos(id),
  fator          numeric(14,6) NOT NULL CHECK (fator > 0),
  vezes          integer NOT NULL DEFAULT 1,
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX insumos_produtos_unico ON insumos_produtos (empresa_id, coalesce(fornecedor_id, '00000000-0000-0000-0000-000000000000'::uuid), texto);

-- Consumo teórico de cada carga, gravado na hora (o traço pode mudar depois sem alterar o passado).
CREATE TABLE cargas_consumo (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id               uuid NOT NULL REFERENCES empresas(id),
  carga_id                 uuid NOT NULL REFERENCES cargas(id) ON DELETE CASCADE,
  insumo_id                uuid NOT NULL REFERENCES insumos(id),
  quantidade               numeric(14,3) NOT NULL,
  custo_unitario_centavos  numeric(14,4),
  UNIQUE (carga_id, insumo_id)
);
CREATE INDEX cargas_consumo_insumo ON cargas_consumo (insumo_id);

CREATE TABLE inventarios (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id     uuid NOT NULL REFERENCES empresas(id),
  data           date NOT NULL,
  observacao     text,
  criado_por_id  uuid REFERENCES usuarios(id),
  criado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventarios_empresa_data ON inventarios (empresa_id, data);

CREATE TABLE inventarios_itens (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id               uuid NOT NULL REFERENCES empresas(id),
  inventario_id            uuid NOT NULL REFERENCES inventarios(id) ON DELETE CASCADE,
  insumo_id                uuid NOT NULL REFERENCES insumos(id),
  saldo_teorico            numeric(14,3) NOT NULL,
  contado                  numeric(14,3) NOT NULL CHECK (contado >= 0),
  diferenca                numeric(14,3) NOT NULL,
  consumo_periodo          numeric(14,3),
  custo_unitario_centavos  numeric(14,4),
  UNIQUE (inventario_id, insumo_id)
);

-- Entradas (notas) e acertos (inventário). O consumo vem de cargas_consumo.
CREATE TABLE estoque_movimentos (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id               uuid NOT NULL REFERENCES empresas(id),
  insumo_id                uuid NOT NULL REFERENCES insumos(id),
  data                     date NOT NULL,
  tipo                     text NOT NULL,
  quantidade               numeric(14,3) NOT NULL,
  custo_unitario_centavos  numeric(14,4),
  nota_item_id             uuid REFERENCES notas_itens(id) ON DELETE CASCADE,
  inventario_id            uuid REFERENCES inventarios(id) ON DELETE CASCADE,
  observacao               text,
  criado_por_id            uuid REFERENCES usuarios(id),
  criado_em                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT estoque_movimentos_tipo CHECK (tipo IN ('entrada', 'ajuste'))
);
CREATE INDEX estoque_movimentos_insumo ON estoque_movimentos (insumo_id, data);

-- Consumo das cargas que já existem, pelo traço atual.
INSERT INTO cargas_consumo (empresa_id, carga_id, insumo_id, quantidade, custo_unitario_centavos)
SELECT c.empresa_id, c.id, ti.insumo_id, round(ti.quantidade * c.volume_m3, 3), i.custo_unitario_centavos
  FROM cargas c JOIN tracos_itens ti ON ti.traco_id = c.traco_id JOIN insumos i ON i.id = ti.insumo_id
 WHERE c.status = 'produzida';
