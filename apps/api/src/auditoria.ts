import type { Cliente } from './db.ts';

export type RegistroAuditoria = {
  empresaId: string | null;
  usuarioId: string | null;
  acao: 'criar' | 'alterar' | 'excluir' | 'confirmar' | 'entrar';
  entidade: string;
  entidadeId: string;
  antes?: unknown;
  depois?: unknown;
};

const SENSIVEIS = new Set(['senha_hash', 'senha']);

function limpar(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') return obj ?? null;
  return Object.fromEntries(Object.entries(obj as Record<string, unknown>).filter(([k]) => !SENSIVEIS.has(k)));
}

export async function auditar(c: Cliente, r: RegistroAuditoria): Promise<void> {
  await c.query(
    `INSERT INTO auditoria (empresa_id, usuario_id, acao, entidade, entidade_id, antes, depois)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [r.empresaId, r.usuarioId, r.acao, r.entidade, r.entidadeId, JSON.stringify(limpar(r.antes)), JSON.stringify(limpar(r.depois))],
  );
}
