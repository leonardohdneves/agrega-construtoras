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

const esquemaTipo = { type: 'string', enum: ['insumo', 'composicao'] };
export const FERRAMENTA_COMPOSICOES = {
  name: 'lancar_composicoes',
  description: 'Lista os insumos e os serviços (composições) do arquivo, com os coeficientes de cada serviço.',
  input_schema: {
    type: 'object',
    properties: {
      itens: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tipo: esquemaTipo,
            codigo: { type: 'string', description: 'Código que aparece no arquivo; vazio se não houver.' },
            descricao: { type: 'string' },
            unidade: { type: 'string' },
            componentes: {
              type: 'array',
              description: 'Só para serviços: os insumos e os outros serviços usados, com o coeficiente por unidade do serviço.',
              items: {
                type: 'object',
                properties: {
                  tipo: esquemaTipo,
                  codigo: { type: 'string' },
                  descricao: { type: 'string' },
                  unidade: { type: 'string' },
                  coeficiente: { type: 'number' },
                },
                required: ['tipo', 'descricao', 'coeficiente'],
              },
            },
          },
          required: ['tipo', 'descricao', 'unidade'],
        },
      },
      pendencias: { type: 'array', items: { type: 'string' }, description: 'O que não ficou claro ou não foi possível ler.' },
    },
    required: ['itens'],
  },
};

export const instrucaoComposicoes = (nome: string) =>
  `Leia o arquivo "${nome}" e liste os insumos (materiais, mão de obra, equipamentos) e os serviços (composições) nele, chamando a ferramenta lancar_composicoes.
Regras:
- Insumo: tipo "insumo", com descrição e unidade. Não invente preço: preços não entram aqui.
- Serviço: tipo "composicao", com a lista de componentes (insumos ou outros serviços) e o coeficiente de cada um por unidade do serviço.
- O coeficiente de cada componente é a coluna chamada "Quantidade", "Coeficiente", "Consumo" ou "Qtd" (use sempre esse número, com ponto decimal).
- Em relatórios analíticos do SINAPI: a primeira linha é o serviço principal; as linhas seguintes com tipo "C" (composição auxiliar) ou "I" (insumo) são os COMPONENTES dele, cada um com sua quantidade. Não liste esses componentes como itens soltos: coloque-os em componentes do serviço principal (tipo C = "composicao", tipo I = "insumo"), e também liste cada um como item para cadastro.
- Se um componente for outro serviço do arquivo, marque tipo "composicao" nele.
- Mantenha os códigos e as unidades como aparecem. Se não houver código, deixe vazio.
- Não invente itens que não estão no arquivo. Se algo estiver ilegível ou ambíguo, diga em pendencias.`;

const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Confere o que a IA devolveu: descarta o que não tem descrição, normaliza tipos e coeficientes. */
export function lerComposicoesIa(r: Record<string, unknown>): { itens: ItemLido[]; pendencias: string[] } {
  const pendencias = Array.isArray(r.pendencias) ? r.pendencias.filter((p): p is string => typeof p === 'string').map((p) => p.slice(0, 300)) : [];
  const tipoDe = (v: unknown): TipoItemLido => (v === 'composicao' ? 'composicao' : 'insumo');
  const brutos = Array.isArray(r.itens) ? (r.itens as Record<string, unknown>[]) : [];
  const itens: ItemLido[] = [];
  for (const b of brutos) {
    const descricao = texto(b.descricao, 300);
    if (descricao.length < 2) {
      pendencias.push('Um item sem descrição foi ignorado.');
      continue;
    }
    const tipo = tipoDe(b.tipo);
    const componentes: ComponenteLido[] = [];
    if (tipo === 'composicao' && Array.isArray(b.componentes)) {
      for (const k of b.componentes as Record<string, unknown>[]) {
        const d = texto(k.descricao, 300);
        const coef = typeof k.coeficiente === 'number' ? k.coeficiente : Number(String(k.coeficiente ?? '').replace(',', '.'));
        if (d.length < 2 || !Number.isFinite(coef) || coef < 0) {
          pendencias.push(`Componente "${d || 'sem descrição'}" de ${descricao} ficou sem coeficiente válido e foi ignorado.`);
          continue;
        }
        componentes.push({ tipo: tipoDe(k.tipo), codigo: texto(k.codigo, 40), descricao: d, unidade: texto(k.unidade, 20), coeficiente: coef });
      }
    }
    itens.push({ tipo, codigo: texto(b.codigo, 40), descricao, unidade: texto(b.unidade, 20), componentes });
  }
  return { itens, pendencias };
}
