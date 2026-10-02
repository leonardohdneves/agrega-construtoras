// Leitura do XML da NF-e (modelo 55) e da NFC-e (modelo 65), layout 4.00.
// Sem dependências: o XML da nota é regular, então um leitor simples de tags basta.

export type No = { nome: string; atributos: Record<string, string>; filhos: No[]; texto: string };

const ENTIDADES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodificar(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTIDADES[e.toLowerCase()] ?? m;
  });
}

/** Lê o XML numa árvore de nós. Ignora prefixos de namespace, comentários e instruções. */
export function lerXml(xml: string): No {
  const raiz: No = { nome: '#raiz', atributos: {}, filhos: [], texto: '' };
  const pilha: No[] = [raiz];
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/\s*([^\s>]+)\s*>|<\s*([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const atual = pilha[pilha.length - 1];
    if (m[1] !== undefined) atual.texto += m[1];
    else if (m[2]) {
      const nome = m[2].replace(/^.*:/, '');
      // Fecha até achar a tag correspondente (tolera XML levemente malformado).
      for (let i = pilha.length - 1; i > 0; i--) {
        if (pilha[i].nome === nome) {
          pilha.length = i;
          break;
        }
      }
    } else if (m[3]) {
      const no: No = { nome: m[3].replace(/^.*:/, ''), atributos: {}, filhos: [], texto: '' };
      const ra = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let a: RegExpExecArray | null;
      while ((a = ra.exec(m[4] ?? ''))) no.atributos[a[1].replace(/^.*:/, '')] = decodificar(a[2] ?? a[3] ?? '');
      atual.filhos.push(no);
      if (!m[5]) pilha.push(no);
    } else if (m[6] !== undefined && m[0][0] !== '<') {
      atual.texto += decodificar(m[6]);
    }
  }
  return raiz;
}

/** Primeiro descendente com o caminho dado (ex.: 'infNFe/ide/nNF'). */
export function achar(no: No | undefined, caminho: string): No | undefined {
  if (!no) return undefined;
  const [primeiro, ...resto] = caminho.split('/');
  const busca = (n: No): No | undefined => {
    for (const f of n.filhos) {
      if (f.nome === primeiro) return f;
      const x = busca(f);
      if (x) return x;
    }
    return undefined;
  };
  let atual = busca(no);
  for (const parte of resto) {
    if (!atual) return undefined;
    atual = atual.filhos.find((f) => f.nome === parte);
  }
  return atual;
}

const txt = (no: No | undefined, caminho?: string): string | null => {
  const n = caminho ? achar(no, caminho) : no;
  const t = n?.texto.trim();
  return t ? t : null;
};
const centavos = (v: string | null): number => (v ? Math.round(Number(v) * 100) : 0);

/** Soma um campo em qualquer grupo filho (ex.: vICMSST dentro de ICMS00, ICMS10…). */
function somaEmQualquer(no: No | undefined, nome: string): number {
  if (!no) return 0;
  let s = 0;
  const visita = (n: No) => {
    for (const f of n.filhos) {
      if (f.nome === nome) s += centavos(f.texto.trim());
      else visita(f);
    }
  };
  visita(no);
  return s;
}

export type ItemNfe = {
  numeroItem: number;
  codigoProduto: string | null;
  descricao: string;
  ncm: string | null;
  cfop: string | null;
  unidade: string | null;
  quantidade: number;
  valorUnitario: number; // centavos (pode ter fração)
  valorProduto: number; // centavos
  desconto: number;
  frete: number;
  seguro: number;
  outras: number;
  ipi: number;
  icmsSt: number;
  valorCusto: number; // quanto o item custou de fato (produto + frete + IPI + ST… − desconto)
};

export type Duplicata = { numero: string | null; vencimento: string; valor: number };

export type NotaNfe = {
  chaveAcesso: string | null;
  modelo: 'nfe' | 'nfce';
  numero: string | null;
  serie: string | null;
  dataEmissao: string; // AAAA-MM-DD
  tipoOperacao: 'entrada' | 'saida'; // do ponto de vista do emitente
  naturezaOperacao: string | null;
  emitente: Pessoa;
  destinatario: Pessoa | null;
  itens: ItemNfe[];
  duplicatas: Duplicata[];
  totais: { produtos: number; frete: number; seguro: number; desconto: number; outras: number; ipi: number; icmsSt: number; total: number };
  formasPagamento: string[];
  informacoes: string | null;
  autorizada: boolean | null; // null: XML sem protocolo
};

export type Pessoa = { documento: string | null; tipoPessoa: 'PJ' | 'PF'; nome: string; fantasia: string | null; cidade: string | null; uf: string | null; telefone: string | null; email: string | null };

function pessoa(no: No | undefined, ender: string): Pessoa | null {
  if (!no) return null;
  const cnpj = txt(no, 'CNPJ');
  const cpf = txt(no, 'CPF');
  const nome = txt(no, 'xNome');
  if (!cnpj && !cpf && !nome) return null;
  return {
    documento: cnpj ?? cpf,
    tipoPessoa: cpf && !cnpj ? 'PF' : 'PJ',
    nome: nome ?? '(sem nome)',
    fantasia: txt(no, 'xFant'),
    cidade: txt(no, `${ender}/xMun`),
    uf: txt(no, `${ender}/UF`),
    telefone: txt(no, `${ender}/fone`),
    email: txt(no, 'email'),
  };
}

export class ErroNfe extends Error {}

/** Distribui a diferença de centavos no maior item, para a soma dos itens bater com o total da nota. */
export function fecharCentavos(valores: number[], total: number): number[] {
  const r = [...valores];
  const dif = total - r.reduce((s, v) => s + v, 0);
  if (dif && r.length) {
    let maior = 0;
    for (let i = 1; i < r.length; i++) if (r[i] > r[maior]) maior = i;
    r[maior] += dif;
  }
  return r;
}

export function lerNfe(xml: string): NotaNfe {
  if (!xml || xml.length < 50) throw new ErroNfe('Arquivo vazio.');
  if (!/<\s*(?:\w+:)?infNFe[\s>]/.test(xml)) {
    if (/CompNfse|Nfse|infNFSe|InfNfse/i.test(xml)) throw new ErroNfe('Este XML é de nota de serviço (NFS-e). Por enquanto a importação aceita NF-e e NFC-e; lance a NFS-e à mão.');
    throw new ErroNfe('Este arquivo não é o XML de uma NF-e.');
  }
  const raiz = lerXml(xml);
  const inf = achar(raiz, 'infNFe');
  if (!inf) throw new ErroNfe('Não encontrei os dados da nota no XML.');
  const ide = achar(inf, 'ide');
  const mod = txt(ide, 'mod');
  const emissao = (txt(ide, 'dhEmi') ?? txt(ide, 'dEmi') ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(emissao)) throw new ErroNfe('Data de emissão não encontrada no XML.');
  const idAttr = inf.atributos.Id ?? '';
  const chave = (txt(raiz, 'protNFe/infProt/chNFe') ?? idAttr.replace(/^NFe/, '')).replace(/\D/g, '');

  const itens: ItemNfe[] = [];
  for (const det of inf.filhos.filter((f) => f.nome === 'det')) {
    const prod = achar(det, 'prod');
    const imposto = achar(det, 'imposto');
    const valorProduto = centavos(txt(prod, 'vProd'));
    const desconto = centavos(txt(prod, 'vDesc'));
    const frete = centavos(txt(prod, 'vFrete'));
    const seguro = centavos(txt(prod, 'vSeg'));
    const outras = centavos(txt(prod, 'vOutro'));
    const ipi = centavos(txt(achar(imposto, 'IPI'), 'IPITrib/vIPI'));
    const icmsSt = somaEmQualquer(achar(imposto, 'ICMS'), 'vICMSST') + somaEmQualquer(achar(imposto, 'ICMS'), 'vFCPST');
    const qtd = Number(txt(prod, 'qCom') ?? '0') || 0;
    itens.push({
      numeroItem: Number(det.atributos.nItem) || itens.length + 1,
      codigoProduto: txt(prod, 'cProd'),
      descricao: txt(prod, 'xProd') ?? `Item ${itens.length + 1}`,
      ncm: txt(prod, 'NCM'),
      cfop: txt(prod, 'CFOP'),
      unidade: txt(prod, 'uCom'),
      quantidade: qtd,
      valorUnitario: Number(txt(prod, 'vUnCom') ?? '0') * 100,
      valorProduto,
      desconto,
      frete,
      seguro,
      outras,
      ipi,
      icmsSt,
      valorCusto: valorProduto - desconto + frete + seguro + outras + ipi + icmsSt,
    });
  }
  if (!itens.length) throw new ErroNfe('A nota não tem itens.');

  const tot = achar(inf, 'total/ICMSTot');
  const totais = {
    produtos: centavos(txt(tot, 'vProd')),
    frete: centavos(txt(tot, 'vFrete')),
    seguro: centavos(txt(tot, 'vSeg')),
    desconto: centavos(txt(tot, 'vDesc')),
    outras: centavos(txt(tot, 'vOutro')),
    ipi: centavos(txt(tot, 'vIPI')),
    icmsSt: centavos(txt(tot, 'vST')) + centavos(txt(tot, 'vFCPST')),
    total: centavos(txt(tot, 'vNF')),
  };
  if (!totais.total) totais.total = itens.reduce((s, i) => s + i.valorCusto, 0);
  // Frete ou desconto informados só no total: distribui pelos itens na proporção do valor.
  const somaItens = itens.reduce((s, i) => s + i.valorCusto, 0);
  if (somaItens !== totais.total && somaItens > 0) {
    const fator = totais.total / somaItens;
    const ajustados = fecharCentavos(itens.map((i) => Math.round(i.valorCusto * fator)), totais.total);
    itens.forEach((i, k) => (i.valorCusto = ajustados[k]));
  }

  const duplicatas: Duplicata[] = [];
  for (const dup of achar(inf, 'cobr')?.filhos.filter((f) => f.nome === 'dup') ?? []) {
    const venc = txt(dup, 'dVenc');
    const valor = centavos(txt(dup, 'vDup'));
    if (venc && valor > 0) duplicatas.push({ numero: txt(dup, 'nDup'), vencimento: venc.slice(0, 10), valor });
  }

  const formasPagamento: string[] = [];
  for (const det of achar(inf, 'pag')?.filhos.filter((f) => f.nome === 'detPag') ?? []) {
    const t = txt(det, 'tPag');
    if (t) formasPagamento.push(t);
  }

  const cStat = txt(raiz, 'protNFe/infProt/cStat');
  return {
    chaveAcesso: /^\d{44}$/.test(chave) ? chave : null,
    modelo: mod === '65' ? 'nfce' : 'nfe',
    numero: txt(ide, 'nNF'),
    serie: txt(ide, 'serie'),
    dataEmissao: emissao,
    tipoOperacao: txt(ide, 'tpNF') === '0' ? 'entrada' : 'saida',
    naturezaOperacao: txt(ide, 'natOp'),
    emitente: pessoa(achar(inf, 'emit'), 'enderEmit') ?? { documento: null, tipoPessoa: 'PJ', nome: '(emitente sem nome)', fantasia: null, cidade: null, uf: null, telefone: null, email: null },
    destinatario: pessoa(achar(inf, 'dest'), 'enderDest'),
    itens,
    duplicatas,
    totais,
    formasPagamento,
    informacoes: txt(inf, 'infAdic/infCpl'),
    autorizada: cStat ? ['100', '150'].includes(cStat) : null,
  };
}

// Códigos de forma de pagamento da NF-e (tPag) para as formas do Agrega.
export function formaDoTPag(t: string | undefined): string | null {
  const mapa: Record<string, string> = { '01': 'dinheiro', '02': 'cheque', '03': 'cartao', '04': 'cartao', '15': 'boleto', '16': 'transferencia', '17': 'pix', '18': 'transferencia' };
  return t ? mapa[t] ?? null : null;
}
