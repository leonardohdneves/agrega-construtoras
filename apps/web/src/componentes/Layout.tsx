import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { NOMES_PERFIL, type Perfil } from '../api';
import { useSessao } from '../sessao';
import { Logo } from './Logo';
import {
  IconeBomba,
  IconeCaminhao,
  IconeConta,
  IconeDinheiro,
  IconeEngrenagem,
  IconeGrafico,
  IconeInicio,
  IconeMenu,
  IconePasta,
  IconeEmpresa,
} from './Icones';

type Item = { rotulo: string; para?: string; etapa?: number; perfis?: Perfil[] };
type Modulo = { id: string; numero?: number; titulo: string; icone: ReactNode; perfis?: Perfil[]; itens: Item[] };

const GESTAO: Perfil[] = ['dono', 'gestor'];

export const MODULOS: Modulo[] = [
  {
    id: 'admin',
    titulo: 'Concreteiras',
    icone: <IconeEmpresa />,
    perfis: ['admin_sistema'],
    itens: [{ rotulo: 'Concreteiras clientes', para: '/admin/empresas' }],
  },
  {
    id: 'frota',
    numero: 1,
    titulo: 'Frota',
    icone: <IconeCaminhao />,
    perfis: ['dono', 'gestor', 'motorista'],
    itens: [
      { rotulo: 'Registrar abastecimento', para: '/abastecer' },
      { rotulo: 'Veículos', para: '/frota/veiculos', perfis: GESTAO },
      { rotulo: 'Motoristas', para: '/frota/motoristas', perfis: GESTAO },
      { rotulo: 'Abastecimentos e consumo', para: '/frota/abastecimentos', perfis: GESTAO },
      { rotulo: 'Manutenção preventiva', para: '/frota/manutencao', perfis: GESTAO },
      { rotulo: 'Ordens de serviço', para: '/frota/os', perfis: GESTAO },
    ],
  },
  {
    id: 'financeiro',
    numero: 2,
    titulo: 'Financeiro',
    icone: <IconeDinheiro />,
    perfis: GESTAO,
    itens: [
      { rotulo: 'Contas a pagar e receber', para: '/fin/pagar-receber' },
      { rotulo: 'Lançamentos', para: '/fin/lancamentos' },
      { rotulo: 'Notas fiscais e XML', para: '/fin/notas' },
      { rotulo: 'Bancos e conciliação', para: '/fin/contas' },
      { rotulo: 'Plano de contas', para: '/fin/plano-contas' },
    ],
  },
  {
    id: 'gerencial',
    numero: 3,
    titulo: 'Gerencial',
    icone: <IconeGrafico />,
    perfis: GESTAO,
    itens: [
      { rotulo: 'DRE gerencial', etapa: 7 },
      { rotulo: 'Fluxo de caixa', etapa: 7 },
      { rotulo: 'Custo por veículo', etapa: 7 },
    ],
  },
  {
    id: 'configuracoes',
    numero: 4,
    titulo: 'Configurações',
    icone: <IconeEngrenagem />,
    itens: [
      { rotulo: 'Empresa', para: '/empresa', perfis: GESTAO },
      { rotulo: 'Usuários', para: '/usuarios', perfis: GESTAO },
      { rotulo: 'Minha conta', para: '/conta' },
    ],
  },
  {
    id: 'administrativo',
    numero: 5,
    titulo: 'Administrativo',
    icone: <IconePasta />,
    perfis: GESTAO,
    itens: [
      { rotulo: 'Clientes', para: '/adm/clientes' },
      { rotulo: 'Fornecedores', para: '/adm/fornecedores' },
      { rotulo: 'Credores', para: '/adm/credores' },
      { rotulo: 'Colaboradores', para: '/adm/colaboradores' },
    ],
  },
];

function permitido(perfis: Perfil[] | undefined, perfil: Perfil) {
  return !perfis || perfis.includes(perfil);
}

function MenuModulos({ perfil, caminho, aoNavegar }: { perfil: Perfil; caminho: string; aoNavegar?: () => void }) {
  // Toque (celular/tablet) abre e fecha; no computador o módulo abre ao passar o mouse.
  const [aberto, setAberto] = useState<string | null>(null);
  const modulos = MODULOS.filter((m) => permitido(m.perfis, perfil))
    .map((m) => ({ ...m, itens: m.itens.filter((i) => permitido(i.perfis, perfil)) }))
    .filter((m) => m.itens.length);

  return (
    <>
      <NavLink to="/" end className={({ isActive }) => `modulo-topo inicio ${isActive ? 'ativo' : ''}`} onClick={aoNavegar}>
        <IconeInicio />
        <span>Painel</span>
      </NavLink>
      {modulos.map((m) => {
        const atual = m.itens.some((i) => i.para && (caminho === i.para || caminho.startsWith(`${i.para}/`)));
        return (
          <div
            key={m.id}
            className={`modulo ${aberto === m.id ? 'aberto' : ''} ${atual ? 'atual' : ''}`}
            onMouseLeave={() => setAberto((a) => (a === m.id ? null : a))}
          >
            <button
              type="button"
              className="modulo-topo"
              aria-expanded={aberto === m.id}
              aria-controls={`sub-${m.id}`}
              onClick={() => setAberto((a) => (a === m.id ? null : m.id))}
            >
              {m.icone}
              <span>{m.titulo}</span>
              <svg className="seta" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
            <div className="sub" id={`sub-${m.id}`}>
              <div className="sub-dentro">
                {m.itens.map((it) =>
                  it.para ? (
                    <NavLink key={it.rotulo} to={it.para} className={({ isActive }) => (isActive ? 'ativo' : undefined)} onClick={aoNavegar}>
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
            </div>
          </div>
        );
      })}
    </>
  );
}

export function Layout() {
  const { usuario, empresa, sair } = useSessao();
  const navegar = useNavigate();
  const local = useLocation();
  const [gaveta, setGaveta] = useState(false);

  useEffect(() => setGaveta(false), [local.pathname]);

  if (!usuario) return null;
  const perfil = usuario.perfil;
  const gestao = perfil === 'dono' || perfil === 'gestor';

  async function aoSair() {
    await sair();
    navegar('/entrar');
  }

  const rodape = (
    <div className="rodape">
      <strong>{empresa?.nomeFantasia || empresa?.razaoSocial || 'Agrega'}</strong>
      <span>
        {usuario.nome} · {NOMES_PERFIL[perfil]}
      </span>
      <button type="button" onClick={aoSair}>
        Sair
      </button>
    </div>
  );

  return (
    <div className="app">
      <nav className="lateral" aria-label="Menu principal">
        <div className="marca">
          <Logo escuro />
        </div>
        <MenuModulos perfil={perfil} caminho={local.pathname} />
        {rodape}
      </nav>

      {gaveta && (
        <div className="gaveta-fundo" onClick={() => setGaveta(false)}>
          <nav className="lateral gaveta" aria-label="Menu" onClick={(e) => e.stopPropagation()}>
            <div className="marca" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Logo escuro />
              <button type="button" className="fechar" aria-label="Fechar menu" onClick={() => setGaveta(false)}>
                ×
              </button>
            </div>
            <MenuModulos perfil={perfil} caminho={local.pathname} aoNavegar={() => setGaveta(false)} />
            {rodape}
          </nav>
        </div>
      )}

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
        <NavLink to="/abastecer" className={({ isActive }) => (isActive ? 'ativo' : undefined)}>
          <IconeBomba />
          Abastecer
        </NavLink>
        {gestao && (
          <NavLink to="/frota/veiculos" className={({ isActive }) => (isActive ? 'ativo' : undefined)}>
            <IconeCaminhao />
            Frota
          </NavLink>
        )}
        {gestao ? (
          <button type="button" className="nav-botao" onClick={() => setGaveta(true)} aria-label="Abrir o menu com todos os módulos">
            <IconeMenu />
            Menu
          </button>
        ) : (
          <NavLink to="/conta" className={({ isActive }) => (isActive ? 'ativo' : undefined)}>
            <IconeConta />
            Conta
          </NavLink>
        )}
      </nav>
    </div>
  );
}
