-- Assinatura desenhada na tela: responsável pela visita (logado) e dono da obra (pelo link da visita).
-- O código de verificação é um resumo do conteúdo da visita (texto e fotos) no momento da assinatura:
-- se a visita mudar, a assinatura que não confere com o conteúdo atual é removida.
CREATE TABLE visita_assinaturas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL REFERENCES empresas(id),
  visita_id    uuid NOT NULL REFERENCES obra_visitas(id) ON DELETE CASCADE,
  papel        text NOT NULL CHECK (papel IN ('responsavel', 'dono_obra')),
  nome         text NOT NULL,
  imagem       text NOT NULL,
  codigo       text NOT NULL,
  assinado_em  timestamptz NOT NULL DEFAULT now(),
  assinado_por uuid REFERENCES usuarios(id),
  ip           text,
  UNIQUE (visita_id, papel)
);

-- Link para o dono da obra assinar: vale até a data de expiração e é trocado a cada novo link.
ALTER TABLE obra_visitas
  ADD COLUMN assinatura_token text UNIQUE,
  ADD COLUMN assinatura_token_expira timestamptz;
