-- Contrato de cada construtora: pacote vendido, módulos liberados e limites de obras e usuários.
-- As empresas que já existem continuam com todos os módulos e sem limites (nada muda para elas).

ALTER TABLE empresas
  ADD COLUMN contrato_pacote     text NOT NULL DEFAULT 'completo'
    CHECK (contrato_pacote IN ('obra', 'obra_gestao', 'completo', 'personalizado')),
  ADD COLUMN modulos_contratados text[] NOT NULL
    DEFAULT ARRAY['engenharia', 'comercial', 'suprimentos', 'financeiro', 'gerencial', 'administrativo', 'configuracoes'],
  ADD COLUMN limite_obras        integer NULL CHECK (limite_obras IS NULL OR limite_obras > 0),
  ADD COLUMN limite_usuarios     integer NULL CHECK (limite_usuarios IS NULL OR limite_usuarios > 0);
