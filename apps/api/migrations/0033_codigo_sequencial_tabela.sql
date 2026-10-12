-- Serviços criados numa tabela própria recebem código da sequência dessa tabela.
-- A sequência só anda para frente: apagar um serviço não libera o número.
ALTER TABLE ref_tabelas ADD COLUMN proximo_codigo integer NOT NULL DEFAULT 1 CHECK (proximo_codigo >= 1);

-- Começa depois do maior código numérico já usado na tabela.
UPDATE ref_tabelas t
   SET proximo_codigo = 1 + coalesce((
         SELECT max(i.codigo::integer) FROM ref_itens i
          WHERE i.tabela_id = t.id AND i.tipo = 'composicao' AND i.codigo ~ '^[0-9]{1,8}$'), 0)
 WHERE t.fonte = 'proprio';
