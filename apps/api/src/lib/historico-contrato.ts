// Histórico do contrato das construtoras: lê os registros de auditoria (em mais de um formato, porque o registro mudou
// com o tempo) e descreve em texto o que mudou em cada alteração. Funções puras, sem banco.
import { NOMES_PACOTE } from './pacotes.ts';
import { NOMES_MODULO } from './modulos.ts';
import { NOMES_RECURSO } from './recursos.ts';

/** `undefined` = o registro não guardou o dado; `null` = sem limite ou sem teste. */
export type ContratoRegistrado = {
  pacote: string | null;
  modulos: string[] | null;
  recursos: string[] | null;
  limiteObras: number | null | undefined;
  limiteUsuarios: number | null | undefined;
  testeFim: string | null | undefined;
};

const lista = (v: unknown): string[] | null => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null);
const texto = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const numeroOuNulo = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const dataOuNula = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/**
 * Lê o contrato de um registro de auditoria. Formatos aceitos:
 * - atual: { pacote, modulos, recursos, limiteObras, limiteUsuarios, testeFim };
 * - anterior ("depois"): { pacote, modulos, limiteObras, limiteUsuarios, teste: [inicio, fim] };
 * - anterior ("antes"): { contrato: módulos, limites: [obras, usuários], teste: [inicio, fim] };
 * - cadastro da empresa: a linha da tabela (contrato_pacote, modulos_contratados, limite_obras…).
 */
export function lerContrato(json: unknown): ContratoRegistrado {
  const o = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const limites = Array.isArray(o.limites) ? o.limites : null;
  const teste = Array.isArray(o.teste) ? o.teste : null;
  return {
    pacote: texto(o.pacote) ?? texto(o.contrato_pacote),
    modulos: lista(o.modulos) ?? lista(o.contrato) ?? lista(o.modulos_contratados),
    recursos: lista(o.recursos) ?? lista(o.recursos_contratados),
    limiteObras: 'limiteObras' in o ? numeroOuNulo(o.limiteObras) : limites ? numeroOuNulo(limites[0]) : 'limite_obras' in o ? numeroOuNulo(o.limite_obras) : undefined,
    limiteUsuarios: 'limiteUsuarios' in o ? numeroOuNulo(o.limiteUsuarios) : limites ? numeroOuNulo(limites[1]) : 'limite_usuarios' in o ? numeroOuNulo(o.limite_usuarios) : undefined,
    testeFim: 'testeFim' in o ? dataOuNula(o.testeFim) : teste ? dataOuNula(teste[1]) : 'teste_fim' in o ? dataOuNula(o.teste_fim) : undefined,
  };
}

const nomePacote = (p: string) => (NOMES_PACOTE as Record<string, string>)[p] ?? p;
const nomeModulo = (m: string) => (NOMES_MODULO as Record<string, string>)[m] ?? m;
const nomeRecurso = (r: string) => (NOMES_RECURSO as Record<string, string>)[r] ?? r;
const limite = (n: number | null) => (n === null ? 'sem limite' : String(n));
const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
/** Configurações vem em todo contrato: fica fora das listas para não virar ruído. */
const semConfiguracoes = (l: string[]) => l.filter((m) => m !== 'configuracoes');

function diferenca(antes: string[], depois: string[]) {
  return { entraram: depois.filter((x) => !antes.includes(x)), sairam: antes.filter((x) => !depois.includes(x)) };
}

/** O que mudou entre dois contratos, em frases. Vazio se nada que o registro guardou mudou. */
export function descreverMudancas(antes: ContratoRegistrado, depois: ContratoRegistrado): string[] {
  const frases: string[] = [];
  if (depois.pacote && depois.pacote !== antes.pacote) {
    frases.push(antes.pacote ? `Pacote: ${nomePacote(antes.pacote)} → ${nomePacote(depois.pacote)}` : `Pacote: ${nomePacote(depois.pacote)}`);
  }
  if (depois.modulos) {
    const novos = semConfiguracoes(depois.modulos);
    if (antes.modulos) {
      const { entraram, sairam } = diferenca(semConfiguracoes(antes.modulos), novos);
      if (entraram.length) frases.push(`Módulos liberados: ${entraram.map(nomeModulo).join(', ')}`);
      if (sairam.length) frases.push(`Módulos retirados: ${sairam.map(nomeModulo).join(', ')}`);
    } else {
      frases.push(`Módulos: ${novos.map(nomeModulo).join(', ') || 'nenhum'}`);
    }
  }
  if (depois.recursos) {
    if (antes.recursos) {
      const { entraram, sairam } = diferenca(antes.recursos, depois.recursos);
      if (entraram.length) frases.push(`Recursos do canteiro liberados: ${entraram.map(nomeRecurso).join(', ')}`);
      if (sairam.length) frases.push(`Recursos do canteiro retirados: ${sairam.map(nomeRecurso).join(', ')}`);
    } else if (depois.recursos.length) {
      frases.push(`Recursos do canteiro: ${depois.recursos.map(nomeRecurso).join(', ')}`);
    }
  }
  const rotulos: [keyof ContratoRegistrado, string][] = [
    ['limiteObras', 'Limite de obras'],
    ['limiteUsuarios', 'Limite de usuários'],
  ];
  for (const [campo, rotulo] of rotulos) {
    const novo = depois[campo] as number | null | undefined;
    const velho = antes[campo] as number | null | undefined;
    if (novo === undefined || novo === velho) continue;
    frases.push(velho === undefined ? `${rotulo}: ${limite(novo)}` : `${rotulo}: ${limite(velho)} → ${limite(novo)}`);
  }
  if (depois.testeFim !== undefined && depois.testeFim !== (antes.testeFim ?? null)) {
    frases.push(depois.testeFim ? `Teste até ${dataBr(depois.testeFim)}` : 'Teste encerrado');
  }
  return frases;
}
