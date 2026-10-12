-- Empresas do grupo: cada CNPJ da empresa com seu regime tributário. A obra escolhe uma delas;
-- o regime e o enquadramento do Simples dessa empresa definem os impostos da obra.
CREATE TABLE empresas_grupo (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid NOT NULL REFERENCES empresas(id),
  razao_social      text NOT NULL,
  nome_fantasia     text,
  cnpj              char(14) NOT NULL,
  regime_tributario regime_tributario NOT NULL DEFAULT 'simples',
  simples_anexo     text CHECK (simples_anexo IN ('I', 'II', 'III', 'IV', 'V')),
  simples_faixa     smallint CHECK (simples_faixa BETWEEN 1 AND 6),
  cidade            text,
  uf                char(2),
  ativo             boolean NOT NULL DEFAULT true,
  criado_em         timestamptz NOT NULL DEFAULT now(),
  atualizado_em     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, cnpj)
);

-- Sem empresa do grupo (nulo), a obra usa a própria empresa logada, como antes.
ALTER TABLE obras ADD COLUMN empresa_grupo_id uuid REFERENCES empresas_grupo(id);
CREATE INDEX obras_empresa_grupo ON obras (empresa_grupo_id);
