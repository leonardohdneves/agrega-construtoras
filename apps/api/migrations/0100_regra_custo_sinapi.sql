-- Regra de custo das tabelas de referência. 'exata' (padrão, tabelas próprias): o custo da composição é a soma de
-- coeficiente × custo do item, sem arredondar. 'sinapi': a regra da Caixa: cada linha (coeficiente × custo unitário do
-- item, que no caso de uma composição auxiliar é o custo já calculado dela) é truncada ao centavo e as linhas somadas.
-- Para isso a composição usa a estrutura direta (insumos e serviços auxiliares com o coeficiente exato), guardada em
-- ref_composicao_estrutura. O desdobramento em insumos (ref_composicao_insumos) continua para compras e relatórios.
-- Tabelas e itens que já existem ficam 'exata'; só as tabelas SINAPI criadas depois desta migração usam 'sinapi'.
ALTER TABLE ref_tabelas ADD COLUMN regra_custo text NOT NULL DEFAULT 'exata' CHECK (regra_custo IN ('exata', 'sinapi'));
ALTER TABLE obra_itens ADD COLUMN regra_custo text NOT NULL DEFAULT 'exata' CHECK (regra_custo IN ('exata', 'sinapi'));

-- Estrutura direta do serviço na obra (cópia da estrutura da tabela), para o mesmo custo da tabela.
CREATE TABLE obra_composicao_estrutura (
  composicao_id uuid NOT NULL REFERENCES obra_itens(id) ON DELETE CASCADE,
  item_id       uuid NOT NULL REFERENCES obra_itens(id) ON DELETE CASCADE,
  coeficiente   numeric(24,12) NOT NULL CHECK (coeficiente >= 0),
  PRIMARY KEY (composicao_id, item_id),
  CHECK (composicao_id <> item_id)
);
CREATE INDEX obra_composicao_estrutura_item ON obra_composicao_estrutura (item_id);

-- Custo (em centavos) de um item da obra. Insumo: o preço. Serviço 'sinapi' com estrutura: soma das linhas truncadas.
-- Demais serviços: soma exata dos componentes. Até 10 níveis.
CREATE OR REPLACE FUNCTION custo_obra_item(p_id uuid, p_nivel int DEFAULT 0) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN oi.tipo = 'insumo' THEN oi.preco_centavos::numeric
    WHEN oi.regra_custo = 'sinapi' AND EXISTS (SELECT 1 FROM obra_composicao_estrutura e WHERE e.composicao_id = oi.id) THEN
      coalesce((SELECT sum(floor(e.coeficiente * custo_obra_item(e.item_id, p_nivel + 1)))
                  FROM obra_composicao_estrutura e WHERE e.composicao_id = oi.id AND p_nivel < 10), 0)
    ELSE coalesce((SELECT sum(ci.coeficiente * custo_obra_item(ci.insumo_id, p_nivel + 1))
                     FROM obra_composicao_insumos ci WHERE ci.composicao_id = oi.id AND p_nivel < 10), 0) END
    FROM obra_itens oi WHERE oi.id = p_id
$$;

CREATE OR REPLACE FUNCTION custo_ref_item(p_id uuid, p_nivel int DEFAULT 0) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN ri.tipo = 'insumo' THEN ri.preco_centavos::numeric
    WHEN t.regra_custo = 'sinapi' AND EXISTS (SELECT 1 FROM ref_composicao_estrutura e WHERE e.composicao_id = ri.id) THEN
      coalesce((SELECT sum(floor(e.coeficiente * custo_ref_item(e.item_id, p_nivel + 1)))
                  FROM ref_composicao_estrutura e WHERE e.composicao_id = ri.id AND p_nivel < 10), 0)
    ELSE coalesce((SELECT sum(rc.coeficiente * custo_ref_item(rc.insumo_id, p_nivel + 1))
                     FROM ref_composicao_insumos rc WHERE rc.composicao_id = ri.id AND p_nivel < 10), 0) END
    FROM ref_itens ri JOIN ref_tabelas t ON t.id = ri.tabela_id WHERE ri.id = p_id
$$;
