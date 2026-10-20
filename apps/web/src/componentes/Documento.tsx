import { useState, type ReactNode } from 'react';
import { useSessao } from '../sessao';
import { formatarCnpj, type Impressao } from '../api';
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

// ---------------------------------------------------------------- impressão: orientação e papel

const TAMANHO: Record<Impressao['papel'], string> = { A4: 'A4', Carta: 'letter', Oficio: '216mm 330mm' };
export const NOMES_PAPEL: Record<Impressao['papel'], string> = { A4: 'A4', Carta: 'Carta', Oficio: 'Ofício' };
let ultimaEscolha: Impressao | null = null;

/** Escolha de página da sessão; começa no padrão da empresa (Configurações › Empresa). */
export function usePaginaImpressao(): [Impressao, (p: Impressao) => void] {
  const { empresa } = useSessao();
  const [p, setP] = useState<Impressao>(ultimaEscolha ?? empresa?.impressao ?? { orientacao: 'paisagem', papel: 'A4' });
  return [p, (n) => { ultimaEscolha = n; setP(n); }];
}

/** Aplica a página escolhida (sobrepõe o @page padrão) e abre a janela de impressão. */
export function imprimirPagina(p: Impressao) {
  let el = document.getElementById('agrega-pagina') as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = 'agrega-pagina';
    document.head.appendChild(el);
  }
  el.textContent = `@page { size: ${TAMANHO[p.papel]} ${p.orientacao === 'retrato' ? 'portrait' : 'landscape'}; }`;
  document.documentElement.dataset.orientacao = p.orientacao;
  setTimeout(() => window.print(), 60);
}

export function OpcoesPagina({ valor, aoMudar }: { valor: Impressao; aoMudar: (p: Impressao) => void }) {
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
      <div className="segmentado" role="group" aria-label="Orientação" style={{ maxWidth: 260 }}>
        {(['retrato', 'paisagem'] as const).map((o) => (
          <button key={o} type="button" aria-pressed={valor.orientacao === o} className={valor.orientacao === o ? 'ativo' : ''} onClick={() => aoMudar({ ...valor, orientacao: o })}>
            {o === 'retrato' ? 'Retrato' : 'Paisagem'}
          </button>
        ))}
      </div>
      <label className="small" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        Papel
        <select value={valor.papel} onChange={(e) => aoMudar({ ...valor, papel: e.target.value as Impressao['papel'] })} style={{ height: 36 }}>
          {(Object.keys(NOMES_PAPEL) as Impressao['papel'][]).map((k) => (
            <option key={k} value={k}>{NOMES_PAPEL[k]}</option>
          ))}
        </select>
      </label>
    </div>
  );
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
  logoDireita,
}: {
  modulo: string;
  titulo: string;
  descricao?: string;
  periodo?: string;
  filtros?: string[];
  acoes?: ReactNode;
  aoImprimir?: () => void;
  /** Logo pequena (2 cm) à direita do título, mesmo na impressão em retrato. */
  logoDireita?: boolean;
}) {
  const { usuario, empresa } = useSessao();
  const [painel, setPainel] = useState(false);
  const [pagina, setPagina] = usePaginaImpressao();
  const agora = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  return (
    <header className={`doc-cabecalho${logoDireita ? ' doc-cabecalho-logo-direita' : ''}`}>
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
          {empresa?.temLogo && <img className="doc-logo" src={`/api/empresa/logo?v=${empresa.logoVersao ?? 0}`} alt={`Logo de ${empresa.nomeFantasia || empresa.razaoSocial}`} />}
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
        <button className="btn btn-secundario" type="button" onClick={aoImprimir ?? (() => setPainel(!painel))} aria-expanded={aoImprimir ? undefined : painel}>
          Imprimir
        </button>
      </div>
      {painel && !aoImprimir && (
        <div className="nao-imprimir painel-impressao card" style={{ margin: '0 18px 14px' }}>
          <OpcoesPagina valor={pagina} aoMudar={setPagina} />
          <div className="acoes" style={{ marginTop: 10 }}>
            <button className="btn btn-primario" type="button" onClick={() => { setPainel(false); imprimirPagina(pagina); }}>Imprimir</button>
            <button className="btn btn-link" type="button" onClick={() => setPainel(false)}>Fechar</button>
            <span className="small muted">Para salvar em PDF, escolha "Salvar como PDF" como impressora.</span>
          </div>
        </div>
      )}
    </header>
  );
}
