// Leitura de extratos OFX (1.x em SGML e 2.x em XML), de conta corrente e de cartão.
// Bancos brasileiros às vezes usam vírgula decimal e omitem tags de fechamento; o leitor aceita os dois.

export type LinhaOfx = {
  fitid: string;
  data: string; // AAAA-MM-DD
  valor: number; // centavos, positivo = crédito, negativo = débito
  tipo: string | null;
  descricao: string;
  documento: string | null;
};

export type ExtratoOfx = {
  banco: string | null;
  agencia: string | null;
  conta: string | null;
  cartao: boolean;
  inicio: string | null;
  fim: string | null;
  saldo: number | null; // centavos
  dataSaldo: string | null;
  linhas: LinhaOfx[];
};

export class ErroOfx extends Error {}

function data(v: string | null): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec((v ?? '').trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** "−1.234,56", "-1234.56", "1234,5" → centavos. */
export function valorOfx(v: string | null): number | null {
  if (!v) return null;
  let s = v.trim().replace(/\s/g, '').replace(/^\+/, '');
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Valor de uma tag dentro de um trecho (funciona com ou sem tag de fechamento). */
function tag(trecho: string, nome: string): string | null {
  const m = new RegExp(`<${nome}>([^<\\r\\n]*)`, 'i').exec(trecho);
  if (!m) return null;
  const v = m[1].trim();
  return v ? decodificar(v) : null;
}

function decodificar(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function blocos(texto: string, nome: string): string[] {
  const r: string[] = [];
  const re = new RegExp(`<${nome}>([\\s\\S]*?)(?=<\\/${nome}>|<${nome}>|<\\/BANKTRANLIST>|$)`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto))) r.push(m[1]);
  return r;
}

export function lerOfx(texto: string): ExtratoOfx {
  if (!texto || !/<OFX>/i.test(texto)) throw new ErroOfx('Este arquivo não é um extrato OFX. No banco, exporte o extrato no formato OFX (às vezes chamado de "Money" ou "Quicken").');
  const corpo = texto.slice(texto.search(/<OFX>/i));
  const cartao = /<CCSTMTRS>/i.test(corpo);
  const conta = blocos(corpo, cartao ? 'CCACCTFROM' : 'BANKACCTFROM')[0] ?? '';
  const lista = blocos(corpo, 'BANKTRANLIST')[0] ?? corpo;
  const saldoBloco = blocos(corpo, 'LEDGERBAL')[0] ?? '';

  const linhas: LinhaOfx[] = [];
  const vistos = new Map<string, number>();
  for (const t of blocos(lista, 'STMTTRN')) {
    const valor = valorOfx(tag(t, 'TRNAMT'));
    const dt = data(tag(t, 'DTPOSTED')) ?? data(tag(t, 'DTUSER'));
    if (valor === null || !dt) continue;
    const nome = tag(t, 'NAME');
    const memo = tag(t, 'MEMO');
    const descricao = [nome, memo && memo !== nome ? memo : null].filter(Boolean).join(' · ') || tag(t, 'TRNTYPE') || 'Lançamento do extrato';
    // Sem FITID (ou repetido no mesmo arquivo), cria uma chave estável a partir dos dados da linha.
    let fitid = tag(t, 'FITID') ?? `${dt}|${valor}|${descricao}`;
    const n = (vistos.get(fitid) ?? 0) + 1;
    vistos.set(fitid, n);
    if (n > 1) fitid = `${fitid}#${n}`;
    linhas.push({
      fitid: fitid.slice(0, 200),
      data: dt,
      valor,
      tipo: tag(t, 'TRNTYPE'),
      descricao: descricao.replace(/\s+/g, ' ').slice(0, 300),
      documento: tag(t, 'CHECKNUM') ?? tag(t, 'REFNUM'),
    });
  }
  if (!linhas.length) throw new ErroOfx('O extrato não tem movimentações no período exportado.');
  linhas.sort((a, b) => a.data.localeCompare(b.data));
  return {
    banco: tag(conta, 'BANKID'),
    agencia: tag(conta, 'BRANCHID'),
    conta: tag(conta, 'ACCTID'),
    cartao,
    inicio: data(tag(lista, 'DTSTART')) ?? linhas[0].data,
    fim: data(tag(lista, 'DTEND')) ?? linhas[linhas.length - 1].data,
    saldo: valorOfx(tag(saldoBloco, 'BALAMT')),
    dataSaldo: data(tag(saldoBloco, 'DTASOF')),
    linhas,
  };
}

/** Sugestão de categoria para lançamentos que só aparecem no extrato (tarifas, rendimentos…). */
export function categoriaDoExtrato(descricao: string, valor: number): string | null {
  const d = descricao.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  if (valor < 0) {
    if (/\bTAR(IFA)?\b|\bTAR\.|PACOTE (DE )?SERV|CESTA|MANUT(ENCAO)? CONTA|ANUIDADE/.test(d)) return '8.2';
    if (/\bIOF\b|\bJUROS\b|\bENCARGO|\bMULTA\b|CHEQUE ESPECIAL|\bMORA\b/.test(d)) return '8.1';
    if (/\bDAS\b|SIMPLES NAC|\bDARF\b|\bGPS\b|\bINSS\b|\bFGTS\b/.test(d)) return /\bDAS\b|SIMPLES/.test(d) ? '2.1' : null;
    if (/PEDAGIO|SEM PARAR|CONECTCAR|VELOE/.test(d)) return '4.7';
    if (/\bENERGIA\b|\bENERGISA\b|\bCELPE\b|\bCEMIG\b|\bTELEFON|\bINTERNET\b|\bAGUA\b|SANEAMENTO/.test(d)) return '6.2';
  } else {
    if (/RENDIMENTO|REND\.? ?PAGO|APLIC|\bCDB\b|RESGATE/.test(d) && /REND/.test(d)) return '8.4';
  }
  return null;
}
