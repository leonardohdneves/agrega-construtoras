// Interpreta o texto de um PDF de nota (DANFE de NF-e, NFS-e, recibo/cupom) e o código de barras da chave.
// O resultado é um rascunho: o que não deu para ler com segurança vai na lista `conferir`.
import { cnpjValido } from './cnpj.ts';
import { acharChave, acharChaveNfse, chaveAceita, chavePlausivel, decodificarCode128, largurasDaLinha, partesDaChave, partesDaChaveNfse } from './code128.ts';
import { linhasDoTexto, type ConteudoPdf, type ItemTexto, type Linha } from './pdf.ts';
import { normalizar } from './sugestoes.ts';

export type TipoNota = 'nfe' | 'nfce' | 'nfse' | 'cte' | 'recibo' | 'cupom' | 'outro';
export type PessoaLida = { documento: string | null; nome: string | null };
export type ItemLido = { codigo: string | null; descricao: string; ncm: string | null; cfop: string | null; unidade: string | null; quantidade: number; valor: number; ref?: string | null };
export type NotaLida = {
  tipo: TipoNota;
  chaveAcesso: string | null;
  chaveVia: 'codigo_barras' | 'texto' | 'ia' | null;
  numero: string | null;
  serie: string | null;
  dataEmissao: string | null;
  emitente: PessoaLida | null;
  destinatario: PessoaLida | null;
  naturezaOperacao: string | null;
  totais: { produtos: number | null; frete: number; seguro: number; desconto: number; outras: number; ipi: number; icmsSt: number; total: number | null };
  itens: ItemLido[];
  duplicatas: { numero: string | null; vencimento: string; valor: number }[];
  informacoes: string | null;
  conferir: string[];
  avisos: string[];
  textoUtil: boolean;
};

export function notaVazia(): NotaLida {
  return {
    tipo: 'outro', chaveAcesso: null, chaveVia: null, numero: null, serie: null, dataEmissao: null, emitente: null, destinatario: null, naturezaOperacao: null,
    totais: { produtos: null, frete: 0, seguro: 0, desconto: 0, outras: 0, ipi: 0, icmsSt: 0, total: null },
    itens: [], duplicatas: [], informacoes: null, conferir: [], avisos: [], textoUtil: false,
  };
}

// ---------- Utilitários ----------
const RE_DINHEIRO = /(?<![\d,.])(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})(?![\d])/;
const RE_DATA = /(?<!\d)(\d{2})\/(\d{2})\/(\d{4})(?!\d)/;
const MESES = ['JANEIRO', 'FEVEREIRO', 'MARCO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];

export function centavos(s: string): number {
  return Math.round(Number(s.replace(/\./g, '').replace(',', '.')) * 100);
}
function numeroBr(s: string): number {
  return Number(s.replace(/\./g, '').replace(',', '.'));
}
function dataIso(d: string, m: string, a: string): string | null {
  const dia = Number(d), mes = Number(m), ano = Number(a);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || ano < 2000 || ano > 2100) return null;
  return `${a}-${m}-${d}`;
}
function primeiraData(s: string): string | null {
  const m = RE_DATA.exec(s);
  if (m) return dataIso(m[1], m[2], m[3]);
  const n = normalizar(s);
  const e = /(\d{1,2}) DE ([A-Z]+) DE (\d{4})/.exec(n);
  if (e) {
    const mes = MESES.indexOf(e[2]);
    if (mes >= 0) return dataIso(e[1].padStart(2, '0'), String(mes + 1).padStart(2, '0'), e[3]);
  }
  return null;
}
export function cpfValido(v: string): boolean {
  const c = v.replace(/\D/g, '');
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(c[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}
/** Documentos (CNPJ/CPF) válidos na ordem em que aparecem. */
function documentos(s: string): { doc: string; pos: number }[] {
  const out: { doc: string; pos: number }[] = [];
  for (const m of s.matchAll(/(?<!\d)(\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}|\d{3}\.?\d{3}\.?\d{3}-?\d{2})(?!\d)/g)) {
    const d = m[1].replace(/\D/g, '');
    if ((d.length === 14 && cnpjValido(d)) || (d.length === 11 && cpfValido(d))) out.push({ doc: d, pos: m.index });
  }
  return out;
}

/** Maiúsculas sem acento e sem pontuação, com o mesmo comprimento (os índices valem no texto original). */
function mesmoTamanho(s: string): string {
  return s.normalize('NFC').split('').map((ch) => ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, ' ').padEnd(1, ' ').slice(0, 1)).join('');
}

const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

type Ctx = { linhas: Linha[]; itens: ItemTexto[]; texto: string; norm: string };

/** Acha o rótulo (texto curto que contém a expressão) e devolve o valor logo abaixo ou à direita. */
function valorDoRotulo(ctx: Ctx, rotulos: string[], re: RegExp, opcoes: { abaixo?: boolean; direita?: boolean } = {}): string | null {
  const abaixo = opcoes.abaixo ?? true;
  const direita = opcoes.direita ?? true;
  for (const rotulo of rotulos) {
    const alvo = new RegExp(`(?<![A-Z0-9])${normalizar(rotulo).split(' ').join(' +')}(?![A-Z0-9])`);
    for (const it of ctx.itens) {
      const m0 = alvo.exec(mesmoTamanho(it.texto));
      if (!m0 || it.texto.length > m0[0].length + 40) continue;
      // No próprio pedaço, depois do rótulo ("VALOR TOTAL = R$ 3.800,00").
      if (direita) {
        const resto = it.texto.slice(m0.index + m0[0].length);
        const m = re.exec(resto);
        if (m) return m[1] ?? m[0];
        // Pedaço seguinte na mesma linha.
        const mesmaLinha = ctx.itens
          .filter((o) => o.pagina === it.pagina && Math.abs(o.y - it.y) < it.tam * 0.5 && o.x > it.x + it.w - 1 && o.x - (it.x + it.w) < 120)
          .sort((a, b) => a.x - b.x)[0];
        if (mesmaLinha && !resto.trim()) {
          const m2 = re.exec(mesmaLinha.texto);
          if (m2 && m2.index < 6) return m2[1] ?? m2[0];
        }
      }
      if (abaixo) {
        // A coluna do rótulo vai até o próximo rótulo da mesma linha (quadros do DANFE).
        const vizinho = ctx.itens
          .filter((o) => o !== it && o.pagina === it.pagina && Math.abs(o.y - it.y) < it.tam * 0.6 && o.x > it.x + 2)
          .sort((a, b) => a.x - b.x)[0];
        const limite = vizinho ? vizinho.x - 1 : it.x + Math.max(it.w, 60) + 120;
        const cands = ctx.itens.filter((o) => {
          if (o.pagina !== it.pagina || o.y >= it.y - 0.5 || it.y - o.y > Math.max(it.tam, o.tam) * 3.2 + 6 || !re.test(o.texto)) return false;
          const centro = o.x + o.w / 2;
          return centro >= it.x - 8 && centro <= limite + 4 && o.x < limite;
        });
        cands.sort((a, b) => b.y - a.y || Math.abs(a.x - it.x) - Math.abs(b.x - it.x));
        if (cands[0]) {
          const m = re.exec(cands[0].texto)!;
          return m[1] ?? m[0];
        }
      }
    }
  }
  return null;
}
function dinheiroDoRotulo(ctx: Ctx, rotulos: string[]): number | null {
  const v = valorDoRotulo(ctx, rotulos, RE_DINHEIRO);
  return v === null ? null : centavos(v);
}

/** Linhas entre um título e o próximo (para tabelas e quadros). */
function trecho(ctx: Ctx, inicio: RegExp, fim: RegExp): Linha[] {
  const out: Linha[] = [];
  let dentro = false;
  for (const l of ctx.linhas) {
    const n = normalizar(l.texto);
    if (!dentro && inicio.test(n)) {
      dentro = true;
      continue;
    }
    if (dentro && fim.test(n)) {
      dentro = false;
      continue;
    }
    if (dentro) out.push(l);
  }
  return out;
}

// ---------- Código de barras dentro do PDF ----------
function chaveDosRetangulos(c: ConteudoPdf): string | null {
  const barras = c.retangulos.filter((r) => r.h > 8 && r.w < 8 && r.h > r.w * 3);
  const grupos = new Map<string, typeof barras>();
  for (const r of barras) {
    const k = `${r.pagina}:${Math.round(r.y / 2)}:${Math.round(r.h / 2)}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(r);
  }
  for (const g of grupos.values()) {
    if (g.length < 20) continue;
    g.sort((a, b) => a.x - b.x);
    // Junta barras encostadas (alguns geradores desenham uma barra larga como várias finas).
    const unidas: { x: number; w: number }[] = [];
    for (const r of g) {
      const u = unidas[unidas.length - 1];
      if (u && r.x <= u.x + u.w + 0.02) u.w = Math.max(u.w, r.x + r.w - u.x);
      else unidas.push({ x: r.x, w: r.w });
    }
    const larg: number[] = [];
    for (let i = 0; i < unidas.length; i++) {
      larg.push(unidas[i].w);
      if (i + 1 < unidas.length) larg.push(unidas[i + 1].x - (unidas[i].x + unidas[i].w));
    }
    for (const t of [decodificarCode128(larg), decodificarCode128([...larg].reverse())]) if (t && chavePlausivel(t)) return t;
  }
  return null;
}

function chaveDasImagens(c: ConteudoPdf): string | null {
  for (const img of c.imagens) {
    if (img.filtro || img.largura < 100 || img.altura < 10 || img.bits !== 8 && img.bits !== 1) continue;
    const { largura: w, altura: h, componentes: comp } = img;
    // Converte para cinza (1 byte por pixel).
    const cinza = new Uint8Array(w * h);
    if (img.bits === 1) {
      const porLinha = Math.ceil(w / 8);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cinza[y * w + x] = (img.dados[y * porLinha + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
    } else {
      if (img.dados.length < w * h * comp) continue;
      for (let i = 0; i < w * h; i++) {
        const o = i * comp;
        cinza[i] = comp >= 3 ? (img.dados[o] * 299 + img.dados[o + 1] * 587 + img.dados[o + 2] * 114) / 1000 : img.dados[o];
      }
    }
    const passoY = Math.max(1, Math.floor(h / 120));
    for (let y = 0; y < h; y += passoY) {
      const t = decodificarCode128(largurasDaLinha(cinza, y * w, w));
      if (t && chavePlausivel(t)) return t;
    }
    const passoX = Math.max(1, Math.floor(w / 120));
    for (let x = 0; x < w; x += passoX) {
      const l = largurasDaLinha(cinza, x, h, w);
      for (const t of [decodificarCode128(l), decodificarCode128([...l].reverse())]) if (t && chavePlausivel(t)) return t;
    }
  }
  return null;
}

/** Chave de acesso lida do código de barras do PDF (desenhado em vetor ou em imagem sem compressão JPEG). */
export function chaveDoCodigoDeBarras(c: ConteudoPdf): string | null {
  return chaveDosRetangulos(c) ?? chaveDasImagens(c);
}

// ---------- Interpretação ----------
const SUFIXOS = /\b(LTDA|S A|SA|EIRELI|ME|EPP|MEI|COMERCIO|INDUSTRIA|SERVICOS|TRANSPORTES|DISTRIBUIDORA|MINERACAO|CONSTRUTORA|AUTO POSTO|POSTO)\b/;
const PALAVRAS_DANFE = /^(DANFE|NF E|DOCUMENTO AUXILIAR|NOTA FISCAL|FISCAL ELETRONICA|DA NOTA FISCAL|ELETRONICA|N \d|SERIE|FOLHA|0 ENTRADA|1 SAIDA|ENTRADA|SAIDA|CHAVE DE ACESSO|CONSULTA|PROTOCOLO|RECEBEMOS|DATA DE RECEBIMENTO|IDENTIFICACAO|IDENTIFICACAO DO EMITENTE|EMISSAO|VALOR TOTAL|DESTINATARIO)/;

function nomeEmitenteDanfe(ctx: Ctx): string | null {
  const m = /RECEBEMOS DE\s+(.+?)\s+OS PRODUTOS/i.exec(ctx.texto.replace(/\s+/g, ' '));
  if (m && m[1].length > 2 && m[1].length < 120) return m[1].trim();
  // Quadro do emitente: acima de "NATUREZA DA OPERAÇÃO", texto com cara de razão social.
  const nat = ctx.itens.find((i) => normalizar(i.texto).startsWith('NATUREZA DA OPERACAO'));
  const acima = ctx.itens.filter((i) => i.pagina === 1 && (!nat || i.y > nat.y) && /[A-Za-z]{3}/.test(i.texto) && !PALAVRAS_DANFE.test(normalizar(i.texto)) && !/\d{4}/.test(i.texto));
  const comSufixo = acima.filter((i) => SUFIXOS.test(normalizar(i.texto)));
  const escolha = (comSufixo.length ? comSufixo : acima).sort((a, b) => b.tam - a.tam || b.y - a.y)[0];
  return escolha ? escolha.texto.trim() : null;
}

function nomeDepoisDoRotulo(ctx: Ctx, secao: RegExp | null, rotulos: string[]): string | null {
  let itens = ctx.itens;
  if (secao) {
    const s = ctx.itens.find((i) => secao.test(normalizar(i.texto)));
    if (!s) return null;
    itens = ctx.itens.filter((i) => i.pagina > s.pagina || (i.pagina === s.pagina && i.y < s.y + 1));
  }
  const sub: Ctx = { ...ctx, itens: [...itens].sort((a, b) => a.pagina - b.pagina || b.y - a.y || a.x - b.x) };
  const v = valorDoRotulo(sub, rotulos, /[:\s]*([A-ZÀ-Ú0-9][^:]{2,120}?)\s*(?:CPF|CNPJ|$)/i);
  return v ? v.replace(/^[:\s-]+/, '').trim() : null;
}

function itensDanfe(ctx: Ctx): ItemLido[] {
  const out: ItemLido[] = [];
  const RE = /^(\S+)\s+(.+?)\s+(\d{8}|\d{4}\.\d{2}\.\d{2}|\d{2})\s+(\d{1,4}(?:\/\d{1,3})?)\s+(\d{4}|\d\.\d{3})\s+([A-Za-z][A-Za-z0-9./]{0,6})\s+([\d.]*\d,\d{1,4}|\d+)\s+([\d.]*\d,\d{2,10})\s+([\d.]*\d,\d{2})(?:\s|$)/;
  let cabecalho = false;
  let ultimo: ItemLido | null = null;
  for (const l of ctx.linhas) {
    const n = normalizar(l.texto);
    if (/DESCRI/.test(n) && (/\bNCM\b/.test(n) || /\bQUANT/.test(n)) && /\bCFOP\b|\bUN\b|\bVALOR\b|\bV UNIT/.test(n)) {
      cabecalho = true;
      ultimo = null;
      continue;
    }
    if (!cabecalho) continue;
    if (/^(DADOS ADICIONAIS|CALCULO DO ISSQN|INFORMACOES COMPLEMENTARES|RESERVADO AO FISCO|DADOS DO PRODUTO|DADOS DOS PRODUTOS)/.test(n)) {
      cabecalho = false;
      ultimo = null;
      continue;
    }
    const t = l.texto.replace(/\s+/g, ' ').trim();
    const m = RE.exec(t);
    if (m) {
      ultimo = {
        codigo: m[1],
        descricao: m[2].trim(),
        ncm: m[3].replace(/\D/g, '').length === 8 ? m[3].replace(/\D/g, '') : null,
        cfop: m[5].replace(/\D/g, ''),
        unidade: m[6].toUpperCase(),
        quantidade: numeroBr(m[7]),
        valor: centavos(m[9]),
      };
      out.push(ultimo);
    } else if (ultimo && !RE_DINHEIRO.test(t) && t.length < 120 && l.itens.length <= 2) {
      // Continuação da descrição na linha de baixo.
      ultimo.descricao = `${ultimo.descricao} ${t}`.slice(0, 2000);
    } else if (out.length) ultimo = null;
  }
  return out;
}

function duplicatasDanfe(ctx: Ctx): { numero: string | null; vencimento: string; valor: number }[] {
  const linhas = trecho(ctx, /^(FATURA|FATURAS|FATURA DUPLICATAS|FATURA DUPLICATA|DUPLICATAS|PAGAMENTO)\b/, /^(CALCULO DO IMPOSTO|IMPOSTO|TRANSPORTADOR|DADOS DO|DADOS DOS)/);
  const texto = linhas.map((l) => l.texto).join('   ');
  const out: { numero: string | null; vencimento: string; valor: number }[] = [];
  const re = /(?:(?:N[UÚ]M\.?|N[º°o]\.?|DUP\.?)?\s*([0-9A-Z][0-9A-Z/-]{0,11})\s+)?(?:VENC(?:IMENTO|\.)?:?\s*)?(\d{2})\/(\d{2})\/(\d{4})\s+(?:VALOR:?\s*)?(?:R\$\s*)?(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/gi;
  for (const m of texto.matchAll(re)) {
    const venc = dataIso(m[2], m[3], m[4]);
    if (venc) out.push({ numero: m[1] && !/^(R|VALOR|VENC)/i.test(m[1]) ? m[1] : null, vencimento: venc, valor: centavos(m[5]) });
  }
  return out;
}

function detectarTipo(norm: string, chave: string | null): TipoNota {
  if (chave?.slice(20, 22) === '65' || /\bNFC E\b|DANFE NFC|CUPOM FISCAL ELETRONICO/.test(norm)) return 'nfce';
  if (chave?.slice(20, 22) === '57' || /\bDACTE\b/.test(norm)) return 'cte';
  if (/\bNFS E\b|NOTA FISCAL DE SERVICOS? ELETRONICA|NOTA FISCAL ELETRONICA DE SERVICOS?|DANFSE|PRESTADOR DE SERVICOS?/.test(norm)) return 'nfse';
  if (chave || /\bDANFE\b|DOCUMENTO AUXILIAR DA NOTA FISCAL ELETRONICA/.test(norm)) return 'nfe';
  if (/\bRECIBO\b/.test(norm)) return 'recibo';
  if (/\bCUPOM\b/.test(norm)) return 'cupom';
  return 'outro';
}

/**
 * Lê os dados da nota a partir do conteúdo do PDF.
 * `chaveExterna`: chave já lida pelo celular/pistola ou na imagem do PDF no navegador.
 */
export function interpretarNotaPdf(c: ConteudoPdf, opcoes: { chaveExterna?: string | null; cnpjEmpresa?: string | null } = {}): NotaLida {
  const n = notaVazia();
  const linhas = linhasDoTexto(c.itens);
  const texto = linhas.map((l) => l.texto).join('\n');
  const ctx: Ctx = { linhas, itens: linhas.flatMap((l) => l.itens), texto, norm: normalizar(texto) };
  n.textoUtil = ctx.norm.replace(/\s/g, '').length >= 40;
  const empresa = (opcoes.cnpjEmpresa ?? '').replace(/\D/g, '');

  // Chave: código de barras (fora ou dentro do PDF) e texto.
  const externa = opcoes.chaveExterna && chaveAceita(opcoes.chaveExterna) ? opcoes.chaveExterna : null;
  const barras = externa ?? chaveDoCodigoDeBarras(c);
  const doTexto = acharChave(texto) ?? acharChaveNfse(texto);
  n.chaveAcesso = barras ?? doTexto;
  n.chaveVia = barras ? 'codigo_barras' : doTexto ? 'texto' : null;
  if (barras && doTexto && barras !== doTexto) n.avisos.push('A chave do código de barras é diferente da chave impressa. Vale a do código de barras; confira a nota.');
  const partes = n.chaveAcesso ? partesDaChave(n.chaveAcesso) : null;
  const partesNfse = n.chaveAcesso ? partesDaChaveNfse(n.chaveAcesso) : null;
  n.tipo = partesNfse ? 'nfse' : detectarTipo(ctx.norm, n.chaveAcesso);
  if (!n.textoUtil && !n.chaveAcesso) return n;

  // Pessoas.
  const docs = documentos(texto);
  if (n.tipo === 'nfe' || n.tipo === 'nfce' || n.tipo === 'cte') {
    let emitDoc = partes?.documento ?? null;
    if (emitDoc && !cnpjValido(emitDoc)) emitDoc = cpfValido(emitDoc.slice(3)) ? emitDoc.slice(3) : null;
    if (!emitDoc) emitDoc = docs[0]?.doc ?? null;
    const dest = docs.find((d) => d.doc !== emitDoc)?.doc ?? null;
    const emitidaPelaEmpresa = !!empresa && emitDoc === empresa;
    n.emitente = { documento: emitDoc, nome: emitidaPelaEmpresa ? null : nomeEmitenteDanfe(ctx) };
    n.destinatario = { documento: dest, nome: valorDoRotulo(ctx, ['NOME / RAZAO SOCIAL', 'NOME RAZAO SOCIAL', 'RAZAO SOCIAL'], /^\s*([A-ZÀ-Ú0-9][^]{2,120})$/i) };
  } else if (n.tipo === 'nfse') {
    // Layout municipal ("PRESTADOR DE SERVIÇOS") ou nacional/DANFSe ("EMITENTE DA NFS-e").
    const prest = ctx.norm.search(/PRESTADOR|EMITENTE DA NFS E/);
    const tom = ctx.norm.search(/TOMADOR/);
    const posNorm = (pos: number) => normalizar(texto.slice(0, pos)).length;
    const prestDoc =
      partesNfse?.documento ?? docs.find((d) => prest >= 0 && posNorm(d.pos) >= prest && (tom < prest || posNorm(d.pos) < tom))?.doc ?? docs[0]?.doc ?? null;
    const tomDoc = docs.find((d) => tom >= 0 && posNorm(d.pos) >= tom && d.doc !== prestDoc)?.doc ?? null;
    // O prestador nunca é a própria empresa numa nota de compra de serviço.
    const prestador = prestDoc && prestDoc === empresa && tom >= 0 ? docs.find((d) => d.doc !== empresa)?.doc ?? null : prestDoc;
    n.emitente = { documento: prestador, nome: nomeDepoisDoRotulo(ctx, /PRESTADOR|EMITENTE DA NFS E/, ['NOME / NOME EMPRESARIAL', 'NOME NOME EMPRESARIAL', 'NOME EMPRESARIAL', 'NOME/RAZAO SOCIAL', 'NOME RAZAO SOCIAL', 'RAZAO SOCIAL', 'NOME']) };
    n.destinatario = { documento: tomDoc, nome: nomeDepoisDoRotulo(ctx, /TOMADOR/, ['NOME / NOME EMPRESARIAL', 'NOME NOME EMPRESARIAL', 'NOME EMPRESARIAL', 'NOME/RAZAO SOCIAL', 'NOME RAZAO SOCIAL', 'RAZAO SOCIAL', 'NOME']) };
  } else {
    const outro = docs.find((d) => d.doc !== empresa)?.doc ?? null;
    const daEmpresa = docs.find((d) => d.doc === empresa)?.doc ?? null;
    const nomeEmit = /EMITENTE:?\s*([A-ZÀ-Ú][A-ZÀ-Ú .'-]{3,80}?)(?:\s*[-–,]\s*(?:CPF|CNPJ)|\s*$)/im.exec(texto)?.[1] ?? null;
    n.emitente = { documento: outro, nome: nomeEmit?.trim() ?? null };
    n.destinatario = daEmpresa ? { documento: daEmpresa, nome: null } : null;
  }

  // Número, série, data.
  if (partes) {
    n.numero = partes.numero;
    n.serie = partes.serie;
  } else if (n.tipo === 'nfse') {
    n.numero = valorDoRotulo(ctx, ['NUMERO DA NOTA', 'NUMERO DA NFS E', 'NUMERO DA NFSE', 'NUMERO NFSE', 'N NFS E', 'N DA NFS E', 'NUMERO NFS E', 'NFS E N', 'N DA NOTA', 'NUMERO'], /(\d[\d./-]{0,18}\d|\d)/);
  } else {
    const m = /\bN[º°o.]?\s*:?\s*([\d.]{1,15})\b/.exec(texto);
    n.numero = m ? String(Number(m[1].replace(/\./g, ''))) : null;
  }
  const rotulosData = n.tipo === 'nfse'
    ? ['DATA E HORA DE EMISSAO', 'DATA E HORA DA EMISSAO', 'DATA DE EMISSAO', 'DATA DA EMISSAO', 'EMISSAO', 'EMITIDA EM']
    : ['DATA DA EMISSAO', 'DATA DE EMISSAO', 'EMISSAO'];
  const dataRot = valorDoRotulo(ctx, rotulosData, /(?<!\d)(\d{2}\/\d{2}\/\d{4})(?!\d)/);
  const dataM = dataRot ? RE_DATA.exec(dataRot) : null;
  n.dataEmissao = dataM ? dataIso(dataM[1], dataM[2], dataM[3]) : null;
  if (!n.dataEmissao) {
    n.dataEmissao = primeiraData(texto);
    if (n.dataEmissao) n.conferir.push('dataEmissao');
  }
  if (n.dataEmissao && partes && n.dataEmissao.slice(0, 7) !== partes.anoMes) n.conferir.push('dataEmissao');
  if (!n.numero && partesNfse) n.numero = partesNfse.numero;
  if (n.dataEmissao && partesNfse && n.dataEmissao.slice(0, 7) !== partesNfse.anoMes) n.conferir.push('dataEmissao');
  if (!n.dataEmissao && (partes || partesNfse)) {
    n.dataEmissao = `${(partes ?? partesNfse)!.anoMes}-01`;
    n.conferir.push('dataEmissao');
  }
  n.naturezaOperacao = valorDoRotulo(ctx, ['NATUREZA DA OPERACAO'], /^\s*([A-ZÀ-Ú][^]{2,80})$/i);

  // Valores e itens.
  if (n.tipo === 'nfse') {
    const bruto = dinheiroDoRotulo(ctx, [
      'VALOR TOTAL DO SERVICO', 'VALOR TOTAL DOS SERVICOS', 'VALOR DOS SERVICOS', 'VALOR DO SERVICO', 'VALOR SERVICO', 'VALOR SERVICOS', 'VALOR TOTAL DA NOTA',
      'VALOR TOTAL DA NFS E', 'VALOR DA NFS E', 'VALOR BRUTO', 'VALOR DA NOTA', 'TOTAL DO SERVICO', 'TOTAL DOS SERVICOS', 'VALOR TOTAL', 'TOTAL DA NOTA',
    ]);
    const liquido = dinheiroDoRotulo(ctx, ['VALOR LIQUIDO DA NOTA', 'VALOR LIQUIDO DA NFS E', 'VALOR LIQUIDO DA NFSE', 'VALOR LIQUIDO', 'LIQUIDO A PAGAR', 'TOTAL LIQUIDO']);
    let base = bruto ?? liquido;
    if (!base) {
      // Último recurso: o maior valor em linhas que falam de valor/total (fora alíquotas e impostos).
      const cands = ctx.linhas
        .filter((l) => /\b(VALOR|TOTAL)\b/.test(normalizar(l.texto)) && !/ALIQUOTA|\bISS\b|ISSQN|\bIR\b|INSS|PIS|COFINS|CSLL|BASE DE CALCULO|DEDUC/.test(normalizar(l.texto)))
        .flatMap((l) => [...l.texto.matchAll(new RegExp(RE_DINHEIRO.source, 'g'))].map((m) => centavos(m[1])));
      if (cands.length) {
        base = Math.max(...cands);
        n.conferir.push('total');
      }
    }
    const disc = trecho(ctx, /^DISCRIMINACAO|^DESCRICAO DOS? SERVICOS?|^DESCRICAO DO SERVICO|^SERVICOS? PRESTADOS?/, /^(VALOR|CODIGO DO SERVICO|CODIGO DE TRIBUTACAO|ITEM DA LISTA|DEDUCOES|BASE DE CALCULO|TRIBUTOS|TRIBUTACAO|OUTRAS INFORMACOES|INFORMACOES|AVISO|RETENCOES|NBS|LOCAL DA PRESTACAO|MUNICIPIO DE INCIDENCIA)/)
      .map((l) => l.texto.trim())
      .filter((t) => !/^VALOR/i.test(t))
      .join(' ')
      .slice(0, 2000);
    if (base) {
      n.totais.produtos = base;
      n.itens = [{ codigo: null, descricao: disc || `Serviço · NFS-e ${n.numero ?? ''}`.trim(), ncm: null, cfop: null, unidade: 'SV', quantidade: 1, valor: base }];
      if (!disc) n.conferir.push('itens');
      if (bruto && liquido && liquido < bruto) {
        n.totais.desconto = bruto - liquido;
        n.avisos.push(`Retenções da nota (ISS, IR, INSS…) de ${reais(bruto - liquido)} lançadas como desconto: o valor a pagar ao prestador é o líquido, ${reais(liquido)}.`);
      }
      n.totais.total = base - n.totais.desconto;
    }
  } else if (n.tipo === 'recibo' || n.tipo === 'cupom' || n.tipo === 'outro') {
    const v = dinheiroDoRotulo(ctx, ['VALOR TOTAL', 'TOTAL A PAGAR', 'VALOR', 'TOTAL', 'IMPORTANCIA']) ?? (RE_DINHEIRO.exec(texto) ? centavos(RE_DINHEIRO.exec(texto)![1]) : null);
    const ref = /REFERENTE (?:A|AO|AOS|AS|À)?\s*([^.\n]{3,200})/i.exec(texto.replace(/\n/g, ' '))?.[1];
    if (v) {
      n.totais.produtos = v;
      n.totais.total = v;
      n.itens = [{ codigo: null, descricao: ref ? ref.trim().replace(/^./, (x) => x.toUpperCase()) : `${n.tipo === 'recibo' ? 'Recibo' : 'Documento'}${n.emitente?.nome ? ` · ${n.emitente.nome}` : ''}`, ncm: null, cfop: null, unidade: null, quantidade: 1, valor: v }];
      if (!ref) n.conferir.push('itens');
    }
  } else {
    const t = n.totais;
    t.produtos = dinheiroDoRotulo(ctx, ['VALOR TOTAL DOS PRODUTOS', 'V TOTAL PRODUTOS', 'VALOR TOTAL PRODUTOS', 'V TOTAL DOS PRODUTOS', 'TOTAL DOS PRODUTOS', 'VALOR DOS PRODUTOS']);
    t.frete = dinheiroDoRotulo(ctx, ['VALOR DO FRETE', 'V FRETE', 'VALOR FRETE']) ?? 0;
    t.seguro = dinheiroDoRotulo(ctx, ['VALOR DO SEGURO', 'V SEGURO', 'VALOR SEGURO']) ?? 0;
    t.desconto = dinheiroDoRotulo(ctx, ['VALOR DO DESCONTO', 'V DESCONTO', 'DESCONTO']) ?? 0;
    t.outras = dinheiroDoRotulo(ctx, ['OUTRAS DESPESAS ACESSORIAS', 'OUTRAS DESPESAS', 'OUTRAS DESP', 'V OUTRAS DESP', 'DESPESAS ACESSORIAS']) ?? 0;
    t.ipi = dinheiroDoRotulo(ctx, ['VALOR TOTAL DO IPI', 'VALOR DO IPI', 'VALOR TOTAL IPI', 'V TOTAL IPI', 'V IPI']) ?? 0;
    t.icmsSt = dinheiroDoRotulo(ctx, ['VALOR DO ICMS SUBST', 'VALOR DO ICMS SUBSTITUICAO', 'VALOR DO ICMS ST', 'V ICMS SUBST', 'VALOR ICMS SUBST', 'V ICMS ST']) ?? 0;
    t.total = dinheiroDoRotulo(ctx, ['VALOR TOTAL DA NOTA', 'V TOTAL DA NOTA', 'VALOR TOTAL DA NF', 'V TOTAL NOTA', 'TOTAL DA NOTA', 'VALOR TOTAL']);
    const itens = itensDanfe(ctx);
    const soma = itens.reduce((s, i) => s + i.valor, 0);
    if (t.produtos === null && t.total !== null) t.produtos = t.total - t.frete - t.seguro - t.outras - t.ipi - t.icmsSt + t.desconto;
    if (itens.length) {
      // Os itens entram sempre como estão na nota; se a soma não bate, o usuário corrige os valores.
      n.itens = itens;
      if (t.produtos === null) t.produtos = soma;
      // A conferência da soma (com descontos e acréscimos) é feita em completarLeitura.
    } else if (t.produtos) {
      n.itens = [{ codigo: null, descricao: `Produtos da NF ${n.numero ?? ''}${n.emitente?.nome ? ` · ${n.emitente.nome}` : ''}`.replace(/\s+/g, ' ').trim(), ncm: null, cfop: null, unidade: null, quantidade: 1, valor: t.produtos }];
      n.conferir.push('itens');
    }
    if (t.total === null && t.produtos !== null) {
      t.total = t.produtos + t.frete + t.seguro + t.outras + t.ipi + t.icmsSt - t.desconto;
      n.conferir.push('total');
    } else if (t.total !== null && t.produtos !== null && t.produtos + t.frete + t.seguro + t.outras + t.ipi + t.icmsSt - t.desconto !== t.total) {
      n.conferir.push('total');
    }
    const dups = duplicatasDanfe(ctx);
    if (dups.length && t.total !== null && dups.reduce((s, d) => s + d.valor, 0) === t.total) n.duplicatas = dups;
    else if (dups.length) n.avisos.push('As parcelas da fatura não fecharam com o total; confira os vencimentos.');
    const inf = /INFORMACOES COMPLEMENTARES:?\s*/i;
    const iInf = linhas.findIndex((l) => inf.test(normalizar(l.texto)));
    if (iInf >= 0) {
      const resto = linhas[iInf].texto.replace(/^.*?INFORMA[ÇC][ÕO]ES COMPLEMENTARES:?\s*/i, '');
      n.informacoes = [resto, ...linhas.slice(iInf + 1, iInf + 4).map((l) => l.texto)].join(' ').trim().slice(0, 1000) || null;
    }
  }
  if (!n.emitente?.nome && !(empresa && n.emitente?.documento === empresa)) n.conferir.push('fornecedor');
  n.conferir = [...new Set(n.conferir)];
  return n;
}

/** Tem o mínimo para virar rascunho sem ajuda da IA? */
export function leituraSuficiente(n: NotaLida): boolean {
  return !!(n.totais.total && n.totais.total > 0 && n.dataEmissao && n.emitente?.documento && n.itens.length);
}

function avisoSoma(n: NotaLida, soma: number, produtos: number) {
  n.avisos.push(
    `A soma dos itens lidos (${reais(soma)}) é diferente do valor dos produtos na nota (${reais(produtos)}). Os itens foram listados como estão na nota: confira e corrija os valores (coluna "valor total" de cada item) antes de confirmar.`,
  );
  n.conferir.push('itens');
}

/** Fecha a leitura (da IA ou do leitor): valor dos produtos, item único quando não há itens, total e parcelas. */
export function completarLeitura(n: NotaLida): NotaLida {
  const t = n.totais;
  const soma = n.itens.reduce((s, i) => s + i.valor, 0);
  const acrescimos = t.frete + t.seguro + t.outras + t.ipi + t.icmsSt;
  const tol = Math.max(1, n.itens.length);
  if (n.itens.length && t.total !== null && Math.abs(soma + acrescimos - t.desconto - t.total) > tol) {
    // Itens + acréscimos − descontos não dão o total da nota.
    const diferenca = soma + acrescimos - t.desconto - t.total;
    const itensBatemProdutos = t.produtos === null || Math.abs(t.produtos - soma) <= tol;
    if (diferenca > 0 && t.desconto === 0 && itensBatemProdutos) {
      // A nota tem desconto que não foi lido: a diferença é o desconto.
      t.desconto = diferenca;
      n.avisos.push(
        `Os itens somam ${reais(soma)} e o total da nota é ${reais(t.total)}: a diferença de ${reais(diferenca)} foi lançada como desconto. Confira o campo desconto da nota.`,
      );
      n.conferir.push('total');
    } else if (itensBatemProdutos) {
      n.avisos.push(
        `Os itens somam ${reais(soma)}, mas produtos + acréscimos − descontos lidos (${reais(soma + acrescimos - t.desconto)}) não dão o total da nota (${reais(t.total)}). Confira frete, desconto e outras despesas em "Dados do documento".`,
      );
      n.conferir.push('total');
    } else avisoSoma(n, soma, t.produtos ?? t.total);
  } else if (n.itens.length && t.total === null && t.produtos !== null && Math.abs(soma - t.produtos) > tol) avisoSoma(n, soma, t.produtos);
  if (n.itens.length) t.produtos = soma;
  const extras = acrescimos - t.desconto;
  if (t.produtos === null && t.total !== null) t.produtos = t.total - extras;
  if (!n.itens.length && t.produtos && t.produtos > 0) {
    const nome = n.emitente?.nome ? ` · ${n.emitente.nome}` : '';
    const rotulo = n.tipo === 'nfse' ? 'Serviço' : n.tipo === 'recibo' ? 'Recibo' : 'Produtos';
    n.itens = [{ codigo: null, descricao: `${rotulo}${n.numero ? ` da nota ${n.numero}` : ''}${nome}`.slice(0, 300), ncm: null, cfop: null, unidade: null, quantidade: 1, valor: t.produtos }];
    n.conferir.push('itens');
  }
  if (t.total === null && t.produtos !== null) {
    t.total = t.produtos + extras;
    n.conferir.push('total');
  }
  if (n.duplicatas.length && n.duplicatas.reduce((s, d) => s + d.valor, 0) !== t.total) {
    n.avisos.push('As parcelas lidas não fecharam com o total; confira os vencimentos.');
    n.duplicatas = [];
  }
  n.conferir = [...new Set(n.conferir)];
  return n;
}

/** Usa a chave de acesso para preencher o que faltou: número, série, emitente e mês de emissão. */
export function completarPelaChave(n: NotaLida): NotaLida {
  const ps = n.chaveAcesso ? partesDaChaveNfse(n.chaveAcesso) : null;
  if (ps) {
    n.tipo = 'nfse';
    n.numero ??= ps.numero;
    const d = cnpjValido(ps.documento) || cpfValido(ps.documento) ? ps.documento : null;
    if (d && !n.emitente?.documento) n.emitente = { documento: d, nome: n.emitente?.nome ?? null };
    if (!n.dataEmissao) {
      n.dataEmissao = `${ps.anoMes}-01`;
      n.conferir.push('dataEmissao');
    }
    n.conferir = [...new Set(n.conferir)];
    return n;
  }
  const p = n.chaveAcesso ? partesDaChave(n.chaveAcesso) : null;
  if (!p) return n;
  if (n.tipo === 'outro' || n.tipo === 'recibo' || n.tipo === 'cupom') n.tipo = p.modelo === '65' ? 'nfce' : p.modelo === '57' ? 'cte' : 'nfe';
  n.numero ??= p.numero;
  n.serie ??= p.serie;
  const doc = cnpjValido(p.documento) ? p.documento : cpfValido(p.documento.slice(3)) ? p.documento.slice(3) : null;
  if (doc && !n.emitente?.documento) n.emitente = { documento: doc, nome: n.emitente?.nome ?? null };
  if (!n.dataEmissao) {
    n.dataEmissao = `${p.anoMes}-01`;
    n.conferir.push('dataEmissao');
  }
  n.conferir = [...new Set(n.conferir)];
  return n;
}
