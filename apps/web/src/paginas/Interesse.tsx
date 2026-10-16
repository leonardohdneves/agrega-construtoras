// Página pública de interesse no programa piloto: aberta pelo QR code e pelo link da divulgação. Não exige login.
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { Logo } from '../componentes/Logo';

const PACOTES = [
  { v: 'obra', nome: 'Obra' },
  { v: 'obra_gestao', nome: 'Obra + Gestão' },
  { v: 'completo', nome: 'Completo' },
  { v: 'ainda_nao_sei', nome: 'Ainda não sei' },
];

type Dados = { empresa: string; responsavel: string; email: string; telefone: string; cidade: string; uf: string; obrasAtivas: string; usuarios: string; pacote: string; mensagem: string; site: string };
const VAZIO: Dados = { empresa: '', responsavel: '', email: '', telefone: '', cidade: '', uf: '', obrasAtivas: '', usuarios: '', pacote: 'obra', mensagem: '', site: '' };

const numero = (v: string) => (v.trim() === '' ? null : Number(v));

export function Interesse() {
  const [dados, setDados] = useState<Dados>(VAZIO);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [agradecimento, setAgradecimento] = useState<Dados | null>(null);
  // Material de onde veio o cadastro (QR code com ?origem=). Só aceita um código simples.
  const origem = (() => {
    try {
      const v = new URLSearchParams(window.location.search).get('origem') ?? '';
      return /^[a-z0-9-]{1,60}$/.test(v) ? v : null;
    } catch {
      return null;
    }
  })();

  const campo = (k: keyof Dados) => (e: { target: { value: string } }) => setDados({ ...dados, [k]: e.target.value });

  async function enviar(ev: FormEvent) {
    ev.preventDefault();
    setErro('');
    setEnviando(true);
    try {
      await api('/interesse', {
        corpo: {
          empresa: dados.empresa,
          responsavel: dados.responsavel,
          email: dados.email,
          telefone: dados.telefone,
          cidade: dados.cidade || null,
          uf: dados.uf || null,
          obrasAtivas: numero(dados.obrasAtivas),
          usuarios: numero(dados.usuarios),
          pacote: dados.pacote,
          mensagem: dados.mensagem || null,
          origem,
          site: dados.site,
        },
      });
      setAgradecimento(dados);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  if (agradecimento) {
    return (
      <main className="interesse">
        <div className="card form" role="status">
          <Logo tamanho={28} />
          <h1 style={{ marginTop: 16 }}>Obrigado pelo interesse, {agradecimento.responsavel.split(' ')[0]}!</h1>
          <p>
            Recebemos o cadastro da <b>{agradecimento.empresa}</b>. Nossa equipe vai analisar as informações e falar com você pelo{' '}
            <b>{agradecimento.telefone}</b> em até 2 dias úteis para conversar sobre o programa piloto.
          </p>
          <p>
            Enquanto isso, você pode conhecer o sistema no <a href="/manual/agrega-construtoras-manual-de-operacao.pdf" target="_blank" rel="noreferrer">manual de operação</a>.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="interesse">
      <form className="card form" onSubmit={enviar}>
        <Logo tamanho={28} />
        <h1 style={{ marginTop: 16 }}>Quero testar o Agrega Construtoras</h1>
        <p className="muted">Programa piloto com implantação assistida. Preencha os dados abaixo e entramos em contato.</p>
        <div className="campos">
          <div className="campo">
            <label htmlFor="in-empresa">Empresa</label>
            <input id="in-empresa" required value={dados.empresa} onChange={campo('empresa')} />
          </div>
          <div className="campo">
            <label htmlFor="in-responsavel">Seu nome</label>
            <input id="in-responsavel" required value={dados.responsavel} onChange={campo('responsavel')} />
          </div>
          <div className="campo">
            <label htmlFor="in-email">E-mail</label>
            <input id="in-email" type="email" required value={dados.email} onChange={campo('email')} />
          </div>
          <div className="campo">
            <label htmlFor="in-telefone">WhatsApp</label>
            <input id="in-telefone" type="tel" required value={dados.telefone} onChange={campo('telefone')} />
          </div>
          <div className="campo">
            <label htmlFor="in-cidade">Cidade</label>
            <input id="in-cidade" value={dados.cidade} onChange={campo('cidade')} />
          </div>
          <div className="campo">
            <label htmlFor="in-uf">UF</label>
            <input id="in-uf" maxLength={2} value={dados.uf} onChange={(e) => setDados({ ...dados, uf: e.target.value.toUpperCase() })} />
          </div>
          <div className="campo">
            <label htmlFor="in-obras">Obras ativas hoje</label>
            <input id="in-obras" type="number" min={0} inputMode="numeric" value={dados.obrasAtivas} onChange={campo('obrasAtivas')} />
          </div>
          <div className="campo">
            <label htmlFor="in-usuarios">Pessoas que usariam o sistema</label>
            <input id="in-usuarios" type="number" min={0} inputMode="numeric" value={dados.usuarios} onChange={campo('usuarios')} />
          </div>
          <div className="campo">
            <label htmlFor="in-pacote">Pacote de interesse</label>
            <select id="in-pacote" value={dados.pacote} onChange={campo('pacote')}>
              {PACOTES.map((p) => (
                <option key={p.v} value={p.v}>
                  {p.nome}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="campo">
          <label htmlFor="in-mensagem">Conte um pouco da sua operação (opcional)</label>
          <textarea id="in-mensagem" rows={3} value={dados.mensagem} onChange={campo('mensagem')} />
        </div>
        {/* Campo escondido: robôs costumam preenchê-lo. */}
        <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
          <label htmlFor="in-site">Site</label>
          <input id="in-site" tabIndex={-1} autoComplete="off" value={dados.site} onChange={campo('site')} />
        </div>
        {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
        <div className="acoes">
          <button className="btn btn-primario" type="submit" disabled={enviando}>
            {enviando ? 'Enviando…' : 'Quero participar'}
          </button>
        </div>
      </form>
    </main>
  );
}
