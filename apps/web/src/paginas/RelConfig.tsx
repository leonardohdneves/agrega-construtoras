import { NOMES_PERFIL, formatarDataHora, type Perfil } from '../api';
import { SeletorPeriodo } from '../componentes/Periodo';
import { CabecalhoRelatorio, TabelaRelatorio, useRelatorio } from '../componentes/Relatorio';

type Resp = {
  de: string; ate: string;
  usuarios: { id: string; nome: string; email: string; perfil: Perfil; ativo: boolean; ultimoAcesso: string | null; alteracoes: number }[];
  resumo: { entidade: string; acao: string; n: number }[];
  atividade: { dataHora: string; acao: string; entidade: string; entidadeId: string; usuario: string }[];
};

const ABAS = [
  { id: 'usuarios', texto: 'Usuários e acessos' },
  { id: 'resumo', texto: 'Alterações por tipo' },
  { id: 'atividade', texto: 'Últimas alterações' },
];

const ENTIDADES: Record<string, string> = {
  veiculos: 'Veículos', documentos_veiculo: 'Documentos de veículos', motoristas: 'Colaboradores', abastecimentos: 'Abastecimentos',
  ordens_servico: 'Ordens de serviço', os_itens: 'Itens de OS', planos_manutencao: 'Plano de manutenção', revisoes_veiculo: 'Revisões',
  fornecedores: 'Fornecedores', clientes: 'Clientes', contas_financeiras: 'Contas bancárias', plano_contas: 'Plano de contas',
  centros_custo: 'Centros de custo', lancamentos: 'Lançamentos', parcelas: 'Parcelas (baixas)', transferencias: 'Transferências',
  notas_fiscais: 'Notas fiscais', notas_itens: 'Itens de nota', usuarios: 'Usuários', empresas: 'Empresa', sessao: 'Acessos',
};
const ACOES: Record<string, string> = { criar: 'Criou', alterar: 'Alterou', excluir: 'Excluiu ou cancelou', confirmar: 'Confirmou', entrar: 'Entrou' };

export function RelConfig() {
  const { periodo, aba, dados: r, erro, mudar } = useRelatorio<Resp>('/rel/configuracoes', 'usuarios', 'mes');
  const sufixo = `${periodo.de}_${periodo.ate}`;
  return (
    <>
      <CabecalhoRelatorio
        modulo="Configurações"
        periodo={periodo}
        titulo="Relatórios de uso"
        sub="Quem usa o sistema e o que foi alterado. Toda alteração fica registrada com usuário e data."
        abas={ABAS}
        aba={aba}
        aoMudar={(id) => mudar({ aba: id })}
        extra={<SeletorPeriodo valor={periodo} aoMudar={(p) => mudar(p)} />}
      />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {!r ? (
        !erro && <p className="muted">Carregando…</p>
      ) : aba === 'usuarios' ? (
        <TabelaRelatorio
          titulo="Usuários e acessos"
          arquivo={`usuarios_${sufixo}`}
          linhas={r.usuarios}
          colunas={[
            { titulo: 'Nome', valor: (u) => u.nome, render: (u) => <>{u.nome}{!u.ativo && <span className="small muted"> · desativado</span>}</> },
            { titulo: 'E-mail', valor: (u) => u.email },
            { titulo: 'Perfil', valor: (u) => NOMES_PERFIL[u.perfil] },
            { titulo: 'Último acesso', valor: (u) => (u.ultimoAcesso ? formatarDataHora(u.ultimoAcesso) : 'Nunca entrou'), destaque: (u) => (u.ultimoAcesso ? undefined : 'aviso') },
            { titulo: 'Alterações no período', valor: (u) => u.alteracoes, formato: 'numero', total: true },
          ]}
        />
      ) : aba === 'resumo' ? (
        <TabelaRelatorio
          titulo="Alterações por tipo"
          arquivo={`alteracoes-por-tipo_${sufixo}`}
          linhas={r.resumo}
          colunas={[
            { titulo: 'Cadastro', valor: (x) => ENTIDADES[x.entidade] ?? x.entidade },
            { titulo: 'Ação', valor: (x) => ACOES[x.acao] ?? x.acao },
            { titulo: 'Quantidade', valor: (x) => x.n, formato: 'numero', total: true },
          ]}
        />
      ) : (
        <TabelaRelatorio
          titulo="Últimas alterações"
          descricao="As 300 mais recentes do período."
          arquivo={`ultimas-alteracoes_${sufixo}`}
          limite={60}
          linhas={r.atividade}
          colunas={[
            { titulo: 'Data e hora', valor: (x) => formatarDataHora(x.dataHora) },
            { titulo: 'Usuário', valor: (x) => x.usuario },
            { titulo: 'Ação', valor: (x) => ACOES[x.acao] ?? x.acao },
            { titulo: 'Cadastro', valor: (x) => ENTIDADES[x.entidade] ?? x.entidade },
          ]}
        />
      )}
    </>
  );
}
