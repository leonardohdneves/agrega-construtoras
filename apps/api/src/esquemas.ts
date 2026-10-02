import { z } from 'zod';
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

export const esquemaEmpresa = z.object({
  razaoSocial: texto('a razão social', 2),
  nomeFantasia: opcional,
  cnpj: esquemaCnpj,
  regimeTributario: z.enum(['simples', 'presumido', 'real'], { message: 'Escolha o regime tributário.' }),
  aliquotasDre: esquemaAliquotas,
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
  perfil: z.enum(['dono', 'gestor', 'operador_usina', 'motorista'], { message: 'Escolha o perfil.' }),
  senha: esquemaSenha,
  telefoneWhatsapp: opcional,
});

export const esquemaAlterarUsuario = z
  .object({
    nome: texto('o nome', 2).optional(),
    perfil: z.enum(['dono', 'gestor', 'operador_usina', 'motorista']).optional(),
    ativo: z.boolean().optional(),
    telefoneWhatsapp: opcional,
    senha: esquemaSenha.optional(),
  })
  .strict();

export const esquemaNovaEmpresa = esquemaEmpresa.extend({
  dono: z.object({ nome: texto('o nome do dono', 2), email: esquemaEmail, senha: esquemaSenha }),
});
