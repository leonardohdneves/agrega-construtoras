// Comercial do sistema · Interessados: o retorno dos cadastros feitos pelo QR code, por material de origem.
// Só o administrador do sistema vê esta tela.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';

type Interessado = {
  id: string; empresa: string; responsavel: string; email: string; telefone: string; cidade: string | null; uf: string | null;
  obrasAtivas: number | null; usuarios: number | null; pacote: string; mensagem: string | null; origem: string | null; criadoEm: string;
};

const NOMES_PACOTE: Record<string, string> = { obra: 'Obra', obra_gestao: 'Obra + Gestão', completo: 'Completo', ainda_nao_sei: 'Ainda não sei' };
const NOMES_ORIGEM: Record<string, string> = {
  'banner-piloto': 'Banner de captação de pilotos',
  'post-saiba-mais': 'Post Instagram / WhatsApp · Saiba mais',
};
const SEM_ORIGEM = '__sem__';

const nomeOrigem = (o: string | null) => (o ? NOMES_ORIGEM[o] ?? o : 'Cadastro direto (sem material)');
const data = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

function csv(linhas: Interessado[]) {
  const cab = ['Quando', 'Empresa', 'Responsável', 'E-mail', 'Telefone', 'Cidade', 'UF', 'Obras ativas', 'Usuários', 'Pacote', 'Material de origem', 'Mensagem'];
  const esc = (v: string | number | null) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const corpo = linhas.map((i) => [data(i.criadoEm), i.empresa, i.responsavel, i.email, i.telefone, i.cidade, i.uf, i.obrasAtivas, i.usuarios, NOMES_PACOTE[i.pacote] ?? i.pacote, nomeOrigem(i.origem), i.mensagem].map(esc).join(';'));
  return [cab.map(esc).join(';'), ...corpo].join('\n');
}

export function ComercialInteressados() {
  const [lista, setLista] = useState<Interessado[] | null>(null);
  const [erro, setErro] = useState('');
  const [filtro, setFiltro] = useState<string>('todos');

  useEffect(() => {
    api<{ interessados: Interessado[] }>('/interesse')
      .then((r) => setLista(r.interessados))
      .catch((e) => setErro((e as Error).message));
  }, []);

  // Contagem por material de origem, para ver de onde vêm os cadastros.
  const porOrigem = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const i of lista ?? []) mapa.set(i.origem ?? SEM_ORIGEM, (mapa.get(i.origem ?? SEM_ORIGEM) ?? 0) + 1);
    return [...mapa.entries()].sort((a, b) => b[1] - a[1]);
  }, [lista]);

  const visiveis = useMemo(() => {
    if (!lista) return [];
    if (filtro === 'todos') return lista;
    if (filtro === SEM_ORIGEM) return lista.filter((i) => !i.origem);
    return lista.filter((i) => i.origem === filtro);
  }, [lista, filtro]);

  function baixarCsv() {
    const conteudo = '﻿' + csv(visiveis);
    const url = `data:text/csv;charset=utf-8,${encodeURIComponent(conteudo)}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `interessados-${filtro === 'todos' ? 'todos' : filtro}.csv`;
    a.click();
  }

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Interessados</h1>
          <span className="muted">Cadastros feitos pelo QR code, por material de origem.</span>
        </div>
      </div>

      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {!lista && !erro && <p className="muted">Carregando…</p>}

      {lista && (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="acoes" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <b style={{ fontSize: 20 }}>{lista.length}</b> <span className="muted">cadastro(s) no total</span>
              </div>
              <button className="btn" type="button" onClick={baixarCsv} disabled={!visiveis.length}>Baixar CSV</button>
            </div>
            {porOrigem.length > 0 && (
              <div className="acoes" style={{ flexWrap: 'wrap', marginTop: 12 }}>
                {porOrigem.map(([origem, total]) => (
                  <span key={origem} className="selo">{origem === SEM_ORIGEM ? 'Cadastro direto' : nomeOrigem(origem)}: {total}</span>
                ))}
              </div>
            )}
          </div>

          <div className="campo" style={{ maxWidth: 360, marginBottom: 12 }}>
            <label htmlFor="int-filtro">Mostrar</label>
            <select id="int-filtro" value={filtro} onChange={(e) => setFiltro(e.target.value)}>
              <option value="todos">Todos os cadastros</option>
              {porOrigem.map(([origem]) => (
                <option key={origem} value={origem}>{origem === SEM_ORIGEM ? 'Cadastro direto (sem material)' : nomeOrigem(origem)}</option>
              ))}
            </select>
          </div>

          {!visiveis.length ? (
            <div className="card"><p className="muted" style={{ margin: 0 }}>Nenhum cadastro nesta seleção.</p></div>
          ) : (
            <div className="card" style={{ overflowX: 'auto' }}>
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th>Empresa</th>
                    <th>Responsável</th>
                    <th>Contato</th>
                    <th>Cidade</th>
                    <th>Obras / usuários</th>
                    <th>Pacote de interesse</th>
                    <th>Material de origem</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((i) => (
                    <tr key={i.id}>
                      <td className="small">{data(i.criadoEm)}</td>
                      <td>{i.empresa}</td>
                      <td>{i.responsavel}</td>
                      <td className="small">{i.email}<br />{i.telefone}</td>
                      <td className="small">{[i.cidade, i.uf].filter(Boolean).join('/') || '—'}</td>
                      <td className="small">{i.obrasAtivas ?? '—'} / {i.usuarios ?? '—'}</td>
                      <td>{NOMES_PACOTE[i.pacote] ?? i.pacote}</td>
                      <td className="small">{nomeOrigem(i.origem)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
