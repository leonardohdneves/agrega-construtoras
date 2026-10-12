-- Planilha orçamentária: a linha que tem serviço lançado continua sendo Tarefa (a troca de nível é validada na API;
-- aqui o banco garante a regra do serviço).
CREATE FUNCTION eap_tarefa_com_servico() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.nivel <> 'tarefa' AND EXISTS (SELECT 1 FROM orcamento_itens WHERE eap_no_id = NEW.id) THEN
    RAISE EXCEPTION 'Esta linha tem serviço lançado. Retire o serviço antes de mudar o nível.' USING ERRCODE = 'check_violation', CONSTRAINT = 'orcamento_na_tarefa';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER eap_tarefa_com_servico
  BEFORE UPDATE OF nivel ON eap_nos
  FOR EACH ROW EXECUTE FUNCTION eap_tarefa_com_servico();
