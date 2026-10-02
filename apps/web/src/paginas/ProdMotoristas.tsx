import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  agoraLocal,
  api,
  diaCurto,
  formatarData,
  formatarMoeda,
  formatarNumero,
  hojeLocal,
  lerNumero,
  NOMES_FUNCAO,
  somarDias,
  somarMeses,
  type LinhaProducao,
  type ProducaoPessoa,
  type ValoresVigentes,
} from '../api';
import { CabecalhoDocumento } from '../componentes/Documento';
import { TabelaRelatorio } from '../componentes/Relatorio';

export type Dias = { de: string; ate: string };

/** "01/09/2026 a 30/09/2026" */
export const textoDias = (p: Dias) => (p.de === p.ate ? formatarData(p.de) : `${formatarData(p.de)} a ${formatarData(p.ate)}`);

export function atalhosDias(): { id: string; texto: string; p: Dias }[] {
  const hoje = hojeLocal();
  const mes = `${hoje.slice(0, 7)}-01`;
  const anterior = somarMeses(mes, -1);
  const dia = Number(hoje.slice(8, 10));
  const quinzena = dia <= 15 ? { de: mes, ate: hoje } : { de: `${hoje.slice(0, 7)}-16`, ate: hoje };
  const fimAnterior = somarDias(mes, -1);
  const quinzenaAnterior = dia <= 15 ? { de: `${anterior.slice(0, 7)}-16`, ate: fimAnterior } : { de: mes, ate: `${hoje.slice(0, 7)}-15` };
  return [
    { id: 'mes', texto: 'Este mês', p: { de: mes, ate: hoje } },
    { id: 'anterior', texto: 'Mês passado', p: { de: anterior, ate: fimAnterior } },
    { id: 'quinzena', texto: 'Esta quinzena', p: quinzena },
    { id: 'quinzena-ant', texto: 'Quinzena passada', p: quinzenaAnterior },
    { id: '7d', texto: '7 dias', p: { de: somarDias(hoje, -6), ate: hoje } },
  ];
}

/** Atalhos e datas de início e fim escolhidas livremente. */
export function SeletorDias({ valor, aoMudar }: { valor: Dias; aoMudar: (p: Dias) => void }) {
  const atalhos = atalhosDias();
  return (
    <div className="filtros nao-imprimir" style={{ alignItems: 'flex-end' }}>
      <div className="segmentado" role="group" aria-label="Período">
        {atalhos.map((a) => {
          const ativo = a.p.de === valor.de && a.p.ate === valor.ate;
          return (
            <button key={a.id} type="button" aria-pressed={ativo} className={ativo ? 'ativo' : ''} onClick={() => aoMudar(a.p)}>
              {a.texto}
            </button>
          );
        })}
      </div>
      <div className="periodo-manual">
        <label>
          De <input type="date" value={valor.de} onChange={(e) => e.target.value && aoMudar({ ...valor, de: e.target.value })} />
        </label>
        <label>
          até <input type="date" value={valor.ate} onChange={(e) => e.target.value && aoMudar({ ...valor, ate: e.target.value })} />
        </label>
      </div>
    </div>
  );
}

const m3 = (n: number) => `${formatarNumero(n, Number.isInteger(n) ? 0 : 1)} m³`;
const hora = (iso: string) => agoraLocal(new Date(iso)).slice(11, 16);

/** Extrato de produção de uma pessoa: carga a carga, com total. Usado pelo gestor e pelo próprio motorista. */
export function ExtratoProducao({ linhas, resumo }: { linhas: LinhaProducao[]; resumo: ProducaoPessoa | null }) {
  return (
    <>
      {resumo && (
        <div className="grade">
          <div className="card indicador">
            <span className="rotulo-ind">Entregas</span>
            <span className="valor-ind mono">{resumo.entregas}</span>
            <span className="small muted">{m3(resumo.m3Entregue)}</span>
          </div>
          {resumo.bombeamentos > 0 && (
            <div className="card indicador">
              <span className="rotulo-ind">Bombeamentos</span>
              <span className="valor-ind mono">{resumo.bombeamentos}</span>
              <span className="small muted">{m3(resumo.m3Bombeado)}</span>
            </div>
          )}
          <div className="card indicador">
            <span className="rotulo-ind">Dias com carga</span>
            <span className="valor-ind mono">{resumo.diasTrabalhados}</span>
          </div>
          <div className="card indicador">
            <span className="rotulo-ind">Produção no período</span>
            <span className="valor-ind mono">{formatarMoeda(resumo.total)}</span>
          </div>
        </div>
      )}
      <TabelaRelatorio
        titulo="Cargas"
        arquivo="producao-cargas"
        linhas={linhas}
        vazio="Nenhuma carga no período."
        colunas={[
          { titulo: 'Data', valor: (l) => `${diaCurto(l.dia)} ${hora(l.dataHora)}` },
          { titulo: 'Nº', valor: (l) => l.numero },
          { titulo: 'Serviço', valor: (l) => (l.papel === 'entrega' ? 'Entrega' : 'Bombeamento') },
          { titulo: 'Veículo', valor: (l) => l.veiculoCodigo },
          { titulo: 'Cliente', valor: (l) => [l.clienteNome, l.obra].filter(Boolean).join(' · ') || '—' },
          { titulo: 'Traço', valor: (l) => l.tracoCodigo },
          { titulo: 'm³', valor: (l) => l.m3, formato: 'decimal', total: true },
          { titulo: 'R$/m³', valor: (l) => l.valorM3, formato: 'moeda' },
          { titulo: 'Valor', valor: (l) => l.valor, formato: 'moeda', total: true },
        ]}
      />
    </>
  );
}

type Resposta = { de: string; ate: string; pessoas: ProducaoPessoa[]; detalhe: LinhaProducao[]; valores: ValoresVigentes; semValor: string[] };
type Valores = { vigentes: ValoresVigentes; historico: { id: string; funcao: 'motorista' | 'operador_bomba'; valorM3: number; vigencia: string }[] };

export function ProducaoMotoristas() {
  const [periodo, setPeriodo] = useState<Dias>(atalhosDias()[0].p);
  const [pessoa, setPessoa] = useState<ProducaoPessoa | null>(null);
  const [dados, setDados] = useState<Resposta | null>(null);
  const [valores, setValores] = useState<Valores | null>(null);
  const [novoValor, setNovoValor] = useState<{ funcao: 'motorista' | 'operador_bomba'; valor: string; vigencia: string } | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  const carregar = useCallback(async () => {
    try {
      setErro('');
      const q = `de=${periodo.de}&ate=${periodo.ate}${pessoa ? `&pessoaId=${pessoa.pessoaId}` : ''}`;
      const [r, v] = await Promise.all([api<Resposta>(`/prod/producao?${q}`), api<Valores>('/prod/valores')]);
      setDados(r);
      setValores(v);
    } catch (e) {
      setErro((e as Error).message);
    }
  }, [periodo, pessoa]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  async function salvarValor(e: FormEvent) {
    e.preventDefault();
    if (!novoValor) return;
    setErro('');
    try {
      const v = lerNumero(novoValor.valor);
      if (v === null) throw new Error('Informe o valor por m³.');
      await api('/prod/valores', { corpo: { funcao: novoValor.funcao, valorM3: v, vigencia: novoValor.vigencia } });
      setAviso(`Valor por m³ de ${novoValor.funcao === 'motorista' ? 'motorista' : 'operador de bomba'} gravado a partir de ${formatarData(novoValor.vigencia)}.`);
      setNovoValor(null);
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  async function excluirValor(id: string) {
    setErro('');
    try {
      await api(`/prod/valores/${id}`, { metodo: 'DELETE' });
      await carregar();
    } catch (err) {
      setErro((err as Error).message);
    }
  }

  const resumoPessoa = pessoa ? dados?.pessoas.find((p) => p.pessoaId === pessoa.pessoaId) ?? null : null;

  return (
    <>
      <CabecalhoDocumento
        modulo="Produção"
        titulo={pessoa ? `Produção de ${pessoa.nome}` : 'Produção dos motoristas'}
        descricao={
          pessoa
            ? `${NOMES_FUNCAO[pessoa.funcao]} · entregas e bombeamentos carga a carga, com o valor por m³ vigente em cada dia.`
            : 'Entregas por m³ para motoristas e m³ bombeado para operadores de bomba, com o valor vigente em cada dia.'
        }
        periodo={textoDias(periodo)}
        filtros={[
          dados?.valores.motorista ? `Motorista: ${formatarMoeda(dados.valores.motorista.valorM3)}/m³` : '',
          dados?.valores.operadorBomba ? `Operador de bomba: ${formatarMoeda(dados.valores.operadorBomba.valorM3)}/m³` : '',
        ].filter(Boolean)}
        acoes={
          pessoa ? (
            <button className="btn btn-secundario" type="button" onClick={() => setPessoa(null)}>
              Voltar para todos
            </button>
          ) : undefined
        }
      />
      <SeletorDias valor={periodo} aoMudar={setPeriodo} />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok nao-imprimir" role="status">{aviso}</div>}
      {dados && dados.semValor.length > 0 && (
        <div className="alerta alerta-aviso nao-imprimir">
          Falta definir o valor por m³ de {dados.semValor.map((f) => (f === 'motorista' ? 'motorista' : 'operador de bomba')).join(' e ')}. Sem ele a produção sai com valor zero. Defina em "Valores por m³", abaixo.
        </div>
      )}

      {pessoa ? (
        <ExtratoProducao linhas={dados?.detalhe ?? []} resumo={resumoPessoa} />
      ) : (
        <TabelaRelatorio
          titulo="Por pessoa"
          descricao="Toque no nome para ver o extrato carga a carga e imprimir para a pessoa."
          arquivo="producao-motoristas"
          linhas={dados?.pessoas ?? []}
          vazio="Nenhuma carga no período."
          colunas={[
            {
              titulo: 'Nome',
              valor: (p) => p.nome,
              render: (p) => (
                <button className="link-acao" type="button" onClick={() => setPessoa(p)}>
                  {p.nome}
                </button>
              ),
            },
            { titulo: 'Função', valor: (p) => NOMES_FUNCAO[p.funcao] },
            { titulo: 'Dias', valor: (p) => p.diasTrabalhados, formato: 'numero' },
            { titulo: 'Entregas', valor: (p) => p.entregas, formato: 'numero', total: true },
            { titulo: 'm³ entregue', valor: (p) => p.m3Entregue, formato: 'decimal', total: true },
            { titulo: 'Valor entregas', valor: (p) => p.valorEntregas, formato: 'moeda', total: true },
            { titulo: 'Bombeamentos', valor: (p) => p.bombeamentos, formato: 'numero', total: true },
            { titulo: 'm³ bombeado', valor: (p) => p.m3Bombeado, formato: 'decimal', total: true },
            { titulo: 'Valor bombeamento', valor: (p) => p.valorBombeamento, formato: 'moeda', total: true },
            { titulo: 'Total', valor: (p) => p.total, formato: 'moeda', total: true },
          ]}
        />
      )}

      <section className="card nao-imprimir">
        <div className="cartao-topo">
          <h2>Valores por m³</h2>
          {!novoValor && (
            <button className="btn btn-secundario" type="button" onClick={() => setNovoValor({ funcao: 'motorista', valor: '', vigencia: hojeLocal() })}>
              Novo valor ou reajuste
            </button>
          )}
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>
          Cada valor vale a partir da data de início. Um reajuste não muda a produção de dias anteriores.
        </p>
        {novoValor && (
          <form className="form" onSubmit={salvarValor} style={{ marginBottom: 12 }}>
            <div className="campos">
              <div className="campo">
                <label htmlFor="v-funcao">Para</label>
                <select id="v-funcao" value={novoValor.funcao} onChange={(e) => setNovoValor({ ...novoValor, funcao: e.target.value as 'motorista' })}>
                  <option value="motorista">Motoristas (por m³ entregue)</option>
                  <option value="operador_bomba">Operadores de bomba (por m³ bombeado)</option>
                </select>
              </div>
              <div className="campo">
                <label htmlFor="v-valor">Valor por m³ (R$)</label>
                <input id="v-valor" className="mono" inputMode="decimal" placeholder="ex.: 2,50" value={novoValor.valor} onChange={(e) => setNovoValor({ ...novoValor, valor: e.target.value })} />
              </div>
              <div className="campo">
                <label htmlFor="v-vig">Vale a partir de</label>
                <input id="v-vig" type="date" value={novoValor.vigencia} onChange={(e) => setNovoValor({ ...novoValor, vigencia: e.target.value })} />
              </div>
            </div>
            <div className="acoes">
              <button className="btn btn-primario" type="submit">Gravar valor</button>
              <button className="btn btn-link" type="button" onClick={() => setNovoValor(null)}>Cancelar</button>
            </div>
          </form>
        )}
        <table className="tabela tabela-compacta">
          <thead>
            <tr>
              <th>Para</th>
              <th style={{ textAlign: 'right' }}>R$ por m³</th>
              <th>A partir de</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(valores?.historico ?? []).map((v) => {
              const vigente = (v.funcao === 'motorista' ? valores?.vigentes.motorista : valores?.vigentes.operadorBomba)?.vigencia === v.vigencia;
              return (
                <tr key={v.id}>
                  <td>{v.funcao === 'motorista' ? 'Motoristas' : 'Operadores de bomba'}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>{formatarMoeda(v.valorM3)}</td>
                  <td>
                    {formatarData(v.vigencia)} {vigente && <span className="selo selo-ok">em vigor</span>}
                    {v.vigencia > hojeLocal() && <span className="selo selo-aviso">futuro</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-link" type="button" onClick={() => excluirValor(v.id)}>Excluir</button>
                  </td>
                </tr>
              );
            })}
            {valores && valores.historico.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">Nenhum valor definido ainda.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}

// ======================================================================= Visão do motorista

type Minha = { de: string; ate: string; resumo: ProducaoPessoa | null; detalhe: LinhaProducao[]; valores: ValoresVigentes };
type MinhaEscala = { hoje: string; dias: { data: string; entrada: string | null; folga: boolean; observacao: string | null }[] };

export function MinhaProducao() {
  const [periodo, setPeriodo] = useState<Dias>(atalhosDias()[0].p);
  const [dados, setDados] = useState<Minha | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    setErro('');
    api<Minha>(`/prod/minha-producao?de=${periodo.de}&ate=${periodo.ate}`).then(setDados).catch((e) => setErro((e as Error).message));
  }, [periodo]);
  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Minha produção</h1>
          <span className="muted">Suas entregas no período e o valor da produção.</span>
        </div>
      </div>
      <SeletorDias valor={periodo} aoMudar={setPeriodo} />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {dados && (
        <>
          {!dados.resumo && <div className="card muted">Nenhuma entrega em {textoDias(periodo)}.</div>}
          {dados.resumo && <ExtratoProducao linhas={dados.detalhe} resumo={dados.resumo} />}
          <p className="small muted">
            Valor por m³ hoje: {dados.valores.motorista ? `${formatarMoeda(dados.valores.motorista.valorM3)} por m³ entregue` : 'não definido'}
            {dados.valores.operadorBomba ? ` · ${formatarMoeda(dados.valores.operadorBomba.valorM3)} por m³ bombeado` : ''}. A produção é conferida e paga pela empresa.
          </p>
        </>
      )}
    </>
  );
}

export function MinhaEscala({ compacta = false }: { compacta?: boolean }) {
  const [dados, setDados] = useState<MinhaEscala | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    api<MinhaEscala>('/prod/minha-escala').then(setDados).catch((e) => setErro((e as Error).message));
  }, []);
  const lista = (dados?.dias ?? []).filter((d) => d.data >= (dados?.hoje ?? '')).slice(0, compacta ? 4 : 30);
  const corpo = (
    <>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {dados && lista.length === 0 && <p className="muted" style={{ margin: 0 }}>A escala dos próximos dias ainda não foi publicada.</p>}
      {lista.length > 0 && (
        <table className="tabela tabela-compacta">
          <tbody>
            {lista.map((d) => (
              <tr key={d.data}>
                <td>{d.data === dados?.hoje ? <b>Hoje</b> : diaCurto(d.data)}</td>
                <td className="mono" style={{ textAlign: 'right' }}>
                  {d.folga ? <span className="selo selo-neutro">Folga</span> : <b>Entrada {d.entrada}</b>}
                </td>
                {!compacta && <td className="small muted">{d.observacao ?? ''}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
  if (compacta) return corpo;
  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Minha escala</h1>
          <span className="muted">Seu horário de entrada nos próximos dias.</span>
        </div>
      </div>
      <div className="card">{corpo}</div>
    </>
  );
}
