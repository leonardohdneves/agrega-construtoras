import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { api, formatarDataHora } from '../api';
import { AssinaturaPad } from '../componentes/AssinaturaPad';

// Página pública: o dono da obra abre o link recebido da construtora, confere a visita e assina na tela.
type Dados = {
  empresa: string;
  obra: { codigo: string; nome: string; local: string };
  visita: { numero: number; data: string; responsavel: string | null; observacoes: string | null };
  responsavelAssinou: { nome: string; assinadoEm: string } | null;
  donoAssinou: { nome: string; assinadoEm: string } | null;
};

export function AssinarVisita() {
  const { token } = useParams();
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState('');
  const [nome, setNome] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api<Dados>(`/assinatura/${token}`).then(setDados).catch((e: Error) => setErro(e.message));
  }, [token]);

  async function enviar(imagem: string) {
    if (nome.trim().length < 3) {
      setErro('Informe seu nome completo antes de assinar.');
      return;
    }
    setErro('');
    setEnviando(true);
    try {
      await api(`/assinatura/${token}`, { metodo: 'POST', corpo: { nome: nome.trim(), imagem } });
      setEnviado(true);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  if (erro && !dados) return <main className="card" style={{ margin: 16 }}><div className="alerta alerta-erro" role="alert">{erro}</div></main>;
  if (!dados) return <p className="muted" style={{ margin: 16 }}>Carregando…</p>;

  const jaAssinada = dados.donoAssinou || enviado;

  return (
    <main style={{ maxWidth: 680, margin: '0 auto', padding: '16px' }}>
      <div className="card">
        <p className="ajuda" style={{ margin: 0 }}>{dados.empresa}</p>
        <h1 style={{ marginTop: 4 }}>Assinatura da visita nº {dados.visita.numero}</h1>
        <p className="muted">Obra {dados.obra.codigo} · {dados.obra.nome}{dados.obra.local ? ` · ${dados.obra.local}` : ''}</p>
        <p><b>Data:</b> {dados.visita.data.split('-').reverse().join('/')}</p>
        {dados.visita.responsavel && <p><b>Responsável pela visita:</b> {dados.visita.responsavel}</p>}
        <h2 style={{ fontSize: 16 }}>Observações e orientações</h2>
        <p style={{ whiteSpace: 'pre-wrap' }}>{dados.visita.observacoes || 'Sem observações registradas nesta visita.'}</p>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        {jaAssinada ? (
          <div className="alerta alerta-ok" role="status">
            Visita assinada{dados.donoAssinou ? ` por ${dados.donoAssinou.nome} em ${formatarDataHora(dados.donoAssinou.assinadoEm)}` : ''}. Obrigado.
          </div>
        ) : (
          <form className="form" onSubmit={(e: FormEvent) => e.preventDefault()}>
            <div className="campo">
              <label htmlFor="assinante-nome">Seu nome completo</label>
              <input id="assinante-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={120} placeholder="Nome de quem assina" />
            </div>
            <p className="ajuda">Assine na área abaixo, com o dedo ou a caneta.</p>
            {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
            <AssinaturaPad rotulo={enviando ? 'Enviando…' : 'Confirmar assinatura'} aoConfirmar={enviar} />
          </form>
        )}
      </div>
    </main>
  );
}
