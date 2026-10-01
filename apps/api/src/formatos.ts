// Formatos de dados devolvidos pela API (nomes em camelCase).

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
    criadoEm: r.criado_em,
  };
}
