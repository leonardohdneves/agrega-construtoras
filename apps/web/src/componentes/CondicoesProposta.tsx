import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';

// Campos editáveis da proposta comercial. Os nomes são os da query string da API (lerCondicoes).
export type CampoCondicao =
  | 'precoObra'
  | 'precoObraGestao'
  | 'precoCompleto'
  | 'precoIncorporacao'
  | 'implantacaoMin'
  | 'implantacaoMax'
  | 'usuarioAdicional'
  | 'validade'
  | 'descontoAnual'
  | 'fidelidade'
  | 'avisoPrevio'
  | 'multaAnual'
  | 'diasTeste';

type Grupo = { titulo: string; campos: Array<[CampoCondicao, string]> };

const GRUPOS: Grupo[] = [
  {
    titulo: 'Mensalidades (R$/mês)',
    campos: [
      ['precoObra', 'Pacote Obra'],
      ['precoObraGestao', 'Pacote Obra + Gestão'],
      ['precoCompleto', 'Pacote Completo'],
      ['precoIncorporacao', 'Módulo Incorporação (adicional)'],
      ['usuarioAdicional', 'Usuário adicional (R$/mês)'],
    ],
  },
  {
    titulo: 'Implantação (cobrança única, R$)',
    campos: [
      ['implantacaoMin', 'Valor mínimo'],
      ['implantacaoMax', 'Valor máximo'],
    ],
  },
  {
    titulo: 'Prazos e contrato',
    campos: [
      ['diasTeste', 'Dias gratuitos para teste'],
      ['validade', 'Validade da proposta (dias)'],
      ['descontoAnual', 'Desconto no plano anual (%)'],
      ['fidelidade', 'Fidelidade do plano anual (meses)'],
      ['avisoPrevio', 'Aviso prévio no plano mensal (dias)'],
      ['multaAnual', 'Multa no cancelamento anual (%)'],
    ],
  },
];

type Valores = Record<CampoCondicao, string>;

/** Abre o formulário com os valores padrão do servidor. Ao gerar, devolve a query string com as condições. */
export function CondicoesProposta({
  titulo,
  aoGerar,
  aoFechar,
}: {
  titulo: string;
  aoGerar: (query: string) => void;
  aoFechar: () => void;
}) {
  const [valores, setValores] = useState<Valores | null>(null);
  const [padrao, setPadrao] = useState<Valores | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    api<{ padrao: Record<CampoCondicao, number> }>('/admin/proposta/condicoes')
      .then((r) => {
        const texto = Object.fromEntries(Object.entries(r.padrao).map(([k, v]) => [k, String(v)])) as Valores;
        setPadrao(texto);
        setValores(texto);
      })
      .catch((e: Error) => setErro(e.message));
  }, []);

  function alterar(campo: CampoCondicao, valor: string) {
    if (valores) setValores({ ...valores, [campo]: valor });
  }

  function gerar(ev: FormEvent) {
    ev.preventDefault();
    if (!valores) return;
    const query = new URLSearchParams();
    for (const grupo of GRUPOS) {
      for (const [campo] of grupo.campos) {
        const v = valores[campo].trim();
        if (v === '') {
          setErro(`Preencha o campo: ${grupo.campos.find(([c]) => c === campo)?.[1]}.`);
          return;
        }
        query.set(campo, v);
      }
    }
    setErro('');
    aoGerar(query.toString());
  }

  return (
    <form className="card form" onSubmit={gerar}>
      <h2>{titulo}</h2>
      <p className="ajuda">Os valores abaixo entram só nesta proposta. Os padrões do sistema não mudam.</p>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {!valores ? (
        <p className="muted">Carregando condições…</p>
      ) : (
        GRUPOS.map((grupo) => (
          <fieldset key={grupo.titulo} className="campo" style={{ border: 0, padding: 0, margin: '12px 0 0' }}>
            <legend className="rotulo">{grupo.titulo}</legend>
            <div className="campos">
              {grupo.campos.map(([campo, rotulo]) => (
                <div className="campo" key={campo}>
                  <label htmlFor={`cond-${campo}`}>{rotulo}</label>
                  <input id={`cond-${campo}`} inputMode="numeric" value={valores[campo]} onChange={(e) => alterar(campo, e.target.value)} />
                </div>
              ))}
            </div>
          </fieldset>
        ))
      )}
      <div className="acoes" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16 }}>
        <button className="btn btn-primario" type="submit" disabled={!valores}>
          Gerar proposta
        </button>
        <button className="btn btn-secundario" type="button" disabled={!padrao} onClick={() => padrao && setValores(padrao)}>
          Restaurar padrões
        </button>
        <button className="btn btn-secundario" type="button" onClick={aoFechar}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
