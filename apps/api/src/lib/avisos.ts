// Avisos para o administrador do sistema. Hoje há um tipo: empresa com mais empreendimentos de incorporação
// do que o contratado (adicional de R$ 450/mês, com até 3 empreendimentos).
import type { Cliente } from '../db.ts';

export const LIMITE_EMPREENDIMENTOS = 3;
export const TIPO_LIMITE_EMPREENDIMENTOS = 'limite_empreendimentos';

export function mensagemLimiteEmpreendimentos(nomeEmpresa: string, quantidade: number): string {
  return `${nomeEmpresa} tem ${quantidade} empreendimentos de incorporação cadastrados. O adicional de incorporação cobre até ${LIMITE_EMPREENDIMENTOS}.`;
}

/**
 * Registra (ou atualiza) o aviso quando a empresa passa do limite. Se a quantidade mudar, o aviso volta a aparecer
 * como não lido. Sem excesso, não faz nada.
 */
export async function avisarLimiteEmpreendimentos(c: Cliente, empresaId: string) {
  const r = await c.query(
    `SELECT e.razao_social, (SELECT count(*)::int FROM incorporacao_empreendimentos x WHERE x.empresa_id = e.id) AS total
       FROM empresas e WHERE e.id = $1`,
    [empresaId],
  );
  const linha = r.rows[0];
  if (!linha || linha.total <= LIMITE_EMPREENDIMENTOS) return;
  await c.query(
    `INSERT INTO avisos_sistema (empresa_id, tipo, quantidade, mensagem) VALUES ($1, $2, $3, $4)
     ON CONFLICT (empresa_id, tipo) DO UPDATE SET
       lido_em = CASE WHEN avisos_sistema.quantidade = EXCLUDED.quantidade THEN avisos_sistema.lido_em ELSE NULL END,
       quantidade = EXCLUDED.quantidade,
       mensagem = EXCLUDED.mensagem,
       criado_em = CASE WHEN avisos_sistema.quantidade = EXCLUDED.quantidade THEN avisos_sistema.criado_em ELSE now() END`,
    [empresaId, TIPO_LIMITE_EMPREENDIMENTOS, linha.total, mensagemLimiteEmpreendimentos(linha.razao_social, linha.total)],
  );
}
