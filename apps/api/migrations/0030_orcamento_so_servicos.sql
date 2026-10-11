-- Orçamento: cada linha precisa ser um serviço (composição) da própria obra. A regra também é conferida na
-- API; aqui o banco garante, inclusive para gravações feitas por outros caminhos.
CREATE FUNCTION orcamento_so_servicos() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  item record;
BEGIN
  SELECT obra_id, tipo INTO item FROM obra_itens WHERE id = NEW.obra_item_id;
  IF item.obra_id IS DISTINCT FROM NEW.obra_id THEN
    RAISE EXCEPTION 'Este serviço não está na obra.' USING ERRCODE = 'check_violation', CONSTRAINT = 'orcamento_item_da_obra';
  END IF;
  IF item.tipo <> 'composicao' THEN
    RAISE EXCEPTION 'Só serviços (composições) da obra entram no orçamento.' USING ERRCODE = 'check_violation', CONSTRAINT = 'orcamento_so_servicos';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER orcamento_so_servicos
  BEFORE INSERT OR UPDATE OF obra_item_id, obra_id ON orcamento_itens
  FOR EACH ROW EXECUTE FUNCTION orcamento_so_servicos();
