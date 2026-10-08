import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import './estilos.css';
import type { Perfil } from './api';
import { ProvedorSessao, useSessao } from './sessao';
import { podeAcessar } from './acesso';
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
import { Notas } from './paginas/Notas';
import { Nota } from './paginas/Nota';
import { Cargas, NovaCarga } from './paginas/ProdCargas';
import { Insumos, Tracos } from './paginas/ProdTracos';
import { MinhaEscala, MinhaProducao, ProducaoMotoristas } from './paginas/ProdMotoristas';
import { Escala } from './paginas/ProdEscala';
import { Estoque } from './paginas/ProdEstoque';
import { RelProducao } from './paginas/RelProducao';
import { Amostras, CpsARomper, Laudo, Resistencia } from './paginas/Qualidade';
import { ConfigQualidade, EnsaiosInsumos, Equipamentos } from './paginas/QualCadastros';
import { NovaSolicitacao, SolicitacaoDetalhe, SupSolicitacoes } from './paginas/SupSolicitacoes';
import { CotacaoDetalhe, NovaCotacao, SupCotacoes } from './paginas/SupCotacoes';
import { NovoPedido, PedidoDetalhe, SupPedidos } from './paginas/SupPedidos';
import { SupAprovacoes } from './paginas/SupAprovacoes';
import { SupCatalogo } from './paginas/SupCatalogo';
import { ContratoDetalhe, NovoContrato, SupContratos } from './paginas/SupContratos';
import { MedicaoDetalhe, NovaMedicao, SupMedicoes } from './paginas/SupMedicoes';
import { AutorizacaoDetalhe, SupAutorizacoes } from './paginas/SupAutorizacoes';
import { SupRelatorios } from './paginas/SupRelatorios';
import { Regras } from './paginas/Regras';
import { Dre } from './paginas/Dre';
import { Fluxo } from './paginas/Fluxo';
import { CustoVeiculo } from './paginas/CustoVeiculo';
import { RelFrota } from './paginas/RelFrota';
import { RelFinanceiro } from './paginas/RelFinanceiro';
import { RelAdm } from './paginas/RelAdm';
import { RelConfig } from './paginas/RelConfig';
import { RelGerencial } from './paginas/RelGerencial';
import { Indicadores } from './paginas/Indicadores';
import { Conciliacao } from './paginas/Conciliacao';
import { ComRelatorios, ComVendas, EditarVenda, NovaVenda, VendaDetalhe } from './paginas/Comercial';
import { ProdProgramacao } from './paginas/ProdProgramacao';
import { GerProducaoEquipe } from './paginas/GerProducaoEquipe';
import { PaginaMinhasCargas } from './paginas/MinhasCargas';
import { QualDemandas, QualRastreabilidade } from './paginas/QualRastreabilidade';
import { MuralAvisos } from './paginas/Mural';
import { ImprimirEtiquetas, ImprimirKit, ImprimirRomaneios, ProdRomaneios } from './paginas/ProdRomaneios';

registerSW({ immediate: true });

const COMERCIAL: Perfil[] = ['dono', 'gestor', 'vendedor'];

function Protegido({ children, perfis }: { children: ReactNode; perfis?: Perfil[] }) {
  const { carregando, usuario } = useSessao();
  const local = useLocation();
  if (carregando) return <div className="carregando">Carregando…</div>;
  if (!usuario) return <Navigate to="/entrar" replace state={{ de: local.pathname }} />;
  if (!podeAcessar(usuario, perfis, local.pathname)) return <Navigate to="/" replace />;
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
            <Route path="fin/notas" element={<Protegido perfis={['dono', 'gestor']}><Notas /></Protegido>} />
            <Route path="fin/notas/:id" element={<Protegido perfis={['dono', 'gestor']}><Nota /></Protegido>} />
            <Route path="frota/relatorios" element={<Protegido perfis={['dono', 'gestor']}><RelFrota /></Protegido>} />
            <Route path="fin/relatorios" element={<Protegido perfis={['dono', 'gestor']}><RelFinanceiro /></Protegido>} />
            <Route path="adm/relatorios" element={<Protegido perfis={['dono', 'gestor']}><RelAdm /></Protegido>} />
            <Route path="config/relatorios" element={<Protegido perfis={['dono', 'gestor']}><RelConfig /></Protegido>} />
            <Route path="ger/relatorios" element={<Protegido perfis={['dono', 'gestor']}><RelGerencial /></Protegido>} />
            <Route path="ger/indicadores" element={<Protegido perfis={['dono', 'gestor']}><Indicadores /></Protegido>} />
            <Route path="ger/dre" element={<Protegido perfis={['dono', 'gestor']}><Dre /></Protegido>} />
            <Route path="ger/fluxo" element={<Protegido perfis={['dono', 'gestor']}><Fluxo /></Protegido>} />
            <Route path="ger/custo-veiculo" element={<Protegido perfis={['dono', 'gestor']}><CustoVeiculo /></Protegido>} />
            <Route path="fin/conciliacao" element={<Protegido perfis={['dono', 'gestor']}><Conciliacao /></Protegido>} />
            <Route path="fin/regras" element={<Protegido perfis={['dono', 'gestor']}><Regras /></Protegido>} />
            <Route path="fin/plano-contas" element={<Protegido perfis={['dono', 'gestor']}><PlanoContas /></Protegido>} />
            <Route path="adm/clientes" element={<Protegido perfis={['dono', 'gestor']}><Fornecedores key="clientes" categoria="cliente" /></Protegido>} />
            <Route path="adm/fornecedores" element={<Protegido perfis={['dono', 'gestor']}><Fornecedores categoria="fornecedor" /></Protegido>} />
            <Route path="adm/credores" element={<Protegido perfis={['dono', 'gestor']}><Fornecedores categoria="credor" /></Protegido>} />
            <Route path="adm/colaboradores" element={<Protegido perfis={['dono', 'gestor']}><Motoristas key="colaboradores" modo="colaboradores" /></Protegido>} />
            <Route path="prod/cargas" element={<Protegido perfis={['dono', 'gestor', 'operador_usina']}><Cargas /></Protegido>} />
            <Route path="prod/cargas/nova" element={<Protegido perfis={['dono', 'gestor', 'operador_usina']}><NovaCarga /></Protegido>} />
            <Route path="prod/tracos" element={<Protegido perfis={['dono', 'gestor', 'operador_usina', 'laboratorista']}><Tracos /></Protegido>} />
            <Route path="qual/cps" element={<Protegido perfis={['dono', 'gestor', 'laboratorista']}><CpsARomper /></Protegido>} />
            <Route path="qual/amostras" element={<Protegido perfis={['dono', 'gestor', 'laboratorista']}><Amostras /></Protegido>} />
            <Route path="qual/resistencia" element={<Protegido perfis={['dono', 'gestor', 'laboratorista']}><Resistencia /></Protegido>} />
            <Route path="qual/laudo" element={<Protegido perfis={['dono', 'gestor', 'laboratorista']}><Laudo /></Protegido>} />
            <Route path="qual/insumos" element={<Protegido perfis={['dono', 'gestor', 'laboratorista']}><EnsaiosInsumos /></Protegido>} />
            <Route path="qual/equipamentos" element={<Protegido perfis={['dono', 'gestor', 'laboratorista']}><Equipamentos /></Protegido>} />
            <Route path="qual/config" element={<Protegido perfis={['dono', 'gestor', 'laboratorista']}><ConfigQualidade /></Protegido>} />
            <Route path="sup/solicitacoes" element={<Protegido perfis={['dono', 'gestor']}><SupSolicitacoes /></Protegido>} />
            <Route path="sup/solicitacoes/nova" element={<Protegido perfis={['dono', 'gestor']}><NovaSolicitacao /></Protegido>} />
            <Route path="sup/solicitacoes/:id" element={<Protegido perfis={['dono', 'gestor']}><SolicitacaoDetalhe /></Protegido>} />
            <Route path="sup/cotacoes" element={<Protegido perfis={['dono', 'gestor']}><SupCotacoes /></Protegido>} />
            <Route path="sup/cotacoes/nova" element={<Protegido perfis={['dono', 'gestor']}><NovaCotacao /></Protegido>} />
            <Route path="sup/cotacoes/:id" element={<Protegido perfis={['dono', 'gestor']}><CotacaoDetalhe /></Protegido>} />
            <Route path="sup/pedidos" element={<Protegido perfis={['dono', 'gestor']}><SupPedidos /></Protegido>} />
            <Route path="sup/pedidos/novo" element={<Protegido perfis={['dono', 'gestor']}><NovoPedido /></Protegido>} />
            <Route path="sup/pedidos/:id" element={<Protegido perfis={['dono', 'gestor']}><PedidoDetalhe /></Protegido>} />
            <Route path="sup/contratos" element={<Protegido perfis={['dono', 'gestor']}><SupContratos /></Protegido>} />
            <Route path="sup/contratos/novo" element={<Protegido perfis={['dono', 'gestor']}><NovoContrato /></Protegido>} />
            <Route path="sup/contratos/:id" element={<Protegido perfis={['dono', 'gestor']}><ContratoDetalhe /></Protegido>} />
            <Route path="sup/medicoes" element={<Protegido perfis={['dono', 'gestor']}><SupMedicoes /></Protegido>} />
            <Route path="sup/medicoes/nova" element={<Protegido perfis={['dono', 'gestor']}><NovaMedicao /></Protegido>} />
            <Route path="sup/medicoes/:id" element={<Protegido perfis={['dono', 'gestor']}><MedicaoDetalhe /></Protegido>} />
            <Route path="sup/autorizacoes" element={<Protegido perfis={['dono', 'gestor']}><SupAutorizacoes /></Protegido>} />
            <Route path="sup/autorizacoes/:id" element={<Protegido perfis={['dono', 'gestor']}><AutorizacaoDetalhe /></Protegido>} />
            <Route path="ger/aprovacoes" element={<Protegido perfis={['dono', 'gestor']}><SupAprovacoes /></Protegido>} />
            <Route path="sup/aprovacoes" element={<Navigate to="/ger/aprovacoes" replace />} />
            <Route path="sup/catalogo" element={<Protegido perfis={['dono', 'gestor']}><SupCatalogo /></Protegido>} />
            <Route path="sup/relatorios" element={<Protegido perfis={['dono', 'gestor']}><SupRelatorios /></Protegido>} />
            <Route path="com/vendas" element={<Protegido perfis={COMERCIAL}><ComVendas /></Protegido>} />
            <Route path="com/vendas/nova" element={<Protegido perfis={COMERCIAL}><NovaVenda /></Protegido>} />
            <Route path="com/vendas/:id" element={<Protegido perfis={COMERCIAL}><VendaDetalhe /></Protegido>} />
            <Route path="com/vendas/:id/editar" element={<Protegido perfis={COMERCIAL}><EditarVenda /></Protegido>} />
            <Route path="com/relatorios" element={<Protegido perfis={COMERCIAL}><ComRelatorios /></Protegido>} />
            <Route path="prod/programacao" element={<Protegido perfis={['dono', 'gestor', 'operador_usina']}><ProdProgramacao /></Protegido>} />
            <Route path="ger/producao-equipe" element={<Protegido perfis={['dono', 'gestor']}><GerProducaoEquipe /></Protegido>} />
            <Route path="prod/insumos" element={<Protegido perfis={['dono', 'gestor']}><Insumos /></Protegido>} />
            <Route path="prod/motoristas" element={<Protegido perfis={['dono', 'gestor']}><ProducaoMotoristas /></Protegido>} />
            <Route path="prod/estoque" element={<Protegido perfis={['dono', 'gestor']}><Estoque /></Protegido>} />
            <Route path="prod/relatorios" element={<Protegido perfis={['dono', 'gestor']}><RelProducao /></Protegido>} />
            <Route path="prod/escala" element={<Protegido perfis={['dono', 'gestor']}><Escala /></Protegido>} />
            <Route path="minha-producao" element={<Protegido perfis={['motorista']}><MinhaProducao /></Protegido>} />
            <Route path="prod/romaneios" element={<Protegido perfis={['dono', 'gestor', 'operador_usina']}><ProdRomaneios /></Protegido>} />
            <Route path="prod/kit" element={<Protegido perfis={['dono', 'gestor', 'operador_usina']}><ImprimirKit /></Protegido>} />
            <Route path="prod/romaneios/imprimir" element={<Protegido perfis={['dono', 'gestor', 'operador_usina']}><ImprimirRomaneios /></Protegido>} />
            <Route path="prod/etiquetas/imprimir" element={<Protegido perfis={['dono', 'gestor', 'operador_usina', 'laboratorista']}><ImprimirEtiquetas /></Protegido>} />
            <Route path="minhas-cargas" element={<Protegido perfis={['motorista']}><PaginaMinhasCargas /></Protegido>} />
            <Route path="qual/demandas" element={<Protegido perfis={['dono', 'gestor', 'laboratorista']}><QualDemandas /></Protegido>} />
            <Route path="qual/rastreabilidade" element={<Protegido perfis={['dono', 'gestor', 'laboratorista']}><QualRastreabilidade /></Protegido>} />
            <Route path="qual/rastreabilidade/:cargaId" element={<Protegido perfis={['dono', 'gestor', 'laboratorista']}><QualRastreabilidade /></Protegido>} />
            <Route path="mural" element={<MuralAvisos />} />
            <Route path="minha-escala" element={<Protegido perfis={['motorista']}><MinhaEscala /></Protegido>} />
            <Route path="conta" element={<Conta />} />
            <Route path="admin/empresas" element={<Protegido perfis={['admin_sistema']}><AdminEmpresas /></Protegido>} />
            <Route path="*" element={<NaoEncontrado />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ProvedorSessao>
  </StrictMode>,
);
