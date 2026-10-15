-- Almoxarifado: cargo almoxarife, estoques com código automático e vínculo opcional com a obra,
-- estoque de destino em cada item de nota, saída de material por etiqueta (QR) e cadastro de funcionários.

ALTER TYPE perfil ADD VALUE IF NOT EXISTS 'almoxarife';

-- Estoques: código automático por empresa e obra opcional (exceto o de recebimento, que é da obra).
ALTER TABLE obra_estoques ALTER COLUMN obra_id DROP NOT NULL;
ALTER TABLE obra_estoques ADD COLUMN codigo text;
UPDATE obra_estoques e SET codigo = 'EST-' || lpad(s.n::text, 4, '0')
  FROM (SELECT id, row_number() OVER (PARTITION BY empresa_id ORDER BY criado_em, id) AS n FROM obra_estoques) s
 WHERE e.id = s.id;
ALTER TABLE obra_estoques ALTER COLUMN codigo SET NOT NULL;
ALTER TABLE obra_estoques ADD CONSTRAINT obra_estoques_codigo_unico UNIQUE (empresa_id, codigo);
ALTER TABLE obra_estoques ADD CONSTRAINT obra_estoques_codigo_formato CHECK (codigo ~ '^EST-[0-9]{4,}$');
ALTER TABLE obra_estoques ADD CONSTRAINT obra_estoques_recebimento_obra CHECK (NOT recebimento OR obra_id IS NOT NULL);

-- Item da nota: estoque onde entra (padrão: o recebimento da obra).
ALTER TABLE notas_itens ADD COLUMN obra_estoque_id uuid REFERENCES obra_estoques(id);

-- Funcionários que recebem material na obra.
CREATE TABLE funcionarios (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES empresas(id),
  nome        text NOT NULL CHECK (char_length(nome) BETWEEN 2 AND 120),
  cpf         char(11),
  funcao      text CHECK (char_length(funcao) <= 60),
  ativo       boolean NOT NULL DEFAULT true,
  criado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX funcionarios_empresa ON funcionarios (empresa_id);

-- Cadastro da saída de material: obra, etapa, quem recebeu e quem entregou (almoxarife).
CREATE TABLE saidas_material (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid NOT NULL REFERENCES empresas(id),
  numero            text NOT NULL,
  data              date NOT NULL,
  obra_id           uuid NOT NULL REFERENCES obras(id),
  eap_no_id         uuid NOT NULL REFERENCES eap_nos(id),
  funcionario_id    uuid NOT NULL REFERENCES funcionarios(id),
  entregue_por_id   uuid NOT NULL REFERENCES usuarios(id),
  observacao        text,
  criado_em         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, numero)
);

-- Movimentos: a saída por etiqueta aponta a entrada (a etiqueta) e o cadastro da saída.
ALTER TABLE estoque_movimentos ADD COLUMN etiqueta_id uuid REFERENCES estoque_movimentos(id);
ALTER TABLE estoque_movimentos ADD COLUMN saida_material_id uuid REFERENCES saidas_material(id);
CREATE INDEX estoque_movimentos_etiqueta ON estoque_movimentos (etiqueta_id) WHERE etiqueta_id IS NOT NULL;
CREATE INDEX estoque_movimentos_saida_material ON estoque_movimentos (saida_material_id) WHERE saida_material_id IS NOT NULL;
