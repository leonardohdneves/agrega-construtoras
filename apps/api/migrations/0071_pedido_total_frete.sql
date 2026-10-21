-- Corrige o total de pedidos de compra editados cujo frete não entrou no total (total = itens + frete).
UPDATE pedidos_compra p
SET total_centavos = p.frete_centavos + coalesce((SELECT round(sum(round(pi.quantidade * pi.preco_unitario_centavos))) FROM pedidos_itens pi WHERE pi.pedido_id = p.id), 0)
WHERE p.total_centavos <> p.frete_centavos + coalesce((SELECT round(sum(round(pi.quantidade * pi.preco_unitario_centavos))) FROM pedidos_itens pi WHERE pi.pedido_id = p.id), 0);
