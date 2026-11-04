// Código único de aceite de uma proposta. Cada proposta gerada recebe um código novo, válido até o fim da validade.
import { randomBytes } from 'node:crypto';
import type { Banco } from '../db.ts';
import type { Condicoes } from './proposta-interessado.ts';

export async function criarAceite(
  banco: Banco,
  d: { empresaId: string | null; interessadoId: string | null; nomeCliente: string; condicoes: Condicoes; criadoPor: string },
): Promise<string> {
  const codigo = randomBytes(24).toString('base64url');
  await banco.query(
    `INSERT INTO propostas_aceite (codigo, empresa_id, interessado_id, nome_cliente, condicoes, dias_teste, expira_em, criado_por)
     VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(days => $7::int), $8)`,
    [codigo, d.empresaId, d.interessadoId, d.nomeCliente, JSON.stringify(d.condicoes), d.condicoes.diasTeste, d.condicoes.validade, d.criadoPor],
  );
  return codigo;
}
