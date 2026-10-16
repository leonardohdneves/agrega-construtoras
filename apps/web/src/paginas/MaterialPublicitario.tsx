// Material publicitário: modelos para captar e apresentar o Agrega Construtoras. Só o administrador do sistema vê esta tela.
// O QR code do banner leva ao cadastro de interessados com a origem "banner-piloto": o retorno fica em Comercial › Interessados.
import { useMemo } from 'react';
import { qrSvg } from '../qr';

const ORIGEM_BANNER = 'banner-piloto';

const MATERIAIS = [
  {
    arquivo: '/api/admin/material/proposta-comercial.html',
    titulo: 'Proposta comercial',
    descricao: 'Modelo para enviar à construtora interessada: capa, módulos, pacotes com preços, investimento, etapas da implantação e condições.',
    dica: 'Substitua os campos entre colchetes para cada cliente. Os valores precisam bater com o contrato padrão.',
  },
  {
    arquivo: '/api/admin/material/post-saiba-mais.html',
    titulo: 'Post Instagram / WhatsApp · Saiba mais',
    descricao: 'Post 1080 × 1350 com módulos, vantagens e botão Saiba mais. O botão leva ao cadastro de interessados com a origem "post-saiba-mais".',
    dica: 'Para o Instagram, capture a tela do card com 1080 px de largura. No WhatsApp, o botão é o link de cadastro.',
  },
  {
    arquivo: '/api/admin/material/banner-piloto.html',
    titulo: 'Banner de captação de pilotos',
    descricao: 'Banner 1200 × 628 para post e capa de divulgação, convidando construtoras para o programa piloto. Traz o QR code de cadastro.',
    dica: 'Para salvar a imagem, use a captura de tela do navegador.',
  },
];

function QrDoBanner() {
  const endereco = `${window.location.origin}/interesse?origem=${ORIGEM_BANNER}`;
  const qr = useMemo(() => qrSvg(endereco), [endereco]);
  const svgQr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${qr.tamanho} ${qr.tamanho}"><rect width="${qr.tamanho}" height="${qr.tamanho}" fill="#fff"/><path d="${qr.caminho}" fill="#000"/></svg>`;

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <h2 style={{ marginTop: 0 }}>QR code de cadastro (banner)</h2>
      <p>Quem lê o QR abre a página de cadastro de interessados e recebe um agradecimento logo após enviar os dados. Cada cadastro fica marcado como vindo do banner.</p>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <svg viewBox={`0 0 ${qr.tamanho} ${qr.tamanho}`} style={{ width: 180, height: 180 }} shapeRendering="crispEdges" role="img" aria-label={`QR code para ${endereco}`}>
          <rect width={qr.tamanho} height={qr.tamanho} fill="#fff" />
          <path d={qr.caminho} fill="#000" />
        </svg>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p className="ajuda" style={{ wordBreak: 'break-all' }}>{endereco}</p>
          <a className="btn btn-secundario" href={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgQr)}`} download="qr-banner-piloto.svg">
            Baixar QR (SVG)
          </a>
        </div>
      </div>
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

      <QrDoBanner />
    </>
  );
}
