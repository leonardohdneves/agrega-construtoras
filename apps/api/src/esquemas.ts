import { PERFIS_EMPRESA } from './lib/perfis.ts';
import { z } from 'zod';
import { MODULOS } from './lib/modulos.ts';
import { cnpjValido, limparCnpj } from './lib/cnpj.ts';
import { SENHA_MINIMA } from './lib/senha.ts';

const texto = (campo: string, min = 1) =>
  z.string({ required_error: `Informe ${campo}.` }).trim().min(min, `Informe ${campo}.`);

const opcional = z
  .string()
  .trim()
  .max(200)
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

export const esquemaEmail = z.string({ required_error: 'Informe o e-mail.' }).trim().toLowerCase().email('E-mail inválido.');

export const esquemaSenha = z
  .string({ required_error: 'Informe a senha.' })
  .min(SENHA_MINIMA, `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`)
  .max(200);

export const esquemaCnpj = z
  .string({ required_error: 'Informe o CNPJ.' })
  .transform(limparCnpj)
  .refine(cnpjValido, 'CNPJ inválido. Confira os números.');

const aliquota = z.coerce.number().min(0, 'Alíquota não pode ser negativa.').max(100, 'Alíquota acima de 100%.');

export const esquemaAliquotas = z
  .object({
    simples: aliquota.optional(),
    pis: aliquota.optional(),
    cofins: aliquota.optional(),
    iss: aliquota.optional(),
    icms: aliquota.optional(),
    irpj: aliquota.optional(),
    csll: aliquota.optional(),
  })
  .strict()
  .default({});

/** Empresa do grupo: um CNPJ da empresa, com o próprio regime tributário (define os impostos das obras que a escolhem). */
export const esquemaEmpresaGrupo = z.object({
  razaoSocial: texto('a razão social', 2),
  nomeFantasia: opcional,
  cnpj: esquemaCnpj,
  regimeTributario: z.enum(['simples', 'presumido', 'real'], { message: 'Escolha o regime tributário.' }),
  simplesAnexo: z.enum(['I', 'II', 'III', 'IV', 'V']).nullable().optional(),
  simplesFaixa: z.number().int().min(1, 'Faixa de 1 a 6.').max(6, 'Faixa de 1 a 6.').nullable().optional(),
  cidade: opcional,
  uf: z.string().trim().toUpperCase().length(2, 'UF com 2 letras.').optional().nullable().or(z.literal('').transform(() => null)),
  ativo: z.boolean().optional(),
});

export const esquemaEmpresa = z.object({
  razaoSocial: texto('a razão social', 2),
  nomeFantasia: opcional,
  cnpj: esquemaCnpj,
  regimeTributario: z.enum(['simples', 'presumido', 'real'], { message: 'Escolha o regime tributário.' }),
  aliquotasDre: esquemaAliquotas,
  simplesAnexo: z.enum(['I', 'II', 'III', 'IV', 'V']).nullable().optional(),
  simplesFaixa: z.number().int().min(1, 'Faixa de 1 a 6.').max(6, 'Faixa de 1 a 6.').nullable().optional(),
  telefone: opcional,
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('E-mail inválido.')
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),
  cidade: opcional,
  uf: z
    .string()
    .trim()
    .toUpperCase()
    .length(2, 'UF com 2 letras.')
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),
});

export const esquemaNovoUsuario = z.object({
  nome: texto('o nome', 2),
  email: esquemaEmail,
  perfil: z.enum(PERFIS_EMPRESA, { message: 'Escolha o perfil.' }),
  senha: esquemaSenha,
  telefoneWhatsapp: opcional,
  administrador: z.boolean().optional().default(false),
  modulos: z.array(z.enum(MODULOS)).max(8).nullable().optional(),
});

export const esquemaAlterarUsuario = z
  .object({
    nome: texto('o nome', 2).optional(),
    perfil: z.enum(PERFIS_EMPRESA).optional(),
    ativo: z.boolean().optional(),
    telefoneWhatsapp: opcional,
    senha: esquemaSenha.optional(),
    administrador: z.boolean().optional(),
    modulos: z.array(z.enum(MODULOS)).max(8).nullable().optional(),
  })
  .strict();

/** Contrato vendido: o pacote define os módulos; o personalizado usa a lista escolhida. */
export const esquemaContrato = z
  .object({
    pacote: z.enum(['obra', 'obra_gestao', 'completo', 'personalizado'], { message: 'Escolha o pacote.' }),
    modulos: z.array(z.enum(['engenharia', 'comercial', 'incorporacao', 'suprimentos', 'financeiro', 'gerencial', 'administrativo'])).optional(),
    limiteObras: z.number().int('Use número inteiro.').positive('O limite de obras precisa ser maior que zero.').nullable(),
    limiteUsuarios: z.number().int('Use número inteiro.').positive('O limite de usuários precisa ser maior que zero.').nullable(),
  })
  .superRefine((c, ctx) => {
    if (c.pacote === 'personalizado' && !c.modulos?.length) ctx.addIssue({ code: 'custom', message: 'Escolha pelo menos um módulo.', path: ['modulos'] });
  });

export const esquemaNovaEmpresa = esquemaEmpresa.extend({
  dono: z.object({ nome: texto('o nome do dono', 2), email: esquemaEmail, senha: esquemaSenha }),
});
