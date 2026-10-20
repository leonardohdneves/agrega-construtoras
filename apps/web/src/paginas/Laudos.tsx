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

const ROTA_TIPO = { glp: 'glp', avaliacao: 'avaliacoes', patologia: 'patologias' } as const;

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
      navegar(`/laudos/${ROTA_TIPO[tipo]}/${r.id}`);
    } catch (e) {
      setErro((e as Error).message);
      setOcupado(false);
    }
  }

  return (
    <>
      <CabecalhoDocumento modulo="Laudos" titulo={titulo} descricao={descricao} />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      <div className="acoes nao-imprimir">
        <button className="btn btn-primario" type="button" onClick={novo} disabled={ocupado}>Novo laudo</button>
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
                  <td className="mono"><Link to={`/laudos/${ROTA_TIPO[tipo]}/${l.id}`}>{l.numero}</Link></td>
                  <td><Link to={`/laudos/${ROTA_TIPO[tipo]}/${l.id}`}>{l.titulo || l.proprietario || 'Sem título'}</Link></td>
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

// ------------------------------------------------------------------ Laudo de patologia (vistoria técnica)

const PROBLEMA_PADRAO = (d: { dataVistoria: string; localObra: string }) =>
  `Durante a vistoria realizada${d.dataVistoria ? ` no dia ${formatarData(d.dataVistoria)}` : ''}, na unidade localizada no pavimento inferior (Térreo), foram identificadas manifestações patológicas no teto da suíte, situado imediatamente abaixo da suíte da unidade do pavimento imediatamente superior (2º Pavimento)${d.localObra ? `, no ${d.localObra}` : ''}, conforme pode ser visto na Figura 1 abaixo.\n\nAs manifestações caracterizam-se por:\n• Formação de faixas lineares de umidade na laje, acompanhando o alinhamento compatível com o posicionamento dos trilhos que compõem a laje;\n• Alteração cromática da pintura, com escurecimento localizado.`;

const OBJETO_PADRAO =
  'O presente Laudo de Vistoria Técnica tem por objeto a análise e avaliação das manifestações patológicas identificadas em unidade autônoma localizada em pavimento inferior de edificação multifamiliar, consistentes em manchas e faixas de umidade no teto, com indícios de infiltração de água.\n\nA vistoria foi solicitada com a finalidade de apurar a origem provável da infiltração localizada no pavimento imediatamente superior, bem como avaliar o nexo técnico entre os elementos construtivos e as manifestações observadas.\n\nO escopo do presente laudo compreende: inspeção técnica visual das áreas afetadas; registro fotográfico das manifestações patológicas constatadas; análise do padrão de ocorrência das manchas de umidade; avaliação técnica preliminar das possíveis causas do problema; e emissão de hipótese técnica fundamentada acerca do mecanismo de infiltração.\n\nNão constitui objeto deste laudo a realização de ensaios destrutivos, abertura de elementos construtivos, testes laboratoriais, medições instrumentais de umidade em profundidade ou avaliação estrutural global da edificação, salvo quando expressamente indicado.';

const VISTORIA_PADRAO =
  'Foi realizada vistoria técnica na unidade autônoma situada no pavimento superior, com o objetivo de verificar a existência de anomalias construtivas que pudessem justificar as manifestações de umidade identificadas na unidade inferior.\n\nA inspeção consistiu em avaliação visual minuciosa dos ambientes internos adjacentes à fachada, com especial atenção às áreas molhadas, revestimentos cerâmicos, rejuntes, rodapés, encontros entre piso e parede, soleiras, peitoris, além das interfaces entre esquadrias e elementos de vedação vertical.\n\nDurante a vistoria, não foram constatadas falhas aparentes em rejuntes, tais como fissuração, destacamento, pulverulência ou ausência de material, que pudessem caracterizar ponto de infiltração compatível com o padrão de umidade observado no pavimento inferior. Da mesma forma, não foram identificadas patologias em revestimentos cerâmicos, selagens internas, tubulações aparentes ou demais elementos construtivos que indicassem vazamento de origem hidrossanitária ou infiltração por uso inadequado das áreas molhadas.\n\nAs condições observadas na unidade vistoriada mostram-se compatíveis com funcionamento regular dos sistemas internos, não sendo evidenciadas, no momento da inspeção, anomalias construtivas internas capazes de explicar tecnicamente o padrão de infiltração identificado.\n\nDessa forma, os achados reforçam a hipótese de ingresso de água por elementos da envoltória externa da edificação, especialmente nas interfaces de esquadrias com o sistema de vedação vertical.';

const HIPOTESE_PADRAO =
  'Com base nas evidências observadas durante a vistoria, no padrão das manifestações patológicas identificadas e na análise técnica das condições construtivas aparentes, conclui-se, em caráter de hipótese técnica fundamentada, que as manifestações de umidade verificadas no teto da unidade inferior decorrem de infiltração de água pluvial associada a falhas de estanqueidade nas esquadrias instaladas na fachada do pavimento superior.\n\nO alinhamento das faixas de umidade com o posicionamento das esquadrias, bem como a configuração linear das manchas e seu comportamento típico de percolação gravitacional, indicam que a água de chuva está transpondo a barreira de vedação da envoltória da edificação na interface esquadria/alvenaria, migrando pelos elementos construtivos (laje e/ou sistema de vedação vertical) até manifestar-se no teto da unidade inferior.\n\nA causa provável da perda de estanqueidade pode estar relacionada a um ou mais dos seguintes fatores: degradação, falha ou ausência de selantes perimetrais; deficiência na vedação entre contramarco e alvenaria; execução inadequada das juntas de interface; ausência ou obstrução de dispositivos de drenagem da esquadria; fissuração ou descontinuidade no sistema de vedação adjacente.\n\nO padrão observado é compatível com infiltração de origem externa (água de chuva), não havendo indícios técnicos, no momento da vistoria, que caracterizem vazamento proveniente de instalações hidrossanitárias internas.\n\nDessa forma, conclui-se que as manifestações patológicas observadas são tecnicamente compatíveis com falha de desempenho do sistema de vedação das esquadrias, caracterizando comprometimento da estanqueidade da envoltória no trecho analisado.';

const CONSIDERACOES_PADRAO =
  'Considerando a hipótese técnica de falha de estanqueidade nas esquadrias externas, recomendam-se as seguintes medidas corretivas, a serem executadas por profissional habilitado e empresa especializada.\n\n7.1 Verificação e reexecução das selagens perimetrais\n• Remoção completa dos selantes deteriorados, fissurados ou com perda de aderência na interface entre esquadria (marco/contramarco) e alvenaria;\n• Limpeza adequada das superfícies de contato, com remoção de poeira, resíduos soltos e materiais degradados;\n• Aplicação de novo selante elastomérico de alto desempenho (ex.: poliuretano ou silicone neutro estrutural), compatível com o material da esquadria e com as movimentações térmicas previstas.\n\n7.2 Revisão da interface contramarco/alvenaria\n• Verificação da existência de frestas ou vazios entre contramarco e elemento de vedação;\n• Caso constatadas descontinuidades, promover vedação com material apropriado (selante elastomérico ou argamassa polimérica de vedação externa);\n• Avaliação da necessidade de recomposição de reboco ou regularização do plano de assentamento.\n\n7.3 Inspeção e desobstrução dos dispositivos de drenagem\n• Verificação dos orifícios de drenagem (weep holes) da esquadria;\n• Limpeza e desobstrução de canais internos;\n• Garantia de que a água eventualmente infiltrada no sistema seja corretamente conduzida ao exterior.\n\n7.4 Verificação de peitoris e arremates externos\n• Conferência da inclinação adequada do peitoril para o lado externo;\n• Avaliação da integridade de pingadeiras e arremates;\n• Vedação de microfissuras em encontros com revestimentos externos.';

const CONCLUSAO_PADRAO =
  'Após a realização de vistoria técnica nas unidades envolvidas, análise das manifestações patológicas observadas e avaliação das condições construtivas aparentes, conclui-se que as faixas de umidade identificadas no teto da unidade localizada no pavimento inferior apresentam características compatíveis com infiltração de água de origem pluvial.\n\nO padrão linear das manchas, seu alinhamento com a fachada e a inexistência de indícios de vazamentos internos na unidade superior indicam, de forma tecnicamente fundamentada, que o mecanismo de ingresso da água está associado à perda de estanqueidade nas esquadrias externas ou em suas interfaces com o sistema de vedação vertical.\n\nDurante a vistoria na unidade autônoma do pavimento superior, não foram constatadas falhas em rejuntes, revestimentos, instalações hidrossanitárias ou outros elementos internos que justificassem, por si, o padrão de infiltração identificado. Dessa forma, afasta-se, no momento da inspeção, a hipótese de vazamento interno como causa primária do problema.\n\nAs evidências observadas indicam comprometimento do desempenho de estanqueidade da envoltória da edificação no trecho analisado, demandando intervenções corretivas específicas nas interfaces da esquadria, conforme orientações técnicas apresentadas neste laudo.\n\nDiante do exposto, conclui-se que as manifestações patológicas verificadas decorrem, com elevado grau de probabilidade técnica, de falha de vedação nas esquadrias externas ou em suas interfaces construtivas, sendo recomendada a adoção das medidas corretivas indicadas para restabelecimento do desempenho adequado do sistema.';

const ACOMPANHAMENTO_PADRAO =
  'Em complemento às orientações técnicas anteriormente apresentadas, foi realizado acompanhamento técnico das intervenções executadas, com a finalidade de restabelecer a estanqueidade das esquadrias externas e eliminar o mecanismo de infiltração identificado.\n\nO acompanhamento consistiu na verificação das etapas de execução dos serviços corretivos, compreendendo: reexecução das selagens perimetrais com material elastomérico adequado; vedação de frestas e descontinuidades identificadas na interface contramarco/alvenaria; revisão e desobstrução dos dispositivos de drenagem da esquadria; e conferência dos arremates externos e peitoris.\n\nDurante a execução, foram observados os procedimentos técnicos recomendados para aplicação de selantes, incluindo controle de aderência, regularidade do cordão de vedação e garantia de continuidade da junta, de modo a evitar pontos de falha ou descontinuidade.\n\nRessalta-se que a avaliação do desempenho definitivo das correções deve considerar a ocorrência de chuvas naturais subsequentes, uma vez que a infiltração originalmente observada estava associada à ação de água pluvial sob determinadas condições de incidência e intensidade.\n\nConclui-se que, sob o ponto de vista técnico e nas condições verificadas durante o acompanhamento, as intervenções executadas mostram-se adequadas ao restabelecimento da estanqueidade da esquadria no trecho analisado, permanecendo recomendável monitoramento periódico para confirmação da eficácia a médio prazo.';

type Patologia = {
  proprietarioNome: string; proprietarioDocumento: string; localObra: string; endereco: string; cep: string; cidade: string; uf: string;
  dataVistoria: string; problemaTexto: string; objetoTexto: string; vistoriaTexto: string; hipoteseTexto: string; consideracoesTexto: string;
  conclusaoTexto: string; acompanhamentoData: string; acompanhamentoTexto: string; art: string; dataLaudo: string;
  responsavelNome: string; responsavelRegistro: string; observacoes: string;
};

/** Laudo de patologia: textos do modelo (vistoria, hipótese, orientações, conclusão e acompanhamento das correções). */
export function LaudoPatologia() {
  const { id = '' } = useParams();
  const [d, setD] = useState<Patologia | null>(null);
  const [numero, setNumero] = useState<number | null>(null);
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [lendo, setLendo] = useState(false);

  useEffect(() => {
    api<{ numero?: number; dados: Patologia }>(`/laudos/${id}`)
      .then((r) => { setD(r.dados); setNumero(r.numero ?? null); })
      .catch((e) => setErro(e.message));
  }, [id]);

  const alterar = (campo: Partial<Patologia>) => setD((x) => (x ? { ...x, ...campo } : x));

  async function lerPdf(arquivo: File | undefined) {
    if (!arquivo) return;
    setLendo(true);
    setErro('');
    setOk('');
    try {
      const base64 = await ARQUIVO_BASE64(arquivo);
      const r = await api<{ identificacao: Record<string, string> }>('/laudos/ler-identificacao', { metodo: 'POST', corpo: { arquivo: base64, nome: arquivo.name } });
      const i = r.identificacao;
      alterar({
        proprietarioNome: i.proprietarioNome || d?.proprietarioNome || '',
        proprietarioDocumento: i.proprietarioDocumento || d?.proprietarioDocumento || '',
        localObra: i.localObra || d?.localObra || '',
        endereco: i.endereco || d?.endereco || '',
        cep: i.cep || d?.cep || '',
        cidade: i.cidade || d?.cidade || '',
        uf: i.uf || d?.uf || '',
        art: i.art || d?.art || '',
      });
      setOk('Identificação lida do PDF. Confira os campos antes de salvar.');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setLendo(false);
    }
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!d) return;
    setOcupado(true);
    setErro('');
    setOk('');
    try {
      await api(`/laudos/${id}`, { metodo: 'PUT', corpo: { titulo: d.proprietarioNome, dados: d } });
      setOk('Laudo salvo.');
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  if (!d) return erro ? <div className="alerta alerta-erro" role="alert">{erro}</div> : <p className="muted">Carregando…</p>;
  const textos = {
    problema: d.problemaTexto.trim() || PROBLEMA_PADRAO(d),
    objeto: d.objetoTexto.trim() || OBJETO_PADRAO,
    vistoria: d.vistoriaTexto.trim() || VISTORIA_PADRAO,
    hipotese: d.hipoteseTexto.trim() || HIPOTESE_PADRAO,
    consideracoes: d.consideracoesTexto.trim() || CONSIDERACOES_PADRAO,
    conclusao: d.conclusaoTexto.trim() || CONCLUSAO_PADRAO,
    acompanhamento: d.acompanhamentoTexto.trim() || ACOMPANHAMENTO_PADRAO,
  };
  const paragrafos = (t: string) => t.split('\n\n').map((p, i) => <p key={i} className="texto-justificado">{p}</p>);

  return (
    <>
      <div className="nao-imprimir"><Link to="/laudos/patologias" className="small">← Laudos de patologia</Link></div>
      <CabecalhoDocumento
        modulo="Laudos"
        titulo={`Laudo de vistoria técnica${numero ? ` nº ${numero}` : ''}`}
        descricao={`Proprietário: ${d.proprietarioNome || '—'}${d.localObra ? ` · ${d.localObra}` : ''}`}
        logoDireita
      />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {ok && <div className="alerta alerta-ok" role="status">{ok}</div>}

      <div className="card nao-imprimir">
        <h2>Preencher pela leitura de um laudo (PDF)</h2>
        <p className="small muted">A IA lê proprietário, endereço e ART de um laudo anterior. Os textos padrão continuam sendo os do modelo.</p>
        <label className="btn btn-secundario" style={{ cursor: lendo ? 'progress' : 'pointer', alignSelf: 'flex-start' }}>
          {lendo ? 'Lendo o PDF…' : 'Escolher PDF'}
          <input type="file" accept="application/pdf" hidden disabled={lendo} onChange={(e) => lerPdf(e.target.files?.[0])} />
        </label>
      </div>

      <form className="card form nao-imprimir" onSubmit={salvar}>
        <h2>Dados da edificação</h2>
        <div className="campos">
          <div className="campo"><label htmlFor="p-prop">Proprietário</label><input id="p-prop" value={d.proprietarioNome} onChange={(e) => alterar({ proprietarioNome: e.target.value })} /></div>
          <div className="campo"><label htmlFor="p-doc">CPF / CNPJ</label><input id="p-doc" value={d.proprietarioDocumento} onChange={(e) => alterar({ proprietarioDocumento: e.target.value })} /></div>
          <div className="campo"><label htmlFor="p-loc">Local / obra</label><input id="p-loc" value={d.localObra} onChange={(e) => alterar({ localObra: e.target.value })} /></div>
          <div className="campo"><label htmlFor="p-end">Endereço</label><input id="p-end" value={d.endereco} onChange={(e) => alterar({ endereco: e.target.value })} /></div>
          <div className="campo"><label htmlFor="p-cep">CEP</label><input id="p-cep" value={d.cep} onChange={(e) => alterar({ cep: e.target.value })} /></div>
          <div className="campo"><label htmlFor="p-cid">Cidade</label><input id="p-cid" value={d.cidade} onChange={(e) => alterar({ cidade: e.target.value })} /></div>
          <div className="campo"><label htmlFor="p-uf">UF</label><input id="p-uf" maxLength={2} value={d.uf} onChange={(e) => alterar({ uf: e.target.value.toUpperCase() })} /></div>
          <div className="campo"><label htmlFor="p-dv">Data da vistoria</label><input id="p-dv" type="date" value={d.dataVistoria} onChange={(e) => alterar({ dataVistoria: e.target.value })} /></div>
        </div>

        <h2>Textos do laudo</h2>
        <p className="small muted">Vazios, cada texto usa o padrão do modelo. Use "Usar texto padrão" para voltar ao original.</p>
        {([
          ['problemaTexto', 'O problema (manifestações)', PROBLEMA_PADRAO(d)],
          ['objetoTexto', 'O objeto', OBJETO_PADRAO],
          ['vistoriaTexto', 'Vistoria realizada na unidade', VISTORIA_PADRAO],
          ['hipoteseTexto', 'Hipótese técnica conclusiva', HIPOTESE_PADRAO],
          ['consideracoesTexto', 'Considerações e orientações', CONSIDERACOES_PADRAO],
          ['conclusaoTexto', 'Conclusão', CONCLUSAO_PADRAO],
          ['acompanhamentoTexto', 'Anexo: acompanhamento técnico das correções', ACOMPANHAMENTO_PADRAO],
        ] as const).map(([campo, rotulo, padrao]) => (
          <div className="campo" key={campo}>
            <label htmlFor={`p-${campo}`}>{rotulo}</label>
            <textarea id={`p-${campo}`} rows={6} value={d[campo]} placeholder={padrao} onChange={(e) => alterar({ [campo]: e.target.value } as Partial<Patologia>)} />
            <button type="button" className="btn btn-link" onClick={() => alterar({ [campo]: campo === 'problemaTexto' ? PROBLEMA_PADRAO(d) : padrao } as Partial<Patologia>)}>Usar texto padrão</button>
          </div>
        ))}
        <div className="campo"><label htmlFor="p-acd">Data do acompanhamento das correções</label><input id="p-acd" type="date" value={d.acompanhamentoData} onChange={(e) => alterar({ acompanhamentoData: e.target.value })} /></div>

        <h2>Responsável e assinatura</h2>
        <div className="campos">
          <div className="campo"><label htmlFor="p-art">ART (CREA/TO)</label><input id="p-art" value={d.art} onChange={(e) => alterar({ art: e.target.value })} /></div>
          <div className="campo"><label htmlFor="p-dl">Data do laudo</label><input id="p-dl" type="date" value={d.dataLaudo} onChange={(e) => alterar({ dataLaudo: e.target.value })} /></div>
          <div className="campo"><label htmlFor="p-rn">Responsável técnico</label><input id="p-rn" value={d.responsavelNome} onChange={(e) => alterar({ responsavelNome: e.target.value })} /></div>
          <div className="campo"><label htmlFor="p-rr">Registro no conselho</label><input id="p-rr" value={d.responsavelRegistro} onChange={(e) => alterar({ responsavelRegistro: e.target.value })} /></div>
        </div>
        <div className="campo"><label htmlFor="p-obs">Observações internas (não aparecem no laudo)</label><textarea id="p-obs" rows={2} value={d.observacoes} onChange={(e) => alterar({ observacoes: e.target.value })} /></div>

        <div className="acoes">
          <button className="btn btn-primario" type="submit" disabled={ocupado}>Salvar laudo</button>
        </div>
      </form>

      <div className="so-imprimir laudo-impresso">
        <h2 className="laudo-secao">1 Dados da edificação</h2>
        <p>Proprietário: {d.proprietarioNome}{d.proprietarioDocumento ? `; CPF/CNPJ: ${d.proprietarioDocumento}` : ''}</p>
        <p>Local/obra: {d.localObra}</p>
        <p>Endereço: {d.endereco}{d.cep ? `; CEP: ${d.cep}` : ''}{d.cidade ? `; ${d.cidade}${d.uf ? ` - ${d.uf}` : ''}` : ''}</p>

        <h2 className="laudo-secao">2 Notas gerais</h2>
        <p>2.1 Vistoria técnica</p>
        {paragrafos(VISTORIA_NOTAS)}

        <h2 className="laudo-secao">3 O problema</h2>
        {paragrafos(textos.problema)}

        <h2 className="laudo-secao">4 O objeto</h2>
        {paragrafos(textos.objeto)}

        <h2 className="laudo-secao">5 Vistoria realizada na unidade autônoma</h2>
        {paragrafos(textos.vistoria)}

        <h2 className="laudo-secao">6 Hipótese técnica conclusiva</h2>
        {paragrafos(textos.hipotese)}

        <h2 className="laudo-secao">7 Considerações e orientações</h2>
        {paragrafos(textos.consideracoes)}

        <h2 className="laudo-secao">8 Conclusão</h2>
        {paragrafos(textos.conclusao)}
        {d.art && <p>Laudo vinculado a ART – CREA/TO nº {d.art}.</p>}
        {d.cidade && <p className="direita">{d.cidade}{d.dataLaudo ? `, ${dataExtenso(d.dataLaudo)}` : ''}.</p>}
        <div className="so-imprimir assinaturas">
          <Assinatura nome={d.responsavelNome} papel={d.responsavelRegistro || 'Engenheiro responsável'} />
        </div>

        <h2 className="laudo-secao">9 Anexo</h2>
        <p>9.1 Do acompanhamento técnico das correções{d.acompanhamentoData ? ` (${formatarData(d.acompanhamentoData)})` : ''}</p>
        {paragrafos(textos.acompanhamento)}
      </div>
    </>
  );
}

/** Texto de abertura da seção 2.1 do modelo de vistoria. */
const VISTORIA_NOTAS =
  'O presente Laudo de Vistoria Técnica foi elaborado a partir de solicitação formal para averiguação de manifestações patológicas associadas a indícios de infiltração.\n\nA inspeção foi realizada por meio de avaliação predominantemente visual, registros fotográficos e análise das condições aparentes no momento da vistoria, não tendo sido executados ensaios laboratoriais, testes destrutivos ou remoções de elementos construtivos. As conclusões aqui apresentadas fundamentam-se nas evidências observáveis e nas informações prestadas pelas partes envolvidas.\n\nRessalta-se que manifestações relacionadas à infiltração podem apresentar comportamento intermitente, variando conforme condições climáticas (chuvas, ventos incidentes, umidade relativa do ar) e uso da edificação. Dessa forma, a ausência de escoamento ativo no momento da vistoria não descaracteriza a ocorrência do problema.\n\nAs análises técnicas foram conduzidas considerando boas práticas construtivas, critérios de desempenho e estanqueidade usualmente aplicáveis a sistemas de vedação vertical e esquadrias, especialmente no que se refere à adequada vedação perimetral, selagens, interfaces com alvenaria e sistemas de drenagem.\n\nEste laudo limita-se à avaliação técnica das condições constatadas no momento da inspeção, não abrangendo análise estrutural global da edificação, tampouco estimativa de custos de reparo, salvo quando expressamente indicado.';

// ------------------------------------------------------------------ Laudo de avaliação (relatório técnico de avaliação)

type Avaliacao = {
  solicitante: string; endereco: string; matricula: string; tipoImovel: string; descricaoImovel: string; areaTerreno: string;
  areaConstruida: string; estadoConservacao: string; idadeAparente: string; zoneamento: string; valorMercado: number;
  valorMercadoExtenso: string; dataBase: string; resumoTexto: string; art: string; dataLaudo: string; responsavelNome: string;
  responsavelRegistro: string; observacoes: string;
};

/**
 * Laudo de avaliação: identificação do laudo e resumo da avaliação. O memorial descritivo, a metodologia
 * (NBR 14.653) e os cálculos do modelo ainda não estão no formulário; entram depois, com o restante do modelo.
 */
export function LaudoAvaliacao() {
  const { id = '' } = useParams();
  const [d, setD] = useState<Avaliacao | null>(null);
  const [numero, setNumero] = useState<number | null>(null);
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [lendo, setLendo] = useState(false);

  useEffect(() => {
    api<{ numero?: number; dados: Avaliacao }>(`/laudos/${id}`)
      .then((r) => { setD(r.dados); setNumero(r.numero ?? null); })
      .catch((e) => setErro(e.message));
  }, [id]);

  const alterar = (campo: Partial<Avaliacao>) => setD((x) => (x ? { ...x, ...campo } : x));

  async function lerPdf(arquivo: File | undefined) {
    if (!arquivo) return;
    setLendo(true);
    setErro('');
    setOk('');
    try {
      const base64 = await ARQUIVO_BASE64(arquivo);
      const r = await api<{ identificacao: Record<string, string> }>('/laudos/ler-identificacao', { metodo: 'POST', corpo: { arquivo: base64, nome: arquivo.name } });
      const i = r.identificacao;
      alterar({
        solicitante: i.proprietarioNome || d?.solicitante || '',
        endereco: i.endereco || d?.endereco || '',
        matricula: i.matricula || d?.matricula || '',
        zoneamento: i.zoneamento || d?.zoneamento || '',
        areaTerreno: i.areaTerreno || d?.areaTerreno || '',
        areaConstruida: i.areaConstruida || d?.areaConstruida || '',
        art: i.art || d?.art || '',
      });
      setOk('Identificação lida do PDF. Confira os campos antes de salvar.');
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setLendo(false);
    }
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!d) return;
    setOcupado(true);
    setErro('');
    setOk('');
    try {
      await api(`/laudos/${id}`, { metodo: 'PUT', corpo: { titulo: d.solicitante, dados: d } });
      setOk('Laudo salvo.');
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setOcupado(false);
    }
  }

  if (!d) return erro ? <div className="alerta alerta-erro" role="alert">{erro}</div> : <p className="muted">Carregando…</p>;
  const valorFormatado = d.valorMercado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <>
      <div className="nao-imprimir"><Link to="/laudos/avaliacoes" className="small">← Laudos de avaliação</Link></div>
      <CabecalhoDocumento
        modulo="Laudos"
        titulo={`Relatório técnico de avaliação${numero ? ` nº ${numero}` : ''}`}
        descricao={`Solicitante: ${d.solicitante || '—'}${d.endereco ? ` · ${d.endereco}` : ''}`}
        logoDireita
      />
      {erro && <div className="alerta alerta-erro" role="alert">{erro}</div>}
      {ok && <div className="alerta alerta-ok" role="status">{ok}</div>}

      <div className="card nao-imprimir">
        <h2>Preencher pela leitura de um laudo (PDF)</h2>
        <p className="small muted">A IA lê solicitante, endereço, matrícula e áreas de um laudo anterior. O valor de mercado e o resumo são digitados por você.</p>
        <label className="btn btn-secundario" style={{ cursor: lendo ? 'progress' : 'pointer', alignSelf: 'flex-start' }}>
          {lendo ? 'Lendo o PDF…' : 'Escolher PDF'}
          <input type="file" accept="application/pdf" hidden disabled={lendo} onChange={(e) => lerPdf(e.target.files?.[0])} />
        </label>
      </div>

      <form className="card form nao-imprimir" onSubmit={salvar}>
        <h2>Identificação do laudo</h2>
        <div className="campos">
          <div className="campo"><label htmlFor="a-sol">Solicitante</label><input id="a-sol" value={d.solicitante} onChange={(e) => alterar({ solicitante: e.target.value })} /></div>
          <div className="campo"><label htmlFor="a-end">Endereço</label><input id="a-end" value={d.endereco} onChange={(e) => alterar({ endereco: e.target.value })} /></div>
          <div className="campo"><label htmlFor="a-mat">Matrícula</label><input id="a-mat" value={d.matricula} onChange={(e) => alterar({ matricula: e.target.value })} /></div>
          <div className="campo"><label htmlFor="a-tipo">Imóvel</label><input id="a-tipo" value={d.tipoImovel} onChange={(e) => alterar({ tipoImovel: e.target.value })} placeholder="Ex.: Chácara" /></div>
          <div className="campo"><label htmlFor="a-desc">Descrição</label><input id="a-desc" value={d.descricaoImovel} onChange={(e) => alterar({ descricaoImovel: e.target.value })} placeholder="Ex.: Imóvel rural" /></div>
          <div className="campo"><label htmlFor="a-zon">Zoneamento</label><input id="a-zon" value={d.zoneamento} onChange={(e) => alterar({ zoneamento: e.target.value })} /></div>
          <div className="campo"><label htmlFor="a-at">Área de terreno</label><input id="a-at" value={d.areaTerreno} onChange={(e) => alterar({ areaTerreno: e.target.value })} placeholder="Ex.: 02ha, 26a, 20ca (conforme matrícula)" /></div>
          <div className="campo"><label htmlFor="a-ac">Área construída</label><input id="a-ac" value={d.areaConstruida} onChange={(e) => alterar({ areaConstruida: e.target.value })} placeholder="Ex.: 380,59 m²" /></div>
          <div className="campo"><label htmlFor="a-ec">Estado de conservação</label><input id="a-ec" value={d.estadoConservacao} onChange={(e) => alterar({ estadoConservacao: e.target.value })} placeholder="Ex.: Ruim" /></div>
          <div className="campo"><label htmlFor="a-ia">Idade aparente</label><input id="a-ia" value={d.idadeAparente} onChange={(e) => alterar({ idadeAparente: e.target.value })} placeholder="Ex.: 35 anos" /></div>
          <div className="campo"><label htmlFor="a-vm">Valor de mercado (R$)</label><input id="a-vm" inputMode="decimal" value={d.valorMercado} onChange={(e) => alterar({ valorMercado: Number(e.target.value.replace(',', '.')) || 0 })} /></div>
          <div className="campo"><label htmlFor="a-vmx">Valor por extenso</label><input id="a-vmx" value={d.valorMercadoExtenso} onChange={(e) => alterar({ valorMercadoExtenso: e.target.value })} /></div>
          <div className="campo"><label htmlFor="a-db">Data-base da avaliação</label><input id="a-db" type="date" value={d.dataBase} onChange={(e) => alterar({ dataBase: e.target.value })} /></div>
        </div>

        <h2>Resumo da avaliação</h2>
        <div className="campo">
          <textarea aria-label="Resumo da avaliação" rows={6} value={d.resumoTexto} onChange={(e) => alterar({ resumoTexto: e.target.value })} />
        </div>

        <h2>Responsável e assinatura</h2>
        <div className="campos">
          <div className="campo"><label htmlFor="a-art">ART (CREA/TO)</label><input id="a-art" value={d.art} onChange={(e) => alterar({ art: e.target.value })} /></div>
          <div className="campo"><label htmlFor="a-dl">Data do laudo</label><input id="a-dl" type="date" value={d.dataLaudo} onChange={(e) => alterar({ dataLaudo: e.target.value })} /></div>
          <div className="campo"><label htmlFor="a-rn">Responsável técnico</label><input id="a-rn" value={d.responsavelNome} onChange={(e) => alterar({ responsavelNome: e.target.value })} /></div>
          <div className="campo"><label htmlFor="a-rr">Registro no conselho</label><input id="a-rr" value={d.responsavelRegistro} onChange={(e) => alterar({ responsavelRegistro: e.target.value })} /></div>
        </div>
        <div className="campo"><label htmlFor="a-obs">Observações internas (não aparecem no laudo)</label><textarea id="a-obs" rows={2} value={d.observacoes} onChange={(e) => alterar({ observacoes: e.target.value })} /></div>

        <div className="acoes">
          <button className="btn btn-primario" type="submit" disabled={ocupado}>Salvar laudo</button>
        </div>
      </form>

      <div className="so-imprimir laudo-impresso">
        <h2 className="laudo-secao">1 Identificação do laudo e resumo da avaliação</h2>
        <table className="tabela">
          <tbody>
            <tr><th style={{ width: '32%' }}>Solicitante</th><td>{d.solicitante}</td></tr>
            <tr><th>Endereço</th><td>{d.endereco}</td></tr>
            <tr><th>Matrícula</th><td>{d.matricula}</td></tr>
            <tr><th>Imóvel</th><td>{d.tipoImovel}</td></tr>
            <tr><th>Descrição</th><td>{d.descricaoImovel}</td></tr>
            <tr><th>Área de terreno</th><td>{d.areaTerreno}</td></tr>
            <tr><th>Área construída</th><td>{d.areaConstruida}</td></tr>
            <tr><th>Estado de conservação</th><td>{d.estadoConservacao}</td></tr>
            <tr><th>Idade aparente</th><td>{d.idadeAparente}</td></tr>
            <tr><th>Zoneamento</th><td>{d.zoneamento}</td></tr>
            <tr><th>Valor de mercado</th><td>{valorFormatado}{d.valorMercadoExtenso ? ` (${d.valorMercadoExtenso})` : ''}</td></tr>
            <tr><th>Data-base da avaliação</th><td>{d.dataBase ? formatarData(d.dataBase) : ''}</td></tr>
          </tbody>
        </table>
        {d.resumoTexto && <>
          <h2 className="laudo-secao">Resumo da avaliação</h2>
          {d.resumoTexto.split('\n\n').map((p, i) => <p key={i} className="texto-justificado">{p}</p>)}
        </>}
        {d.art && <p>Laudo vinculado a ART – CREA/TO nº {d.art}.</p>}
        {d.dataLaudo && <p className="direita">{dataExtenso(d.dataLaudo)}.</p>}
        <div className="so-imprimir assinaturas">
          <Assinatura nome={d.responsavelNome} papel={d.responsavelRegistro || 'Engenheiro responsável'} />
        </div>
      </div>
    </>
  );
}
