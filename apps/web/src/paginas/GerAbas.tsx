import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Dre } from './Dre';
import { Fluxo } from './Fluxo';
import { GerAcompanhamento } from './GerAcompanhamento';
import { GerGanttControle } from './GerGanttControle';
import { GerProducaoEquipe } from './GerProducaoEquipe';
import { Indicadores } from './Indicadores';

type Aba = { id: string; rotulo: string; conteudo: ReactNode };

/** Submenu do Gerencial: cada tela vira uma aba; a aba fica no endereço (?aba=...). */
function Abas({ abas }: { abas: Aba[] }) {
  const [params, setParams] = useSearchParams();
  const atual = abas.find((a) => a.id === params.get('aba')) ?? abas[0];
  return (
    <>
      <div className="segmentado" role="tablist" style={{ margin: '0 0 16px' }}>
        {abas.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={a.id === atual.id}
            className={a.id === atual.id ? 'ativo' : ''}
            onClick={() =>
              setParams((p) => {
                p.set('aba', a.id);
                return p;
              }, { replace: true })
            }
          >
            {a.rotulo}
          </button>
        ))}
      </div>
      {atual.conteudo}
    </>
  );
}

export function GerFinanceiro() {
  return (
    <Abas
      abas={[
        { id: 'dre', rotulo: 'DRE gerencial', conteudo: <Dre /> },
        { id: 'fluxo', rotulo: 'Fluxo de caixa', conteudo: <Fluxo /> },
      ]}
    />
  );
}

export function GerObras() {
  return (
    <Abas
      abas={[
        { id: 'acompanhamento', rotulo: 'Acompanhamento de obra', conteudo: <GerAcompanhamento /> },
        { id: 'gantt', rotulo: 'Gantt de controle', conteudo: <GerGanttControle /> },
        { id: 'producao', rotulo: 'Produção por equipe', conteudo: <GerProducaoEquipe /> },
      ]}
    />
  );
}

export function GerAdministrativo() {
  return <Abas abas={[{ id: 'indicadores', rotulo: 'Indicadores', conteudo: <Indicadores /> }]} />;
}
