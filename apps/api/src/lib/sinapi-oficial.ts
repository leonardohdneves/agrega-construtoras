// Conversão das planilhas oficiais do SINAPI (Caixa, "SINAPI_Referência_AAAA_MM.xlsx") para o CSV padrão das tabelas de
// referência do Agrega. Lê as abas de preços de insumos (ISD/ICD/ISE), o analítico das composições (estrutura e
// coeficientes) e, só para conferir, os custos das composições (CSD/CCD). Não grava nada: gera o texto do CSV.
import type { AbaXlsx } from './xlsx-leitura.ts';
import { numeroBr } from './engenharia.ts';

/** uf: estado da tabela. ufReserva: onde buscar o preço do insumo que não teve coleta na uf (o SINAPI usa SP). */
export type OpcoesSinapi = { uf: string; desonerado: boolean; ufReserva?: string };

export type ResumoSinapi = {
  insumos: number;
  insumosSemPreco: number;
  /** Insumos sem coleta na UF que entram com o preço de reserva (SP), como o SINAPI faz. */
  insumosPrecoReserva: number;
  composicoes: number;
  composicoesSemCusto: number;
  componentes: number;
  estrutura: number;
  auxiliaresSemCadastro: number;
  ciclos: number;
  /** Conferência com o custo oficial da composição na UF: quantas bateram (até 1 centavo) e quantas divergiram. */
  conferidas: number;
  divergentes: { codigo: string; descricao: string; calculado: number; oficial: number }[];
  /** Total de composições que divergem do custo oficial (a lista acima guarda só as 200 primeiras) e a maior diferença, em %. */
  divergentesTotal: number;
  maiorDivergenciaPct: number;
  semCustoOficial: number;
};

const semAcento = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const celula = (l: string[], i: number) => (l[i] ?? '').replace(/\s+/g, ' ').trim();
const limpar = (t: string) => t.replace(/[;\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Unidades do SINAPI em caixa alta sem expoente; o Agrega usa m², m³ nas unidades de área e volume. */
export function unidadeSinapi(u: string): string {
  const t = u.trim().toUpperCase();
  const mapa: Record<string, string> = { M2: 'm²', M3: 'm³', M2XMES: 'm²xmês', M3XKM: 'm³xkm', M3XMES: 'm³xmês', MXMES: 'mxmês' };
  return mapa[t] ?? u.trim();
}

const aba = (abas: AbaXlsx[], nome: string) => {
  const a = abas.find((x) => semAcento(x.nome).trim() === semAcento(nome));
  if (!a) throw new Error(`A planilha não tem a aba ${nome}. Use o arquivo "SINAPI_Referência" do mês.`);
  return a;
};

type Insumo = { codigo: string; descricao: string; unidade: string; classe: string; preco: number | null; /** preço de reserva usado no lugar do da UF */ deReserva?: boolean };

/** Insumos da aba de preços, com o preço mediano da UF (nulo quando não houve coleta no mês). */
function lerInsumos(a: AbaXlsx, uf: string, ufReserva?: string): Map<string, Insumo> {
  const iCab = a.linhas.findIndex((l) => l.some((c) => /^classifica/i.test(celula([c], 0))));
  if (iCab < 0) throw new Error(`Não achei o cabeçalho de insumos na aba ${a.nome}.`);
  const cab = a.linhas[iCab].map((c) => semAcento(celula([c], 0)));
  const col = (re: RegExp) => cab.findIndex((c) => re.test(c));
  const cCod = col(/^codigo/);
  const cDesc = col(/^descricao/);
  const cUn = col(/^unidade/);
  const cUf = cab.findIndex((c) => c === uf.toLowerCase());
  const cReserva = ufReserva ? cab.findIndex((c) => c === ufReserva.toLowerCase()) : -1;
  if (cCod < 0 || cDesc < 0 || cUn < 0) throw new Error(`Cabeçalho de insumos inesperado na aba ${a.nome}.`);
  if (cUf < 0) throw new Error(`A UF ${uf} não está na aba ${a.nome}.`);
  const saida = new Map<string, Insumo>();
  for (const l of a.linhas.slice(iCab + 1)) {
    const codigo = celula(l, cCod);
    if (!/^\d+$/.test(codigo)) continue;
    const preco = numeroBr(celula(l, cUf).replace(/^-$/, ''));
    const reserva = cReserva >= 0 ? numeroBr(celula(l, cReserva).replace(/^-$/, '')) : null;
    const proprio = preco !== null && preco >= 0;
    const usaReserva = !proprio && reserva !== null && reserva >= 0;
    saida.set(codigo, {
      codigo,
      descricao: limpar(celula(l, cDesc)),
      unidade: unidadeSinapi(celula(l, cUn)),
      classe: limpar(celula(l, 0)),
      preco: proprio ? preco : usaReserva ? reserva : null,
      deReserva: usaReserva,
    });
  }
  return saida;
}

type Item = { tipo: 'insumo' | 'composicao'; codigo: string; descricao: string; unidade: string; coeficiente: number };
type Composicao = { codigo: string; descricao: string; unidade: string; grupo: string; situacao: string; itens: Item[] };

/** Composições do analítico: uma linha de cabeçalho (sem tipo de item) seguida dos itens dela. */
function lerAnalitico(a: AbaXlsx): Map<string, Composicao> {
  const iCab = a.linhas.findIndex((l) => /^grupo/i.test(celula(l, 0)) && /codigo da/i.test(semAcento(celula(l, 1))));
  if (iCab < 0) throw new Error('Não achei o cabeçalho do analítico de composições.');
  const saida = new Map<string, Composicao>();
  for (const l of a.linhas.slice(iCab + 1)) {
    const cod = celula(l, 1);
    if (!/^\d+$/.test(cod)) continue;
    const tipoItem = celula(l, 2).toUpperCase();
    if (!tipoItem) {
      saida.set(cod, { codigo: cod, grupo: limpar(celula(l, 0)), descricao: limpar(celula(l, 4)), unidade: unidadeSinapi(celula(l, 5)), situacao: celula(l, 7).toUpperCase(), itens: [] });
      continue;
    }
    const comp = saida.get(cod);
    const coef = numeroBr(celula(l, 6));
    if (!comp || coef === null || coef < 0) continue;
    const ehComposicao = tipoItem.startsWith('COMPOSI');
    comp.itens.push({ tipo: ehComposicao ? 'composicao' : 'insumo', codigo: celula(l, 3), descricao: limpar(celula(l, 4)), unidade: unidadeSinapi(celula(l, 5)), coeficiente: coef });
  }
  return saida;
}

/** Custo oficial de cada composição na UF (pela aba de custos), por "grupo|descrição", já que a coluna do código é uma fórmula. */
function lerCustosOficiais(a: AbaXlsx, uf: string): Map<string, number | null> {
  const iUf = a.linhas.findIndex((l) => l.some((c) => celula([c], 0) === uf.toUpperCase()) && l.filter((c) => /^[A-Z]{2}$/.test(celula([c], 0))).length >= 20);
  const iCab = a.linhas.findIndex((l) => /^grupo/i.test(celula(l, 0)));
  if (iUf < 0 || iCab < 0) return new Map();
  const col = a.linhas[iUf].findIndex((c) => celula([c], 0) === uf.toUpperCase());
  const saida = new Map<string, number | null>();
  for (const l of a.linhas.slice(iCab + 1)) {
    const desc = limpar(celula(l, 2));
    if (!desc) continue;
    const custo = numeroBr(celula(l, col).replace(/^-$/, ''));
    saida.set(`${limpar(celula(l, 0))}|${desc}`, custo !== null && custo > 0 ? custo : null);
  }
  return saida;
}

const texto = (n: number) => String(Number(n.toPrecision(12)));

/**
 * Gera o CSV padrão do Agrega (insumo, composicao, componente, item_insumo, item_composicao) com os preços da UF.
 * Composições auxiliares dentro de outras são desdobradas em insumos nos componentes (o preço sai deles) e ficam
 * também na estrutura (item_composicao), para conferência.
 */
export function converterSinapiOficial(abas: AbaXlsx[], op: OpcoesSinapi): { csv: string; resumo: ResumoSinapi; avisos: string[] } {
  const uf = op.uf.toUpperCase();
  const ufReserva = op.ufReserva === undefined ? 'SP' : op.ufReserva;
  const insumos = lerInsumos(aba(abas, op.desonerado ? 'ICD' : 'ISD'), uf, uf === ufReserva.toUpperCase() ? undefined : ufReserva);
  const comps = lerAnalitico(aba(abas, 'Analítico'));
  const oficiais = lerCustosOficiais(aba(abas, op.desonerado ? 'CCD' : 'CSD'), uf);
  const avisos: string[] = [];

  // Insumos usados nas composições que não estão na aba de preços entram sem preço.
  for (const c of comps.values()) {
    for (const i of c.itens) {
      if (i.tipo === 'insumo' && !insumos.has(i.codigo)) insumos.set(i.codigo, { codigo: i.codigo, descricao: i.descricao, unidade: i.unidade, classe: 'SEM PREÇO', preco: null });
    }
  }

  let ciclos = 0;
  let auxiliaresSemCadastro = 0;
  const achatadas = new Map<string, Map<string, number>>();
  const achatar = (cod: string, pilha: Set<string>): Map<string, number> => {
    const pronta = achatadas.get(cod);
    if (pronta) return pronta;
    const soma = new Map<string, number>();
    pilha.add(cod);
    for (const i of comps.get(cod)?.itens ?? []) {
      if (i.tipo === 'insumo') soma.set(i.codigo, (soma.get(i.codigo) ?? 0) + i.coeficiente);
      else if (!comps.has(i.codigo)) auxiliaresSemCadastro++;
      else if (pilha.has(i.codigo)) ciclos++;
      else for (const [ins, k] of achatar(i.codigo, pilha)) soma.set(ins, (soma.get(ins) ?? 0) + k * i.coeficiente);
    }
    pilha.delete(cod);
    achatadas.set(cod, soma);
    return soma;
  };

  const linhas = ['tipo;codigo;descricao;unidade;preco;grupo;insumo;coeficiente'];
  let insumosSemPreco = 0;
  for (const i of insumos.values()) {
    if (i.preco === null) insumosSemPreco++;
    linhas.push(['insumo', i.codigo, i.descricao, i.unidade, (i.preco ?? 0).toFixed(2), i.classe, '', ''].join(';'));
  }
  const resumo: ResumoSinapi = { insumos: insumos.size, insumosSemPreco, insumosPrecoReserva: [...insumos.values()].filter((i) => i.deReserva).length, composicoes: comps.size, composicoesSemCusto: 0, componentes: 0, estrutura: 0, auxiliaresSemCadastro: 0, ciclos: 0, conferidas: 0, divergentes: [], divergentesTotal: 0, maiorDivergenciaPct: 0, semCustoOficial: 0 };
  for (const c of comps.values()) {
    linhas.push(['composicao', c.codigo, c.descricao, c.unidade, '', c.grupo, '', ''].join(';'));
    const ins = achatar(c.codigo, new Set());
    let custo = 0;
    let falta = false;
    for (const [codigo, coef] of ins) {
      linhas.push(['componente', c.codigo, '', '', '', '', codigo, texto(coef)].join(';'));
      resumo.componentes++;
      const p = insumos.get(codigo)?.preco;
      if (p == null) falta = true;
      else custo += p * coef;
    }
    if (falta || ins.size === 0) resumo.composicoesSemCusto++;
    const diretos = new Map<string, { tipo: 'item_insumo' | 'item_composicao'; codigo: string; coef: number }>();
    for (const i of c.itens) {
      if (i.tipo === 'composicao' && !comps.has(i.codigo)) continue;
      const tipo = i.tipo === 'insumo' ? 'item_insumo' : 'item_composicao';
      const k = `${tipo}:${i.codigo}`;
      const atual = diretos.get(k);
      if (atual) atual.coef += i.coeficiente;
      else diretos.set(k, { tipo, codigo: i.codigo, coef: i.coeficiente });
    }
    for (const d of diretos.values()) {
      linhas.push([d.tipo, c.codigo, '', '', '', '', d.codigo, texto(d.coef)].join(';'));
      resumo.estrutura++;
    }
    // Conferência com o custo oficial da UF.
    const oficial = oficiais.get(`${c.grupo}|${c.descricao}`);
    if (oficial === undefined) continue;
    if (oficial === null) resumo.semCustoOficial++;
    else if (!falta) {
      if (Math.abs(custo - oficial) <= 0.011 + oficial * 0.002) resumo.conferidas++;
      else {
        resumo.divergentesTotal++;
        resumo.maiorDivergenciaPct = Math.max(resumo.maiorDivergenciaPct, Math.round((Math.abs(custo - oficial) / oficial) * 10000) / 100);
        if (resumo.divergentes.length < 200) resumo.divergentes.push({ codigo: c.codigo, descricao: c.descricao.slice(0, 80), calculado: Math.round(custo * 100) / 100, oficial });
      }
    }
  }
  resumo.auxiliaresSemCadastro = auxiliaresSemCadastro;
  resumo.ciclos = ciclos;
  if (resumo.insumosPrecoReserva) avisos.push(`${resumo.insumosPrecoReserva} insumos sem coleta em ${uf} entram com o preço de ${ufReserva.toUpperCase()}, como o SINAPI faz nas composições (coluna %AS).`);
  if (insumosSemPreco) avisos.push(`${insumosSemPreco} insumos sem preço em ${uf} nem em ${ufReserva.toUpperCase()} (entram com preço zero). As composições que os usam ficam subestimadas.`);
  if (resumo.composicoesSemCusto) avisos.push(`${resumo.composicoesSemCusto} composições têm algum insumo sem preço em ${uf}: o custo delas na tabela está incompleto.`);
  if (auxiliaresSemCadastro) avisos.push(`${auxiliaresSemCadastro} composições auxiliares citadas não existem no analítico e foram ignoradas.`);
  if (ciclos) avisos.push(`${ciclos} referências circulares entre composições foram ignoradas.`);
  return { csv: linhas.join('\n'), resumo, avisos };
}
