-- Aceite da proposta comercial por link com código único. Quem aceita informa nome, cargo e documento; o
-- sistema grava data, hora e IP e calcula o período de testes (início na data do aceite, fim após os dias da proposta).
-- O aceite não limita o uso do sistema: o período de testes fica registrado para o comercial acompanhar.
CREATE TABLE propostas_aceite (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo           text NOT NULL UNIQUE CHECK (length(codigo) >= 32),
  empresa_id       uuid REFERENCES empresas(id),
  interessado_id   uuid REFERENCES interessados(id),
  nome_cliente     text NOT NULL,
  condicoes        jsonb NOT NULL,
  dias_teste       integer NOT NULL CHECK (dias_teste >= 0),
  expira_em        timestamptz NOT NULL,
  criado_por       uuid REFERENCES usuarios(id),
  criado_em        timestamptz NOT NULL DEFAULT now(),
  aceito_em        timestamptz,
  aceito_nome      text,
  aceito_cargo     text,
  aceito_documento text,
  aceito_ip        text,
  teste_inicio     date,
  teste_fim        date,
  CHECK (empresa_id IS NOT NULL OR interessado_id IS NOT NULL)
);
CREATE INDEX propostas_aceite_criado ON propostas_aceite (criado_em DESC);
