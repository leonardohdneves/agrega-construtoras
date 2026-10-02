import { hojeLocal, somarMeses } from '../api';

export type Periodo = { de: string; ate: string };

const mesAtual = () => hojeLocal().slice(0, 7);
const voltar = (m: string, n: number) => somarMeses(`${m}-01`, -n).slice(0, 7);

export const ATALHOS: { id: string; texto: string; periodo: () => Periodo }[] = [
  { id: 'mes', texto: 'Este mês', periodo: () => ({ de: mesAtual(), ate: mesAtual() }) },
  { id: 'anterior', texto: 'Mês passado', periodo: () => ({ de: voltar(mesAtual(), 1), ate: voltar(mesAtual(), 1) }) },
  { id: '3m', texto: '3 meses', periodo: () => ({ de: voltar(mesAtual(), 2), ate: mesAtual() }) },
  { id: '6m', texto: '6 meses', periodo: () => ({ de: voltar(mesAtual(), 5), ate: mesAtual() }) },
  { id: 'ano', texto: 'Este ano', periodo: () => ({ de: `${mesAtual().slice(0, 4)}-01`, ate: mesAtual() }) },
  { id: '12m', texto: '12 meses', periodo: () => ({ de: voltar(mesAtual(), 11), ate: mesAtual() }) },
];

const NOMES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
/** "2026-10" → "out/26" */
export function mesCurto(m: string): string {
  const [a, mm] = m.split('-').map(Number);
  return `${NOMES[mm - 1]}/${String(a).slice(2)}`;
}

/** Atalhos de período e meses de início e fim. */
export function SeletorPeriodo({ valor, aoMudar }: { valor: Periodo; aoMudar: (p: Periodo) => void }) {
  const atual = ATALHOS.find((a) => {
    const p = a.periodo();
    return p.de === valor.de && p.ate === valor.ate;
  });
  return (
    <div className="filtros">
      {ATALHOS.map((a) => (
        <button key={a.id} type="button" className={`chip ${atual?.id === a.id ? 'chip-ativo' : ''}`} aria-pressed={atual?.id === a.id} onClick={() => aoMudar(a.periodo())}>
          {a.texto}
        </button>
      ))}
      <span className="periodo-manual">
        <input type="month" aria-label="Mês inicial" value={valor.de} max={valor.ate} onChange={(e) => e.target.value && aoMudar({ ...valor, de: e.target.value })} />
        <span className="muted">até</span>
        <input type="month" aria-label="Mês final" value={valor.ate} min={valor.de} onChange={(e) => e.target.value && aoMudar({ ...valor, ate: e.target.value })} />
      </span>
    </div>
  );
}
