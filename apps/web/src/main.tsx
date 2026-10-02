import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import './estilos.css';
import type { Perfil } from './api';
import { ProvedorSessao, useSessao } from './sessao';
import { Layout } from './componentes/Layout';
import { Entrar } from './paginas/Entrar';
import { Painel } from './paginas/Painel';
import { Empresa } from './paginas/Empresa';
import { Usuarios } from './paginas/Usuarios';
import { Conta } from './paginas/Conta';
import { AdminEmpresas } from './paginas/AdminEmpresas';
import { Veiculos } from './paginas/Veiculos';
import { VeiculoDetalhe } from './paginas/VeiculoDetalhe';
import { Motoristas } from './paginas/Motoristas';
import { Abastecer } from './paginas/Abastecer';
import { Abastecimentos } from './paginas/Abastecimentos';
import { Manutencao } from './paginas/Manutencao';
import { OrdensServico } from './paginas/OrdensServico';
import { OrdemServico } from './paginas/OrdemServico';
import { Fornecedores } from './paginas/Fornecedores';
import { ContasPagarReceber } from './paginas/ContasPagarReceber';
import { Lancamentos } from './paginas/Lancamentos';
import { Lancamento } from './paginas/Lancamento';
import { ContasFinanceiras } from './paginas/ContasFinanceiras';
import { PlanoContas } from './paginas/PlanoContas';

registerSW({ immediate: true });

function Protegido({ children, perfis }: { children: ReactNode; perfis?: Perfil[] }) {
  const { carregando, usuario } = useSessao();
  const local = useLocation();
  if (carregando) return <div className="carregando">Carregando…</div>;
  if (!usuario) return <Navigate to="/entrar" replace state={{ de: local.pathname }} />;
  if (perfis && !perfis.includes(usuario.perfil)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function NaoEncontrado() {
  return (
    <div className="card">
      <h1 style={{ fontSize: 24 }}>Página não encontrada</h1>
      <p className="muted">O endereço pode ter mudado.</p>
      <Link to="/">Voltar ao painel</Link>
    </div>
  );
}

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <ProvedorSessao>
      <BrowserRouter>
        <Routes>
          <Route path="/entrar" element={<Entrar />} />
          <Route
            element={
              <Protegido>
                <Layout />
              </Protegido>
            }
          >
            <Route index element={<Painel />} />
            <Route path="empresa" element={<Protegido perfis={['dono', 'gestor']}><Empresa /></Protegido>} />
            <Route path="usuarios" element={<Protegido perfis={['dono', 'gestor']}><Usuarios /></Protegido>} />
            <Route path="frota/veiculos" element={<Protegido perfis={['dono', 'gestor']}><Veiculos /></Protegido>} />
            <Route path="frota/veiculos/:id" element={<Protegido perfis={['dono', 'gestor']}><VeiculoDetalhe /></Protegido>} />
            <Route path="frota/motoristas" element={<Protegido perfis={['dono', 'gestor']}><Motoristas /></Protegido>} />
            <Route path="abastecer" element={<Protegido perfis={['dono', 'gestor', 'motorista']}><Abastecer /></Protegido>} />
            <Route path="frota/abastecimentos" element={<Protegido perfis={['dono', 'gestor']}><Abastecimentos /></Protegido>} />
            <Route path="frota/manutencao" element={<Protegido perfis={['dono', 'gestor']}><Manutencao /></Protegido>} />
            <Route path="frota/os" element={<Protegido perfis={['dono', 'gestor']}><OrdensServico /></Protegido>} />
            <Route path="frota/os/:id" element={<Protegido perfis={['dono', 'gestor']}><OrdemServico /></Protegido>} />
            <Route path="fin/pagar-receber" element={<Protegido perfis={['dono', 'gestor']}><ContasPagarReceber /></Protegido>} />
            <Route path="fin/lancamentos" element={<Protegido perfis={['dono', 'gestor']}><Lancamentos /></Protegido>} />
            <Route path="fin/lancamentos/:id" element={<Protegido perfis={['dono', 'gestor']}><Lancamento /></Protegido>} />
            <Route path="fin/contas" element={<Protegido perfis={['dono', 'gestor']}><ContasFinanceiras /></Protegido>} />
            <Route path="fin/plano-contas" element={<Protegido perfis={['dono', 'gestor']}><PlanoContas /></Protegido>} />
            <Route path="adm/clientes" element={<Protegido perfis={['dono', 'gestor']}><Fornecedores key="clientes" categoria="cliente" /></Protegido>} />
            <Route path="adm/fornecedores" element={<Protegido perfis={['dono', 'gestor']}><Fornecedores categoria="fornecedor" /></Protegido>} />
            <Route path="adm/credores" element={<Protegido perfis={['dono', 'gestor']}><Fornecedores categoria="credor" /></Protegido>} />
            <Route path="adm/colaboradores" element={<Protegido perfis={['dono', 'gestor']}><Motoristas key="colaboradores" modo="colaboradores" /></Protegido>} />
            <Route path="conta" element={<Conta />} />
            <Route path="admin/empresas" element={<Protegido perfis={['admin_sistema']}><AdminEmpresas /></Protegido>} />
            <Route path="*" element={<NaoEncontrado />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ProvedorSessao>
  </StrictMode>,
);
