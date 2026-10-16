// Gerencial · Acompanhamento de obra: Curva S (previsto, executado e realizado) e previsto x realizado por etapa.
// Acesso só para dono e gestor (o módulo gerencial e as rotas de engenharia já exigem esses perfis).
import { useEffect, useState } from 'react';
import { api, formatarMoeda } from '../api';
import { SecaoObra } from './EngSecoes';
import { BarrasComparativasBI, GraficoLinhasBI } from '../componentes/GraficoBI';

type PontoCurva = { data: string; previsto: number; executado: number | null; realizado: number | null };
type Curva = { pontos: PontoCurva[]; hoje: string; custoTotal: number; dataUltimaMedicao: string | null; vazio?: string; indices: { cpi: number | null; spi: number | null } };
type LinhaPR = { id: string; codigo: string; descricao: string; nivel: string; custoPrevisto: number; previstoAte: number; executado: number; percentualExecutado: number; saldo: number; spi: number | null };
type PrevistoRealizado = {
  dataRef: string; linhas: LinhaPR[];
  totais: { custoPrevisto: number; previstoAte: number; executado: number; realizado: number; saldo: number; cpi: number | null; spi: number | null };
  observacao: string;
};

const dataBr = (iso: string) => iso.split('-').reverse().join('/');
const reais = (centavos: number) => formatarMoeda(centavos / 100);
const indice = (n: number | null) => (n === null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
const profundidade = (codigo: string) => codigo.split('.').length - 1;

export function GerAcompanhamento() {
  return (
    <SecaoObra titulo="Acompanhamento de obra" ajuda="Análise da obra a partir das medições físicas, do planejamento e das despesas confirmadas.">
      {(c) => <PainelGerencial obraId={c.obra.id} setErro={c.setErro} />}
    </SecaoObra>
  );
}

function PainelGerencial({ obraId, setErro }: { obraId: string; setErro: (m: string) => void }) {
  const [aba, setAba] = useState<'curva' | 'pr'>('curva');
  return (
    <>
      <div className="segmentado" role="group" aria-label="Relatório" style={{ marginBottom: 12 }}>
        <button type="button" aria-pressed={aba === 'curva'} className={aba === 'curva' ? 'ativo' : ''} onClick={() => setAba('curva')}>Curva S</button>
        <button type="button" aria-pressed={aba === 'pr'} className={aba === 'pr' ? 'ativo' : ''} onClick={() => setAba('pr')}>Previsto x realizado</button>
      </div>
      {aba === 'curva' ? <CurvaS obraId={obraId} setErro={setErro} /> : <PrevistoRealizadoView obraId={obraId} setErro={setErro} />}
    </>
  );
}

function CurvaS({ obraId, setErro }: { obraId: string; setErro: (m: string) => void }) {
  const [dados, setDados] = useState<Curva | null>(null);
  useEffect(() => {
    setDados(null);
    api<Curva>(`/eng/obras/${obraId}/relatorios-gerenciais/curva-s`).then(setDados).catch((e) => setErro((e as Error).message));
  }, [obraId]);

  if (!dados) return <p className="muted">Carregando…</p>;
  if (dados.vazio || !dados.pontos.length) return <div className="card"><p className="muted" style={{ margin: 0 }}>{dados.vazio ?? 'Sem dados para a Curva S.'}</p></div>;

  return (
    <>
      <div className="card">
        <div className="kpis" style={{ marginBottom: 16 }}>
          <div className="kpi"><div className="kpi-rotulo">Custo direto orçado</div><div className="kpi-valor">{reais(dados.custoTotal)}</div></div>
          <div className="kpi"><div className="kpi-rotulo">Última medição</div><div className="kpi-valor">{dados.dataUltimaMedicao ? dataBr(dados.dataUltimaMedicao) : "—"}</div></div>
          <div className={"kpi" + (dados.indices.spi !== null && dados.indices.spi < 1 ? " kpi-perigo" : "")}><div className="kpi-rotulo">SPI</div><div className="kpi-valor">{indice(dados.indices.spi)}</div><div className="kpi-detalhe">executado ÷ previsto</div></div>
          <div className={"kpi" + (dados.indices.cpi !== null && dados.indices.cpi < 1 ? " kpi-perigo" : "")}><div className="kpi-rotulo">CPI</div><div className="kpi-valor">{indice(dados.indices.cpi)}</div><div className="kpi-detalhe">executado ÷ realizado</div></div>
        </div>
        <GraficoLinhasBI
          titulo="Curva S: previsto, executado e realizado por mês"
          pontos={dados.pontos.map((p) => ({ rotulo: dataBr(p.data).slice(3), valores: { previsto: p.previsto, executado: p.executado, realizado: p.realizado } }))}
          series={[
            { id: "previsto", nome: "Previsto", cor: "#2a78d6" },
            { id: "executado", nome: "Executado", cor: "#eb6834" },
            { id: "realizado", nome: "Realizado", cor: "#8b8a85", tracejada: true },
          ]}
          formatar={(v) => formatarMoeda(v / 100)}
        />
        <p className="small muted">
          Previsto: custo das atividades do planejamento no tempo. Executado: valor das medições. Realizado: despesas confirmadas apropriadas ao centro de custo da obra.
          SPI abaixo de 1 indica atraso; CPI abaixo de 1 indica custo acima do executado.
        </p>
      </div>
      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table className="tabela">
            <thead>
              <tr><th>Mês</th><th className="num">Previsto</th><th className="num">Executado</th><th className="num">Realizado</th></tr>
            </thead>
            <tbody>
              {dados.pontos.map((p) => (
                <tr key={p.data}>
                  <td>{dataBr(p.data)}</td>
                  <td className="num">{reais(p.previsto)}</td>
                  <td className="num">{p.executado === null ? '—' : reais(p.executado)}</td>
                  <td className="num">{p.realizado === null ? '—' : reais(p.realizado)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function PrevistoRealizadoView({ obraId, setErro }: { obraId: string; setErro: (m: string) => void }) {
  const [dados, setDados] = useState<PrevistoRealizado | null>(null);
  const [data, setData] = useState('');
  useEffect(() => {
    setDados(null);
    const q = data ? `?data=${data}` : '';
    api<PrevistoRealizado>(`/eng/obras/${obraId}/relatorios-gerenciais/previsto-realizado${q}`)
      .then((r) => { setDados(r); if (!data) setData(r.dataRef); })
      .catch((e) => setErro((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obraId, data]);

  if (!dados) return <p className="muted">Carregando…</p>;
  const t = dados.totais;
  return (
    <>
      {dados.linhas.some((l) => l.nivel === "etapa") && (
        <div className="card" style={{ marginBottom: 12 }}>
          <h3 style={{ marginTop: 0 }}>Previsto x executado por etapa</h3>
          <BarrasComparativasBI
            itens={dados.linhas.filter((l) => l.nivel === "etapa").map((l) => ({ id: l.id, rotulo: `${l.codigo} ${l.descricao}`, primeira: l.previstoAte, segunda: l.executado }))}
            formatar={(v) => formatarMoeda(v / 100)}
            rotuloPrimeira="Previsto até a data"
            rotuloSegunda="Executado"
            corPrimeira="#2a78d6"
            corSegunda="#eb6834"
          />
        </div>
      )}
      <div className="card" style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'end' }}>
        <div className="campo">
          <label htmlFor="pr-data">Data de referência</label>
          <input id="pr-data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </div>
        <div><div className="small muted">Custo previsto (total)</div><b>{reais(t.custoPrevisto)}</b></div>
        <div><div className="small muted">Previsto até a data</div><b>{reais(t.previstoAte)}</b></div>
        <div><div className="small muted">Executado (valor)</div><b>{reais(t.executado)}</b></div>
        <div><div className="small muted">Realizado (despesas)</div><b>{reais(t.realizado)}</b></div>
        <div><div className="small muted">SPI</div><b>{indice(t.spi)}</b></div>
        <div><div className="small muted">CPI</div><b>{indice(t.cpi)}</b></div>
        <p className="small muted" style={{ flexBasis: '100%', margin: 0 }}>{dados.observacao}</p>
      </div>
      <div className="card">
        <div style={{ overflowX: 'auto' }}>
          <table className="tabela">
            <thead>
              <tr>
                <th>EAP</th>
                <th>Descrição</th>
                <th className="num">Previsto</th>
                <th className="num">Previsto até a data</th>
                <th className="num">Executado</th>
                <th className="num">% executado</th>
                <th className="num">Saldo a executar</th>
                <th className="num">SPI</th>
              </tr>
            </thead>
            <tbody>
              {dados.linhas.map((l) => (
                <tr key={l.id} style={l.nivel === 'etapa' ? { fontWeight: 600 } : undefined}>
                  <td className="mono small" style={{ paddingLeft: 12 + profundidade(l.codigo) * 14 }}>{l.codigo}</td>
                  <td>{l.descricao}</td>
                  <td className="num">{reais(l.custoPrevisto)}</td>
                  <td className="num">{reais(l.previstoAte)}</td>
                  <td className="num">{reais(l.executado)}</td>
                  <td className="num">{indice(l.percentualExecutado)}%</td>
                  <td className="num">{reais(l.saldo)}</td>
                  <td className="num">{indice(l.spi)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">SPI abaixo de 1 indica que a etapa está atrasada em relação ao previsto na data de referência.</p>
      </div>
    </>
  );
}
