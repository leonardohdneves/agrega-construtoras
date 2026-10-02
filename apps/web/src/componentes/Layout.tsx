import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { NOMES_PERFIL, type Perfil } from '../api';
import { useSessao } from '../sessao';
import { Logo } from './Logo';
import { IconeCaminhao, IconeConta, IconeEmpresa, IconeInicio, IconeUsuarios } from './Icones';

type Item = { rotulo: string; para?: string; etapa?: number; perfis?: Perfil[] };
type Secao = { titulo?: string; perfis?: Perfil[]; itens: Item[] };

const GESTAO: Perfil[] = ['dono', 'gestor'];

export const MENU: Secao[] = [
  { itens: [{ rotulo: 'Painel', para: '/' }] },
  { titulo: 'EMPRESAS CLIENTES', perfis: ['admin_sistema'], itens: [{ rotulo: 'Concreteiras', para: '/admin/empresas' }] },
  {
    titulo: 'FROTA',
    perfis: ['dono', 'gestor', 'motorista'],
    itens: [
      { rotulo: 'Veículos', para: '/frota/veiculos', perfis: GESTAO },
      { rotulo: 'Motoristas', para: '/frota/motoristas', perfis: GESTAO },
      { rotulo: 'Abastecimentos', etapa: 2 },
      { rotulo: 'Manutenção', etapa: 3, perfis: GESTAO },
    ],
  },
  {
    titulo: 'FINANCEIRO',
    perfis: GESTAO,
    itens: [
      { rotulo: 'Contas a pagar e receber', etapa: 4 },
      { rotulo: 'Lançamentos e notas', etapa: 5 },
      { rotulo: 'Conciliação bancária', etapa: 6 },
    ],
  },
  {
    titulo: 'RELATÓRIOS',
    perfis: GESTAO,
    itens: [
      { rotulo: 'DRE gerencial', etapa: 7 },
      { rotulo: 'Custo por veículo', etapa: 7 },
      { rotulo: 'Fluxo de caixa', etapa: 7 },
    ],
  },
  {
    titulo: 'CONFIGURAÇÕES',
    itens: [
      { rotulo: 'Empresa', para: '/empresa', perfis: GESTAO },
      { rotulo: 'Usuários', para: '/usuarios', perfis: GESTAO },
      { rotulo: 'Minha conta', para: '/conta' },
    ],
  },
];

function permitido(perfis: Perfil[] | undefined, perfil: Perfil) {
  return !perfis || perfis.includes(perfil);
}

export function Layout() {
  const { usuario, empresa, sair } = useSessao();
  const navegar = useNavigate();
  if (!usuario) return null;
  const perfil = usuario.perfil;
  const gestao = perfil === 'dono' || perfil === 'gestor';

  async function aoSair() {
    await sair();
    navegar('/entrar');
  }

  return (
    <div className="app">
      <nav className="lateral" aria-label="Menu principal">
        <div className="marca">
          <Logo escuro />
        </div>
        {MENU.filter((s) => permitido(s.perfis, perfil)).map((s, i) => (
          <div key={i} style={{ display: 'contents' }}>
            {s.titulo && <span className="secao">{s.titulo}</span>}
            {s.itens
              .filter((it) => permitido(it.perfis, perfil))
              .map((it) =>
                it.para ? (
                  <NavLink key={it.rotulo} to={it.para} end={it.para === '/'} className={({ isActive }) => (isActive ? 'ativo' : undefined)}>
                    {it.rotulo}
                  </NavLink>
                ) : (
                  <span key={it.rotulo} className="item-off" title={`Disponível na Etapa ${it.etapa}`}>
                    {it.rotulo}
                    <span className="etapa">E{it.etapa}</span>
                  </span>
                ),
              )}
          </div>
        ))}
        <div className="rodape">
          <strong>{empresa?.nomeFantasia || empresa?.razaoSocial || 'Agrega'}</strong>
          <span>
            {usuario.nome} · {NOMES_PERFIL[perfil]}
          </span>
          <button type="button" onClick={aoSair}>
            Sair
          </button>
        </div>
      </nav>

      <header className="topo-celular">
        <Logo escuro tamanho={26} />
        <span className="empresa">
          {empresa?.nomeFantasia || empresa?.razaoSocial || NOMES_PERFIL[perfil]}
          <br />
          {usuario.nome}
        </span>
      </header>

      <main className="conteudo">
        <Outlet />
      </main>

      <nav className="nav-celular" aria-label="Navegação">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'ativo' : undefined)}>
          <IconeInicio />
          Início
        </NavLink>
        {gestao && (
          <NavLink to="/frota/veiculos" className={({ isActive }) => (isActive ? 'ativo' : undefined)}>
            <IconeCaminhao />
            Frota
          </NavLink>
        )}
        {gestao && (
          <NavLink to="/empresa" className={({ isActive }) => (isActive ? 'ativo' : undefined)}>
            <IconeEmpresa />
            Empresa
          </NavLink>
        )}
        {gestao && (
          <NavLink to="/usuarios" className={({ isActive }) => (isActive ? 'ativo' : undefined)}>
            <IconeUsuarios />
            Usuários
          </NavLink>
        )}
        <NavLink to="/conta" className={({ isActive }) => (isActive ? 'ativo' : undefined)}>
          <IconeConta />
          Conta
        </NavLink>
      </nav>
    </div>
  );
}
