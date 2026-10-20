// Módulo Laudos. Laudo de GLP: rede e central de gás (instalação em PEX ou galvanizado), com campos
// extraídos de um laudo modelo. Dados do proprietário e do endereço podem vir da leitura do PDF pela IA.
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, formatarData } from '../api';
import { CabecalhoDocumento } from '../componentes/Documento';
import { Assinatura } from '../componentes/Suprimentos';

type Instalacao = 'pex' | 'galvanizado';
type Glp = {
  proprietarioNome: string; proprietarioDocumento: string; enderecoObra: string; cep: string; cidade: string; uf: string;
  instalacao: Instalacao; projetoAprovadoCbm: boolean; tubulacaoEnvelopada: boolean; locaisAplicacao: string; bitola: string;
  pressaoEnsaioPsi: number; tempoEnsaioHoras: number; tempoNormativoHoras: number; pressaoTrabalhoKgf: number; manometroKgf: number;
  centralGlp: string; pontosConsumo: number; art: string; dataLaudo: string; responsavelNome: string; responsavelRegistro: string;
  notasGerais: string; especificacoes: string; conclusao: string; notaPontos: string; observacoes: string;
};
type ResumoLaudo = { id: string; numero: number; titulo: string; proprietario: string; atualizadoEm: string };

const KGF_POR_PSI = 0.070307;
const kgf = (psi: number) => (Math.round(psi * KGF_POR_PSI * 100) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
const num = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const dataExtenso = (iso: string) => {
  if (!iso) return '';
  const [a, m, d] = iso.split('-').map(Number);
  const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return `${d} de ${meses[m - 1]} de ${a}`;
};

/** Notas gerais do modelo. Pex traz o parágrafo de pintura, vedação e torofita; galvanizado não traz. */
export function notasPadrao(d: Glp): string {
  const teste = `Os testes de estanqueidade foram realizados em toda a rede de distribuição de GLP, sendo ela submetida a um sistema de pressurização de ar com uma pressão de ${num(d.pressaoEnsaioPsi)} libras (psi), ou ${kgf(d.pressaoEnsaioPsi)} Kgf/cm², correspondendo a uma pressão maior que a pressão normal de trabalho de uma rede secundária que é de ${num(d.pressaoTrabalhoKgf)} kgf/cm². Esta rede ficou sob esta pressão por um período de ${num(d.tempoEnsaioHoras)} horas atendendo o período especificado nas normas que é de ${num(d.tempoNormativoHoras)} horas.`;
  const abertura = 'Nas redes de gás liquefeito de petróleo - GLP da obra acima mencionada foram realizados os testes de acordo com o projeto de rede de distribuição de GLP aprovado pelo Corpo de Bombeiros e os critérios da ABNT nas NBRs 13932 e 14024 que regulamentam as instalações internas de GLP, centrais prediais e industrias de sistemas de abastecimentos com a reposição de botijões dentro da central de GLP.';
  if (d.instalacao === 'galvanizado') return [abertura, teste].join('\n\n');
  const pintura = 'Todas as tubulações foram pintadas na cor amarela, conforme especificações da NBR 12694 e em atendimento a NT 23 do CBMTO. O sistema de vedação entre a tubulação e conexões é composto por rosca NPT, fita teflon, veda rosca, cola DOX e cola Epóxi bi componente (Araldite).' +
    (d.tubulacaoEnvelopada ? ' As tubulações embutidas no piso ou parede foram envelopadas por torofitas.' : '');
  return [abertura, pintura, teste].join('\n\n');
}

/** Locais e bitolas do modelo de cada instalação (seção 3). */
export const MODELO_REDE: Record<Instalacao, { locais: string; bitola: string }> = {
  pex: { locais: 'Rede primária e secundária', bitola: 'Rede primária e distribuição exposta: ∅ 16mm' },
  galvanizado: { locais: 'Rede de distribuição da Central de GLP até o ponto de Consumo', bitola: 'Rede: 3/4” para distribuição' },
};

/** Especificação do material (seção 4). Só há modelo pronto para PEX; galvanizado ainda será preenchido. */
export function especificacaoPadrao(instalacao: Instalacao): string {
  if (instalacao === 'galvanizado') {
    return [
      'O aço galvanizado é um produto que passa pelo processo de galvanização - o ato de revestir o aço com uma camada de zinco bem fina, a fim de potencializar sua resistência anticorrosiva. Atualmente, existem diferentes tamanhos de tubo galvanizado, além de particularidades em relação ao processo de galvanização.',
      'As estruturas empresariais e de construção civil do século XXI são marcadas pela necessidade de durabilidade e, principalmente, de rigidez para dar origem a projetos de engenharia eficazes. Partindo disso, no cenário industrial, os tubos galvanizados se apresentam como opções ideais para a condução de fluidos e ainda para as empreiteiras de construção e para a instalação de postes públicos ou construtoras em geral.',
      'Há diversos tipos de aço no mercado e cada um deles possui características diferenciadas e pode ser usado para fins variados. O aço de carbono é uma liga metálica, composta por ferro e carbono e bastante suscetível à corrosão (ferrugem). Esse tipo de aço é formado pela liga de ferro com carbono, na qual o teor de carbono é inferior a 2,11%. Já o aço galvanizado é composto por uma mistura robusta do aço líquido com uma solução pelo menos 10% de cromo, oferecendo alta resistência à corrosão. Ambos são amplamente utilizados na indústria e em outros segmentos, no entanto, o aço galvanizado proporciona maior durabilidade por suas propriedades anticorrosivas. A camada de zinco auxilia a poupar recursos naturais como o minério de ferro e também energia, prolongando a longevidade do produto.',
    ].join('\n\n');
  }
  return [
    'O PEX é uma tubulação flexível fabricada em polietileno reticulado podendo ser utilizada para condução de água fria e quente, gás natural ou gás GLP (gás de cozinha) e ar condicionado.',
    'A tubulação pode ser monocamada ou multicamada. A monocamada é feita somente de PEX e é utilizada para instalações de água fria e água quente. Já a multicamada possui parte externa e interna de PEX, além de uma camada intermediária de alumínio, podendo ser utilizada em todos os tipos de instalação.',
    'O sistema multicamada pode ter ou não proteção UV; a diferença entre as duas opções está no armazenamento e local de instalação do produto. O sistema sem proteção UV deve ser armazenado ou instalado em locais protegidos de raios solares. Caso o produto conte com a proteção UV, ele pode ser exposto à luz do sol.',
    'Vantagens: O PEX é um material flexível/ dúctil que permite curvas, reduzindo o número de conexões (cotovelos e joelhos) utilizadas na construção. Por se tratar de um material plástico, não corre o risco de corrosão bimetálica. Possui boa resistência a baixas e altas temperaturas (95°C permanentemente, com picos ocasionais de 110°C durante 48 horas), além de ter boa resistência química. Diminui o risco de vazamentos. É uma tubulação mais leve, facilitando o transporte e armazenamento. Fornecida em rolos, pode ser cortada de acordo com a necessidade, evitando desperdícios. Possui vida útil de 50 anos.',
  ].join('\n\n');
}

export function conclusaoPadrao(d: Glp): string {
  return `Foi utilizado para aferir a pressão interna um manômetro de ${num(d.manometroKgf)} Kgf/cm², o qual não registrou nenhuma queda de pressão durante o período submetido a esta pressão. Não foi detectado nenhum vazamento nas tubulações, onde concluímos que toda a rede se encontra em perfeitas condições de uso e segurança.`;
}

const ARQUIVO_BASE64 = (arquivo: File) =>
  new Promise<string>((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result).split(',')[1] ?? '');
    leitor.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    leitor.readAsDataURL(arquivo);
  });

/** Lista de laudos de um tipo. Avaliações e patologias ainda não têm modelo cadastrado. */
export function LaudosLista({ tipo, titulo, descricao }: { tipo: 'glp' | 'avaliacao' | 'patologia'; titulo: string; descricao: string }) {
  const navegar = useNavigate();
  const [laudos, setLaudos] = useState<ResumoLaudo[] | null>(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    api<ResumoLaudo[]>(`/laudos?tipo=${tipo}`).then(setLaudos).catch((e) => setErro(e.message));
  }, [tipo]);

  async function novo() {
    setOcupado(true);
    try {
      const r = await api<{ id: string }>('/laudos', { metodo: 'POST', corpo: { tipo } });
      navegar(`/laudos/${tipo === 'glp' ? 'glp' : tipo}/${r.id}`);
    } catch (e) {
      setErro((e as Error).message);
      setOcupado(false);
    }
  }

  return (
    <>
      <CabecalhoDocumento modulo="Laudos" titulo={titulo} descricao={descricao} />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {tipo !== 'glp' && (
        <div className="alerta alerta-ok" role="status">
          O modelo deste laudo ainda não foi cadastrado. Envie o PDF modelo para configurar os campos.
        </div>
      )}
      <div className="acoes nao-imprimir">
        <button className="btn btn-primario" type="button" onClick={novo} disabled={ocupado || tipo !== 'glp'}>Novo laudo</button>
      </div>
      <div className="card tabela-caixa">
        {!laudos ? (
          <p className="muted">Carregando…</p>
        ) : laudos.length === 0 ? (
          <p className="muted">Nenhum laudo lançado.</p>
        ) : (
          <table className="tabela">
            <thead><tr><th style={{ width: '10%' }}>Nº</th><th>Proprietário / título</th><th>Última alteração</th></tr></thead>
            <tbody>
              {laudos.map((l) => (
                <tr key={l.id}>
                  <td className="mono"><Link to={`/laudos/${tipo}/${l.id}`}>{l.numero}</Link></td>
                  <td><Link to={`/laudos/${tipo}/${l.id}`}>{l.titulo || l.proprietario || 'Sem título'}</Link></td>
                  <td>{formatarData(l.atualizadoEm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

/** Laudo de GLP: formulário com os campos do modelo, leitura de PDF pela IA e impressão no formato do laudo. */
export function LaudoGlp() {
  const { id = '' } = useParams();
  const [dados, setDados] = useState<Glp | null>(null);
  const [numero, setNumero] = useState<number | null>(null);
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [lendo, setLendo] = useState(false);

  useEffect(() => {
    api<{ numero?: number; dados: Glp }>(`/laudos/${id}`)
      .then((r) => { setDados(r.dados); setNumero(r.numero ?? null); })
      .catch((e) => setErro(e.message));
  }, [id]);

  const alterar = (campo: Partial<Glp>) => setDados((d) => (d ? { ...d, ...campo } : d));

  async function lerPdf(arquivo: File | undefined) {
    if (!arquivo) return;
    setLendo(true);
    setErro('');
    setOk('');
    try {
      const base64 = await ARQUIVO_BASE64(arquivo);
      const r = await api<{ dados: Partial<Glp> }>('/laudos/ler-glp', { metodo: 'POST', corpo: { arquivo: base64, nome: arquivo.name } });
      alterar(r.dados);
      setOk('Dados lidos do PDF. Confira os campos antes de salvar.');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setLendo(false);
    }
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!dados) return;
    setOcupado(true);
    setErro('');
    setOk('');
    try {
      await api(`/laudos/${id}`, { metodo: 'PUT', corpo: { titulo: dados.proprietarioNome, dados } });
      setOk('Laudo salvo.');
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  if (!dados) return erro ? <div className="alerta alerta-erro" role="alert">{erro}</div> : <p className="muted">Carregando…</p>;

  const notas = dados.notasGerais.trim() || notasPadrao(dados);
  const especificacoes = dados.especificacoes.trim() || especificacaoPadrao(dados.instalacao);
  const conclusao = dados.conclusao.trim() || conclusaoPadrao(dados);
  const ehPex = dados.instalacao === 'pex';

  return (
    <>
      <div className="nao-imprimir"><Link to="/laudos/glp" className="small">← Laudos de GLP</Link></div>
      <CabecalhoDocumento
        modulo="Laudos"
        titulo={`Laudo de rede e central de GLP${numero ? ` nº ${numero}` : ''}`}
        descricao={`Cliente: ${dados.proprietarioNome || '—'}${dados.cidade ? ` · Local: ${dados.cidade}${dados.uf ? ` - ${dados.uf}` : ''}` : ''}`}
        logoDireita
      />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {ok && <div className="alerta alerta-ok" role="status">{ok}</div>}

      <div className="card nao-imprimir">
        <h2>Preencher pela leitura de um laudo (PDF)</h2>
        <p className="small muted">Envie um laudo anterior (Pex ou galvanizado). A IA preenche proprietário, endereço e os valores do ensaio. Confira antes de salvar.</p>
        <label className="btn btn-secundario" style={{ cursor: lendo ? 'progress' : 'pointer', alignSelf: 'flex-start' }}>
          {lendo ? 'Lendo o PDF…' : 'Escolher PDF'}
          <input type="file" accept="application/pdf" hidden disabled={lendo} onChange={(e) => lerPdf(e.target.files?.[0])} />
        </label>
      </div>

      <form className="card form nao-imprimir" onSubmit={salvar}>
        <h2>Identificação da edificação</h2>
        <div className="campos">
          <div className="campo"><label htmlFor="g-prop">Proprietário</label><input id="g-prop" value={dados.proprietarioNome} onChange={(e) => alterar({ proprietarioNome: e.target.value })} /></div>
          <div className="campo"><label htmlFor="g-doc">CNPJ / CPF</label><input id="g-doc" value={dados.proprietarioDocumento} onChange={(e) => alterar({ proprietarioDocumento: e.target.value })} /></div>
          <div className="campo"><label htmlFor="g-end">Endereço da obra</label><input id="g-end" value={dados.enderecoObra} onChange={(e) => alterar({ enderecoObra: e.target.value })} /></div>
          <div className="campo"><label htmlFor="g-cep">CEP</label><input id="g-cep" value={dados.cep} onChange={(e) => alterar({ cep: e.target.value })} /></div>
          <div className="campo"><label htmlFor="g-cid">Cidade</label><input id="g-cid" value={dados.cidade} onChange={(e) => alterar({ cidade: e.target.value })} /></div>
          <div className="campo"><label htmlFor="g-uf">UF</label><input id="g-uf" maxLength={2} value={dados.uf} onChange={(e) => alterar({ uf: e.target.value.toUpperCase() })} /></div>
          <div className="campo">
            <label htmlFor="g-inst">Instalação</label>
            <select id="g-inst" value={dados.instalacao} onChange={(e) => { const i = e.target.value as Instalacao; alterar({ instalacao: i, locaisAplicacao: MODELO_REDE[i].locais, bitola: MODELO_REDE[i].bitola }); }}>
              <option value="pex">PEX</option>
              <option value="galvanizado">Galvanizado</option>
            </select>
          </div>
        </div>

        <h2>Rede de distribuição</h2>
        <div className="campos">
          <div className="campo"><label htmlFor="g-loc">Locais de aplicação</label><input id="g-loc" value={dados.locaisAplicacao} onChange={(e) => alterar({ locaisAplicacao: e.target.value })} /></div>
          <div className="campo"><label htmlFor="g-bit">Bitola(s) utilizada(s)</label><input id="g-bit" value={dados.bitola} onChange={(e) => alterar({ bitola: e.target.value })} placeholder="Ex.: Rede primária e distribuição exposta: ∅ 16mm" /></div>
          <div className="campo">
            <label><input type="checkbox" checked={dados.projetoAprovadoCbm} onChange={(e) => alterar({ projetoAprovadoCbm: e.target.checked })} /> Projeto aprovado pelo Corpo de Bombeiros</label>
          </div>
          <div className="campo">
            <label><input type="checkbox" checked={dados.tubulacaoEnvelopada} onChange={(e) => alterar({ tubulacaoEnvelopada: e.target.checked })} /> Tubulação embutida envelopada (torofita)</label>
          </div>
        </div>

        <h2>Ensaio de estanqueidade</h2>
        <div className="campos">
          <div className="campo"><label htmlFor="g-psi">Pressão de ensaio (psi)</label><input id="g-psi" inputMode="decimal" value={dados.pressaoEnsaioPsi} onChange={(e) => alterar({ pressaoEnsaioPsi: Number(e.target.value.replace(',', '.')) || 0 })} /></div>
          <div className="campo"><label htmlFor="g-tens">Tempo de ensaio (horas)</label><input id="g-tens" inputMode="decimal" value={dados.tempoEnsaioHoras} onChange={(e) => alterar({ tempoEnsaioHoras: Number(e.target.value.replace(',', '.')) || 0 })} /></div>
          <div className="campo"><label htmlFor="g-tnorm">Tempo normativo (horas)</label><input id="g-tnorm" inputMode="decimal" value={dados.tempoNormativoHoras} onChange={(e) => alterar({ tempoNormativoHoras: Number(e.target.value.replace(',', '.')) || 0 })} /></div>
          <div className="campo"><label htmlFor="g-ptrab">Pressão normal de trabalho (kgf/cm²)</label><input id="g-ptrab" inputMode="decimal" value={dados.pressaoTrabalhoKgf} onChange={(e) => alterar({ pressaoTrabalhoKgf: Number(e.target.value.replace(',', '.')) || 0 })} /></div>
          <div className="campo"><label htmlFor="g-man">Manômetro (kgf/cm²)</label><input id="g-man" inputMode="decimal" value={dados.manometroKgf} onChange={(e) => alterar({ manometroKgf: Number(e.target.value.replace(',', '.')) || 0 })} /></div>
        </div>

        <h2>Central e pontos de consumo</h2>
        <div className="campos">
          <div className="campo"><label htmlFor="g-cen">Central de GLP</label><input id="g-cen" value={dados.centralGlp} onChange={(e) => alterar({ centralGlp: e.target.value })} placeholder="Ex.: 176 P-13" /></div>
          <div className="campo"><label htmlFor="g-pts">Pontos de utilização</label><input id="g-pts" inputMode="numeric" value={dados.pontosConsumo} onChange={(e) => alterar({ pontosConsumo: Number(e.target.value) || 0 })} /></div>
          <div className="campo"><label htmlFor="g-nota-pts">Nota sobre os demais pontos (opcional)</label><input id="g-nota-pts" value={dados.notaPontos} onChange={(e) => alterar({ notaPontos: e.target.value })} placeholder="Ex.: Demais pontos de utilização existentes estão lacrados." /></div>
        </div>

        <h2>Textos do laudo</h2>
        <p className="small muted">Vazios, os textos usam o padrão do modelo com os valores acima.</p>
        <div className="campo">
          <label htmlFor="g-notas">Notas gerais</label>
          <textarea id="g-notas" rows={6} value={dados.notasGerais} placeholder={notasPadrao(dados)} onChange={(e) => alterar({ notasGerais: e.target.value })} />
          <button type="button" className="btn btn-link" onClick={() => alterar({ notasGerais: notasPadrao(dados) })}>Usar texto padrão</button>
        </div>
        <div className="campo">
          <label htmlFor="g-espec">Especificações do material</label>
          <textarea id="g-espec" rows={6} value={dados.especificacoes} placeholder={especificacaoPadrao(dados.instalacao) || 'Texto de especificação para galvanizado ainda não cadastrado.'} onChange={(e) => alterar({ especificacoes: e.target.value })} />
          {dados.instalacao === 'pex' && <button type="button" className="btn btn-link" onClick={() => alterar({ especificacoes: especificacaoPadrao('pex') })}>Usar texto padrão</button>}
        </div>
        <div className="campo">
          <label htmlFor="g-conc">Conclusão</label>
          <textarea id="g-conc" rows={4} value={dados.conclusao} placeholder={conclusaoPadrao(dados)} onChange={(e) => alterar({ conclusao: e.target.value })} />
          <button type="button" className="btn btn-link" onClick={() => alterar({ conclusao: conclusaoPadrao(dados) })}>Usar texto padrão</button>
        </div>

        <h2>Responsável e assinatura</h2>
        <div className="campos">
          <div className="campo"><label htmlFor="g-art">ART (CREA/TO)</label><input id="g-art" value={dados.art} onChange={(e) => alterar({ art: e.target.value })} /></div>
          <div className="campo"><label htmlFor="g-data">Data do laudo</label><input id="g-data" type="date" value={dados.dataLaudo} onChange={(e) => alterar({ dataLaudo: e.target.value })} /></div>
          <div className="campo"><label htmlFor="g-rn">Responsável técnico</label><input id="g-rn" value={dados.responsavelNome} onChange={(e) => alterar({ responsavelNome: e.target.value })} /></div>
          <div className="campo"><label htmlFor="g-rr">Registro no conselho</label><input id="g-rr" value={dados.responsavelRegistro} onChange={(e) => alterar({ responsavelRegistro: e.target.value })} /></div>
        </div>
        <div className="campo"><label htmlFor="g-obs">Observações internas (não aparecem no laudo)</label><textarea id="g-obs" rows={2} value={dados.observacoes} onChange={(e) => alterar({ observacoes: e.target.value })} /></div>

        <div className="acoes">
          <button className="btn btn-primario" type="submit" disabled={ocupado}>Salvar laudo</button>
        </div>
      </form>

      <div className="so-imprimir laudo-impresso">
        <h2 className="laudo-secao">1 Dados da edificação</h2>
        <p>Proprietário: {dados.proprietarioNome}{dados.proprietarioDocumento ? `; CNPJ/CPF: ${dados.proprietarioDocumento}` : ''}</p>
        <p>Endereço: {dados.enderecoObra}{dados.cep ? `; CEP: ${dados.cep}` : ''}{dados.cidade ? `; ${dados.cidade}${dados.uf ? ` - ${dados.uf}` : ''}` : ''}</p>

        <h2 className="laudo-secao">2 Notas gerais</h2>
        {notas.split('\n\n').map((p, i) => <p key={i} className="texto-justificado">{p}</p>)}

        <h2 className="laudo-secao">3 Materiais utilizados</h2>
        <p>3.1 {ehPex ? 'Tubos e conexões Pex.' : 'Tubos e conexões Galvanizadas.'}</p>
        <ul>
          <li>Locais de aplicação: {dados.locaisAplicacao}</li>
          {dados.bitola && <li>Bitola(s) utilizada(s): {dados.bitola}</li>}
        </ul>

        <h2 className="laudo-secao">4 Especificações</h2>
        <p>4.1 {ehPex ? 'Pex' : 'Tubos e conexões galvanizadas'}</p>
        {especificacoes.split('\n\n').map((p, i) => <p key={i} className="texto-justificado">{p}</p>)}

        <h2 className="laudo-secao">5 A central de gás</h2>
        <p>Central de GLP: {dados.centralGlp || '—'}</p>

        <h2 className="laudo-secao">6 Pontos de consumo</h2>
        <p>{dados.pontosConsumo} Pontos de Utilização{dados.notaPontos ? '*' : ''}</p>
        {dados.notaPontos && <p className="laudo-nota">* {dados.notaPontos}</p>}

        <h2 className="laudo-secao">7 Conclusão</h2>
        <p className="texto-justificado">{conclusao}</p>
        {dados.art && <p>Laudo vinculado a ART – CREA/TO nº {dados.art}.</p>}
        {dados.cidade && <p className="direita">{dados.cidade}{dados.dataLaudo ? `, ${dataExtenso(dados.dataLaudo)}` : ''}.</p>}
        <div className="so-imprimir assinaturas">
          <Assinatura nome={dados.responsavelNome} papel={dados.responsavelRegistro || 'Engenheiro responsável'} />
        </div>
      </div>
    </>
  );
}
