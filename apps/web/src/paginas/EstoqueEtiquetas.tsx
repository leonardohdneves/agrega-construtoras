// Etiquetas QR do estoque da construtora: folha A4 com 24 etiquetas (3 × 8, 70 × 37 mm), uma por entrada de insumo.
// O QR é o identificador da entrada; ele não muda enquanto a entrada existir, então a etiqueta impressa segue válida.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, formatarData } from '../api';
import { qrSvg } from '../qr';

type Etiqueta = {
  id: string;
  chave: string;
  data: string;
  quantidade: number;
  saldo: number;
  insumo: { codigo: string; descricao: string; unidade: string };
  obraCodigo: string;
  eapCodigo: string;
  eapDescricao: string;
  estoque: { codigo: string | null; nome: string | null };
};

const POR_FOLHA = 24;
const num = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

function QrEtiqueta({ texto }: { texto: string }) {
  const q = useMemo(() => qrSvg(texto), [texto]);
  return (
    <svg className="qr" viewBox={`0 0 ${q.tamanho} ${q.tamanho}`} style={{ width: '22mm', height: '22mm' }} shapeRendering="crispEdges" role="img" aria-label={`QR: ${texto}`}>
      <rect width={q.tamanho} height={q.tamanho} fill="#fff" />
      <path d={q.caminho} fill="#000" />
    </svg>
  );
}

export function EstoqueEtiquetasImprimir() {
  const [busca] = useSearchParams();
  const obraId = busca.get('obraId') ?? '';
  const soSaldo = busca.get('saldo') !== '0';
  const [etiquetas, setEtiquetas] = useState<Etiqueta[] | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!obraId) {
      setErro('Escolha a obra no estoque antes de imprimir as etiquetas.');
      return;
    }
    api<{ etiquetas: Etiqueta[] }>(`/sup/etiquetas?obraId=${obraId}&saldo=${soSaldo ? '1' : '0'}`)
      .then((r) => setEtiquetas(r.etiquetas))
      .catch((e) => setErro((e as Error).message));
  }, [obraId, soSaldo]);

  const folhas: Etiqueta[][] = [];
  for (let i = 0; etiquetas && i < etiquetas.length; i += POR_FOLHA) folhas.push(etiquetas.slice(i, i + POR_FOLHA));

  return (
    <>
      <div className="cabecalho nao-imprimir">
        <div className="titulo">
          <h1>Etiquetas do estoque</h1>
          <span className="muted">
            {etiquetas ? `${etiquetas.length} etiqueta(s) · folha A4 com 24 etiquetas (3 × 8, 70 × 37 mm).` : 'Carregando…'}
          </span>
        </div>
        <div className="acoes">
          <button className="btn btn-primario" type="button" disabled={!etiquetas?.length} onClick={() => window.print()}>Imprimir</button>
          <Link className="btn btn-secundario" to="/sup/estoque">Voltar ao estoque</Link>
        </div>
      </div>
      {erro && <div className="alerta alerta-erro nao-imprimir" role="alert">{erro}</div>}
      {etiquetas && !etiquetas.length && !erro && <p className="muted nao-imprimir">Nenhuma etiqueta{soSaldo ? ' com saldo' : ''} nesta obra.</p>}
      <div className="folhas-impressao">
        {folhas.map((folha, f) => (
          <div className="folha folha-etiquetas-estoque" key={f}>
            <div className="folha-etiquetas">
              {folha.map((e) => (
                <div className="etiqueta-cp" key={e.id}>
                  <QrEtiqueta texto={e.chave} />
                  <div className="et-txt">
                    <span className="et-cod">{e.insumo.codigo}</span>
                    <span className="et-cli">{e.insumo.descricao}</span>
                    <span className="et-cli">Etapa {e.eapCodigo}</span>
                    <span>Obra {e.obraCodigo}{e.estoque.codigo ? ` · ${e.estoque.codigo}` : ''}</span>
                    <span>Entrada {formatarData(e.data)} · {num(e.quantidade)} {e.insumo.unidade}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
