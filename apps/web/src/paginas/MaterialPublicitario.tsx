// Material publicitário: modelos para captar e apresentar o Agrega Construtoras. Só o administrador do sistema vê esta tela.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { qrSvg } from '../qr';

const MATERIAIS = [
  {
    arquivo: '/api/admin/material/proposta-comercial.html',
    titulo: 'Proposta comercial',
    descricao: 'Modelo para enviar à construtora interessada: capa, módulos, pacotes com preços, investimento, etapas da implantação e condições.',
    dica: 'Substitua os campos entre colchetes para cada cliente. Os valores precisam bater com o contrato padrão.',
  },
  {
    arquivo: '/api/admin/material/banner-piloto.html',
    titulo: 'Banner de captação de pilotos',
    descricao: 'Banner 1200 × 628 para post e capa de divulgação, convidando construtoras para o programa piloto.',
    dica: 'Preencha os contatos antes de divulgar. Para salvar a imagem, use a captura de tela do navegador.',
  },
];

type Interessado = { id: string; empresa: string; responsavel: string; email: string; telefone: string; cidade: string | null; uf: string | null; obrasAtivas: number | null; usuarios: number | null; pacote: string; mensagem: string | null; criadoEm: string };

const NOMES_PACOTE: Record<string, string> = { obra: 'Obra', obra_gestao: 'Obra + Gestão', completo: 'Completo', ainda_nao_sei: 'Ainda não sei' };
const data = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

function CadastroInteresse() {
  const endereco = `${window.location.origin}/interesse`;
  const qr = useMemo(() => qrSvg(endereco), [endereco]);
  const [lista, setLista] = useState<Interessado[] | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    api<{ interessados: Interessado[] }>('/interesse')
      .then((r) => setLista(r.interessados))
      .catch((e) => setErro((e as Error).message));
  }, []);

  const svgQr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${qr.tamanho} ${qr.tamanho}"><rect width="${qr.tamanho}" height="${qr.tamanho}" fill="#fff"/><path d="${qr.caminho}" fill="#000"/></svg>`;

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <h2 style={{ marginTop: 0 }}>Cadastro de interessados</h2>
      <p>Quem lê o QR code abre a página de cadastro e recebe um agradecimento logo após enviar os dados.</p>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <svg viewBox={`0 0 ${qr.tamanho} ${qr.tamanho}`} style={{ width: 180, height: 180 }} shapeRendering="crispEdges" role="img" aria-label={`QR code para ${endereco}`}>
          <rect width={qr.tamanho} height={qr.tamanho} fill="#fff" />
          <path d={qr.caminho} fill="#000" />
        </svg>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p className="ajuda" style={{ wordBreak: 'break-all' }}>{endereco}</p>
          <a className="btn btn-secundario" href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgQr)}`} download="qr-cadastro-interesse.svg">
            Baixar QR (SVG)
          </a>
        </div>
      </div>

      <h3 style={{ marginTop: 20 }}>Interessados ({lista?.length ?? 0})</h3>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {!lista ? (
        <p className="muted">Carregando…</p>
      ) : lista.length === 0 ? (
        <p className="muted">Nenhum cadastro ainda.</p>
      ) : (
        <div className="tabela-caixa" style={{ overflowX: 'auto' }}>
          <table className="tabela">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Empresa</th>
                <th>Responsável</th>
                <th>Contato</th>
                <th>Cidade</th>
                <th>Obras</th>
                <th>Usuários</th>
                <th>Pacote</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((i) => (
                <tr key={i.id}>
                  <td>{data(i.criadoEm)}</td>
                  <td>{i.empresa}</td>
                  <td>{i.responsavel}</td>
                  <td>
                    {i.email}
                    <br />
                    <span className="muted">{i.telefone}</span>
                  </td>
                  <td>{[i.cidade, i.uf].filter(Boolean).join(' / ') || '—'}</td>
                  <td className="mono">{i.obrasAtivas ?? '—'}</td>
                  <td className="mono">{i.usuarios ?? '—'}</td>
                  <td>{NOMES_PACOTE[i.pacote] ?? i.pacote}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function MaterialPublicitario() {
  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Material publicitário</h1>
          <span className="muted">Modelos para captar e apresentar o Agrega Construtoras.</span>
        </div>
      </div>

      <CadastroInteresse />

      {MATERIAIS.map((m) => (
        <div className="card" key={m.arquivo} style={{ marginBottom: 12 }}>
          <h2 style={{ marginTop: 0 }}>{m.titulo}</h2>
          <p>{m.descricao}</p>
          <p className="ajuda">{m.dica}</p>
          <div className="acoes">
            <a className="btn btn-primario" href={m.arquivo} target="_blank" rel="noreferrer">
              Abrir modelo
            </a>
          </div>
        </div>
      ))}
    </>
  );
}
