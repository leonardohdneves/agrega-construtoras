import { z } from 'zod';

function numeroBr(v: unknown): unknown {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim().replace(/\s/g, '');
  let normal = s;
  if (s.includes(',')) normal = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) normal = s.replace(/\./g, '');
  const n = Number(normal);
  return Number.isFinite(n) ? n : v;
}

const numero = (campo: string, min: number, max: number) =>
  z.preprocess(numeroBr, z.number({ invalid_type_error: `${campo}: número inválido.` }).min(min, `${campo} inválido.`).max(max, `${campo} acima do esperado.`).nullable());

/** Aceita '2026-10-02T07:42' (horário de Brasília) ou ISO com fuso. */
export const dataHoraBr = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const comFuso = /([zZ]|[+-]\d{2}:?\d{2})$/.test(v) ? v : `${v.length === 16 ? `${v}:00` : v}-03:00`;
    const d = new Date(comFuso);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: 'custom', message: 'Data e hora inválidas.' });
      return z.NEVER;
    }
    return d;
  });

const camposAbastecimento = {
  veiculoId: z.string({ required_error: 'Escolha o veículo.' }).uuid('Escolha o veículo.'),
  motoristaId: z.string().uuid().nullable().optional(),
  dataHora: dataHoraBr.optional(),
  litros: z.preprocess(numeroBr, z.number({ required_error: 'Informe os litros.', invalid_type_error: 'Informe os litros.' }).gt(0, 'Informe os litros.').max(2000, 'Litros acima do esperado para um abastecimento.')),
  valorTotal: numero('Valor', 0, 100_000).optional().default(null),
  km: numero('Km', 0, 9_999_999).optional().default(null),
  horimetro: numero('Horímetro', 0, 999_999).optional().default(null),
  origem: z.enum(['posto', 'tanque_proprio']).optional().default('posto'),
  posto: z.string().trim().max(120).optional().nullable().transform((v) => v || null),
  tanqueCheio: z.boolean().optional().default(true),
  observacoes: z.string().trim().max(500).optional().nullable().transform((v) => v || null),
  confirmarSalto: z.boolean().optional().default(false),
};

export const esquemaAbastecimento = z.object(camposAbastecimento);
export const esquemaAlterarAbastecimento = z.object(camposAbastecimento).partial().strict();

export const esquemaFiltroAbastecimentos = z.object({
  veiculoId: z.string().uuid().optional(),
  dias: z.coerce.number().int().min(1).max(730).optional().default(30),
});
