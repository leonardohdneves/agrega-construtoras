import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, formatarData, NOMES_PERFIL, NOMES_TIPO_DOCUMENTO, seloVencimento, type Alerta, type DocumentoVeiculo } from '../api';
import { useSessao } from '../sessao';

const ETAPAS = [
  { n: 0, nome: 'Base: login, perfis, empresa e usuários', pronta: true },
  { n: 1, nome: 'Cadastros da frota: veículos, motoristas e documentos', pronta: true },
  { n: 2, nome: 'Abastecimento pelo celular, km/L e L/h' },
  { n: 3, nome: 'Manutenção preventiva e ordens de serviço' },
  { n: 4, nome: 'Financeiro: contas, plano de contas, a pagar e a receber' },
  { n: 5, nome: 'Nota fiscal: lançamento manual e importação de XML' },
  { n: 6, nome: 'Conciliação bancária com OFX' },
  { n: 7, nome: 'Relatórios: DRE, fluxo de caixa e custo por veículo' },
];

type Resumo = { alertas: Alerta[]; frota: { disponivel: number; manutencao: number; parado: number; inativo: number } };

function PainelGestao() {
  const [dados, setDados] = useState<Resumo | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    api<Resumo>('/frota/alertas')
      .then(setDados)
      .catch((e) => setErro(e.message));
  }, []);

  if (erro) return <div className="alerta alerta-erro">{erro}</div>;
  const f = dados?.frota;
  const emOperacao = f ? f.disponivel + f.manutencao + f.parado : 0;

  return (
    <div className="grade">
      <div className="card">
        <div className="cabecalho" style={{ marginBottom: 12 }}>
          <h2>Frota agora</h2>
          <Link to="/frota/veiculos" className="small" style={{ fontWeight: 600, textDecoration: 'none' }}>
            Veículos ›
          </Link>
        </div>
        {!f ? (
          <p className="muted">Carregando…</p>
        ) : emOperacao === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Nenhum veículo cadastrado ainda. <Link to="/frota/veiculos">Cadastre o primeiro</Link>.
          </p>
        ) : (
          <div className="tres">
            <Link to="/frota/veiculos" className="bloco-status" style={{ background: 'var(--status-ok-bg)', color: 'var(--status-ok-ink)' }}>
              <strong>{f.disponivel}</strong>
              <span>Disponíveis</span>
            </Link>
            <Link to="/frota/veiculos" className="bloco-status" style={{ background: 'var(--status-warn-bg)', color: 'var(--status-warn-ink)' }}>
              <strong>{f.manutencao}</strong>
              <span>Na oficina</span>
            </Link>
            <Link to="/frota/veiculos" className="bloco-status" style={{ background: 'var(--status-danger-bg)', color: 'var(--status-danger-ink)' }}>
              <strong>{f.parado}</strong>
              <span>Parados</span>
            </Link>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Vencimentos nos próximos 30 dias</h2>
        {!dados ? (
          <p className="muted">Carregando…</p>
        ) : dados.alertas.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nenhum documento ou CNH vencendo. Tudo em dia.</p>
        ) : (
          <ul className="lista-alertas">
            {dados.alertas.map((a, i) => {
              const s = seloVencimento(a.situacao, a.dias);
              const nome = a.tipo === 'cnh' ? 'CNH' : NOMES_TIPO_DOCUMENTO[a.item as DocumentoVeiculo['tipo']] ?? a.item;
              return (
                <li key={i}>
                  <span style={{ minWidth: 0 }}>
                    {a.tipo === 'documento' ? (
                      <Link to={`/frota/veiculos/${a.veiculoId}`} className="mono" style={{ textDecoration: 'none', fontWeight: 500 }}>
                        {a.referencia}
                      </Link>
                    ) : (
                      <Link to="/frota/motoristas" style={{ textDecoration: 'none', fontWeight: 500 }}>
                        {a.referencia}
                      </Link>
                    )}
                    <span className="small"> · {nome}</span>
                    <div className="small muted mono">{formatarData(a.vencimento)}</div>
                  </span>
                  <span className={`selo ${s.classe}`}>{s.texto}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="card">
        <h2>Implantação do Agrega</h2>
        <ul className="lista-etapas">
          {ETAPAS.map((e) => (
            <li key={e.n}>
              <span className="small">
                <span className="mono muted">E{e.n}</span> {e.nome}
              </span>
              <span className={`selo ${e.pronta ? 'selo-ok' : 'selo-neutro'}`}>{e.pronta ? 'Pronta' : 'Em breve'}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function Painel() {
  const { usuario, empresa } = useSessao();
  if (!usuario) return null;
  const primeiroNome = usuario.nome.split(' ')[0];

  if (usuario.perfil === 'admin_sistema') {
    return (
      <>
        <div className="cabecalho">
          <div className="titulo">
            <h1>Olá, {primeiroNome}</h1>
            <span className="muted">Administração do Agrega</span>
          </div>
        </div>
        <div className="card">
          <h2>Concreteiras clientes</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Cadastre cada concreteira com o seu dono. O dono entra no sistema e convida o gestor e os motoristas.
          </p>
          <Link className="btn btn-primario" to="/admin/empresas">
            Ver concreteiras
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Olá, {primeiroNome}</h1>
          <span className="muted">
            {empresa?.nomeFantasia || empresa?.razaoSocial} · {NOMES_PERFIL[usuario.perfil]}
          </span>
        </div>
      </div>

      {usuario.perfil === 'motorista' ? (
        <div className="card">
          <h2>Registro de abastecimento</h2>
          <p className="muted" style={{ margin: 0 }}>
            Em breve você vai registrar cada abastecimento por aqui, direto do celular.
          </p>
        </div>
      ) : (
        <PainelGestao />
      )}
    </>
  );
}
