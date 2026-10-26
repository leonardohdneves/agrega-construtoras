// Modo campo: tela inicial para quem trabalha na obra. Reaproveita as telas existentes; só muda a ordem e o tamanho dos botões.
import { Link, useNavigate } from 'react-router-dom';
import { useSessao } from '../sessao';
import { PERFIS_CAMPO, salvarModo } from '../modo';

const ATALHOS: { rotulo: string; para: string; ajuda: string; perfis: string[] }[] = [
  { rotulo: 'Diário de obra', para: '/eng/rdo', ajuda: 'Registrar o dia: clima, equipe e equipamentos.', perfis: ['dono', 'gestor'] },
  { rotulo: 'Estoque', para: '/sup/estoque', ajuda: 'Consultar saldos e registrar movimentações.', perfis: ['dono', 'gestor', 'almoxarife'] },
  { rotulo: 'Ferramentas e equipamentos', para: '/sup/patrimonio', ajuda: 'Ver e movimentar patrimônio.', perfis: ['dono', 'gestor', 'almoxarife', 'engenheiro_obra'] },
  { rotulo: 'Solicitações de compra', para: '/sup/solicitacoes', ajuda: 'Pedir material para a obra.', perfis: ['dono', 'gestor'] },
  { rotulo: 'Medições', para: '/sup/medicoes', ajuda: 'Acompanhar as medições dos contratos.', perfis: ['dono', 'gestor'] },
  { rotulo: 'Autorizações', para: '/sup/autorizacoes', ajuda: 'Aprovar ou acompanhar pagamentos.', perfis: ['dono', 'gestor'] },
];

export function Campo() {
  const { usuario } = useSessao();
  const navegar = useNavigate();
  const perfil = usuario?.perfil ?? '';
  const visiveis = ATALHOS.filter((a) => a.perfis.includes(perfil));

  function irParaErp() {
    salvarModo('erp');
    navegar('/', { replace: true });
  }

  return (
    <div className="pagina">
      <div className="cabecalho">
        <div className="titulo">
          <h1>Modo campo</h1>
          <span className="muted">{usuario?.nome}</span>
        </div>
        <div className="acoes">
          <button type="button" className="btn btn-secundario" onClick={irParaErp}>Usar ERP completo</button>
        </div>
      </div>
      {!(PERFIS_CAMPO as readonly string[]).includes(perfil) || visiveis.length === 0 ? (
        <p className="muted">Nenhuma tela de campo está liberada para o seu perfil.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {visiveis.map((a) => (
            <Link key={a.para} to={a.para} className="card" style={{ textDecoration: 'none', color: 'inherit', padding: 16, minHeight: 96 }}>
              <strong style={{ fontSize: 16 }}>{a.rotulo}</strong>
              <p className="small muted" style={{ margin: '6px 0 0' }}>{a.ajuda}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
