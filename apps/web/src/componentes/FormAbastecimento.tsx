import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, ErroApi, agoraLocal, formatarDataHoraCurta, formatarMoeda, formatarNumero, lerNumero, type Abastecimento, type Motorista, type Veiculo } from '../api';

type Dados = {
  veiculoId: string;
  motoristaId: string;
  dataHora: string;
  origem: 'posto' | 'tanque_proprio';
  posto: string;
  litros: string;
  valorTotal: string;
  km: string;
  horimetro: string;
  observacoes: string;
};

type Leitura = { km: number | null; horimetro: number | null; dataHora: string | null };

const n2 = (v: number | null, c = 0) => (v === null ? '' : formatarNumero(v, c));

export function dadosDe(a?: Abastecimento): Dados {
  return {
    veiculoId: a?.veiculoId ?? '',
    motoristaId: a?.motoristaId ?? '',
    dataHora: a ? agoraLocal(new Date(a.dataHora)) : agoraLocal(),
    origem: a?.origem ?? 'posto',
    posto: a?.posto ?? '',
    litros: a ? n2(a.litros, 1) : '',
    valorTotal: a?.valorTotal != null ? n2(a.valorTotal, 2) : '',
    km: a?.km != null ? n2(a.km) : '',
    horimetro: a?.horimetro != null ? n2(a.horimetro, 1) : '',
    observacoes: a?.observacoes ?? '',
  };
}

export function FormAbastecimento({
  veiculos,
  motoristas,
  editando,
  gestao,
  aoSalvar,
  aoCancelar,
}: {
  veiculos: Veiculo[];
  motoristas?: Motorista[];
  editando?: Abastecimento;
  gestao: boolean;
  aoSalvar: (a: Abastecimento) => void;
  aoCancelar?: () => void;
}) {
  const [d, setD] = useState<Dados>(() => dadosDe(editando));
  const [leitura, setLeitura] = useState<Leitura | null>(null);
  const [erro, setErro] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [salvando, setSalvando] = useState(false);
  const mudar = <K extends keyof Dados>(k: K, v: Dados[K]) => {
    setD((a) => ({ ...a, [k]: v }));
    setConfirmar('');
  };

  const veiculo = veiculos.find((v) => v.id === d.veiculoId);
  const bomba = veiculo ? veiculo.tipo.startsWith('bomba') : false;

  useEffect(() => {
    setLeitura(null);
    if (!d.veiculoId || editando) return;
    api<Leitura>(`/frota/abastecimentos/ultima-leitura?veiculoId=${d.veiculoId}`)
      .then(setLeitura)
      .catch(() => setLeitura(null));
  }, [d.veiculoId, editando]);

  const previa = useMemo(() => {
    const litros = lerNumero(d.litros);
    const valor = lerNumero(d.valorTotal);
    const km = lerNumero(d.km);
    const hor = lerNumero(d.horimetro);
    const kmRod = leitura?.km != null && km !== null ? km - leitura.km : null;
    const horas = leitura?.horimetro != null && hor !== null ? hor - leitura.horimetro : null;
    return {
      preco: litros && valor ? valor / litros : null,
      kmRod,
      horas,
      kmL: litros && kmRod && kmRod > 0 ? kmRod / litros : null,
      lh: litros && horas && horas > 0 ? litros / horas : null,
    };
  }, [d, leitura]);

  async function enviar(e: FormEvent, confirmarSalto = false) {
    e.preventDefault();
    setErro('');
    setSalvando(true);
    try {
      const corpo = {
        veiculoId: d.veiculoId,
        motoristaId: gestao ? d.motoristaId || null : undefined,
        dataHora: d.dataHora,
        origem: d.origem,
        posto: d.origem === 'posto' ? d.posto : null,
        litros: d.litros,
        valorTotal: d.valorTotal,
        km: d.km,
        horimetro: d.horimetro,
        observacoes: d.observacoes,
        confirmarSalto,
      };
      const r = editando
        ? await api<{ abastecimento: Abastecimento }>(`/frota/abastecimentos/${editando.id}`, { metodo: 'PATCH', corpo })
        : await api<{ abastecimento: Abastecimento }>('/frota/abastecimentos', { corpo });
      aoSalvar(r.abastecimento);
    } catch (err) {
      if (err instanceof ErroApi && err.status === 422) setConfirmar(err.message);
      else setErro((err as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  const ativos = veiculos.filter((v) => v.status !== 'inativo');

  return (
    <form className="form" onSubmit={(e) => enviar(e)} noValidate>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div className="campo">
        <label htmlFor="ab-veiculo">Veículo</label>
        <select id="ab-veiculo" className="mono" value={d.veiculoId} onChange={(e) => mudar('veiculoId', e.target.value)}>
          <option value="">Escolha o veículo</option>
          {ativos.map((v) => (
            <option key={v.id} value={v.id}>
              {v.codigo}
              {v.placa ? ` · ${v.placa}` : ''}
            </option>
          ))}
        </select>
      </div>

      {gestao && motoristas && (
        <div className="campo">
          <label htmlFor="ab-motorista">Motorista</label>
          <select id="ab-motorista" value={d.motoristaId} onChange={(e) => mudar('motoristaId', e.target.value)}>
            <option value="">Não informado</option>
            {motoristas.filter((m) => m.ativo || m.id === d.motoristaId).map((m) => (
              <option key={m.id} value={m.id}>{m.nome}</option>
            ))}
          </select>
        </div>
      )}

      <div className="campo">
        <span className="rotulo" id="ab-origem-rotulo">Onde abasteceu</span>
        <div className="segmentado" role="group" aria-labelledby="ab-origem-rotulo">
          <button type="button" aria-pressed={d.origem === 'posto'} className={d.origem === 'posto' ? 'ativo' : ''} onClick={() => mudar('origem', 'posto')}>
            Posto
          </button>
          <button type="button" aria-pressed={d.origem === 'tanque_proprio'} className={d.origem === 'tanque_proprio' ? 'ativo' : ''} onClick={() => mudar('origem', 'tanque_proprio')}>
            Tanque próprio
          </button>
        </div>
      </div>

      {d.origem === 'posto' && (
        <div className="campo">
          <label htmlFor="ab-posto">Posto</label>
          <input id="ab-posto" value={d.posto} onChange={(e) => mudar('posto', e.target.value)} placeholder="Nome do posto" />
        </div>
      )}

      <div className="dois">
        <div className="campo">
          <label htmlFor="ab-litros">Litros</label>
          <input id="ab-litros" className="mono" inputMode="decimal" value={d.litros} onChange={(e) => mudar('litros', e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="ab-valor">Valor total (R$)</label>
          <input id="ab-valor" className="mono" inputMode="decimal" value={d.valorTotal} onChange={(e) => mudar('valorTotal', e.target.value)} />
        </div>
      </div>

      <div className="dois">
        <div className="campo">
          <label htmlFor="ab-km">Km no painel{bomba ? ' (opcional)' : ''}</label>
          <input id="ab-km" className="mono" inputMode="numeric" value={d.km} onChange={(e) => mudar('km', e.target.value)} />
          {leitura?.km != null && (
            <span className="ajuda mono">
              Último: {formatarNumero(leitura.km)}
              {previa.kmRod !== null && previa.kmRod >= 0 ? ` · +${formatarNumero(previa.kmRod)} km` : ''}
            </span>
          )}
        </div>
        <div className="campo">
          <label htmlFor="ab-hor">Horímetro</label>
          <input id="ab-hor" className="mono" inputMode="decimal" value={d.horimetro} onChange={(e) => mudar('horimetro', e.target.value)} />
          {leitura?.horimetro != null && (
            <span className="ajuda mono">
              Último: {formatarNumero(leitura.horimetro, 1)}
              {previa.horas !== null && previa.horas >= 0 ? ` · +${formatarNumero(previa.horas, 1)} h` : ''}
            </span>
          )}
        </div>
      </div>

      <div className="previa" aria-live="polite">
        <div>
          <span>Preço/L</span>
          <strong className="mono">{previa.preco ? formatarMoeda(previa.preco) : '—'}</strong>
        </div>
        <div>
          <span>Consumo</span>
          <strong className="mono">{previa.kmL ? `${formatarNumero(previa.kmL, 2)} km/L` : '—'}</strong>
        </div>
        <div>
          <span>Por hora</span>
          <strong className="mono">{previa.lh ? `${formatarNumero(previa.lh, 1)} L/h` : '—'}</strong>
        </div>
      </div>

      <div className="campo">
        <label htmlFor="ab-data">Data e hora</label>
        <input id="ab-data" type="datetime-local" value={d.dataHora} onChange={(e) => mudar('dataHora', e.target.value)} />
        {leitura?.dataHora && <span className="ajuda">Último abastecimento deste veículo: {formatarDataHoraCurta(leitura.dataHora)}</span>}
      </div>

      <div className="campo">
        <label htmlFor="ab-obs">Observação (opcional)</label>
        <input id="ab-obs" value={d.observacoes} onChange={(e) => mudar('observacoes', e.target.value)} />
      </div>

      {confirmar ? (
        <div className="alerta alerta-aviso" role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span>{confirmar}</span>
          <div className="acoes">
            <button className="btn btn-primario" type="button" disabled={salvando} onClick={(e) => enviar(e as unknown as FormEvent, true)}>
              Está certo, salvar
            </button>
            <button className="btn btn-secundario" type="button" onClick={() => setConfirmar('')}>
              Corrigir
            </button>
          </div>
        </div>
      ) : (
        <div className="acoes">
          <button className="btn btn-primario btn-bloco" type="submit" disabled={salvando || !d.veiculoId || !d.litros}>
            {salvando ? 'Salvando…' : editando ? 'Salvar correção' : 'Salvar abastecimento'}
          </button>
          {aoCancelar && (
            <button className="btn btn-secundario" type="button" onClick={aoCancelar}>
              Cancelar
            </button>
          )}
        </div>
      )}
      {!gestao && <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>A despesa do diesel entra pela nota do posto.</p>}
    </form>
  );
}
