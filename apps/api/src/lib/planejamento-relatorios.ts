// Relatórios do planejamento: Gantt, equipes e compras. Funções puras (sem banco), calculadas em dias corridos.
// Datas em ISO (AAAA-MM-DD), interpretadas em UTC para não variar com o fuso do servidor.

export type Granularidade = 'dia' | 'semana' | 'quinzena' | 'mes';
export const GRANULARIDADES: Granularidade[] = ['dia', 'semana', 'quinzena', 'mes'];

const DIA_MS = 86_400_000;
const paraMs = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const paraIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const diasEntre = (a: string, b: string) => Math.round((paraMs(b) - paraMs(a)) / DIA_MS);
const somar = (iso: string, dias: number) => paraIso(paraMs(iso) + dias * DIA_MS);
const dd = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7);

export type Periodo = { rotulo: string; inicio: string; fim: string; dias: number };

/**
 * Divide o intervalo [inicio, fim] em períodos.
 * - dia: um dia por coluna.
 * - semana: blocos de 7 dias a partir do início do projeto.
 * - quinzena: calendário, dias 1 a 15 e 16 até o fim do mês.
 * - mes: calendário.
 */
export function periodosDoIntervalo(inicio: string, fim: string, gran: Granularidade): Periodo[] {
  const saida: Periodo[] = [];
  if (diasEntre(inicio, fim) < 0) return saida;
  if (gran === 'dia' || gran === 'semana') {
    const passo = gran === 'dia' ? 1 : 7;
    let i = 0;
    for (let ini = inicio; diasEntre(ini, fim) >= 0; ini = somar(ini, passo), i++) {
      const f = somar(ini, passo - 1) > fim ? fim : somar(ini, passo - 1);
      const dias = diasEntre(ini, f) + 1;
      const rotulo = gran === 'dia' ? dd(ini) : `S${i + 1} ${dd(ini)}`;
      saida.push({ rotulo, inicio: ini, fim: f, dias });
    }
    return saida;
  }
  // Calendário: quinzena ou mês.
  let ini = inicio;
  while (diasEntre(ini, fim) >= 0) {
    const ano = Number(ini.slice(0, 4));
    const mes = Number(ini.slice(5, 7));
    const ultimoDoMes = paraIso(Date.UTC(ano, mes, 0));
    const dia = Number(ini.slice(8, 10));
    let f: string;
    let rotulo: string;
    if (gran === 'mes') {
      f = ultimoDoMes;
      rotulo = `${ini.slice(5, 7)}/${ano}`;
    } else if (dia <= 15) {
      f = `${ini.slice(0, 8)}15`;
      rotulo = `1ª quinz. ${ini.slice(5, 7)}/${ano}`;
    } else {
      f = ultimoDoMes;
      rotulo = `2ª quinz. ${ini.slice(5, 7)}/${ano}`;
    }
    // O último período é cortado no fim do intervalo.
    const fimDoPeriodo = diasEntre(f, fim) < 0 ? fim : f;
    saida.push({ rotulo, inicio: ini, fim: fimDoPeriodo, dias: diasEntre(ini, fimDoPeriodo) + 1 });
    ini = somar(fimDoPeriodo, 1);
  }
  return saida;
}

export type AtividadeGantt = { id: string; descricao: string; eapCodigo: string | null; inicio: string; fim: string; duracaoDias: number; predecessoraId: string | null };

/** Gantt: projeto, períodos e a posição de cada barra em dias a partir do início do projeto. */
export function montarGantt(atividades: AtividadeGantt[], gran: Granularidade) {
  if (!atividades.length) return { inicio: null, fim: null, totalDias: 0, periodos: [], atividades: [] };
  const inicio = atividades.reduce((m, a) => (a.inicio < m ? a.inicio : m), atividades[0].inicio);
  const fim = atividades.reduce((m, a) => (a.fim > m ? a.fim : m), atividades[0].fim);
  const totalDias = diasEntre(inicio, fim) + 1;
  return {
    inicio,
    fim,
    totalDias,
    periodos: periodosDoIntervalo(inicio, fim, gran),
    atividades: atividades.map((a) => ({
      ...a,
      deslocamentoDias: diasEntre(inicio, a.inicio),
      duracaoDias: a.duracaoDias,
    })),
  };
}

// ---------------------------------------------------------------- equipes

export type RecursoAtividade = { codigo: string; descricao: string; horas: number };
export type AtividadeEquipe = { id: string; descricao: string; inicio: string; duracaoDias: number; recursos: RecursoAtividade[] };

/**
 * Equipes por período: para cada mão de obra, quantos trabalhadores são necessários por dia para cumprir o prazo.
 * Trabalhadores no dia = horas da atividade ÷ duração ÷ horas por dia. Em cada período, vale o pico diário (arredondado para cima).
 */
export function montarEquipes(atividades: AtividadeEquipe[], horasDia: number, gran: Granularidade) {
  if (!atividades.length || horasDia <= 0) return { inicio: null, fim: null, periodos: [], porTipo: [], porAtividade: [], pico: 0 };
  const inicio = atividades.reduce((m, a) => (a.inicio < m ? a.inicio : m), atividades[0].inicio);
  const fimDe = (a: AtividadeEquipe) => somar(a.inicio, Math.max(1, a.duracaoDias) - 1);
  const fim = atividades.reduce((m, a) => (fimDe(a) > m ? fimDe(a) : m), fimDe(atividades[0]));
  const periodos = periodosDoIntervalo(inicio, fim, gran);

  // Carga diária por código de mão de obra.
  const carga = new Map<string, { descricao: string; dias: Map<string, number> }>();
  for (const a of atividades) {
    const dur = Math.max(1, a.duracaoDias);
    for (const r of a.recursos) {
      const porDia = r.horas / dur / horasDia;
      let entrada = carga.get(r.codigo);
      if (!entrada) carga.set(r.codigo, (entrada = { descricao: r.descricao, dias: new Map() }));
      for (let k = 0; k < dur; k++) {
        const dia = somar(a.inicio, k);
        entrada.dias.set(dia, (entrada.dias.get(dia) ?? 0) + porDia);
      }
    }
  }

  const porTipo = [...carga.entries()]
    .map(([codigo, { descricao, dias }]) => {
      const porPeriodo = periodos.map((p) => {
        let pico = 0;
        for (let d = p.inicio; diasEntre(d, p.fim) >= 0; d = somar(d, 1)) pico = Math.max(pico, dias.get(d) ?? 0);
        return { rotulo: p.rotulo, trabalhadores: Math.ceil(pico - 1e-9) };
      });
      return { codigo, descricao, pico: Math.max(0, ...porPeriodo.map((x) => x.trabalhadores)), periodos: porPeriodo };
    })
    .sort((x, y) => y.pico - x.pico || x.descricao.localeCompare(y.descricao, 'pt-BR'));

  const porAtividade = atividades.map((a) => {
    const dur = Math.max(1, a.duracaoDias);
    const trabalhadores = a.recursos.map((r) => ({ codigo: r.codigo, descricao: r.descricao, horas: r.horas, trabalhadores: Math.ceil(r.horas / dur / horasDia - 1e-9) }));
    return { id: a.id, descricao: a.descricao, inicio: a.inicio, fim: fimDe(a), duracaoDias: dur, recursos: trabalhadores };
  });

  return { inicio, fim, periodos: periodos.map((p) => p.rotulo), porTipo, porAtividade, pico: Math.max(0, ...porTipo.map((t) => t.pico)) };
}

// ---------------------------------------------------------------- compras

/** Classes SINAPI que não são compradas como material: mão de obra, equipamento (locado) e serviço terceirizado. */
const CLASSES_NAO_COMPRADAS = new Set(['Mao_obra', 'Equipamento', 'Terceirizados']);

export type InsumoAtividade = { codigo: string; descricao: string; unidade: string; grupo: string | null; quantidade: number };
export type AtividadeCompra = { id: string; descricao: string; inicio: string; insumos: InsumoAtividade[] };

/** Materiais a entregar: a quantidade total de cada insumo e a data da primeira atividade que o usa. */
export function montarCompras(atividades: AtividadeCompra[]) {
  const porInsumo = new Map<string, { codigo: string; descricao: string; unidade: string; grupo: string | null; total: number; primeira: string; usos: { atividade: string; inicio: string; quantidade: number }[] }>();
  for (const a of atividades) {
    for (const i of a.insumos) {
      if (i.grupo && CLASSES_NAO_COMPRADAS.has(i.grupo)) continue;
      let e = porInsumo.get(i.codigo);
      if (!e) porInsumo.set(i.codigo, (e = { codigo: i.codigo, descricao: i.descricao, unidade: i.unidade, grupo: i.grupo, total: 0, primeira: a.inicio, usos: [] }));
      e.total += i.quantidade;
      if (a.inicio < e.primeira) e.primeira = a.inicio;
      e.usos.push({ atividade: a.descricao, inicio: a.inicio, quantidade: i.quantidade });
    }
  }
  return [...porInsumo.values()]
    .map((e) => ({ ...e, usos: e.usos.sort((x, y) => (x.inicio < y.inicio ? -1 : x.inicio > y.inicio ? 1 : 0)) }))
    .sort((x, y) => (x.primeira < y.primeira ? -1 : x.primeira > y.primeira ? 1 : x.descricao.localeCompare(y.descricao, 'pt-BR')));
}
