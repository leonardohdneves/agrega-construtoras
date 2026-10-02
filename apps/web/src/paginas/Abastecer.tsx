import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatarDataHoraCurta, formatarMoeda, formatarNumero, type Abastecimento, type Motorista, type Veiculo } from '../api';
import { useSessao } from '../sessao';
import { FormAbastecimento } from '../componentes/FormAbastecimento';

export function Abastecer() {
  const { usuario } = useSessao();
  const gestao = usuario?.perfil === 'dono' || usuario?.perfil === 'gestor';
  const [veiculos, setVeiculos] = useState<Veiculo[] | null>(null);
  const [motoristas, setMotoristas] = useState<Motorista[]>([]);
  const [recentes, setRecentes] = useState<Abastecimento[]>([]);
  const [salvo, setSalvo] = useState<Abastecimento | null>(null);
  const [chave, setChave] = useState(0);
  const [erro, setErro] = useState('');

  const carregarRecentes = useCallback(async () => {
    try {
      const r = await api<{ abastecimentos: Abastecimento[] }>(`/frota/abastecimentos?dias=${gestao ? 7 : 30}`);
      setRecentes(r.abastecimentos.slice(0, 8));
    } catch {
      setRecentes([]);
    }
  }, [gestao]);

  useEffect(() => {
    (async () => {
      try {
        setVeiculos((await api<{ veiculos: Veiculo[] }>('/frota/veiculos')).veiculos);
        if (gestao) setMotoristas((await api<{ motoristas: Motorista[] }>('/frota/motoristas')).motoristas);
      } catch (e) {
        setErro((e as Error).message);
      }
    })();
    carregarRecentes();
  }, [gestao, carregarRecentes]);

  return (
    <div style={{ maxWidth: 560, width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Registrar abastecimento</h1>
          <span className="muted">Preencha com os números da bomba e do painel do caminhão.</span>
        </div>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}

      {salvo ? (
        <div className="card form">
          <div className="alerta alerta-ok" role="status">
            Abastecimento do <strong className="mono">{salvo.veiculoCodigo}</strong> salvo.
          </div>
          <div className="previa">
            <div>
              <span>Litros</span>
              <strong className="mono">{formatarNumero(salvo.litros, 1)}</strong>
            </div>
            <div>
              <span>Consumo</span>
              <strong className="mono">{salvo.kmPorLitro ? `${formatarNumero(salvo.kmPorLitro, 2)} km/L` : '—'}</strong>
            </div>
            <div>
              <span>Por hora</span>
              <strong className="mono">{salvo.litrosPorHora ? `${formatarNumero(salvo.litrosPorHora, 1)} L/h` : '—'}</strong>
            </div>
          </div>
          <button
            className="btn btn-primario btn-bloco"
            type="button"
            onClick={() => {
              setSalvo(null);
              setChave((k) => k + 1);
            }}
          >
            Registrar outro
          </button>
          <Link to="/" className="btn btn-secundario">
            Voltar ao início
          </Link>
        </div>
      ) : !veiculos ? (
        <p className="muted">Carregando…</p>
      ) : (
        <div className="card">
          <FormAbastecimento
            key={chave}
            veiculos={veiculos}
            motoristas={gestao ? motoristas : undefined}
            gestao={gestao}
            aoSalvar={(a) => {
              setSalvo(a);
              carregarRecentes();
              window.scrollTo({ top: 0 });
            }}
          />
        </div>
      )}

      {recentes.length > 0 && (
        <div className="card">
          <h2>{gestao ? 'Lançados nos últimos 7 dias' : 'Seus últimos abastecimentos'}</h2>
          <ul className="lista-alertas">
            {recentes.map((a) => (
              <li key={a.id}>
                <span>
                  <strong className="mono">{a.veiculoCodigo}</strong>
                  <span className="small muted"> · {formatarDataHoraCurta(a.dataHora)}</span>
                  <div className="small mono muted">
                    {formatarNumero(a.litros, 1)} L{a.valorTotal != null ? ` · ${formatarMoeda(a.valorTotal)}` : ''}
                  </div>
                </span>
                <span className="mono small">{a.kmPorLitro ? `${formatarNumero(a.kmPorLitro, 2)} km/L` : a.litrosPorHora ? `${formatarNumero(a.litrosPorHora, 1)} L/h` : '—'}</span>
              </li>
            ))}
          </ul>
          {gestao && (
            <Link to="/frota/abastecimentos" className="small" style={{ fontWeight: 600, textDecoration: 'none' }}>
              Ver todos os abastecimentos ›
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
