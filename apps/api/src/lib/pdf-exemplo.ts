// Gera um PDF simples no formato do DANFE (texto em Helvetica e código de barras desenhado em vetor).
// Usado na demonstração (nota "lida do PDF") e nos testes do leitor.
import { deflateSync } from 'node:zlib';
import { codificarCode128C } from './code128.ts';

export type DanfeExemplo = {
  chave: string;
  numero: number;
  serie: number;
  emissao: string; // AAAA-MM-DD
  emitente: { nome: string; cnpj: string; endereco: string };
  destinatario: { nome: string; cnpj: string };
  natureza: string;
  itens: { codigo: string; descricao: string; ncm: string; cfop: string; unidade: string; quantidade: number; unitario: number; total: number }[];
  frete: number;
  desconto: number;
  duplicatas: { numero: string; vencimento: string; valor: number }[];
  informacoes: string;
};

const mm = (v: number) => (v * 72) / 25.4;
const br = (v: number, casas = 2) => v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const cnpjBr = (c: string) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
const pdfTexto = (s: string) => Buffer.from(s, 'latin1').toString('latin1').replace(/[\\()]/g, (x) => `\\${x}`);
const n = (v: number) => Number(v.toFixed(2)).toString();

export function gerarDanfeExemplo(d: DanfeExemplo): Buffer {
  const ops: string[] = [];
  const texto = (x: number, y: number, s: string, tam = 7, negrito = false, direita = false) => {
    // Helvetica tem ~0,5 em de largura média: suficiente para alinhar à direita no exemplo.
    const xx = direita ? x - (s.length * tam * 0.5) / 72 * 25.4 : x;
    ops.push(`BT /${negrito ? 'F2' : 'F1'} ${tam} Tf ${n(mm(xx))} ${n(mm(y))} Td (${pdfTexto(s)}) Tj ET`);
  };
  const caixa = (x: number, y: number, w: number, h: number, rotulo: string, valor: string, tam = 8, direita = false) => {
    ops.push(`${n(mm(x))} ${n(mm(y))} ${n(mm(w))} ${n(mm(h))} re S`);
    texto(x + 1, y + h - 2.3, rotulo, 5.5);
    texto(direita ? x + w - 1 : x + 1, y + 1.3, valor, tam, tam >= 9, direita);
  };
  const total = d.itens.reduce((s, i) => s + i.total, 0) + d.frete - d.desconto;
  const produtos = d.itens.reduce((s, i) => s + i.total, 0);

  texto(10, 285, `RECEBEMOS DE ${d.emitente.nome} OS PRODUTOS E/OU SERVIÇOS CONSTANTES DA NOTA FISCAL ELETRÔNICA INDICADA ABAIXO.`, 6);
  texto(10, 281.5, `EMISSÃO: ${dataBr(d.emissao)}   VALOR TOTAL: R$ ${br(total)}   DESTINATÁRIO: ${d.destinatario.nome}`, 6);
  texto(172, 282, 'NF-e', 11, true);
  texto(166, 277.5, `Nº ${String(d.numero).padStart(9, '0').replace(/(\d{3})(\d{3})(\d{3})/, '$1.$2.$3')}`, 8);
  texto(166, 274.5, `SÉRIE ${d.serie}`, 8);
  texto(12, 262, d.emitente.nome, 10, true);
  texto(12, 258, d.emitente.endereco, 7);
  texto(95, 264, 'DANFE', 12, true);
  texto(88, 260, 'DOCUMENTO AUXILIAR DA NOTA', 6);
  texto(88, 257.5, 'FISCAL ELETRÔNICA', 6);
  texto(88, 254, '0 - ENTRADA  1 - SAÍDA   1', 6);
  // Código de barras (Code 128 C) da chave.
  let x = 124;
  const modulo = 0.27;
  codificarCode128C(d.chave).forEach((w, i) => {
    if (i % 2 === 0) ops.push(`${n(mm(x))} ${n(mm(256))} ${n(mm(w * modulo))} ${n(mm(11))} re f`);
    x += w * modulo;
  });
  caixa(122, 244, 78, 9, 'CHAVE DE ACESSO', d.chave.replace(/(\d{4})(?=\d)/g, '$1 '), 7.5);
  caixa(10, 236, 110, 7, 'NATUREZA DA OPERAÇÃO', d.natureza);
  caixa(120, 236, 80, 7, 'PROTOCOLO DE AUTORIZAÇÃO DE USO', `3172600001${String(d.numero).padStart(5, '0')} ${dataBr(d.emissao)} 09:12:33`);
  caixa(10, 229, 95, 7, 'INSCRIÇÃO ESTADUAL', '29.412.345-6');
  caixa(105, 229, 95, 7, 'CNPJ', cnpjBr(d.emitente.cnpj));
  texto(10, 226, 'DESTINATÁRIO / REMETENTE', 7, true);
  caixa(10, 218, 120, 7, 'NOME / RAZÃO SOCIAL', d.destinatario.nome);
  caixa(130, 218, 40, 7, 'CNPJ / CPF', cnpjBr(d.destinatario.cnpj));
  caixa(170, 218, 30, 7, 'DATA DA EMISSÃO', dataBr(d.emissao));
  texto(10, 208, 'FATURA / DUPLICATAS', 7, true);
  d.duplicatas.forEach((p, i) => texto(11 + i * 64, 204, `Num. ${p.numero}  Venc. ${dataBr(p.vencimento)}  Valor R$ ${br(p.valor)}`, 7));
  texto(10, 199, 'CÁLCULO DO IMPOSTO', 7, true);
  caixa(10, 191, 38, 7, 'BASE DE CÁLC. DO ICMS', '0,00', 8, true);
  caixa(48, 191, 38, 7, 'VALOR DO ICMS', '0,00', 8, true);
  caixa(86, 191, 38, 7, 'BASE DE CÁLC. ICMS S.T.', '0,00', 8, true);
  caixa(124, 191, 38, 7, 'VALOR DO ICMS SUBST.', '0,00', 8, true);
  caixa(162, 191, 38, 7, 'V. TOTAL PRODUTOS', br(produtos), 8, true);
  caixa(10, 184, 32, 7, 'VALOR DO FRETE', br(d.frete), 8, true);
  caixa(42, 184, 32, 7, 'VALOR DO SEGURO', '0,00', 8, true);
  caixa(74, 184, 32, 7, 'DESCONTO', br(d.desconto), 8, true);
  caixa(106, 184, 32, 7, 'OUTRAS DESPESAS', '0,00', 8, true);
  caixa(138, 184, 30, 7, 'VALOR DO IPI', '0,00', 8, true);
  caixa(168, 184, 32, 7, 'V. TOTAL DA NOTA', br(total), 8, true);
  texto(10, 170, 'DADOS DOS PRODUTOS / SERVIÇOS', 7, true);
  const cols: [string, number][] = [['CÓDIGO', 10], ['DESCRIÇÃO DO PRODUTO / SERVIÇO', 24], ['NCM/SH', 84], ['CST', 98], ['CFOP', 105], ['UN', 113], ['QUANT', 121], ['VALOR UNIT', 136], ['VALOR TOTAL', 153], ['V.ICMS', 170]];
  for (const [t, cx] of cols) texto(cx, 166, t, 5.5);
  let y = 161;
  for (const i of d.itens) {
    const vals = [i.codigo, i.descricao, i.ncm, '000', i.cfop, i.unidade, br(i.quantidade, 4), br(i.unitario, 4), br(i.total), '0,00'];
    vals.forEach((v, k) => {
      const [, cx] = cols[k];
      if (k >= 6) texto(cx + 14, y, v, 7, false, true);
      else texto(cx, y, v, 7);
    });
    y -= 3.5;
  }
  texto(10, 60, 'DADOS ADICIONAIS', 7, true);
  texto(10, 56, `INFORMAÇÕES COMPLEMENTARES: ${d.informacoes}`, 6.5);

  const conteudo = deflateSync(Buffer.from(ops.join('\n'), 'latin1'));
  const objs: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`),
    Buffer.concat([Buffer.from(`<< /Length ${conteudo.length} /Filter /FlateDecode >>\nstream\n`), conteudo, Buffer.from('\nendstream')]),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),
  ];
  const partes: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets: number[] = [];
  let pos = partes[0].length;
  objs.forEach((o, i) => {
    offsets.push(pos);
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')]);
    partes.push(b);
    pos += b.length;
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`;
  partes.push(Buffer.from(xref));
  return Buffer.concat(partes);
}
