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

/** Condições comerciais editáveis. Valores em reais, percentuais e dias como inteiros. */
export type Condicoes = {
  validade: number;
  precoObra: number;
  precoObraGestao: number;
  precoCompleto: number;
  precoIncorporacao: number;
  implantacaoMin: number;
  implantacaoMax: number;
  usuarioAdicional: number;
  descontoAnual: number;
  fidelidade: number;
  avisoPrevio: number;
  multaAnual: number;
  diasTeste: number;
};

/** Os valores que estavam fixos no modelo. Sem parâmetros, a proposta sai como antes. */
export const CONDICOES_PADRAO: Condicoes = {
  validade: 30,
  precoObra: 379,
  precoObraGestao: 578,
  precoCompleto: 649,
  precoIncorporacao: 450,
  implantacaoMin: 2500,
  implantacaoMax: 6000,
  usuarioAdicional: 30,
  descontoAnual: 15,
  fidelidade: 12,
  avisoPrevio: 30,
  multaAnual: 30,
  diasTeste: 15,
};

// Campo, mínimo e máximo aceitos. Fora disso, a leitura recusa a condição.
const LIMITES: Array<[keyof Condicoes, number, number]> = [
  ['validade', 1, 365],
  ['precoObra', 0, 99999],
  ['precoObraGestao', 0, 99999],
  ['precoCompleto', 0, 99999],
  ['precoIncorporacao', 0, 99999],
  ['implantacaoMin', 0, 999999],
  ['implantacaoMax', 0, 999999],
  ['usuarioAdicional', 0, 99999],
  ['descontoAnual', 0, 100],
  ['fidelidade', 1, 60],
  ['avisoPrevio', 0, 365],
  ['multaAnual', 0, 100],
  ['diasTeste', 0, 365],
];

/** Lê as condições de uma query string. Campo ausente usa o padrão; campo inválido lança erro. */
export function lerCondicoes(q: Record<string, unknown>): Condicoes {
  const c: Condicoes = { ...CONDICOES_PADRAO };
  for (const [campo, min, max] of LIMITES) {
    const bruto = q[campo];
    if (bruto === undefined || bruto === '') continue;
    const n = Number(bruto);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Condição inválida: ${campo}`);
    c[campo] = n;
  }
  if (c.implantacaoMin > c.implantacaoMax) throw new Error('Implantação: o valor mínimo passa do máximo.');
  return c;
}

/** 2500 vira "2.500" (separador de milhar pt-BR). */
const moeda = (n: number) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** Troca os marcadores {{...}} do modelo pelos valores das condições. Marcador desconhecido fica como está. */
export function aplicarCondicoes(html: string, c: Condicoes = CONDICOES_PADRAO): string {
  const valores = new Map<string, string>([
    ['validade', String(c.validade)],
    ['desconto_anual', String(c.descontoAnual)],
    ['fidelidade', String(c.fidelidade)],
    ['preco_obra', moeda(c.precoObra)],
    ['preco_obra_gestao', moeda(c.precoObraGestao)],
    ['preco_completo', moeda(c.precoCompleto)],
    ['preco_incorporacao', moeda(c.precoIncorporacao)],
    ['implantacao', `${moeda(c.implantacaoMin)} a ${moeda(c.implantacaoMax)}`],
    ['usuario_adicional', moeda(c.usuarioAdicional)],
    ['aviso_previo', String(c.avisoPrevio)],
    ['multa_anual', String(c.multaAnual)],
    ['dias_teste', String(c.diasTeste)],
  ]);
  return html.replace(/\{\{(\w+)\}\}/g, (marcador, chave: string) => valores.get(chave) ?? marcador);
}

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
export function preencherProposta(
  modelo: string,
  d: DadosProposta,
  remetente: Remetente,
  data: string,
  condicoes: Condicoes = CONDICOES_PADRAO,
  linkAceite: string | null = null,
): string {
  const cliente = esc(d.empresa);
  const cnpjCliente = esc(formatarCnpjProposta(d.cnpj) ?? 'a informar');
  const cnpjAgrega = esc(formatarCnpjProposta(remetente.cnpj) ?? 'a informar');
  let html = aplicarCondicoes(modelo, condicoes)
    .replaceAll('[NOME DA CONSTRUTORA]', cliente)
    .replaceAll('[NOME DO RESPONSÁVEL]<br>[CARGO] · CNPJ [CNPJ]', `${esc(d.responsavel ?? 'a informar')}<br>CNPJ ${cnpjCliente}`)
    .replaceAll('[NOME DO REPRESENTANTE]<br>[CARGO] · CNPJ [CNPJ]', `${esc(remetente.nome)}<br>CNPJ ${cnpjAgrega}`)
    .replaceAll('[NOME DO RESPONSÁVEL], [CARGO]', esc(d.responsavel ?? 'a informar'))
    .replaceAll('[DD/MM/AAAA]', esc(data))
    .replaceAll(
      '[CONTATO COMERCIAL] · [TELEFONE] · [E-MAIL]',
      esc([remetente.nome, remetente.telefone ?? 'telefone a informar', remetente.email ?? 'e-mail a informar'].join(' · ')),
    );

  // Botão de aceite só aparece quando há link (proposta gerada pelo sistema). Sem link, a capa sai sem o botão.
  html = linkAceite
    ? html.replace('{{link_aceite}}', esc(linkAceite)).replace(/<!--\/?aceite-->/g, '')
    : html.replace(/<!--aceite-->[\s\S]*?<!--\/aceite-->\s*/, '');

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
  // Busca por expressão: o texto muda com o desconto e a fidelidade editados.
  const intro = html.match(/<p>O contrato é mensal ou anual\.[^<]*<\/p>/);
  if (intro) {
    html = html.replace(intro[0], () => `${intro[0]}\n    <div class="info"><b>Indicação para ${cliente}:</b> ${esc(d.indicacao)}</div>`);
  }
  return html;
}
