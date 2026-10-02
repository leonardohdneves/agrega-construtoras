import { useCallback, useEffect, useState } from 'react';
import { api, dataPorExtenso, diaCurto, hojeLocal, NOMES_FUNCAO, somarDias, type ItemEscala } from '../api';
import { CabecalhoDocumento } from '../componentes/Documento';

type Resposta = { data: string; anterior: string | null; salva: boolean; itens: ItemEscala[] };

/** Escala do dia: horário de entrada (ou folga) de cada motorista e operador de bomba. */
export function Escala() {
  const [data, setData] = useState(somarDias(hojeLocal(), 1));
  const [dados, setDados] = useState<Resposta | null>(null);
  const [itens, setItens] = useState<ItemEscala[]>([]);
  const [alterado, setAlterado] = useState(false);
  const [padrao, setPadrao] = useState('07:00');
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(
    async (copiar = false) => {
      try {
        setErro('');
        const r = await api<Resposta>(`/prod/escala?data=${data}${copiar ? '&copiar=1' : ''}`);
        setDados(r);
        setItens(r.itens);
        setAlterado(copiar);
        if (copiar) setAviso(r.anterior ? `Escala de ${diaCurto(r.anterior)} copiada. Confira e salve.` : 'Não há escala anterior para copiar.');
      } catch (e) {
        setErro((e as Error).message);
      }
    },
    [data],
  );
  useEffect(() => {
    setAviso('');
    carregar();
  }, [carregar]);

  function mudar(id: string, campo: Partial<ItemEscala>) {
    setItens((l) => l.map((i) => (i.motoristaId === id ? { ...i, ...campo } : i)));
    setAlterado(true);
  }

  function aplicarATodos() {
    setItens((l) => l.map((i) => (i.folga || i.entrada ? i : { ...i, entrada: padrao })));
    setAlterado(true);
  }

  async function salvar() {
    setErro('');
    setAviso('');
    setOcupado(true);
    try {
      await api(`/prod/escala/${data}`, { metodo: 'PUT', corpo: { itens: itens.map((i) => ({ motoristaId: i.motoristaId, entrada: i.folga ? null : i.entrada, folga: i.folga, observacao: i.observacao })) } });
      setAviso(`Escala de ${diaCurto(data)} salva. Os motoristas já veem o horário no app.`);
      await carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  function trocarDia(novo: string) {
    if (alterado && !window.confirm('A escala deste dia tem alterações não salvas. Trocar de dia mesmo assim?')) return;
    setData(novo);
  }

  const escalados = itens.filter((i) => !i.folga && i.entrada).length;
  const folgas = itens.filter((i) => i.folga).length;
  const semDefinir = itens.length - escalados - folgas;
  const ordenados = [...itens].sort((a, b) => Number(a.folga) - Number(b.folga) || (a.entrada ?? '99').localeCompare(b.entrada ?? '99') || a.nome.localeCompare(b.nome, 'pt-BR'));

  return (
    <>
      <CabecalhoDocumento
        modulo="Produção"
        titulo="Escala de trabalho"
        descricao="Horário de entrada dos motoristas e operadores de bomba."
        periodo={dataPorExtenso(data)}
        filtros={[`${escalados} escalados`, folgas ? `${folgas} de folga` : ''].filter(Boolean)}
      />
      <div className="filtros nao-imprimir">
        <div className="navegar-mes">
          <button className="btn btn-secundario" type="button" aria-label="Dia anterior" onClick={() => trocarDia(somarDias(data, -1))}>‹</button>
          <input type="date" value={data} aria-label="Dia da escala" onChange={(e) => e.target.value && trocarDia(e.target.value)} />
          <button className="btn btn-secundario" type="button" aria-label="Próximo dia" onClick={() => trocarDia(somarDias(data, 1))}>›</button>
        </div>
        <button className="btn btn-secundario" type="button" disabled={!dados?.anterior} onClick={() => carregar(true)}>
          Copiar {dados?.anterior ? `de ${diaCurto(dados.anterior)}` : 'do dia anterior'}
        </button>
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <input type="time" className="escala-hora" value={padrao} onChange={(e) => setPadrao(e.target.value)} aria-label="Horário para quem está sem horário" />
          <button className="btn btn-secundario" type="button" onClick={aplicarATodos}>Aplicar a quem está sem horário</button>
        </span>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta alerta-ok nao-imprimir" role="status">{aviso}</div>}
      {dados && !dados.salva && !alterado && (
        <div className="alerta alerta-info nao-imprimir">A escala deste dia ainda não foi montada. Copie a do dia anterior ou preencha os horários.</div>
      )}

      <section className="card tabela-caixa relatorio">
        <h2>{diaCurto(data)}</h2>
        {itens.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Cadastre os motoristas e operadores em Frota › Motoristas.</p>
        ) : (
          <table className="tabela">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Função</th>
                <th>Entrada</th>
                <th className="nao-imprimir">Folga</th>
                <th>Observação</th>
              </tr>
            </thead>
            <tbody>
              {ordenados.map((i) => (
                <tr key={i.motoristaId} className={i.folga ? 'folga' : undefined}>
                  <td>{i.nome}</td>
                  <td>{NOMES_FUNCAO[i.funcao]}</td>
                  <td>
                    <span className="nao-imprimir">
                      <input
                        type="time"
                        className="escala-hora"
                        aria-label={`Entrada de ${i.nome}`}
                        disabled={i.folga}
                        value={i.entrada ?? ''}
                        onChange={(e) => mudar(i.motoristaId, { entrada: e.target.value || null })}
                      />
                    </span>
                    <span className="so-imprimir mono">{i.folga ? 'Folga' : i.entrada ?? '—'}</span>
                  </td>
                  <td className="nao-imprimir">
                    <input type="checkbox" aria-label={`Folga de ${i.nome}`} checked={i.folga} onChange={(e) => mudar(i.motoristaId, { folga: e.target.checked })} />
                  </td>
                  <td>
                    <span className="nao-imprimir">
                      <input value={i.observacao ?? ''} placeholder="ex.: direto na obra" onChange={(e) => mudar(i.motoristaId, { observacao: e.target.value || null })} />
                    </span>
                    <span className="so-imprimir">{i.observacao ?? ''}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <div className="acoes nao-imprimir">
        <button className="btn btn-primario" type="button" disabled={ocupado || !alterado} onClick={salvar}>
          Salvar escala
        </button>
        {semDefinir > 0 && <span className="small muted">{semDefinir} sem horário: ficam fora da escala deste dia.</span>}
      </div>
    </>
  );
}
