-- Suprimentos ligado à obra: a compra parte das necessidades de insumo apropriadas à EAP da obra.
-- Solicitações, cotações e pedidos ganham a obra e o nó da EAP de cada item (para o custo real).
-- O catálogo de materiais e serviços é removido: a busca passa a ser feita no cadastro de insumos da obra.

-- 1) Necessidades: novos estados do fluxo de compra.
ALTER TABLE obra_necessidades DROP CONSTRAINT IF EXISTS obra_necessidades_status_check;
ALTER TABLE obra_necessidades ADD CONSTRAINT obra_necessidades_status_check
  CHECK (status IN ('pendente', 'solicitada', 'comprada', 'cancelada'));

-- 2) Solicitação: obra e finalização (só solicitação finalizada vai para cotação).
ALTER TABLE solicitacoes_compra ADD COLUMN obra_id uuid REFERENCES obras(id);
ALTER TABLE solicitacoes_compra ADD COLUMN finalizada_em timestamptz;
ALTER TABLE solicitacoes_compra DROP CONSTRAINT IF EXISTS solicitacoes_status;
ALTER TABLE solicitacoes_compra ADD CONSTRAINT solicitacoes_status
  CHECK (status IN ('aberta', 'finalizada', 'em_cotacao', 'atendida', 'cancelada'));
CREATE INDEX solicitacoes_compra_obra ON solicitacoes_compra (obra_id) WHERE obra_id IS NOT NULL;

-- 3) Itens de solicitação, cotação e pedido: insumo da obra, nó da EAP e necessidade de origem.
ALTER TABLE solicitacoes_itens
  ADD COLUMN obra_item_id   uuid REFERENCES obra_itens(id),
  ADD COLUMN eap_no_id      uuid REFERENCES eap_nos(id),
  ADD COLUMN necessidade_id uuid REFERENCES obra_necessidades(id) ON DELETE SET NULL;
ALTER TABLE cotacoes_itens
  ADD COLUMN obra_item_id   uuid REFERENCES obra_itens(id),
  ADD COLUMN eap_no_id      uuid REFERENCES eap_nos(id),
  ADD COLUMN necessidade_id uuid REFERENCES obra_necessidades(id) ON DELETE SET NULL;
ALTER TABLE pedidos_itens
  ADD COLUMN obra_item_id   uuid REFERENCES obra_itens(id),
  ADD COLUMN eap_no_id      uuid REFERENCES eap_nos(id),
  ADD COLUMN necessidade_id uuid REFERENCES obra_necessidades(id) ON DELETE SET NULL;
CREATE INDEX pedidos_itens_necessidade ON pedidos_itens (necessidade_id) WHERE necessidade_id IS NOT NULL;
CREATE INDEX pedidos_itens_eap ON pedidos_itens (eap_no_id) WHERE eap_no_id IS NOT NULL;

-- 4) Remoção do catálogo de materiais e serviços (os vínculos com insumos e as descrições permanecem).
ALTER TABLE notas_itens DROP COLUMN IF EXISTS catalogo_id;
ALTER TABLE notas_itens DROP COLUMN IF EXISTS cadastrar_catalogo;
ALTER TABLE contratos_itens DROP COLUMN IF EXISTS catalogo_id;
ALTER TABLE solicitacoes_itens DROP COLUMN IF EXISTS catalogo_id;
ALTER TABLE cotacoes_itens DROP COLUMN IF EXISTS catalogo_id;
ALTER TABLE pedidos_itens DROP COLUMN IF EXISTS catalogo_id;
DROP TABLE IF EXISTS catalogo_produtos;
DROP TABLE IF EXISTS catalogo_itens;
