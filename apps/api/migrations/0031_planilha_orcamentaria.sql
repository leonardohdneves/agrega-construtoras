-- Planilha orçamentária: EAP e orçamento construídos juntos.
-- Níveis: 1 Obra, 2 Etapa, 3 Sub Etapa, 4 Tarefa. O serviço é lançado numa linha de Tarefa (uma linha, um serviço).

ALTER TABLE eap_nos DROP CONSTRAINT IF EXISTS eap_nos_nivel_check;
ALTER TABLE eap_nos ADD CONSTRAINT eap_nos_nivel_check CHECK (nivel IN ('obra', 'etapa', 'subetapa', 'tarefa'));

-- Orçamentos antigos: linha sem nó, em nó que não é Tarefa, ou segunda linha da mesma Tarefa
-- vira uma Tarefa nova (dentro do nó antigo; se o antigo era Tarefa, ao lado dela), com a descrição do serviço.
DO $$
DECLARE
  l record;
  alvo uuid;
  alvo_codigo text;
  n int;
  cod text;
  novo uuid;
BEGIN
  FOR l IN
    SELECT oq.id, oq.obra_id, oq.eap_no_id, e.nivel, e.pai_id AS no_pai, oi.descricao
      FROM orcamento_itens oq
      JOIN obra_itens oi ON oi.id = oq.obra_item_id
      LEFT JOIN eap_nos e ON e.id = oq.eap_no_id
     WHERE e.id IS NULL
        OR e.nivel <> 'tarefa'
        OR oq.id <> (SELECT o2.id FROM orcamento_itens o2 WHERE o2.eap_no_id = oq.eap_no_id ORDER BY o2.ordem, o2.criado_em, o2.id LIMIT 1)
     ORDER BY oq.obra_id, oq.ordem, oq.criado_em
  LOOP
    alvo := CASE WHEN l.nivel = 'tarefa' THEN l.no_pai ELSE l.eap_no_id END;
    alvo_codigo := (SELECT codigo FROM eap_nos WHERE id = alvo);
    SELECT count(*) INTO n FROM eap_nos WHERE obra_id = l.obra_id AND pai_id IS NOT DISTINCT FROM alvo;
    LOOP
      n := n + 1;
      cod := CASE WHEN alvo_codigo IS NULL THEN n::text ELSE alvo_codigo || '.' || n END;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM eap_nos WHERE obra_id = l.obra_id AND codigo = cod);
    END LOOP;
    novo := gen_random_uuid();
    INSERT INTO eap_nos (id, obra_id, pai_id, nivel, codigo, descricao)
    VALUES (novo, l.obra_id, alvo, 'tarefa', cod, left(l.descricao, 200));
    UPDATE orcamento_itens SET eap_no_id = novo WHERE id = l.id;
  END LOOP;
END $$;

ALTER TABLE orcamento_itens ALTER COLUMN eap_no_id SET NOT NULL;
CREATE UNIQUE INDEX orcamento_itens_um_por_tarefa ON orcamento_itens (eap_no_id);

-- A regra do orçamento passa a valer também para o nó: Tarefa da própria obra.
CREATE OR REPLACE FUNCTION orcamento_so_servicos() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  item record;
  no record;
BEGIN
  SELECT obra_id, tipo INTO item FROM obra_itens WHERE id = NEW.obra_item_id;
  IF item.obra_id IS DISTINCT FROM NEW.obra_id THEN
    RAISE EXCEPTION 'Este serviço não está na obra.' USING ERRCODE = 'check_violation', CONSTRAINT = 'orcamento_item_da_obra';
  END IF;
  IF item.tipo <> 'composicao' THEN
    RAISE EXCEPTION 'Só serviços (composições) da obra entram no orçamento.' USING ERRCODE = 'check_violation', CONSTRAINT = 'orcamento_so_servicos';
  END IF;
  SELECT obra_id, nivel INTO no FROM eap_nos WHERE id = NEW.eap_no_id;
  IF no.obra_id IS DISTINCT FROM NEW.obra_id OR no.nivel IS DISTINCT FROM 'tarefa' THEN
    RAISE EXCEPTION 'O serviço é lançado numa linha de Tarefa da própria obra.' USING ERRCODE = 'check_violation', CONSTRAINT = 'orcamento_na_tarefa';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS orcamento_so_servicos ON orcamento_itens;
CREATE TRIGGER orcamento_so_servicos
  BEFORE INSERT OR UPDATE OF obra_item_id, obra_id, eap_no_id ON orcamento_itens
  FOR EACH ROW EXECUTE FUNCTION orcamento_so_servicos();
