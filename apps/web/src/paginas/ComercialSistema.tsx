// Comercial do sistema (só o administrador): propostas e contratos com que o Agrega Construtoras é vendido às construtoras.
// Os modelos abertos aqui são os mesmos guardados no servidor; o contrato fica no documento de minuta.

const PROPOSTA = '/api/admin/material/proposta-comercial.html';
const CONTRATO = 'https://claude.ai/code/artifact/5fa30e6a-6659-4d71-9a80-2925508170a6';

const PACOTES = [
  { nome: 'Obra', mensal: 'R$ 379', obras: '3 obras ativas', usuarios: '3 usuários' },
  { nome: 'Obra + Gestão', mensal: 'R$ 578', obras: '3 obras ativas', usuarios: '5 usuários' },
  { nome: 'Completo', mensal: 'R$ 649', obras: '10 obras ativas', usuarios: '8 usuários (inclui Comercial)' },
  { nome: 'Incorporação (adicional)', mensal: 'R$ 450', obras: 'Acesso ao Viabiliza e até 3 empreendimentos', usuarios: 'Contratado à parte, sobre qualquer pacote' },
];

function Cabecalho({ titulo, descricao }: { titulo: string; descricao: string }) {
  return (
    <div className="cabecalho">
      <div className="titulo">
        <h1>{titulo}</h1>
        <span className="muted">{descricao}</span>
      </div>
    </div>
  );
}

export function PropostasSistema() {
  return (
    <>
      <Cabecalho titulo="Propostas do sistema" descricao="Proposta comercial e tabela de preços para as construtoras interessadas." />

      <div className="card" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0 }}>Proposta comercial</h2>
        <p>Modelo para enviar à construtora: capa, módulos, pacotes com preços, investimento, etapas da implantação e condições.</p>
        <p className="ajuda">Substitua os campos entre colchetes para cada cliente. Os valores precisam bater com o contrato padrão.</p>
        <div className="acoes">
          <a className="btn btn-primario" href={PROPOSTA} target="_blank" rel="noreferrer">Abrir proposta</a>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0 }}>Pacotes e preços</h2>
        <div style={{ overflowX: 'auto' }}>
          <table className="tabela">
            <thead>
              <tr>
                <th>Pacote</th>
                <th className="num">Mensalidade</th>
                <th>Obras</th>
                <th>Usuários</th>
              </tr>
            </thead>
            <tbody>
              {PACOTES.map((p) => (
                <tr key={p.nome}>
                  <td>{p.nome}</td>
                  <td className="num">{p.mensal.startsWith('R$') ? `${p.mensal}/mês` : p.mensal}</td>
                  <td>{p.obras}</td>
                  <td>{p.usuarios}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="small" style={{ marginBottom: 0 }}>
          <li>Usuário extra: R$ 30/mês.</li>
          <li>Implantação assistida: R$ 2.500 a R$ 6.000, pagamento único.</li>
          <li>Plano anual: 15% de desconto, com fidelidade de 12 meses.</li>
        </ul>
      </div>
    </>
  );
}

export function ContratosSistema() {
  return (
    <>
      <Cabecalho titulo="Contratos do sistema" descricao="Contrato padrão, anexo de proteção de dados e política de cancelamento." />

      <div className="card" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0 }}>Contrato padrão</h2>
        <p>Texto completo do contrato, com o anexo III (proteção de dados) e a cláusula de solução de conflitos por câmara de conciliação e arbitragem.</p>
        <div className="acoes">
          <a className="btn btn-primario" href={CONTRATO} target="_blank" rel="noreferrer">Abrir contrato</a>
        </div>
      </div>

      <div className="aviso" style={{ marginBottom: 12 }}>
        <b>Revisão jurídica obrigatória</b>
        A minuta precisa ser revisada por advogado antes de qualquer uso com clientes. O aviso deve ser gerado pelo sistema na emissão de cada contrato, nunca dentro do texto.
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <h2 style={{ marginTop: 0 }}>Política de cancelamento</h2>
        <ul style={{ marginBottom: 0 }}>
          <li><b>Mensal:</b> cancelamento sem multa, com aviso de 30 dias.</li>
          <li><b>Anual:</b> multa de 30% das mensalidades restantes.</li>
          <li><b>Reembolso:</b> não há reembolso de mensalidade nem de implantação, salvo falha comprovada nossa.</li>
          <li><b>Inadimplência:</b> aviso no 5º dia de atraso, suspensão no 10º e rescisão no 30º.</li>
        </ul>
      </div>
    </>
  );
}
