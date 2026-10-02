import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { fmtIndicador, type RespIndicadores } from '../componentes/Indicadores';
import { ATALHOS, mesCurto, SeletorPeriodo, type Periodo } from '../componentes/Periodo';
import { baixarCsv } from '../componentes/Relatorio';
import { CabecalhoDocumento, textoPeriodo } from '../componentes/Documento';

const MODULOS = ['Gerencial', 'Financeiro', 'Frota', 'Administrativo'] as const;

export function Indicadores() {
  const [params, setParams] = useSearchParams();
  const padrao = ATALHOS.find((a) => a.id === '6m')!.periodo();
  const periodo: Periodo = { de: params.get('de') ?? padrao.de, ate: params.get('ate') ?? padrao.ate };
  const [r, setR] = useState<RespIndicadores | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    setR(null);
    api<RespIndicadores>(`/rel/indicadores?de=${periodo.de}&ate=${periodo.ate}`)
      .then(setR)
      .catch((e) => setErro((e as Error).message));
  }, [periodo.de, periodo.ate]);

  function exportar() {
    if (!r) return;
    const cab = ['Indicador', 'Módulo', 'Período', ...r.meses.map(mesCurto), 'Fórmula', 'Fonte'];
    const linhas = r.indicadores.map((i) => [i.nome, i.modulo, fmtIndicador(i.valor, i.unidade), ...r.meses.map((m) => (i.valores ? fmtIndicador(i.valores[m], i.unidade) : '')), i.formula, i.fonte]);
    const esc = (s: string) => (/[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    baixarCsv(`indicadores_${periodo.de}_${periodo.ate}`, [cab, ...linhas].map((l) => l.map(esc).join(';')).join('\n'));
  }

  return (
    <>
      <CabecalhoDocumento
        modulo="Gerencial"
        titulo="Indicadores · conferência"
        descricao="Todos os indicadores usados no Agrega, com a fórmula, de onde vêm os dados e o valor de cada mês."
        periodo={textoPeriodo(periodo.de, periodo.ate)}
        acoes={
          <button className="btn btn-link" type="button" onClick={exportar} disabled={!r}>
            Baixar planilha
          </button>
        }
      />
      <div className="nao-imprimir"><SeletorPeriodo valor={periodo} aoMudar={(p) => setParams({ de: p.de, ate: p.ate }, { replace: true })} /></div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {!r ? (
        !erro && <p className="muted">Carregando…</p>
      ) : (
        MODULOS.map((mod) => {
          const lista = r.indicadores.filter((i) => i.modulo === mod);
          if (!lista.length) return null;
          return (
            <section key={mod} className="card tabela-caixa relatorio">
              <h2>{mod}</h2>
              <table className="tabela tabela-compacta tabela-indicadores">
                <thead>
                  <tr>
                    <th className="col-fixa">Indicador</th>
                    <th style={{ textAlign: 'right' }}>Período</th>
                    {r.meses.map((m) => (
                      <th key={m} style={{ textAlign: 'right' }}>{mesCurto(m)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lista.map((i) => (
                    <tr key={i.id}>
                      <td className="col-fixa">
                        <strong>{i.nome}</strong>
                        <div className="ind-formula">{i.formula}</div>
                        <div className="small muted">
                          Fonte: {i.fonte} {i.melhor !== 'neutro' && <>· Melhor quando {i.melhor === 'maior' ? 'maior' : 'menor'}.</>}
                        </div>
                        <div className="small muted">{i.leitura}</div>
                      </td>
                      <td className="mono num forte">
                        {fmtIndicador(i.valor, i.unidade)}
                        {i.retrato && <div className="small muted">hoje</div>}
                      </td>
                      {r.meses.map((m) => (
                        <td key={m} className="mono num">{i.valores ? fmtIndicador(i.valores[m], i.unidade) : <span className="muted">—</span>}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })
      )}
      <p className="small muted">
        "Período" junta todos os meses antes de dividir (não é a média dos meses). Indicadores marcados "hoje" mostram a situação atual e não têm valor por mês.
        Só entram notas e lançamentos confirmados.
      </p>
    </>
  );
}
