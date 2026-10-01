import { Link } from 'react-router-dom';
import { NOMES_PERFIL, formatarCnpj } from '../api';
import { useSessao } from '../sessao';

const ETAPAS = [
  { n: 0, nome: 'Base: login, perfis, empresa e usuários', pronta: true },
  { n: 1, nome: 'Cadastros da frota: veículos, motoristas e documentos' },
  { n: 2, nome: 'Abastecimento pelo celular, km/L e L/h' },
  { n: 3, nome: 'Manutenção preventiva e ordens de serviço' },
  { n: 4, nome: 'Financeiro: contas, plano de contas, a pagar e a receber' },
  { n: 5, nome: 'Nota fiscal: lançamento manual e importação de XML' },
  { n: 6, nome: 'Conciliação bancária com OFX' },
  { n: 7, nome: 'Relatórios: DRE, fluxo de caixa e custo por veículo' },
];

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
        <div className="grade">
          <div className="card">
            <h2>Empresa</h2>
            <dl style={{ margin: 0, display: 'grid', gap: 6 }}>
              <dt className="small muted">Razão social</dt>
              <dd style={{ margin: 0 }}>{empresa?.razaoSocial}</dd>
              <dt className="small muted">CNPJ</dt>
              <dd style={{ margin: 0 }} className="mono">
                {empresa ? formatarCnpj(empresa.cnpj) : ''}
              </dd>
            </dl>
            <div className="acoes" style={{ marginTop: 16 }}>
              <Link to="/empresa">Dados da empresa</Link>
              <Link to="/usuarios">Usuários</Link>
            </div>
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
      )}
    </>
  );
}
