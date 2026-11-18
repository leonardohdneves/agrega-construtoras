// Canteiro de obra: quatro centrais por obra (argamassa, carpintaria, armação e almoxarifado).
// Cada boletim é um período (início a fim). Para cada serviço da central, o PREVISTO é o avanço planejado no período
// (das atividades do planejamento, distribuído linearmente nos dias) e o REALIZADO é o avanço medido no período
// (das medições físicas do acompanhamento). Funções puras. Datas em ISO (AAAA-MM-DD).
import { diasEntre, percentuaisEm, somarDias, type Medicao } from './acompanhamento.ts';

export const CENTRAIS = ['argamassa', 'carpintaria', 'armacao', 'almoxarifado'] as const;
export type TipoCentral = (typeof CENTRAIS)[number];
export const NOMES_CENTRAL: Record<TipoCentral, string> = {
  argamassa: 'Central de argamassa',
  carpintaria: 'Central de carpintaria',
  armacao: 'Central de armação',
  almoxarifado: 'Almoxarifado',
};
export const PERIODICIDADE_PADRAO = 7;

export type AtividadeCanteiro = { eapNoId: string | null; inicio: string; fim: string };

const limitar = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Avanço planejado (0 a 100) de um serviço até a data: média das atividades ligadas a ele. Sem atividade: null. */
export function previstoAte(atividades: AtividadeCanteiro[], eapNoId: string, data: string): number | null {
  const lista = atividades.filter((a) => a.eapNoId === eapNoId);
  if (!lista.length) return null;
  let soma = 0;
  for (const a of lista) {
    const dias = diasEntre(a.inicio, a.fim) + 1;
    const passados = limitar(diasEntre(a.inicio, data) + 1, 0, dias);
    soma += (passados / Math.max(dias, 1)) * 100;
  }
  return soma / lista.length;
}

const arredondar = (n: number) => Math.round(n * 100) / 100;

/** Itens do boletim: avanço previsto e realizado DENTRO do período (fim menos o dia anterior ao início). */
export function montarItensBoletim(args: {
  servicos: string[];
  atividades: AtividadeCanteiro[];
  medicoes: Medicao[];
  inicio: string;
  fim: string;
}): { eapNoId: string; previstoPct: number; realizadoPct: number }[] {
  const diaAntes = somarDias(args.inicio, -1);
  const realFim = percentuaisEm(args.medicoes, args.fim);
  const realAntes = percentuaisEm(args.medicoes, diaAntes);
  return args.servicos.map((eapNoId) => {
    const previsto = (previstoAte(args.atividades, eapNoId, args.fim) ?? 0) - (previstoAte(args.atividades, eapNoId, diaAntes) ?? 0);
    const realizado = (realFim.get(eapNoId) ?? 0) - (realAntes.get(eapNoId) ?? 0);
    return { eapNoId, previstoPct: arredondar(Math.max(0, previsto)), realizadoPct: arredondar(Math.max(0, realizado)) };
  });
}

/** Próximo período da central: começa no dia seguinte ao último boletim (ou no início da obra, ou hoje) e dura a periodicidade. */
export function proximoPeriodo(args: { ultimoFim: string | null; inicioObra: string | null; hoje: string; periodicidadeDias: number }): { inicio: string; fim: string } {
  const inicio = args.ultimoFim ? somarDias(args.ultimoFim, 1) : args.inicioObra ?? args.hoje;
  return { inicio, fim: somarDias(inicio, Math.max(1, args.periodicidadeDias) - 1) };
}
