// Formatos de dados devolvidos pela API (nomes em camelCase).
import { contratoComBase, listaDoUsuario, modulosEfetivos } from './lib/modulos.ts';
import { NOMES_PACOTE } from './lib/pacotes.ts';

/** `contratados`: módulos do contrato da empresa do usuário (sem ele, todos valem). */
export function usuarioPublico(r: Record<string, any>, contratados?: readonly string[] | null) {
  return {
    id: r.id,
    nome: r.nome,
    email: r.email,
    perfil: r.perfil,
    empresaId: r.empresa_id ?? null,
    telefoneWhatsapp: r.telefone_whatsapp ?? null,
    ativo: r.ativo,
    ultimoAcesso: r.ultimo_acesso ?? null,
    criadoEm: r.criado_em,
    administrador: r.perfil === 'dono' || !!r.administrador,
    // null = segue o padrão do perfil
    modulos: r.perfil === 'dono' ? null : (r.modulos ?? null),
    modulosEfetivos: r.perfil === 'admin_sistema' ? [] : modulosEfetivos(r.perfil, listaDoUsuario(r.perfil, r.modulos, r.perfil === 'dono' || !!r.administrador), contratados ? contratoComBase(contratados) : undefined),
  };
}

export function empresaPublica(r: Record<string, any>) {
  return {
    id: r.id,
    razaoSocial: r.razao_social,
    nomeFantasia: r.nome_fantasia,
    cnpj: (r.cnpj ?? '').trim(),
    regimeTributario: r.regime_tributario,
    aliquotasDre: r.aliquotas_dre ?? {},
    simplesAnexo: r.simples_anexo ?? null,
    simplesFaixa: r.simples_faixa === null || r.simples_faixa === undefined ? null : Number(r.simples_faixa),
    telefone: r.telefone,
    email: r.email,
    cidade: r.cidade,
    uf: r.uf ? String(r.uf).trim() : null,
    plano: r.plano,
    contrato: {
      pacote: r.contrato_pacote ?? 'completo',
      nomePacote: NOMES_PACOTE[(r.contrato_pacote ?? 'completo') as keyof typeof NOMES_PACOTE] ?? 'Completo',
      modulos: contratoComBase(r.modulos_contratados),
      limiteObras: r.limite_obras ?? null,
      limiteUsuarios: r.limite_usuarios ?? null,
    },
    ativo: r.ativo,
    temLogo: !!r.logo_tipo,
    logoVersao: r.logo_atualizado_em ? new Date(r.logo_atualizado_em).getTime() : null,
    impressao: { orientacao: r.impressao?.orientacao === 'retrato' ? 'retrato' : 'paisagem', papel: ['A4', 'Carta', 'Oficio'].includes(r.impressao?.papel) ? r.impressao.papel : 'A4' },
    criadoEm: r.criado_em,
  };
}

/** Empresa do grupo, como a tela a recebe. */
export function empresaGrupoPublica(r: Record<string, any>) {
  return {
    id: r.id as string,
    razaoSocial: r.razao_social as string,
    nomeFantasia: (r.nome_fantasia as string | null) ?? null,
    cnpj: ((r.cnpj as string) ?? '').trim(),
    regimeTributario: r.regime_tributario as 'simples' | 'presumido' | 'real',
    simplesAnexo: (r.simples_anexo as string | null) ?? null,
    simplesFaixa: r.simples_faixa === null || r.simples_faixa === undefined ? null : Number(r.simples_faixa),
    endereco: (r.endereco as string | null) ?? null,
    cidade: (r.cidade as string | null) ?? null,
    uf: (r.uf as string | null) ?? null,
    ativo: !!r.ativo,
  };
}
