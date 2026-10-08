import { InicioVendedor } from './Comercial';
import { CardMural } from './Mural';
import { MinhasCargas } from './MinhasCargas';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  api,
  formatarData,
  formatarMoeda,
  formatarNumero,
  hojeLocal,
  NOMES_PERFIL,
  NOMES_TIPO_DOCUMENTO,
  seloVencimento,
  textoFalta,
  type Alerta,
  type ConsumoVeiculo,
  type ContaFinanceira,
  type DocumentoVeiculo,
  type ItemManutencao,
} from '../api';
import { useSessao } from '../sessao';
import { temModulo } from '../acesso';
import { fmtIndicador, type IndicadorDados, type RespIndicadores } from '../componentes/Indicadores';
import { mesCurto } from '../componentes/Periodo';
import { MinhaEscala } from './ProdMotoristas';
import { InicioLaboratorio } from './Qualidade';
import { CardAprovacoes } from './SupAprovacoes';

const ETAPAS: { n: number; nome: string; pronta?: boolean; adiada?: boolean }[] = [
  { n: 0, nome: 'Base: login, perfis, empresa e usuários', pronta: true },
  { n: 1, nome: 'Cadastros da frota: veículos, motoristas e documentos', pronta: true },
  { n: 2, nome: 'Abastecimento pelo celular, km/L e L/h', pronta: true },
  { n: 3, nome: 'Manutenção preventiva e ordens de serviço', pronta: true },
  { n: 4, nome: 'Financeiro: contas, plano de contas, a pagar e a receber', pronta: true },
  { n: 5, nome: 'Nota fiscal: lançamento manual e importação de XML', pronta: true },
  { n: 6, nome: 'Conciliação bancária com OFX', pronta: true },
  { n: 7, nome: 'Relatórios: DRE, fluxo de caixa e custo por veículo', pronta: true },
];

type ConsumoAlto = { veiculoId: string; codigo: string; piora: number; ultimo: { kmPorLitro: number | null; litrosPorHora: number | null }; media90: { kmPorLitro: number | null; litrosPorHora: number | null } };
type ResumoFrota = { alertas: Alerta[]; consumoAlto: ConsumoAlto[]; manutencao: ItemManutencao[]; osAbertas: number; frota: { disponivel: number; manutencao: number; parado: number; inativo: number } };
type Bloco = { quantidade: number; valor: number };
type LadoFin = { vencidas: Bloco; hoje: Bloco; semana: Bloco; aberto: number; realizadoMes: number };
type ResumoFin = { financeiroVisivel?: boolean; saldoTotal: number; contas: ContaFinanceira[]; pagar: LadoFin; receber: LadoFin; configurado: { planoContas: boolean; contas: boolean }; notasParaConferir: number; extratoPendente: number; estoqueBaixo?: number; qualidade?: { cpsAtrasados: number; calibracoesVencidas: number; abaixoFck: number } };
type CustoManut = { veiculoId: string; codigo: string; ordens: number; total: number; pecas: number };
type Dados = { frota: ResumoFrota | null; fin: ResumoFin | null; consumo: ConsumoVeiculo[]; manut: CustoManut[]; erro: string; carregado?: boolean };

type Aba = 'geral' | 'frota' | 'financeiro' | 'indicadores';
const ABAS: { id: Aba; texto: string; soDono?: boolean }[] = [
  { id: 'geral', texto: 'Geral' },
  { id: 'frota', texto: 'Frota' },
  { id: 'financeiro', texto: 'Financeiro' },
  { id: 'indicadores', texto: 'Indicadores', soDono: true },
];

// ---------- Peças visuais ----------
function Kpi({ rotulo, valor, detalhe, para, tom }: { rotulo: string; valor: ReactNode; detalhe?: ReactNode; para?: string; tom?: 'perigo' | 'aviso' | 'ok' }) {
  const conteudo = (
    <>
      <span className="kpi-rotulo">{rotulo}</span>
      <span className="kpi-valor">{valor}</span>
      {detalhe !== undefined && <span className="kpi-detalhe">{detalhe}</span>}
    </>
  );
  const classe = `kpi ${tom ? `kpi-${tom}` : ''}`;
  return para ? (
    <Link to={para} className={classe}>
      {conteudo}
    </Link>
  ) : (
    <div className={classe}>{conteudo}</div>
  );
}

function Cartao({ titulo, link, children }: { titulo: string; link?: { para: string; texto: string }; children: ReactNode }) {
  return (
    <section className="card">
      <div className="cartao-topo">
        <h2>{titulo}</h2>
        {link && (
          <Link to={link.para} className="small cartao-link">
            {link.texto} ›
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/** Linha de lista: texto à esquerda (encolhe), valor à direita (não quebra). */
function Linha({ para, titulo, sub, valor, tom }: { para?: string; titulo: ReactNode; sub?: ReactNode; valor: ReactNode; tom?: 'perigo' | 'aviso' | 'ok' }) {
  return (
    <li>
      <span className="linha-texto">
        {para ? <Link to={para}>{titulo}</Link> : titulo}
        {sub && <span className="linha-sub">{sub}</span>}
      </span>
      <span className={`linha-valor ${tom ? `tom-${tom}` : ''}`}>{valor}</span>
    </li>
  );
}

const plural = (n: number, um: string, varios: string) => `${formatarNumero(n)} ${n === 1 ? um : varios}`;
const carregando = <p className="muted">Carregando…</p>;

// ---------- Aba Geral ----------
function AbaGeral({ d }: { d: Dados }) {
  const { frota, fin } = d;
  // Saldos e contas só para quem pode ver (dono e perfil Financeiro).
  const fc = fin && fin.financeiroVisivel !== false ? fin : null;
  const f = frota?.frota;
  const ativos = f ? f.disponivel + f.manutencao + f.parado : 0;
  const diesel30 = d.consumo.reduce((s, c) => s + (c.valor ?? 0), 0);
  const litros30 = d.consumo.reduce((s, c) => s + (c.litros ?? 0), 0);
  const manut30 = d.manut.reduce((s, c) => s + c.total, 0);
  const docsVencidos = frota?.alertas.filter((a) => a.situacao === 'vencido').length ?? 0;
  const docsVencendo = frota?.alertas.filter((a) => a.situacao === 'vencendo').length ?? 0;
  const revVencidas = frota?.manutencao.filter((m) => m.situacao === 'vencida').length ?? 0;
  const revProximas = frota?.manutencao.filter((m) => m.situacao === 'proxima').length ?? 0;

  const atencao: { chave: string; para: string; titulo: string; sub?: string; valor: string; tom: 'perigo' | 'aviso' }[] = [];
  if (fin) {
    if (fc?.notasParaConferir) atencao.push({ chave: 'notas', para: '/fin/notas?situacao=rascunho', titulo: plural(fin.notasParaConferir, 'nota fiscal para conferir', 'notas fiscais para conferir'), valor: 'Conferir', tom: 'aviso' });
    if (fc?.pagar.vencidas.quantidade) atencao.push({ chave: 'pv', para: '/fin/pagar-receber?tipo=despesa&situacao=vencidas', titulo: plural(fc.pagar.vencidas.quantidade, 'conta a pagar vencida', 'contas a pagar vencidas'), valor: formatarMoeda(fc.pagar.vencidas.valor), tom: 'perigo' });
    if (fc?.pagar.hoje.quantidade) atencao.push({ chave: 'ph', para: '/fin/pagar-receber?tipo=despesa&situacao=hoje', titulo: plural(fc.pagar.hoje.quantidade, 'conta a pagar hoje', 'contas a pagar hoje'), valor: formatarMoeda(fc.pagar.hoje.valor), tom: 'aviso' });
    if (fin.qualidade?.abaixoFck) atencao.push({ chave: 'fck', para: '/qual/amostras', titulo: plural(fin.qualidade.abaixoFck, 'resultado abaixo do fck (60 dias)', 'resultados abaixo do fck (60 dias)'), valor: 'Analisar', tom: 'perigo' });
    if (fin.qualidade?.cpsAtrasados) atencao.push({ chave: 'cps', para: '/qual/cps', titulo: plural(fin.qualidade.cpsAtrasados, 'corpo de prova atrasado', 'corpos de prova atrasados'), valor: 'Romper', tom: 'aviso' });
    if (fin.qualidade?.calibracoesVencidas) atencao.push({ chave: 'calib', para: '/qual/equipamentos', titulo: plural(fin.qualidade.calibracoesVencidas, 'calibração vencida', 'calibrações vencidas'), valor: 'Ver', tom: 'perigo' });
    if (fin.estoqueBaixo) atencao.push({ chave: 'estoque', para: '/prod/estoque', titulo: plural(fin.estoqueBaixo, 'insumo abaixo do estoque mínimo', 'insumos abaixo do estoque mínimo'), valor: 'Ver estoque', tom: 'perigo' });
    if (fc?.extratoPendente) atencao.push({ chave: 'ofx', para: '/fin/conciliacao', titulo: plural(fin.extratoPendente, 'linha do extrato para conciliar', 'linhas do extrato para conciliar'), valor: 'Conciliar', tom: 'aviso' });
    if (fc?.receber.vencidas.quantidade) atencao.push({ chave: 'rv', para: '/fin/pagar-receber?tipo=receita&situacao=vencidas', titulo: plural(fc.receber.vencidas.quantidade, 'recebimento atrasado', 'recebimentos atrasados'), valor: formatarMoeda(fc.receber.vencidas.valor), tom: 'perigo' });
  }
  if (frota) {
    if (revVencidas) atencao.push({ chave: 'rev', para: '/frota/manutencao', titulo: plural(revVencidas, 'revisão vencida', 'revisões vencidas'), sub: revProximas ? `e ${plural(revProximas, 'próxima', 'próximas')}` : undefined, valor: 'Ver', tom: 'perigo' });
    if (frota.osAbertas) atencao.push({ chave: 'os', para: '/frota/os', titulo: plural(frota.osAbertas, 'ordem de serviço aberta', 'ordens de serviço abertas'), valor: 'Ver', tom: 'aviso' });
    if (docsVencidos) atencao.push({ chave: 'dv', para: '/?aba=frota', titulo: plural(docsVencidos, 'documento ou CNH vencido', 'documentos ou CNHs vencidos'), sub: docsVencendo ? `e ${plural(docsVencendo, 'vencendo em 30 dias', 'vencendo em 30 dias')}` : undefined, valor: 'Ver', tom: 'perigo' });
    else if (docsVencendo) atencao.push({ chave: 'dvv', para: '/?aba=frota', titulo: plural(docsVencendo, 'documento vencendo em 30 dias', 'documentos vencendo em 30 dias'), valor: 'Ver', tom: 'aviso' });
    if (frota.consumoAlto.length) atencao.push({ chave: 'ca', para: '/frota/abastecimentos', titulo: plural(frota.consumoAlto.length, 'veículo com consumo acima da média', 'veículos com consumo acima da média'), sub: frota.consumoAlto.map((c) => c.codigo).join(', '), valor: 'Ver', tom: 'aviso' });
  }
  const resultadoMes = fc ? fc.receber.realizadoMes - fc.pagar.realizadoMes : 0;

  return (
    <>
      <div className="kpis">
        {fc && (<>
        <Kpi
          rotulo="Saldo em bancos e caixa"
          valor={fin ? formatarMoeda(fin.saldoTotal) : '—'}
          detalhe={fin ? plural(fin.contas.length, 'conta', 'contas') : undefined}
          para="/fin/contas"
          tom={fin && fin.saldoTotal < 0 ? 'perigo' : undefined}
        />
        <Kpi
          rotulo="A pagar em 7 dias"
          valor={fin ? formatarMoeda(fin.pagar.semana.valor + fin.pagar.vencidas.valor) : '—'}
          detalhe={fin ? (fin.pagar.vencidas.quantidade ? `inclui ${formatarMoeda(fin.pagar.vencidas.valor)} vencido` : plural(fin.pagar.semana.quantidade, 'conta', 'contas')) : undefined}
          para="/fin/pagar-receber?tipo=despesa&situacao=semana"
          tom={fin?.pagar.vencidas.quantidade ? 'perigo' : undefined}
        />
        <Kpi
          rotulo="A receber em 7 dias"
          valor={fin ? formatarMoeda(fin.receber.semana.valor + fin.receber.vencidas.valor) : '—'}
          detalhe={fin ? (fin.receber.vencidas.quantidade ? `inclui ${formatarMoeda(fin.receber.vencidas.valor)} atrasado` : plural(fin.receber.semana.quantidade, 'recebimento', 'recebimentos')) : undefined}
          para="/fin/pagar-receber?tipo=receita&situacao=semana"
          tom={fin?.receber.vencidas.quantidade ? 'aviso' : undefined}
        />
        </>)}
        {frota && (
        <Kpi
          rotulo="Frota disponível"
          valor={f ? `${f.disponivel} de ${ativos}` : '—'}
          detalhe={f ? `${f.manutencao} na oficina · ${f.parado} ${f.parado === 1 ? 'parado' : 'parados'}` : undefined}
          para="/frota/veiculos"
          tom={f && ativos && f.disponivel / ativos < 0.8 ? 'aviso' : undefined}
        />
        )}
      </div>

      <div className="grade-larga">
        <Cartao titulo="Precisa de atenção">
          {!d.carregado ? (
            carregando
          ) : atencao.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Nada pendente. Contas, revisões e documentos em dia.</p>
          ) : (
            <ul className="linhas">
              {atencao.map((a) => (
                <Linha key={a.chave} para={a.para} titulo={a.titulo} sub={a.sub} valor={a.valor} tom={a.tom} />
              ))}
            </ul>
          )}
        </Cartao>

        <Cartao titulo="Resumo do mês">
          {!d.carregado ? (
            carregando
          ) : !fc && !frota ? (
            <p className="muted" style={{ margin: 0 }}>Sem resumo financeiro ou da frota para o seu perfil.</p>
          ) : (
            <ul className="linhas">
              {fc && <Linha titulo="Recebido" valor={formatarMoeda(fc.receber.realizadoMes)} tom="ok" />}
              {fc && <Linha titulo="Pago" valor={formatarMoeda(fc.pagar.realizadoMes)} />}
              {fc && <Linha titulo="Recebido − pago" sub="caixa do mês, sem a DRE" valor={formatarMoeda(resultadoMes)} tom={resultadoMes < 0 ? 'perigo' : 'ok'} />}
              {frota && <Linha para="/frota/abastecimentos" titulo="Diesel (30 dias)" sub={`${formatarNumero(litros30)} L abastecidos`} valor={formatarMoeda(diesel30)} />}
              {frota && <Linha para="/frota/os" titulo="Manutenção (30 dias)" sub="OS concluídas" valor={formatarMoeda(manut30)} />}
            </ul>
          )}
        </Cartao>
      </div>

      <details className="card implantacao">
        <summary>
          <span>Implantação do Agrega</span>
          <span className="small muted">{ETAPAS.filter((e) => e.pronta).length} de {ETAPAS.length} etapas prontas</span>
        </summary>
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
      </details>
    </>
  );
}

// ---------- Aba Frota ----------
function AbaFrota({ d }: { d: Dados }) {
  const { frota } = d;
  const f = frota?.frota;
  const diesel30 = d.consumo.reduce((s, c) => s + (c.valor ?? 0), 0);
  const litros30 = d.consumo.reduce((s, c) => s + (c.litros ?? 0), 0);
  const manut30 = d.manut.reduce((s, c) => s + c.total, 0);
  const porVeiculo = useMemo(() => {
    const m = new Map<string, { veiculoId: string; codigo: string; litros: number; diesel: number; manut: number }>();
    for (const c of d.consumo) m.set(c.veiculoId, { veiculoId: c.veiculoId, codigo: c.codigo, litros: c.litros ?? 0, diesel: c.valor ?? 0, manut: 0 });
    for (const x of d.manut) {
      const v = m.get(x.veiculoId) ?? { veiculoId: x.veiculoId, codigo: x.codigo, litros: 0, diesel: 0, manut: 0 };
      v.manut += x.total;
      m.set(x.veiculoId, v);
    }
    return [...m.values()].filter((v) => v.diesel || v.manut || v.litros).sort((a, b) => b.diesel + b.manut - (a.diesel + a.manut));
  }, [d.consumo, d.manut]);

  return (
    <>
      <div className="kpis">
        <Kpi rotulo="Disponíveis" valor={f ? f.disponivel : '—'} para="/frota/veiculos" tom="ok" />
        <Kpi rotulo="Na oficina" valor={f ? f.manutencao : '—'} detalhe={frota ? plural(frota.osAbertas, 'OS aberta', 'OS abertas') : undefined} para="/frota/os" tom={f?.manutencao ? 'aviso' : undefined} />
        <Kpi rotulo="Parados" valor={f ? f.parado : '—'} para="/frota/veiculos" tom={f?.parado ? 'perigo' : undefined} />
        <Kpi rotulo="Diesel (30 dias)" valor={formatarMoeda(diesel30)} detalhe={`${formatarNumero(litros30)} L`} para="/frota/abastecimentos" />
        <Kpi rotulo="Manutenção (30 dias)" valor={formatarMoeda(manut30)} detalhe={plural(d.manut.reduce((s, x) => s + x.ordens, 0), 'OS concluída', 'OS concluídas')} para="/frota/os" />
      </div>

      <div className="grade-larga">
        <Cartao titulo="Manutenção preventiva" link={{ para: '/frota/manutencao', texto: 'Manutenção' }}>
          {!frota ? (
            carregando
          ) : frota.manutencao.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Nenhuma revisão vencida ou próxima. Frota em dia.</p>
          ) : (
            <>
              <ul className="linhas">
                {frota.manutencao.slice(0, 7).map((m) => (
                  <Linha
                    key={`${m.veiculoId}-${m.planoId}`}
                    para={`/frota/veiculos/${m.veiculoId}`}
                    titulo={
                      <>
                        <span className="mono">{m.codigo}</span> · {m.item}
                      </>
                    }
                    sub={textoFalta(m)}
                    valor={<span className={`selo ${m.situacao === 'vencida' ? 'selo-perigo' : 'selo-aviso'}`}>{m.situacao === 'vencida' ? 'Vencida' : 'Próxima'}</span>}
                  />
                ))}
              </ul>
              {frota.manutencao.length > 7 && (
                <p className="small muted" style={{ margin: '8px 0 0' }}>
                  e mais {frota.manutencao.length - 7}. <Link to="/frota/manutencao">Ver todas</Link>
                </p>
              )}
            </>
          )}
        </Cartao>

        <Cartao titulo="Documentos e CNH (30 dias)" link={{ para: '/frota/veiculos', texto: 'Veículos' }}>
          {!frota ? (
            carregando
          ) : frota.alertas.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Nenhum documento ou CNH vencendo. Tudo em dia.</p>
          ) : (
            <ul className="linhas">
              {frota.alertas.map((a, i) => {
                const s = seloVencimento(a.situacao, a.dias);
                const nome = a.tipo === 'cnh' ? 'CNH' : NOMES_TIPO_DOCUMENTO[a.item as DocumentoVeiculo['tipo']] ?? a.item;
                return (
                  <Linha
                    key={i}
                    para={a.tipo === 'documento' ? `/frota/veiculos/${a.veiculoId}` : '/frota/motoristas'}
                    titulo={
                      <>
                        <span className={a.tipo === 'documento' ? 'mono' : undefined}>{a.referencia}</span> · {nome}
                      </>
                    }
                    sub={formatarData(a.vencimento)}
                    valor={<span className={`selo ${s.classe}`}>{s.texto}</span>}
                  />
                );
              })}
            </ul>
          )}
        </Cartao>

        <Cartao titulo="Consumo acima da média" link={{ para: '/frota/abastecimentos', texto: 'Consumo' }}>
          {!frota ? (
            carregando
          ) : frota.consumoAlto.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Nenhum veículo com consumo mais de 15% pior que a própria média dos últimos 90 dias.</p>
          ) : (
            <ul className="linhas">
              {frota.consumoAlto.map((c) => (
                <Linha
                  key={c.veiculoId}
                  para={`/frota/veiculos/${c.veiculoId}`}
                  titulo={<span className="mono">{c.codigo}</span>}
                  sub={
                    c.ultimo.kmPorLitro && c.media90.kmPorLitro
                      ? `${formatarNumero(c.ultimo.kmPorLitro, 2)} km/L · média ${formatarNumero(c.media90.kmPorLitro, 2)}`
                      : `${formatarNumero(c.ultimo.litrosPorHora, 1)} L/h · média ${formatarNumero(c.media90.litrosPorHora, 1)}`
                  }
                  valor={<span className="selo selo-aviso">{formatarNumero(c.piora * 100)}% pior</span>}
                />
              ))}
            </ul>
          )}
        </Cartao>

        <Cartao titulo="Custo por veículo (30 dias)" link={{ para: '/frota/abastecimentos', texto: 'Abastecimentos' }}>
          {porVeiculo.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Sem abastecimentos ou OS concluídas nos últimos 30 dias.</p>
          ) : (
            <div className="tabela-caixa">
              <table className="tabela tabela-compacta">
                <thead>
                  <tr>
                    <th>Veículo</th>
                    <th style={{ textAlign: 'right' }}>Diesel</th>
                    <th style={{ textAlign: 'right' }}>Manutenção</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {porVeiculo.map((v) => (
                    <tr key={v.veiculoId}>
                      <td className="mono">
                        <Link to={`/frota/veiculos/${v.veiculoId}`}>{v.codigo}</Link>
                      </td>
                      <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(v.diesel)}</td>
                      <td className="mono" style={{ textAlign: 'right' }}>{v.manut ? formatarMoeda(v.manut) : '—'}</td>
                      <td className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{formatarMoeda(v.diesel + v.manut)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="small muted" style={{ margin: '8px 0 0' }}>Pelos registros da frota. O custo completo, com notas e rateios, está em <Link to="/ger/custo-veiculo">Custo por veículo</Link>.</p>
        </Cartao>
      </div>
    </>
  );
}

// ---------- Aba Financeiro ----------
function LadoCartao({ titulo, lado, tipo }: { titulo: string; lado: LadoFin; tipo: 'despesa' | 'receita' }) {
  const base = `/fin/pagar-receber?tipo=${tipo}`;
  return (
    <Cartao titulo={titulo} link={{ para: base, texto: 'Ver todas' }}>
      <ul className="linhas">
        <Linha para={`${base}&situacao=vencidas`} titulo={tipo === 'despesa' ? 'Vencidas' : 'Atrasadas'} sub={plural(lado.vencidas.quantidade, 'parcela', 'parcelas')} valor={formatarMoeda(lado.vencidas.valor)} tom={lado.vencidas.quantidade ? 'perigo' : undefined} />
        <Linha para={`${base}&situacao=hoje`} titulo="Vencem hoje" sub={plural(lado.hoje.quantidade, 'parcela', 'parcelas')} valor={formatarMoeda(lado.hoje.valor)} tom={lado.hoje.quantidade ? 'aviso' : undefined} />
        <Linha para={`${base}&situacao=semana`} titulo="Próximos 7 dias" sub={plural(lado.semana.quantidade, 'parcela', 'parcelas')} valor={formatarMoeda(lado.semana.valor)} />
        <Linha para={`${base}&situacao=abertas`} titulo="Total em aberto" valor={formatarMoeda(lado.aberto)} />
        <Linha para={`${base}&situacao=pagas`} titulo={tipo === 'despesa' ? 'Pago no mês' : 'Recebido no mês'} valor={formatarMoeda(lado.realizadoMes)} tom="ok" />
      </ul>
    </Cartao>
  );
}

function AbaFinanceiro({ d }: { d: Dados }) {
  const { fin } = d;
  if (!fin) return carregando;
  if (!fin.configurado.planoContas || !fin.configurado.contas)
    return (
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          Para começar, {!fin.configurado.planoContas ? <Link to="/fin/plano-contas">aplique o plano de contas</Link> : null}
          {!fin.configurado.planoContas && !fin.configurado.contas ? ' e ' : ''}
          {!fin.configurado.contas ? <Link to="/fin/contas">cadastre o banco e o caixa</Link> : null}.
        </p>
      </div>
    );
  const resultadoMes = fin.receber.realizadoMes - fin.pagar.realizadoMes;
  return (
    <>
      {fin.notasParaConferir > 0 && (
        <Link to="/fin/notas?situacao=rascunho" className="alerta alerta-aviso" style={{ textDecoration: 'none' }}>
          {fin.notasParaConferir === 1 ? '1 nota fiscal esperando conferência ›' : `${fin.notasParaConferir} notas fiscais esperando conferência ›`}
        </Link>
      )}
      <div className="kpis">
        <Kpi rotulo="Saldo em bancos e caixa" valor={formatarMoeda(fin.saldoTotal)} para="/fin/contas" tom={fin.saldoTotal < 0 ? 'perigo' : undefined} />
        <Kpi rotulo="A pagar em aberto" valor={formatarMoeda(fin.pagar.aberto)} detalhe={fin.pagar.vencidas.quantidade ? `${formatarMoeda(fin.pagar.vencidas.valor)} vencido` : 'nada vencido'} para="/fin/pagar-receber?tipo=despesa" tom={fin.pagar.vencidas.quantidade ? 'perigo' : undefined} />
        <Kpi rotulo="A receber em aberto" valor={formatarMoeda(fin.receber.aberto)} detalhe={fin.receber.vencidas.quantidade ? `${formatarMoeda(fin.receber.vencidas.valor)} atrasado` : 'nada atrasado'} para="/fin/pagar-receber?tipo=receita" tom={fin.receber.vencidas.quantidade ? 'aviso' : undefined} />
        <Kpi rotulo="Recebido − pago no mês" valor={formatarMoeda(resultadoMes)} detalhe="caixa do mês" tom={resultadoMes < 0 ? 'perigo' : 'ok'} />
      </div>
      <div className="grade-larga">
        <LadoCartao titulo="A pagar" lado={fin.pagar} tipo="despesa" />
        <LadoCartao titulo="A receber" lado={fin.receber} tipo="receita" />
        <Cartao titulo="Saldo por conta" link={{ para: '/fin/contas', texto: 'Bancos e caixa' }}>
          <ul className="linhas">
            {fin.contas.map((c) => (
              <Linha key={c.id} para="/fin/contas" titulo={c.nome} valor={formatarMoeda(c.saldo)} tom={c.saldo < 0 ? 'perigo' : undefined} />
            ))}
            <Linha titulo={<strong>Total</strong>} valor={<strong>{formatarMoeda(fin.saldoTotal)}</strong>} />
          </ul>
        </Cartao>
      </div>
    </>
  );
}

// ---------- Aba Indicadores (só o dono) ----------
const RETRATO = ['disponibilidade', 'cobertura_caixa', 'inadimplencia', 'revisoes_em_dia', 'notas_pendentes', 'perda_inventario', 'calibracoes_vencidas'];
const GRUPOS_IND: { titulo: string; ids: string[] }[] = [
  { titulo: 'Resultado', ids: ['receita_bruta', 'margem_bruta', 'margem_liquida', 'frota_sobre_receita'] },
  { titulo: 'Prazos', ids: ['pmr', 'pmp'] },
  { titulo: 'Frota', ids: ['consumo_bet', 'consumo_bomba', 'preco_diesel', 'custo_km', 'custo_hora_bomba', 'dias_parado_os', 'custo_manutencao'] },
  { titulo: 'Produção', ids: ['volume_produzido', 'm3_betoneira_dia', 'cimento_m3', 'material_teorico_m3', 'material_real_m3', 'frota_m3', 'devolvido_pct'] },
  { titulo: 'Qualidade', ids: ['resistencia_relativa', 'abaixo_fck', 'slump_fora', 'cps_no_prazo'] },
  { titulo: 'Controle', ids: ['abastecimentos_com_nota'] },
];

/** Compara o último mês fechado com o valor dos 6 meses: melhor, pior ou dentro da média (±5%). */
function situacao(ind: IndicadorDados, anterior: number | null): { texto: string; classe: string } | null {
  if (anterior === null || ind.valor === null || !ind.valor || ind.melhor === 'neutro') return null;
  const dif = (anterior - ind.valor) / Math.abs(ind.valor);
  if (Math.abs(dif) <= 0.05) return { texto: 'Na média', classe: 'selo-neutro' };
  const melhor = ind.melhor === 'maior' ? dif > 0 : dif < 0;
  return melhor ? { texto: 'Melhor que a média', classe: 'selo-ok' } : { texto: 'Pior que a média', classe: 'selo-perigo' };
}

function AbaIndicadores() {
  const [r, setR] = useState<RespIndicadores | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    api<RespIndicadores>('/rel/indicadores').then(setR).catch((e) => setErro((e as Error).message));
  }, []);
  if (erro) return <div className="alerta alerta-erro">{erro}</div>;
  if (!r) return carregando;
  const atual = r.meses[r.meses.length - 1];
  const anterior = r.meses[r.meses.length - 2];
  const porId = new Map(r.indicadores.map((i) => [i.id, i]));
  return (
    <>
      <section className="ind-bloco">
        <div className="ind-bloco-topo">
          <h2>Situação hoje</h2>
          <Link to="/ger/indicadores" className="small cartao-link">Conferir fórmulas ›</Link>
        </div>
        <div className="ind-hoje">
          {RETRATO.map((id) => {
            const i = porId.get(id);
            if (!i) return null;
            return (
              <div key={id} className="ind-hoje-item">
                <span className="ind-hoje-valor">{fmtIndicador(i.valor, i.unidade)}</span>
                <span className="ind-hoje-nome">{i.nome}</span>
                <span className="ind-hoje-leitura">{i.leitura}</span>
              </div>
            );
          })}
        </div>
      </section>

      {GRUPOS_IND.map((g) => (
        <section key={g.titulo} className="ind-bloco">
          <div className="ind-bloco-topo">
            <h2>{g.titulo}</h2>
          </div>
          <div className="tabela-caixa">
            <table className="tabela ind-tabela">
              <thead>
                <tr>
                  <th>Indicador</th>
                  <th style={{ textAlign: 'right' }}>{mesCurto(anterior)}</th>
                  <th style={{ textAlign: 'right' }}>6 meses</th>
                  <th style={{ textAlign: 'right' }}>{mesCurto(atual)} <span className="muted">(até hoje)</span></th>
                  <th>Último mês fechado</th>
                </tr>
              </thead>
              <tbody>
                {g.ids.map((id) => {
                  const i = porId.get(id);
                  if (!i) return null;
                  const vAnt = i.valores?.[anterior] ?? null;
                  const s = situacao(i, vAnt);
                  return (
                    <tr key={id}>
                      <td>
                        <span className="ind-nome">{i.nome}</span>
                        <span className="ind-leitura">{i.leitura}</span>
                      </td>
                      <td className="mono num forte">{fmtIndicador(vAnt, i.unidade)}</td>
                      <td className="mono num">{fmtIndicador(i.valor, i.unidade)}</td>
                      <td className="mono num muted">{fmtIndicador(i.valores?.[atual] ?? null, i.unidade)}</td>
                      <td>{s ? <span className={`selo ${s.classe}`}>{s.texto}</span> : <span className="muted small">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <p className="small muted">
        A coluna "6 meses" junta os seis meses antes de calcular. O mês atual ainda está em andamento, por isso a comparação usa o último mês fechado.
      </p>
    </>
  );
}

// ---------- Painel do dono e do gestor ----------
function PainelGestao() {
  const [params, setParams] = useSearchParams();
  const { usuario } = useSessao();
  const dono = usuario?.perfil === 'dono';
  const frotaOk = temModulo(usuario, 'frota');
  const finOk = temModulo(usuario, 'financeiro');
  const abas = ABAS.filter((a) => (!a.soDono || dono) && (a.id !== 'frota' || frotaOk) && (a.id !== 'financeiro' || finOk));
  const aba = (abas.some((a) => a.id === params.get('aba')) ? params.get('aba') : 'geral') as Aba;
  const [d, setD] = useState<Dados>({ frota: null, fin: null, consumo: [], manut: [], erro: '' });

  const carregar = useCallback(async () => {
    const erros: string[] = [];
    const [frota, fin, consumo, manut] = await Promise.all([
      frotaOk ? api<ResumoFrota>('/frota/alertas').catch((e) => (erros.push(e.message), null)) : null,
      api<ResumoFin>('/fin/resumo').catch((e) => (erros.push(e.message), null)),
      frotaOk ? api<{ veiculos: ConsumoVeiculo[] }>('/frota/consumo?dias=30').then((r) => r.veiculos).catch(() => []) : [],
      frotaOk ? api<{ veiculos: CustoManut[] }>('/frota/custo-manutencao?dias=30').then((r) => r.veiculos).catch(() => []) : [],
    ]);
    setD({ frota, fin, consumo, manut, erro: [...new Set(erros)].join(' '), carregado: true });
  }, [frotaOk, finOk]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  return (
    <>
      <div className="abas" role="tablist" aria-label="Painel">
        {abas.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={aba === a.id}
            className={aba === a.id ? 'ativa' : ''}
            onClick={() => setParams(a.id === 'geral' ? {} : { aba: a.id }, { replace: true })}
          >
            {a.texto}
          </button>
        ))}
      </div>
      {d.erro && <div className="alerta alerta-erro" role="alert">{d.erro}</div>}
      {aba === 'geral' && (dono || usuario?.perfil === 'gestor' || usuario?.administrador) && temModulo(usuario, 'gerencial') && <CardAprovacoes />}
      {aba === 'geral' && <AbaGeral d={d} />}
      {aba === 'frota' && <AbaFrota d={d} />}
      {aba === 'financeiro' && <AbaFinanceiro d={d} />}
      {aba === 'indicadores' && dono && <AbaIndicadores />}
    </>
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

      {usuario.perfil === 'motorista' && <MinhasCargas compacta />}
      <CardMural />

      {usuario.perfil === 'motorista' ? (
        <>
          <div className="card form">
            <h2>Abasteceu?</h2>
            <p className="muted" style={{ margin: 0 }}>Registre logo depois de abastecer, com os números da bomba e do painel.</p>
            <Link to="/abastecer" className="btn btn-primario btn-bloco">
              Registrar abastecimento
            </Link>
          </div>
          <div className="grade-larga">
            <div className="card">
              <div className="cartao-topo">
                <h2>Sua escala</h2>
                <Link className="btn btn-link" to="/minha-escala">Ver tudo</Link>
              </div>
              <MinhaEscala compacta />
            </div>
            <ResumoMinhaProducao />
          </div>
        </>
      ) : usuario.perfil === 'operador_usina' ? (
        <InicioUsina />
      ) : usuario.perfil === 'laboratorista' ? (
        <InicioLaboratorio />
      ) : usuario.perfil === 'vendedor' ? (
        <InicioVendedor />
      ) : (
        <PainelGestao />
      )}
    </>
  );
}

/** Produção do mês do motorista, no início do app. */
function ResumoMinhaProducao() {
  const [r, setR] = useState<{ resumo: { entregas: number; m3Entregue: number; bombeamentos: number; m3Bombeado: number; total: number } | null } | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    const hoje = hojeLocal();
    api(`/prod/minha-producao?de=${hoje.slice(0, 7)}-01&ate=${hoje}`).then(setR).catch((e) => setErro((e as Error).message));
  }, []);
  return (
    <div className="card">
      <div className="cartao-topo">
        <h2>Sua produção no mês</h2>
        <Link className="btn btn-link" to="/minha-producao">Detalhes</Link>
      </div>
      {erro && <p className="small muted" style={{ margin: 0 }}>{erro}</p>}
      {r && !r.resumo && <p className="muted" style={{ margin: 0 }}>Nenhuma entrega registrada neste mês.</p>}
      {r?.resumo && (
        <>
          <div className="valor-ind mono">{formatarMoeda(r.resumo.total)}</div>
          <p className="small muted" style={{ margin: '4px 0 0' }}>
            {r.resumo.entregas} entregas · {formatarNumero(r.resumo.m3Entregue, 1)} m³
            {r.resumo.bombeamentos ? ` · ${r.resumo.bombeamentos} bombeamentos · ${formatarNumero(r.resumo.m3Bombeado, 1)} m³` : ''}
          </p>
        </>
      )}
    </div>
  );
}

/** Início do operador de usina: registrar carga e o resumo do dia. */
function InicioUsina() {
  const [r, setR] = useState<{ resumo: { cargas: number; m3: number; bombeado: number } } | null>(null);
  useEffect(() => {
    api('/prod/cargas').then(setR).catch(() => {});
  }, []);
  return (
    <>
      <div className="card form">
        <h2>Saiu carga?</h2>
        <p className="muted" style={{ margin: 0 }}>Registre cada viagem quando a betoneira sair da usina: traço, volume, betoneira e motorista.</p>
        <Link to="/prod/cargas/nova" className="btn btn-primario btn-bloco">
          Registrar carga
        </Link>
      </div>
      <div className="grade">
        <div className="card indicador">
          <span className="rotulo-ind">Cargas hoje</span>
          <span className="valor-ind mono">{r ? r.resumo.cargas : '—'}</span>
        </div>
        <div className="card indicador">
          <span className="rotulo-ind">Volume hoje</span>
          <span className="valor-ind mono">{r ? `${formatarNumero(r.resumo.m3, 1)} m³` : '—'}</span>
        </div>
        <div className="card indicador">
          <span className="rotulo-ind">Bombeado hoje</span>
          <span className="valor-ind mono">{r ? `${formatarNumero(r.resumo.bombeado, 1)} m³` : '—'}</span>
        </div>
      </div>
      <p>
        <Link to="/prod/cargas">Ver as cargas do dia</Link> · <Link to="/prod/tracos">Consultar traços</Link>
      </p>
    </>
  );
}
