// Proposta comercial personalizada para um interessado: preenche os marcadores do modelo
// (material/proposta-comercial.html) com os dados do cadastro e destaca o pacote de interesse.
// Campos que o sistema não tem (CNPJ, cargo) saem como "a informar", para completar antes do envio.

export type DadosProposta = {
  empresa: string;
  responsavel: string;
  cidade: string | null;
  uf: string | null;
  obrasAtivas: number | null;
  usuarios: number | null;
  pacote: 'obra' | 'obra_gestao' | 'completo' | 'ainda_nao_sei';
};

export type Remetente = { nome: string; email: string | null; telefone: string | null };

const NOME_PACOTE: Record<Exclude<DadosProposta['pacote'], 'ainda_nao_sei'>, string> = {
  obra: 'Obra',
  obra_gestao: 'Obra + Gestão',
  completo: 'Completo',
};

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function textoIndicacao(d: DadosProposta): string {
  if (d.pacote === 'ainda_nao_sei') return 'o pacote será definido na conversa, de acordo com o porte da operação.';
  const porte = [d.obrasAtivas !== null ? `${d.obrasAtivas} obra(s) ativa(s)` : null, d.usuarios !== null ? `${d.usuarios} usuário(s)` : null].filter(Boolean);
  const base = `pacote ${NOME_PACOTE[d.pacote]}`;
  return porte.length ? `${base}, pelo porte informado no cadastro: ${porte.join(' e ')}.` : `${base}, pelo que nos informou no cadastro.`;
}

/** Preenche o modelo para um interessado. Função pura: não lê arquivo nem banco. */
export function preencherProposta(modelo: string, d: DadosProposta, remetente: Remetente, data: string): string {
  const cliente = esc(d.empresa);
  let html = modelo
    .replaceAll('[NOME DA CONSTRUTORA]', cliente)
    .replaceAll('[NOME DO RESPONSÁVEL], [CARGO]', esc(d.responsavel))
    .replaceAll('[NOME DO RESPONSÁVEL]', esc(d.responsavel))
    .replaceAll('[NOME DO REPRESENTANTE]', esc(remetente.nome))
    .replaceAll('[CARGO] · CNPJ [CNPJ]', 'CNPJ a informar')
    .replaceAll('[DD/MM/AAAA]', esc(data))
    .replaceAll(
      '[CONTATO COMERCIAL] · [TELEFONE] · [E-MAIL]',
      esc([remetente.nome, remetente.telefone ?? 'telefone a informar', remetente.email ?? 'e-mail a informar'].join(' · ')),
    );

  // Pacote de interesse destacado: o selo "Mais completo" só aparece no cartão que está destacado.
  if (d.pacote !== 'ainda_nao_sei') {
    const selo = /<span class="selo">Mais completo<\/span>\s*/;
    html = html.replace(selo, '').replace(/<article class="pacote destaque">/g, '<article class="pacote">');
    const nome = NOME_PACOTE[d.pacote];
    const cartao = new RegExp(`<article class="pacote">(\\s*)<h4>${nome.replace(/[+]/g, '\\+')}</h4>`);
    const comSelo = d.pacote === 'completo' ? '<span class="selo">Mais completo</span>\n        ' : '';
    html = html.replace(cartao, `<article class="pacote destaque">$1${comSelo}<h4>${nome}</h4>`);
  }

  // Indicação logo após a introdução da seção de pacotes.
  const introPacotes = '<p>O contrato é mensal ou anual. No anual, a mensalidade tem 15% de desconto, com fidelidade de 12 meses.</p>';
  if (html.includes(introPacotes)) {
    html = html.replace(introPacotes, `${introPacotes}\n    <div class="info"><b>Indicação para ${cliente}:</b> ${esc(textoIndicacao(d))}</div>`);
  }
  return html;
}
