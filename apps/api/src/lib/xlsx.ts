// Gerador de planilha .xlsx sem dependências: cada aba é uma tabela com cabeçalho em negrito e linha 1 fixa.
import { criarZip } from './zip.ts';

export type Aba = { nome: string; colunas: string[]; linhas: unknown[][]; numericas?: boolean[] };

const LIMITE_CELULA = 32000; // o Excel aceita até 32.767 caracteres por célula
const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

function letra(i: number) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Nome de aba válido: até 31 caracteres, sem []:*?/\ e sem repetir. */
export function nomesDeAbas(nomes: string[]): string[] {
  const usados = new Set<string>();
  return nomes.map((n) => {
    let base = n.replace(/[[\]:*?/\\]/g, '-').slice(0, 31) || 'Aba';
    let nome = base;
    for (let k = 2; usados.has(nome.toLowerCase()); k++) nome = `${base.slice(0, 31 - String(k).length - 1)}_${k}`;
    usados.add(nome.toLowerCase());
    return nome;
  });
}

function celula(ref: string, valor: unknown, numerica: boolean): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'boolean') return `<c r="${ref}" t="b"><v>${valor ? 1 : 0}</v></c>`;
  if (typeof valor === 'number' && Number.isFinite(valor)) return `<c r="${ref}"><v>${valor}</v></c>`;
  let texto = valor instanceof Date ? valor.toISOString() : typeof valor === 'object' ? JSON.stringify(valor) : String(valor);
  if (numerica && /^-?\d+(\.\d+)?$/.test(texto)) return `<c r="${ref}"><v>${Number(texto)}</v></c>`;
  texto = esc(texto.slice(0, LIMITE_CELULA));
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${texto}</t></is></c>`;
}

function aba(a: Aba, nome: string): string {
  const larguras = a.colunas.map((c, i) => {
    let max = c.length;
    for (const l of a.linhas.slice(0, 500)) max = Math.max(max, String(l[i] ?? '').length);
    return Math.min(Math.max(max + 2, 8), 60);
  });
  const cols = larguras.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const cab = `<row r="1">${a.colunas.map((c, i) => `<c r="${letra(i)}1" s="1" t="inlineStr"><is><t xml:space="preserve">${esc(c)}</t></is></c>`).join('')}</row>`;
  const corpo = a.linhas
    .map((l, r) => `<row r="${r + 2}">${l.map((v, i) => celula(`${letra(i)}${r + 2}`, v, !!a.numericas?.[i])).join('')}</row>`)
    .join('');
  const ultima = a.colunas.length ? `${letra(a.colunas.length - 1)}${a.linhas.length + 1}` : 'A1';
  void nome;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<dimension ref="A1:${ultima}"/>` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${cols}</cols><sheetData>${cab}${corpo}</sheetData></worksheet>`
  );
}

/** Monta o .xlsx (bytes do arquivo). */
export function criarXlsx(abas: Aba[]): Buffer {
  const nomes = nomesDeAbas(abas.map((a) => a.nome));
  const arquivos: { nome: string; dados: Buffer }[] = [];
  const sheets = nomes.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  const relsSheets = nomes.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('');
  const overrides = nomes.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');

  arquivos.push({
    nome: '[Content_Types].xml',
    dados: Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${overrides}</Types>`,
    ),
  });
  arquivos.push({
    nome: '_rels/.rels',
    dados: Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
  });
  arquivos.push({
    nome: 'xl/workbook.xml',
    dados: Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets></workbook>`,
    ),
  });
  arquivos.push({
    nome: 'xl/_rels/workbook.xml.rels',
    dados: Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relsSheets}` +
        `<Relationship Id="rId${nomes.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
  });
  arquivos.push({
    nome: 'xl/styles.xml',
    dados: Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
        `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
        `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
        `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
        `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
        `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    ),
  });
  abas.forEach((a, i) => arquivos.push({ nome: `xl/worksheets/sheet${i + 1}.xml`, dados: Buffer.from(aba(a, nomes[i]!), 'utf8') }));
  return criarZip(arquivos);
}
