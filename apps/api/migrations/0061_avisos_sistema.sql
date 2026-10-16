-- Avisos para o administrador do sistema (ex.: empresa com mais empreendimentos de incorporação do que o contratado).
-- Um aviso por empresa e tipo; quando a situação muda, o aviso volta a aparecer como não lido.
CREATE TABLE avisos_sistema (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid NOT NULL REFERENCES empresas(id),
  tipo        text NOT NULL,
  quantidade  integer NOT NULL,
  mensagem    text NOT NULL,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  lido_em     timestamptz,
  UNIQUE (empresa_id, tipo)
);
