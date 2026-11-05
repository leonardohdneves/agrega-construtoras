import { useCallback, useEffect, useState } from 'react';
import { api, NOMES_PERFIL, type Perfil } from '../api';

type Situacao = 'em_teste' | 'teste_agendado' | 'teste_encerrado' | 'sem_teste';

type LinhaAcompanhamento = {
  id: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  pacote: string;
  usuariosAtivos: number;
  limiteUsuarios: number | null;
  perfisAtivos: string[];
  obrasAtivas: number;
  limiteObras: number | null;
  situacaoTeste: Situacao;
  testeInicio: string | null;
  testeFim: string | null;
  diasRestantes: number | null;
};

const ROTULO_SITUACAO: Record<Situacao, string> = {
  em_teste: 'Em teste',
  teste_agendado: 'Teste agendado',
  teste_encerrado: 'Teste encerrado',
  sem_teste: 'Sem teste',
};

const data = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : '—');
const limite = (n: number | null) => (n === null ? 'sem limite' : String(n));

function textoTeste(l: LinhaAcompanhamento): string {
  if (l.situacaoTeste === 'em_teste') return `Até ${data(l.testeFim)} · faltam ${l.diasRestantes} ${l.diasRestantes === 1 ? 'dia' : 'dias'}`;
  if (l.situacaoTeste === 'teste_agendado') return `Começa em ${data(l.testeInicio)}, até ${data(l.testeFim)}`;
  if (l.situacaoTeste === 'teste_encerrado') return `Encerrado em ${data(l.testeFim)}`;
  return 'Nenhum período de teste';
}

export function AdminAcompanhamento() {
  const [linhas, setLinhas] = useState<LinhaAcompanhamento[] | null>(null);
  const [hoje, setHoje] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      const r = await api<{ hoje: string; empresas: LinhaAcompanhamento[] }>('/admin/acompanhamento');
      setLinhas(r.empresas);
      setHoje(r.hoje);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  return (
    <div>
      <div className="cabecalho">
        <div>
          <h1>Acompanhamento das construtoras</h1>
          <p className="ajuda">Usuários e perfis ativos, obras ativas e o período de teste de cada construtora{hoje ? `, em ${data(hoje)}` : ''}.</p>
        </div>
        <button className="btn btn-secundario" type="button" onClick={() => window.open('/api/admin/material/manual-administrador.pdf', '_blank', 'noopener')}>
          Manual do administrador
        </button>
        <button className="btn btn-secundario" type="button" onClick={carregar} disabled={carregando}>
          {carregando ? 'Atualizando…' : 'Atualizar'}
        </button>
      </div>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {linhas && linhas.length === 0 && <p className="muted">Nenhuma construtora cadastrada.</p>}
      {linhas && linhas.length > 0 && (
        <div className="card tabela-caixa">
          <table className="tabela">
            <thead>
              <tr>
                <th>Construtora</th>
                <th>Pacote</th>
                <th>Usuários ativos</th>
                <th>Perfis em uso</th>
                <th>Obras ativas</th>
                <th>Período de teste</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const estourou = (limiteUsuarios: number | null, n: number) => limiteUsuarios !== null && n > limiteUsuarios;
                return (
                  <tr key={l.id}>
                    <td>
                      <b>{l.nomeFantasia || l.razaoSocial}</b>
                      {l.nomeFantasia && <div className="ajuda">{l.razaoSocial}</div>}
                    </td>
                    <td>{l.pacote}</td>
                    <td className="mono">
                      {l.usuariosAtivos} / {limite(l.limiteUsuarios)}
                      {estourou(l.limiteUsuarios, l.usuariosAtivos) && <div><span className="selo selo-perigo">acima do limite</span></div>}
                    </td>
                    <td>
                      {l.perfisAtivos.length ? l.perfisAtivos.map((p) => NOMES_PERFIL[p as Perfil] ?? p).join(', ') : '—'}
                    </td>
                    <td className="mono">
                      {l.obrasAtivas} / {limite(l.limiteObras)}
                    </td>
                    <td>
                      <span className={`selo ${l.situacaoTeste === 'em_teste' ? 'selo-ok' : 'selo-neutro'}`}>{ROTULO_SITUACAO[l.situacaoTeste]}</span>
                      <div className="ajuda">{textoTeste(l)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
