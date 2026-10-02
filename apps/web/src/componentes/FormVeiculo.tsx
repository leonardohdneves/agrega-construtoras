import { useState, type FormEvent } from 'react';
import { NOMES_STATUS_VEICULO, NOMES_TIPO_VEICULO, formatarNumero, type StatusVeiculo, type TipoVeiculo, type Veiculo } from '../api';

export type DadosVeiculo = {
  codigo: string;
  tipo: TipoVeiculo;
  placa: string;
  marcaModelo: string;
  ano: string;
  capacidadeM3: string;
  alcanceLancaM: string;
  kmAtual: string;
  horimetroAtual: string;
  status: StatusVeiculo;
  observacoes: string;
};

const casas = (n: number | null, c = 0) => (n === null || n === undefined ? '' : formatarNumero(n, c));

export function dadosDoVeiculo(v?: Veiculo): DadosVeiculo {
  return {
    codigo: v?.codigo ?? '',
    tipo: v?.tipo ?? 'betoneira',
    placa: v?.placa ?? '',
    marcaModelo: v?.marcaModelo ?? '',
    ano: v?.ano ? String(v.ano) : '',
    capacidadeM3: casas(v?.capacidadeM3 ?? null, 1),
    alcanceLancaM: casas(v?.alcanceLancaM ?? null, 0),
    kmAtual: v ? casas(v.kmAtual) : '',
    horimetroAtual: v ? casas(v.horimetroAtual) : '',
    status: v?.status ?? 'disponivel',
    observacoes: v?.observacoes ?? '',
  };
}

export function FormVeiculo({
  inicial,
  titulo,
  rotuloSalvar,
  aoSalvar,
  aoCancelar,
}: {
  inicial: DadosVeiculo;
  titulo: string;
  rotuloSalvar: string;
  aoSalvar: (d: DadosVeiculo) => Promise<void>;
  aoCancelar: () => void;
}) {
  const [d, setD] = useState(inicial);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const mudar = <K extends keyof DadosVeiculo>(k: K, v: DadosVeiculo[K]) => setD((a) => ({ ...a, [k]: v }));
  const bomba = d.tipo === 'bomba_lanca' || d.tipo === 'bomba_estacionaria';

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setSalvando(true);
    try {
      await aoSalvar(d);
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form className="card form" onSubmit={enviar}>
      <h2>{titulo}</h2>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div className="campos">
        <div className="campo">
          <label htmlFor="v-codigo">Código</label>
          <input id="v-codigo" className="mono" placeholder="BET-01" value={d.codigo} onChange={(e) => mudar('codigo', e.target.value.toUpperCase())} />
        </div>
        <div className="campo">
          <label htmlFor="v-tipo">Tipo</label>
          <select id="v-tipo" value={d.tipo} onChange={(e) => mudar('tipo', e.target.value as TipoVeiculo)}>
            {Object.entries(NOMES_TIPO_VEICULO).map(([v, r]) => (
              <option key={v} value={v}>{r}</option>
            ))}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="v-placa">Placa</label>
          <input id="v-placa" className="mono" placeholder="ABC1D23" value={d.placa} onChange={(e) => mudar('placa', e.target.value.toUpperCase())} />
        </div>
        <div className="campo">
          <label htmlFor="v-modelo">Marca e modelo</label>
          <input id="v-modelo" value={d.marcaModelo} onChange={(e) => mudar('marcaModelo', e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="v-ano">Ano</label>
          <input id="v-ano" className="mono" inputMode="numeric" value={d.ano} onChange={(e) => mudar('ano', e.target.value)} />
        </div>
        {bomba ? (
          <div className="campo">
            <label htmlFor="v-lanca">Alcance da lança (m)</label>
            <input id="v-lanca" className="mono" inputMode="decimal" value={d.alcanceLancaM} onChange={(e) => mudar('alcanceLancaM', e.target.value)} />
          </div>
        ) : (
          <div className="campo">
            <label htmlFor="v-cap">Capacidade do balão (m³)</label>
            <input id="v-cap" className="mono" inputMode="decimal" value={d.capacidadeM3} onChange={(e) => mudar('capacidadeM3', e.target.value)} />
          </div>
        )}
        <div className="campo">
          <label htmlFor="v-km">Km atual</label>
          <input id="v-km" className="mono" inputMode="numeric" value={d.kmAtual} onChange={(e) => mudar('kmAtual', e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="v-hor">Horímetro atual (h)</label>
          <input id="v-hor" className="mono" inputMode="decimal" value={d.horimetroAtual} onChange={(e) => mudar('horimetroAtual', e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="v-status">Situação</label>
          <select id="v-status" value={d.status} onChange={(e) => mudar('status', e.target.value as StatusVeiculo)}>
            {Object.entries(NOMES_STATUS_VEICULO).map(([v, r]) => (
              <option key={v} value={v}>{r}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="campo">
        <label htmlFor="v-obs">Observações</label>
        <input id="v-obs" value={d.observacoes} onChange={(e) => mudar('observacoes', e.target.value)} />
      </div>
      <div className="acoes">
        <button className="btn btn-primario" type="submit" disabled={salvando}>
          {salvando ? 'Salvando…' : rotuloSalvar}
        </button>
        <button className="btn btn-secundario" type="button" onClick={aoCancelar}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
