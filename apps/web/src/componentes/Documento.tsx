import type { ReactNode } from 'react';
import { useSessao } from '../sessao';
import { formatarCnpj } from '../api';
import { Simbolo } from './Logo';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** "2026-08" e "2026-10" → "agosto a outubro de 2026". */
export function textoPeriodo(de: string, ate: string): string {
  const [a1, m1] = de.split('-').map(Number);
  const [a2, m2] = ate.split('-').map(Number);
  if (a1 === a2 && m1 === m2) return `${MESES[m1 - 1]} de ${a1}`;
  if (a1 === a2) return `${MESES[m1 - 1]} a ${MESES[m2 - 1]} de ${a1}`;
  return `${MESES[m1 - 1]} de ${a1} a ${MESES[m2 - 1]} de ${a2}`;
}

/**
 * Cabeçalho padrão de todo relatório do Agrega, na tela e na impressão:
 * faixa da marca, título, empresa, período, filtros e quem emitiu.
 */
export function CabecalhoDocumento({
  modulo,
  titulo,
  descricao,
  periodo,
  filtros = [],
  acoes,
  aoImprimir,
}: {
  modulo: string;
  titulo: string;
  descricao?: string;
  periodo?: string;
  filtros?: string[];
  acoes?: ReactNode;
  aoImprimir?: () => void;
}) {
  const { usuario, empresa } = useSessao();
  const agora = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  return (
    <header className="doc-cabecalho">
      <div className="doc-faixa">
        <span className="doc-marca">
          <Simbolo tamanho={22} escuro />
          <span>agrega</span>
        </span>
        <span className="doc-modulo">{modulo}</span>
      </div>
      <div className="doc-corpo">
        <div className="doc-titulo">
          <h1>{titulo}</h1>
          {descricao && <p className="doc-descricao">{descricao}</p>}
          {(periodo || filtros.length > 0) && (
            <p className="doc-filtros">
              {periodo && (
                <span>
                  <b>Período:</b> {periodo}
                </span>
              )}
              {filtros.filter(Boolean).map((f) => (
                <span key={f}>{f}</span>
              ))}
            </p>
          )}
        </div>
        <div className="doc-meta">
          <strong>{empresa?.nomeFantasia || empresa?.razaoSocial || 'Agrega'}</strong>
          {empresa?.cnpj && <span>CNPJ {formatarCnpj(empresa.cnpj)}</span>}
          <span>
            Emitido em {agora}
            {usuario ? ` por ${usuario.nome}` : ''}
          </span>
        </div>
      </div>
      <div className="doc-acoes nao-imprimir">
        {acoes}
        <button className="btn btn-secundario" type="button" onClick={aoImprimir ?? (() => window.print())}>
          Imprimir
        </button>
      </div>
    </header>
  );
}
