// Página pública do aceite da proposta comercial: aberta pelo link da proposta. Não exige login.
import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { Logo } from '../componentes/Logo';

type Proposta = {
  status: 'pendente' | 'aceita' | 'expirada';
  cliente: string;
  diasTeste: number;
  expiraEm: string;
  aceitaEm: string | null;
  testeInicio: string | null;
  testeFim: string | null;
};

const dataCurta = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

export function Aceite() {
  const { codigo = '' } = useParams();
  const [proposta, setProposta] = useState<Proposta | null>(null);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [nome, setNome] = useState('');
  const [cargo, setCargo] = useState('');
  const [documento, setDocumento] = useState('');
  const [concordo, setConcordo] = useState(false);
  const [aceiteFeito, setAceiteFeito] = useState<{ testeInicio: string; testeFim: string } | null>(null);

  useEffect(() => {
    api<Proposta>(`/aceite/${encodeURIComponent(codigo)}`)
      .then(setProposta)
      .catch((e: Error) => setErro(e.message));
  }, [codigo]);

  async function aceitar(ev: FormEvent) {
    ev.preventDefault();
    setErro('');
    setEnviando(true);
    try {
      const r = await api<{ testeInicio: string; testeFim: string }>(`/aceite/${encodeURIComponent(codigo)}`, {
        corpo: { nome, cargo, documento, concordo },
      });
      setAceiteFeito(r);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  const cabecalho = (
    <div style={{ marginBottom: 20 }}>
      <Logo tamanho={26} />
    </div>
  );

  if (aceiteFeito) {
    return (
      <main className="card form" style={{ maxWidth: 560, margin: '40px auto' }}>
        {cabecalho}
        <h1>Teste iniciado</h1>
        <p>
          O período de testes do Agrega para {proposta?.cliente} vai de <b>{aceiteFeito.testeInicio}</b> a <b>{aceiteFeito.testeFim}</b>.
        </p>
        <p className="ajuda">Guarde este comprovante. O comercial entra em contato para o acesso e a implantação.</p>
      </main>
    );
  }

  if (!proposta && !erro) return <main className="card form" style={{ maxWidth: 560, margin: '40px auto' }}>{cabecalho}<p className="muted">Carregando…</p></main>;

  if (!proposta) {
    return (
      <main className="card form" style={{ maxWidth: 560, margin: '40px auto' }}>
        {cabecalho}
        <div className="alerta alerta-erro" role="alert">{erro}</div>
      </main>
    );
  }

  if (proposta.status === 'aceita') {
    return (
      <main className="card form" style={{ maxWidth: 560, margin: '40px auto' }}>
        {cabecalho}
        <h1>Proposta já aceita</h1>
        <p>
          Esta proposta foi aceita em {proposta.aceitaEm}. O teste vai de {proposta.testeInicio} a {proposta.testeFim}.
        </p>
      </main>
    );
  }

  if (proposta.status === 'expirada') {
    return (
      <main className="card form" style={{ maxWidth: 560, margin: '40px auto' }}>
        {cabecalho}
        <h1>Proposta expirada</h1>
        <p>O prazo de validade desta proposta terminou. Peça uma nova ao comercial da Agrega.</p>
      </main>
    );
  }

  return (
    <form className="card form" style={{ maxWidth: 560, margin: '40px auto' }} onSubmit={aceitar}>
      {cabecalho}
      <h1>Aceitar o teste gratuito</h1>
      <p>
        Proposta para <b>{proposta.cliente}</b>: <b>{proposta.diasTeste} dias</b> de teste do Agrega, sem cobrança. O período começa na data do aceite.
      </p>
      <p className="ajuda">Válida até {dataCurta(proposta.expiraEm)}. As condições completas estão na proposta que você recebeu.</p>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div className="campos">
        <div className="campo">
          <label htmlFor="ac-nome">Seu nome completo</label>
          <input id="ac-nome" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" required />
        </div>
        <div className="campo">
          <label htmlFor="ac-cargo">Seu cargo</label>
          <input id="ac-cargo" value={cargo} onChange={(e) => setCargo(e.target.value)} required />
        </div>
        <div className="campo">
          <label htmlFor="ac-doc">CPF ou CNPJ</label>
          <input id="ac-doc" inputMode="numeric" value={documento} onChange={(e) => setDocumento(e.target.value)} required />
        </div>
      </div>
      <label className="marcar" style={{ display: 'flex', gap: 8, margin: '14px 0' }}>
        <input type="checkbox" checked={concordo} onChange={(e) => setConcordo(e.target.checked)} />
        <span>Li a proposta e aceito o período de teste nas condições apresentadas.</span>
      </label>
      <button className="btn btn-primario" type="submit" disabled={enviando || !concordo}>
        {enviando ? 'Registrando…' : 'Aceitar e iniciar o teste'}
      </button>
    </form>
  );
}
