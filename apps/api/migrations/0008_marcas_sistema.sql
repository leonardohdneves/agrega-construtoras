-- Marcas simples do sistema (ex.: versão dos dados de demonstração já criados no ambiente de teste).
CREATE TABLE marcas_sistema (
  chave         text PRIMARY KEY,
  valor         text NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
