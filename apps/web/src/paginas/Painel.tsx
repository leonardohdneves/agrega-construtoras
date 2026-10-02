import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  formatarData,
  formatarMoeda,
  formatarNumero,
  NOMES_PERFIL,
  NOMES_TIPO_DOCUMENTO,
  seloVencimento,
  textoFalta,
  type Alerta,
  type ContaFinanceira,
  type DocumentoVeiculo,
  type ItemManutencao,
} from '../api';
import { useSessao } from '../sessao';

const ETAPAS = [
  { n: 0, nome: 'Base: login, perfis, empresa e usuários', pronta: true },
  { n: 1, nome: 'Cadastros da frota: veículos, motoristas e documentos', pronta: true },
  { n: 2, nome: 'Abastecimento pelo celular, km/L e L/h', pronta: true },
  { n: 3, nome: 'Manutenção preventiva e ordens de serviço', pronta: true },
  { n: 4, nome: 'Financeiro: contas, plano de contas, a pagar e a receber', pronta: true },
  { n: 5, nome: 'Nota fiscal: lançamento manual e importação de XML' },
  { n: 6, nome: 'Conciliação bancária com OFX' },
  { n: 7, nome: 'Relatórios: DRE, fluxo de caixa e custo por veículo' },
];

type ConsumoAlto = { veiculoId: string; codigo: string; piora: number; ultimo: { kmPorLitro: number | null; litrosPorHora: number | null }; media90: { kmPorLitro: number | null; litrosPorHora: number | null } };
type Resumo = { alertas: Alerta[]; consumoAlto: ConsumoAlto[]; manutencao: ItemManutencao[]; osAbertas: number; frota: { disponivel: number; manutencao: number; parado: number; inativo: number } };

type Bloco = { quantidade: number; valor: number };
type ResumoFin = {
  saldoTotal: number;
  contas: ContaFinanceira[];
  pagar: { vencidas: Bloco; hoje: Bloco; semana: Bloco; aberto: number; realizadoMes: number };
  receber: { vencidas: Bloco; hoje: Bloco; semana: Bloco; aberto: number; realizadoMes: number };
  configurado: { planoContas: boolean; contas: boolean };
};

function LinhaFin({ rotulo, b, para, perigo }: { rotulo: string; b: Bloco; para: string; perigo?: boolean }) {
  return (
    <li>
      <Link to={para} style={{ textDecoration: 'none' }}>
        {rotulo}
        <span className="small muted"> · {b.quantidade}</span>
      </Link>
      <span className="mono" style={{ fontWeight: 600, color: perigo && b.quantidade ? 'var(--status-danger-ink)' : undefined }}>{formatarMoeda(b.valor)}</span>
    </li>
  );
}

function CardFinanceiro() {
  const [r, setR] = useState<ResumoFin | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    api<ResumoFin>('/fin/resumo').then(setR).catch((e) => setErro(e.message));
  }, []);
  return (
    <div className="card">
      <div className="cabecalho" style={{ marginBottom: 12 }}>
        <h2>Financeiro</h2>
        <Link to="/fin/pagar-receber" className="small" style={{ fontWeight: 600, textDecoration: 'none' }}>
          A pagar e a receber ›
        </Link>
      </div>
      {erro ? (
        <p className="muted">{erro}</p>
      ) : !r ? (
        <p className="muted">Carregando…</p>
      ) : !r.configurado.planoContas || !r.configurado.contas ? (
        <p className="muted" style={{ margin: 0 }}>
          Para começar, {!r.configurado.planoContas ? <Link to="/fin/plano-contas">aplique o plano de contas</Link> : null}
          {!r.configurado.planoContas && !r.configurado.contas ? ' e ' : ''}
          {!r.configurado.contas ? <Link to="/fin/contas">cadastre o banco e o caixa</Link> : null}.
        </p>
      ) : (
        <>
          <Link to="/fin/contas" className="bloco-saldo">
            <span className="small">Saldo em bancos e caixa</span>
            <strong className="mono" style={{ color: r.saldoTotal < 0 ? 'var(--status-danger-ink)' : undefined }}>{formatarMoeda(r.saldoTotal)}</strong>
          </Link>
          <div className="dois" style={{ marginTop: 12 }}>
            <div>
              <h3 className="sub-titulo">A pagar</h3>
              <ul className="lista-alertas compacta">
                <LinhaFin rotulo="Vencidas" b={r.pagar.vencidas} para="/fin/pagar-receber?tipo=despesa&situacao=vencidas" perigo />
                <LinhaFin rotulo="Hoje" b={r.pagar.hoje} para="/fin/pagar-receber?tipo=despesa&situacao=hoje" />
                <LinhaFin rotulo="7 dias" b={r.pagar.semana} para="/fin/pagar-receber?tipo=despesa&situacao=semana" />
              </ul>
            </div>
            <div>
              <h3 className="sub-titulo">A receber</h3>
              <ul className="lista-alertas compacta">
                <LinhaFin rotulo="Vencidas" b={r.receber.vencidas} para="/fin/pagar-receber?tipo=receita&situacao=vencidas" perigo />
                <LinhaFin rotulo="Hoje" b={r.receber.hoje} para="/fin/pagar-receber?tipo=receita&situacao=hoje" />
                <LinhaFin rotulo="7 dias" b={r.receber.semana} para="/fin/pagar-receber?tipo=receita&situacao=semana" />
              </ul>
            </div>
          </div>
          <p className="small muted" style={{ margin: '10px 0 0' }}>
            No mês: recebido {formatarMoeda(r.receber.realizadoMes)} · pago {formatarMoeda(r.pagar.realizadoMes)}
          </p>
        </>
      )}
    </div>
  );
}

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
      <CardFinanceiro />

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
        <div className="cabecalho" style={{ marginBottom: 12 }}>
          <h2>Manutenção preventiva</h2>
          <Link to="/frota/manutencao" className="small" style={{ fontWeight: 600, textDecoration: 'none' }}>
            Manutenção ›
          </Link>
        </div>
        {!dados ? (
          <p className="muted">Carregando…</p>
        ) : (
          <>
            {dados.osAbertas > 0 && (
              <p style={{ marginTop: 0 }}>
                <Link to="/frota/os" style={{ fontWeight: 600 }}>
                  {dados.osAbertas} {dados.osAbertas === 1 ? 'ordem de serviço aberta' : 'ordens de serviço abertas'} ›
                </Link>
              </p>
            )}
            {dados.manutencao.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>Nenhuma revisão vencida ou próxima. Frota em dia.</p>
            ) : (
              <ul className="lista-alertas">
                {dados.manutencao.slice(0, 6).map((m) => (
                  <li key={`${m.veiculoId}-${m.planoId}`}>
                    <span style={{ minWidth: 0 }}>
                      <Link to={`/frota/veiculos/${m.veiculoId}`} className="mono" style={{ textDecoration: 'none', fontWeight: 500 }}>
                        {m.codigo}
                      </Link>
                      <span className="small"> · {m.item}</span>
                      <div className="small muted">{textoFalta(m)}</div>
                    </span>
                    <span className={`selo ${m.situacao === 'vencida' ? 'selo-perigo' : 'selo-aviso'}`}>{m.situacao === 'vencida' ? 'Vencida' : 'Próxima'}</span>
                  </li>
                ))}
              </ul>
            )}
            {dados.manutencao.length > 6 && (
              <p className="small muted" style={{ margin: '8px 0 0' }}>
                e mais {dados.manutencao.length - 6}. <Link to="/frota/manutencao">Ver todas</Link>
              </p>
            )}
          </>
        )}
      </div>

      <div className="card">
        <div className="cabecalho" style={{ marginBottom: 12 }}>
          <h2>Consumo acima da média</h2>
          <Link to="/frota/abastecimentos" className="small" style={{ fontWeight: 600, textDecoration: 'none' }}>
            Consumo ›
          </Link>
        </div>
        {!dados ? (
          <p className="muted">Carregando…</p>
        ) : dados.consumoAlto.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nenhum veículo com consumo mais de 15% pior que a sua média dos últimos 90 dias.</p>
        ) : (
          <ul className="lista-alertas">
            {dados.consumoAlto.map((c) => (
              <li key={c.veiculoId}>
                <span>
                  <Link to={`/frota/veiculos/${c.veiculoId}`} className="mono" style={{ textDecoration: 'none', fontWeight: 500 }}>
                    {c.codigo}
                  </Link>
                  <div className="small muted mono">
                    {c.ultimo.kmPorLitro && c.media90.kmPorLitro
                      ? `${formatarNumero(c.ultimo.kmPorLitro, 2)} km/L · média ${formatarNumero(c.media90.kmPorLitro, 2)}`
                      : `${formatarNumero(c.ultimo.litrosPorHora, 1)} L/h · média ${formatarNumero(c.media90.litrosPorHora, 1)}`}
                  </div>
                </span>
                <span className="selo selo-aviso">{formatarNumero(c.piora * 100)}% pior</span>
              </li>
            ))}
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
        <div className="card form">
          <h2>Abasteceu?</h2>
          <p className="muted" style={{ margin: 0 }}>Registre logo depois de abastecer, com os números da bomba e do painel.</p>
          <Link to="/abastecer" className="btn btn-primario btn-bloco">
            Registrar abastecimento
          </Link>
        </div>
      ) : (
        <PainelGestao />
      )}
    </>
  );
}
