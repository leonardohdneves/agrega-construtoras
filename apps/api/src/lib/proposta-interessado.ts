// Proposta comercial personalizada do Agrega Construtoras (material/proposta-comercial.html).
// Serve a dois públicos: um interessado (cadastro da página de interesse) e uma construtora já cadastrada
// (contrato no sistema). Preenche os marcadores, destaca o pacote e escreve a indicação.
// O que o sistema não sabe (CNPJ, cargo) sai como "a informar", para completar antes do envio.

export type PacoteProposta = 'obra' | 'obra_gestao' | 'completo' | 'personalizado' | 'ainda_nao_sei';

export type DadosProposta = {
  empresa: string;
  responsavel: string | null;
  cnpj: string | null;
  pacote: PacoteProposta;
  /** Frase da indicação, já pronta (ver indicacaoInteressado e indicacaoContrato). */
  indicacao: string;
};

export type Remetente = { nome: string; email: string | null; telefone: string | null; cnpj: string | null };

const NOME_PACOTE: Record<Exclude<PacoteProposta, 'ainda_nao_sei' | 'personalizado'>, string> = {
  obra: 'Obra',
  obra_gestao: 'Obra + Gestão',
  completo: 'Completo',
};

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 14 dígitos viram 00.000.000/0000-00; qualquer outro valor volta sem alteração. */
export function formatarCnpjProposta(c: string | null | undefined): string | null {
  const d = (c ?? '').replace(/\D/g, '');
  if (d.length !== 14) return c?.trim() || null;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

/** Indicação para quem ainda está só se cadastrando: usa o porte que a pessoa informou. */
export function indicacaoInteressado(pacote: PacoteProposta, obrasAtivas: number | null, usuarios: number | null): string {
  if (pacote === 'ainda_nao_sei') return 'o pacote será definido na conversa, de acordo com o porte da operação.';
  if (pacote === 'personalizado') return 'um pacote sob medida, a definir na conversa.';
  const porte = [obrasAtivas !== null ? `${obrasAtivas} obra(s) ativa(s)` : null, usuarios !== null ? `${usuarios} usuário(s)` : null].filter(Boolean);
  const base = `pacote ${NOME_PACOTE[pacote]}`;
  return porte.length ? `${base}, pelo porte informado no cadastro: ${porte.join(' e ')}.` : `${base}, pelo que nos informou no cadastro.`;
}

/** Indicação para uma construtora já cadastrada: usa os limites do contrato. */
export function indicacaoContrato(pacote: PacoteProposta, limiteObras: number | null, limiteUsuarios: number | null): string {
  if (pacote === 'personalizado') {
    const limites = [limiteObras !== null ? `até ${limiteObras} obra(s) ativa(s)` : null, limiteUsuarios !== null ? `até ${limiteUsuarios} usuário(s)` : null].filter(Boolean);
    return limites.length ? `pacote personalizado, com os módulos combinados e ${limites.join(' e ')}.` : 'pacote personalizado, com os módulos combinados no contrato.';
  }
  if (pacote === 'ainda_nao_sei') return 'pacote a definir.';
  const limites = [limiteObras !== null ? `até ${limiteObras} obra(s) ativa(s)` : null, limiteUsuarios !== null ? `até ${limiteUsuarios} usuário(s)` : null].filter(Boolean);
  return `pacote ${NOME_PACOTE[pacote]}${limites.length ? `, com ${limites.join(' e ')}` : ''}.`;
}

/** Preenche o modelo. Função pura: não lê arquivo nem banco. */
export function preencherProposta(modelo: string, d: DadosProposta, remetente: Remetente, data: string): string {
  const cliente = esc(d.empresa);
  const cnpjCliente = esc(formatarCnpjProposta(d.cnpj) ?? 'a informar');
  const cnpjAgrega = esc(formatarCnpjProposta(remetente.cnpj) ?? 'a informar');
  let html = modelo
    .replaceAll('[NOME DA CONSTRUTORA]', cliente)
    .replaceAll('[NOME DO RESPONSÁVEL]<br>[CARGO] · CNPJ [CNPJ]', `${esc(d.responsavel ?? 'a informar')}<br>CNPJ ${cnpjCliente}`)
    .replaceAll('[NOME DO REPRESENTANTE]<br>[CARGO] · CNPJ [CNPJ]', `${esc(remetente.nome)}<br>CNPJ ${cnpjAgrega}`)
    .replaceAll('[NOME DO RESPONSÁVEL], [CARGO]', esc(d.responsavel ?? 'a informar'))
    .replaceAll('[DD/MM/AAAA]', esc(data))
    .replaceAll(
      '[CONTATO COMERCIAL] · [TELEFONE] · [E-MAIL]',
      esc([remetente.nome, remetente.telefone ?? 'telefone a informar', remetente.email ?? 'e-mail a informar'].join(' · ')),
    );

  // Pacote destacado: o modelo traz o Completo destacado; tira-se esse destaque e aplica-se o do pacote indicado.
  // Personalizado e "ainda não sei" não destacam nenhum cartão.
  const selo = /<span class="selo">Mais completo<\/span>\s*/;
  html = html.replace(selo, '').replace(/<article class="pacote destaque">/g, '<article class="pacote">');
  if (d.pacote === 'obra' || d.pacote === 'obra_gestao' || d.pacote === 'completo') {
    const nome = NOME_PACOTE[d.pacote];
    const cartao = new RegExp(`<article class="pacote">(\\s*)<h4>${nome.replace(/[+]/g, '\\+')}</h4>`);
    const comSelo = d.pacote === 'completo' ? '<span class="selo">Mais completo</span>\n        ' : '';
    html = html.replace(cartao, `<article class="pacote destaque">$1${comSelo}<h4>${nome}</h4>`);
  }

  // Indicação logo após a introdução da seção de pacotes.
  const introPacotes = '<p>O contrato é mensal ou anual. No anual, a mensalidade tem 15% de desconto, com fidelidade de 12 meses.</p>';
  if (html.includes(introPacotes)) {
    html = html.replace(introPacotes, `${introPacotes}\n    <div class="info"><b>Indicação para ${cliente}:</b> ${esc(d.indicacao)}</div>`);
  }
  return html;
}
