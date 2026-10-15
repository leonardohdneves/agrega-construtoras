import { useEffect, useState, type FormEvent } from 'react';
import { api, formatarCnpj, formatarDataHora, type Empresa as TEmpresa, type Impressao } from '../api';
import { NOMES_PAPEL } from '../componentes/Documento';
import { useSessao } from '../sessao';
import { EmpresasGrupo } from './EmpresasGrupo';

const CAMPOS_ALIQUOTA: Record<TEmpresa['regimeTributario'], { chave: string; rotulo: string }[]> = {
  simples: [{ chave: 'simples', rotulo: 'Alíquota efetiva do Simples (%)' }],
  presumido: [
    { chave: 'pis', rotulo: 'PIS (%)' },
    { chave: 'cofins', rotulo: 'COFINS (%)' },
    { chave: 'iss', rotulo: 'ISS (%)' },
    { chave: 'icms', rotulo: 'ICMS (%)' },
    { chave: 'irpj', rotulo: 'IRPJ efetivo sobre a receita (%)' },
    { chave: 'csll', rotulo: 'CSLL efetiva sobre a receita (%)' },
  ],
  real: [
    { chave: 'pis', rotulo: 'PIS (%)' },
    { chave: 'cofins', rotulo: 'COFINS (%)' },
    { chave: 'iss', rotulo: 'ISS (%)' },
    { chave: 'icms', rotulo: 'ICMS (%)' },
    { chave: 'irpj', rotulo: 'IRPJ sobre o lucro (%)' },
    { chave: 'csll', rotulo: 'CSLL sobre o lucro (%)' },
  ],
};

type Formulario = {
  razaoSocial: string;
  nomeFantasia: string;
  cnpj: string;
  regimeTributario: TEmpresa['regimeTributario'];
  simplesAnexo: string;
  simplesFaixa: string;
  aliquotas: Record<string, string>;
  telefone: string;
  email: string;
  cidade: string;
  uf: string;
};

function paraFormulario(e: TEmpresa): Formulario {
  return {
    razaoSocial: e.razaoSocial,
    nomeFantasia: e.nomeFantasia ?? '',
    cnpj: formatarCnpj(e.cnpj),
    regimeTributario: e.regimeTributario,
    simplesAnexo: e.simplesAnexo ?? '',
    simplesFaixa: e.simplesFaixa ? String(e.simplesFaixa) : '',
    aliquotas: Object.fromEntries(Object.entries(e.aliquotasDre ?? {}).map(([k, v]) => [k, String(v).replace('.', ',')])),
    telefone: e.telefone ?? '',
    email: e.email ?? '',
    cidade: e.cidade ?? '',
    uf: e.uf ?? '',
  };
}

export function Empresa() {
  const { usuario, recarregar } = useSessao();
  const podeEditar = usuario?.perfil === 'dono';
  const [f, setF] = useState<Formulario | null>(null);
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [empresa, setEmpresa] = useState<TEmpresa | null>(null);

  useEffect(() => {
    api<{ empresa: TEmpresa }>('/empresa')
      .then((r) => { setF(paraFormulario(r.empresa)); setEmpresa(r.empresa); })
      .catch((e) => setErro(e.message));
  }, []);

  function mudar<K extends keyof Formulario>(campo: K, valor: Formulario[K]) {
    setF((atual) => (atual ? { ...atual, [campo]: valor } : atual));
    setOk('');
  }

  async function salvar(ev: FormEvent) {
    ev.preventDefault();
    if (!f) return;
    setErro('');
    setOk('');
    setSalvando(true);
    try {
      const chaves = CAMPOS_ALIQUOTA[f.regimeTributario].map((c) => c.chave);
      const aliquotasDre: Record<string, number> = {};
      for (const k of chaves) {
        const v = (f.aliquotas[k] ?? '').trim();
        if (v) aliquotasDre[k] = Number(v.replace(',', '.'));
      }
      const r = await api<{ empresa: TEmpresa }>('/empresa', {
        metodo: 'PUT',
        corpo: { ...f, aliquotas: undefined, aliquotasDre, simplesAnexo: f.simplesAnexo || null, simplesFaixa: f.simplesFaixa ? Number(f.simplesFaixa) : null },
      });
      setF(paraFormulario(r.empresa));
      setOk('Dados da empresa salvos.');
      await recarregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  if (!f) return erro ? <div className="alerta alerta-erro">{erro}</div> : <p className="muted">Carregando…</p>;

  return (
    <>
      <div className="cabecalho">
        <div className="titulo">
          <h1>Empresa</h1>
          <span className="muted">{podeEditar ? 'Dados cadastrais e fiscais usados nos relatórios.' : 'Somente o dono pode alterar estes dados.'}</span>
        </div>
      </div>
      <form className="form" onSubmit={salvar}>
        {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
        {ok && <div className="alerta alerta-ok" role="status">{ok}</div>}
        <fieldset disabled={!podeEditar} style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card form">
            <h2>Identificação</h2>
            <div className="campos">
              <div className="campo">
                <label htmlFor="emp-razao">Razão social</label>
                <input id="emp-razao" value={f.razaoSocial} onChange={(e) => mudar('razaoSocial', e.target.value)} />
              </div>
              <div className="campo">
                <label htmlFor="emp-fantasia">Nome fantasia</label>
                <input id="emp-fantasia" value={f.nomeFantasia} onChange={(e) => mudar('nomeFantasia', e.target.value)} />
              </div>
              <div className="campo">
                <label htmlFor="emp-cnpj">CNPJ</label>
                <input id="emp-cnpj" className="mono" inputMode="numeric" value={f.cnpj} onChange={(e) => mudar('cnpj', e.target.value)} />
              </div>
              <div className="campo">
                <label htmlFor="emp-tel">Telefone</label>
                <input id="emp-tel" inputMode="tel" value={f.telefone} onChange={(e) => mudar('telefone', e.target.value)} />
              </div>
              <div className="campo">
                <label htmlFor="emp-email">E-mail</label>
                <input id="emp-email" type="email" value={f.email} onChange={(e) => mudar('email', e.target.value)} />
              </div>
              <div className="campo">
                <label htmlFor="emp-cidade">Cidade</label>
                <input id="emp-cidade" value={f.cidade} onChange={(e) => mudar('cidade', e.target.value)} />
              </div>
              <div className="campo">
                <label htmlFor="emp-uf">UF</label>
                <input id="emp-uf" maxLength={2} value={f.uf} onChange={(e) => mudar('uf', e.target.value.toUpperCase())} />
              </div>
            </div>
          </div>
          <div className="card form">
            <h2>Tributação na DRE</h2>
            <span className="small muted">Define como os impostos sobre vendas são deduzidos da receita na DRE gerencial.</span>
            <div className="campos">
              <div className="campo">
                <label htmlFor="emp-regime">Regime tributário</label>
                <select id="emp-regime" value={f.regimeTributario} onChange={(e) => mudar('regimeTributario', e.target.value as Formulario['regimeTributario'])}>
                  <option value="simples">Simples Nacional</option>
                  <option value="presumido">Lucro Presumido</option>
                  <option value="real">Lucro Real</option>
                </select>
              </div>
              {f.regimeTributario === 'simples' && (
                <>
                  <div className="campo">
                    <label htmlFor="emp-anexo">Anexo do Simples</label>
                    <select id="emp-anexo" value={f.simplesAnexo} onChange={(e) => mudar('simplesAnexo', e.target.value)}>
                      <option value="">Não definido</option>
                      {['I', 'II', 'III', 'IV', 'V'].map((a) => <option key={a} value={a}>Anexo {a}</option>)}
                    </select>
                  </div>
                  <div className="campo">
                    <label htmlFor="emp-faixa">Faixa de alíquota</label>
                    <select id="emp-faixa" value={f.simplesFaixa} onChange={(e) => mudar('simplesFaixa', e.target.value)}>
                      <option value="">Não definida</option>
                      {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>Faixa {n}</option>)}
                    </select>
                    <span className="ajuda">Define a alíquota do DAS que entra nos impostos da nota de cada obra.</span>
                  </div>
                </>
              )}
              {CAMPOS_ALIQUOTA[f.regimeTributario].map((c) => (
                <div className="campo" key={c.chave}>
                  <label htmlFor={`emp-aliq-${c.chave}`}>{c.rotulo}</label>
                  <input
                    id={`emp-aliq-${c.chave}`}
                    className="mono"
                    inputMode="decimal"
                    value={f.aliquotas[c.chave] ?? ''}
                    onChange={(e) => mudar('aliquotas', { ...f.aliquotas, [c.chave]: e.target.value })}
                  />
                </div>
              ))}
            </div>
          </div>
        </fieldset>
        {podeEditar && (
          <div className="acoes">
            <button className="btn btn-primario" type="submit" disabled={salvando}>
              {salvando ? 'Salvando…' : 'Salvar alterações'}
            </button>
          </div>
        )}
      </form>
      {empresa && (
        <LogoEImpressao
          empresa={empresa}
          podeEditar={!!usuario?.administrador}
          aoMudar={async (e) => { setEmpresa(e); await recarregar(); }}
        />
      )}
      <EmpresasGrupo podeEditar={podeEditar} />
      {podeEditar && <BackupEmpresa />}
      <ExportarDados />
    </>
  );
}

type BackupItem = { id: string; criadoEm: string; status: string; tamanhoBytes: number | null; registros: number | null; tabelas: number | null; erro: string | null; criadoPor: string | null };

/** Dono: backup guardado da própria empresa. Fica na lista e pode ser baixado depois. */
function BackupEmpresa() {
  const [lista, setLista] = useState<BackupItem[] | null>(null);
  const [armazenamento, setArmazenamento] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  function carregar() {
    api<{ armazenamentoConfigurado: boolean; backups: BackupItem[] }>('/empresa/backups')
      .then((r) => {
        setArmazenamento(r.armazenamentoConfigurado);
        setLista(r.backups);
      })
      .catch((e) => setErro((e as Error).message));
  }
  useEffect(carregar, []);

  async function fazerBackup() {
    setErro('');
    setAviso('');
    setOcupado(true);
    try {
      const r = await api<{ backup: { registros: number; tabelas: number } }>('/empresa/backups', { metodo: 'POST' });
      setAviso(`Backup feito: ${r.backup.registros.toLocaleString('pt-BR')} registros em ${r.backup.tabelas} tabelas.`);
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Backup da empresa</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Guarda uma cópia de todos os dados desta empresa, com a data do momento. Os backups ficam disponíveis por 30 dias.
        Para restaurar um backup, fale com o suporte.
      </p>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {aviso && <div className="alerta" role="status">{aviso}</div>}
      {!armazenamento && <div className="alerta alerta-erro" role="alert">O armazenamento de backups não está configurado. Procure o suporte.</div>}
      <div className="acoes">
        <button className="btn btn-primario" type="button" onClick={fazerBackup} disabled={ocupado || !armazenamento}>
          {ocupado ? 'Fazendo backup…' : 'Fazer backup agora'}
        </button>
      </div>
      {lista === null ? null : lista.length === 0 ? (
        <p className="small muted">Nenhum backup desta empresa ainda.</p>
      ) : (
        <table className="tabela tabela-compacta" style={{ marginTop: 12 }}>
          <thead>
            <tr><th>Data</th><th>Situação</th><th>Registros</th><th>Feito por</th><th /></tr>
          </thead>
          <tbody>
            {lista.map((b) => (
              <tr key={b.id}>
                <td>{formatarDataHora(b.criadoEm)}</td>
                <td>{b.status === 'ok' ? 'Concluído' : `Falhou${b.erro ? `: ${b.erro}` : ''}`}</td>
                <td className="mono">{b.registros === null ? '—' : b.registros.toLocaleString('pt-BR')}</td>
                <td>{b.criadoPor ?? '—'}</td>
                <td>
                  {b.status === 'ok' && (
                    <a className="btn btn-link" href={`/api/empresa/backups/${b.id}/download`} download>Baixar</a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Dono e gestor: baixa os dados desta empresa em planilha (XLSX) e em JSON, sem senhas. */
function ExportarDados() {
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Exportar dados da empresa</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Baixa uma cópia de todos os dados desta empresa: uma planilha (XLSX) com uma aba por assunto e os mesmos dados em JSON, num arquivo .zip.
        As senhas dos usuários não são incluídas. Este arquivo não restaura o sistema.
      </p>
      <a className="btn btn-primario" href="/api/empresa/exportacao" download>Baixar exportação (.zip)</a>
    </div>
  );
}

function lerComoDataUrl(arquivo: File): Promise<string> {
  return new Promise((ok, falha) => {
    const leitor = new FileReader();
    leitor.onload = () => ok(String(leitor.result));
    leitor.onerror = () => falha(new Error('Não foi possível ler o arquivo.'));
    leitor.readAsDataURL(arquivo);
  });
}

function LogoEImpressao({ empresa, podeEditar, aoMudar }: { empresa: TEmpresa; podeEditar: boolean; aoMudar: (e: TEmpresa) => Promise<void> }) {
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [imp, setImp] = useState<Impressao>(empresa.impressao ?? { orientacao: 'paisagem', papel: 'A4' });

  async function executar(acao: () => Promise<{ empresa: TEmpresa }>, mensagem: string) {
    setErro('');
    setOk('');
    setEnviando(true);
    try {
      const r = await acao();
      await aoMudar(r.empresa);
      setOk(mensagem);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  async function escolherArquivo(arquivo: File | undefined) {
    if (!arquivo) return;
    if (arquivo.size > 500 * 1024) { setErro('A imagem passa de 500 KB. Reduza o tamanho e tente de novo.'); return; }
    if (!/^image\/(png|jpeg|svg\+xml|webp)$/.test(arquivo.type)) { setErro('Use uma imagem PNG, JPG, WEBP ou SVG.'); return; }
    const imagem = await lerComoDataUrl(arquivo);
    await executar(() => api('/empresa/logo', { metodo: 'PUT', corpo: { imagem } }), 'Logo atualizada. Ela já aparece nos relatórios.');
  }

  return (
    <div className="card form" style={{ marginTop: 16 }}>
      <h2>Relatórios: logo e impressão</h2>
      <span className="small muted">
        {podeEditar ? 'A logo aparece no cabeçalho de todos os relatórios. O padrão de impressão vale para todos os usuários, que ainda podem mudar na hora de imprimir.' : 'Somente administradores alteram a logo e o padrão de impressão.'}
      </span>
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {ok && <div className="alerta alerta-ok" role="status">{ok}</div>}
      <div className="campos">
        <div className="campo">
          <label htmlFor="emp-logo">Logo da construtora</label>
          {empresa.temLogo
            ? <img className="logo-previa" src={`/api/empresa/logo?v=${empresa.logoVersao ?? 0}`} alt="Logo atual" />
            : <span className="small muted">Nenhuma logo enviada.</span>}
          {podeEditar && (
            <>
              <input id="emp-logo" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" disabled={enviando} onChange={(e) => { void escolherArquivo(e.target.files?.[0]); e.target.value = ''; }} />
              <span className="small muted">PNG, JPG, WEBP ou SVG, até 500 KB. Prefira fundo transparente.</span>
              {empresa.temLogo && (
                <button className="btn btn-link" type="button" disabled={enviando} style={{ alignSelf: 'flex-start' }}
                  onClick={() => void executar(() => api('/empresa/logo', { metodo: 'DELETE' }), 'Logo removida.')}>
                  Remover logo
                </button>
              )}
            </>
          )}
        </div>
        <div className="campo">
          <label htmlFor="emp-orientacao">Orientação padrão</label>
          <select id="emp-orientacao" disabled={!podeEditar} value={imp.orientacao} onChange={(e) => setImp({ ...imp, orientacao: e.target.value as Impressao['orientacao'] })}>
            <option value="paisagem">Paisagem</option>
            <option value="retrato">Retrato</option>
          </select>
        </div>
        <div className="campo">
          <label htmlFor="emp-papel">Tipo de página</label>
          <select id="emp-papel" disabled={!podeEditar} value={imp.papel} onChange={(e) => setImp({ ...imp, papel: e.target.value as Impressao['papel'] })}>
            {(Object.keys(NOMES_PAPEL) as Impressao['papel'][]).map((p) => <option key={p} value={p}>{NOMES_PAPEL[p]}</option>)}
          </select>
        </div>
      </div>
      {podeEditar && (
        <div className="acoes">
          <button className="btn btn-secundario" type="button" disabled={enviando}
            onClick={() => void executar(() => api('/empresa/impressao', { metodo: 'PUT', corpo: imp }), 'Padrão de impressão salvo.')}>
            Salvar padrão de impressão
          </button>
        </div>
      )}
    </div>
  );
}
