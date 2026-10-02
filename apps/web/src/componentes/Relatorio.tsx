import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, formatarData, formatarMoeda, formatarNumero } from '../api';
import { ATALHOS, type Periodo } from './Periodo';
import { CabecalhoDocumento, textoPeriodo } from './Documento';

export type Formato = 'moeda' | 'numero' | 'decimal' | 'pct' | 'texto' | 'data' | 'litros' | 'km' | 'horas' | 'dias';

export type Coluna<T> = {
  titulo: string;
  valor: (l: T) => string | number | null | undefined;
  formato?: Formato;
  total?: boolean | ((linhas: T[]) => number | null);
  destaque?: (l: T) => 'perigo' | 'aviso' | 'ok' | undefined;
  render?: (l: T) => ReactNode;
};

export function formatar(v: string | number | null | undefined, f: Formato = 'texto'): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string' && f !== 'data') return v;
  const n = Number(v);
  switch (f) {
    case 'moeda':
      return formatarMoeda(n);
    case 'numero':
      return formatarNumero(n);
    case 'decimal':
      return formatarNumero(n, 2);
    case 'pct':
      return `${(n * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
    case 'litros':
      return `${formatarNumero(n)} L`;
    case 'km':
      return `${formatarNumero(n)} km`;
    case 'horas':
      return `${formatarNumero(n, 1)} h`;
    case 'dias':
      return `${formatarNumero(n, 1)} d`;
    case 'data':
      return formatarData(String(v));
    default:
      return String(v);
  }
}

const NUMERICOS: Formato[] = ['moeda', 'numero', 'decimal', 'pct', 'litros', 'km', 'horas', 'dias'];

function paraCsv<T>(colunas: Coluna<T>[], linhas: T[]): string {
  const esc = (s: string) => (/[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const cel = (c: Coluna<T>, l: T) => {
    const v = c.valor(l);
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return c.formato === 'pct' ? (v * 100).toFixed(2).replace('.', ',') : String(Math.round(v * 100) / 100).replace('.', ',');
    return c.formato === 'data' ? formatarData(String(v)) : String(v);
  };
  return [colunas.map((c) => esc(c.titulo)).join(';'), ...linhas.map((l) => colunas.map((c) => esc(cel(c, l))).join(';'))].join('\n');
}

export function baixarCsv(nome: string, conteudo: string) {
  const blob = new Blob(['﻿' + conteudo], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${nome}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Tabela de relatório com linha de total e exportação para planilha (CSV). */
export function TabelaRelatorio<T>({
  titulo,
  descricao,
  colunas,
  linhas,
  arquivo,
  vazio = 'Nada no período.',
  limite,
}: {
  titulo: string;
  descricao?: ReactNode;
  colunas: Coluna<T>[];
  linhas: T[];
  arquivo: string;
  vazio?: string;
  limite?: number;
}) {
  const [todas, setTodas] = useState(false);
  const visiveis = limite && !todas ? linhas.slice(0, limite) : linhas;
  const temTotal = colunas.some((c) => c.total);
  return (
    <section className="card relatorio">
      <div className="cartao-topo">
        <h2>{titulo}</h2>
        {linhas.length > 0 && (
          <button className="btn btn-link nao-imprimir" type="button" onClick={() => baixarCsv(arquivo, paraCsv(colunas, linhas))}>
            Baixar planilha
          </button>
        )}
      </div>
      {descricao && <p className="small muted" style={{ marginTop: 0 }}>{descricao}</p>}
      {linhas.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>{vazio}</p>
      ) : (
        <div className="tabela-caixa">
          <table className="tabela tabela-compacta">
            <thead>
              <tr>
                {colunas.map((c) => (
                  <th key={c.titulo} style={NUMERICOS.includes(c.formato ?? 'texto') ? { textAlign: 'right' } : undefined}>
                    {c.titulo}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visiveis.map((l, i) => (
                <tr key={i}>
                  {colunas.map((c) => {
                    const num = NUMERICOS.includes(c.formato ?? 'texto');
                    const d = c.destaque?.(l);
                    return (
                      <td key={c.titulo} className={`${num ? 'mono num' : ''} ${d ? `tom-${d}` : ''}`}>
                        {c.render ? c.render(l) : formatar(c.valor(l), c.formato)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            {temTotal && (
              <tfoot>
                <tr>
                  {colunas.map((c, i) => {
                    let t: number | null = null;
                    if (typeof c.total === 'function') t = c.total(linhas);
                    else if (c.total) t = linhas.reduce((s, l) => s + (Number(c.valor(l)) || 0), 0);
                    return (
                      <td key={c.titulo} className={NUMERICOS.includes(c.formato ?? 'texto') ? 'mono num forte' : 'forte'}>
                        {i === 0 && !c.total ? 'Total' : c.total ? formatar(t, c.formato) : ''}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {limite && linhas.length > limite && (
        <button className="btn btn-link nao-imprimir" type="button" onClick={() => setTodas(!todas)}>
          {todas ? 'Mostrar menos' : `Mostrar todas as ${linhas.length} linhas`}
        </button>
      )}
    </section>
  );
}

/** Cabeçalho comum das páginas de relatório: título, abas de relatório e imprimir. */
export function CabecalhoRelatorio({
  modulo,
  titulo,
  sub,
  abas,
  aba,
  aoMudar,
  extra,
  periodo,
}: {
  modulo: string;
  titulo: string;
  sub: string;
  abas: { id: string; texto: string }[];
  aba: string;
  aoMudar: (id: string) => void;
  extra?: ReactNode;
  periodo?: Periodo | null;
}) {
  const atual = abas.find((a) => a.id === aba);
  return (
    <>
      <CabecalhoDocumento
        modulo={modulo}
        titulo={`${titulo}${atual ? ` · ${atual.texto}` : ''}`}
        descricao={sub}
        periodo={periodo ? textoPeriodo(periodo.de, periodo.ate) : undefined}
      />
      {extra && <div className="nao-imprimir">{extra}</div>}
      <div className="abas nao-imprimir" role="tablist">
        {abas.map((a) => (
          <button key={a.id} type="button" role="tab" aria-selected={aba === a.id} className={aba === a.id ? 'ativa' : ''} onClick={() => aoMudar(a.id)}>
            {a.texto}
          </button>
        ))}
      </div>
    </>
  );
}

/** Período e aba do relatório guardados no endereço, e carregamento dos dados. */
export function useRelatorio<T>(caminho: string, abaPadrao: string, atalhoPadrao: string) {
  const [params, setParams] = useSearchParams();
  const padrao = ATALHOS.find((a) => a.id === atalhoPadrao)!.periodo();
  const periodo: Periodo = { de: params.get('de') ?? padrao.de, ate: params.get('ate') ?? padrao.ate };
  const aba = params.get('aba') ?? abaPadrao;
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    let vivo = true;
    setDados(null);
    setErro('');
    api<T>(`${caminho}?de=${periodo.de}&ate=${periodo.ate}`)
      .then((d) => vivo && setDados(d))
      .catch((e) => vivo && setErro((e as Error).message));
    return () => {
      vivo = false;
    };
  }, [caminho, periodo.de, periodo.ate]);
  const mudar = (p: Partial<Periodo & { aba: string }>) => setParams({ de: periodo.de, ate: periodo.ate, aba, ...p }, { replace: true });
  return { periodo, aba, dados, erro, mudar };
}
