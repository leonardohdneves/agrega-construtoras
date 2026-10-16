-- Planejamento: cada atividade ganha um ID sequencial dentro da obra (usado nas predecessoras)
-- e uma descrição resumida para as telas.
ALTER TABLE obra_atividades ADD COLUMN numero integer;
ALTER TABLE obra_atividades ADD COLUMN descricao_resumida text;

UPDATE obra_atividades a SET numero = s.n
  FROM (SELECT id, row_number() OVER (PARTITION BY obra_id ORDER BY ordem, criado_em) AS n FROM obra_atividades) s
 WHERE a.id = s.id;

UPDATE obra_atividades SET descricao_resumida = left(descricao, 80) WHERE descricao_resumida IS NULL;

ALTER TABLE obra_atividades ALTER COLUMN numero SET NOT NULL;
CREATE UNIQUE INDEX obra_atividades_numero ON obra_atividades (obra_id, numero);
