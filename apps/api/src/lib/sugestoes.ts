// Sugestão de categoria para itens de nota: primeiro as regras aprendidas da empresa,
// depois palavras-chave e NCM típicos de concreteira (códigos do plano padrão).

export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

type Pista = { codigo: string; palavras?: RegExp; ncm?: RegExp; centro?: string };

// A ordem importa: a primeira pista que casar vence.
const PISTAS: Pista[] = [
  { codigo: '4.4', palavras: /\bARLA\b|\bAGENTE REDUTOR\b|\bLUBRIF|\bOLEO (?:LUB|MOTOR|HIDR|DIFER|CAMBIO|REDUT|TRANSM)|\bGRAXA\b|\b15W40\b|\bSAE\b/, ncm: /^(2710129|27101931|27101932|3403|31021010)/, centro: 'Frota' },
  { codigo: '4.1', palavras: /\bDIESEL\b|\bS ?10\b|\bS ?500\b|\bOLEO COMB/, ncm: /^2710192/, centro: 'Frota' },
  { codigo: '4.3', palavras: /\bPNEU|\bCAMARA DE AR\b|\bRECAPAG|\bRECAUCH/, ncm: /^4011|^4012|^4013/, centro: 'Frota' },
  { codigo: '3.1', palavras: /\bCIMENTO\b|\bCP ?(?:II|III|IV|V)\b/, ncm: /^2523/, centro: 'Usina' },
  { codigo: '3.2', palavras: /\bAREIA\b/, ncm: /^2505/, centro: 'Usina' },
  { codigo: '3.3', palavras: /\bBRITA|\bPEDRISCO\b|\bPO DE PEDRA\b|\bCASCALHO\b/, ncm: /^2517/, centro: 'Usina' },
  { codigo: '3.4', palavras: /\bADITIVO|\bPLASTIFICANTE|\bSUPERPLASTIF|\bRETARDADOR|\bACELERADOR DE PEGA/, ncm: /^3824/, centro: 'Usina' },
  { codigo: '4.7', palavras: /\bPEDAGIO/ },
  { codigo: '6.2', palavras: /\bENERGIA ELETRICA\b|\bINTERNET\b|\bTELEFON/ },
  { codigo: '4.2', palavras: /\bFILTRO|\bPECA|\bROLAMENTO|\bCORREIA|\bPASTILHA|\bLONA DE FREIO|\bEMBREAGEM|\bAMORTECEDOR|\bMANGOTE|\bMANGUEIRA|\bREDUTOR|\bLAMPADA|\bBATERIA|\bRETENTOR|\bJUNTA\b|\bPARAFUSO|\bMAO DE OBRA|\bSERVICO DE MANUT|\bREVISAO/, ncm: /^8708|^8409|^8421|^8482|^8483|^8507|^4016/, centro: 'Frota' },
];

export type Sugestao = { codigo: string; centro: string | null; motivo: string };

export function sugerirPorPalavras(descricao: string, ncm: string | null): Sugestao | null {
  const d = normalizar(descricao);
  const n = (ncm ?? '').replace(/\D/g, '');
  for (const p of PISTAS) {
    if (p.palavras && p.palavras.test(d)) return { codigo: p.codigo, centro: p.centro ?? null, motivo: 'descrição do item' };
  }
  for (const p of PISTAS) {
    if (p.ncm && n && p.ncm.test(n)) return { codigo: p.codigo, centro: p.centro ?? null, motivo: 'NCM do item' };
  }
  return null;
}

export type Regra = {
  id: string;
  fornecedorId: string | null;
  textoContem: string | null;
  ncm: string | null;
  planoContaId: string;
  centroCustoId: string | null;
  veiculoId: string | null;
};

/** Escolhe a regra mais específica que vale para o item. */
export function escolherRegra(regras: Regra[], fornecedorId: string | null, descricao: string, ncm: string | null): Regra | null {
  const d = normalizar(descricao);
  const n = (ncm ?? '').replace(/\D/g, '');
  let melhor: { r: Regra; pontos: number } | null = null;
  for (const r of regras) {
    if (r.fornecedorId && r.fornecedorId !== fornecedorId) continue;
    if (r.textoContem && !d.includes(normalizar(r.textoContem))) continue;
    if (r.ncm && !(n && n.startsWith(r.ncm.replace(/\D/g, '')))) continue;
    if (!r.fornecedorId && !r.textoContem && !r.ncm) continue;
    const pontos = (r.fornecedorId ? 4 : 0) + (r.textoContem ? 2 + Math.min(normalizar(r.textoContem).length, 60) / 100 : 0) + (r.ncm ? 1 : 0);
    if (!melhor || pontos > melhor.pontos) melhor = { r, pontos };
  }
  return melhor?.r ?? null;
}
