-- Interessados no programa piloto: cadastros feitos pela página pública de interesse (QR code e divulgação).
-- Não pertencem a nenhuma construtora; só o administrador do sistema lê.

CREATE TABLE interessados (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa      text NOT NULL,
  responsavel  text NOT NULL,
  email        text NOT NULL,
  telefone     text NOT NULL,
  cidade       text,
  uf           char(2),
  obras_ativas integer CHECK (obras_ativas IS NULL OR obras_ativas >= 0),
  usuarios     integer CHECK (usuarios IS NULL OR usuarios >= 0),
  pacote       text NOT NULL CHECK (pacote IN ('obra', 'obra_gestao', 'completo', 'ainda_nao_sei')),
  mensagem     text,
  criado_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX interessados_criado ON interessados (criado_em DESC);
