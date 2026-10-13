-- Serviço pode entrar na composição de outro serviço. O custo de um item é o próprio preço (insumo)
-- ou a soma dos seus componentes, cada um calculado do mesmo jeito (até 10 níveis).
CREATE OR REPLACE FUNCTION custo_obra_item(p_id uuid, p_nivel int DEFAULT 0) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN oi.tipo = 'insumo' THEN oi.preco_centavos::numeric
    ELSE coalesce((SELECT sum(ci.coeficiente * custo_obra_item(ci.insumo_id, p_nivel + 1))
                     FROM obra_composicao_insumos ci WHERE ci.composicao_id = oi.id AND p_nivel < 10), 0) END
    FROM obra_itens oi WHERE oi.id = p_id
$$;

CREATE OR REPLACE FUNCTION custo_ref_item(p_id uuid, p_nivel int DEFAULT 0) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN ri.tipo = 'insumo' THEN ri.preco_centavos::numeric
    ELSE coalesce((SELECT sum(rc.coeficiente * custo_ref_item(rc.insumo_id, p_nivel + 1))
                     FROM ref_composicao_insumos rc WHERE rc.composicao_id = ri.id AND p_nivel < 10), 0) END
    FROM ref_itens ri WHERE ri.id = p_id
$$;
