// Regras de aprovação do Suprimentos (pedidos de compra, medições e autorizações de pagamento).
// Padrão: o dono aprova tudo. Opcionalmente, administradores aprovam até um valor e
// documentos até um valor mínimo são aprovados ao enviar.
import type { Cliente } from '../db.ts';

export type RegrasAprovacao = { adminAte: number | null; dispensaAte: number | null }; // centavos

const centavosOuNull = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) || Number(v) < 0 ? null : Math.round(Number(v)));

export function lerRegrasDe(json: unknown): RegrasAprovacao {
  const j = (json ?? {}) as Record<string, unknown>;
  return { adminAte: centavosOuNull(j.adminAte), dispensaAte: centavosOuNull(j.dispensaAte) };
}

export async function lerRegras(c: Cliente, empresaId: string): Promise<RegrasAprovacao> {
  const r = await c.query('SELECT aprovacao FROM empresas WHERE id = $1', [empresaId]);
  return lerRegrasDe(r.rows[0]?.aprovacao);
}

/** Quem pode aprovar um documento deste valor. */
export function podeAprovar(u: { perfil: string; administrador: boolean }, valorCentavos: number, regras: RegrasAprovacao): boolean {
  if (u.perfil === 'dono') return true;
  return u.administrador && regras.adminAte !== null && valorCentavos <= regras.adminAte;
}

/** Documento aprovado ao enviar, sem passar por aprovador. */
export function dispensaAprovacao(valorCentavos: number, regras: RegrasAprovacao): boolean {
  return regras.dispensaAte !== null && valorCentavos <= regras.dispensaAte;
}

export function textoRegras(r: RegrasAprovacao): string {
  const brl = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const partes = [r.adminAte === null ? 'O dono aprova todos os valores' : `Administradores aprovam até ${brl(r.adminAte)}; acima, só o dono`];
  if (r.dispensaAte !== null) partes.push(`até ${brl(r.dispensaAte)} a aprovação é dispensada`);
  return partes.join('; ') + '.';
}

/** Próximo número sequencial da empresa numa tabela com coluna `numero` (dentro da transação). */
export async function proximoNumero(c: Cliente, tabela: 'solicitacoes_compra' | 'cotacoes' | 'pedidos_compra' | 'contratos' | 'medicoes' | 'autorizacoes_pagamento', empresaId: string): Promise<number> {
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${tabela}:${empresaId}`]);
  const r = await c.query(`SELECT coalesce(max(numero), 0) + 1 AS n FROM ${tabela} WHERE empresa_id = $1`, [empresaId]);
  return Number(r.rows[0].n);
}
