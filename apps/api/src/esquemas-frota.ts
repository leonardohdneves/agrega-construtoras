import { z } from 'zod';
import { cpfValido, normalizarPlaca } from './lib/frota.ts';

// Converte "1.234,5" ou "1234.5" em número; vazio vira null.
function numeroBr(v: unknown): unknown {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'number') return v;
  const s = String(v).trim().replace(/\s/g, '');
  // Padrão brasileiro: vírgula decimal e ponto de milhar ("128.430" = 128430; "1.234,5" = 1234.5).
  let normal = s;
  if (s.includes(',')) normal = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) normal = s.replace(/\./g, '');
  const n = Number(normal);
  return Number.isFinite(n) ? n : v;
}

const numero = (campo: string, max: number) =>
  z.preprocess(numeroBr, z.number({ invalid_type_error: `${campo}: número inválido.` }).min(0, `${campo} não pode ser negativo.`).max(max, `${campo} acima do esperado.`).nullable());

const textoOpcional = z
  .string()
  .trim()
  .max(500)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

const data = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.'), z.literal(''), z.null()])
  .optional()
  .transform((v) => (v ? v : null));

const placa = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (!v || !v.trim()) return null;
    const p = normalizarPlaca(v);
    if (!p) {
      ctx.addIssue({ code: 'custom', message: 'Placa inválida. Use o formato ABC1234 ou ABC1D23.' });
      return z.NEVER;
    }
    return p;
  });

export const TIPOS_VEICULO = ['betoneira', 'bomba_lanca', 'bomba_estacionaria', 'apoio', 'pa_carregadeira'] as const;
export const STATUS_VEICULO = ['disponivel', 'manutencao', 'parado', 'inativo'] as const;
export const TIPOS_DOCUMENTO = ['crlv', 'licenciamento', 'seguro', 'ipva', 'tacografo', 'outro'] as const;

const camposVeiculo = {
  codigo: z.string({ required_error: 'Informe o código do veículo.' }).trim().toUpperCase().min(1, 'Informe o código do veículo.').max(20, 'Código com até 20 caracteres.'),
  tipo: z.enum(TIPOS_VEICULO, { message: 'Escolha o tipo do veículo.' }),
  placa,
  marcaModelo: textoOpcional,
  ano: z.preprocess(numeroBr, z.number().int('Ano inválido.').min(1970, 'Ano inválido.').max(2100, 'Ano inválido.').nullable()).optional().default(null),
  capacidadeM3: numero('Capacidade', 30).optional().default(null),
  alcanceLancaM: numero('Alcance da lança', 100).optional().default(null),
  kmAtual: numero('Km', 9_999_999).optional().default(0),
  horimetroAtual: numero('Horímetro', 999_999).optional().default(0),
  status: z.enum(STATUS_VEICULO).optional().default('disponivel'),
  observacoes: textoOpcional,
};

export const esquemaVeiculo = z.object(camposVeiculo);
export const esquemaAlterarVeiculo = z.object(camposVeiculo).partial().strict();

export const esquemaDocumento = z.object({
  tipo: z.enum(TIPOS_DOCUMENTO, { message: 'Escolha o tipo do documento.' }),
  descricao: textoOpcional,
  numero: textoOpcional,
  vencimento: data,
  valor: numero('Valor', 10_000_000).optional().default(null),
});
export const esquemaAlterarDocumento = esquemaDocumento.partial().strict();

export const FUNCOES = ['motorista', 'operador_bomba', 'motorista_operador', 'operador_usina', 'mecanico', 'laboratorista', 'administrativo', 'vendedor', 'gestor_patio', 'outro'] as const;
export const FUNCOES_FROTA = ['motorista', 'operador_bomba', 'motorista_operador'] as const;
const CATEGORIAS_CNH = ['A', 'B', 'C', 'D', 'E', 'AB', 'AC', 'AD', 'AE'] as const;

const camposMotorista = {
  nome: z.string({ required_error: 'Informe o nome.' }).trim().min(2, 'Informe o nome.').max(120),
  telefone: textoOpcional,
  cpf: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v, ctx) => {
      const c = (v ?? '').replace(/\D/g, '');
      if (!c) return null;
      if (!cpfValido(c)) {
        ctx.addIssue({ code: 'custom', message: 'CPF inválido. Confira os números.' });
        return z.NEVER;
      }
      return c;
    }),
  funcao: z.enum(FUNCOES).optional().default('motorista'),
  cnhNumero: textoOpcional,
  cnhCategoria: z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (v ? v.trim().toUpperCase() : null))
    .refine((v) => v === null || (CATEGORIAS_CNH as readonly string[]).includes(v), 'Categoria de CNH inválida.'),
  cnhVencimento: data,
  cursos: z.array(z.string().trim().min(1).max(120)).max(20).optional().default([]),
  ativo: z.boolean().optional().default(true),
  cargo: textoOpcional,
  email: z.string().trim().toLowerCase().email('E-mail inválido.').optional().nullable().or(z.literal('').transform(() => null)),
  dataAdmissao: data,
  observacoes: textoOpcional,
};

export const esquemaMotorista = z.object(camposMotorista);
export const esquemaAlterarMotorista = z
  .object({ ...camposMotorista, usuarioId: z.string().uuid().nullable().optional() })
  .partial()
  .strict();
