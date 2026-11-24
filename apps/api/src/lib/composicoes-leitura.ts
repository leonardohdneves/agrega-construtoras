// Leitura por IA de insumos e serviços (composições) a partir de um arquivo: PDF e fotos vão como documento/imagem;
// HTML, XLSX, CSV e TXT vão como texto. A IA devolve os itens por uma ferramenta; aqui eles são conferidos e limpos.
import { blocoDocumento, type BlocoDocumento } from './ia-documento.ts';
import { textoDoHtml, tabelasDoHtml } from './leitura-html.ts';
import { xlsxParaTexto } from './xlsx-leitura.ts';

export type TipoItemLido = 'insumo' | 'composicao';
export type ComponenteLido = { tipo: TipoItemLido; codigo: string; descricao: string; unidade: string; coeficiente: number };
export type ItemLido = { tipo: TipoItemLido; codigo: string; descricao: string; unidade: string; componentes: ComponenteLido[] };

const IMAGENS: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
export const LIMITE_ARQUIVO_COMPOSICOES = 15 * 1024 * 1024;

/** Texto das tabelas de um HTML (uma linha por linha de tabela); sem tabela, o texto da página. */
function htmlParaTexto(html: string): string {
  const tabelas = tabelasDoHtml(html);
  if (tabelas.length) return tabelas.map((t) => (t.titulo ? `## ${t.titulo}\n` : '') + t.linhas.map((l) => l.join(' | ')).join('\n')).join('\n\n');
  return textoDoHtml(html);
}

/** Monta o bloco que a IA recebe, conforme o formato do arquivo. Lança erro com mensagem para o usuário. */
export function blocoDoArquivo(nome: string, buf: Buffer): BlocoDocumento {
  const ext = (/\.([a-z0-9]+)$/i.exec(nome)?.[1] ?? '').toLowerCase();
  if (ext === 'pdf') return blocoDocumento(buf, 'application/pdf');
  if (IMAGENS[ext]) return blocoDocumento(buf, IMAGENS[ext]);
  let texto: string;
  if (ext === 'html' || ext === 'htm') texto = htmlParaTexto(buf.toString('utf8'));
  else if (ext === 'xlsx') texto = xlsxParaTexto(buf);
  else if (ext === 'csv' || ext === 'txt') texto = buf.toString('utf8');
  else throw new Error('Formato não aceito. Envie PDF, foto (PNG, JPG, WEBP), HTML, XLSX, CSV ou TXT.');
  if (!texto.trim()) throw new Error('Não encontrei texto neste arquivo.');
  return { type: 'text', text: `Conteúdo do arquivo ${nome}:\n\n${texto.slice(0, 180_000)}` };
}

const linhaSchema = {
  type: 'object',
  properties: {
    tipo_no_arquivo: { type: 'string', description: 'Exatamente como aparece na coluna de tipo do arquivo: "C" (composição auxiliar) ou "I" (insumo), ou o nome do tipo por extenso.' },
    codigo: { type: 'string', description: 'Código da linha no arquivo; vazio se não houver.' },
    descricao: { type: 'string' },
    unidade: { type: 'string' },
    quantidade: { type: 'number', description: 'Valor da coluna Quantidade (ou Coeficiente/Consumo) desta linha, com ponto decimal.' },
  },
  required: ['tipo_no_arquivo', 'descricao', 'quantidade'],
};

export const FERRAMENTA_COMPOSICOES = {
  name: 'lancar_composicoes',
  description: 'Devolve cada serviço (composição) principal do arquivo com todas as linhas que o compõem, e os itens avulsos.',
  input_schema: {
    type: 'object',
    properties: {
      servicos: {
        type: 'array',
        description: 'Serviços principais do arquivo, cada um com as linhas (insumos e composições auxiliares) que o compõem.',
        items: {
          type: 'object',
          properties: {
            codigo: { type: 'string' },
            descricao: { type: 'string' },
            unidade: { type: 'string' },
            linhas: { type: 'array', items: linhaSchema },
          },
          required: ['descricao', 'unidade', 'linhas'],
        },
      },
      avulsos: {
        type: 'array',
        description: 'Insumos ou serviços listados sem pertencer a um serviço principal (sem quantidade).',
        items: {
          type: 'object',
          properties: {
            tipo_no_arquivo: { type: 'string' },
            codigo: { type: 'string' },
            descricao: { type: 'string' },
            unidade: { type: 'string' },
          },
          required: ['tipo_no_arquivo', 'descricao'],
        },
      },
      pendencias: { type: 'array', items: { type: 'string' }, description: 'O que não ficou claro ou não foi possível ler.' },
    },
    required: ['servicos'],
  },
};

export const instrucaoComposicoes = (nome: string) =>
  `Leia o arquivo "${nome}" e chame a ferramenta lancar_composicoes.
Regras:
- Cada serviço (composição) principal do arquivo é um item de "servicos", com código, descrição e unidade, e TODAS as linhas que o compõem em "linhas".
- Em cada linha, copie o tipo exatamente como está na coluna de tipo do arquivo (por exemplo "C" ou "I") em tipo_no_arquivo. Não interprete: o sistema decide pelo que está escrito. No SINAPI, "C" é composição auxiliar e "I" é insumo.
- A quantidade de cada linha é o valor da coluna "Quantidade" (ou "Coeficiente", "Consumo", "Qtd"). Copie o número como está.
- Mantenha códigos, descrições e unidades como aparecem. Sem código no arquivo, deixe vazio.
- Itens que aparecem sem pertencer a um serviço principal vão em "avulsos".
- Não invente itens nem números. Se algo estiver ilegível ou ambíguo, diga em pendencias.`;

const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Tipo pela marca do arquivo: C/composição/serviço é composição; I/insumo/material/mão de obra/equipamento é insumo. */
export function tipoDoArquivo(marca: string): TipoItemLido | null {
  const m = marca.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!m) return null;
  if (m === 'c' || /^(comp|serv)/.test(m)) return 'composicao';
  if (m === 'i' || /^(ins|mat|mao|m\.o|equip|mo$)/.test(m)) return 'insumo';
  return null;
}

/**
 * Monta os itens a partir do que a IA devolveu: o tipo vem da marca do arquivo (C ou I), as linhas de cada serviço
 * viram componentes com a quantidade como coeficiente, e cada linha também vira um item para conciliar e cadastrar.
 */
export function lerComposicoesIa(r: Record<string, unknown>): { itens: ItemLido[]; pendencias: string[] } {
  const pendencias = Array.isArray(r.pendencias) ? r.pendencias.filter((p): p is string => typeof p === 'string').map((p) => p.slice(0, 300)) : [];
  const itens = new Map<string, ItemLido>();
  const chave = (tipo: TipoItemLido, codigo: string, descricao: string) => `${tipo}|${codigo || descricao.toLowerCase()}`;
  const juntar = (novo: ItemLido) => {
    const k = chave(novo.tipo, novo.codigo, novo.descricao);
    const atual = itens.get(k);
    if (!atual) itens.set(k, novo);
    else if (atual.componentes.length === 0 && novo.componentes.length > 0) itens.set(k, { ...atual, componentes: novo.componentes });
  };
  const tipoDe = (marca: unknown, descricao: string): TipoItemLido => {
    const t = tipoDoArquivo(texto(marca, 40));
    if (t) return t;
    pendencias.push(`Não reconheci o tipo de "${descricao}" (${texto(marca, 40) || 'em branco'}): ficou como insumo. Confira.`);
    return 'insumo';
  };
  for (const s of Array.isArray(r.servicos) ? (r.servicos as Record<string, unknown>[]) : []) {
    const descricao = texto(s.descricao, 300);
    if (descricao.length < 2) {
      pendencias.push('Um serviço sem descrição foi ignorado.');
      continue;
    }
    const componentes: ComponenteLido[] = [];
    const dasLinhas: ItemLido[] = [];
    for (const l of Array.isArray(s.linhas) ? (s.linhas as Record<string, unknown>[]) : []) {
      const d = texto(l.descricao, 300);
      const coef = typeof l.quantidade === 'number' ? l.quantidade : Number(String(l.quantidade ?? '').replace(',', '.'));
      if (d.length < 2 || !Number.isFinite(coef) || coef < 0) {
        pendencias.push(`Linha "${d || 'sem descrição'}" de ${descricao} ficou sem quantidade válida e foi ignorada.`);
        continue;
      }
      const tipo = tipoDe(l.tipo_no_arquivo, d);
      const k: ComponenteLido = { tipo, codigo: texto(l.codigo, 40), descricao: d, unidade: texto(l.unidade, 20), coeficiente: coef };
      componentes.push(k);
      dasLinhas.push({ tipo, codigo: k.codigo, descricao: d, unidade: k.unidade, componentes: [] });
    }
    juntar({ tipo: 'composicao', codigo: texto(s.codigo, 40), descricao, unidade: texto(s.unidade, 20), componentes });
    dasLinhas.forEach(juntar);
  }
  for (const a of Array.isArray(r.avulsos) ? (r.avulsos as Record<string, unknown>[]) : []) {
    const d = texto(a.descricao, 300);
    if (d.length < 2) continue;
    juntar({ tipo: tipoDe(a.tipo_no_arquivo, d), codigo: texto(a.codigo, 40), descricao: d, unidade: texto(a.unidade, 20), componentes: [] });
  }
  return { itens: [...itens.values()], pendencias };
}
