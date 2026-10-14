-- Relatórios de planejamento: jornada da obra (equipes) e classe dos insumos (mão de obra, material, equipamento).
ALTER TABLE obras ADD COLUMN horas_dia numeric(4,2) NOT NULL DEFAULT 8 CHECK (horas_dia > 0 AND horas_dia <= 24);

-- A composição SINAPI não traz a classe do insumo; ela está na tabela de insumos da mesma referência (mês, UF e desoneração).
-- Preenche o grupo dos insumos já copiados para as obras, sem mexer nos que já têm grupo.
UPDATE obra_itens oi
   SET grupo = x.grupo
  FROM (
    SELECT DISTINCT ON (oi2.id) oi2.id, r.grupo
      FROM obra_itens oi2
      JOIN ref_tabelas tc ON tc.id = oi2.origem_tabela_id
      JOIN ref_tabelas ti ON ti.empresa_id = tc.empresa_id
                         AND ti.fonte = 'sinapi'
                         AND ti.id <> tc.id
                         AND ti.uf IS NOT DISTINCT FROM tc.uf
                         AND ti.mes_referencia IS NOT DISTINCT FROM tc.mes_referencia
                         AND ti.desonerado = tc.desonerado
      JOIN ref_itens r ON r.tabela_id = ti.id AND r.tipo = 'insumo' AND r.codigo = oi2.codigo
     WHERE oi2.tipo = 'insumo' AND coalesce(oi2.grupo, '') = '' AND coalesce(r.grupo, '') <> ''
     ORDER BY oi2.id, ti.criado_em DESC
  ) x
 WHERE oi.id = x.id;
