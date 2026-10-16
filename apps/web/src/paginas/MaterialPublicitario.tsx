// Material publicitário: modelos para captar e apresentar o Agrega Construtoras. Só o administrador do sistema vê esta tela.

const MATERIAIS = [
  {
    arquivo: '/material/proposta-comercial.html',
    titulo: 'Proposta comercial',
    descricao: 'Modelo para enviar à construtora interessada: capa, módulos, pacotes com preços, investimento, etapas da implantação e condições.',
    dica: 'Substitua os campos entre colchetes para cada cliente. Os valores precisam bater com o contrato padrão.',
  },
  {
    arquivo: '/material/banner-piloto.html',
    titulo: 'Banner de captação de pilotos',
    descricao: 'Banner 1200 × 628 para post e capa de divulgação, convidando construtoras para o programa piloto.',
    dica: 'Preencha os contatos antes de divulgar. Para salvar a imagem, use a captura de tela do navegador.',
  },
];

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
    </>
  );
}
