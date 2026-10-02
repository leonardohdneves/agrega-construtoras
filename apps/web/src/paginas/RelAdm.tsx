import { NOMES_FUNCAO, formatarData, formatarDocumento, type Funcao } from '../api';
import { SeletorPeriodo } from '../componentes/Periodo';
import { CabecalhoRelatorio, TabelaRelatorio, useRelatorio } from '../componentes/Relatorio';

type Resp = {
  de: string; ate: string; hoje: string;
  fornecedores: { id: string; nome: string; categoria: 'fornecedor' | 'credor'; ramo: string | null; documento: string | null; ativo: boolean; automatico: boolean; notas: number; comprado: number; ultima: string | null; aPagar: number }[];
  clientes: { id: string; nome: string; documento: string | null; cidade: string | null; ativo: boolean; vendido: number; ultima: string | null; aReceber: number; vencido: number }[];
  colaboradores: { id: string; nome: string; funcao: Funcao; cargo: string | null; ativo: boolean; cnhCategoria: string | null; cnhVencimento: string | null; admissao: string | null; temLogin: boolean; abastecimentos: number }[];
};

const ABAS = [
  { id: 'fornecedores', texto: 'Fornecedores e credores' },
  { id: 'clientes', texto: 'Clientes' },
  { id: 'colaboradores', texto: 'Colaboradores' },
];

export function RelAdm() {
  const { periodo, aba, dados: r, erro, mudar } = useRelatorio<Resp>('/rel/administrativo', 'fornecedores', '3m');
  const sufixo = `${periodo.de}_${periodo.ate}`;
  return (
    <>
      <CabecalhoRelatorio
        modulo="Administrativo"
        periodo={periodo}
        titulo="Relatórios administrativos"
        sub="Cadastros com o movimento de cada um: compras por fornecedor, vendas e saldo por cliente e situação dos colaboradores."
        abas={ABAS}
        aba={aba}
        aoMudar={(id) => mudar({ aba: id })}
        extra={<SeletorPeriodo valor={periodo} aoMudar={(p) => mudar(p)} />}
      />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {!r ? (
        !erro && <p className="muted">Carregando…</p>
      ) : aba === 'fornecedores' ? (
        <TabelaRelatorio
          titulo="Fornecedores e credores"
          descricao={`Compras confirmadas de ${formatarData(r.de)} a ${formatarData(r.ate)}; "a pagar" é o saldo em aberto hoje.`}
          arquivo={`fornecedores_${sufixo}`}
          linhas={r.fornecedores}
          limite={40}
          colunas={[
            { titulo: 'Nome', valor: (f) => f.nome, render: (f) => <>{f.nome}{!f.ativo && <span className="small muted"> · inativo</span>}{f.automatico && <span className="small muted"> · criado pelo XML</span>}</> },
            { titulo: 'Tipo', valor: (f) => (f.categoria === 'credor' ? 'Credor' : 'Fornecedor') },
            { titulo: 'Ramo', valor: (f) => f.ramo },
            { titulo: 'CNPJ / CPF', valor: (f) => (f.documento ? formatarDocumento(f.documento) : null), destaque: (f) => (f.documento ? undefined : 'aviso') },
            { titulo: 'Notas', valor: (f) => f.notas, formato: 'numero', total: true },
            { titulo: 'Comprado', valor: (f) => f.comprado, formato: 'moeda', total: true },
            { titulo: 'Última compra', valor: (f) => f.ultima, formato: 'data' },
            { titulo: 'A pagar', valor: (f) => f.aPagar, formato: 'moeda', total: true },
          ]}
        />
      ) : aba === 'clientes' ? (
        <TabelaRelatorio
          titulo="Clientes"
          descricao={`Vendas confirmadas de ${formatarData(r.de)} a ${formatarData(r.ate)}; a receber e vencido são de hoje.`}
          arquivo={`clientes_${sufixo}`}
          linhas={r.clientes}
          limite={40}
          colunas={[
            { titulo: 'Cliente', valor: (c) => c.nome, render: (c) => <>{c.nome}{!c.ativo && <span className="small muted"> · inativo</span>}</> },
            { titulo: 'CNPJ / CPF', valor: (c) => (c.documento ? formatarDocumento(c.documento) : null) },
            { titulo: 'Cidade', valor: (c) => c.cidade },
            { titulo: 'Vendido', valor: (c) => c.vendido, formato: 'moeda', total: true },
            { titulo: 'Última venda', valor: (c) => c.ultima, formato: 'data' },
            { titulo: 'A receber', valor: (c) => c.aReceber, formato: 'moeda', total: true },
            { titulo: 'Vencido', valor: (c) => c.vencido, formato: 'moeda', total: true, destaque: (c) => (c.vencido ? 'perigo' : undefined) },
          ]}
        />
      ) : (
        <TabelaRelatorio
          titulo="Colaboradores"
          descricao="CNH, acesso ao sistema e abastecimentos registrados no período."
          arquivo={`colaboradores_${sufixo}`}
          linhas={r.colaboradores}
          colunas={[
            { titulo: 'Nome', valor: (c) => c.nome, render: (c) => <>{c.nome}{!c.ativo && <span className="small muted"> · inativo</span>}</> },
            { titulo: 'Função', valor: (c) => NOMES_FUNCAO[c.funcao] ?? c.funcao },
            { titulo: 'Cargo', valor: (c) => c.cargo },
            { titulo: 'Admissão', valor: (c) => c.admissao, formato: 'data' },
            { titulo: 'CNH', valor: (c) => c.cnhCategoria },
            {
              titulo: 'Vence em',
              valor: (c) => c.cnhVencimento,
              formato: 'data',
              destaque: (c) => (!c.cnhVencimento ? undefined : c.cnhVencimento < r.hoje ? 'perigo' : c.cnhVencimento <= addDias(r.hoje, 30) ? 'aviso' : undefined),
            },
            { titulo: 'Acesso ao app', valor: (c) => (c.temLogin ? 'Sim' : 'Não') },
            { titulo: 'Abastecimentos', valor: (c) => c.abastecimentos, formato: 'numero', total: true },
          ]}
        />
      )}
    </>
  );
}

function addDias(d: string, n: number) {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
