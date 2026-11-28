-- Modelo 3D convertido (.agrega3d) guardado na obra, para o 5D abrir direto. Uma versão por obra: enviar de novo
-- substitui. Fica no próprio banco (bytea), como os anexos, para não depender de um armazenamento à parte.
CREATE TABLE obra_modelos_3d (
  obra_id        uuid PRIMARY KEY REFERENCES obras(id) ON DELETE CASCADE,
  empresa_id     uuid NOT NULL REFERENCES empresas(id),
  nome           text NOT NULL,
  tamanho        integer NOT NULL,
  conteudo       bytea NOT NULL,
  enviado_por_id uuid REFERENCES usuarios(id),
  enviado_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX obra_modelos_3d_empresa ON obra_modelos_3d (empresa_id);
