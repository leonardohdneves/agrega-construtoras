import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { NOMES_PERFIL, type Modulo as ModuloApp, type Perfil } from '../api';
import { podeAcessar, temModulo } from '../acesso';
import { useSessao } from '../sessao';
import { Logo } from './Logo';
import {
  IconeBetoneira,
  IconeCarrinho,
  IconeFrasco,
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

type Item = { rotulo: string; para?: string; arquivo?: string; etapa?: number; perfis?: Perfil[]; soDemo?: boolean; soAdmin?: boolean; livre?: boolean };
type Modulo = { id: string; numero?: number; titulo: string; icone: ReactNode; perfis?: Perfil[]; itens: Item[] };

const GESTAO: Perfil[] = ['dono', 'gestor'];
const USINA: Perfil[] = ['dono', 'gestor', 'operador_usina'];
const LAB: Perfil[] = ['dono', 'gestor', 'laboratorista'];

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
      { rotulo: 'Relatórios', para: '/frota/relatorios', perfis: GESTAO },
    ],
  },
  {
    id: 'producao',
    titulo: 'Produção',
    icone: <IconeBetoneira />,
    perfis: ['dono', 'gestor', 'operador_usina', 'motorista'],
    itens: [
      { rotulo: 'Registrar carga', para: '/prod/cargas/nova', perfis: USINA },
      { rotulo: 'Cargas', para: '/prod/cargas', perfis: USINA },
      { rotulo: 'Traços', para: '/prod/tracos', perfis: USINA },
      { rotulo: 'Insumos', para: '/prod/insumos', perfis: GESTAO },
      { rotulo: 'Produção dos motoristas', para: '/prod/motoristas', perfis: GESTAO },
      { rotulo: 'Escala de trabalho', para: '/prod/escala', perfis: GESTAO },
      { rotulo: 'Estoque e inventário', para: '/prod/estoque', perfis: GESTAO },
      { rotulo: 'Relatórios', para: '/prod/relatorios', perfis: GESTAO },
      { rotulo: 'Minha produção', para: '/minha-producao', perfis: ['motorista'] },
      { rotulo: 'Minha escala', para: '/minha-escala', perfis: ['motorista'] },
    ],
  },
  {
    id: 'qualidade',
    titulo: 'Qualidade',
    icone: <IconeFrasco />,
    perfis: LAB,
    itens: [
      { rotulo: 'CPs a romper', para: '/qual/cps' },
      { rotulo: 'Amostras e resultados', para: '/qual/amostras' },
      { rotulo: 'Resistência e fck estimado', para: '/qual/resistencia' },
      { rotulo: 'Laudo para o cliente', para: '/qual/laudo' },
      { rotulo: 'Ensaios de insumos', para: '/qual/insumos' },
      { rotulo: 'Equipamentos e calibração', para: '/qual/equipamentos' },
      { rotulo: 'Traços', para: '/prod/tracos', perfis: ['laboratorista'] },
      { rotulo: 'Configurações da qualidade', para: '/qual/config' },
    ],
  },
  {
    id: 'suprimentos',
    titulo: 'Suprimentos',
    icone: <IconeCarrinho />,
    perfis: GESTAO,
    itens: [
      { rotulo: 'Solicitações de compra', para: '/sup/solicitacoes' },
      { rotulo: 'Cotações e mapa', para: '/sup/cotacoes' },
      { rotulo: 'Pedidos de compra', para: '/sup/pedidos' },
      { rotulo: 'Aprovações', para: '/sup/aprovacoes' },
      { rotulo: 'Relatórios', para: '/sup/relatorios' },
    ],
  },
  {
    id: 'financeiro',
    titulo: 'Financeiro',
    icone: <IconeDinheiro />,
    perfis: GESTAO,
    itens: [
      { rotulo: 'Contas a pagar e receber', para: '/fin/pagar-receber' },
      { rotulo: 'Lançamentos', para: '/fin/lancamentos' },
      { rotulo: 'Notas fiscais e XML', para: '/fin/notas' },
      { rotulo: 'Bancos e caixa', para: '/fin/contas' },
      { rotulo: 'Conciliação OFX', para: '/fin/conciliacao' },
      { rotulo: 'Plano de contas', para: '/fin/plano-contas' },
      { rotulo: 'Relatórios', para: '/fin/relatorios' },
    ],
  },
  {
    id: 'gerencial',
    titulo: 'Gerencial',
    icone: <IconeGrafico />,
    perfis: GESTAO,
    itens: [
      { rotulo: 'DRE gerencial', para: '/ger/dre' },
      { rotulo: 'Fluxo de caixa', para: '/ger/fluxo' },
      { rotulo: 'Custo por veículo', para: '/ger/custo-veiculo' },
      { rotulo: 'Relatórios gerais', para: '/ger/relatorios' },
      { rotulo: 'Indicadores', para: '/ger/indicadores' },
    ],
  },
  {
    id: 'administrativo',
    titulo: 'Administrativo',
    icone: <IconePasta />,
    perfis: GESTAO,
    itens: [
      { rotulo: 'Clientes', para: '/adm/clientes' },
      { rotulo: 'Fornecedores', para: '/adm/fornecedores' },
      { rotulo: 'Credores', para: '/adm/credores' },
      { rotulo: 'Colaboradores', para: '/adm/colaboradores' },
      { rotulo: 'Relatórios', para: '/adm/relatorios' },
    ],
  },
  {
    id: 'configuracoes',
    titulo: 'Configurações',
    icone: <IconeEngrenagem />,
    itens: [
      { rotulo: 'Empresa', para: '/empresa', perfis: GESTAO },
      { rotulo: 'Usuários e acessos', para: '/usuarios', soAdmin: true },
      { rotulo: 'Minha conta', para: '/conta', livre: true },
      { rotulo: 'Relatórios de uso', para: '/config/relatorios', perfis: GESTAO },
      { rotulo: 'Manual de operação (PDF)', arquivo: '/manual/agrega-manual-de-operacao.pdf', livre: true },
      { rotulo: 'Extrato OFX de demonstração', arquivo: '/api/demo/extrato.ofx', perfis: GESTAO, soDemo: true },
      { rotulo: 'NF-e de demonstração (XML)', arquivo: '/api/demo/nfe-posto.xml', perfis: GESTAO, soDemo: true },
    ],
  },
];

function permitido(perfis: Perfil[] | undefined, perfil: Perfil) {
  return !perfis || perfis.includes(perfil);
}

function MenuModulos({ perfil, caminho, aoNavegar }: { perfil: Perfil; caminho: string; aoNavegar?: () => void }) {
  const { empresa, usuario } = useSessao();
  const demo = empresa?.plano === 'demonstracao';
  // Toque (celular/tablet) abre e fecha; no computador o módulo abre ao passar o mouse.
  const [aberto, setAberto] = useState<string | null>(null);
  // Módulos liberados para o usuário; dentro deles, as telas do perfil (ou todas, se o módulo foi dado a mais).
  const itemOk = (m: Modulo, i: Item) => {
    if (i.soDemo && !demo) return false;
    if (i.livre) return true;
    if (i.soAdmin) return !!usuario?.administrador;
    if (i.arquivo) return permitido(i.perfis, perfil) && temModulo(usuario, 'configuracoes');
    return podeAcessar(usuario, i.perfis ?? m.perfis, i.para ?? '');
  };
  const modulos = MODULOS.filter((m) => (m.id === 'admin' ? perfil === 'admin_sistema' : m.id === 'configuracoes' || temModulo(usuario, m.id as ModuloApp)))
    .map((m) => ({ ...m, itens: m.itens.filter((i) => itemOk(m, i)) }))
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
                  it.arquivo ? (
                    <a key={it.rotulo} href={it.arquivo} download onClick={aoNavegar}>
                      {it.rotulo}
                    </a>
                  ) : it.para ? (
                    <NavLink key={it.rotulo} to={it.para} className={({ isActive }) => (isActive ? 'ativo' : undefined)} onClick={aoNavegar}>
                      {it.rotulo}
                    </NavLink>
                  ) : (
                    <span key={it.rotulo} className="item-off" title="Em breve">
                      {it.rotulo}
                      <span className="etapa">em breve</span>
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
  // Quem tem módulos a mais (ou é administrador) usa o menu completo no celular.
  const menuCompleto = gestao || !!usuario.administrador || !!usuario.modulos;

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
        {perfil === 'laboratorista' ? (
          <NavLink to="/qual/cps" className={({ isActive }) => (isActive ? 'ativo' : undefined)}>
            <IconeFrasco />
            CPs
          </NavLink>
        ) : perfil === 'operador_usina' ? (
          <NavLink to="/prod/cargas/nova" className={({ isActive }) => (isActive ? 'ativo' : undefined)}>
            <IconeBetoneira />
            Carga
          </NavLink>
        ) : (
          <NavLink to="/abastecer" className={({ isActive }) => (isActive ? 'ativo' : undefined)}>
            <IconeBomba />
            Abastecer
          </NavLink>
        )}
        {perfil === 'operador_usina' && (
          <NavLink to="/prod/cargas" end className={({ isActive }) => (isActive ? 'ativo' : undefined)}>
            <IconeCaminhao />
            Cargas
          </NavLink>
        )}
        {perfil === 'laboratorista' && (
          <NavLink to="/qual/amostras" className={({ isActive }) => (isActive ? 'ativo' : undefined)}>
            <IconeGrafico />
            Resultados
          </NavLink>
        )}
        {perfil === 'motorista' && (
          <NavLink to="/minha-producao" className={({ isActive }) => (isActive ? 'ativo' : undefined)}>
            <IconeBetoneira />
            Produção
          </NavLink>
        )}
        {gestao && (
          <NavLink to="/frota/veiculos" className={({ isActive }) => (isActive ? 'ativo' : undefined)}>
            <IconeCaminhao />
            Frota
          </NavLink>
        )}
        {menuCompleto ? (
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
