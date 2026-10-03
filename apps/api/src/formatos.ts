// Formatos de dados devolvidos pela API (nomes em camelCase).
import { listaDoUsuario, modulosEfetivos } from './lib/modulos.ts';

export function usuarioPublico(r: Record<string, any>) {
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
    modulosEfetivos: r.perfil === 'admin_sistema' ? [] : modulosEfetivos(r.perfil, listaDoUsuario(r.perfil, r.modulos, r.perfil === 'dono' || !!r.administrador)),
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
    telefone: r.telefone,
    email: r.email,
    cidade: r.cidade,
    uf: r.uf ? String(r.uf).trim() : null,
    plano: r.plano,
    ativo: r.ativo,
    temLogo: !!r.logo_tipo,
    logoVersao: r.logo_atualizado_em ? new Date(r.logo_atualizado_em).getTime() : null,
    impressao: { orientacao: r.impressao?.orientacao === 'retrato' ? 'retrato' : 'paisagem', papel: ['A4', 'Carta', 'Oficio'].includes(r.impressao?.papel) ? r.impressao.papel : 'A4' },
    criadoEm: r.criado_em,
  };
}
