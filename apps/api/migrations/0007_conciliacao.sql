-- Etapa 6 · Conciliação bancária com OFX.

CREATE TABLE extratos_ofx (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           uuid NOT NULL REFERENCES empresas(id),
  conta_financeira_id  uuid NOT NULL REFERENCES contas_financeiras(id),
  arquivo_nome         text,
  banco                text,
  agencia              text,
  conta                text,
  periodo_inicio       date,
  periodo_fim          date,
  saldo_centavos       bigint,
  data_saldo           date,
  linhas_novas         integer NOT NULL DEFAULT 0,
  linhas_repetidas     integer NOT NULL DEFAULT 0,
  importado_por_id     uuid REFERENCES usuarios(id),
  importado_em         timestamptz NOT NULL DEFAULT now(),
  excluido_em          timestamptz
);
CREATE INDEX extratos_conta ON extratos_ofx (empresa_id, conta_financeira_id, importado_em DESC);

CREATE TABLE extrato_linhas (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id           uuid NOT NULL REFERENCES empresas(id),
  extrato_id           uuid NOT NULL REFERENCES extratos_ofx(id),
  conta_financeira_id  uuid NOT NULL REFERENCES contas_financeiras(id),
  fitid                text NOT NULL,
  data                 date NOT NULL,
  valor_centavos       bigint NOT NULL,
  tipo                 text,
  descricao            text NOT NULL,
  documento            text,
  status               text NOT NULL DEFAULT 'pendente',
  acao                 text,
  parcela_id           uuid REFERENCES parcelas(id),
  transferencia_id     uuid REFERENCES transferencias(id),
  sugestao_parcela_id  uuid REFERENCES parcelas(id),
  sugestao_transferencia_id uuid REFERENCES transferencias(id),
  conciliado_por_id    uuid REFERENCES usuarios(id),
  conciliado_em        timestamptz,
  criado_em            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT extrato_linhas_status CHECK (status IN ('pendente', 'conciliado', 'ignorado')),
  CONSTRAINT extrato_linhas_acao CHECK (acao IS NULL OR acao IN ('vinculo', 'baixa', 'lancamento', 'transferencia', 'nova_transferencia'))
);
CREATE UNIQUE INDEX extrato_linhas_fitid ON extrato_linhas (conta_financeira_id, fitid);
CREATE UNIQUE INDEX extrato_linhas_parcela ON extrato_linhas (parcela_id) WHERE parcela_id IS NOT NULL;
CREATE INDEX extrato_linhas_situacao ON extrato_linhas (empresa_id, conta_financeira_id, status, data);
CREATE INDEX extrato_linhas_transferencia ON extrato_linhas (transferencia_id) WHERE transferencia_id IS NOT NULL;

ALTER TABLE lancamentos DROP CONSTRAINT lancamentos_origem;
ALTER TABLE lancamentos ADD CONSTRAINT lancamentos_origem CHECK (origem IN ('manual', 'xml', 'ia_whatsapp', 'frota', 'extrato'));
